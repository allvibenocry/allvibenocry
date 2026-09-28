#!/bin/sh
# A fresh backup before going back (D57), probed on the host, as root. The
# project needs at least three releases, so that it can go back twice.
#
#   sh rollback-backup.sh <command> <project>
#
# First a rollback as the person runs it: it must take a backup of prod and
# check that it restores before it deploys the older version, keep the backup
# (with the releases', never pruned), and keep prod's data. Then a rollback
# whose fresh backup is damaged the moment it is written, as a failing disk
# would: its restore check must fail, and the rollback stop there, with prod
# still on the version it ran, answering, and its data as it was. The last
# line counts what is not as it must be.
set -u
C=${1:?usage: rollback-backup.sh <command> <project>}
P=${2:?project}
PROJECT_JSON=/var/lib/$C/projects/$P/project.json
TARGET=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/etc/$C/config.json','utf8')).backupTarget)")
KEPT=$TARGET/$C/$P/releases
total=0
wrong=0

verdict() { # $1 label, $2 what was seen, $3 what it must be
  total=$((total + 1))
  if [ "$2" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-58s %-26s %s\n' "$1" "$2" "$v_ok"
}
running() { docker inspect -f '{{.Config.Image}}' "$C-$P-prod-app" | sed 's/.*://'; }
recorded() { node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_JSON','utf8')).current)"; }
entries() { port=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_JSON','utf8')).ports.prodApp)"); curl -s "http://127.0.0.1:$port/healthz" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).entries)}catch{console.log('no answer')}})"; }
kept() { find "$KEPT" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
kinds() { for m in "$KEPT"/*.json; do node -e "console.log(JSON.parse(require('fs').readFileSync('$m','utf8')).kind)"; done 2>/dev/null | grep -c "^$1\$"; }
# The line number, in a run's output, of the first step whose name has $2.
at() { printf '%s\n' "$1" | grep -n -E "^(ok|FAIL) +[0-9]+/[0-9]+ .*$2" | head -1 | cut -d: -f1; }

# Entries in prod, so that "its data kept" has something to keep.
port=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_JSON','utf8')).ports.prodApp)")
for n in Ada Bo; do curl -s -o /dev/null -d "name=$n-$(date +%s)&message=kept" "http://127.0.0.1:$port/entries"; done

echo "a rollback, as the person runs it:"
before_version=$(running); before_entries=$(entries); before_kept=$(kept); before_rollback=$(kinds rollback)
out=$("$C" rollback "$P" 2>&1); code=$?
printf '%s\n' "$out" | grep -E '^(ok|FAIL) ' | sed 's/^/  | /'
verdict "it went through" "$code" "0"
b=$(at "$out" "an encrypted backup of prod"); r=$(at "$out" "health check passes against the copy"); d=$(at "$out" "prod deployed on")
verdict "a fresh backup, then its restore check, then the deploy" "$([ -n "$b" ] && [ -n "$r" ] && [ -n "$d" ] && [ "$b" -lt "$r" ] && [ "$r" -lt "$d" ] && echo "in that order" || echo "not in that order")" "in that order"
verdict "one more backup kept with the releases'" "$(($(kept) - before_kept))" "1"
verdict "and it says it is a rollback's" "$(($(kinds rollback) - before_rollback))" "1"
verdict "prod went back" "$([ "$(running)" != "$before_version" ] && echo yes || echo no)" "yes"
verdict "the record says so" "$([ "$(recorded)" = "$(running)" ] && echo yes || echo no)" "yes"
verdict "prod's entries, as before" "$(entries)" "$before_entries"

echo "a rollback whose fresh backup is damaged as it is written:"
before_version=$(running); before_recorded=$(recorded); before_entries=$(entries)
# The damage: the moment the new backup file lands (inotify tells at once),
# one byte near its end, inside the encrypted data, is flipped, as a failing
# disk would; its checksum or its decryption must then fail the restore check.
# inotifywait (inotify-tools) is installed on the test host for this.
command -v inotifywait >/dev/null || { echo "this probe needs inotifywait: apt-get install inotify-tools"; exit 2; }
( inotifywait -q -m -e moved_to --format '%f' "$KEPT" | while read -r f; do
    case "$f" in *.dump.age) ;; *) continue ;; esac
    file="$KEPT/$f"; off=$(($(stat -c %s "$file") - 20))
    byte=$(od -An -tu1 -j "$off" -N1 "$file" | tr -d ' ')
    # shellcheck disable=SC2059 # the format is the byte itself, in octal
    printf "\\$(printf '%03o' $((byte ^ 255)))" | dd of="$file" bs=1 seek="$off" conv=notrunc 2>/dev/null
    echo "damaged" > /tmp/damage-done
    break
  done ) &
watcher=$!
out=$("$C" rollback "$P" 2>&1); code=$?
kill "$watcher" 2>/dev/null
printf '%s\n' "$out" | grep -E '^(ok|FAIL) |^stopped' | sed 's/^/  | /'
verdict "the damage was done" "$(cat /tmp/damage-done 2>/dev/null || echo "not done")" "damaged"
verdict "it stopped" "$code" "1"
verdict "at the restore check" "$(printf '%s\n' "$out" | sed -n 's/^FAIL *[0-9]*\/[0-9]* \(.*\)$/\1/p' | head -1)" "it is whole, and it decrypts"
verdict "nothing deployed" "$(at "$out" "prod deployed on" | grep -c .)" "0"
verdict "prod still runs its version" "$(running)" "$before_version"
verdict "and the record says the same" "$(recorded)" "$before_recorded"
verdict "prod's entries, as before" "$(entries)" "$before_entries"
pkill -f "inotifywait -q -m -e moved_to" 2>/dev/null; rm -f /tmp/damage-done
echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
