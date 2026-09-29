#!/bin/sh
# Can the machine announce allvibe.local on the home network (D66, question 1)?
# Tried on the test host: Avahi from Debian, a name published by the service
# user through it, and the name resolved, on the machine and from the stand-in
# device's own network namespace (lan-fixtures.sh), which has no Avahi of its
# own and asks over multicast DNS as any device would.
#
#   sh mdns-try.sh <command>
C=${1:-allvibe}
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends avahi-daemon avahi-utils >/dev/null 2>&1 && echo "avahi installed" || echo "avahi NOT installed"
systemctl is-active avahi-daemon
IP=$(ip -4 route get 1.1.1.1 | sed -n 's/.*src \([0-9.]*\).*/\1/p')
echo "the machine's address: $IP"
runuser -u "$C" -- avahi-publish -a -R "$C.local" "$IP" > /tmp/publish.out 2>&1 &
sleep 3
cat /tmp/publish.out
echo "resolved on the machine: $(avahi-resolve -4 -n "$C.local" 2>&1)"
