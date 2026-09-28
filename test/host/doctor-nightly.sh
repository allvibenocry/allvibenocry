#!/bin/sh
# doctor every night, with the backup (D58), probed on the host, as root.
#
#   sh doctor-nightly.sh <command>
#
# Starts the nightly service the way its timer does, and checks that doctor's
# result is kept where the panel will read it; then stops the reverse proxy so
# that one check fails, starts the service again, and checks that the failure
# is in the kept result in plain words, and in `doctor --last`; then puts the
# proxy back and runs it once more. The last line counts what is not as it
# must be.
set -u
C=${1:?usage: doctor-nightly.sh <command>}
DIR=/var/lib/$C/doctor
total=0
wrong=0

verdict() { # $1 label, $2 what was seen, $3 what it must be
  total=$((total + 1))
  if [ "$2" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-56s %-28s %s\n' "$1" "$2" "$v_ok"
}
nightly() { systemctl start "$C-backup.service"; systemctl show -p Result --value "$C-backup.service"; }
field() { node -e "const r=JSON.parse(require('fs').readFileSync('$DIR/latest.json','utf8'));console.log($1)"; }
history() { find "$DIR" -maxdepth 1 -name '2*Z.json' 2>/dev/null | wc -l | tr -d ' '; }

before=$(history)
echo "the nightly service, started as its timer starts it:"
verdict "it ran, backups and restore checks passing" "$(nightly)" "success"
verdict "doctor's result is kept" "$([ -f "$DIR/latest.json" ] && echo kept || echo missing)" "kept"
verdict "one more in its history" "$(($(history) - before))" "1"
verdict "written in the last minute" "$(field "Date.now()-Date.parse(r.at)<60000?'yes':'no'")" "yes"
verdict "every check is in it" "$(field "r.checks.length>=10?'yes':'no'")" "yes"
verdict "no problem found" "$(field "r.problems")" "0"
verdict "owned by the service user, not writable by others" "$(stat -c '%U %A' "$DIR/latest.json" | awk '{print $1, substr($2,9,1)}')" "$C -"

echo "the same, with the reverse proxy stopped:"
docker stop "$C-proxy" >/dev/null
verdict "it ran (a failing check does not fail the backups)" "$(nightly)" "success"
verdict "one problem found" "$(field "r.problems")" "1"
verdict "the failing check, in plain words" "$(field "r.checks.find(c=>c.status==='problem').text.slice(0,20)")" "Reverse proxy: exite"
verdict "doctor --last shows the nightly result, with it" "$("$C" doctor --last | grep -c -E 'as the nightly check found it|Reverse proxy: exited')" "2"
verdict "and says so with its exit code" "$("$C" doctor --last >/dev/null; echo $?)" "1"
verdict "two more in its history" "$(($(history) - before))" "2"

echo "the proxy back, and the service once more:"
docker start "$C-proxy" >/dev/null
for _ in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$C-proxy")" = healthy ] && break; sleep 1; done
verdict "it ran" "$(nightly)" "success"
verdict "no problem found" "$(field "r.problems")" "0"
verdict "doctor --last, all well" "$("$C" doctor --last >/dev/null; echo $?)" "0"
echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
