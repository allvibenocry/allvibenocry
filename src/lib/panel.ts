/**
 * The control panel's container, network and door (D63), made and checked by
 * `allvibe panel install` (which install.sh runs) and by the engine at every
 * start (so a new home-network address is picked up).
 *
 *   - its image, built here from the pinned Node.js 24 image and the bundle's
 *     panel/, never pulled;
 *   - its network, Docker `--internal`, with no route out, on the last /24 of
 *     Docker's first address pool, where the panel has a fixed address;
 *   - its container, as the panel's own user, read-only, with no capabilities,
 *     and only the engine's socket folder mounted, read-only;
 *   - its door (D74): a small nginx from the proxy's image, which Docker
 *     publishes on the machine's home-network address, port 80; private
 *     sources only, its own names only (`allvibe.local`, announced by
 *     multicast DNS, and the machine's address);
 *   - every app's doors written again, without the panel's cookie (D74).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { posix as path } from "node:path";
import { BRAND, INSTALL_ROOT, NAMES } from "./brand.js";
import { containerState, docker, engineInfo, tryDocker, waitHealthy } from "./docker.js";
import { ensureFile } from "./files.js";
import { startError } from "./keeper.js";
import { readOverrides } from "./overrides.js";
import { ensureAllServerBlocks, lanAddress } from "./project.js";
import { PROXY_IMAGE, reloadProxy, removeServerConf } from "./proxy.js";
import { tryRun } from "./run.js";

const C = NAMES.command;
/** Where the panel answers on the home network (D74): port 80, published by Docker for its door. */
export const PANEL_PORT = 80;
/** Where the panel listens inside its container. */
export const PANEL_INNER_PORT = 8080;
/** Where its door listens inside its own container. */
export const DOOR_INNER_PORT = 8080;
const panelDir = () => path.join(INSTALL_ROOT.split("\\").join("/"), "panel");

/** Every file of the bundle's panel/, in order: what the image is built from. */
function panelFiles(dir = panelDir(), sub = ""): string[] {
  return readdirSync(path.join(dir, sub))
    .sort()
    .flatMap((name) => (statSync(path.join(dir, sub, name)).isDirectory() ? panelFiles(dir, path.join(sub, name)) : [path.join(sub, name)]));
}

export function panelImageTag(dir = panelDir()): string {
  const hash = createHash("sha256");
  for (const file of panelFiles(dir)) hash.update(file).update(readFileSync(path.join(dir, file)));
  return `${C}-panel:${hash.digest("hex").slice(0, 12)}`;
}

/** The last /24 of an address pool: the /24 whose third number is the pool's highest. */
export function lastSubnet(pool: string): string {
  const [base, bits] = pool.split("/");
  const n = base.split(".").reduce((a, o) => a * 256 + Number(o), 0);
  const last = n + 2 ** (32 - Number(bits)) - 256;
  return `${[24, 16, 8, 0].map((s) => Math.floor(last / 2 ** s) % 256).join(".")}/24`;
}

/**
 * The panel's network, and a fixed address on it for the panel and for its
 * door (D80). Anything else Docker gives an address there comes from the
 * upper half, `range`, so that nothing can hold the panel's or the door's
 * address when Docker starts it: at a boot where Docker started the door
 * first, the door took the panel's address, and the panel could not start.
 */
export const panelAddresses = (subnet: string) => {
  const prefix = subnet.split("/")[0].split(".").slice(0, 3).join(".");
  return { gateway: `${prefix}.1`, panel: `${prefix}.2`, door: `${prefix}.3`, range: `${prefix}.128/25` };
};

/** The panel's network, as this version makes it: from Docker's first address pool. */
function panelNetwork(): ReturnType<typeof panelAddresses> & { subnet: string } {
  const pools = engineInfo()?.addressPools ?? [];
  if (!pools.length) throw new Error("Docker has no address pools set for the suite's networks: run install.sh again");
  const subnet = lastSubnet(pools[0]);
  return { subnet, ...panelAddresses(subnet) };
}

/** An IPv4 address, and nothing else (Docker says "invalid IP" for a stopped container's). */
const isAddress = (value: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value);

/**
 * The panel's door (D63, D74): a small nginx of its own, from the proxy's
 * pinned image, as its unprivileged user, in a container Docker publishes on
 * the machine's home-network address, port 80. The proxy cannot take port 80
 * itself: it runs on the host's network, where Docker publishes nothing, and a
 * capability given to its container does not reach its unprivileged user.
 * Docker binds port 80, so neither the proxy nor the machine changes.
 *
 * It answers only to private sources, and only to the panel's own names: its
 * `.local` name, the machine's address (for a device that cannot find `.local`
 * names), and the machine itself. The terminal's stream is a WebSocket, which
 * it passes through and keeps open while the terminal is used.
 */
export function panelDoorConf(address: string, panelIp: string, name = NAMES.panelName): string {
  return `# The control panel's door (D63, D74). Generated by ${C}; rewritten on every change.
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;

events {
    worker_connections 256;
}

http {
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path       /tmp/proxy_temp;
    fastcgi_temp_path     /tmp/fastcgi_temp;
    uwsgi_temp_path       /tmp/uwsgi_temp;
    scgi_temp_path        /tmp/scgi_temp;
    server_tokens off;
    access_log    off;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ""      "";
    }

    server {
        listen ${DOOR_INNER_PORT};

        # Private sources only. Docker keeps a home-network device's own
        # address for a published port, so this is the device's.
        allow 127.0.0.0/8;
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;

        # Its own names only: a page that points a name of its own at this
        # machine (DNS rebinding) reaches nothing.
        set $panel_host 0;
        if ($host = "${name}") { set $panel_host 1; }
        if ($host = "${address}") { set $panel_host 1; }
        if ($host = "localhost") { set $panel_host 1; }
        if ($host = "127.0.0.1") { set $panel_host 1; }
        if ($panel_host = 0) { return 421; }

        client_max_body_size 64k;
        location / {
            proxy_pass http://${panelIp}:${PANEL_INNER_PORT};
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 60s;
        }
        # The terminal's stream stays open while it is used; the panel pings it.
        location /api/terminal/ {
            proxy_pass http://${panelIp}:${PANEL_INNER_PORT};
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 120s;
        }
    }
}
`;
}

/** The door container's `docker run` arguments: port 80 of the machine's address, published by Docker. */
export function doorRunArgs(address: string, conf: string): string[] {
  return [
    "run", "-d",
    "--name", NAMES.panelDoorContainer,
    "--label", `${C}.role=panel-door`,
    "--network", NAMES.panelDoorNetwork,
    "-p", `${address}:${PANEL_PORT}:${DOOR_INNER_PORT}`,
    "--read-only", "--tmpfs", "/tmp:size=8m",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--memory", "64m", "--memory-swap", "64m", "--pids-limit", "64",
    "--restart", "unless-stopped",
    "--log-driver", "local", "--log-opt", "max-size=1m",
    "--mount", `type=bind,source=${conf},target=/etc/nginx/nginx.conf,readonly`,
    "--entrypoint", "nginx",
    PROXY_IMAGE,
    "-g", "daemon off;",
  ];
}

function idOf(user: string): { uid: number; gid: number } {
  const entry = tryRun("getent", ["passwd", user]).stdout.split(":");
  if (entry.length < 4) throw new Error(`there is no user ${user}: run install.sh again`);
  return { uid: Number(entry[2]), gid: Number(entry[3]) };
}

export function panelRunArgs(image: string, ip: string, uid: number, gid: number): string[] {
  return [
    "run", "-d",
    "--name", NAMES.panelContainer,
    "--label", `${C}.role=panel`,
    "--network", NAMES.panelNetwork,
    "--ip", ip,
    "--user", `${uid}:${gid}`,
    "--read-only", "--tmpfs", "/tmp:size=8m",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "64",
    "--restart", "unless-stopped",
    "--log-driver", "local", "--log-opt", "max-size=1m",
    // The one mount: the engine's socket folder, which holds nothing else (rule 12).
    "--mount", `type=bind,source=${NAMES.engineDir},target=/run/engine,readonly`,
    "-e", "ENGINE_SOCKET=/run/engine/engine.sock",
    "-e", `PANEL_COOKIE=${C}_panel`,
    "-e", `PANEL_PRODUCT=${BRAND.product}`,
    "-e", `PANEL_COMMAND=${C}`,
    image,
  ];
}

const argsLabel = (args: string[]) => createHash("sha256").update(args.join("\u0000")).digest("hex").slice(0, 12);

export interface PanelChange {
  what: string;
  changed: boolean;
}

/** The image, the network, the container and the door, made what they should be. */
export async function ensurePanel(): Promise<PanelChange[]> {
  const out: PanelChange[] = [];

  const tag = panelImageTag();
  if (tryDocker(["image", "inspect", tag]).code !== 0) {
    docker(["build", "-q", "-t", tag, "--label", `${C}.role=panel-image`, panelDir()], { timeoutMs: 10 * 60_000 });
    out.push({ what: `image ${tag}, built here from the pinned Node.js 24 image`, changed: true });
  } else out.push({ what: `image ${tag}`, changed: false });

  const { subnet, gateway, panel, range } = panelNetwork();
  // Docker 29 prints a network with no range for other addresses as "invalid Prefix", not as nothing.
  const inspectNetwork = () => {
    const r = tryDocker(["network", "inspect", NAMES.panelNetwork, "--format", "{{.Internal}}|{{range .IPAM.Config}}{{.Subnet}}|{{.IPRange}}{{end}}"]);
    const [internal, sub, ipRange = ""] = r.stdout.trim().split("|");
    return { code: r.code, seen: `${internal} ${sub}${/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(ipRange) ? ` ${ipRange}` : ""}` };
  };
  let existing = inspectNetwork();
  if (existing.code === 0 && existing.seen === `true ${subnet}`) {
    // Made before D80, with no range for other addresses: made again, with the
    // panel and its door, which are made again below.
    tryDocker(["rm", "-f", NAMES.panelDoorContainer]);
    tryDocker(["rm", "-f", NAMES.panelContainer]);
    docker(["network", "rm", NAMES.panelNetwork]);
    out.push({ what: `network ${NAMES.panelNetwork} removed, to be made with a fixed address for the panel and its door`, changed: true });
    existing = inspectNetwork();
  }
  if (existing.code !== 0) {
    const clash = tryDocker(["network", "ls", "-q"]).stdout.split("\n").filter(Boolean)
      .map((id) => tryDocker(["network", "inspect", id, "--format", "{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}"]).stdout.trim())
      .find((line) => line.split(" ").slice(1).includes(subnet));
    if (clash) throw new Error(`the panel's network would be ${subnet}, which the network ${clash.split(" ")[0]} already uses`);
    docker(["network", "create", "--internal", "--subnet", subnet, "--ip-range", range, "--gateway", gateway, "--label", `${C}.role=panel`, NAMES.panelNetwork]);
    out.push({ what: `network ${NAMES.panelNetwork}, internal: no route out (${subnet}; the panel and its door at fixed addresses)`, changed: true });
  } else if (existing.seen !== `true ${subnet} ${range}`) {
    throw new Error(`the network ${NAMES.panelNetwork} is not the panel's (${existing.seen}): remove it, and run install.sh again`);
  } else out.push({ what: `network ${NAMES.panelNetwork}, internal`, changed: false });

  const { uid, gid } = idOf(NAMES.panelUser);
  const args = panelRunArgs(tag, panel, uid, gid);
  const want = argsLabel(args);
  const state = containerState(NAMES.panelContainer);
  if (!state.exists || state.labels[`${C}.panel-args`] !== want || state.status !== "running") {
    tryDocker(["rm", "-f", NAMES.panelContainer]);
    const [run, detached, ...rest] = args;
    docker([run, detached, "--label", `${C}.panel-args=${want}`, ...rest]);
    const started = await waitHealthy(NAMES.panelContainer, 60_000);
    if (started.status !== "running" || started.health !== "healthy") throw new Error(`the panel's container is ${started.status}/${started.health}: docker logs ${NAMES.panelContainer} says why`);
    out.push({ what: `container ${NAMES.panelContainer}, as ${NAMES.panelUser}, read-only, with only the engine's socket`, changed: true });
  } else out.push({ what: `container ${NAMES.panelContainer} running`, changed: false });

  out.push(ensurePanelDoor());
  // Every app's doors, as this version writes them: without the panel's cookie, and never on its name (D74).
  const doors = ensureAllServerBlocks();
  out.push({ what: doors.length ? `the doors of ${doors.join(", ")}, without the panel's cookie` : "every app's doors, without the panel's cookie", changed: doors.length > 0 });
  return out;
}

/**
 * The door, for the machine's address now (D74): its configuration written,
 * and its container made again when the address it is published on changed,
 * or when it is not running; the proxy's own server for the panel, from
 * before D74, taken away. The panel's address and its own are worked out
 * from Docker's address pool, never read from the panel's container, which
 * says "invalid IP" when it is not running (D80).
 */
export function ensurePanelDoor(): PanelChange {
  const { panel: ip, door: doorIp } = panelNetwork();
  const address = lanAddress();
  if (!isAddress(address)) throw new Error("this machine has no address on the home network yet, so the door cannot be published on it");
  let changed = false;

  mkdirSync(NAMES.panelDoorDir, { recursive: true, mode: 0o755 });
  const conf = path.join(NAMES.panelDoorDir, "nginx.conf");
  const confChanged = ensureFile(conf, panelDoorConf(address, ip));
  if (tryDocker(["network", "inspect", NAMES.panelDoorNetwork]).code !== 0) {
    docker(["network", "create", "--label", `${C}.role=panel-door`, NAMES.panelDoorNetwork]);
    changed = true;
  }
  const args = doorRunArgs(address, conf);
  const want = argsLabel([...args, doorIp]);
  const state = containerState(NAMES.panelDoorContainer);
  if (!state.exists || state.labels[`${C}.door-args`] !== want || state.status !== "running") {
    tryDocker(["rm", "-f", NAMES.panelDoorContainer]);
    // Made, joined to the panel's network at its own fixed address, and only
    // then started, so that it never runs, even for a moment, anywhere else.
    const [, , ...rest] = args;
    docker(["create", "--label", `${C}.door-args=${want}`, ...rest]);
    docker(["network", "connect", "--ip", doorIp, NAMES.panelNetwork, NAMES.panelDoorContainer]);
    docker(["start", NAMES.panelDoorContainer]);
    changed = true;
  } else if (confChanged) {
    const test = tryDocker(["exec", NAMES.panelDoorContainer, "nginx", "-t"]);
    if (test.code !== 0) throw new Error(`the panel's door does not pass nginx -t: ${test.stderr.trim().split("\n").slice(-2).join(" ")}`);
    docker(["exec", NAMES.panelDoorContainer, "nginx", "-s", "reload"]);
    changed = true;
  }
  if (removeServerConf("panel")) {
    reloadProxy();
    changed = true;
  }
  return { what: `door ${panelUrls(address).join(" and ")}, port 80, for private addresses only`, changed };
}

/**
 * What the engine does again and again (D80): the panel's container started
 * when it is not running, and its door made what it should be. Docker brings
 * back a container that exits after it has run; one it could not start, at
 * boot or later, it leaves as it is, and the panel stayed down (the eighth
 * brief, item 1). Before install has made the panel, there is none to keep.
 */
export function keepPanel(): PanelChange[] {
  const out: PanelChange[] = [];
  const state = containerState(NAMES.panelContainer);
  if (!state.exists) return out;
  if (state.status === "created" || state.status === "exited" || state.status === "dead") {
    const why = state.error ? `Docker could not start it: ${startError(state.error)}` : `it was ${state.status}`;
    const ran = tryDocker(["start", NAMES.panelContainer]);
    if (ran.code !== 0) throw new Error(`the panel's container could not be started (${why}); now: ${startError(ran.stderr.replace(/^Error response from daemon: /, "").split("\n")[0] ?? "")}`);
    out.push({ what: `the panel's container started again (${why})`, changed: true });
  }
  out.push(ensurePanelDoor());
  return out;
}

/**
 * Where a browser reaches the apps (D74): the machine's address, never the
 * panel's name, so that the panel's cookie is never sent to an app from the
 * panel's own pages. On the test host, what the harness declares.
 */
export function appsHost(): string {
  const declared = readOverrides({ file: NAMES.overridesFile });
  const host = declared.active ? declared.values.get("apps-host") : undefined;
  return host && /^[a-z0-9.-]{1,253}$/i.test(host) && host !== NAMES.panelName ? host : lanAddress();
}

/** Where the panel answers: its name first, then the machine's address, for a device that cannot find `.local` names. */
export const panelUrls = (address = lanAddress()) => [`http://${NAMES.panelName}/`, `http://${address}/`];
export const panelUrl = () => panelUrls()[1];
/** Where the panel answers, as the machine says it to a person. */
export function panelWhere(): string {
  const [name, address] = panelUrls();
  return `${name}\n  (from a device that cannot find .local names: ${address})`;
}
