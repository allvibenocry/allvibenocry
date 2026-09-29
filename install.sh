#!/usr/bin/env bash
# Turns a fresh Debian 13 x86-64 machine into a host for the suite (D8, D11).
#
#   sudo ./install.sh
#
# Run it from an unpacked bundle (`npm run bundle` makes one), which holds this
# script, brand.conf and the CLI. It is idempotent: run it again and it changes
# nothing, and says so.
#
# It stops at the first failure (rule 7), naming the step, what went wrong and
# what would have to be true. It never prompts, and never prints a secret
# (rule 4): the keys it creates go into files only the service user can read.
set -Eeuo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# The names, defined once (D1).
# shellcheck source-path=SCRIPTDIR source=brand.conf
. "$HERE/brand.conf"
CMD=$COMMAND_NAME
SERVICE_USER=$CMD
INSTALL_DIR=/opt/$CMD
ETC_DIR=/etc/$CMD
STATE_DIR=/var/lib/$CMD
OVERRIDES=$ETC_DIR/test-overrides
WRAPPER=/usr/local/bin/$CMD
UNIT_SERVICE=/etc/systemd/system/$CMD-backup.service
UNIT_TIMER=/etc/systemd/system/$CMD-backup.timer
UNIT_KEYS=/etc/systemd/system/$CMD-keys.service
TMPFILES=/etc/tmpfiles.d/$CMD.conf
RUN_DIR=/run/$CMD
FIREWALL=/usr/local/sbin/$CMD-firewall
FIREWALL_CONF=$ETC_DIR/firewall.conf
UNIT_FIREWALL=/etc/systemd/system/$CMD-firewall.service
UNIT_FIREWALL_CHECK=/etc/systemd/system/$CMD-firewall-check.service
UNIT_FIREWALL_TIMER=/etc/systemd/system/$CMD-firewall-check.timer
UNIT_ENGINE=/etc/systemd/system/$CMD-engine.service
UNIT_MDNS=/etc/systemd/system/$CMD-mdns.service
PANEL_USER=$CMD-panel
LOG=/var/log/$CMD-install.log

# Docker's apt signing key, as published in Docker's installation guide.
DOCKER_KEY_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
# Under 8 GB installed: the kernel reports a little less than what is
# installed, so anything under 7 GiB has less than 8 GB.
LOW_MEMORY_MB=7168
# Where Docker takes app networks from (D16): the first that does not overlap
# a network this machine is already on.
POOLS=(172.20.0.0/14 10.201.0.0/16)

export DEBIAN_FRONTEND=noninteractive

STEPS=16
# Set when this run installs a different version: the engine then restarts on it.
NEW_RELEASE=0
N=0
STEP=""
NEED=""
CHANGES=0
WARNINGS=0

step() {
  N=$((N + 1)); STEP=$1; NEED=$2
  printf '\n[%d/%d] %s\n' "$N" "$STEPS" "$STEP"
}
changed() { CHANGES=$((CHANGES + 1)); printf '      changed: %s\n' "$*"; }
unchanged() { printf '      unchanged: %s\n' "$*"; }
note() { printf '      %s\n' "$*"; }
warn() {
  WARNINGS=$((WARNINGS + 1))
  printf '\n  ! %s\n' "$1"
  shift
  for line in "$@"; do printf '    %s\n' "$line"; done
}
fail() {
  trap - ERR
  printf '\nFAILED at step %d/%d: %s\n' "$N" "$STEPS" "$STEP" >&2
  printf '  %s\n' "$1" >&2
  printf '\n  what would have to be true:\n  %s\n' "${2:-$NEED}" >&2
  printf '\nNothing after this step was attempted. The full log is %s.\n' "$LOG" >&2
  exit 1
}
on_error() {
  local code=$? line=$1
  fail "a command failed with exit $code (install.sh line $line)"
}
trap 'on_error $LINENO' ERR

# A command whose output belongs in the log, not on the screen. On failure,
# its last lines are shown.
quiet() {
  if ! "$@" >>"$LOG" 2>&1; then
    tail -n 15 "$LOG" | sed 's/^/      | /' >&2
    return 1
  fi
}

# The test overrides (D14): honoured only inside a Docker container.
overrides_active() {
  [ -f "$OVERRIDES" ] && [ -f /.dockerenv ] && [ "$(cat /run/systemd/container 2>/dev/null || true)" = docker ]
}
override() {
  if overrides_active; then sed -n "s/^$1=//p" "$OVERRIDES" | tail -n 1; fi
}

# ---------------------------------------------------------------------------
step "This machine" "run it as root, on Debian 13 (trixie), on an x86-64 machine (D8)"

[ "$(id -u)" = 0 ] || fail "install.sh is not running as root" "run it as root: sudo ./install.sh"
: >>"$LOG" && chmod 600 "$LOG"
printf '\n==== install.sh %s\n' "$(date -u +%FT%TZ)" >>"$LOG"

os_id=$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"')
os_version=$(sed -n 's/^VERSION_ID=//p' /etc/os-release | tr -d '"')
os_pretty=$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"')
if [ "$os_id" != debian ] || [ "$os_version" != 13 ]; then
  fail "this is ${os_pretty:-an unknown system}, not Debian 13" "install on Debian 13 (trixie); version 1 supports no other system (D8)"
fi
machine=$(uname -m)
architecture=$(dpkg --print-architecture)
if [ "$machine" != x86_64 ] || [ "$architecture" != amd64 ]; then
  fail "this is a $machine ($architecture) machine, not x86-64" "install on an x86-64 (amd64) machine; version 1 supports no other architecture (D8)"
fi
note "$os_pretty on x86-64, as root"
if overrides_active; then
  note "TEST HOST: overrides active in $OVERRIDES ($(grep -v '^#' "$OVERRIDES" | grep . | paste -sd ' ' - || true))"
elif [ -f "$OVERRIDES" ]; then
  note "$OVERRIDES exists, but this is not a Docker test container, so it is ignored"
fi

# ---------------------------------------------------------------------------
step "Memory and system disk" "nothing: these are warnings, and the installation continues"

memory_mb=$(override memory-mb)
memory_source=""
if [ -n "$memory_mb" ]; then
  memory_source=" (declared by the test host)"
else
  memory_mb=$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1024 ))
fi
memory_gb=$(awk -v mb="$memory_mb" 'BEGIN { printf (mb < 10240 ? "%.1f" : "%.0f"), mb / 1024 }')
if [ "$memory_mb" -lt "$LOW_MEMORY_MB" ]; then
  warn "This computer has about $memory_gb GB of memory$memory_source. $PRODUCT_NAME works best with 8 GB or more." \
    "It will work, but running the dev and prod copies of several apps at the same time" \
    "may be slow, and the computer may run out of memory. More memory helps most."
else
  note "memory: $memory_gb GB$memory_source"
fi

disk=$(override system-disk)
disk_source=""
if [ -n "$disk" ]; then
  disk_source=" (declared by the test host)"
else
  root_source=$(findmnt -n -o SOURCE / || true)
  disk=unknown
  if [[ $root_source == /dev/* ]]; then
    case "$(lsblk -n -d -o ROTA "$root_source" 2>/dev/null | tr -d ' ' || true)" in
      1) disk=rotational ;;
      0) disk=ssd ;;
    esac
  fi
fi
case "$disk" in
  rotational)
    warn "This computer's system disk is a spinning hard disk, not an SSD$disk_source." \
      "Everything will work, but installing, building and starting apps will be" \
      "noticeably slow. An SSD is the single biggest improvement for an old computer." ;;
  ssd) note "system disk: SSD$disk_source" ;;
  *) note "system disk: its type could not be determined" ;;
esac

# ---------------------------------------------------------------------------
step "Packages from Debian" "the machine can reach Debian's package mirrors (apt-get update works)"

debian_packages=(ca-certificates curl gnupg age git nodejs avahi-daemon avahi-utils)
missing=()
for package in "${debian_packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || missing+=("$package")
done
if [ ${#missing[@]} -eq 0 ]; then
  unchanged "${debian_packages[*]}"
else
  quiet apt-get update
  quiet apt-get install -y --no-install-recommends "${missing[@]}"
  changed "installed ${missing[*]}"
fi
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 20 ] || fail "Node.js $node_major is too old" "Debian 13's nodejs package, version 20 or later"
note "Node.js $(node -p 'process.versions.node') (Debian's own package, D15)"

# ---------------------------------------------------------------------------
step "Docker Engine, from Docker's own repository" "the machine can reach download.docker.com, and Docker's signing key has the published fingerprint"

keyring=/etc/apt/keyrings/docker.asc
sources=/etc/apt/sources.list.d/docker.sources
key_fingerprint() {
  local home
  home=$(mktemp -d)
  GNUPGHOME=$home gpg --batch --with-colons --show-keys "$1" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }' || true
  rm -rf "$home"
}
if [ ! -f "$keyring" ]; then
  install -m 0755 -d /etc/apt/keyrings
  downloaded=$(mktemp)
  quiet curl -fsSL https://download.docker.com/linux/debian/gpg -o "$downloaded"
  [ "$(key_fingerprint "$downloaded")" = "$DOCKER_KEY_FINGERPRINT" ] ||
    fail "the key downloaded from download.docker.com does not have Docker's published fingerprint" \
      "Docker's apt signing key has fingerprint $DOCKER_KEY_FINGERPRINT"
  install -m 0644 "$downloaded" "$keyring"
  rm -f "$downloaded"
  changed "Docker's signing key, fingerprint checked"
else
  [ "$(key_fingerprint "$keyring")" = "$DOCKER_KEY_FINGERPRINT" ] ||
    fail "$keyring is not Docker's signing key" "the key at $keyring has fingerprint $DOCKER_KEY_FINGERPRINT"
  unchanged "Docker's signing key"
fi

sources_content="Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: amd64
Signed-By: $keyring"
if [ "$(cat "$sources" 2>/dev/null || true)" != "$sources_content" ]; then
  printf '%s\n' "$sources_content" >"$sources"
  changed "$sources"
else
  unchanged "$sources"
fi

docker_packages=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
missing=()
for package in "${docker_packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || missing+=("$package")
done
if [ ${#missing[@]} -eq 0 ]; then
  unchanged "${docker_packages[*]}"
else
  quiet apt-get update
  quiet apt-get install -y "${missing[@]}"
  changed "installed ${missing[*]}"
fi
if [ "$(systemctl is-enabled docker 2>/dev/null || true)" != enabled ] || ! systemctl is-active --quiet docker; then
  quiet systemctl enable --now docker
  changed "Docker started, and starts at boot"
fi
note "Docker Engine $(docker version --format '{{.Server.Version}}'), Compose $(docker compose version --short)"

# ---------------------------------------------------------------------------
step "Docker's address pool and logs" "/etc/docker/daemon.json is valid JSON, and one of ${POOLS[*]} does not overlap this machine's networks"

daemon_result=$(node - /etc/docker/daemon.json "${POOLS[@]}" <<'NODE'
// Merges the suite's settings into daemon.json, keeping anything else in it.
// An address pool that is already set is kept: changing it under existing
// networks would strand them.
const fs = require("fs");
const { execFileSync } = require("child_process");
const [file, ...candidates] = process.argv.slice(2);
let current = {};
try {
  current = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") { console.log("invalid"); process.exit(0); }
}
const toInt = (ip) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const range = (cidr) => {
  const [ip, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(toInt(ip) / size) * size;
  return [start, start + size - 1];
};
const overlaps = (a, b) => { const [a0, a1] = range(a); const [b0, b1] = range(b); return a0 <= b1 && b0 <= a1; };
const routes = execFileSync("ip", ["-4", "route", "show"], { encoding: "utf8" })
  .split("\n").map((line) => line.split(" ")[0]).filter((dest) => /^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(dest))
  .map((dest) => (dest.includes("/") ? dest : `${dest}/32`));
let pools = current["default-address-pools"];
if (!pools) {
  const free = candidates.find((candidate) => !routes.some((route) => overlaps(candidate, route)));
  if (!free) { console.log("nopool"); process.exit(0); }
  pools = [{ base: free, size: 24 }];
}
const next = {
  ...current,
  "default-address-pools": pools,
  "log-driver": current["log-driver"] ?? "local",
  "log-opts": current["log-opts"] ?? { "max-size": "10m", "max-file": "3" },
  "live-restore": current["live-restore"] ?? true,
};
const text = `${JSON.stringify(next, null, 2)}\n`;
const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
if (!same) { fs.mkdirSync("/etc/docker", { recursive: true }); fs.writeFileSync(file, text); }
console.log(`${same ? "unchanged" : "changed"} ${pools.map((p) => p.base).join(",")}`);
NODE
)
case "$daemon_result" in
  invalid) fail "/etc/docker/daemon.json is not valid JSON" ;;
  nopool) fail "every candidate address pool overlaps a network this machine is on" ;;
  changed*)
    quiet systemctl restart docker
    changed "/etc/docker/daemon.json: address pool ${daemon_result#changed }, local logs with rotation, live restore; Docker restarted" ;;
  unchanged*) unchanged "/etc/docker/daemon.json (address pool ${daemon_result#unchanged })" ;;
  *) fail "could not read or write /etc/docker/daemon.json ($daemon_result)" ;;
esac
# The pools every project container takes its address from: what the firewall keys on (D41).
ADDRESS_POOLS=$(printf '%s' "${daemon_result#* }" | tr ',' ' ')

# ---------------------------------------------------------------------------
step "The service user" "useradd and usermod work"

if ! getent group "$SERVICE_USER" >/dev/null; then
  groupadd --system "$SERVICE_USER"
  changed "group $SERVICE_USER"
fi
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --gid "$SERVICE_USER" --home-dir "$STATE_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  changed "user $SERVICE_USER"
else
  unchanged "user $SERVICE_USER"
fi
if ! id -nG "$SERVICE_USER" | tr ' ' '\n' | grep -qx docker; then
  usermod -aG docker "$SERVICE_USER"
  changed "$SERVICE_USER may use Docker"
else
  unchanged "$SERVICE_USER may use Docker"
fi
# The control panel's own user (D62, D63): its container runs as it, and only
# it and the service user may open the engine's socket. It may do nothing else.
if ! getent group "$PANEL_USER" >/dev/null; then
  groupadd --system "$PANEL_USER"
  changed "group $PANEL_USER"
fi
if ! id -u "$PANEL_USER" >/dev/null 2>&1; then
  useradd --system --gid "$PANEL_USER" --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$PANEL_USER"
  changed "user $PANEL_USER, for the control panel"
else
  unchanged "user $PANEL_USER, for the control panel"
fi

# ---------------------------------------------------------------------------
step "Directories" "the directories can be created and owned"

ensure_dir() {
  local dir=$1 owner=$2 mode=$3
  if [ ! -d "$dir" ]; then
    install -d -o "${owner%%:*}" -g "${owner##*:}" -m "$mode" "$dir"
    changed "$dir"
  elif [ "$(stat -c '%U:%G %a' "$dir")" != "$owner $mode" ]; then
    chown "$owner" "$dir"
    chmod "$mode" "$dir"
    changed "$dir: owner and mode"
  else
    unchanged "$dir"
  fi
}
ensure_dir "$INSTALL_DIR" root:root 755
ensure_dir "$ETC_DIR" "$SERVICE_USER:$SERVICE_USER" 750
ensure_dir "$STATE_DIR" "$SERVICE_USER:$SERVICE_USER" 750
# The engine's socket, for the service user and the panel's group only (D62);
# the panel's sign-in, for the service user only (D64).
ensure_dir "$STATE_DIR/engine" "$SERVICE_USER:$PANEL_USER" 2750
ensure_dir "$STATE_DIR/panel" "$SERVICE_USER:$SERVICE_USER" 700

# ---------------------------------------------------------------------------
step "The $CMD command" "the bundle holds dist/cli.js, brand.conf and VERSION"

if [ ! -f "$HERE/dist/cli.js" ] || [ ! -f "$HERE/VERSION" ]; then
  fail "this directory is not a complete bundle" "run install.sh from a bundle made by npm run bundle"
fi
version=$(cat "$HERE/VERSION")
bundle_id=$(cd "$HERE" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)
release_dir=$INSTALL_DIR/releases/$version-$bundle_id
if [ ! -d "$release_dir" ]; then
  rm -rf "$release_dir.partial"
  mkdir -p "$release_dir.partial"
  cp -a "$HERE/." "$release_dir.partial/"
  chown -R root:root "$release_dir.partial"
  chmod -R go-w,a+rX "$release_dir.partial"
  mv "$release_dir.partial" "$release_dir"
  changed "$release_dir"
else
  unchanged "$release_dir"
fi
if [ "$(readlink "$INSTALL_DIR/current" 2>/dev/null || true)" != "$release_dir" ]; then
  ln -sfn "$release_dir" "$INSTALL_DIR/current"
  NEW_RELEASE=1
  changed "$INSTALL_DIR/current -> $version"
else
  unchanged "$INSTALL_DIR/current -> $version"
fi

wrapper_content="#!/bin/sh
# Generated by $PRODUCT_NAME's install.sh. Runs the CLI as the service user.
set -e
CLI=$INSTALL_DIR/current/dist/cli.js
if [ \"\$(id -u)\" = 0 ]; then exec runuser -u $SERVICE_USER -- env HOME=$STATE_DIR /usr/bin/node \"\$CLI\" \"\$@\"; fi
if [ \"\$(id -un)\" = $SERVICE_USER ]; then exec /usr/bin/node \"\$CLI\" \"\$@\"; fi
echo \"$CMD: run it as root: sudo $CMD \$*\" >&2
exit 1"
if [ "$(cat "$WRAPPER" 2>/dev/null || true)" != "$wrapper_content" ]; then
  printf '%s\n' "$wrapper_content" >"$WRAPPER"
  chmod 755 "$WRAPPER"
  changed "$WRAPPER"
else
  unchanged "$WRAPPER"
fi

# ---------------------------------------------------------------------------
step "The daily backup and restore test" "systemd accepts the timer, and it is enabled and active"

service_content="[Unit]
Description=$PRODUCT_NAME: daily backup and restore test
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_USER
Environment=HOME=$STATE_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/current/dist/cli.js scheduled-backup
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=2h"
timer_content="[Unit]
Description=$PRODUCT_NAME: daily backup and restore test

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target"
units_changed=0
if [ "$(cat "$UNIT_SERVICE" 2>/dev/null || true)" != "$service_content" ]; then
  printf '%s\n' "$service_content" >"$UNIT_SERVICE"; units_changed=1
fi
if [ "$(cat "$UNIT_TIMER" 2>/dev/null || true)" != "$timer_content" ]; then
  printf '%s\n' "$timer_content" >"$UNIT_TIMER"; units_changed=1
fi
if [ $units_changed = 1 ]; then
  systemctl daemon-reload
  changed "$(basename "$UNIT_SERVICE"), $(basename "$UNIT_TIMER")"
else
  unchanged "$(basename "$UNIT_SERVICE"), $(basename "$UNIT_TIMER")"
fi
timer=$(basename "$UNIT_TIMER")
if [ "$(systemctl is-enabled "$timer" 2>/dev/null || true)" != enabled ] || ! systemctl is-active --quiet "$timer"; then
  quiet systemctl enable --now "$timer"
  changed "$timer enabled and started"
else
  unchanged "$timer enabled and active"
fi

# ---------------------------------------------------------------------------
step "The key vault's keys, in memory at boot" "systemd accepts the unit, and $RUN_DIR can be created"

# The vault's keys are encrypted on disk; while apps run, each is decrypted
# into this directory, which is in memory and gone at every shutdown (D37).
tmpfiles_content="# $PRODUCT_NAME: memory-only room for the key vault's keys while apps run (D37).
d $RUN_DIR 0750 $SERVICE_USER $SERVICE_USER -"
if [ "$(cat "$TMPFILES" 2>/dev/null || true)" != "$tmpfiles_content" ]; then
  printf '%s\n' "$tmpfiles_content" >"$TMPFILES"
  changed "$TMPFILES"
else
  unchanged "$TMPFILES"
fi
if [ "$(stat -c '%U:%G %a' "$RUN_DIR" 2>/dev/null || true)" != "$SERVICE_USER:$SERVICE_USER 750" ]; then
  quiet systemd-tmpfiles --create "$TMPFILES"
  changed "$RUN_DIR, in memory"
else
  unchanged "$RUN_DIR, in memory"
fi

# At boot, before Docker starts the apps again, every key goes back into memory.
keys_content="[Unit]
Description=$PRODUCT_NAME: the key vault's keys, into memory, before Docker starts the apps
After=local-fs.target systemd-tmpfiles-setup.service
Before=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=$SERVICE_USER
Group=$SERVICE_USER
Environment=HOME=$STATE_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/current/dist/cli.js keys-unlock

[Install]
WantedBy=multi-user.target"
if [ "$(cat "$UNIT_KEYS" 2>/dev/null || true)" != "$keys_content" ]; then
  printf '%s\n' "$keys_content" >"$UNIT_KEYS"
  systemctl daemon-reload
  changed "$(basename "$UNIT_KEYS")"
else
  unchanged "$(basename "$UNIT_KEYS")"
fi
if [ "$(systemctl is-enabled "$(basename "$UNIT_KEYS")" 2>/dev/null || true)" != enabled ]; then
  quiet systemctl enable "$(basename "$UNIT_KEYS")"
  changed "$(basename "$UNIT_KEYS") enabled: it runs at every boot, before Docker"
else
  unchanged "$(basename "$UNIT_KEYS") enabled"
fi

# ---------------------------------------------------------------------------
step "Project containers kept off this machine and the home network" "iptables accepts the rules, and $FIREWALL check finds them in place"

# The CLI runs as the service user and cannot change the firewall, so the rules
# are put in place here, as root, and by a unit at every boot and every Docker
# restart (D41). They key on the suite's own address pools.
firewall_conf="# $PRODUCT_NAME: the firewall for project containers (D41). Written by install.sh.
COMMAND=$CMD
POOLS=\"$ADDRESS_POOLS\"
STATUS=$RUN_DIR/firewall.json"
if [ "$(cat "$FIREWALL_CONF" 2>/dev/null || true)" != "$firewall_conf" ]; then
  printf '%s\n' "$firewall_conf" >"$FIREWALL_CONF"
  chmod 644 "$FIREWALL_CONF"
  changed "$FIREWALL_CONF: containers from $ADDRESS_POOLS"
else
  unchanged "$FIREWALL_CONF"
fi
if ! cmp -s "$HERE/firewall.sh" "$FIREWALL"; then
  install -m 755 -o root -g root "$HERE/firewall.sh" "$FIREWALL"
  changed "$FIREWALL"
else
  unchanged "$FIREWALL"
fi

# Before Docker at boot, so no container ever runs without the rules; again
# whenever Docker is restarted (PartOf); and checked as soon as Docker is up and
# every five minutes, which puts back anything missing and tells doctor, which
# cannot read the firewall.
firewall_content="[Unit]
Description=$PRODUCT_NAME: project containers kept off this machine and the home network
After=local-fs.target systemd-tmpfiles-setup.service
Before=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$FIREWALL apply

[Install]
WantedBy=multi-user.target docker.service"
check_content="[Unit]
Description=$PRODUCT_NAME: check the firewall for project containers, and put back what is missing
After=docker.service

[Service]
Type=oneshot
ExecStart=$FIREWALL check --repair

[Install]
WantedBy=docker.service"
check_timer_content="[Unit]
Description=$PRODUCT_NAME: check the firewall for project containers every five minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target"
units_changed=0
write_unit() { # file content
  if [ "$(cat "$1" 2>/dev/null || true)" != "$2" ]; then
    printf '%s\n' "$2" >"$1"
    units_changed=1
  fi
}
write_unit "$UNIT_FIREWALL" "$firewall_content"
write_unit "$UNIT_FIREWALL_CHECK" "$check_content"
write_unit "$UNIT_FIREWALL_TIMER" "$check_timer_content"
if [ $units_changed = 1 ]; then
  systemctl daemon-reload
  changed "$(basename "$UNIT_FIREWALL"), $(basename "$UNIT_FIREWALL_CHECK"), $(basename "$UNIT_FIREWALL_TIMER")"
else
  unchanged "$(basename "$UNIT_FIREWALL"), $(basename "$UNIT_FIREWALL_CHECK"), $(basename "$UNIT_FIREWALL_TIMER")"
fi
for unit in "$(basename "$UNIT_FIREWALL")" "$(basename "$UNIT_FIREWALL_CHECK")" "$(basename "$UNIT_FIREWALL_TIMER")"; do
  if [ "$(systemctl is-enabled "$unit" 2>/dev/null || true)" != enabled ]; then
    quiet systemctl enable "$unit"
    changed "$unit enabled"
  fi
done
if ! systemctl is-active --quiet "$(basename "$UNIT_FIREWALL_TIMER")"; then
  quiet systemctl start "$(basename "$UNIT_FIREWALL_TIMER")"
  changed "$(basename "$UNIT_FIREWALL_TIMER") started"
fi
if "$FIREWALL" check >/dev/null 2>&1; then
  unchanged "the rules are in place"
else
  quiet systemctl restart "$(basename "$UNIT_FIREWALL")"
  "$FIREWALL" check >/dev/null 2>&1 || fail "the firewall rules are not in place after applying them" "iptables works, and Docker is running with its DOCKER-USER chain"
  changed "the rules are in place: containers from $ADDRESS_POOLS cannot reach this machine or any private, link-local, shared or multicast range"
fi

# ---------------------------------------------------------------------------
step "Keys, configuration and the reverse proxy" "$CMD setup succeeds (it prints its own reason when it does not)"

setup_output=$(mktemp)
if ! "$WRAPPER" setup >"$setup_output" 2>&1; then
  sed 's/^/    /' "$setup_output" >&2
  rm -f "$setup_output"
  fail "$CMD setup did not finish"
fi
sed -n 's/^       \(changed\|unchanged\): /      \1: /p' "$setup_output"
setup_changes=$(grep -c '^       changed: ' "$setup_output" || true)
CHANGES=$((CHANGES + setup_changes))
rm -f "$setup_output"

# ---------------------------------------------------------------------------
step "The engine the control panel calls" "systemd accepts the unit, and the engine answers on its socket"

# A host service, as the service user, on a Unix socket only (D62): the panel's
# only way to act, through an allow-list of the CLI's own operations.
engine_content="[Unit]
Description=$PRODUCT_NAME: the engine the control panel calls (D62)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
Environment=HOME=$STATE_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/current/dist/engine/main.js
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
ProtectHome=yes
# No PrivateTmp: a restore check hands Docker files under /tmp, and Docker must
# see the same /tmp as the engine.

[Install]
WantedBy=multi-user.target"
engine=$(basename "$UNIT_ENGINE")
engine_restart=$NEW_RELEASE
if [ "$(cat "$UNIT_ENGINE" 2>/dev/null || true)" != "$engine_content" ]; then
  printf '%s\n' "$engine_content" >"$UNIT_ENGINE"
  systemctl daemon-reload
  engine_restart=1
  changed "$engine"
else
  unchanged "$engine"
fi
if [ "$(systemctl is-enabled "$engine" 2>/dev/null || true)" != enabled ]; then
  quiet systemctl enable "$engine"
  changed "$engine enabled"
fi
if ! systemctl is-active --quiet "$engine"; then
  quiet systemctl start "$engine"
  changed "$engine started"
elif [ "$engine_restart" = 1 ]; then
  quiet systemctl restart "$engine"
  changed "$engine restarted, on this version"
else
  unchanged "$engine running"
fi
for _ in $(seq 1 30); do [ -S "$STATE_DIR/engine/engine.sock" ] && break; sleep 0.5; done
[ -S "$STATE_DIR/engine/engine.sock" ] || fail "the engine did not open its socket" "$engine starts: journalctl -u $engine says why it does not"
note "it answers on $STATE_DIR/engine/engine.sock, for the service user and the panel's user only"

# ---------------------------------------------------------------------------
step "The control panel" "$CMD panel install succeeds (it prints its own reason when it does not)"

# Its container, on an internal network with no route out, with only the
# engine's socket; its door, which Docker publishes on port 80 of the home
# network address, and every app's doors without its cookie (D63, D74).
panel_output=$(mktemp)
if ! "$WRAPPER" panel install >"$panel_output" 2>&1; then
  sed 's/^/    /' "$panel_output" >&2
  rm -f "$panel_output"
  fail "$CMD panel install did not finish"
fi
sed -n 's/^       \(changed\|unchanged\): /      \1: /p' "$panel_output"
panel_changes=$(grep -c '^       changed: ' "$panel_output" || true)
CHANGES=$((CHANGES + panel_changes))
rm -f "$panel_output"

# ---------------------------------------------------------------------------
step "The control panel's name on the home network" "systemd accepts the unit, and Avahi, Debian's multicast DNS, runs"

# $CMD.local, announced by multicast DNS through Avahi, for the machine's
# address, which the unit follows (D74). The panel's own name, never an app's,
# so that its cookie never reaches one; a device that cannot find .local
# names uses the address.
mdns_content="[Unit]
Description=$PRODUCT_NAME: the control panel's name, $CMD.local, on the home network (D74)
Wants=network-online.target avahi-daemon.service
After=network-online.target avahi-daemon.service

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=/usr/bin/node $INSTALL_DIR/current/dist/cli.js mdns-publish
Restart=always
RestartSec=10
NoNewPrivileges=yes
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target"
mdns=$(basename "$UNIT_MDNS")
mdns_restart=$NEW_RELEASE
if ! systemctl is-active --quiet avahi-daemon; then
  quiet systemctl enable --now avahi-daemon
  changed "avahi-daemon started"
fi
if [ "$(cat "$UNIT_MDNS" 2>/dev/null || true)" != "$mdns_content" ]; then
  printf '%s\n' "$mdns_content" >"$UNIT_MDNS"
  systemctl daemon-reload
  mdns_restart=1
  changed "$mdns"
else
  unchanged "$mdns"
fi
if [ "$(systemctl is-enabled "$mdns" 2>/dev/null || true)" != enabled ]; then
  quiet systemctl enable "$mdns"
  changed "$mdns enabled"
fi
if ! systemctl is-active --quiet "$mdns"; then
  quiet systemctl start "$mdns"
  changed "$mdns started"
elif [ "$mdns_restart" = 1 ]; then
  quiet systemctl restart "$mdns"
  changed "$mdns restarted, on this version"
else
  unchanged "$mdns running"
fi
note "the panel: http://$CMD.local/, or its address for a device that cannot find .local names"

# ---------------------------------------------------------------------------
step "How the host is" "$CMD doctor finds no problem with the installation itself"

# Fails only on the installation's own checks. A host that needs a backup disk
# or a confirmed recovery key is reported above, not failed: that is about the
# data it holds, not about how it was installed.
if ! "$WRAPPER" doctor --for-install | sed 's/^/    /'; then
  fail "$CMD doctor found a problem with the installation (above)"
fi

# ---------------------------------------------------------------------------
printf '\n'
if [ "$CHANGES" -eq 0 ]; then
  printf 'Nothing changed: this machine was already set up, and everything checked above is as it should be.\n'
else
  printf 'Installed %s %s: %d change(s).\n' "$PRODUCT_NAME" "$version" "$CHANGES"
fi
if [ "$WARNINGS" -gt 0 ]; then
  printf '%d warning(s) above: worth reading, and nothing that stops the installation.\n' "$WARNINGS"
fi

# The control panel's setup code (D64): made once, while nobody has claimed the
# panel, and shown here, on the machine, and nowhere else: not in the log.
printf '\n'
"$WRAPPER" panel setup-code --if-new
