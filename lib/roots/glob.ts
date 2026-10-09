/**
 * The pattern language a `.gitignore` file is written in, which the `glob` a
 * Model hands to `search_files` is written in too.
 *
 * One language rather than two, deliberately. A developer has already written
 * `*.log`, `dist/` and a double-star prefix in a `.gitignore` a hundred times,
 * and they mean the same things when they type one into a search. The second
 * implementation is also the second one to drift — a glob that quietly differs
 * from the ignore file beside it is a walk that skips a folder the developer
 * believes is searched, and nothing would say so.
 *
 * The rules implemented here are git's, and git is the specification that is
 * already on the machine:
 *
 * - A pattern with no separator in it matches at **any depth** below the folder
 *   the file is in. `build` ignores `packages/app/build`, not just `build`.
 * - A pattern with a separator in it is measured from the folder the file is in.
 *   A leading `/` says so out loud and changes nothing.
 * - A trailing `/` makes it a folder, which ignores the folder and everything
 *   under it rather than a file of the same name.
 * - `*` and `?` stop at a separator; `**` crosses one.
 * - A later line wins, so `!` can bring back what an earlier line took away.
 *
 * What is *not* implemented is git's precedence between several `.gitignore`
 * files at different depths, nor its escape handling beyond a leading `\#`. A
 * walk that reads one file and is slightly wrong about a pathological pattern is
 * a walk that reads a few files it did not have to; it is not a walk that reads
 * a file outside the Root.
 */

/** One compiled pattern. */
export type Glob = {
  /** Whether `relativePath` — in `/` form, relative to where the pattern applies — matches. */
  matches(relativePath: string): boolean;
};

/** A folder's ignore rules, in the order the file wrote them. */
export type IgnoreRules = {
  /**
   * What these rules say about a path, or `null` when they say nothing.
   *
   * Three answers rather than two, and the third is the one that matters: "no
   * rule matched" and "a rule matched and said no" are different, and a caller
   * combining several `.gitignore` files has to be able to tell them apart. A
   * folder whose own file has nothing to say must fall back to the one above it,
   * or a project with a `.gitignore` in every folder would ignore nothing at all.
   */
  decides(relativePath: string): boolean | null;
  /** Whether this path is ignored, and everything under it if it is a folder. */
  ignores(relativePath: string): boolean;
};

/**
 * A line that says nothing, and a pattern that matches nothing.
 *
 * Kept rather than filtered at the call site so that an empty pattern is a
 * pattern that matches nothing — a `.gitignore` line of `!` re-includes nothing,
 * and treating it as "match everything" would quietly un-ignore a whole tree.
 */
const MATCHES_NOTHING: Glob = { matches: () => false };

/**
 * Compiles one `.gitignore`-shaped pattern.
 *
 * Paths are matched against the pattern with `/` as the separator whatever the
 * machine's separator is, because a pattern is written in a file by a person and
 * a path reaching here is turned into `/` form before it arrives.
 */
export function compileGlob(pattern: string): Glob {
  const parsed = parse(pattern);
  if (parsed === null) return MATCHES_NOTHING;

  const body = new RegExp(parsed.source);
  const anchored = parsed.anchored;

  return {
    matches(relativePath: string): boolean {
      const target = relativePath.replace(/\/+$/, "");
      if (target === "") return false;

      // Measured from the top: one test against the whole path.
      if (anchored) return body.test(target);

      // Matched at any depth: a pattern with no separator in it is a *name*, and
      // a name matches wherever that name appears. Testing single segments rather
      // than trailing slices is what keeps `logs/*` from matching
      // `logs/nested/debug.log` while `*.log` still matches it.
      return target.split("/").some((segment) => body.test(segment));
    },
  };
}

type Parsed = {
  /** The pattern as a regular expression source, with the leading `/` removed. */
  source: string;
  /** `true` when the pattern has a separator and so is measured from the top. */
  anchored: boolean;
};

function parse(pattern: string): Parsed | null {
  const rest = pattern.replace(/\\/g, "/").trim();

  if (rest === "" || rest.startsWith("#")) return null;

  const bare = rest.startsWith("\\#") || rest.startsWith("\\!") ? rest.slice(1) : rest;
  const folderOnly = bare.endsWith("/");
  const withoutTrailing = folderOnly ? bare.slice(0, -1) : bare;

  // A leading `/` anchors and says nothing else. The absence of any separator is
  // what makes a pattern float, so this is the same question asked twice.
  const anchored = withoutTrailing.startsWith("/") || withoutTrailing.slice(1).includes("/");

  const body = withoutTrailing.replace(/^\//, "");
  if (body === "") return null;

  return { source: toRegExpSource(body) + (folderOnly ? "(?:/.*)?" : ""), anchored };
}

/**
 * A glob as a regular expression.
 *
 * Written by scanning rather than by replacing, because `**` has to be seen
 * before `*`: replacing the two-character form first would leave a `*` sitting
 * where a `**` used to be and quietly turn "any depth" into "one level".
 */
function toRegExpSource(pattern: string): string {
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          // `**/` is any number of folders, including none: `src/**/x` is
          // `src/x` as well as `src/a/b/x`.
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    if (character === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close > index) {
        let body = pattern.slice(index + 1, close);
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        source += `[${body}]`;
        index = close;
        continue;
      }
    }

    source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return `^${source}$`;
}

/**
 * Reads a `.gitignore` file's lines as one ordered list of rules.
 *
 * A list and not a set, because `!` only means something relative to what came
 * before it: the last line that matches a path decides, and a `!` line can bring
 * back a path an earlier line took. Read as a set, negation is not expressible.
 *
 * A file that cannot be read is no rules at all, which is the narrow answer: the
 * walk then searches more rather than less, and a `.gitignore` the machine will
 * not open is not one this app should be guessing at.
 */
export function gitignoreRules(lines: string[]): IgnoreRules {
  const rules = lines
    .map((line) => readLine(line))
    .filter((rule): rule is Rule => rule !== null);

  return {
    decides(relativePath: string): boolean | null {
      const segments = relativePath.split("/");

      // Deepest first, and the deepest level with any matching rule decides.
      // That is how git behaves, and it is what makes `!keep.txt` inside an
      // ignored folder mean what it looks like: the folder is asked about first
      // and answers yes, and only a rule in the folder's own right takes it back.
      for (let taken = segments.length; taken > 0; taken -= 1) {
        const decided = decidedAt(rules, segments.slice(0, taken).join("/"));
        if (decided !== null) return decided;
      }

      return null;
    },

    ignores(relativePath: string): boolean {
      return this.decides(relativePath) ?? false;
    },
  };
}

/** The last rule that matched this path, as an answer, or `null` if none did. */
function decidedAt(rules: Rule[], candidate: string): boolean | null {
  let decided: boolean | null = null;

  for (const rule of rules) {
    if (rule.glob.matches(candidate)) decided = !rule.negated;
  }

  return decided;
}

type Rule = { glob: Glob; negated: boolean };

function readLine(line: string): Rule | null {
  const trimmed = line.replace(/\r$/, "").trimEnd();

  if (trimmed === "" || trimmed.startsWith("#")) return null;

  const negated = trimmed.startsWith("!") || trimmed.startsWith("\\!");
  const pattern = negated ? trimmed.slice(1) : trimmed;

  const glob = compileGlob(pattern);
  return { glob, negated };
}
