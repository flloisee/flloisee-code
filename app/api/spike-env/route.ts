/**
 * SPIKE SCAFFOLDING — ticket 02. Not a feature. Delete after the finding is
 * recorded in docs/adr/ or the ticket file.
 *
 * Answers one question by execution: does writing a variable to .env.local
 * make it visible in the ALREADY-RUNNING dev server process, without a restart?
 *
 * Actions (POST JSON { action, name?, value? }):
 *   read            -> report process.env[name] as-is
 *   write           -> append NAME=VALUE to .env.local, read again (same request)
 *   write+reload    -> append, then call loadEnvConfig(forceReload: true), read again
 *   reload-only     -> call loadEnvConfig(forceReload: true), read again
 *   mutate          -> set process.env[name] only (no file), read back
 *   mutate+reload   -> set process.env[name], then forceReload, read back
 *                     (tests whether reload wipes runtime-only mutations)
 *
 * Full results: docs/spikes/02-runtime-env-reload.md
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    name?: string;
    value?: string;
  };
  const action = body.action ?? "read";
  const name = body.name ?? "SPIKE_TEST_VAR";
  const value = body.value ?? "spike-value";
  const dir = process.cwd();
  const envFile = path.join(dir, ".env.local");

  const before = process.env[name];

  if (action === "write" || action === "write+reload") {
    await fs.appendFile(envFile, `${name}=${value}\n`, "utf8");
  }

  // Set a variable in process.env that is NOT in any env file, to see whether
  // a forceReload preserves runtime-only mutations.
  if (action === "mutate") {
    process.env[name] = value;
  }

  if (
    action === "write+reload" ||
    action === "reload-only" ||
    action === "mutate+reload"
  ) {
    loadEnvConfig(dir, true, undefined, true);
  }

  // Deliberately read via dynamic lookup so nothing is inlined by a bundler.
  const after: string | undefined = process.env[name];

  let fileContents: string | null = null;
  try {
    fileContents = await fs.readFile(envFile, "utf8");
  } catch {
    fileContents = null;
  }

  return Response.json({
    action,
    name,
    before: before ?? null,
    after: after ?? null,
    changed: before !== after,
    survivedReload: after !== null,
    fileContainsVar: fileContents?.includes(`${name}=`) ?? false,
    pid: process.pid,
    ts: new Date().toISOString(),
  });
}
