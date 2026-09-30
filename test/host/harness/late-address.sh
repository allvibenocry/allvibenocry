#!/bin/sh
# Test host only (D80), for restart-probe.mjs: the machine's address comes
# late, as a home router's answer can at boot. Never part of the suite.
#
#   late-address.sh take    before containerd and Docker start: the test
#                           host's address taken off its network card, and
#                           what it was kept in /run
#   late-address.sh give N  N seconds later: the address and its default route
#                           put back (a unit of its own, which the boot does
#                           not wait for)
state=/run/test-host-late-address
case "$1" in
  take)
    dev=$(ip -4 route show default | awk '{print $5; exit}')
    addr=$(ip -4 -o addr show dev "$dev" | awk '{print $4; exit}')
    gw=$(ip -4 route show default | awk '{print $3; exit}')
    if [ -z "$dev" ] || [ -z "$addr" ] || [ -z "$gw" ]; then
      echo "no address to take away" >&2
      exit 1
    fi
    echo "$dev $addr $gw" > "$state"
    ip addr del "$addr" dev "$dev"
    echo "the address $addr taken off $dev"
    ;;
  give)
    sleep "${2:-25}"
    read -r dev addr gw < "$state" || exit 1
    ip addr add "$addr" dev "$dev" && ip route add default via "$gw" && echo "the address $addr is back on $dev"
    ;;
  *)
    echo "usage: late-address.sh take | give <seconds>" >&2
    exit 2
    ;;
esac
