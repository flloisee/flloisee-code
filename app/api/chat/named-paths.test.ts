import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST, maxDuration } from "@/app/api/chat/route";
import { findEndpoint } from "@/lib/endpoints/registry";
import { decide, takeDecisions } from "@/lib/roots/named-decision";
import {
  declareRoot,
  forgetRoot,
  grantPath,
} from "@/lib/roots/reading-root";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";
import { MAX_FILE_BYTES } from "@/lib/tools/file-tools";

/**
 * A path the reader named in a message, seen where it is checked a second time.
 *
 * The composer asks before the Turn exists; this is the other half — the check at
 * send, on the server, against the Root as it is *now*. A real stub Endpoint
 * receives what the app sends, so "the file's contents went into the message" is
 * an assertion about the bytes on the wire rather than about a return value, and
 * "the file's contents went nowhere" is an assertion about every request the stub
 * was sent.
 *
 * Nothing in the model layer is mocked. The point of the ticket is that what
 * reaches the Endpoint was decided by this server, so a test that stubbed the
 * Endpoint would only be asserting that the app called itself.
 */

const OLLAMA_BASE_URL = "http://localhost:11434/v1";

let stubURL = "";
/** Every request body the stub Endpoint was sent, in order. */
let seen: Record<string, unknown>[] = [];

function chunk(res: ServerResponse, delta: object, finishReason: string | null) {
  res.write(
    `data: ${JSON.stringify({
      id: "1",
      object: "chat.completion.chunk",
      created: 0,
      model: "stub",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`,
  );
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (piece) => (body += piece));
  req.on("end", () => {
    seen.push(JSON.parse(body) as Record<string, unknown>);
    res.writeHead(200, { "content-type": "text/event-stream" });
    chunk(res, { content: "here is the answer" }, "stop");
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        stubURL = `http://127.0.0.1:${port}/v1`;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const project: TemporaryProject = await temporaryProject("chat-named-paths-");

/** A line that is on disk and nowhere else, so finding it in a request is proof. */
const IN_THE_ROOT = "the line inside the folder the reader chose";
const OUTSIDE = "the line beyond every boundary";

let inRoot = "";
let elsewhere = "";

beforeEach(async () => {
  await project.begin();
  await mkdir(path.join(project.dir, "project", "src"), { recursive: true });
  await mkdir(path.join(project.dir, "elsewhere"), { recursive: true });

  // Resolved, because that is the form every later check is made against: on macOS
  // a temporary directory under `/var` and the same directory under `/private/var`
  // are different strings, and an expectation written against the unresolved one
  // would be asserting a path the app never answers with.
  inRoot = await realpath(path.join(project.dir, "project"));
  elsewhere = await realpath(path.join(project.dir, "elsewhere"));

  await writeFile(path.join(inRoot, "src", "notes.md"), `${IN_THE_ROOT}\n`, "utf8");
  await writeFile(path.join(inRoot, "src", "index.ts"), "export const start = 1;\n", "utf8");
  await writeFile(path.join(elsewhere, "plan.md"), `${OUTSIDE}\n`, "utf8");

  // Real bytes rather than text, so a pasted image is refused exactly as a read
  // image is — the same refusal, because it is the same read.
  await mkdir(path.join(inRoot, "assets"), { recursive: true });
  await writeFile(
    path.join(inRoot, "assets", "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03, 0x00, 0x00]),
  );

  findEndpoint("ollama")!.baseURL = stubURL;
  seen = [];
});

afterEach(async () => {
  findEndpoint("ollama")!.baseURL = OLLAMA_BASE_URL;
  takeDecisions();
  await project.end();
});

async function declareSharedFolder(): Promise<void> {
  await declareRoot({ dir: project.dir, root: inRoot });
}

function say(text: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        endpointId: "ollama",
        modelId: "llama3.2",
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
      }),
    }),
  );
}

/**
 * Reads a Turn to its end, so the Endpoint has certainly been asked.
 *
 * The generation starts when the response body is read rather than when the
 * Response is handed over, so a test that asserted straight afterwards would be
 * asserting about a request that had not been made yet. A fresh Response over the
 * bytes that were read, because a body can only be read once and a refused Turn's
 * error is in it.
 */
async function drain(response: Response): Promise<Response> {
  const body = await response.text();
  return new Response(body, { status: response.status, headers: response.headers });
}

/** Everything the Endpoint was sent, as one string, for "did it get out at all". */
function reached(): string {
  return JSON.stringify(seen);
}

/** What the Endpoint was sent on the first request — the one Turn under test. */
function sentText(): string {
  return JSON.stringify((seen[0]?.messages ?? []) as unknown);
}

/** The error a refused Turn carries, which is what the reader is shown. */
async function refusalOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const INSIDE = "a path inside the folder the reader chose";

describe(INSIDE, () => {
  it("goes with the message, as text in a block that says which file it came from", async () => {
    await declareSharedFolder();

    const response = await drain(await say("what does src/notes.md say?"));

    // The delimiter is the whole of the format. A file part would need a Model
    // that accepts one, and most of the Endpoints this app talks to do not.
    expect(response.status).toBe(200);
    expect(sentText()).toContain("[file: src/notes.md]");
    expect(sentText()).toContain(IN_THE_ROOT);
  });

  it("leaves the reader's own words where they were, and adds the file beside them", async () => {
    await declareSharedFolder();

    await drain(await say("what does src/notes.md say?"));

    // The bubble the reader sees is theirs and is not rewritten by what was sent;
    // only the copy the Endpoint receives carries the file.
    expect(sentText()).toContain("what does src/notes.md say?");
  });

  it("is named as the reader named it rather than from the disk, so the Root stays out of the Conversation", async () => {
    await declareSharedFolder();

    await drain(await say("look at src/notes.md"));

    expect(sentText()).toContain("[file: src/notes.md]");
    expect(reached()).not.toContain(inRoot);
  });

  it("numbers its lines, so the Model can cite one the reader can find", async () => {
    await declareSharedFolder();

    await drain(await say("look at src/notes.md"));

    // The same numbering `read_file` produces, because it is the same read.
    expect(sentText()).toContain(`1: ${IN_THE_ROOT}`);
  });

  it("goes with a message naming several files, each in its own block", async () => {
    await declareSharedFolder();

    const response = await drain(await say("compare src/notes.md with src/index.ts"));

    expect(response.status).toBe(200);
    expect(sentText()).toContain("[file: src/notes.md]");
    expect(sentText()).toContain("[file: src/index.ts]");
    expect(sentText()).toContain(IN_THE_ROOT);
    expect(sentText()).toContain("export const start = 1;");
  });

  it("sends a folder's listing rather than its contents, because a folder has none", async () => {
    await declareSharedFolder();

    await drain(await say("what is in ./src"));

    // A folder named in a message is a question about what is in it, and reading
    // every file under it would have no ceiling at all. The name in the block is
    // the one the Tools use — `src`, not `./src` — so the Model is handed a name it
    // can ask about rather than a second spelling of the same folder.
    expect(sentText()).toContain("[file: src]");
    expect(sentText()).toContain("index.ts");
    expect(sentText()).toContain("notes.md");
    expect(sentText()).not.toContain(IN_THE_ROOT);
  });

  it("is not looked for at all on a machine with no folder chosen, so the Turn is the one it was before", async () => {
    await declareSharedFolder();
    await drain(await say("what does src/notes.md say?"));
    const withRoot = sentText();

    await forgetRoot({ dir: project.dir });
    seen = [];
    const response = await drain(await say("what does src/notes.md say?"));

    // With no Root there are no boundaries, so there is nothing the reader's path
    // crosses and nothing to refuse: the app cannot read files, which is exactly
    // the state it was in before this feature, and a message is a message.
    expect(response.status).toBe(200);
    expect(withRoot).toContain(IN_THE_ROOT);
    expect(sentText()).not.toContain(IN_THE_ROOT);
    expect(sentText()).not.toContain("[file:");
  });
});

const THE_ASK = "a path beyond the folder the reader chose";

describe(THE_ASK, () => {
  it("is refused at send, naming the file, rather than arriving with its contents missing", async () => {
    await declareSharedFolder();

    // Nothing was ever allowed, and this is the one moment the reader's silence is
    // a decision rather than an oversight — so the Turn stops and says so.
    const response = await drain(await say("compare ../elsewhere/plan.md with src/notes.md"));

    expect(response.status).toBe(400);
    expect(await refusalOf(response)).toMatchObject({
      error: expect.stringContaining("../elsewhere/plan.md"),
    });
    // The whole Turn, not just the file: a message sent with a file silently
    // missing reads to the Model as a complete answer about the wrong files.
    expect(seen).toHaveLength(0);
  });

  it("reaches the Model once the reader allowed it, which is what the answer was for", async () => {
    await declareSharedFolder();
    decide("../elsewhere/plan.md", "allowed");

    const response = await drain(await say("compare ../elsewhere/plan.md with src/notes.md"));

    // The block names the file the way the Tools name one — and a path beyond the
    // Root has no shorter honest name, so the reader reads back the path they wrote.
    expect(response.status).toBe(200);
    expect(sentText()).toContain(`[file: ${path.join(elsewhere, "plan.md")}]`);
    expect(sentText()).toContain(OUTSIDE);
  });

  it("is refused again on the next message, because an answer about one send is not a Grant", async () => {
    await declareSharedFolder();
    decide("../elsewhere/plan.md", "allowed");
    await drain(await say("compare ../elsewhere/plan.md with src/notes.md"));

    seen = [];
    const second = await drain(await say("and again ../elsewhere/plan.md"));

    // "Allow once" and "always allow" are two buttons because they are two
    // decisions, and a Turn that quietly kept the first would be the second wearing
    // the first one's label.
    expect(second.status).toBe(400);
    expect(await refusalOf(second)).toMatchObject({ error: expect.stringContaining("plan.md") });
  });

  it("goes without the file when the reader refused it, and says in the message that it was left out", async () => {
    await declareSharedFolder();
    decide("../elsewhere/plan.md", "denied");

    const response = await drain(await say("compare ../elsewhere/plan.md with src/notes.md"));

    // Refusing one thing must not end the Turn: the reader still has a question and
    // the Model still has everything else the message named.
    expect(response.status).toBe(200);
    expect(sentText()).not.toContain(OUTSIDE);
    // Named as the reader wrote it, because nothing was opened: the canonical name
    // the Tools use comes from the disk, and asking the disk is what was refused.
    expect(sentText()).toContain("[file: ../elsewhere/plan.md]");
    expect(sentText()).toContain("did not allow");
    // The file the Root does cover still went, so refusing one is not refusing all.
    expect(sentText()).toContain(IN_THE_ROOT);
  });

  it("goes through a Grant without an answer at all, because a Grant is the same decision said twice", async () => {
    await declareSharedFolder();
    await grantPath({ dir: project.dir, path: elsewhere });

    const response = await drain(await say("compare ../elsewhere/plan.md with src/notes.md"));

    expect(response.status).toBe(200);
    expect(sentText()).toContain(OUTSIDE);
  });
});

const BETWEEN = "what changed between naming a file and sending the message";

describe(BETWEEN, () => {
  it("is refused when the file has been deleted, naming it", async () => {
    await declareSharedFolder();
    await rm(path.join(inRoot, "src", "notes.md"));

    const response = await drain(await say("what does src/notes.md say?"));

    // The reader named a file that was there. Sending the message without it would
    // hand the Model a Turn about a file it cannot see, with nothing saying why.
    expect(response.status).toBe(400);
    expect(await refusalOf(response)).toMatchObject({
      error: expect.stringContaining("src/notes.md"),
    });
    expect(seen).toHaveLength(0);
  });

  it("is refused when the Root has moved to somewhere else, naming the file that fell outside it", async () => {
    await declareSharedFolder();
    await declareRoot({ dir: project.dir, root: elsewhere });

    const response = await drain(await say("compare ../elsewhere/plan.md with src/notes.md"));

    // The answer the reader gave was about a boundary that no longer exists, so it
    // is asked again rather than carried across a folder they did not choose. The
    // file named is the one that fell out, not the one that fell in.
    expect(response.status).toBe(400);
    expect(await refusalOf(response)).toMatchObject({
      error: expect.stringContaining("src/notes.md"),
    });
    expect(seen).toHaveLength(0);
  });

  it("is refused when the folder the reader chose is gone, naming the file", async () => {
    await declareSharedFolder();
    await rm(inRoot, { recursive: true });

    const response = await drain(await say("what does src/notes.md say?"));

    expect(response.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("reads nothing before it refuses, so a refusal cannot leak the file it is about", async () => {
    await declareSharedFolder();
    decide("../elsewhere/plan.md", "allowed");
    decide("src/notes.md", "allowed");
    await rm(path.join(inRoot, "src", "notes.md"));

    const response = await drain(await say("look at src/notes.md"));

    expect(response.status).toBe(400);
    expect(reached()).not.toContain(IN_THE_ROOT);
  });
});

const UNREADABLE = "a file that cannot be sent as text";

describe(UNREADABLE, () => {
  it("is reported in the message rather than sent as an empty block", async () => {
    await declareSharedFolder();

    const response = await drain(await say("what is in assets/logo.png"));

    // Binary is refused exactly as a read of the same file refuses it, and it is
    // refused *in the message*: the Model has to be able to say why it cannot see
    // a file the reader believes they attached.
    expect(response.status).toBe(200);
    expect(sentText()).toContain("[file: assets/logo.png]");
    expect(sentText()).toContain("not text");
  });

  it("is reported in the message when the file is past the cap, rather than sent in part", async () => {
    await declareSharedFolder();
    await writeFile(path.join(inRoot, "huge.txt"), "x".repeat(MAX_FILE_BYTES + 1), "utf8");

    const response = await drain(await say("look at huge.txt"));

    // The same cap the Tools refuse at, and the same sentence: one ceiling for the
    // whole feature, so a file that is too big is too big however the reader named it.
    expect(response.status).toBe(200);
    expect(sentText()).toContain("[file: huge.txt]");
    expect(sentText()).toContain(String(MAX_FILE_BYTES + 1));
  });

  it("closes every block it opens, so one file's contents cannot run into the next", async () => {
    await declareSharedFolder();

    await drain(await say("look at src/notes.md, src/index.ts and assets/logo.png"));

    const sent = sentText();
    // The Model reads these as text and has no parser to fall back on: the block
    // that says which file is over is the only thing marking where it ends.
    expect(sent.split("[file: ").length - 1).toBe(3);
    expect(sent.split("[end of file: ").length - 1).toBe(3);
  });
});

const NOT_NAMED = "a message that names no file";

describe(NOT_NAMED, () => {
  it("is sent exactly as the reader wrote it", async () => {
    await declareSharedFolder();

    await drain(await say("and/or is not a path, and neither is e.g. or 3/4 or me@example.com"));

    // The recogniser is the same function the composer used, and an ordinary
    // sentence that happens to hold a slash is still an ordinary sentence.
    expect(sentText()).not.toContain("[file:");
    expect(sentText()).toContain("and/or");
  });

  it("is unaffected by an answer about a file it does not name", async () => {
    await declareSharedFolder();
    decide("../elsewhere/plan.md", "allowed");

    const response = await drain(await say("just a question"));

    // The answer was for one message and this is that message, so it is spent. It
    // cannot then be there for the next one, which is what "once" has to mean.
    expect(response.status).toBe(200);
    expect(sentText()).not.toContain(OUTSIDE);
  });
});

describe("the ceiling on a Turn", () => {
  it("still covers a Turn that also carries a file", () => {
    // Reading a named file is disk the app does itself, inside a Turn that also
    // makes up to eight requests to the Endpoint. The ceiling is about the second.
    expect(maxDuration).toBeGreaterThanOrEqual(300);
  });
});