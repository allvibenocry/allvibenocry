#!/bin/sh
# A new project carries no local allow of any kind (D81): the stand-in's
# allow in a working copy's local settings is a test fixture (D77), and must
# never reach a real project. Run on the host, as root, after `project create`:
#
#   sh no-allow.sh <command> <project>
#
# Looks at every file of the project's working copy and of every commit in its
# history: no Claude Code local settings file, and nothing that allows a tool,
# widens what Claude Code may do, or skips its questions. Counts, prints each
# verdict, and exits 1 if anything is found.
cmd=$1
project=$2
repo=/var/lib/$cmd/projects/$project/repo
wrong=0
verdict() {
  if [ "$2" = "$3" ]; then echo "ok    $1: $2"; else echo "WRONG $1: $2 (wanted $3)"; wrong=$((wrong + 1)); fi
}
if [ ! -d "$repo/.git" ]; then
  echo "no working copy at $repo" >&2
  exit 2
fi
cd "$repo" || exit 2
# The working copy is the service user's, and this runs as root: git is told,
# for these commands only, that the folder is safe (never in any config file).
g() { git -c safe.directory="$repo" "$@"; }
list=$(mktemp)
{ g ls-files; g log --all --name-only --pretty=format: ; find . -path ./.git -prune -o -type f -print | sed 's|^\./||'; } | grep -v '^$' | sort -u > "$list"
files=$(wc -l < "$list")
commits=$(g rev-list --all | wc -l)
verdict "files looked at, in the working copy and every commit" "$([ "$files" -gt 5 ] && echo "more than five" || echo "$files")" "more than five"
verdict "commits looked at" "$([ "$commits" -gt 0 ] && echo "at least one" || echo "none")" "at least one"
verdict "Claude Code local settings files (settings.local.json)" "$(grep -c 'settings\.local\.json$' "$list")" "0"
verdict "Claude Code settings files of any kind in it (.claude/)" "$(grep -c '^\.claude/' "$list")" "0"
# The patterns, one per line, with no empty line (mistake 38): a JSON "allow",
# allowed tools in any spelling, and the modes that skip or widen permissions.
patterns=$(mktemp)
printf '%s\n' '"allow"[[:space:]]*:' 'allowedTools' 'allowed-tools' 'dangerously-skip-permissions' 'bypassPermissions' '"additionalDirectories"' > "$patterns"
verdict "patterns looked for" "$(grep -c . "$patterns")" "6"
found=0
while IFS= read -r f; do
  [ -f "$f" ] && grep -qEf "$patterns" "$f" && { echo "      found in the working copy: $f"; found=$((found + 1)); }
done < "$list"
for c in $(g rev-list --all); do
  for f in $(g ls-tree -r --name-only "$c"); do
    g show "$c:$f" 2>/dev/null | grep -qEf "$patterns" && { echo "      found in commit $(echo "$c" | cut -c1-7): $f"; found=$((found + 1)); }
  done
done
verdict "files that allow, widen or skip anything" "$found" "0"
rm -f "$list" "$patterns"
echo "$wrong wrong"
[ "$wrong" -eq 0 ]
