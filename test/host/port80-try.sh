#!/bin/sh
# Can the proxy bind port 80 (D66, question 7)? Tried on the real Docker, with
# the proxy's own pinned image, on the host's network as the proxy runs: as
# its unprivileged user, with and without the one capability, and with
# no-new-privileges, as the proxy has it. Prints what binding said, and the
# process's effective capabilities.
#
#   sh port80-try.sh
IMAGE=${IMAGE:-nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:4714e0b1b2577eaa1a6131d07c958b67f0eb68e6d0521e90c6e5287db8cf0bc5}
try() { # $1 label, then docker run options
  label=$1
  shift
  out=$(docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges:true "$@" --entrypoint sh "$IMAGE" -c \
    'grep CapEff /proc/self/status | tr -s "\t " " "; timeout 2 nc -l -s 127.0.0.1 -p "${P:-80}" 2>&1; echo "nc said: $? (124 or 143: it listened until stopped)"' 2>&1 | tr '\n' ' ')
  printf '  %-58s %s\n' "$label" "$out"
}
echo "the lowest port any user may bind here: $(sysctl -n net.ipv4.ip_unprivileged_port_start) (a real Debian machine: 1024; a container's own network: 0)"
echo "port 80, from the proxy's image on the host's network:"
try "its user, no capability" --user 101
try "its user, NET_BIND_SERVICE added" --user 101 --cap-add NET_BIND_SERVICE
try "root, NET_BIND_SERVICE only" --user 0 --cap-add NET_BIND_SERVICE
try "its user, port 8098 (the control: no privilege needed)" --user 101 -e P=8098
