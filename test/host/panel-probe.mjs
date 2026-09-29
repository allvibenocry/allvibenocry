#!/usr/bin/env node
// The control panel (D63, D64), probed on the test host, as root, after
// install, with the LAN fixtures in place (lan-fixtures.sh) and a project with
// its agent's key (the walkthrough's moods):
//
//   node panel-probe.mjs <command> <project>
//
//   - every page and every operation needs a session;
//   - the setup code works once, and only while nobody has claimed the panel;
//   - wrong tries are limited;
//   - cross-site requests are refused, and there is no CORS;
//   - the door answers private source addresses only (a device on the home
//     network, then a public address), its own host names only, and not the
//     project's containers or the agent, by the machine's address or the
//     panel's own;
//   - its container: only the engine's socket folder, read-only, and nothing
//     from rule 12; from inside it, nothing is reachable.
//
// It uses the panel through its door as a browser would. The sign-in file is
// put back as it was and the panel restarted, so no session of the probe's
// is left. The last line counts what is not as it must be.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";

const C = process.argv[2] ?? "allvibe";
const P = process.argv[3] ?? "moods";
const AUTH = `/var/lib/${C}/panel/auth.json`;
const PANEL = `${C}-panel`;
let total = 0;
let wrong = 0;

const verdict = (label, seen, want) => {
  total += 1;
  const good = typeof want === "function" ? want(seen) : String(seen) === String(want);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(68)} ${String(seen).slice(0, 34).padEnd(34)} ${good ? "as it must be" : "WRONG"}`);
};
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const address = sh("ip", ["-4", "route", "get", "1.1.1.1"]).stdout.match(/\bsrc\s+(\S+)/)[1];
const base = `http://${address}:8099`;

/** One request, as a browser on the home network makes it; every header is the probe's own. */
function ask(method, path, { body, cookie, token, origin = base, host, type = "application/json" } = {}) {
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const headers = { Host: host ?? `${address}:8099` };
  if (payload !== undefined) Object.assign(headers, { "Content-Type": type, "Content-Length": Buffer.byteLength(payload) });
  if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  if (token) headers["X-Allvibe-Token"] = token;
  return new Promise((resolve) => {
    const request = http.request({ host: address, port: 8099, method, path, headers }, (response) => {
      let text = "";
      response.on("data", (c) => (text += c));
      response.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        const h = response.headers;
        resolve({ status: response.statusCode, headers: { get: (n) => (Array.isArray(h[n.toLowerCase()]) ? h[n.toLowerCase()].join(", ") : h[n.toLowerCase()] ?? null) }, json, text });
      });
    });
    request.on("error", (e) => resolve({ status: e.code, headers: { get: () => null }, json: null, text: "" }));
    request.end(payload);
  });
}
const cookieOf = (r) => (r.headers.get("set-cookie") ?? "").split(";")[0];

/** From a network namespace, or inside a container: the status, or why none came. */
function statusFrom(prefix, url) {
  const run = sh(prefix[0], [...prefix.slice(1), "node", "-e", `fetch(${JSON.stringify(url)},{redirect:"manual",signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status)).catch(e=>console.log(e.cause?.code??e.name))`]);
  return (run.stdout || run.stderr).trim().split("\n").pop();
}

const savedAuth = existsSync(AUTH) ? readFileSync(AUTH) : null;

/* --------------------------------------------------------- a new code -- */
console.log(`the panel at ${base.replace(address, "<the machine's address>")}:`);
const reset = sh(C, ["panel", "reset"]);
const code = reset.stdout.match(/setup code, for your first visit: ([A-Z2-9-]{19})/)?.[1];
verdict("a new setup code, shown on the machine", code ? "shown" : reset.stdout.slice(0, 30), "shown");

/* ------------------------------------------------- sessions and pages -- */
console.log("every page and operation needs a session:");
for (const page of ["/", "/apps/" + P, "/machine"]) {
  const r = await ask("GET", page, { origin: null });
  verdict(`GET ${page}, signed out`, `${r.status} ${r.headers.get("location")}`, "303 /setup");
}
verdict("GET /api/session, signed out", (await ask("GET", "/api/session", { origin: null })).status, 401);
for (const op of ["apps.list", "machine.status", "app.putLive", "app.goBack"]) {
  verdict(`POST /api/op/${op}, signed out`, (await ask("POST", `/api/op/${op}`, { body: { app: P } })).status, 401);
}

/* ---------------------------------------------------------- setup once -- */
console.log("the setup code works once, and only while nobody has claimed the panel:");
const password = `probe ${Math.random().toString(36).slice(2)} ${Date.now()}`;
const badCode = code.replace(/[A-Z2-9]/, (c) => (c === "A" ? "B" : "A"));
verdict("a wrong code", (await ask("POST", "/api/setup", { body: { setupCode: badCode, password } })).json?.error?.reason, "wrong");
const claimed = await ask("POST", "/api/setup", { body: { setupCode: code, password } });
verdict("the right code, and a password", claimed.status, 200);
const setCookie = claimed.headers.get("set-cookie") ?? "";
verdict("its cookie: HttpOnly, SameSite=Strict", /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie), true);
const cookie = cookieOf(claimed);
verdict("the same code again, from another browser", (await ask("POST", "/api/setup", { body: { setupCode: code, password: `${password}!` } })).json?.error?.reason, "claimed");
verdict("GET /setup, now the panel is claimed", `${(await ask("GET", "/setup", { origin: null })).status}`, "303");
verdict(`${C} panel setup-code, now the panel is claimed`, sh(C, ["panel", "setup-code"]).status, 1);
const session = await ask("GET", "/api/session", { cookie, origin: null });
const token = session.json?.result?.token;
verdict("signed in: GET /", (await ask("GET", "/", { cookie, origin: null })).status, 200);
verdict("signed in: POST /api/op/apps.list", (await ask("POST", "/api/op/apps.list", { body: {}, cookie, token })).json?.ok, true);

/* ------------------------------------------------------- cross-site -- */
console.log("cross-site requests are refused:");
verdict("no token", (await ask("POST", "/api/op/apps.list", { body: {}, cookie })).status, 403);
verdict("another origin", (await ask("POST", "/api/op/apps.list", { body: {}, cookie, token, origin: "http://evil.example" })).status, 403);
verdict("no origin at all", (await ask("POST", "/api/op/apps.list", { body: {}, cookie, token, origin: null })).status, 403);
verdict("a form's content type", (await ask("POST", "/api/op/apps.list", { body: "a=1", type: "application/x-www-form-urlencoded", cookie, token })).status, 415);
verdict("signing in from another origin", (await ask("POST", "/api/sign-in", { body: { password }, origin: "http://evil.example" })).status, 403);
const preflight = await ask("OPTIONS", "/api/op/apps.list", { origin: "http://evil.example" });
verdict("a CORS preflight: no Access-Control-Allow-Origin", preflight.headers.get("access-control-allow-origin") ?? "none", "none");
verdict("an operation of the engine's sign-in, through the panel", (await ask("POST", "/api/op/auth.check", { body: { password }, cookie, token })).status, 404);

/* ----------------------------------------------------------- attempts -- */
console.log("wrong tries are limited:");
await ask("POST", "/api/sign-out", { body: {}, cookie, token });
verdict("signed out: the old cookie", (await ask("GET", "/api/session", { cookie, origin: null })).status, 401);
let last = null;
for (let i = 1; i <= 5; i++) last = await ask("POST", "/api/sign-in", { body: { password: `${password}-wrong-${i}` } });
verdict("5 wrong passwords: sign-in paused", `${last.json?.error?.reason} ${last.json?.error?.pausedFor}`, (s) => /^wrong 30$|^paused (29|30)$/.test(s));
const during = await ask("POST", "/api/sign-in", { body: { password } });
verdict("the right password, while paused", `${during.status} ${during.json?.error?.reason}`, "403 paused");

/* -------------------------------------------------------------- where -- */
console.log("where it answers:");
verdict("a device on the home network (10.99.0.2), private", statusFrom(["ip", "netns", "exec", "lan-device"], `${base}/sign-in`), (s) => /^(200|303)$/.test(s));
sh("sh", ["-c", "ip netns del probe-public 2>/dev/null; ip link del pub0 2>/dev/null; ip netns add probe-public && ip link add pub0 type veth peer name eth0 netns probe-public && ip addr add 203.0.113.1/24 dev pub0 && ip link set pub0 up && ip -n probe-public addr add 203.0.113.2/24 dev eth0 && ip -n probe-public link set eth0 up && ip -n probe-public link set lo up && ip -n probe-public route add default via 203.0.113.1"]);
verdict("a public address (203.0.113.2), not private", statusFrom(["ip", "netns", "exec", "probe-public"], `${base}/sign-in`), 403);
sh("sh", ["-c", "ip netns del probe-public; ip link del pub0 2>/dev/null; true"]);
verdict("another host name (DNS rebinding)", (await ask("GET", "/sign-in", { host: "evil.example", origin: null })).status, 421);
const panelIp = sh("docker", ["inspect", "-f", `{{(index .NetworkSettings.Networks "${PANEL}").IPAddress}}`, PANEL]).stdout.trim();
let agentStarted = false;
if (sh("docker", ["inspect", "-f", "{{.State.Running}}", `${C}-${P}-agent`]).stdout.trim() !== "true") {
  agentStarted = sh(C, ["agent", "start", P]).status === 0;
}
for (const [name, container] of [["the test copy", `${C}-${P}-dev-app`], ["the live app", `${C}-${P}-prod-app`], ["the agent", `${C}-${P}-agent`]]) {
  verdict(`from ${name}, by the machine's address`, statusFrom(["docker", "exec", container], `${base}/sign-in`), (s) => !/^\d+$/.test(s));
  verdict(`from ${name}, by the panel's own address`, statusFrom(["docker", "exec", container], `http://${panelIp}:8080/sign-in`), (s) => !/^\d+$/.test(s));
}
if (agentStarted) sh(C, ["agent", "stop", P]);

/* ---------------------------------------------------------- container -- */
console.log("its container:");
const inspect = JSON.parse(sh("docker", ["inspect", PANEL]).stdout)[0];
const mounts = inspect.Mounts.map((m) => `${m.Source}->${m.Destination}${m.RW ? "" : ":ro"}`);
verdict("its mounts", mounts.join(" "), `/var/lib/${C}/engine->/run/engine:ro`);
verdict("its networks", Object.keys(inspect.NetworkSettings.Networks).join(" "), PANEL);
verdict("its network: internal", sh("docker", ["network", "inspect", "-f", "{{.Internal}}", PANEL]).stdout.trim(), "true");
verdict("host networking", inspect.HostConfig.NetworkMode === "host", false);
verdict("privileged", inspect.HostConfig.Privileged, false);
verdict("capabilities dropped", JSON.stringify(inspect.HostConfig.CapDrop), '["ALL"]');
verdict("capabilities added", JSON.stringify(inspect.HostConfig.CapAdd ?? []), "[]");
verdict("read-only root", inspect.HostConfig.ReadonlyRootfs, true);
verdict("no-new-privileges", inspect.HostConfig.SecurityOpt?.includes("no-new-privileges:true"), true);
verdict("its user: the panel's own, not root", inspect.Config.User, sh("sh", ["-c", `echo $(id -u ${PANEL}):$(id -g ${PANEL})`]).stdout.trim());
const env = inspect.Config.Env.map((e) => e.split("=")[0]).filter((n) => !["PATH", "NODE_VERSION", "YARN_VERSION"].includes(n)).sort().join(" ");
verdict("its environment: names only, no secret", env, "ENGINE_SOCKET PANEL_COMMAND PANEL_COOKIE PANEL_PRODUCT");
const inside = (cmd) => sh("docker", ["exec", PANEL, "sh", "-c", cmd]).stdout.trim();
verdict("inside it: the Docker socket", inside("[ -e /var/run/docker.sock ] && echo present || echo absent"), "absent");
verdict("inside it: the host key, the recovery key, the vault, the backups", inside(`ls -d /etc/${C} /var/lib/${C} /mnt/${C}-backup /run/${C} 2>/dev/null | wc -l`), 0);
verdict("inside it: the internet", statusFrom(["docker", "exec", PANEL], "https://example.com"), (s) => !/^\d+$/.test(s));
verdict("inside it: the machine's SSH, by its address", inside(`node -e "require('net').connect({host:'${address}',port:22,timeout:3000}).on('connect',()=>{console.log('CONNECTED');process.exit()}).on('error',e=>{console.log(e.code);process.exit()}).on('timeout',()=>{console.log('timed out');process.exit()})"`), (s) => s !== "CONNECTED");
verdict("inside it: the engine's socket", inside("[ -S /run/engine/engine.sock ] && echo present || echo absent"), "present");

/* ------------------------------------------------------------ cleanup -- */
if (savedAuth) writeFileSync(AUTH, savedAuth, { mode: 0o600 });
sh("chown", [`${C}:${C}`, AUTH]);
sh("docker", ["restart", PANEL]);
console.log("the sign-in file put back as it was, and the panel restarted: no session of the probe's is left");
console.log(`${total - wrong} of ${total} as they must be`);
process.exit(wrong ? 1 : 0);
