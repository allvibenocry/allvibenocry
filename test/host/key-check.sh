#!/bin/sh
# The key check before every commit (D38), tried in a scratch project on the host.
#
#   sh key-check.sh <command> <project>
#
# A fake key, made here at random in the shape of an Anthropic API key, is put
# in dev's working tree and committed two ways: with `<command> dev commit`, as
# the user does, and with git directly, as the agent does. Both must stop,
# naming the file and the line. The fake key is never printed: every line below
# is a message from the check, a count or an exit code. Then it is taken out,
# and a clean commit must pass. Last, the scanner is taken away for a moment:
# the check must stop the commit rather than let it through.
set -u
C=${1:?usage: key-check.sh <command> <project>}
P=${2:?usage: key-check.sh <command> <project>}
R=/var/lib/$C/projects/$P/repo
SCANNER=/var/lib/$C/tools/gitleaks-8.30.1/gitleaks
as() { runuser -u "$C" -- "$@"; }
umask 077

# The shape gitleaks' anthropic-api-key rule looks for, assembled here, so that
# this file never has it: the prefix, 93 characters, and AA.
KEY=$(mktemp)
body=$(head -c 300 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 93)
printf '%s-%s-%s%s' sk-ant api03 "$body" AA > "$KEY"
chmod 644 "$KEY"   # the service user's grep below reads it; it is fake, and removed at the end
found() { grep -a -c -F -f "$KEY" || true; }

printf 'export const weatherKey = "%s";\n' "$(cat "$KEY")" | as tee "$R/config.js" >/dev/null

echo "== 1. $C dev commit, with a fake key on line 1 of config.js"
"$C" dev commit "$P" "Add the weather key"
echo "exit $?"

echo "== 2. git commit, directly, as the agent does"
as git -C "$R" add config.js
as git -C "$R" -c user.name=agent -c user.email=agent@localhost commit -q -m "Add the weather key"
echo "exit $?"

echo "== the fake key in any commit:                         $(as git -C "$R" log -p --all | found)"
echo "== the fake key in any object, the staged copy included: $(as git -C "$R" cat-file --batch-all-objects --batch | found)"
as git -C "$R" reset -q
rm -f "$R/config.js"
as git -C "$R" prune --expire=now
echo "== after unstaging it and pruning, in any object:      $(as git -C "$R" cat-file --batch-all-objects --batch | found)"

echo "== 3. a clean commit"
printf 'export const greeting = "Welcome";\n' | as tee "$R/config.js" >/dev/null
"$C" dev commit "$P" "Add a greeting"
echo "exit $?"

echo "== 4. with the scanner missing"
mv "$SCANNER" "$SCANNER.away"
printf 'export const farewell = "Bye";\n' | as tee -a "$R/config.js" >/dev/null
"$C" dev commit "$P" "Add a farewell"
echo "exit $?"
mv "$SCANNER.away" "$SCANNER"
"$C" dev commit "$P" "Add a farewell"
echo "exit $? (the scanner back)"

rm -f "$KEY"
