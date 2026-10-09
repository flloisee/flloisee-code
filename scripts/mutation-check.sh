#!/bin/zsh
# Checks that the Key Entry tests are worth having: injects, one at a time, the
# bug each test exists to catch, and records whether the relevant test noticed.
#
# A security test that passes whether or not the check is there is worse than no
# test, because it is read as evidence. This is how each one was shown to fail.
#
# Files are restored after every mutation and again on the way out, including on
# an interrupt, so the tree is left as it was found.
#
#   pnpm test:mutation
#
# Also runnable directly as `zsh scripts/mutation-check.sh`. Both are the same
# script; the package.json entry exists so it is discoverable from the other
# gates rather than hidden in scripts/.
set -u
cd "$(dirname "$0")/.."

WRITER=lib/env.ts
ATOMIC=lib/atomic-write.ts
ROUTE=app/api/keys/route.ts

# The Reading Root files. Guarded on the same reasoning: this route and the walk
# behind it are the only ways this app reaches outside its own directory, and
# every one of them is a check rather than a convention.
ROOTS=lib/roots/reading-root.ts
WALK=lib/roots/walk.ts
CONTAINMENT=lib/roots/containment.ts
READABLE=lib/roots/readable.ts
ROOTS_ROUTE=app/api/roots/route.ts

BACKUP_DIR=$(mktemp -d)

cp $WRITER $BACKUP_DIR/writer.ts
cp $ATOMIC $BACKUP_DIR/atomic.ts
cp $ROUTE $BACKUP_DIR/route.ts
cp $ROOTS $BACKUP_DIR/roots.ts
cp $WALK $BACKUP_DIR/walk.ts
cp $CONTAINMENT $BACKUP_DIR/containment.ts
cp $READABLE $BACKUP_DIR/readable.ts
cp $ROOTS_ROUTE $BACKUP_DIR/roots-route.ts

restore() {
  cp $BACKUP_DIR/writer.ts $WRITER
  cp $BACKUP_DIR/atomic.ts $ATOMIC
  cp $BACKUP_DIR/route.ts $ROUTE
  cp $BACKUP_DIR/roots.ts $ROOTS
  cp $BACKUP_DIR/walk.ts $WALK
  cp $BACKUP_DIR/containment.ts $CONTAINMENT
  cp $BACKUP_DIR/readable.ts $READABLE
  cp $BACKUP_DIR/roots-route.ts $ROOTS_ROUTE
}
trap 'restore; rm -rf $BACKUP_DIR' EXIT INT TERM

# Replaces one exact piece of text in one file, runs the tests that should
# notice, and puts the file back.
run() {
  local label="$1" file="$2" from="$3" to="$4" tests="$5"
  restore

  perl -0pi -e "s/\Q$from\E/$to/" $file
  if grep -qF "$from" $file; then
    print "NOT APPLIED | $label | the text to replace is not in $file as written"
    return
  fi

  # zsh does not word-split unquoted expansions, so the filters are split here.
  local out
  out=$(pnpm vitest run ${=tests} 2>&1)

  if print -r -- "$out" | grep -q "No test files found"; then
    print "BROKEN      | $label | vitest matched nothing: ${=tests}"
  elif print -r -- "$out" | grep -qE "Tests .*failed"; then
    print "CAUGHT      | $label"
    print -r -- "$out" | grep -E "^ *× " | sed 's/^ */               /'
  else
    print "MISSED !!!  | $label"
  fi
}

# The Catalog allowlist.
run "M1 accepts any variable name" $ROUTE \
  'if (!isDeclaredCredentialVar(envVar)) {' 'if (false) {' \
  'app/api/keys/route.test.ts'

# The one argument that is not optional: without it the reload is a silent no-op
# in any server that has already booted.
run "M2 reloads without forceReload" $WRITER \
  'loadEnvConfig(dir, process.env.NODE_ENV === "development", undefined, true);' \
  'loadEnvConfig(dir, process.env.NODE_ENV === "development", undefined, false);' \
  'lib/env.test.ts app/api/keys'

# Appends a second entry instead of rewriting the one that is there.
run "M3 appends instead of rewriting in place" $WRITER \
  'const firstIndex = lines.findIndex((line) => isAssignmentTo(line, name));' \
  'const firstIndex = -1;' \
  'lib/env.test.ts app/api/keys'

# Writes over the real file, so an interrupted write corrupts it.
run "M4 writes in place instead of temp-file + rename" $ATOMIC \
  'await writer(tempPath, contents);' 'await writer(target, contents);' \
  'lib/env.test.ts lib/roots'

# Accepts a base URL from the caller.
run "M5 accepts extra fields such as a base URL" $ROUTE \
  '  .strict();' '  ;' \
  'app/api/keys/route.test.ts'

# Runs outside development.
run "M6 runs outside development" $ROUTE \
  'if (process.env.NODE_ENV !== "development") {' 'if (process.env.NODE_ENV === "never") {' \
  'app/api/keys/route.test.ts'

# Hands the stored Credential back.
run "M7 returns the stored value" $ROUTE \
  'return Response.json(outcome);' 'return Response.json({ ...outcome, credential });' \
  'app/api/keys/route.test.ts'

# Stores a value the file cannot hold back exactly.
run "M8 stores a value the file cannot hold" $ROUTE \
  'if (!canBeStoredVerbatim(credential)) {' 'if (false) {' \
  'app/api/keys/route.test.ts'

# The Reading Root guards. The same reasoning as the ones above: each of these is
# a check standing between a caller and this machine's disk, so each has to fail
# when the check is removed.

# Names a Root outside development.
run "M9 names a Root outside development" $ROOTS_ROUTE \
  'if (process.env.NODE_ENV !== "development") {' 'if (process.env.NODE_ENV === "never") {' \
  'app/api/roots/route.test.ts'

# Declares a Root the walk was never allowed to reach.
run "M10 declares a Root outside the walk boundary" $ROOTS_ROUTE \
  'const admitted = await admitUnder([walkBoundary()], declared);' \
  'const admitted = { admitted: true, path: declared } as const;' \
  'app/api/roots/route.test.ts'

# Declares a Root that is a file, or nothing at all.
run "M11 declares a Root that is not a folder" $ROOTS_ROUTE \
  'if (!isFolder) return refused("not-a-directory");' 'if (false) return refused("not-a-directory");' \
  'app/api/roots/route.test.ts'

# Walks anywhere the caller names, which is a map of the machine.
run "M12 lists a folder outside the boundary" $WALK \
  'if (!admitted.admitted) return { ok: false, reason: admitted.reason };' 'if (false) return { ok: false, reason: admitted.reason };' \
  'lib/roots/walk.test.ts app/api/roots/route.test.ts'

# Resolves with `path.resolve` instead of `fs.realpath`, so a link out of the
# Root is never followed and the comparison is made on the path as written — a
# path inside the Root that points at `~/.ssh` comes back as itself, and is
# inside. Distinct from M14, which keeps the resolution and loses only the
# separator: this one is about *which* resolution happens.
run "M13 admits a path that reaches out through a symlink" $CONTAINMENT \
  'return { path: await fs.realpath(candidate) };' \
  'return { path: path.resolve(candidate) };' \
  'lib/roots/containment.test.ts lib/roots/readable.test.ts'

# Compares by string prefix, so a sibling folder is admitted.
run "M14 admits a sibling whose name begins the boundary's" $CONTAINMENT \
  'edge.path + path.sep' 'edge.path' \
  'lib/roots/containment.test.ts'

# Lists a Credential's name as a clickable row.
run "M15 lists an .env entry" $WALK \
  'if (isSkipped(name)) continue;' 'if (false) continue;' \
  'lib/roots/walk.test.ts'

# Makes the temporary file the Root file itself, so there is no atomic step left
# and an interrupted write leaves half a Root behind. Distinct from M4, which
# removes the rename from the shared writer and is therefore checked against both
# writers at once: this one is about `reading-root.ts` asking for a temporary file
# at all, which is a mistake it could make independently of what the writer does.
run "M16 records a Root with no temporary file" $ROOTS \
  '    tempName,' \
  '    tempName: target,' \
  'lib/roots/reading-root.test.ts'

# The containment guards themselves, one mutation each. The two above that cover
# `containment.ts` are M13 (which resolution happens) and M14 (the separator);
# these are the rest of the decisions on the way to an answer.

# A path that is the boundary rather than under it: the Root has to be readable
# as well as what is in it, since listing it is the first thing a Tool does.
run "M17 refuses the boundary itself" $CONTAINMENT \
  'asked.path === edge.path || asked.path.startsWith' \
  'asked.path.startsWith' \
  'lib/roots/containment.test.ts lib/roots/readable.test.ts'

# A relative path is resolved by `admitUnder` against wherever the server was
# started, which is inside the Root on one machine and outside on every other.
run "M18 admits a relative path" $CONTAINMENT \
  'if (!path.isAbsolute(candidate) || candidate.includes("\0")) return { refusal: "unusable" };' \
  'if (false) return { refusal: "unusable" };' \
  'lib/roots/containment.test.ts'

# Everything that cannot be resolved is reported the same way, so a path that is
# not there is answered as a null byte and the reader goes looking in the wrong
# place.
run "M19 calls a missing path unusable" $CONTAINMENT \
  'return { refusal: codeOf(error) === "ENOENT" ? "unreadable" : "unusable" };' \
  'return { refusal: "unreadable" };' \
  'lib/roots/containment.test.ts lib/roots/readable.test.ts'

# The Grants are dropped from the boundaries, so the Root is the only thing the
# Model can read. This is the mutation the spec names: a Grant that changes
# nothing is a Grant that was never a boundary.
run "M20 reads the Root alone and no Grants" $READABLE \
  '[root, ...reading.grants]' '[root]' \
  'lib/roots/readable.test.ts'

# Every read is reported as the Root's, so a read covered by a Grant is shown to
# the reader as one they allowed when they did not — and a read the Root covers
# is shown as an approval that needs no approval.
run "M21 calls every read the Root's" $READABLE \
  'under: answer.boundary === root ? "root" : "grant",' \
  'under: "root",' \
  'lib/roots/readable.test.ts'

# `path.join` collapses `link/../src` before the disk sees it, which is a
# different question from the one the disk answers: the link is followed first
# and the `..` applied where it landed. The path then resolves inside the Root
# and is admitted in place of one outside it.
run 'M22 collapses a `..` the disk would have applied elsewhere' $READABLE \
  'return root + path.sep + asked;' \
  'return path.join(root, asked);' \
  'lib/roots/readable.test.ts'

# An absolute path is folded into the Root, so a path anywhere on the machine is
# re-read as one the reader chose — and is refused as a typo rather than as what
# it is.
run "M23 folds an absolute path into the Root" $READABLE \
  'if (path.isAbsolute(asked)) return asked;' \
  'if (false) return asked;' \
  'lib/roots/readable.test.ts'

# A machine with no Root reads everything, which is the v1 behaviour this
# feature must not have silently become.
run "M24 reads without a Root" $READABLE \
  'if (root === null) return OUTSIDE;' \
  'if (false) return OUTSIDE;' \
  'lib/roots/readable.test.ts'

restore
print ""

# Compared against the backups taken at the start rather than with `git diff`.
# `git diff` asks whether the working tree matches HEAD, which is a different
# question: any file this script touches that also carries uncommitted work of its
# own would be reported as unrestored forever.
for pair in \
  "$BACKUP_DIR/writer.ts:$WRITER" \
  "$BACKUP_DIR/atomic.ts:$ATOMIC" \
  "$BACKUP_DIR/route.ts:$ROUTE" \
  "$BACKUP_DIR/roots.ts:$ROOTS" \
  "$BACKUP_DIR/walk.ts:$WALK" \
  "$BACKUP_DIR/containment.ts:$CONTAINMENT" \
  "$BACKUP_DIR/readable.ts:$READABLE" \
  "$BACKUP_DIR/roots-route.ts:$ROOTS_ROUTE"; do
  backup=${pair%%:*}
  original=${pair#*:}

  if cmp -s $backup $original; then
    print "restored | $original"
  else
    print "NOT RESTORED | $original"
  fi
done