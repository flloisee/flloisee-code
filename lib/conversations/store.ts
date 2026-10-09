import type { UIMessage } from "ai";

/**
 * Conversations on disk, in the browser's own storage.
 *
 * IndexedDB rather than `localStorage` for three reasons that all point the
 * same way: a Conversation is a list of Turns that grows past the ~5MB string
 * budget `localStorage` sets, storing it needs no synchronous parsing on the
 * path to first paint, and the API is transactional, so a half-written
 * Conversation is a state that cannot be observed.
 *
 * Nothing here reaches the server. Every request the app makes is Proxied, and
 * a saved Conversation is not a request — it is the reader's own text, kept in
 * the reader's own browser, where the reader can clear it by deleting this
 * site's data like any other. That is why there is no API route here: there is
 * no one else to sync to, and a Credential never enters any of it.
 *
 * Storage is untrusted on the way back in, exactly as in `readTheme`: it
 * survives across versions of the app and can be edited by hand, so a record
 * that no longer parses is dropped rather than crashing the list, and the
 * reader is handed the conversations that are intact.
 */

const DB_NAME = "multi-endpoint-chat";
const DB_VERSION = 1;
const STORE = "conversations";

/** One saved Conversation. */
export type SavedConversation = {
  /** Stable identity, and the key the store is written under. */
  id: string;
  /** The name shown in the list. Derived once from the opening message. */
  title: string;
  /** Every Turn, oldest first. */
  messages: UIMessage[];
  /** Milliseconds since the epoch; the list is ordered by this, newest first. */
  updatedAt: number;
};

/** What the list needs, without the Turns. Kept apart so the list stays cheap. */
export type ConversationSummary = Pick<SavedConversation, "id" | "title" | "updatedAt">;

/** Raised when the browser will not give us a database at all. */
export class ConversationStoreUnavailable extends Error {
  constructor() {
    super("This browser will not open the Conversations database.");
    this.name = "ConversationStoreUnavailable";
  }
}

/** Narrows a value read back out of storage to a SavedConversation. */
function isSaved(value: unknown): value is SavedConversation {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt) &&
    Array.isArray(record.messages)
  );
}

/**
 * Resolves a `IDBRequest`, so the request API can be awaited rather than
 * threaded through event handlers at every call site.
 *
 * The failure is taken off `request.error` rather than `reject`ed with it
 * directly: an IndexedDB error carries a DOMException that says little about
 * which Conversation failed, and the callers here all treat a failure the same
 * way — carry on without the Conversation — so the message matters less than
 * the fact that it did not throw somewhere unexpected.
 */
function fromRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Opens the database, creating the store and its ordering index on first use.
 *
 * The upgrade handler is written to be idempotent about the index because a
 * browser may replay it for a store it believes is new; checking before
 * creating is cheaper than the `ConstraintError` from doing it twice.
 */
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) return;

      const store = db.createObjectStore(STORE, { keyPath: "id" });
      // The list is ordered by recency, and an index is what lets that order
      // come from the database rather than from sorting every record in memory.
      store.createIndex("updatedAt", "updatedAt");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new ConversationStoreUnavailable());
    request.onblocked = () => reject(new ConversationStoreUnavailable());
  });
}

/**
 * Runs `work` against the store in a transaction, committing when it resolves.
 *
 * One transaction per operation, so a failure part-way through leaves the
 * Conversations already stored untouched rather than half of a batch applied.
 */
async function inTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const transaction = db.transaction(STORE, mode);

  try {
    const result = await work(transaction.objectStore(STORE));
    // Resolving before the transaction commits would report a write as done
    // while it could still be rolled back, so the commit is awaited here.
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
}

/**
 * Every saved Conversation, newest first.
 *
 * Turns are not read: the list only names Conversations, and loading every
 * message of every one of them to draw a column of titles would make opening
 * the app slower the more the reader had used it.
 */
export async function listConversations(
  factory: IDBFactory,
): Promise<ConversationSummary[]> {
  const db = await openDatabase(factory);

  try {
    const records = await inTransaction(db, "readonly", (store) =>
      fromRequest(store.getAll() as IDBRequest<unknown[]>),
    );

    return records
      .filter(isSaved)
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

/** One saved Conversation with its Turns, or `null` when it is not there. */
export async function readConversation(
  factory: IDBFactory,
  id: string,
): Promise<SavedConversation | null> {
  const db = await openDatabase(factory);

  try {
    const record = await inTransaction(db, "readonly", (store) =>
      fromRequest(store.get(id) as IDBRequest<unknown>),
    );

    return isSaved(record) ? record : null;
  } finally {
    db.close();
  }
}

/** Writes a Conversation, replacing whatever was stored under its id. */
export async function writeConversation(
  factory: IDBFactory,
  conversation: SavedConversation,
): Promise<void> {
  const db = await openDatabase(factory);

  await inTransaction(db, "readwrite", (store) => {
    store.put(conversation);
  });
}

/** Forgets one Conversation. Deleting one that is not there is not an error. */
export async function deleteConversation(factory: IDBFactory, id: string): Promise<void> {
  const db = await openDatabase(factory);

  await inTransaction(db, "readwrite", (store) => {
    store.delete(id);
  });
}

/** Forgets every Conversation. Offered so the reader can clear what is stored. */
export async function deleteEveryConversation(factory: IDBFactory): Promise<void> {
  const db = await openDatabase(factory);

  await inTransaction(db, "readwrite", (store) => {
    store.clear();
  });
}

/** The browser's database, or `null` where there is none (a server render). */
export function browserFactory(): IDBFactory | null {
  if (typeof indexedDB === "undefined") return null;
  return indexedDB;
}
