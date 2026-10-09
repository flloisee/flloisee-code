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
#   zsh scripts/mutation-check.sh
set -u
cd "$(dirname "$0")/.."

WRITER=lib/env.ts
ROUTE=app/api/keys/route.ts
BACKUP_DIR=$(mktemp -d)

cp $WRITER $BACKUP_DIR/writer.ts
cp $ROUTE $BACKUP_DIR/route.ts

restore() {
  cp $BACKUP_DIR/writer.ts $WRITER
  cp $BACKUP_DIR/route.ts $ROUTE
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
run "M4 writes in place instead of temp-file + rename" $WRITER \
  'await writeTempFile(tempPath, contents);' 'await writeTempFile(target, contents);' \
  'lib/env.test.ts'

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

restore
print ""
if git diff --quiet -- $WRITER $ROUTE; then
  print "tree restored: $WRITER and $ROUTE are back as they were"
else
  print "TREE NOT RESTORED — check git status before committing"
fi