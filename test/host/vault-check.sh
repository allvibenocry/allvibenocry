#!/bin/sh
# The key vault (D37), checked on the host: a key's value appears nowhere it
# must not, and dev never has prod's.
#
#   sh vault-check.sh <command> <project> <file: dev's value> <file: prod's value> [<file: the agent's value>]
#
# Each file holds one value, the one that was given to `key set`. Values are
# counted and compared by hash, and never printed: every line below is a count
# or a verdict. "0" is the answer everywhere except the copy in memory, which
# the app reads and which must hold it once, to show the counting works.
set -u
C=${1:?usage: vault-check.sh <command> <project> <dev value file> <prod value file> [agent value file]}
P=${2:?project}
DEV=${3:?dev value file}
PROD=${4:?prod value file}
AGENT=${5:-}
STATE=/var/lib/$C
REPO=$STATE/projects/$P/repo
VAULT=$STATE/projects/$P/vault
TARGET=$(sed -n 's/.*"backupTarget": *"\([^"]*\)".*/\1/p' /etc/$C/config.json)

count() { grep -a -F -c -f "$1" || true; }   # lines on stdin holding the value in file $1
value_hash() { printf '%s' "$(cat "$1")" | sha256sum | cut -c1-64; }

check() { # $1 label, $2 value file, $3 scope
  f=$2
  echo "$1 ($3):"
  echo "  command outputs and run records:      $( (cat /root/*.out 2>/dev/null; cat $STATE/runs/*.json) | count "$f")"
  echo "  the journal:                          $(journalctl -o cat --no-pager 2>/dev/null | count "$f")"
  echo "  install log:                          $(cat /var/log/$C-install.log 2>/dev/null | count "$f")"
  echo "  docker inspect, every container:      $(docker inspect $(docker ps -aq) 2>/dev/null | count "$f")"
  echo "  every container's log:                $(for c in $(docker ps -aq); do docker logs "$c" 2>&1; done | count "$f")"
  echo "  every process's arguments:            $(ps -eo args | count "$f")"
  echo "  every process's environment:          $(cat /proc/[0-9]*/environ 2>/dev/null | tr '\0' '\n' | count "$f")"
  echo "  the repository, every commit:         $(runuser -u $C -- git -C "$REPO" log -p --all | count "$f")"
  echo "  the repository's working tree:        $(grep -a -r -F -l -f "$f" "$REPO" 2>/dev/null | wc -l)"
  echo "  the vault's files on disk:            $(grep -a -r -F -l -f "$f" "$VAULT" 2>/dev/null | wc -l)"
  echo "  the backup target:                    $(grep -a -r -F -l -f "$f" "$TARGET" 2>/dev/null | wc -l)"
  echo "  the agent's activity log, transcripts: $(grep -a -r -F -l -f "$f" "$STATE/projects/$P/agent" 2>/dev/null | wc -l)"
  echo "  in memory, for the app (should be 1): $(grep -a -r -F -l -f "$f" /run/$C/keys/$P/$3 2>/dev/null | wc -l)"
}

check "dev's value" "$DEV" dev
check "prod's value" "$PROD" prod
[ -n "$AGENT" ] && check "the agent's value" "$AGENT" agent

echo "from inside dev's app ($C-$P-dev-app):"
echo "  its secrets:              $(docker exec $C-$P-dev-app ls /run/secrets | tr '\n' ' ')"
dev_seen=$(docker exec $C-$P-dev-app sh -c 'for f in /run/secrets/*; do sha256sum "$f"; done' | cut -c1-64)
echo "  holds dev's value:        $(echo "$dev_seen" | grep -c "$(value_hash "$DEV")")"
echo "  holds prod's value:       $(echo "$dev_seen" | grep -c "$(value_hash "$PROD")")"
[ -n "$AGENT" ] && echo "  holds the agent's value:  $(echo "$dev_seen" | grep -c "$(value_hash "$AGENT")")"
echo "  /run/$C inside it:        $(docker exec $C-$P-dev-app sh -c "[ -e /run/$C ] && echo PRESENT || echo absent")"
echo "  mounts of dev's containers from prod's keys: $(docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' $C-$P-dev-app $C-$P-dev-db | tr ' ' '\n' | grep -c "/keys/$P/prod/")"
echo "from inside prod's app ($C-$P-prod-app):"
prod_seen=$(docker exec $C-$P-prod-app sh -c 'for f in /run/secrets/*; do sha256sum "$f"; done' | cut -c1-64)
echo "  holds prod's value:       $(echo "$prod_seen" | grep -c "$(value_hash "$PROD")")"
echo "  holds dev's value:        $(echo "$prod_seen" | grep -c "$(value_hash "$DEV")")"
echo "  its environment names the file, not the value: $(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $C-$P-prod-app | grep '_FILE=/run/secrets/' | grep -v DATABASE | tr '\n' ' ')"
