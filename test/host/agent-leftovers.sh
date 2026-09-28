#!/bin/sh
# What a session of the agent leaves on this machine (D46): nothing on disk
# while it runs, and nothing at all once it is stopped. Run on the host, as
# root, with the agent running; it stops the agent itself.
#
#   sh agent-leftovers.sh <command> <project>
#
# It makes three random markers, kept in memory only (/dev/shm), and never on a
# command line:
#
#   - a login: written into the agent's home, as Claude Code keeps a login on
#     Linux (~/.claude/.credentials.json, mode 0600);
#   - typed: typed into `<command> agent shell <project>`, through a terminal,
#     as a person types;
#   - the control: written by the agent into its working copy, which is on this
#     machine's disk, so that the search is seen finding what the agent puts on
#     disk before it is trusted to find nothing.
#
# Then: both markers inside the agent; neither on this machine's disk while it
# runs; `<command> agent stop`; and neither anywhere after: every file on the
# machine (all but /proc, /sys and /dev), its journal, and Docker's containers
# and volumes. The last line counts what is not as it must be.
set -u
C=${1:?usage: agent-leftovers.sh <command> <project>}
P=${2:?project}
A=$C-$P-agent
total=0
wrong=0

verdict() { # $1 label, $2 what was seen, $3 "blocked" or "reached"
  total=$((total + 1))
  case "$2" in present|[1-9]*) v_seen=reached ;; *) v_seen=blocked ;; esac
  if [ "$v_seen" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-58s %-10s %s\n' "$1" "$2" "$v_ok"
}
marker() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# Every file on this machine that holds one of the patterns in $1: all of it but /proc, /sys and /dev.
on_disk() {
  for d in /*; do
    case "$d" in /proc|/sys|/dev) continue ;; esac
    grep -rlsF -f "$1" "$d" 2>/dev/null
  done | wc -l
}

[ "$(docker inspect -f '{{.State.Running}}' "$A" 2>/dev/null)" = true ] || { echo "the agent of $P is not running: $C agent start $P first"; exit 2; }
mem=$(mktemp -d /dev/shm/agent-leftovers.XXXXXX)
chmod 700 "$mem"
trap 'rm -rf "$mem"' EXIT
marker > "$mem/login"
marker > "$mem/typed"
marker > "$mem/control"
{ cat "$mem/login"; echo; cat "$mem/typed"; echo; } > "$mem/session"
volumes_before=$(docker volume ls -q | wc -l)

echo "while the agent runs:"
{ printf '{"claudeAiOauth":{"accessToken":"'; cat "$mem/login"; printf '"}}'; } |
  docker exec -i "$A" sh -c 'umask 077; cat > "$HOME/.claude/.credentials.json"'
# Typed into the agent's shell through a terminal, the way a person types: a
# pseudo-terminal from script(1), its record thrown away, its screen too.
# shellcheck disable=SC2016 # $HOME is the agent's, expanded by the shell it is typed into
{ sleep 3; printf 'cat > "$HOME/typed.txt" <<"END"\n'; cat "$mem/typed"; printf '\nEND\n'; sleep 2; printf 'exit\n'; sleep 3; } |
  script -qec "$C agent shell $P -- sh" /dev/null > /dev/null 2>&1
verdict "the login marker, in the agent's ~/.claude" "$(docker exec "$A" sh -c 'cat "$HOME/.claude/.credentials.json"' | grep -cF -f "$mem/login")" reached
verdict "the typed marker, in the agent's home" "$(docker exec "$A" sh -c 'cat "$HOME/typed.txt" 2>/dev/null' | grep -cF -f "$mem/typed")" reached
docker exec -i "$A" sh -c 'cat > /workspace/.leftovers-control' < "$mem/control"
verdict "the control, written to its working copy, on disk" "$(on_disk "$mem/control")" reached
docker exec "$A" rm -f /workspace/.leftovers-control
verdict "the control, once removed" "$(on_disk "$mem/control")" blocked
verdict "the login or typed marker, on this machine's disk" "$(on_disk "$mem/session")" blocked
verdict "either, in the agent's log" "$(docker logs "$A" 2>&1 | grep -cF -f "$mem/session")" blocked
verdict "either, in the gate's log" "$(docker logs "$A-egress" 2>&1 | grep -cF -f "$mem/session")" blocked

echo "$C agent stop $P:"
"$C" agent stop "$P" 2>&1 | sed 's/^/  | /'
echo "after it:"
verdict "the agent's container" "$(docker ps -aq --filter "name=^$A\$" | wc -l)" blocked
verdict "the gate's container" "$(docker ps -aq --filter "name=^$A-egress\$" | wc -l)" blocked
verdict "new Docker volumes" "$(($(docker volume ls -q | wc -l) - volumes_before))" blocked
verdict "the login or typed marker, anywhere on this machine" "$(on_disk "$mem/session")" blocked
verdict "either, in the journal" "$(journalctl --no-pager -o cat 2>/dev/null | grep -cF -f "$mem/session")" blocked
echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
