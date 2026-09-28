#!/usr/bin/env bash
# Project containers kept off this machine's own ports and off the home network
# (D41). install.sh installs this as /usr/local/sbin/<command>-firewall and runs
# it as root; the CLI, which runs as the service user, never touches the
# firewall.
#
#   <command>-firewall apply             put the rules in place (idempotent)
#   <command>-firewall check [--repair]  say whether they are in place; with
#                                        --repair, put them back if they are not
#
# The rules key on the suite's own address pools (D16): every project container
# gets its address from them, and nothing else on the machine does.
#
#   <COMMAND>-FWD, the first rule of Docker's DOCKER-USER chain, for traffic the
#   machine routes: between two addresses of the pools, it is left to Docker's
#   own rules (a container reaches its own network's containers and no other);
#   from the pools to any private, link-local, shared or multicast range, where
#   the home network, the router and every other device live, it is refused.
#   The public internet stays reachable.
#
#   <COMMAND>-IN, the first rule of INPUT, for traffic to the machine itself:
#   every new connection from the pools is refused, whatever the port. Replies
#   to connections the machine made (the proxy reaching an app) pass, and
#   nothing from anywhere else is touched, so other machines on the home
#   network reach the proxy exactly as before.
#
# The settings are in /etc/<command>/firewall.conf, written by install.sh:
#   COMMAND=<command>  POOLS="<base/size> ..."  STATUS=<file for doctor>
set -Eeuo pipefail

# Installed as <command>-firewall, so its own name says whose it is.
NAME=$(basename "$0")
CONF=${FIREWALL_CONF:-/etc/${NAME%-firewall}/firewall.conf}
[ -r "$CONF" ] || { echo "$NAME: $CONF is missing; install.sh writes it" >&2; exit 2; }
# shellcheck source=/dev/null
. "$CONF"
: "${COMMAND:?firewall.conf does not set COMMAND}" "${POOLS:?firewall.conf does not set POOLS}" "${STATUS:?firewall.conf does not set STATUS}"

PREFIX=$(printf '%s' "$COMMAND" | tr '[:lower:]' '[:upper:]')
FWD="$PREFIX-FWD"
IN="$PREFIX-IN"
# Everything that is not the public internet: the private ranges (RFC 1918),
# link-local, the shared range carriers and VPNs use, and multicast.
BLOCKED="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 224.0.0.0/4"

ipt() { iptables -w 10 "$@"; }

# The two chains, exactly as `iptables -S` prints them, which is what `check`
# compares against. Generated once, used for both.
expected() {
  local pool to
  echo "-N $FWD"
  for pool in $POOLS; do
    for to in $POOLS; do echo "-A $FWD -s $pool -d $to -j RETURN"; done
  done
  for pool in $POOLS; do
    for to in $BLOCKED; do echo "-A $FWD -s $pool -d $to -j REJECT --reject-with icmp-admin-prohibited"; done
  done
  echo "-N $IN"
  for pool in $POOLS; do
    echo "-A $IN -s $pool -p tcp -m conntrack --ctstate NEW -j REJECT --reject-with tcp-reset"
    echo "-A $IN -s $pool -m conntrack --ctstate NEW -j REJECT --reject-with icmp-admin-prohibited"
  done
}

# A chain's jump to ours as its first rule, and only once: added first, then
# any other copy removed, so there is never a moment without it.
first_jump() {
  local chain=$1 target=$2 lines
  if [ "$(ipt -S "$chain" | sed -n 2p)" != "-A $chain -j $target" ]; then
    ipt -I "$chain" 1 -j "$target"
  fi
  lines=$(ipt -S "$chain" | tail -n +2 | grep -n -x -- "-A $chain -j $target" | cut -d: -f1 | sort -rn || true)
  for line in $lines; do
    [ "$line" -gt 1 ] && ipt -D "$chain" "$line"
  done
  return 0
}

apply() {
  # DOCKER-USER is Docker's chain for rules of its users. At boot this runs
  # before Docker, which keeps a DOCKER-USER it finds and jumps to it first.
  ipt -N DOCKER-USER 2>/dev/null || true
  # Each chain's rules replaced in one go: declaring a chain flushes it.
  { echo "*filter"; expected | sed 's/^-N \(.*\)$/:\1 - [0:0]/'; echo "COMMIT"; } | iptables-restore -w 10 --noflush
  first_jump DOCKER-USER "$FWD"
  first_jump INPUT "$IN"
}

# What is missing of the suite's own rules, one line each; nothing when all is in place.
missing_ours() {
  local want have
  want=$(expected)
  have=$( (ipt -S "$FWD" 2>/dev/null; ipt -S "$IN" 2>/dev/null) || true)
  if [ "$want" != "$have" ]; then echo "the rules in $FWD and $IN are not the suite's"; fi
  [ "$(ipt -S DOCKER-USER 2>/dev/null | sed -n 2p)" = "-A DOCKER-USER -j $FWD" ] || echo "DOCKER-USER does not start with $FWD"
  [ "$(ipt -S INPUT 2>/dev/null | sed -n 2p)" = "-A INPUT -j $IN" ] || echo "INPUT does not start with $IN"
}

# And Docker's own jump, without which nothing in DOCKER-USER is ever reached.
# Not asked at apply: at boot the rules go in before Docker starts and adds it.
missing() {
  missing_ours
  [ "$(ipt -S FORWARD 2>/dev/null | sed -n 2p)" = "-A FORWARD -j DOCKER-USER" ] || echo "FORWARD does not start with Docker's jump to DOCKER-USER"
}

# For doctor, which runs as the service user and cannot read the firewall.
write_status() {
  local ok=$1 repaired=$2 problems=$3 dir tmp
  dir=$(dirname "$STATUS")
  [ -d "$dir" ] || return 0
  tmp=$(mktemp "$STATUS.XXXXXX")
  printf '{\n  "checked": "%s",\n  "ok": %s,\n  "repaired": %s,\n  "pools": "%s",\n  "problems": [%s]\n}\n' \
    "$(date -u +%FT%TZ)" "$ok" "$repaired" "$POOLS" \
    "$(printf '%s' "$problems" | sed 's/.*/"&"/' | paste -sd, -)" > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$STATUS"
}

case "${1:-}" in
  apply)
    apply
    problems=$(missing_ours)
    if [ -n "$problems" ]; then
      write_status false false "$problems"
      printf '%s: applied, and still not in place:\n%s\n' "$NAME" "$problems" >&2
      exit 1
    fi
    write_status true false ""
    echo "$NAME: in place: containers from $POOLS cannot reach this machine or any private, link-local, shared or multicast range"
    ;;
  check)
    problems=$(missing)
    if [ -z "$problems" ]; then
      write_status true false ""
      echo "$NAME: in place"
      exit 0
    fi
    if [ "${2:-}" = "--repair" ]; then
      apply
      again=$(missing)
      if [ -z "$again" ]; then
        write_status true true "$problems"
        printf '%s: was not in place, and is put back:\n%s\n' "$NAME" "$problems"
        exit 0
      fi
      problems=$again
    fi
    write_status false false "$problems"
    printf '%s: NOT in place:\n%s\n' "$NAME" "$problems" >&2
    exit 1
    ;;
  *)
    echo "usage: $NAME apply | check [--repair]" >&2
    exit 2
    ;;
esac
