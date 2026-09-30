#!/usr/bin/env node
/**
 * The test host: a disposable Debian 13 machine for developing the suite (D14).
 *
 *   node test/host/host.mjs create           # a fresh test host
 *   node test/host/host.mjs reset            # thrown away and created fresh
 *   node test/host/host.mjs restart [--hard] # a stand-in for a reboot (--hard: for a power cut), and whether the suite came back
 *   node test/host/host.mjs exec -- <cmd>    # run a command as root on it
 *   node test/host/host.mjs exec --stdin-file <file> -- <cmd>   # with a local file as its input
 *   node test/host/host.mjs pull <remote-file> <local-file>     # copy a file off it
 *   node test/host/host.mjs shell            # a root shell on it
 *   node test/host/host.mjs push <local> <remote-dir>
 *   node test/host/host.mjs override list|set <key>=<value>|unset <key>
 *   node test/host/host.mjs status
 *   node test/host/host.mjs remove           # everything the harness made, gone
 *   node test/host/host.mjs resources snapshot|compare <file>
 *
 * **Locally**, the host is a privileged Debian 13 container with systemd as
 * init, on this workstation's Docker. A separate volume stands in for the
 * off-machine backup target. Everything the harness creates carries the label
 * `<command>.test-harness`; it only ever stops or removes resources with that
 * label, and never prunes anything.
 *
 * **Over SSH**, with `ALLVIBE_TEST_HOST=user@host` in the environment or in
 * `local.env`, `exec`, `shell`, `push` and `status` talk to a real Debian 13
 * host instead: key-based, `BatchMode=yes`, so a missing key fails rather than
 * asking for a password (rule 4), and `sudo -n`, so a sudo that wants a password
 * fails too. A real machine is not created, reset or removed by this harness.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { COMEBACK_SECONDS, waitForSuite } from "./comeback.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ----------------------------------------------------------- the names -- */

/** brand.conf is the one place the command name is defined (D1). */
function brand() {
  const text = readFileSync(path.join(ROOT, "brand.conf"), "utf8");
  const value = (key) => text.match(new RegExp(`^${key}="?([^"\\n]*)"?`, "m"))?.[1];
  return { product: value("PRODUCT_NAME"), command: value("COMMAND_NAME") };
}

const { command: CMD } = brand();
const NAME = `${CMD}-test-host`;
const LABEL = `${CMD}.test-harness`;
const IMAGE_REPO = `${CMD}-test-host`;
const BACKUP_MOUNT = `/mnt/${CMD}-backup`;
const OVERRIDES = `/etc/${CMD}/test-overrides`;

/** Debian 13, pinned by index digest (like every image here). */
const BASE = "debian:trixie-20260918@sha256:9cc080028c43b27d2074d63a5f9caf7166d731494965616c1a6d2827a004585c";

/**
 * What turns the Debian image into something that boots like a machine:
 * systemd as init and the few tools a minimal installation has. Nothing the
 * suite needs is added here; install.sh has to fetch that itself, as it will on
 * a fresh machine. The package lists are removed, as a fresh image has none.
 */
const harnessFile = (name) => readFileSync(path.join(ROOT, "test", "host", "harness", name)).toString("base64");
const SETUP = [
  "set -e",
  "export DEBIAN_FRONTEND=noninteractive",
  "apt-get update",
  "apt-get install -y --no-install-recommends systemd systemd-sysv dbus iproute2 procps kmod",
  "apt-get clean",
  "rm -rf /var/lib/apt/lists/*",
  // Nothing to log in on, and no first-boot wizard.
  "systemctl mask getty.target console-getty.service systemd-firstboot.service",
  // Each host gets its own machine id at first boot.
  ": > /etc/machine-id",
  // The cgroup tree a machine boots with, whatever entered the test host while
  // it started (D80; test/host/harness/cgroups.sh says why).
  "mkdir -p /usr/local/lib/test-host /etc/systemd/system/sysinit.target.wants",
  `echo ${harnessFile("cgroups.sh")} | base64 -d > /usr/local/lib/test-host/cgroups.sh`,
  `echo ${harnessFile("cgroups.service")} | base64 -d > /etc/systemd/system/test-host-cgroups.service`,
  "ln -s /etc/systemd/system/test-host-cgroups.service /etc/systemd/system/sysinit.target.wants/test-host-cgroups.service",
].join(" && ");

/** The recipe's hash names the image, so a changed recipe is a new image. */
const IMAGE = `${IMAGE_REPO}:${createHash("sha256").update(`${BASE}\n${SETUP}`).digest("hex").slice(0, 12)}`;

/** Where the suite's proxy listens on a host: the projects from 8100 (D16); and how many the harness maps. */
const GUEST_PORT_BASE = 8099;
const PORT_COUNT = 21;
/**
 * The control panel's door, port 80 (D74), forwarded to the port just after
 * the block: http://allvibe.local:<that port>/ in a browser that maps the name
 * to this workstation's loopback, as the browser checks do.
 */
const GUEST_PANEL_PORT = 80;
const LOCAL_SPAN = PORT_COUNT + 1;

const VOLUMES = [
  { name: `${NAME}-docker`, target: "/var/lib/docker", why: "Docker's data: it cannot live on the container's overlay root" },
  { name: `${NAME}-containerd`, target: "/var/lib/containerd", why: "containerd's image store, for the same reason" },
  { name: `${NAME}-backup`, target: BACKUP_MOUNT, why: "the off-machine backup target" },
];

/* ----------------------------------------------------------- plumbing -- */

/** local.env, for ALLVIBE_TEST_HOST, unless the environment already says. */
function loadLocalEnv() {
  const file = path.join(ROOT, "local.env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
loadLocalEnv();
const REMOTE = process.env.ALLVIBE_TEST_HOST?.trim() || null;

function run(file, args, { input, quiet = false, allowFail = false } = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  const out = `${result.stdout ?? ""}`.trim();
  const err = `${result.stderr ?? ""}`.trim();
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${file} ${args.slice(0, 3).join(" ")} … exited ${result.status}${quiet ? "" : `\n${err || out}`}`);
  }
  return { code: result.status ?? 1, out, err };
}

const docker = (args, options) => run("docker", args, options);
const say = (line = "") => process.stdout.write(`${line}\n`);

/** Run interactively, passing the terminal through. Returns the exit code. */
function attached(file, args, input) {
  return spawnSync(file, args, { stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"], input }).status ?? 1;
}

function exists() {
  return docker(["container", "inspect", NAME], { allowFail: true, quiet: true }).code === 0;
}

function inspect(format) {
  return docker(["container", "inspect", "-f", format, NAME]).out;
}

function requireLocal(what) {
  if (REMOTE) {
    throw new Error(
      `ALLVIBE_TEST_HOST is set, so the test host is a real machine, and this harness does not ${what} one. ` +
        "Reinstall Debian 13 on it for a fresh host.",
    );
  }
}

/* ------------------------------------------------------------- ports -- */

function portFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/** The first block of free ports on this workstation, checked, not assumed. */
async function freePortBlock() {
  for (let base = GUEST_PORT_BASE; base < 9000; base += LOCAL_SPAN) {
    let free = true;
    for (let port = base; port < base + LOCAL_SPAN && free; port += 1) {
      free = (await portFree(port, "127.0.0.1")) && (await portFree(port, "0.0.0.0"));
    }
    if (free) return base;
  }
  throw new Error(`no block of ${LOCAL_SPAN} free ports between ${GUEST_PORT_BASE} and 9000 on this workstation`);
}

/* ------------------------------------------------------------- image -- */

/**
 * The harness image, made without `docker build`: a labelled container runs the
 * setup on the pinned base and is committed as a labelled image. No build cache
 * is left behind, and if the harness pulled the base, it removes that reference
 * again (the committed image keeps the layers it needs).
 */
function ensureImage() {
  if (docker(["image", "inspect", IMAGE], { allowFail: true, quiet: true }).code === 0) return false;

  const hadBase = docker(["image", "inspect", BASE], { allowFail: true, quiet: true }).code === 0;
  const builder = `${NAME}-build`;
  say(`image     making ${IMAGE} from Debian 13 (${BASE.split("@")[0]}), once`);
  docker(["rm", "-f", builder], { allowFail: true, quiet: true });
  try {
    docker(["run", "--name", builder, "--label", `${LABEL}=1`, BASE, "sh", "-c", SETUP]);
    docker([
      "commit",
      "--change", `LABEL ${LABEL}=1`,
      "--change", 'CMD ["/sbin/init"]',
      "--change", "STOPSIGNAL SIGRTMIN+3",
      "--change", "ENV container=docker",
      builder,
      IMAGE,
    ]);
  } finally {
    docker(["rm", "-f", builder], { allowFail: true, quiet: true });
    if (!hadBase) docker(["image", "rm", BASE], { allowFail: true, quiet: true });
  }
  return true;
}

/* ----------------------------------------------------- the lifecycle -- */

async function waitForBoot() {
  const deadline = Date.now() + 120_000;
  let state = "";
  while (Date.now() < deadline) {
    state = docker(["exec", NAME, "systemctl", "is-system-running"], { allowFail: true, quiet: true }).out;
    if (state === "running" || state === "degraded") break;
    await sleep(1000);
  }
  if (state === "degraded") {
    const failed = docker(["exec", NAME, "systemctl", "--failed", "--no-legend", "--plain"], { allowFail: true }).out;
    say(`systemd   degraded: ${failed.split("\n").map((l) => l.split(" ")[0]).join(", ")}`);
  } else if (state === "running") {
    say("systemd   running");
  } else {
    throw new Error(`systemd did not finish booting within 120 s (state: ${state || "unknown"})`);
  }
}

function writeOverrides(lines) {
  const body = [
    "# Test host overrides (D14). Honoured only when systemd reports it runs in a",
    "# Docker container, which no real installation does. Written by the harness.",
    ...lines,
    "",
  ].join("\n");
  docker(["exec", "-i", NAME, "sh", "-c", `mkdir -p '${path.posix.dirname(OVERRIDES)}' && cat > '${OVERRIDES}'`], { input: body });
}

function readOverrides() {
  const read = docker(["exec", NAME, "cat", OVERRIDES], { allowFail: true, quiet: true });
  return read.code === 0 ? read.out.split("\n").filter((l) => l.trim() && !l.startsWith("#")) : [];
}

async function create({ portBase } = {}) {
  requireLocal("create");
  if (exists()) throw new Error(`${NAME} already exists; use reset for a fresh one, or remove`);

  ensureImage();
  const base = portBase ?? (await freePortBlock());
  for (const volume of VOLUMES) {
    docker(["volume", "create", "--label", `${LABEL}=1`, volume.name]);
  }

  const args = [
    "run", "-d",
    "--name", NAME,
    "--hostname", NAME,
    "--label", `${LABEL}=1`,
    "--label", `${LABEL}.port-base=${base}`,
    // systemd as init needs these: privileges for its own cgroups and mounts,
    // a private cgroup namespace, and tmpfs where a machine has tmpfs.
    "--privileged",
    "--cgroupns=private",
    "--tmpfs", "/run",
    "--tmpfs", "/run/lock",
    "--tmpfs", "/tmp",
    ...VOLUMES.flatMap((v) => ["-v", `${v.name}:${v.target}`]),
    // Loopback only: the test host is for this workstation, not the LAN.
    "-p", `127.0.0.1:${base}-${base + PORT_COUNT - 1}:${GUEST_PORT_BASE}-${GUEST_PORT_BASE + PORT_COUNT - 1}`,
    "-p", `127.0.0.1:${base + PORT_COUNT}:${GUEST_PANEL_PORT}`,
    IMAGE,
  ];
  docker(args);
  say(`container ${NAME} started from ${IMAGE}`);
  await waitForBoot();

  // The hardware this test host stands for (D14). A container reads the Docker
  // VM's memory, has no system disk of its own, and keeps every volume on one
  // virtual disk, so none of the three can be measured here: they are declared,
  // as an ordinary machine that passes every check. A test forces a warning by
  // changing one (override set memory-mb=4096, or system-disk=rotational).
  // The workstation's browser reaches the apps through the forwarded ports on
  // its own loopback, not at the test host's address (D74).
  const profile = ["memory-mb=16384", "system-disk=ssd", `external-backup-mount=${BACKUP_MOUNT}`, "apps-host=localhost"];
  writeOverrides(profile);
  say(`overrides ${OVERRIDES}: ${profile.join(", ")}`);
  say(`ports     test host ${GUEST_PORT_BASE}-${GUEST_PORT_BASE + PORT_COUNT - 1} -> http://localhost:${base}-${base + PORT_COUNT - 1} on this workstation`);
  say(`panel     test host ${GUEST_PANEL_PORT} -> http://${CMD}.local:${base + PORT_COUNT}/ (a browser mapping ${CMD}.local to 127.0.0.1), or http://localhost:${base + PORT_COUNT}/`);
  say(`ready     a fresh Debian 13 host. Next: node test/host/host.mjs shell`);
}

function removeContainerAndVolumes({ keepBackup = false } = {}) {
  if (exists()) {
    const labelled = inspect(`{{index .Config.Labels "${LABEL}"}}`);
    if (labelled !== "1") throw new Error(`${NAME} exists but does not carry ${LABEL}; not touching it`);
    docker(["rm", "-f", NAME]);
    say(`removed   container ${NAME}`);
  }
  for (const volume of VOLUMES) {
    if (keepBackup && volume.target === BACKUP_MOUNT) {
      say(`kept      volume ${volume.name} (${volume.why})`);
      continue;
    }
    const found = docker(["volume", "inspect", "-f", `{{index .Labels "${LABEL}"}}`, volume.name], { allowFail: true, quiet: true });
    if (found.code !== 0) continue;
    if (found.out !== "1") throw new Error(`volume ${volume.name} does not carry ${LABEL}; not touching it`);
    docker(["volume", "rm", volume.name]);
    say(`removed   volume ${volume.name}`);
  }
}

async function reset({ keepBackup }) {
  requireLocal("reset");
  const base = exists() ? Number(inspect(`{{index .Config.Labels "${LABEL}.port-base"}}`)) || undefined : undefined;
  removeContainerAndVolumes({ keepBackup });
  await create({ portBase: base });
}

/**
 * A stand-in for a reboot: the container stopped as a machine shuts down
 * (systemd stops every unit), and started again. `--hard` is the nearest to a
 * power cut the harness has: every process killed at once, nothing stopped
 * cleanly, nothing unmounted (what a real power cut also loses, writes the
 * disk had not yet made, the workstation's kernel still has). Then, if the
 * suite is installed, whether it came back within the stated time (D80).
 */
async function restart({ hard = false } = {}) {
  requireLocal("restart");
  if (!exists()) throw new Error(`${NAME} does not exist`);
  if (hard) {
    docker(["kill", NAME]);
    docker(["start", NAME]);
    say(`stopped   ${NAME} hard (every process killed at once) and started again, standing in for a power cut`);
  } else {
    docker(["restart", NAME]);
    say(`restarted ${NAME} (standing in for a reboot)`);
  }
  await waitForBoot();
  if (!(await comeback())) process.exitCode = 1;
}

/** The cgroups the test host booted with, and, with the suite installed, whether it all came back. */
async function comeback() {
  // This start's run of the unit only: the test host's journal spans every start of its container.
  const cgroups = docker(["exec", NAME, "sh", "-c", "cat /sys/fs/cgroup/cgroup.subtree_control; journalctl _SYSTEMD_INVOCATION_ID=$(systemctl show -p InvocationID --value test-host-cgroups) --no-pager -o cat | grep -m1 '^moved' || true"], { allowFail: true, quiet: true }).out.split("\n");
  const given = cgroups[0]?.trim() ?? "";
  if (!/\bpids\b/.test(given) || !/\bmemory\b/.test(given)) {
    say(`cgroups   NOT as a machine boots: the root cgroup gives its children "${given}", so no container with a limit can start`);
    return false;
  }
  say(`cgroups   the root cgroup gives its children ${given}${cgroups[1] ? `; ${cgroups[1]}` : ""}`);
  if (docker(["exec", NAME, "test", "-x", `/usr/local/bin/${CMD}`], { allowFail: true, quiet: true }).code !== 0) return true;
  const panelPort = Number(inspect(`{{index .Config.Labels "${LABEL}.port-base"}}`)) + PORT_COUNT;
  const result = await waitForSuite(NAME, panelPort);
  if (result.ok) say(`suite     back ${result.seconds} s after the start: ${result.back.join("; ")}`);
  else {
    say(`suite     NOT back within ${COMEBACK_SECONDS} s of the start:`);
    for (const line of result.notBack) say(`          ${line}`);
  }
  return result.ok;
}

function remove() {
  requireLocal("remove");
  removeContainerAndVolumes();
  const images = docker(["image", "ls", "--filter", `label=${LABEL}=1`, "--format", "{{.Repository}}:{{.Tag}}"]).out.split("\n").filter(Boolean);
  for (const image of images) {
    docker(["image", "rm", image]);
    say(`removed   image ${image}`);
  }
  say("nothing of the test host is left");
}

/* -------------------------------------------------- commands on the host -- */

/** Quote one argument for a POSIX shell. */
const shq = (arg) => (/^[A-Za-z0-9_\/.:=@%+,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`);

function sshArgs(tty) {
  return [
    "-o", "BatchMode=yes",
    "-o", "PasswordAuthentication=no",
    "-o", "StrictHostKeyChecking=accept-new",
    ...(tty ? ["-t"] : []),
    REMOTE,
  ];
}

/**
 * A command as root on the host. `--stdin-file <file>` hands a local file to it
 * as its standard input, byte for byte, whatever shell this is run from
 * (PowerShell has no `<`, and its pipes re-encode text).
 */
function execOnHost(args) {
  let input;
  if (args[0] === "--stdin-file") {
    if (!args[1]) throw new Error("usage: exec --stdin-file <local file> -- <command>");
    input = readFileSync(args[1]);
    args = args[2] === "--" ? args.slice(3) : args.slice(2);
  }
  if (args.length === 0) throw new Error("usage: exec -- <command> [args]");
  const tty = input === undefined && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (REMOTE) return attached("ssh", [...sshArgs(tty), `sudo -n ${args.map(shq).join(" ")}`], input);
  if (!exists()) throw new Error(`${NAME} does not exist; node test/host/host.mjs create`);
  return attached("docker", ["exec", "-i", ...(tty ? ["-t"] : []), NAME, ...args], input);
}

/**
 * A file off the host, byte for byte, without passing through a terminal or a
 * shell's redirection (which in Windows PowerShell 5.1 rewrites it as UTF-16).
 * Used for the recovery key: it goes into a file, never onto the screen.
 */
function pull(remoteFile, localFile) {
  if (!remoteFile || !localFile) throw new Error("usage: pull <remote file> <local file>");
  mkdirSync(path.dirname(path.resolve(localFile)), { recursive: true });
  if (REMOTE) {
    const staging = `/tmp/${CMD}-pull-${Date.now()}`;
    run("ssh", [...sshArgs(false), `sudo -n install -m 600 -o $(id -u) ${shq(remoteFile)} ${shq(staging)}`]);
    run("scp", ["-o", "BatchMode=yes", `${REMOTE}:${staging}`, localFile]);
    run("ssh", [...sshArgs(false), `rm -f ${shq(staging)}`]);
  } else {
    if (!exists()) throw new Error(`${NAME} does not exist`);
    docker(["cp", `${NAME}:${remoteFile}`, localFile]);
  }
  say(`pulled    ${remoteFile} to ${localFile} (not shown)`);
}

function shell() {
  if (REMOTE) return attached("ssh", [...sshArgs(true), "sudo -n -i"]);
  if (!exists()) throw new Error(`${NAME} does not exist; node test/host/host.mjs create`);
  return attached("docker", ["exec", "-it", NAME, "bash", "-l"]);
}

function push(localPath, remoteDir) {
  if (!localPath || !remoteDir) throw new Error("usage: push <local path> <remote directory>");
  if (REMOTE) {
    const staging = `/tmp/${CMD}-push-${Date.now()}`;
    run("ssh", [...sshArgs(false), `mkdir -p ${shq(staging)}`]);
    run("scp", ["-o", "BatchMode=yes", "-r", localPath, `${REMOTE}:${staging}/`]);
    run("ssh", [...sshArgs(false), `sudo -n mkdir -p ${shq(remoteDir)} && sudo -n cp -a ${shq(staging)}/. ${shq(remoteDir)}/ && rm -rf ${shq(staging)}`]);
  } else {
    if (!exists()) throw new Error(`${NAME} does not exist`);
    docker(["exec", NAME, "mkdir", "-p", remoteDir]);
    docker(["cp", localPath, `${NAME}:${remoteDir}`]);
  }
  say(`pushed    ${path.basename(localPath)} to ${remoteDir}`);
}

function overrides([action, argument]) {
  requireLocal("set overrides on");
  const current = readOverrides();
  if (action === "list" || action === undefined) {
    say(current.length ? current.join("\n") : "(no overrides)");
    return;
  }
  const key = (argument ?? "").split("=")[0];
  if (!/^[a-z-]+$/.test(key)) throw new Error("usage: override set <key>=<value> | unset <key> | list");
  const rest = current.filter((line) => line.split("=")[0] !== key);
  if (action === "set") {
    if (!argument.includes("=")) throw new Error("usage: override set <key>=<value>");
    writeOverrides([...rest, argument]);
    say(`override  set ${argument}`);
  } else if (action === "unset") {
    writeOverrides(rest);
    say(`override  unset ${key}`);
  } else {
    throw new Error("usage: override list | set <key>=<value> | unset <key>");
  }
}

function status() {
  if (REMOTE) {
    say(`test host: a real machine over SSH (ALLVIBE_TEST_HOST is set)`);
    return execOnHost(["sh", "-c", "hostnamectl 2>/dev/null | sed -n 's/^ *Operating System: //p'; systemctl is-system-running"]);
  }
  if (!exists()) {
    say(`test host: none (${NAME} does not exist)`);
    return 0;
  }
  const base = Number(inspect(`{{index .Config.Labels "${LABEL}.port-base"}}`));
  say(`container ${NAME}: ${inspect("{{.State.Status}}")}, image ${inspect("{{.Config.Image}}")}`);
  say(`systemd   ${docker(["exec", NAME, "systemctl", "is-system-running"], { allowFail: true, quiet: true }).out || "unknown"}`);
  say(`ports     test host ${GUEST_PORT_BASE}-${GUEST_PORT_BASE + PORT_COUNT - 1} -> http://localhost:${base}-${base + PORT_COUNT - 1}`);
  say(`panel     test host ${GUEST_PANEL_PORT} -> http://${CMD}.local:${base + PORT_COUNT}/ or http://localhost:${base + PORT_COUNT}/`);
  for (const volume of VOLUMES) say(`volume    ${volume.name} at ${volume.target} (${volume.why})`);
  const current = readOverrides();
  say(`overrides ${current.length ? current.join(", ") : "none"}`);
  return 0;
}

/* ------------------------------------- what is on this workstation's Docker -- */

/**
 * Every container, image, volume and network on this workstation's Docker, as
 * ids, with the ones carrying the harness label marked. Used to show that the
 * test host adds nothing unlabelled and leaves nothing behind. Names of
 * resources that are not the harness's are never printed: they belong to other
 * projects.
 */
function inventory() {
  const lines = (args) => docker(args).out.split("\n").filter(Boolean);
  const labelled = (kind) =>
    new Set(
      lines([
        kind, "ls",
        ...(kind === "container" ? ["-a"] : []),
        "-q",
        ...(kind === "volume" ? [] : ["--no-trunc"]),
        "--filter", `label=${LABEL}=1`,
      ]),
    );
  const take = (kind, all) => {
    const ids = lines(all);
    const mine = labelled(kind);
    return ids.map((id) => ({ id, harness: mine.has(id) }));
  };
  return {
    containers: take("container", ["container", "ls", "-a", "-q", "--no-trunc"]),
    images: take("image", ["image", "ls", "-q", "--no-trunc"]).filter((v, i, a) => a.findIndex((w) => w.id === v.id) === i),
    volumes: take("volume", ["volume", "ls", "-q"]),
    networks: take("network", ["network", "ls", "-q", "--no-trunc"]),
  };
}

function nameOf(kind, id) {
  const format = { containers: "{{.Name}}", images: "{{index .RepoTags 0}}", volumes: "{{.Name}}", networks: "{{.Name}}" }[kind];
  const cli = { containers: "container", images: "image", volumes: "volume", networks: "network" }[kind];
  return docker([cli, "inspect", "-f", format, id], { allowFail: true, quiet: true }).out.replace(/^\//, "") || id.slice(0, 19);
}

function resources([action, file]) {
  if (!["snapshot", "compare"].includes(action) || !file) throw new Error("usage: resources snapshot|compare <file>");
  const now = inventory();
  if (action === "snapshot") {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    for (const [kind, list] of Object.entries(now)) {
      say(`${kind.padEnd(10)} ${list.length} (${list.filter((x) => x.harness).length} with the harness label)`);
    }
    say(`snapshot  written to ${file}`);
    return 0;
  }
  const before = JSON.parse(readFileSync(file, "utf8"));
  let unlabelledAdded = 0;
  let removedOthers = 0;
  for (const [kind, list] of Object.entries(now)) {
    const was = new Set(before[kind].map((x) => x.id));
    const is = new Set(list.map((x) => x.id));
    const added = list.filter((x) => !was.has(x.id));
    const removed = before[kind].filter((x) => !is.has(x.id));
    const addedLabelled = added.filter((x) => x.harness);
    const addedOther = added.filter((x) => !x.harness);
    unlabelledAdded += addedOther.length;
    removedOthers += removed.filter((x) => !x.harness).length;
    say(
      `${kind.padEnd(10)} before ${String(before[kind].length).padStart(3)}, now ${String(list.length).padStart(3)}: ` +
        `${addedLabelled.length} added with the harness label, ${addedOther.length} added without, ` +
        `${removed.filter((x) => x.harness).length} harness ones removed, ${removed.filter((x) => !x.harness).length} others removed`,
    );
    for (const x of addedLabelled) say(`           + ${nameOf(kind, x.id)}`);
    // An unlabelled addition is shown by id only: it may be another project's.
    for (const x of addedOther) say(`           + (no label) ${x.id.replace(/^sha256:/, "").slice(0, 12)}`);
  }
  say(
    unlabelledAdded === 0
      ? "result    nothing without the harness label was added"
      : `result    ${unlabelledAdded} resource(s) without the harness label were added; if they are the harness's, that is a bug`,
  );
  if (removedOthers > 0) say(`note      ${removedOthers} resource(s) that are not the harness's disappeared meanwhile (another project, not this harness)`);
  return unlabelledAdded === 0 ? 0 : 1;
}

/* ------------------------------------------------------------------ cli -- */

const USAGE = `usage: node test/host/host.mjs <command>
  create | reset [--keep-backup-target] | restart [--hard] | remove | status
  exec [--stdin-file <file>] -- <command> [args]    shell
  push <local> <remote-dir>    pull <remote-file> <local-file>
  override list | set <key>=<value> | unset <key>
  resources snapshot <file> | compare <file>
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "create": return create();
    case "reset": return reset({ keepBackup: rest.includes("--keep-backup-target") });
    case "restart": return restart({ hard: rest.includes("--hard") });
    case "remove": return remove();
    case "status": return status();
    case "exec": return execOnHost(rest[0] === "--" ? rest.slice(1) : rest);
    case "shell": return shell();
    case "push": return push(rest[0], rest[1]);
    case "pull": return pull(rest[0], rest[1]);
    case "override": return overrides(rest);
    case "resources": return resources(rest);
    default:
      process.stderr.write(USAGE);
      return 2;
  }
}

main()
  .then((code) => {
    if (typeof code === "number") process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`host: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
