import { promises as fs } from "node:fs";
import path from "node:path";

import { writeAtomically, type TempFileWriter } from "@/lib/atomic-write";
import { ENV_FILE, canBeStoredVerbatim, saveAndReloadEnvValue } from "@/lib/env";
import type { DeclaredEndpoint } from "./types";

/**
 * Endpoints the reader declares through the interface, held in a file of the
 * app's own.
 *
 * This is the feature that inverts one of the app's standing rules, so the rule
 * and its replacement are both worth stating plainly.
 *
 * **The old rule.** `resolveEndpoint` takes its base URL from the Endpoint and
 * never from a request, and `POST /api/keys` refuses any body carrying a field
 * besides a declared variable name and a Credential. The reason is in
 * `app/api/chat/route.ts`: the browser resends the whole history each Turn and
 * can post anything to these routes, so a caller-supplied address next to a
 * caller-supplied Credential would be a way to collect a *known provider's* key
 * at an address of the caller's choosing. The Catalog is source-controlled
 * precisely because it decides where Credentials are sent.
 *
 * **What replaces it.** A declared Endpoint's address is still never taken from
 * a request at the point a Credential is used — it is read from this file, by
 * the server, at the moment a Request is proxied. The caller who declares an
 * Endpoint names an address *and* supplies the Credential that will be sent
 * there, on their own machine, through a route that answers 404 outside
 * development. So the thing the old rule protected — someone else's Catalog
 * Credential being redirected — is still unreachable: those addresses are still
 * fixed in source and no route writes to them.
 *
 * **What is given up, stated rather than glossed.** Inside development, a caller
 * who can reach these routes can make the server issue an outbound HTTP request
 * to any address they name. That is a weaker primitive than the one above, and
 * it is not nothing: the Credential travelling with it is one the caller just
 * typed, so there is no existing secret to steal. The mitigation is the same one
 * `/api/keys` and `/api/roots` already rely on — these routes exist in
 * development and not otherwise — and the reader is a single person on their own
 * machine.
 *
 * **Where the Credential goes.** Not in this file. A declared Endpoint's
 * Credential is written to `.env.local` under a name derived from its id, by the
 * same `saveAndReloadEnvValue` that is already the only writer of one. This file
 * is therefore safe to be readable and is kept out of source control for the
 * ordinary reason: an address and a name say something about the reader's
 * network that is nobody else's business.
 */

/** The file the reader's own Endpoints are held in. */
export const ENDPOINTS_FILE = ".endpoints.json";

/**
 * The temporary file's name. Not `.env*`, which Next watches — a name it watches
 * would fire its own reload in the middle of this write.
 */
const tempName = `.endpoints-${process.pid}.tmp`;

/**
 * What the file says.
 *
 * `malformed` is kept rather than folded into "no Endpoints", for the reason
 * `readReadingRoot` keeps it: an Endpoint the reader declared and cannot see
 * again should say the file is there and could not be understood, rather than
 * silently not existing.
 */
export type DeclaredEndpoints = {
  endpoints: readonly DeclaredEndpoint[];
  malformed: boolean;
};

const NONE: DeclaredEndpoints = { endpoints: [], malformed: false };

/**
 * Ids the Registry already holds, which a declared Endpoint may not take.
 *
 * Passed in rather than imported: this module is about the file, and reaching
 * into the Registry from here would make the two circular — the Registry reads
 * declared Endpoints to answer a lookup, and would then be read to validate one.
 */
export type ReservedIds = ReadonlySet<string>;

/** How long a generated id may be, so one cannot be a paragraph. */
const MAX_ID_LENGTH = 48;

/**
 * The id a name produces.
 *
 * A slug rather than a hash, because the id is shown to the reader in a
 * `<select>`, carried in localStorage, and used to derive the variable a
 * Credential is written under — all of which a reader may want to recognise and
 * type. A hash would make every one of those unreadable and unreproducible.
 *
 * Empty for a name with nothing slug-worthy in it ("..." , "!!"), which the
 * caller reports rather than inventing an id for.
 */
export function slugFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * The variable a declared Endpoint's Credential is written under.
 *
 * Derived from the id rather than chosen by the reader, and namespaced under
 * `CUSTOM_` so it cannot collide with a Catalog variable — which is the failure
 * the spec records having already happened once, when eight Catalog entries
 * shared variable names and one typed key was proxied to several hosts. A name
 * that could collide is a name that could do that again.
 */
export function credentialVarFor(id: string): string {
  return `CUSTOM_${id.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

/**
 * Checks a base URL, and normalises it.
 *
 * **This is where the guardrail the Catalog's source control used to provide is
 * actually applied**, because until now the addresses have been reviewed in
 * source and now one is not. Four things are refused:
 *
 * - Anything that is not `http:` or `https:`. `file:` and `ftp:` would have the
 *   server read or fetch outside the HTTP contract the SDK speaks, and the
 *   Proxying glossary entry says every Request is an HTTP one.
 * - A URL carrying `user:password@`. Those characters would be written into a
 *   Credential and into every failure message this app renders, which is the
 *   wrong place for a secret.
 * - A URL with no host, which cannot be reached and which would otherwise fail
 *   later as an obscure generation error rather than at the point of entry.
 * - A trailing slash beyond the path, which is normalised away so two Endpoints
 *   typed the same way are the same string and Discovery builds the same URL.
 */
export function normaliseBaseURL(raw: string): { ok: true; baseURL: string } | { ok: false; error: string } {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "A base URL is needed, such as http://localhost:11434/v1" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error:
        `"${trimmed}" is not a URL this app can reach. It needs the whole address, ` +
        "including the scheme and the port, such as http://localhost:11434/v1",
    };
  }

  // `new URL` accepts almost anything with a colon in it, so a reader who typed
  // `localhost:8000` gets back a URL whose *protocol* is `localhost:`. That
  // would be refused by the check below, but as the wrong message — telling
  // someone their scheme is invalid when what they left out is the scheme. So
  // the missing scheme is caught as itself, first, and named as what it is.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return {
      ok: false,
      error:
        `"${trimmed}" is missing the scheme, so the app would not know how to reach it. ` +
        "It needs the whole address, including the scheme and the port, such as " +
        "http://localhost:11434/v1",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `This app only speaks to an Endpoint over http or https, and "${trimmed}" is ${parsed.protocol}`,
    };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return {
      ok: false,
      error:
        "A base URL cannot carry a username and password. Enter the Credential in the " +
        "field below, and it is written to this machine's environment file rather than " +
        "into a URL that would appear in error messages.",
    };
  }

  if (parsed.hostname === "") {
    return { ok: false, error: `"${trimmed}" has no host in it, so there is nowhere to send a Request.` };
  }

  // `origin` drops the credentials by construction, so this cannot reintroduce
  // what the check above just refused, and it keeps the path the reader typed.
  const withoutTrailingSlash = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");

  return { ok: true, baseURL: withoutTrailingSlash };
}

/**
 * A declared Endpoint as read back out of the file.
 *
 * Checked field by field rather than cast, for the same reason `readReadingRoot`
 * checks: the file is editable by hand, and an Endpoint that half-parsed would
 * be one the Registry offers and cannot reach.
 */
function isDeclaredEndpoint(value: unknown): value is DeclaredEndpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const entry = value as Record<string, unknown>;

  if (typeof entry.id !== "string" || entry.id.length === 0) return false;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0) return false;
  if (typeof entry.baseURL !== "string" || entry.baseURL.length === 0) return false;
  if (typeof entry.defaultModelId !== "string" || entry.defaultModelId.length === 0) return false;
  if (!Array.isArray(entry.knownModels) || entry.knownModels.length === 0) return false;
  if (!entry.knownModels.every((model) => typeof model === "string" && model.trim().length > 0)) {
    return false;
  }

  // Absent or a string and nothing else: a Credential variable that is a number
  // would be read as absent by `resolveEndpoint` and Configured-ness would depend
  // on which side of that coercion the value fell.
  if (entry.credentialEnvVar !== undefined && typeof entry.credentialEnvVar !== "string") return false;

  // The address is checked here as well as on the way in, and that is the whole
  // point of this being a check rather than a tidy-up.
  //
  // Every other validation in this app rests on the Catalog being reviewed as
  // code, and this file is the one input that is not. A hand-edited
  // `.endpoints.json` holding `file:///...` or a URL with a password in it would
  // otherwise reach `resolveEndpoint` having passed no check at all — the
  // dialog's checks apply to what the dialog wrote, and nothing stops anyone
  // writing the file by hand. So the entry point is checked here too, and an
  // address that could not have been declared is an address that is not used.
  if (!normaliseBaseURL(entry.baseURL).ok) return false;

  // A variable name this app would never have derived, refused for the same
  // reason: it names where a Credential is read from, and one from a hand-edited
  // file is an address for one that belongs to something else entirely.
  if (
    entry.credentialEnvVar !== undefined &&
    entry.credentialEnvVar !== credentialVarFor(entry.id)
  ) {
    return false;
  }

  return true;
}

/**
 * The file's contents as declared Endpoints.
 *
 * A first occurrence wins over a later one for the same id, so a hand-edited
 * file carrying a duplicate cannot present two Endpoints under one id and leave
 * which one is in use down to object key order.
 */
function parse(contents: string): DeclaredEndpoints {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    return { endpoints: [], malformed: true };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { endpoints: [], malformed: true };
  }

  const { endpoints } = parsed as { endpoints?: unknown };

  if (endpoints === undefined) return { endpoints: [], malformed: true };
  if (!Array.isArray(endpoints)) return { endpoints: [], malformed: true };

  const seen = new Set<string>();
  const kept: DeclaredEndpoint[] = [];

  for (const entry of endpoints) {
    if (!isDeclaredEndpoint(entry)) return { endpoints: [], malformed: true };
    if (seen.has(entry.id)) continue;

    seen.add(entry.id);
    kept.push({
      id: entry.id,
      name: entry.name.trim(),
      baseURL: entry.baseURL,
      defaultModelId: entry.defaultModelId,
      knownModels: entry.knownModels.map((model) => model.trim()),
      ...(entry.credentialEnvVar !== undefined ? { credentialEnvVar: entry.credentialEnvVar } : {}),
      declared: true,
    });
  }

  return { endpoints: kept, malformed: false };
}

async function readFile(dir: string): Promise<string | "absent" | "unreadable"> {
  try {
    return await fs.readFile(path.join(dir, ENDPOINTS_FILE), "utf8");
  } catch (error) {
    // Only "not there" is the ordinary case — it is what a machine on which no
    // Endpoint has been declared looks like, and the app opens exactly as it did
    // before this feature existed.
    return (error as { code?: string } | null)?.code === "ENOENT" ? "absent" : "unreadable";
  }
}

/**
 * The Endpoints the reader has declared.
 *
 * `reserved` drops any id the Registry already holds, so a hand-edited file
 * cannot shadow OpenAI or Ollama by claiming their id. A shadowed entry is
 * silently the one that loses: the Registry's own Endpoint is in source and
 * reviewed, this one is in a file anyone can edit, and the reader asking for a
 * private server should not be able to change where a Catalog Credential goes
 * by writing a line into a JSON file.
 */
export async function readDeclaredEndpoints(dir: string, reserved: ReservedIds): Promise<DeclaredEndpoints> {
  const contents = await readFile(dir);
  if (contents === "absent") return NONE;
  if (contents === "unreadable") return { endpoints: [], malformed: true };

  const { endpoints, malformed } = parse(contents);

  return { endpoints: endpoints.filter((endpoint) => !reserved.has(endpoint.id)), malformed };
}

/** One writer, so "what this file holds" is one question. */
async function write(dir: string, endpoints: readonly DeclaredEndpoint[], writeTempFile?: TempFileWriter) {
  const contents = `${JSON.stringify({ endpoints }, null, 2)}\n`;

  await writeAtomically({
    target: path.join(dir, ENDPOINTS_FILE),
    contents,
    tempName,
    ...(writeTempFile ? { writeTempFile } : {}),
  });
}

export type DeclareEndpoint = {
  /** The project root: where the file sits. */
  dir: string;
  /** The name the reader gave it. */
  name: string;
  /** The address, unnormalised: it is checked and normalised here. */
  baseURL: string;
  /**
   * The Models the reader says this Endpoint has, in the order they gave them.
   * At least one; the first is the one in use until the reader picks another.
   */
  models: readonly string[];
  /**
   * The Credential, if the reader typed one. Absent means the Endpoint needs
   * none — which is the ordinary case for a server on their own machine, and the
   * reason the field is optional rather than required.
   */
  credential?: string;
  /** Ids the Registry already holds, which this one may not take. */
  reserved: ReservedIds;
  /** Replaces the temporary file's writer, so a test can interrupt the write. */
  writeTempFile?: TempFileWriter;
};

/**
 * What became of the Credential, which is never the Credential.
 *
 * `envVar` is the name it was to be written under even when nothing was: naming
 * it on a failure is what lets the interface say which line is missing rather
 * than only that something went wrong. It is null only in the `notNeeded` case,
 * where there is no name because there was never a Credential.
 */
export type CredentialOutcome =
  | { written: true; envVar: string; applied: boolean; shadowedByShell: boolean }
  | { written: false; envVar: string | null; reason: "notNeeded" | "unusable" | "couldNotWrite" };

export type DeclareOutcome =
  | { ok: true; endpoint: DeclaredEndpoint; credential: CredentialOutcome }
  | { ok: false; error: string };

/**
 * Declares an Endpoint, or replaces the one with this id.
 *
 * **The file is written before the Credential, deliberately.** The other order
 * would leave a Credential in `.env.local` naming an Endpoint that was never
 * written, which is a secret left behind by a save that reported failure. This
 * order's failure mode is the opposite and the better one: the Endpoint exists
 * with no Credential, it says so in the picker, and re-declaring it supplies the
 * Credential. Recoverable by doing the thing again, rather than by going looking
 * through an environment file for a stray key.
 *
 * Replacing rather than refusing when the id is taken is what makes a Credential
 * addable after the fact, which is the case a reader meets when they add a
 * server first and only later find out what key it wants. The Models are
 * replaced with it, since they are part of the same description of the Endpoint.
 */
export async function declareEndpoint(input: DeclareEndpoint): Promise<DeclareOutcome> {
  const name = input.name.trim();

  if (name.length === 0) {
    return { ok: false, error: "Give the Endpoint a name, so it can be told apart from the others." };
  }

  const address = normaliseBaseURL(input.baseURL);
  if (!address.ok) return { ok: false, error: address.error };

  // De-duplicated and trimmed, keeping the reader's order: the first Model is
  // the default, so re-ordering them would quietly change which one is in use.
  const models = [...new Set(input.models.map((model) => model.trim()).filter((model) => model.length > 0))];

  if (models.length === 0) {
    return {
      ok: false,
      error:
        "Name at least one Model this Endpoint serves. Model Discovery can ask it which " +
        "Models it has, but an Endpoint that cannot be asked still needs somewhere to start.",
    };
  }

  const id = slugFor(name);
  if (id.length === 0) {
    return { ok: false, error: `"${name}" has no letters or digits in it to make an id from.` };
  }

  const current = await readDeclaredEndpoints(input.dir, input.reserved);

  // Checked against the Registry and against the file's other entries, and the
  // two are separate questions: one says this name is already taken by something
  // in source, the other says two declared Endpoints would answer to one id.
  if (input.reserved.has(id)) {
    return { ok: false, error: `There is already an Endpoint called "${name}" in this app.` };
  }

  const clashes = current.endpoints.find((endpoint) => endpoint.id === id);
  if (clashes !== undefined && clashes.name !== name) {
    return {
      ok: false,
      error: `Two Endpoints named "${name}" would share the id "${id}". Give this one a different name.`,
    };
  }

  const credential = input.credential?.trim();
  const wantsCredential = credential !== undefined && credential.length > 0;

  // Checked before anything is written, so a Credential that could not survive
  // the environment file is refused rather than stored and looking stored. The
  // file is not written either: an Endpoint declared with a Credential that
  // cannot be kept would show as Configured in name and fail on first use.
  if (wantsCredential && !canBeStoredVerbatim(credential)) {
    return {
      ok: false,
      error:
        "A Credential is written as one line of the environment file, and this one has a " +
        "character that would not survive it: a line break, a quote, or a dollar sign (which " +
        "is read as a reference to another variable). Nothing was written.",
    };
  }

  const endpoint: DeclaredEndpoint = {
    id,
    name,
    baseURL: address.baseURL,
    defaultModelId: models[0],
    knownModels: models,
    ...(wantsCredential ? { credentialEnvVar: credentialVarFor(id) } : {}),
    declared: true,
  };

  const others = current.endpoints.filter((existing) => existing.id !== id);
  // Replacing keeps the Endpoint where the reader left it in the list rather than
  // sending it to the end, which for an edit of a Credential would be a gratuitous
  // change to a list they are looking at.
  const at = current.endpoints.findIndex((existing) => existing.id === id);
  const endpoints = at === -1 ? [...others, endpoint] : [...others.slice(0, at), endpoint, ...others.slice(at)];

  await write(input.dir, endpoints, input.writeTempFile);

  if (!wantsCredential) {
    return { ok: true, endpoint, credential: { written: false, envVar: null, reason: "notNeeded" } };
  }

  const envVar = credentialVarFor(id);

  try {
    const outcome = await saveAndReloadEnvValue({
      name: envVar,
      value: credential,
      dir: input.dir,
    });

    return {
      ok: true,
      endpoint,
      credential: {
        written: true,
        envVar,
        applied: outcome.applied,
        shadowedByShell: outcome.shadowedByShell,
      },
    };
  } catch {
    // The Endpoint is written and the Credential is not, and saying so is the
    // whole answer. The reader can declare it again with the Credential; nothing
    // here is half-done in a way they cannot see.
    return { ok: true, endpoint, credential: { written: false, envVar, reason: "couldNotWrite" } };
  }
}

/**
 * Forgets a declared Endpoint, and the Credential stored for it.
 *
 * Both, because leaving the second would be leaving a secret in
 * `.env.local` naming a server that is no longer configured — and the reader
 * asking to remove the Endpoint should not have to find the key separately.
 *
 * The file is emptied of the Endpoint first and the Credential taken out
 * afterwards, so an interrupted removal leaves an Endpoint with no Credential
 * (which the picker says is unconfigured) rather than a Credential with nothing
 * pointing at it.
 */
export async function forgetEndpoint(input: {
  dir: string;
  id: string;
  reserved: ReservedIds;
  writeTempFile?: TempFileWriter;
}): Promise<void> {
  const current = await readDeclaredEndpoints(input.dir, input.reserved);
  const existing = current.endpoints.find((endpoint) => endpoint.id === input.id);

  if (existing === undefined) return;

  await write(
    input.dir,
    current.endpoints.filter((endpoint) => endpoint.id !== input.id),
    input.writeTempFile,
  );

  if (existing.credentialEnvVar === undefined) return;

  // The Credential is removed from the file it was written to rather than
  // overwritten with nothing, so an empty variable is not left behind holding
  // the reader's attention. A name that is not there is not an error: the
  // Endpoint is gone either way, which is what was asked for.
  //
  // Not atomic, unlike the write above, and deliberately: this rewrites a file a
  // developer annotates and Next watches, and the failure it guards against —
  // a Credential left behind naming a server that is gone — is not worth the
  // temporary file that would make this survive interruption instead. The
  // `ENV_FILE` constant rather than the literal, so there is one answer to which
  // file that is.
  const target = path.join(input.dir, ENV_FILE);

  const contents = await fs.readFile(target, "utf8").catch(() => "");
  const remaining = contents
    .split("\n")
    .filter((line) => !new RegExp(`^\\s*(?:export\\s+)?${existing.credentialEnvVar}\\s*=`).test(line))
    .join("\n");

  await fs.writeFile(target, remaining, { encoding: "utf8", mode: 0o600 });
}
