// The agent's terminal through the panel (D76), probed from the workstation
// against a fresh test host, in real browsers and on the host:
//
//   node test/host/terminal-probe.mjs
//
//   1. attaching is refused without a session, from another origin (another
//      site, and, by the fallback address, the test copy's own page on the
//      panel's host), without an Origin, and without the session's token;
//   2. with them, Claude Code's own screen arrives, and what is typed reaches
//      it: a marker typed into its prompt is shown there, and never submitted;
//   3. a second browser, signed in on its own, takes over: the first is told,
//      and types nothing any more;
//   4. after the idle time (a test host declares it short), Claude Code is
//      hung up on, and the browser told;
//   5. the marker typed and shown is in no log, file or record of the suite on
//      the host: the journal, the suite's folders, every container's log and
//      every file a container wrote, the agent's working copy, its activity
//      log and its kept conversations.
// The agent signs in with a stand-in key here (never an account: the suite
// drives Claude Code only with a key, D48); it talks to no model. One verdict
// a line; the last counts what is not as it must be.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const C = "allvibe";
const APP = "termprobe";
const NAME = `${C}.local`;
let total = 0;
let wrong = 0;
function verdict(label, seen, must) {
  total += 1;
  const good = typeof must === "function" ? must(seen) : must instanceof RegExp ? must.test(String(seen)) : String(seen) === String(must);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(66)} ${String(seen).replace(/\s+/g, " ").slice(0, 48).padEnd(48)} ${good ? "as it must be" : "WRONG"}`);
}
const harness = (...a) => spawnSync(process.execPath, ["test/host/host.mjs", ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
function onHost(what, ...a) {
  const r = harness("exec", "--", ...a);
  if (r.status !== 0 && what) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
  return r.stdout.trim();
}
const localPanel = Number(/panel +test host 80 -> http:\/\/[^:]+:(\d+)\//.exec(harness("status").stdout)?.[1]);
const panelAt = (host) => `http://${host}:${localPanel}`;

/* ------------------------------------------------------------ the host -- */
console.log(`the app ${APP}, and its agent, with a stand-in key:`);
harness("push", "test/host/panel-fixture.mjs", "/root/");
onHost(null, C, "project", "remove", APP, "--delete-everything");
onHost("project create", C, "project", "create", APP);
onHost("a stand-in key", "sh", "-c", `head -c 24 /dev/urandom | base64 | ${C} key set ${APP} agent ANTHROPIC_API_KEY > /dev/null`);
onHost("agent start", C, "agent", "start", APP);
harness("override", "unset", "terminal-idle-seconds");
const dev = JSON.parse(onHost("the project", "cat", `/var/lib/${C}/projects/${APP}/project.json`)).ports.dev;

/* ---------------------------------------------------------- a browser -- */
const password = `terminal ${randomBytes(12).toString("base64url")}`;
async function signIn(page, host, first) {
  if (first) {
    const code = onHost("a setup code", "node", "/root/panel-fixture.mjs", "setup-code");
    await page.goto(`${panelAt(host)}/`);
    await page.click("#code");
    await page.type(code);
    await page.click("#password");
    await page.type(password);
    await page.click("#again");
    await page.type(password);
    await page.click("#setup-form button[type=submit]");
  } else {
    await page.goto(`${panelAt(host)}/sign-in`);
    await page.click("#password");
    await page.type(password);
    await page.key("Enter");
  }
  await page.waitFor(`location.pathname === "/"`, { what: "home" });
}
// A terminal in the page, by the page's own WebSocket, as the panel's page opens one.
const OPEN = (url, start, token = null) => `(async () => {
  const token = ${token ? JSON.stringify(token) : `(await (await fetch("/api/session")).json()).result.token`};
  window.__t = { got: [], text: "", closed: null, ready: null };
  const ws = new WebSocket(${JSON.stringify(url)});
  ws.binaryType = "arraybuffer";
  window.__ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token, cols: 120, rows: 36, start: ${start} }));
  ws.onmessage = (e) => {
    if (typeof e.data === "string") { const m = JSON.parse(e.data); window.__t.got.push(m); if (m.t === "ready") window.__t.ready = m.session; return; }
    const s = new TextDecoder().decode(e.data);
    // What a terminal answers when Claude Code asks what it is, as xterm.js does in the panel.
    if (s.includes("\\x1b[c")) ws.send(JSON.stringify({ t: "in", d: "\\x1b[?1;2c" }));
    window.__t.text += s;
  };
  ws.onclose = (e) => { window.__t.closed = e.code; };
  return true;
})()`;
// Claude Code draws words apart with cursor moves, not spaces: every control sequence counts as a space.
const plain = (s) => s.replace(/\x1b\[[0-9;?>=]*[ -\/]*[@-~]/g, " ").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>78]/g, "").replace(/[ \t]+/g, " ");
const screen = async (page) => plain(await page.eval("window.__t?.text ?? ''"));
const typeIn = (page, d) => page.eval(`window.__ws.send(JSON.stringify({ t: "in", d: ${JSON.stringify(d)} }))`);
async function waitScreen(page, re, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (re.test(await screen(page))) return true;
    await sleep(300);
  }
  return false;
}

/** A WebSocket's upgrade by hand, for the status the panel answers it with. */
function upgrade(headers) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: localPanel, path: `/api/terminal/${APP}`, headers: { Host: `${NAME}:${localPanel}`, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), "Sec-WebSocket-Version": "13", ...headers }, setHost: false });
    req.on("response", (res) => { res.resume(); resolve(String(res.statusCode)); });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve("101"); });
    req.on("error", (e) => resolve(e.code));
    req.end();
  });
}

const marker = `typed-${randomBytes(6).toString("hex")}`;
const browser = await launch();
const second = await launch();
const a = await openPage(browser.port, { width: 1280, height: 800 });
const stranger = await openPage(second.port, { width: 1280, height: 800 });
try {
  await signIn(a, NAME, true);
  const cookies = (await a.send("Network.getCookies", { urls: [panelAt(NAME)] })).cookies;
  const cookie = `${C}_panel=${cookies.find((c) => c.name === `${C}_panel`)?.value}`;

  console.log("1. attaching, refused:");
  verdict("without a session", await upgrade({ Origin: panelAt(NAME) }), "401");
  verdict("from another site", await upgrade({ Cookie: cookie, Origin: "http://evil.example" }), "403");
  verdict("from another port of the panel's name (an app's)", await upgrade({ Cookie: cookie, Origin: `http://${NAME}:${dev}` }), "403");
  verdict("without an Origin", await upgrade({ Cookie: cookie }), "403");
  verdict("the control: with the session and its origin, the upgrade itself", await upgrade({ Cookie: cookie, Origin: panelAt(NAME) }), "101");
  await stranger.goto(`${panelAt(NAME)}/sign-in`);
  await stranger.eval(OPEN(`ws://${NAME}:${localPanel}/api/terminal/${APP}`, true, "x".repeat(43)));
  await stranger.waitFor("window.__t.closed !== null", { what: "the stranger's socket to close", timeout: 10000 });
  verdict("a browser that is not signed in, in the panel's own page", `${await stranger.eval("window.__t.ready")} ${await stranger.eval("window.__t.closed")}`, "null 1006");
  await a.goto(`${panelAt(NAME)}/`);
  await a.eval(OPEN(`ws://${NAME}:${localPanel}/api/terminal/${APP}`, true, "x".repeat(43)));
  await a.waitFor("window.__t.closed !== null", { what: "the socket with a wrong token to close", timeout: 10000 });
  verdict("signed in, with a wrong token", `${await a.eval("window.__t.ready")} ${await a.eval("window.__t.closed")}`, "null 4401");
  // By the fallback address, the test copy's own page shares the panel's host,
  // and the browser sends it the panel's cookie: only the Origin tells them apart.
  await signIn(a, "localhost", false);
  await a.goto(`http://localhost:${dev}/`);
  await a.eval(OPEN(`ws://localhost:${localPanel}/api/terminal/${APP}`, true, "x".repeat(43)));
  await a.waitFor("window.__t.closed !== null", { what: "the test copy's socket to close", timeout: 10000 });
  verdict("the test copy's own page, by the fallback address", `${await a.eval("window.__t.ready")} ${await a.eval("window.__t.closed")}`, "null 1006");

  console.log("2. Claude Code's own screen, and what is typed:");
  await a.goto(`${panelAt(NAME)}/`);
  await a.eval(OPEN(`ws://${NAME}:${localPanel}/api/terminal/${APP}`, true));
  await a.waitFor("window.__t.ready !== null || window.__t.closed !== null", { what: "the terminal", timeout: 20000 });
  verdict("the terminal, opened by the person", await a.eval("window.__t.ready"), "started");
  verdict("Claude Code's screen arrives: its first start", await waitScreen(a, /Choose the text style/), true);
  // Its first start, as a person goes through it (seen on this version): the
  // text style, the security notes, and trusting the working copy, whose
  // default is "No, exit" (mistake 35), so the arrow down first.
  await typeIn(a, "\r");
  verdict("the security notes", await waitScreen(a, /Security notes/, 20000), true);
  await typeIn(a, "\r");
  verdict("trusting the working copy, No first", await waitScreen(a, /No, exit\s+Yes, I trust this folder/, 20000), true);
  await typeIn(a, "\x1b[B");
  await sleep(500);
  await typeIn(a, "\r");
  verdict("its prompt", await waitScreen(a, /auto mode on/, 30000), true);
  await typeIn(a, marker);
  verdict("a marker typed, shown in its prompt, not submitted", await waitScreen(a, new RegExp(marker), 10000), true);

  console.log("3. a second browser, signed in on its own, takes over:");
  const b = await openPage(second.port, { width: 1000, height: 700 });
  await signIn(b, NAME, false);
  await b.eval(OPEN(`ws://${NAME}:${localPanel}/api/terminal/${APP}`, false));
  await b.waitFor("window.__t.ready !== null || window.__t.closed !== null", { what: "the second terminal", timeout: 20000 });
  verdict("the second: it joins the same Claude Code", `${await b.eval("window.__t.ready")} ${await b.eval("window.__t.closed")} ${JSON.stringify(await b.eval("window.__t.got"))}`, /^joined null/);
  verdict("which draws itself again for it, the marker still in its prompt", await waitScreen(b, new RegExp(marker), 20000), true);
  await a.waitFor("window.__t.closed !== null", { what: "the first to be let go", timeout: 10000 });
  verdict("the first: told", JSON.stringify((await a.eval("window.__t.got")).find((m) => m.t === "taken") ?? null), /"t":"taken"/);
  verdict("and let go", await a.eval("window.__t.closed"), 1000);

  console.log("4. idle:");
  harness("override", "set", "terminal-idle-seconds=15");
  await b.waitFor("window.__t.closed !== null", { what: "the idle time", timeout: 90000 }).catch(() => null);
  verdict("after the idle time, the browser is told", JSON.stringify((await b.eval("window.__t.got")).find((m) => m.t === "ended") ?? null), '{"t":"ended","why":"idle"}');
  harness("override", "unset", "terminal-idle-seconds");
  await b.close();

  console.log("5. the marker, anywhere the suite writes on the host:");
  const where = [
    ["the journal", `journalctl --no-pager -o cat | grep -cF ${marker}`],
    ["the suite's folders, its settings, its program", `grep -rlF ${marker} /var/lib/${C} /etc/${C} /opt/${C} /var/log /root 2>/dev/null | wc -l`],
    ["the machine's temporary folders and /run", `grep -rlsF ${marker} /tmp /var/tmp /run 2>/dev/null | wc -l`],
    ["every container's log", `grep -rlF ${marker} /var/lib/docker/containers 2>/dev/null | wc -l`],
    ["every file a container wrote", `for d in $(docker ps -aq); do docker inspect -f '{{.GraphDriver.Data.UpperDir}}' $d; done | xargs -r grep -rlsF ${marker} 2>/dev/null | wc -l`],
    ["the agent's own home and temporary files, in its memory", `docker exec ${C}-${APP}-agent sh -c 'grep -rlsF ${marker} /home/agent /tmp /workspace 2>/dev/null | wc -l'`],
  ];
  const control = `probe-control-${randomBytes(4).toString("hex")}`;
  onHost(null, "sh", "-c", `echo ${control} > /var/lib/${C}/projects/${APP}/control.txt`);
  verdict("the control: the same search finds a marker put there", onHost(null, "sh", "-c", `grep -rlF ${control} /var/lib/${C} | wc -l`), "1");
  onHost(null, "rm", "-f", `/var/lib/${C}/projects/${APP}/control.txt`);
  for (const [what, command] of where) verdict(what, onHost(null, "sh", "-c", command), "0");
} finally {
  await a.close();
  await stranger.close();
  await browser.close();
  await second.close();
  onHost(null, C, "agent", "stop", APP);
}
console.log(`${total - wrong} of ${total} as they must be`);
process.exitCode = wrong ? 1 : 0;
