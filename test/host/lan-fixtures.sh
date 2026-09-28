#!/bin/sh
# Stand-ins, on the test host, for what a real machine has around it (D41):
#
#   - an SSH server on the machine itself (port 22);
#   - one other service listening on the machine itself (port 9999);
#   - another device on the home network: a network namespace of its own,
#     joined to the machine by a virtual cable, with a service on port 8080.
#
# Each is a systemd unit, so it comes back after the test host restarts. The
# probes (app-isolation.sh, agent-isolation.sh) try all three from inside the
# containers, and from the machine itself, where all three must answer: that is
# what shows a refusal inside a container is the firewall, not an empty address.
#
#   sh lan-fixtures.sh        as root, on the test host only
set -eu
DEVICE_NS=lan-device

echo "fixtures:"
if ! command -v sshd >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends openssh-server >/dev/null
fi
systemctl enable --now ssh >/dev/null 2>&1
echo "  SSH on port 22: $(systemctl is-active ssh)"

# A file, not `node -e`: systemd would turn the \n in a unit's command line into a line break.
mkdir -p /usr/local/lib/probe
cat >/usr/local/lib/probe/listener.js <<'EOF'
// Test host fixture: a service on a port of its own, answering with its name.
const [port, host, name] = process.argv.slice(2);
// A client that hangs up at once, as every probe does, is not a reason to stop.
require("net").createServer((s) => {
  s.on("error", () => {});
  s.end(`${name}\n`);
}).listen(Number(port), host);
EOF
cat >/etc/systemd/system/probe-listener.service <<'EOF'
[Unit]
Description=Test host fixture: another service on the machine itself, port 9999

[Service]
ExecStart=/usr/bin/node /usr/local/lib/probe/listener.js 9999 0.0.0.0 listener
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# The device: its own network namespace, its end of the cable at 10.99.0.2, the
# machine's end at 10.99.0.1, and a service on 8080. Its default route is the
# machine, as a home network's devices reach each other through their router.
cat >/usr/local/sbin/probe-lan-device <<EOF
#!/bin/sh
set -eu
ip netns del $DEVICE_NS 2>/dev/null || true
ip link del lan0 2>/dev/null || true
ip netns add $DEVICE_NS
ip link add lan0 type veth peer name eth0 netns $DEVICE_NS
ip addr add 10.99.0.1/24 dev lan0
ip link set lan0 up
ip -n $DEVICE_NS addr add 10.99.0.2/24 dev eth0
ip -n $DEVICE_NS link set eth0 up
ip -n $DEVICE_NS link set lo up
ip -n $DEVICE_NS route add default via 10.99.0.1
exec ip netns exec $DEVICE_NS /usr/bin/node /usr/local/lib/probe/listener.js 8080 0.0.0.0 device
EOF
chmod 755 /usr/local/sbin/probe-lan-device
cat >/etc/systemd/system/probe-lan-device.service <<'EOF'
[Unit]
Description=Test host fixture: another device on the home network, with a service on 8080
After=network.target

[Service]
ExecStart=/usr/local/sbin/probe-lan-device
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now probe-listener.service probe-lan-device.service >/dev/null 2>&1
sleep 2
echo "  a service on port 9999: $(systemctl is-active probe-listener.service)"
echo "  another device on the home network, 10.99.0.2, port 8080: $(systemctl is-active probe-lan-device.service)"
