"use client";

import { Chat } from "@/components/chat";
import { ConversationList } from "@/components/conversation-list";
import { Settings } from "@/components/settings";
import {
  useConversations,
  type ConversationBackend,
} from "@/lib/conversations/use-conversations";
import { findEndpoint } from "@/lib/endpoints/registry";
import { useRegistry } from "@/lib/endpoints/use-registry";
import { selectedModel } from "@/lib/models/selection";
import { useSelection } from "@/lib/selection/use-selection";

/**
 * The saved Conversations beside the chat.
 *
 * This is where the store and the chat meet. The list is on the left and the
 * Conversation on the right, stacked at a narrow width so neither is squeezed
 * into uselessness on a phone.
 *
 * The chat is rendered here rather than passed in as an element or a render
 * function: a function cannot cross the server/client boundary under Cache
 * Components.
 *
 * It is also where the Endpoint and Model are resolved, because both halves of
 * the interface need them and neither owns them: the chat names them in every
 * Request it makes, and the Settings dialog edits them. They were held here
 * rather than in `Chat` because the chat below is remounted on every Conversation
 * switch — that remount is what makes `useChat` adopt a saved Conversation's Turns
 * — and state inside it would be thrown away each time. A reader who chose a
 * Cloud Endpoint and then started a new Conversation would be handed Ollama back.
 *
 * The Model choice stays keyed by Endpoint, so switching back to an Endpoint
 * restores the Model chosen there — that is `ModelSelection`'s own reason for
 * existing, and this is the second place it is needed.
 *
 * Both choices are kept between visits by `useSelection`, which reads them back
 * out of the reader's own storage. They are not held in state here, and that is
 * the whole point: setting an Endpoint up is work, and a reader who has already
 * done it should find it done rather than be handed Ollama again on every visit.
 *
 * The chosen Endpoint's name and starting Model come from the Registry in source
 * where that is enough, and from the server's answer where it is not — see the
 * note at the lookup below. A built-in Endpoint needs no round trip, so a reader
 * is never shown a raw id where a name belongs; a declared one is named by its
 * id until the answer lands, and that answer is one request made on mount.
 */

export function Workspace({
  endpointId,
  backend,
}: {
  /** The Endpoint the Conversation opens on, unless one was remembered. */
  endpointId: string;
  /**
   * The store to use, defaulting to the browser's own.
   *
   * Taken as a prop so a test can point the whole path — list, save, reopen —
   * at a database it controls, rather than asserting against jsdom's.
   */
  backend?: ConversationBackend | null;
}) {
  const {
    conversations,
    current,
    ready,
    available,
    startNew,
    open,
    save,
    rename,
    remove,
    removeAll,
  } = useConversations(backend);

  /**
   * The Registry, as the server reports it.
   *
   * Read through the shared hook rather than fetched here, so this and the
   * Endpoint picker are looking at one answer instead of two taken at slightly
   * different moments — which is how a declared Endpoint ends up in the list but
   * not yet in the chat header.
   */
  const statuses = useRegistry().statuses;

  // Ids only, and only the reader's own: this is what a stored choice is checked
  // against, and the built-in ones the module checks for itself.
  const declaredIds = statuses
    .filter((status) => status.group === "declared")
    .map((status) => status.id);

  const {
    endpointId: chosenEndpoint,
    models: selection,
    chooseEndpoint,
    chooseModel: rememberInEndpoint,
  } = useSelection(endpointId, declaredIds);

  // Built-in Endpoints are resolved from the Registry directly, as they always
  // were, and synchronously — so the very first render already names Ollama and
  // carries its starting Model. Reading them from the server answer instead
  // would leave the header showing a raw id and the Model field empty until the
  // answer arrived, which is the visible jump `useSelection`'s own notes warn
  // against.
  //
  // The server answer is what covers the Endpoints the Registry cannot see: a
  // declared one lives in `.endpoints.json`, on the server's side of a boundary
  // this component cannot cross. Those are named by their id until the answer
  // lands, which is recognisable rather than blank, and the answer arrives
  // before a reader could send a Turn.
  const builtIn = findEndpoint(chosenEndpoint);
  const fromServer = statuses.find((status) => status.id === chosenEndpoint);

  const endpointName = builtIn?.name ?? fromServer?.name ?? chosenEndpoint;
  const modelId = selectedModel(
    selection,
    chosenEndpoint,
    builtIn?.defaultModelId ?? fromServer?.defaultModelId ?? "",
  );

  function chooseModel(identifier: string) {
    rememberInEndpoint(chosenEndpoint, identifier);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <ConversationList
        conversations={conversations}
        currentId={current.id}
        ready={ready}
        available={available}
        onOpen={(id) => void open(id)}
        onNew={startNew}
        onRename={(id, title) => void rename(id, title)}
        onDelete={(id) => void remove(id)}
        // Rendered here and handed down as the list's footer, because the dialog
        // edits the choice this component resolves for the chat. The list still
        // decides where it sits.
        footer={
          <Settings
            endpointId={chosenEndpoint}
            endpointName={endpointName}
            modelId={modelId}
            onSelectEndpoint={chooseEndpoint}
            onSelectModel={chooseModel}
            // The count rather than the list itself: the dialog needs to say what
            // would be lost and whether there is anything to lose, and handing it
            // the Summaries would mean it could render the whole list behind a
            // confirmation to answer a question a sentence answers.
            savedCount={conversations.length}
            onDeleteAllChats={() => void removeAll()}
          />
        }
      />

      {/*
        Keyed on the Conversation id, so opening another one remounts the chat
        and `useChat` adopts the new id and Turns at mount — which is the only
        point at which it reads them. Remounting is also what stops a Response
        streaming into the Conversation the reader just left.

        The id is stable from when the Conversation is started, not minted on
        first write, so saving — including a save that lands while a Response is
        still streaming in — does not change the key and does not disturb the
        stream. Only starting, opening, or deleting changes it.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" key={current.id}>
        <Chat
          endpointId={chosenEndpoint}
          endpointName={endpointName}
          modelId={modelId}
          conversation={current}
          onSave={save}
          onStartNew={startNew}
        />
      </div>
    </div>
  );
}