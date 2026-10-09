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

# The Tools and the walk behind the search.
TOOLS=lib/tools/file-tools.ts
SCAN=lib/roots/scan.ts
TEXT=lib/roots/text.ts

# Naming a file in a Turn: which words in a message are paths, and the check that
# every one of them is asked again at send. Between them these decide what enters
# a Turn from the reader's side, which is the one door into the boundary that is
# not the Model's.
NAMED_PATH=lib/roots/named-path.ts
ATTACHING=lib/chat/attach-named-files.ts

# Answering an approval. Two decisions that only the reader makes: which history
# entry counts as their answer, and whether "always allow" is recorded before the
# answer is sent rather than after.
APPROVED=lib/tools/approved.ts
ANSWERING=components/approval-answer.tsx

BACKUP_DIR=$(mktemp -d)

cp $WRITER $BACKUP_DIR/writer.ts
cp $ATOMIC $BACKUP_DIR/atomic.ts
cp $ROUTE $BACKUP_DIR/route.ts
cp $ROOTS $BACKUP_DIR/roots.ts
cp $WALK $BACKUP_DIR/walk.ts
cp $CONTAINMENT $BACKUP_DIR/containment.ts
cp $READABLE $BACKUP_DIR/readable.ts
cp $ROOTS_ROUTE $BACKUP_DIR/roots-route.ts
cp $TOOLS $BACKUP_DIR/tools.ts
cp $SCAN $BACKUP_DIR/scan.ts
cp $TEXT $BACKUP_DIR/text.ts
cp $NAMED_PATH $BACKUP_DIR/named-path.ts
cp $ATTACHING $BACKUP_DIR/attaching.ts
cp $APPROVED $BACKUP_DIR/approved.ts
cp $ANSWERING $BACKUP_DIR/answering.tsx

restore() {
  cp $BACKUP_DIR/writer.ts $WRITER
  cp $BACKUP_DIR/atomic.ts $ATOMIC
  cp $BACKUP_DIR/route.ts $ROUTE
  cp $BACKUP_DIR/roots.ts $ROOTS
  cp $BACKUP_DIR/walk.ts $WALK
  cp $BACKUP_DIR/containment.ts $CONTAINMENT
  cp $BACKUP_DIR/readable.ts $READABLE
  cp $BACKUP_DIR/roots-route.ts $ROOTS_ROUTE
  cp $BACKUP_DIR/tools.ts $TOOLS
  cp $BACKUP_DIR/scan.ts $SCAN
  cp $BACKUP_DIR/text.ts $TEXT
  cp $BACKUP_DIR/named-path.ts $NAMED_PATH
  cp $BACKUP_DIR/attaching.ts $ATTACHING
  cp $BACKUP_DIR/approved.ts $APPROVED
  cp $BACKUP_DIR/answering.tsx $ANSWERING
}
trap 'restore; rm -rf $BACKUP_DIR' EXIT INT TERM

# Replaces one exact piece of text in one file, runs the tests that should
# notice, and puts the file back.
#
# `$6` is optional: pass `everywhere` to replace every occurrence rather than the
# first, for a guard that one line of code enforces in more than one place. Mutating
# one copy there would be caught by the tests for the others and read as evidence
# that all of them are guarded.
#
# **Neither string may contain a `/`.** The substitution is `s/\Q$from\E/$to/`, so a
# slash inside the quoted string closes the pattern early: the replacement silently
# does not happen, and the entry below reports NOT APPLIED. That reads like the code
# having drifted, so it cost an entry a whole guard once already — M36 aimed at
# `already-granted` when the route said `already-decided`, and the guard it claimed
# to check turned out to have no test at all. Aim such a string at an identifier
# rather than at a path-like literal.
run() {
  local label="$1" file="$2" from="$3" to="$4" tests="$5" scope="${6:-}"
  restore

  if print -r -- "$from" | grep -q '/'; then
    print "BROKEN      | $label | the text to replace contains a /, which ends the pattern"
    return
  fi

  perl -0pi -e "s/\Q$from\E/$to/$scope" $file
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
  'answer.boundary === root' '"root" === root' \
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

# The Tools' guards. The same reasoning as the ones above, and the reason they are
# worth a mutation each is that this is the code standing between a Model and every
# file on this machine. `run` is given `g` where one line enforces the guard in all
# three Tools, because mutating one of the three would otherwise be caught by the
# tests for the others and read as evidence that all three are guarded.

# The Tools answer for a path containment refused, rather than stopping. Every one
# of the three, in one mutation: the gate is one line and it is the whole of what
# stands between a Tool and a file the reader did not share.
run "M25 the Tools answer for a refused path" $TOOLS \
  'if (isRefusal(allowed)) return allowed;' 'if (false) return allowed;' \
  'lib/tools/file-tools.test.ts' g

# The refusal carries a reason of containment's own, so "outside the Root" and "not
# there" stay two answers. A Model told a path was merely missing will correct the
# spelling and try again; one told a refusal is a failure of the machinery stops.
run "M26 the Tools give every refusal the same reason" $TOOLS \
  'return allowed.readable ? allowed : containmentRefusal(asked, allowed.reason);' \
  'return allowed.readable ? allowed : containmentRefusal(asked, "outside");' \
  'lib/tools/file-tools.test.ts'

# Bytes are decoded leniently, so a binary file comes back as a string of
# replacement characters and reaches the transcript looking like content.
run "M27 decodes bytes that are not characters" $TEXT \
  'new TextDecoder("utf-8", { fatal: true }).decode(bytes);' \
  'new TextDecoder("utf-8").decode(bytes);' \
  'lib/tools/file-tools.test.ts'

# A file over the ceiling is opened anyway, so a search pulls a bundle into memory
# to find out it was never going to look at it.
run "M28 opens a file larger than the ceiling" $SCAN \
  'if (size === null || size > MAX_OPEN_FILE_BYTES) return null;' \
  'if (size === null) return null;' \
  'lib/tools/file-tools.test.ts'

# The walk reads what the developer wrote down they did not want searched, which in
# a real project is the build output and the logs.
run "M29 ignores a gitignore" $SCAN \
  'if (isNeverWalked(entry.name) || ignoredHere(inForce, child)) {' \
  'if (isNeverWalked(entry.name)) {' \
  'lib/tools/file-tools.test.ts'

# The walk opens the environment files, so a Credential goes into a transcript that
# is saved, re-sent on every later Turn and forwarded to an Endpoint.
run "M30 searches the environment files" $SCAN \
  'return name === "node_modules" || name === ".git" || isCredentialFile(name);' \
  'return name === "node_modules" || name === ".git";' \
  'lib/tools/file-tools.test.ts'

# The walk descends into a link, which is the way out of the Root: a link inside
# the Root pointing at a folder beside it, walked as though it were a folder.
run "M31 walks into a link" $SCAN \
  'if (entry.isDirectory()) {' 'if (entry.isDirectory() || entry.isSymbolicLink()) {' \
  'lib/tools/file-tools.test.ts'

# The walk opens a link to a file, which is the same escape for a file rather than
# for a folder — and the one a walk that only refuses to descend would still do,
# because the entry is not a folder and so nothing stops it.
run "M32 opens a link" $SCAN \
  'if (!entry.isFile()) {' 'if (!entry.isFile() && !entry.isSymbolicLink()) {' \
  'lib/tools/file-tools.test.ts'

# A read that was cut gives no pointer to the rest, so a partial read reads as a
# whole file and the Model answers on the belief that it saw everything.
run "M33 truncates without saying where the rest is" $TOOLS \
  '    continuesAtLine,' '    continuesAtLine: null,' \
  'lib/tools/file-tools.test.ts'

# A search that stopped early reports itself as complete, which is how a Model says
# "this is nowhere in your project" about code in a file it was never shown.
run "M34 reports a partial search as complete" $TOOLS \
  'complete: !walk.stopped,' 'complete: true,' \
  'lib/tools/file-tools.test.ts'

# Answering an approval. The reader's decision is the only thing that widens the
# boundary, and each of these is a way for a decision that was not theirs — or not
# yet recorded — to be acted on as though it were.

# The route records a Grant for any path at all, so the browser can hand the app a
# general "make this readable" request aimed at a server holding every Credential on
# the machine. It is the same walk the Root itself is held to.
run "M35 grants a path outside the reader's own folders" $ROOTS_ROUTE \
  'if (!admitted.admitted) return { ok: false, reason: admitted.reason };' \
  'if (false) return { ok: false, reason: admitted.reason };' \
  'app/api/roots/route.test.ts'

# The route records a Grant for a path the Root already covers, so the list the
# reader reads to take permissions back is padded with entries no decision of
# theirs backs — and the real Grants are harder to see.
# Note: this reads `already-decided`, not the `already-granted` an earlier draft
# used. The draft never applied, so the entry reported NOT APPLIED and the guard
# looked covered while nothing tested it. See the `run` function's note on `/`
# inside a substituted string, which is what turned that draft into a no-op.
run "M36 grants a path the Root already covers" $ROOTS_ROUTE \
  'if (covered.admitted) return { ok: false, reason: "already-decided" };' \
  'if (false && covered.admitted) return { ok: false, reason: "already-decided" };' \
  'app/api/roots/route.test.ts'

# The Tools stop hearing the reader, so approving a read produces a Turn that says
# the file was not read. Nothing else in the app would notice: the reader pressed
# the button, the answer went, the Turn carried on.
run "M37 the Tools do not hear the reader's answer" $TOOLS \
  'mayRead(reading, asked, answered)' 'mayRead(reading, asked)' \
  'lib/tools/file-tools.test.ts lib/tools/approved.test.ts'

# The answer is matched to any approval rather than to this call's, so one "allow"
# on a file the reader was asked about opens every other path they were asked
# about in the same Conversation.
run "M38 any answer counts as this call's" $APPROVED \
  'approvalIds.has(part.approvalId)' 'true' \
  'lib/tools/approved.test.ts lib/tools/file-tools.test.ts'

# "Always allow" answers the approval whether or not the Grant was recorded, so the
# reader is told a path will not be asked about again and it is asked about again
# on the next Turn.
run "M39 answers before the Grant is recorded" $ANSWERING \
  'if (outcome.status !== "granted") {' 'if (false) {' \
  'components/approval-answer.test.tsx'

# The reader's own half of reading: naming a file in a Turn. Ticket 09 added neither
# of these, and the reason it gave was that the script names its files at the top and
# six worktrees editing that list at once is a merge hazard. The hazard has gone, so
# they are here — the two guards are the only ones left standing between words the
# reader typed and a file on this machine.

# The recheck at send. The composer asked about each path before the Turn existed, and
# a file can be deleted or the Root moved in between. `readNamedFile` still asks
# `mayRead` for itself, so what removing this costs is the *stop*: the Turn is sent
# with a block saying the file was left out instead of a 400 naming it, which is the
# failure the code's own comment calls reading to the Model as a complete answer
# about the wrong set of files.
run "M40 the recheck at send admits every path" $ATTACHING \
  'const allowed = await mayRead(reading, path, decision === "allowed");' \
  'const allowed = { readable: true, path, under: "root" as const };' \
  'app/api/chat/named-paths.test.ts'

# The recogniser finds nothing, so no path is ever named in a Turn and the reader's
# half of the feature goes quiet without a word: a message that attaches nothing is
# exactly a message that attaches nothing, so only the tests can see this.
#
# Aimed at `asPath`'s first line rather than at the loop above it, because `run`
# substitutes through `s/…/…/` and the loop's own text carries a regular expression
# — a `/` inside `\Q…\E` closes the pattern early and the substitution never runs.
# Every other entry here has the same constraint and is written to respect it.
run "M41 the recogniser finds no paths" $NAMED_PATH \
  '  if (token === "") return null;' '  if (token !== "") return null;' \
  'lib/roots/named-path.test.ts app/api/chat/named-paths.test.ts components/named-paths.test.tsx'

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
  "$BACKUP_DIR/roots-route.ts:$ROOTS_ROUTE" \
  "$BACKUP_DIR/tools.ts:$TOOLS" \
  "$BACKUP_DIR/scan.ts:$SCAN" \
  "$BACKUP_DIR/text.ts:$TEXT" \
  "$BACKUP_DIR/named-path.ts:$NAMED_PATH" \
  "$BACKUP_DIR/attaching.ts:$ATTACHING" \
  "$BACKUP_DIR/approved.ts:$APPROVED" \
  "$BACKUP_DIR/answering.tsx:$ANSWERING"; do
  backup=${pair%%:*}
  original=${pair#*:}

  if cmp -s $backup $original; then
    print "restored | $original"
  else
    print "NOT RESTORED | $original"
  fi
done