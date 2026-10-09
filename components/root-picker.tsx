"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Modal } from "@/components/modal";
import {
  declareRoot,
  forgetRoot,
  locateFolder,
  readRoot,
  requestWalk,
  revokeGrant,
  rootNamingIsAvailable,
  type RootAnswer,
  type RootListing,
  type WalkEntry,
} from "@/lib/roots/declare-root";

/**
 * The Reading Root: the folder the Model may read, chosen from the reader's own
 * machine.
 *
 * There are two ways in, and both start in the same place — a button the reader
 * presses, which opens a folder dialog belonging to their operating system.
 * Where the browser has `showDirectoryPicker()` that dialog is a native one and
 * hands back a **name**; where it does not (Safari, Firefox) a hidden
 * `<input webkitdirectory>` opens the same machine dialog and hands back a name
 * in the first component of `webkitRelativePath`. Neither hands back a path,
 * and neither can: `File.path` was removed from Chrome in v61 as a privacy fix
 * and nothing has put it back. The walk is the other way in, and it is offered
 * from every state of the panel rather than only from the ones where a name came
 * back empty — it reaches any folder inside the home folder whatever it is
 * called, which is the answer for a name nothing carries and for a folder the
 * search could not see from here.
 *
 * **The name is resolved on the server, and the answer is shown before it is
 * used.** That is the whole design rather than a nicety on it. A reader who
 * picks `/Volumes/External/Projects` — a volume this app cannot reach, because
 * the walk is held to their home folder — and who also has a `Projects` in home
 * would otherwise be given the second one and told nothing about it. So nothing
 * is ever recorded from a name alone: `locateFolder` sends the name and gets
 * back the paths, the reader is shown them, and only a path the reader has been
 * shown is ever handed to `declareRoot`.
 *
 * **The browser is never in a position to assert a location.** The Root lives
 * in `.reading-root.json` on the server, `mayRead` resolves against it there,
 * and nothing in this file resolves, normalises or checks a path. A control
 * that wanted the browser to send one would be the bug, not the design.
 *
 * The whole control is absent outside development, and the reason is not that
 * there would be nothing to show: the route that names a Root refuses there, so
 * a button that can only fail is not worth rendering. What a Root is does still
 * apply in a deployed build — the chat route reads the same file — and that is
 * deliberately a different question from changing it.
 */

/** The rows of a listing, split so a folder and a file are not offered alike. */
function asListing(current: RootListing | null) {
  return current?.status === "listed" ? current : null;
}

/**
 * The machine's own folder dialog, where this browser has one.
 *
 * **Declared here rather than imported and read at the moment of the press.**
 * Three reasons, each of which would be a different bug: it is Chromium-only,
 * so a browser without it is not an error but the ordinary case on a Mac that
 * has never opened Chrome; it needs a user gesture, and the gesture is in this
 * file — anything that ran the dialog for us would have lost it; and it is
 * called as a method of `window` so the receiver is right, since the browser's
 * own implementation refuses to run without one.
 */
type DirectoryPicker = () => Promise<{ name: string }>;

function nativePicker(): DirectoryPicker | null {
  // No `window` on the server, and this is called while rendering. The control
  // returns nothing outside development anyway, but a global read that is only
  // safe because of where an early return happens is a crash waiting for
  // whoever moves it.
  if (typeof window === "undefined") return null;

  const held = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (typeof held !== "function") return null;
  return () => (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker();
}

/**
 * Whether a rejection is the reader closing the dialog, which is not a failure.
 *
 * Read off the name rather than off the class, because the thrower here is the
 * browser and `AbortError` is the one thing it guarantees about this: a test, a
 * wrapper or a future engine can all change what is thrown without changing
 * what closing a dialog means. Anything else is reported, because a dialog that
 * refused to open for a real reason is worth the reader knowing about.
 */
function isCancel(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * The name of the folder a `webkitdirectory` input reported.
 *
 * **`webkitRelativePath` is a path with its root missing**, which is the whole
 * of what the fallback tier is given: the first component is the chosen
 * folder's own name, and everything after it is how to reach one file inside
 * it. Nothing else is read off the file — there is nothing else there to read,
 * and `File.path` is not a thing any more. `null` means the folder held no
 * files at all, which is a real folder the reader may well have meant.
 */
function folderName(event: ChangeEvent<HTMLInputElement>): string | null {
  const relative = event.target.files?.[0]?.webkitRelativePath ?? "";
  const first = relative.split("/")[0];

  // So the same folder can be chosen twice. Without this the input's value is
  // unchanged by the second choice and the change event is never fired again.
  event.target.value = "";

  return first === "" ? null : first;
}

/**
 * What the folder dialog gave, and what the app has done about it.
 *
 * One state rather than several flags, because the states are genuinely
 * exclusive: a reader is looking at one of these, and a control that could be
 * showing a refusal and a confirmation at once would be a control that had
 * stopped saying which was which.
 *
 * **`complete` travels with every answer rather than with only the empty one.**
 * A search that stopped at its ceiling and found nothing has not established
 * that nothing is there, and saying so would be a claim the app cannot make.
 */
type Search =
  /** Nothing has been asked yet, or the reader closed the machine's dialog. */
  | { kind: "asking" }
  /** A name is with the server. */
  | { kind: "searching"; name: string }
  /** The fallback tier chose a folder with nothing in it, so there is no name. */
  | { kind: "empty" }
  /** No folder of that name is inside the boundary. */
  | { kind: "nowhere"; name: string; complete: boolean }
  /** The name is not one a folder can carry. */
  | { kind: "refused"; message: string }
  /** Exactly one, and its full path is on screen. */
  | { kind: "found"; name: string; path: string; complete: boolean; refused: string | null }
  /** Several, and every one of their full paths is on screen. */
  | { kind: "several"; name: string; paths: string[]; complete: boolean; refused: string | null }
  /** The reader confirmed one, and the server says this is where it really is. */
  | { kind: "recorded"; path: string };

export function RootPicker() {
  const [answer, setAnswer] = useState<RootAnswer | null>(null);
  const [removing, setRemoving] = useState(false);
  /**
   * Which dialog is open, and never more than one.
   *
   * A single value rather than a boolean each, because the chooser hands over to
   * the walk instead of opening it alongside: two dialogs at once would mean two
   * panels competing for the reader, and a reader who pressed "choose a folder
   * another way" asked for the other one rather than for both.
   */
  const [view, setView] = useState<"chooser" | "walk" | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [search, setSearch] = useState<Search>({ kind: "asking" });
  const [saving, setSaving] = useState(false);

  /**
   * The Root in use, held separately from the last answer.
   *
   * A refusal is not a change. A removal the route refused leaves the folder on
   * disk exactly where it was, and replacing what is shown on the strength of
   * the refusal would tell the reader their folder had been given up when it had
   * not — the one direction of error here that leaves them believing the Model
   * reads less than it does, or, after a removal that did work, more.
   *
   * The Grants are held the same way and for the same reason: one that was not
   * taken back is still in force, and a list that had dropped it would be the
   * app claiming the Model reads less than it can.
   */
  const [root, setRoot] = useState<string | null>(null);
  const [grants, setGrants] = useState<string[]>([]);

  /** The fallback tier's input, which only the reader's own press ever opens. */
  const folderInput = useRef<HTMLInputElement>(null);

  /**
   * Counts the searches, so a slow one cannot land under a fast one.
   *
   * A reader who opens the dialog twice and picks twice gets two answers, and
   * the first to arrive is the one about the folder they are no longer looking
   * at. Presenting that one would put a path on screen under a name that has
   * nothing to do with it.
   */
  const askedFor = useRef(0);

  // Read on mount rather than held by the page, so the folder shown is the one
  // on disk now. A Root declared a moment ago in another tab is picked up here
  // without a reload, which is what makes declaring one feel like it took.
  useEffect(() => {
    let current = true;
    void readRoot().then((read) => {
      if (!current) return;
      setAnswer(read);
      if (read.status === "declared") setRoot(read.root);
      // A refusal says nothing about the Grants and does not empty the list: the
      // folder on disk is whatever it was, and a reader who cannot be told what
      // it is keeps the last thing they were told.
      if (read.status !== "refused") setGrants(read.grants);
    });
    return () => {
      current = false;
    };
  }, []);

  // Nothing to change and nowhere to walk to. Rendering the control would offer
  // a folder picker in a build whose route refuses every request to it.
  if (!rootNamingIsAvailable()) return null;

  /**
   * Turns the name a folder dialog gave into somewhere, and shows it.
   *
   * **The one place a name becomes a path**, and it does not do the resolving
   * even now: the name goes up as exactly the characters the reader's dialog
   * reported and the answer comes back as paths. That is what keeps the browser
   * from asserting a location — it never says where anything is, it only says
   * what the folder is called.
   */
  async function searchFor(name: string) {
    const mine = askedFor.current + 1;
    askedFor.current = mine;

    setSearch({ kind: "searching", name });

    const located = await locateFolder(name);

    if (askedFor.current !== mine) return;

    if (located.status === "refused") {
      setSearch({ kind: "refused", message: located.message });
      return;
    }

    const { matches, complete } = located;

    if (matches.length === 0) {
      setSearch({ kind: "nowhere", name, complete });
      return;
    }

    const paths = matches.map((match) => match.path);

    setSearch(
      paths.length === 1
        ? { kind: "found", name, path: paths[0], complete, refused: null }
        : { kind: "several", name, paths, complete, refused: null },
    );
  }

  /**
   * Opens whichever folder dialog this browser has.
   *
   * Called from the reader's press and from nowhere else, because both dialogs
   * open on a user gesture: opening one from an effect would arrive a task
   * later, by which point the gesture is spent and the browser refuses to show
   * anything at all. A reader who has already asked and gets nothing must be
   * able to ask again, so this is also what the dialog's own button calls.
   */
  function openMachineDialog() {
    const native = nativePicker();

    if (native) {
      native().then(
        (handle) => void searchFor(handle.name),
        (error: unknown) =>
          setSearch(
            isCancel(error)
              ? { kind: "asking" }
              : { kind: "refused", message: refusedToOpen() },
          ),
      );
      return;
    }

    // The other tier: the same machine dialog, reached through the one element
    // every browser has had for a folder. The answer arrives when the reader
    // has chosen, in `folderName` below.
    folderInput.current?.click();
  }

  function folderChosen(event: ChangeEvent<HTMLInputElement>) {
    const name = folderName(event);

    // A folder with nothing in it gives this tier no name at all, which is not
    // the same as a folder the reader did not mean. It is said so, and the walk
    // is offered, rather than the panel quietly doing nothing.
    if (name === null) {
      setSearch({ kind: "empty" });
      return;
    }

    void searchFor(name);
  }

  function openChooser() {
    setView("chooser");
    setSearch({ kind: "asking" });
    openMachineDialog();
  }

  /**
   * Records the folder the reader has just been shown.
   *
   * **Only ever called with a path that is on screen at the time.** The caller
   * is the dialog, and the dialog's only buttons are the ones beside the paths
   * it renders, so there is no route from this control to `declareRoot` that
   * does not pass a path the reader can read off the screen in front of them.
   */
  async function confirm(path: string) {
    if (saving) return;

    setSaving(true);

    const outcome = await declareRoot(path);

    if (outcome.status === "declared") {
      setSearch({ kind: "recorded", path: outcome.root });
      onDeclared(outcome.root);
    } else {
      // Shown against the folder it was refused for rather than thrown away
      // with it: the paths stay on screen, so a reader can see what the refusal
      // was about and choose again.
      const message =
        outcome.status === "refused" ? outcome.message : "The folder could not be recorded.";

      setSearch(
        search.kind === "found" || search.kind === "several"
          ? { ...search, refused: message }
          : { kind: "refused", message },
      );
    }

    setSaving(false);
  }

  function onDeclared(chosen: string) {
    setRoot(chosen);
    setAnswer({ status: "declared", root: chosen, grants: [] });
  }

  async function removeRoot() {
    setRemoving(true);

    const outcome = await forgetRoot();

    // The Root is cleared only when the route says it was cleared. A refusal
    // leaves it, because that is the state the machine is in.
    if (outcome.status !== "refused") {
      setRoot(null);
      setGrants([]);
    }

    setAnswer(outcome);
    setRemoving(false);
  }

  async function removeGrant(recorded: string) {
    setRevoking(recorded);

    const outcome = await revokeGrant(recorded);

    if (outcome.status === "refused") {
      // A refusal is shown as a refusal, and the list is left as it was: one that
      // was not taken back is still in force, and a list that had dropped it
      // would be the app claiming the Model reads less than it can.
      setAnswer(outcome);
      setRevoking(null);
      return;
    }

    setGrants(outcome.grants);
    setAnswer(
      root === null ? { status: "none", malformed: false, grants: outcome.grants } : { status: "declared", root, grants: outcome.grants },
    );
    setRevoking(null);
  }

  const declared = root;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* A path is a machine string and is set in the mono register, the same
            as a Model identifier: it has to be read character by character to be
            checked against the folder the reader meant. */}
        <span className="hm-label w-16 shrink-0">Folder</span>

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {declared === null ? (
            <span className="text-sm text-muted">No folder chosen</span>
          ) : (
            <>
              <span className="truncate text-sm text-ink">{basename(declared)}</span>
              <span className="truncate font-mono text-xs text-muted">{declared}</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={openChooser}
          className="hm-btn hm-btn--quiet shrink-0"
          aria-haspopup="dialog"
        >
          {/* One button either way, and the rest of the sentence after "Change
              folder" is read aloud rather than shown: "Change folder" alone
              says what will change and not what pressing it opens, which is the
              half a reader of the screen needs and the half a sighted reader
              gets from the panel it opens. */}
          {declared === null ? (
            "Choose a folder"
          ) : (
            <>
              Change folder
              <span className="sr-only"> and choose a folder to read instead</span>
            </>
          )}
        </button>

        {/* The fallback tier's own element, rendered only where the browser has
            no native dialog to open. Hidden because it is never meant to be
            pointed at: a reader chooses a folder in their machine's own dialog,
            and this only exists to ask the machine to show one. `webkitdirectory`
            is spread rather than written as a prop because React's types do not
            carry it, and it is the attribute's presence — not any value of it —
            that makes an `<input>` pick a folder rather than files. */}
        {nativePicker() === null && (
          <input
            ref={folderInput}
            type="file"
            hidden
            {...{ webkitdirectory: "" }}
            onChange={folderChosen}
          />
        )}

        {/* Only when there is something to remove: a control that forgets nothing
            is a button whose only effect is to do nothing. */}
        {declared !== null && (
          <button
            type="button"
            onClick={() => void removeRoot()}
            disabled={removing}
            className="hm-btn hm-btn--quiet shrink-0"
          >
            {removing ? "Removing..." : "Remove"}
          </button>
        )}
      </div>

      {/* The two states that are not a folder and not an empty one. Both are
          errors rather than absence, and both would look like "no Root" if they
          were reported as nothing. */}
      <p role={answer?.status === "refused" ? "alert" : "status"} className="hm-status">
        {describe(answer, declared)}
      </p>

      {grants.length > 0 && (
        <ul className="flex flex-col gap-1">
          {grants.map((granted) => (
            <li key={granted} className="flex items-center gap-2">
              {/* The path whole, and in the mono register, because this is a
                  decision the reader has to be able to recognise rather than a
                  caption: two of them can easily be called the same thing in
                  different folders, and it is the folder that was asked about. */}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={granted}>
                {granted}
              </span>
              <button
                type="button"
                onClick={() => void removeGrant(granted)}
                disabled={revoking === granted}
                className="hm-btn hm-btn--quiet hm-btn--sm shrink-0"
              >
                {revoking === granted ? "Stopping..." : "Stop allowing"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {view === "chooser" && (
        <FolderChooser
          search={search}
          saving={saving}
          onAsk={openMachineDialog}
          onConfirm={(path) => void confirm(path)}
          // The walk replaces this dialog rather than opening above it.
          onWalk={() => setView("walk")}
          onClose={() => setView(null)}
        />
      )}

      {view === "walk" && (
        <RootWalk
          // Handed down rather than read again: the Root in use is already known
          // here, and asking the route for it a second time would be a request
          // whose only purpose is to learn something this component holds.
          startAt={declared}
          onClose={() => setView(null)}
          onDeclared={onDeclared}
        />
      )}
    </div>
  );
}

function basename(folder: string): string {
  const trimmed = folder.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

function describe(answer: RootAnswer | null, declared: string | null): string {
  if (answer === null) return "Reading which folder the Model may read...";

  if (answer.status === "refused") return answer.message;

  if (answer.status === "none" && answer.malformed) {
    return "The file recording the folder could not be read, so nothing is being read. Remove it and choose the folder again.";
  }

  if (declared === null) {
    return "The Model cannot read files on this machine until you choose a folder.";
  }

  return `The Model reads ${declared}, and anything you point at outside it stops and asks first.`;
}

/** What the chooser says when the machine's own dialog did not open. */
function refusedToOpen(): string {
  return "Your browser's folder dialog could not be opened. Choose a folder another way and walk to it.";
}

/**
 * The panel around the machine's folder dialog.
 *
 * **It exists because of what the dialog gives and does not give.** The dialog
 * hands back a name and no path at all, so something has to say where that name
 * really is, and it cannot be this component — it has no Root, cannot resolve
 * anything, and a string it worked out itself would be a second answer to "where
 * does this path point" that could disagree with the server's.
 *
 * **Nothing here is recorded until a path has been shown.** One match is shown
 * and confirmed; several are listed whole and the reader picks; none says so and
 * offers the walk, which is the route that works for a folder outside the home
 * folder as well as for a name nothing carries.
 */
function FolderChooser({
  search,
  saving,
  onAsk,
  onConfirm,
  onWalk,
  onClose,
}: {
  search: Search;
  saving: boolean;
  onAsk: () => void;
  onConfirm: (path: string) => void;
  onWalk: () => void;
  onClose: () => void;
}) {
  const incomplete = complete(search);

  return (
    <Modal labelledBy="folder-chooser-heading" onClose={onClose}>
      <h2 id="folder-chooser-heading" className="font-display text-md font-semibold text-ink">
        Choose a folder
      </h2>

      <p className="mt-2 text-sm text-ink-2">
        The choosing is done by the folder dialog your own computer provides. It can tell this app
        only what the folder is called — no browser folder dialog can give a path, because Chrome
        removed <span className="font-mono">File.path</span> in 2017 and nothing has put it back —
        so the app looks for folders with that name inside your home folder and shows you where
        they really are.
      </p>

      {/* One match, and its whole path. The reader is confirming a location, so
          the location is what they are shown: not the name they chose, and not
          the last two steps of where it turned out to be. */}
      {search.kind === "found" && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="break-all font-mono text-xs text-ink">{search.path}</p>
          <div>
            <button
              type="button"
              onClick={() => onConfirm(search.path)}
              disabled={saving}
              className="hm-btn hm-btn--primary"
            >
              {saving ? "Saving..." : "Use this folder"}
            </button>
          </div>
        </div>
      )}

      {/* Several, because two folders on one machine can easily carry the same
          name and which of them the reader picked is a fact about their disk
          that this app has no way of knowing. Each is a row with its own button
          for the same reason: choosing one of them is the reader's decision,
          not the app's. */}
      {search.kind === "several" && (
        <ul className="mt-3 flex flex-col gap-2">
          {search.paths.map((path) => (
            <li key={path} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{path}</span>
              {/* Left saying the same thing on every row while one of them is
                  being recorded: swapping all of them to "Saving..." would say
                  that every folder on the list had been chosen. The status line
                  below is where that one is reported. */}
              <button
                type="button"
                onClick={() => onConfirm(path)}
                disabled={saving}
                className="hm-btn hm-btn--quiet hm-btn--sm shrink-0"
              >
                Use this folder
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Said above every answer rather than in the status line below, because
          this is the one thing a reader must not read past: a search that
          stopped at its ceiling did not look everywhere, and a list it produces
          is what it found rather than what is there. It shows for an empty
          result too, where claiming nothing is there would be exactly the
          certainty this flag exists to withhold. */}
      {incomplete === false && (
        <p className="mt-3 text-sm text-warn">
          This search stopped before it reached the end of your home folder, so this is what it
          found and not everything that is there.
        </p>
      )}

      <p role={isRefusal(search) ? "alert" : "status"} className="hm-status mt-3">
        {chooserStatus(search, saving)}
      </p>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="hm-btn">
          Close
        </button>

        {/* Offered from every state, and not only from the empty ones. The walk
            reaches every folder inside the home folder whatever it is called,
            so it is the answer for a name nothing carries and for a folder the
            search could not see from here — and a reader who chose wrongly
            should not have to close and start again to get there. */}
        {search.kind !== "recorded" && (
          <button type="button" onClick={onWalk} className="hm-btn">
            Choose a folder another way
          </button>
        )}

        {/* Asking again, for the reader whose first press opened nothing: a
            machine dialog behind a browser window does not always come
            forward, and closing this and reopening the picker is not a step a
            reader should have to be told about. */}
        {search.kind !== "recorded" && (
          <button type="button" onClick={onAsk} disabled={saving} className="hm-btn hm-btn--primary">
            Open the folder dialog
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * Whether the search reached the end of the home folder it was bounded to.
 *
 * `null` for the states that are not an answer to it at all, so that "has not
 * been asked yet" and "stopped early" are not shown as the same warning.
 */
function complete(search: Search): boolean | null {
  if (search.kind === "found" || search.kind === "several" || search.kind === "nowhere") {
    return search.complete;
  }

  return null;
}

/** Whether the panel is currently showing a refusal, which reads differently. */
function isRefusal(search: Search): boolean {
  if (search.kind === "refused") return true;
  return (search.kind === "found" || search.kind === "several") && search.refused !== null;
}

/**
 * What the panel has to say, so it is never an empty box.
 *
 * Each state names what happened and, where there is something the reader can
 * still do about it, that. A refusal is shown in the route's own words for the
 * reason the walk's are: it names the cause and what to do instead.
 */
function chooserStatus(search: Search, saving: boolean): string {
  if (search.kind === "refused") return search.message;
  if (search.kind === "found" && search.refused !== null) return search.refused;
  if (search.kind === "several" && search.refused !== null) return search.refused;

  if (saving) return "Recording your choice...";

  if (search.kind === "searching") {
    return `Looking for a folder called ${search.name} inside your home folder...`;
  }

  if (search.kind === "empty") {
    return "That folder has nothing in it, so this browser has no name to look for. An empty " +
      "folder can still be a Root — walk to it instead.";
  }

  if (search.kind === "nowhere") {
    // The boundary is named rather than left implied. The folder the reader
    // picked may well be real and may well be what they meant; it is simply not
    // somewhere this app can reach, and saying which is why lets them tell the
    // difference between the app being wrong and the folder being elsewhere.
    return `Nothing called ${search.name} is inside your home folder, which is as far as this ` +
      "app looks. If the folder you picked is on another disk, or above your home folder, it " +
      "cannot be found this way — walk to it instead.";
  }

  if (search.kind === "found") {
    return search.complete
      ? `That is the only folder in your home folder called ${search.name}.`
      : `Here is the one folder called ${search.name} that this search found.`;
  }

  if (search.kind === "several") {
    return `These are the folders in your home folder called ${search.name}. ` +
      "Choose the one you meant — they cannot be told apart from the name alone.";
  }

  if (search.kind === "recorded") {
    return `The Model now reads ${search.path}.`;
  }

  return "Nothing has been chosen yet. Open the folder dialog again, or walk to a folder yourself.";
}

/**
 * Walking to a folder, and choosing it.
 *
 * The listing is the server's, refreshed from the folder just clicked rather than
 * worked out in the browser, so "what is in here" is answered in one place in the
 * app. Folders are ways in and are the only thing a Root can be; files are listed
 * because a reader looking at a folder needs to see that it is not empty, and are
 * not clickable, because both clicking one and declaring one are refused.
 */
function RootWalk({
  startAt,
  onClose,
  onDeclared,
}: {
  /** The Root in use, so the walk opens where the reader last left off. */
  startAt: string | null;
  onClose: () => void;
  onDeclared: (root: string) => void;
}) {
  const [listing, setListing] = useState<RootListing | null>(null);
  const [saving, setSaving] = useState(false);
  const [declared, setDeclared] = useState<string | null>(null);

  // Opens at the Root when there is one, since a reader changing it is usually
  // standing where they last left off; at their home folder when there is not.
  useEffect(() => {
    let current = true;
    void requestWalk(startAt ?? undefined).then((next) => {
      if (current) setListing(next);
    });
    return () => {
      current = false;
    };
  }, [startAt]);

  async function choose() {
    if (shown === null || saving) return;

    setSaving(true);
    const answer = await declareRoot(shown.path);

    if (answer.status === "declared") {
      setDeclared(answer.root);
      onDeclared(answer.root);
    } else {
      // The refusal is shown rather than swallowed: the reader pressed the button
      // on a folder they meant, and being told nothing would leave them thinking
      // they had widened what the Model can read when they had not.
      setListing({
        status: "refused",
        message: answer.status === "refused" ? answer.message : "The folder could not be recorded.",
      });
    }

    setSaving(false);
  }

  async function walkTo(target: string) {
    setListing(await requestWalk(target));
  }

  const shown = asListing(listing);

  // The folder above the one being shown, or `null` when the walk has reached the
  // edge of what it may show and there is nowhere up to go.
  const up = shown?.parent ?? null;

  return (
    <Modal labelledBy="root-walk-heading" onClose={onClose}>
      <h2 id="root-walk-heading" className="font-display text-md font-semibold text-ink">
        Choose a folder
      </h2>

      <p className="mt-2 text-sm text-ink-2">
        The Model will read this folder and what is inside it. Nothing outside it is read without
        asking you first.
      </p>

      {/* Where the walk has reached, named in full: a reader confirming they are
          about to hand over a folder needs the whole path, not the last step of
          it. */}
      <p className="mt-3 font-mono text-xs text-muted">{shown?.path ?? ""}</p>

      {/* Always rendered while there is a listing, even when it is empty, so the
          dialog does not change size as the reader walks. */}
      <ul className="mt-3 flex max-h-64 flex-col overflow-y-auto">
        {/* A way back up, offered only while there is one. `..` is the
            conventional name for it and needs no explanation, and it goes to the
            folder the server reported rather than to one worked out by trimming a
            string in the browser. `up` is that folder, and never `null`: the row
            is not rendered at all when there is nothing above. */}
        {up !== null && (
          <li>
            <button
              type="button"
              onClick={() => void walkTo(up)}
              className="hm-btn hm-btn--quiet w-full justify-start"
            >
              ..
            </button>
          </li>
        )}

        {shown?.entries.map((entry: WalkEntry) => (
          <li key={entry.path}>
            {entry.kind === "directory" ? (
              <button
                type="button"
                onClick={() => void walkTo(entry.path)}
                className="hm-btn hm-btn--quiet w-full justify-start font-mono"
              >
                {entry.name}
              </button>
            ) : (
              <span className="px-3 py-2 font-mono text-sm text-muted">{entry.name}</span>
            )}
          </li>
        ))}
      </ul>

      <p role="status" className="hm-status">
        {walkStatus(listing, declared, saving)}
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="hm-btn">
          Close
        </button>
        <button
          type="button"
          onClick={() => void choose()}
          disabled={shown === null || saving}
          className="hm-btn hm-btn--primary"
        >
          {saving ? "Saving..." : "Use this folder"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * What the walk has to say, so it is never an empty box.
 *
 * A refusal is shown in the route's own words: it names the cause and what to do
 * instead, which is more use here than any wording written on this side of the
 * request.
 */
function walkStatus(
  listing: RootListing | null,
  declared: string | null,
  saving: boolean,
): string {
  if (listing === null) return "Looking at your folders...";
  if (listing.status === "refused") return listing.message;
  if (declared !== null) return `The Model now reads ${declared}.`;
  if (saving) return "Recording your choice...";

  // An empty folder with no way back up is somewhere the reader cannot choose
  // their way out of, which is worth saying rather than showing as a blank box.
  if (listing.entries.length === 0 && listing.parent === null) {
    return "Nothing here to choose. Close this and check your home folder.";
  }

  // The button acts on the folder being shown, so the instruction names that
  // folder rather than speaking about folders in general.
  return listing.parent === null
    ? "Use the folder above, or go into one of them first."
    : "Use the folder above, or go into one of them or back up first.";
}