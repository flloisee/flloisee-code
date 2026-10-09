import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ENV_FILE } from "../env";

/**
 * A throwaway project root to run the app in, and a clean way back out of it.
 *
 * Key Entry reads its target from the working directory and replaces the whole
 * process environment when it saves. Testing that against the real project
 * would mean overwriting whatever `.env.local` a developer actually depends on
 * and leaving their process environment changed. So each test gets a directory
 * of its own, and the environment and working directory are put back afterwards.
 *
 * The environment snapshot is taken when the project is created, not when a test
 * begins — which is what makes it usable for a test about the environment that
 * was already there, such as a Credential exported in a shell.
 */

/**
 * Next declares NODE_ENV read-only, because the framework owns it. A test sets
 * it on purpose, which is the one thing that has to go around that here.
 */
function writableEnvironment(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

export function setEnvVar(name: string, value: string | undefined): void {
  const environment = writableEnvironment();

  if (value === undefined) {
    delete environment[name];
  } else {
    environment[name] = value;
  }
}

export type TemporaryProject = {
  /** The directory to point the app at, and the one the working directory is set to. */
  readonly dir: string;
  /** The environment file inside it. */
  envFile(): string;
  /**
   * For `beforeEach`: a fresh directory, the working directory set to it, and
   * the app running as a dev server would.
   */
  begin(): Promise<void>;
  /**
   * For `afterEach`: every variable, the working directory, and the directory
   * itself all back as they were.
   */
  end(): Promise<void>;
};

export async function temporaryProject(prefix = "key-entry-"): Promise<TemporaryProject> {
  const originalCwd = process.cwd();
  const originalEnv: Record<string, string | undefined> = { ...process.env };
  const hadNodeEnv = "NODE_ENV" in originalEnv;

  let dir = "";

  const removeDir = () => rm(dir, { recursive: true, force: true });

  return {
    get dir() {
      return dir;
    },
    envFile: () => path.join(dir, ENV_FILE),
    async begin() {
      await removeDir();
      dir = await mkdtemp(path.join(tmpdir(), prefix));
      process.chdir(dir);
      setEnvVar("NODE_ENV", "development");
    },
    async end() {
      process.chdir(originalCwd);

      for (const name of Object.keys(process.env)) {
        if (!(name in originalEnv)) setEnvVar(name, undefined);
      }
      for (const [name, value] of Object.entries(originalEnv)) {
        setEnvVar(name, value);
      }
      if (!hadNodeEnv) setEnvVar("NODE_ENV", undefined);

      await removeDir();
    },
  };
}