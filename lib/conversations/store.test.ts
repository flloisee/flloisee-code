// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConversationStoreUnavailable,
  deleteConversation,
  deleteEveryConversation,
  listConversations,
  readConversation,
  writeConversation,
  type SavedConversation,
} from "@/lib/conversations/store";
import { rejectionFor } from "@/lib/testing/history";
import { MAX_FILE_BYTES, MAX_READ_LINES } from "@/lib/tools/file-tools";

/**
 * A fresh in-memory database per test, so ordering and deletion are asserted
 * against a store whose contents each test fully controls. Sharing one would
 * let a test that forgot to clean up change another's answer.
 */

let factory: IDBFactory;

function conversation(over: Partial<SavedConversation> = {}): SavedConversation {
  return {
    id: "c1",
    title: "Why is the build red?",
    messages: [
      { id: "m1", role: "user", parts: [{ type: "text", text: "Why is the build red?" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "A lint rule." }] },
    ],
    updatedAt: 1_000,
    ...over,
  };
}

beforeEach(() => {
  factory = new IDBFactory();
});

afterEach(() => {
  // `fake-indexeddb`'s factory stands in for the browser's, which is closed
  // here and there by the store itself; the factory object is not.
});

describe("writeConversation and readConversation", () => {
  it("round-trips a Conversation with its Turns", async () => {
    await writeConversation(factory, conversation());

    const read = await readConversation(factory, "c1");

    expect(read?.messages).toHaveLength(2);
    expect(read?.title).toBe("Why is the build red?");
  });

  it("answers null for a Conversation that was never saved", async () => {
    expect(await readConversation(factory, "missing")).toBeNull();
  });

  it("replaces an existing Conversation under the same id", async () => {
    await writeConversation(factory, conversation());
    await writeConversation(factory, conversation({ title: "Renamed", updatedAt: 2_000 }));

    const read = await readConversation(factory, "c1");

    expect(read?.title).toBe("Renamed");
    // The list must move when a Conversation is written again, which is why
    // the write carries the newer stamp.
    expect(read?.updatedAt).toBe(2_000);
  });

  it("keeps a rename from altering the Turns", async () => {
    const original = conversation();
    await writeConversation(factory, original);
    await writeConversation(factory, { ...original, title: "Something else" });

    const read = await readConversation(factory, "c1");

    expect(read?.messages).toEqual(original.messages);
  });
});

describe("listConversations", () => {
  it("is empty before anything is saved", async () => {
    expect(await listConversations(factory)).toEqual([]);
  });

  it("orders newest first", async () => {
    await writeConversation(factory, conversation({ id: "old", updatedAt: 1 }));
    await writeConversation(factory, conversation({ id: "new", updatedAt: 3 }));
    await writeConversation(factory, conversation({ id: "middle", updatedAt: 2 }));

    expect((await listConversations(factory)).map((c) => c.id)).toEqual(["new", "middle", "old"]);
  });

  it("omits the Turns, so the list does not grow with the Conversations", async () => {
    await writeConversation(factory, conversation());

    const [summary] = await listConversations(factory);

    // The list only names Conversations; loading every message of every one of
    // them to draw a column of titles would slow the app as it is used.
    expect(summary).not.toHaveProperty("messages");
    expect(Object.keys(summary).sort()).toEqual(["id", "title", "updatedAt"]);
  });
});

describe("deleteConversation", () => {
  it("forgets one Conversation and leaves the others", async () => {
    await writeConversation(factory, conversation({ id: "keep", updatedAt: 2 }));
    await writeConversation(factory, conversation({ id: "drop", updatedAt: 1 }));

    await deleteConversation(factory, "drop");

    expect((await listConversations(factory)).map((c) => c.id)).toEqual(["keep"]);
  });

  it("is not an error to delete one that is not there", async () => {
    // The reader can press Delete twice, and a second press should not leave a
    // failed state behind in the interface.
    await expect(deleteConversation(factory, "missing")).resolves.toBeUndefined();
  });
});

describe("deleteEveryConversation", () => {
  it("forgets them all", async () => {
    await writeConversation(factory, conversation({ id: "a" }));
    await writeConversation(factory, conversation({ id: "b" }));

    await deleteEveryConversation(factory);

    expect(await listConversations(factory)).toEqual([]);
  });
});

/**
 * Puts a record straight into the store, bypassing the typed API.
 *
 * Needed because the point is to write what the typed API refuses to write — a
 * record left by an older build, or edited by hand.
 */
async function plant(factory: IDBFactory, record: Record<string, unknown>): Promise<void> {
  // A write of any kind opens the database first, so the store exists — on an
  // empty factory there would otherwise be nothing to plant into.
  await writeConversation(factory, conversation({ id: "seed" }));

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("multi-endpoint-chat", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("conversations", "readwrite");
    tx.objectStore("conversations").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();

  // The seed existed only to create the store, so it is removed before the
  // assertions rather than being left for each test to account for.
  await deleteConversation(factory, "seed");
}

/**
 * Everything the database holds, read straight off the object store.
 *
 * The typed API is what most of these tests read through, because what a reader
 * can see is what those return. This one cannot: "there is no second copy of the
 * file's contents anywhere" is a claim about every record rather than about the
 * one Conversation under test, and no caller of this module is given a way to
 * check it. The same direct opening `plant` uses, read rather than written.
 */
async function everyRecord(factory: IDBFactory): Promise<unknown[]> {
  await writeConversation(factory, conversation({ id: "seed" }));

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("multi-endpoint-chat", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const records = await new Promise<unknown[]>((resolve, reject) => {
    const request = db
      .transaction("conversations", "readonly")
      .objectStore("conversations")
      .getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error);
  });

  db.close();
  await deleteConversation(factory, "seed");
  return records;
}

describe("a Conversation written before it could read files", () => {
  // Every Conversation already on a reader's machine was written by a build
  // that had never heard of a Tool Call, so all of them are this shape. They
  // are not fixtures — they are what the reader actually has — and a store that
  // grew a guard around the new parts would quietly lose them.
  const BEFORE = {
    id: "before-tools",
    title: "Why is the build red?",
    updatedAt: 1,
    messages: [
      { id: "m1", role: "user", parts: [{ type: "text", text: "Why is the build red?" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "A lint rule." }] },
    ],
  };

  it("still opens, and still lists", async () => {
    await plant(factory, BEFORE);

    expect((await listConversations(factory)).map((c) => c.id)).toEqual(["before-tools"]);
    expect((await readConversation(factory, "before-tools"))?.messages).toEqual(BEFORE.messages);
  });

  it("is still a history the Endpoint will take", async () => {
    await plant(factory, BEFORE);

    const stored = await readConversation(factory, "before-tools");

    expect(await rejectionFor(stored!.messages)).toBeNull();
  });
});

describe("a Conversation holding file contents", () => {
  /** A read of the size the Tools will answer with at most. */
  function largestRead() {
    // Capped by lines and by bytes, and the byte ceiling decides how wide each
    // line is. Taken from the Tools rather than made up here, so this test moves
    // with them if either ceiling does.
    const width = Math.ceil(MAX_FILE_BYTES / MAX_READ_LINES);
    const lines = Array.from(
      { length: MAX_READ_LINES },
      (_, index) => `${index + 1}: ${"a".repeat(width)}`,
    );

    return {
      type: "tool-read_file" as const,
      toolCallId: "call_1",
      state: "output-available" as const,
      input: { path: "src/big.log" },
      output: {
        ok: true,
        path: "src/big.log",
        startLine: 1,
        totalLines: MAX_READ_LINES,
        lines,
        continuesAtLine: null,
        note: `${MAX_READ_LINES} lines. This is the whole file.`,
      },
    };
  }

  /** A Conversation whose only Turn is the biggest read there is. */
  function holdingTheBiggestRead(): SavedConversation {
    return conversation({
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "what is in big.log?" }] },
        { id: "m2", role: "assistant", parts: [largestRead()] },
      ],
    });
  }

  it("round-trips the whole of the biggest read the Tools will answer with", async () => {
    // The ceiling here is the Tools', not the store's. One megabyte is well
    // inside what a browser database takes, and a second and smaller ceiling in
    // the store would be a limit nothing had asked for — a Conversation that
    // silently lost the end of a file it had already read.
    const read = largestRead();
    await writeConversation(factory, holdingTheBiggestRead());

    const stored = await readConversation(factory, "c1");

    expect(stored?.messages[1].parts[0]).toEqual(read);
  });

  it("leaves the Conversation one the Endpoint will take", async () => {
    await writeConversation(factory, holdingTheBiggestRead());

    const stored = await readConversation(factory, "c1");

    expect(await rejectionFor(stored!.messages)).toBeNull();
  });

  it("goes when the Conversation holding it is deleted", async () => {
    await writeConversation(factory, holdingTheBiggestRead());
    await writeConversation(factory, conversation({ id: "other", updatedAt: 2 }));

    await deleteConversation(factory, "c1");

    // Read across every record rather than through the read of one id: a store
    // that kept the contents anywhere at all — beside the Conversation, in a
    // second store, in a summary — would leave behind exactly the file the
    // reader deleted a Conversation in order to be rid of.
    expect(JSON.stringify(await everyRecord(factory))).not.toContain("big.log");
    expect((await listConversations(factory)).map((c) => c.id)).toEqual(["other"]);
  });
});

describe("records that no longer match", () => {
  it("skips a record whose shape is not a Conversation", async () => {
    // Storage survives across versions and can be edited by hand, so a record
    // written by a future build — or a half-written one — is a thing that will
    // genuinely be there rather than a theoretical concern. The intact
    // Conversations still list.
    await writeConversation(factory, conversation({ id: "intact", updatedAt: 2 }));
    await writeConversation(factory, conversation({ id: "also-intact", updatedAt: 1 }));

    // Two records, corrupt in different fields, so each guard in the check is
    // what catches one of them rather than the name alone doing the work.
    await plant(factory, { id: "bad-title", title: 42 });
    await plant(factory, { id: "bad-turns", title: "Fine", updatedAt: 1 });

    expect((await listConversations(factory)).map((c) => c.id)).toEqual(["intact", "also-intact"]);
  });

  it("refuses a Conversation whose Turns are not a list", async () => {
    // The other half of the check above: a usable name and no usable Turns would
    // render as a row that opens onto an empty chat.
    await plant(factory, { id: "no-turns", title: "Fine", updatedAt: 1 });

    expect(await listConversations(factory)).toEqual([]);
  });

  it("refuses a Conversation with no usable timestamp", async () => {
    // Ordering is by recency, so a record that cannot be ordered has nowhere to
    // go in the list even if everything else about it parses.
    await plant(factory, { id: "no-time", title: "Fine", messages: [], updatedAt: "yesterday" });

    expect(await listConversations(factory)).toEqual([]);
  });

  it("answers null for a corrupt record rather than returning it", async () => {
    // The same guard on the reading path: `open` would otherwise hand the chat a
    // Conversation with no Turns in it and no way to tell it is unusable.
    await plant(factory, { id: "bad", title: "Fine", updatedAt: 1 });

    expect(await readConversation(factory, "bad")).toBeNull();
  });

  it("refuses to open a database the browser will not give us", async () => {
    const blocked = {
      open: () => {
        const request: Record<string, unknown> = { error: new Error("denied") };
        queueMicrotask(() => (request.onerror as () => void)());
        return request;
      },
    } as unknown as IDBFactory;

    await expect(listConversations(blocked)).rejects.toBeInstanceOf(Error);
  });
});

describe("ConversationStoreUnavailable", () => {
  it("names the reason rather than the mechanism", () => {
    // The reader is told storage is unavailable, not handed an IDBException
    // they have no context to act on.
    expect(new ConversationStoreUnavailable().message).toBe(
      "This browser will not open the Conversations database.",
    );
  });
});
