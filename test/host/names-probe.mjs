// The panel and the apps on different host names, and the Preview frame
// fenced (D66, question 1; D74): run from the product repository on the
// workstation, against a fresh test host, in a real browser and on the host.
//
//   node test/host/names-probe.mjs
//
//   1. the panel's name: announced on the machine and heard by another device,
//      answering on port 80 there, by its name and by the machine's address;
//      no other name; the old door gone; no app's door on the panel's name;
//   2. the panel's cookie never reaches the test copy or the live app: by the
//      panel's name the browser does not even send it; by the fallback, the
//      machine's address for both, the browser sends it and the apps' doors
//      take it out; looked at from inside the app, which names the cookies it
//      received (panel-fixture.mjs cookies);
//   3. the framed test copy, from its own scripts: it cannot navigate the top
//      window, open a window, or reach the panel with a message;
//   4. a request with another Origin, another port of the same host included,
//      or none, changes nothing; the panel's own origin does.
// It signs in with a fresh setup code and a password it makes up; neither is
// printed, nor any cookie's value. One verdict a line; the last counts.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const C = "allvibe";
const NAME = `${C}.local`;
const APP = "nameprobe";
const COOKIE = `${C}_panel`;
let total = 0;
let wrong = 0;
function verdict(label, seen, must) {
  total += 1;
  const good = typeof must === "function" ? must(seen) : must instanceof RegExp ? must.test(String(seen)) : String(seen) === String(must);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(70)} ${String(seen).replace(/\s+/g, " ").slice(0, 44).padEnd(44)} ${good ? "as it must be" : "WRONG"}`);
}
const harness = (...a) => spawnSync(process.execPath, ["test/host/host.mjs", ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
function onHost(what, ...a) {
  const r = harness("exec", "--", ...a);
  if (r.status !== 0 && what) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
  return r.stdout.trim();
}
const ask = (address, port, host, path = "/", cookie) => onHost(null, "node", "/root/http-ask.mjs", address, String(port), host, path, ...(cookie ? [cookie] : []));
const askFromDevice = (address, port, host, path = "/") => onHost(null, "ip", "netns", "exec", "lan-device", "node", "/root/http-ask.mjs", address, String(port), host, path);
const status = (answer) => answer.split(" ")[0];

/* ------------------------------------------------------------ the host -- */
console.log(`the test host, the stand-in device, and the app ${APP} with a route that names the cookies it receives:`);
for (const f of ["panel-fixture.mjs", "mdns-ask.mjs", "http-ask.mjs", "lan-fixtures.sh"]) harness("push", `test/host/${f}`, "/root/");
onHost("the stand-in device", "sh", "/root/lan-fixtures.sh");
onHost(null, C, "project", "remove", APP, "--delete-everything");
onHost("project create", C, "project", "create", APP);
onHost("the route", "node", "/root/panel-fixture.mjs", "cookies", APP);
onHost("the release", C, "release", APP, "--outside-plan", "a route that names the cookies it receives, for a probe");
const project = JSON.parse(onHost("the project", "cat", `/var/lib/${C}/projects/${APP}/project.json`));
const { prod, dev, prodApp } = project.ports;
const lan = /src (\d+\.\d+\.\d+\.\d+)/.exec(onHost("the address", "ip", "-4", "route", "get", "1.1.1.1"))[1];
const localPanel = Number(/panel +test host 80 -> http:\/\/[^:]+:(\d+)\//.exec(harness("status").stdout)?.[1]);
if (!localPanel) throw new Error("the harness does not forward the test host's port 80: make the test host again");

console.log("1. the panel's name, and port 80:");
verdict("the name, as the machine resolves it (Avahi)", onHost(null, "avahi-resolve", "-4", "-n", NAME).split(/\s+/)[1] ?? "", lan);
verdict("the name, asked by another device by multicast DNS", onHost(null, "ip", "netns", "exec", "lan-device", "node", "/root/mdns-ask.mjs", NAME), lan);
verdict("port 80, by the panel's name, from the machine", status(ask(lan, 80, NAME, "/health")), "200");
verdict("port 80, by the panel's name, from the other device", status(askFromDevice(lan, 80, NAME, "/health")), "200");
verdict("port 80, by the machine's address (the fallback), from the device", status(askFromDevice(lan, 80, lan, "/health")), "200");
verdict("port 80, by another name", status(ask(lan, 80, "evil.example", "/health")), "421");
verdict("port 8099, the panel's old door", status(ask(lan, 8099, lan, "/health")), /^(ECONNREFUSED|404)$/);
verdict("the live app's door, asked by the panel's name", status(ask(lan, prod, NAME, "/cookies-received")), "421");
verdict("the test copy's door, asked by the panel's name", status(ask(lan, dev, NAME, "/cookies-received")), "421");

console.log("2. the panel's cookie, as the apps receive it, from the machine's side:");
const both = `${COOKIE}=a-stand-in; own=1`;
verdict("the control: the live app, straight at its own port, sees it", ask("127.0.0.1", prodApp, "localhost", "/cookies-received", both), /"cookies":\["allvibe_panel","own"\]/);
verdict("through the live app's door: only its own", ask(lan, prod, lan, "/cookies-received", both), /^200 \{"cookies":\["own"\]\}$/);
verdict("through the test copy's door: only its own", ask(lan, dev, lan, "/cookies-received", both), /^200 \{"cookies":\["own"\]\}$/);
verdict("the panel's cookie twice, and last: none of it", ask(lan, dev, lan, "/cookies-received", `${COOKIE}=a; own=1; ${COOKIE}=b`), /^200 \{"cookies":\["own"\]\}$/);

/* --------------------------------------------------------- the browser -- */
const code = onHost("a setup code", "node", "/root/panel-fixture.mjs", "setup-code");
const password = `names ${randomBytes(12).toString("base64url")}`;
const browser = await launch();
const panelAt = (host) => `http://${host}:${localPanel}`;
const page = await openPage(browser.port, { width: 1280, height: 800 });
const sentCookies = [];
page.on("Network.requestWillBeSentExtraInfo", (p) => {
  const header = Object.entries(p.headers ?? {}).find(([k]) => k.toLowerCase() === "cookie")?.[1] ?? "";
  sentCookies.push({ id: p.requestId, names: header.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean) });
});
const other = await openPage(browser.port, { width: 1280, height: 800 });
const otherSent = [];
other.on("Network.requestWillBeSentExtraInfo", (p) => {
  const header = Object.entries(p.headers ?? {}).find(([k]) => k.toLowerCase() === "cookie")?.[1] ?? "";
  otherSent.push({ url: p.headers?.Host ?? "", names: header.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean) });
});
async function received(url) {
  otherSent.length = 0;
  await other.goto(url);
  const body = await other.eval("document.body.innerText");
  const sent = otherSent.flatMap((r) => r.names);
  let names = [];
  try { names = JSON.parse(body).cookies; } catch { names = [`(not the route's answer: ${body.slice(0, 40)})`]; }
  return { sent: sent.includes(COOKIE) ? "sent" : "not sent", got: names.includes(COOKIE) ? "received" : "not received", names };
}

try {
  console.log(`2. signed in by the panel's name, ${NAME}:`);
  await page.goto(`${panelAt(NAME)}/`);
  await page.click("#code");
  await page.type(code);
  await page.click("#password");
  await page.type(password);
  await page.click("#again");
  await page.type(password);
  await page.click("#setup-form button[type=submit]");
  await page.waitFor(`location.pathname === "/" && !!document.querySelector(".status-row")`, { what: "home" });
  const cookies = (await page.send("Network.getCookies", { urls: [panelAt(NAME)] })).cookies;
  const session = cookies.find((c) => c.name === COOKIE);
  verdict("the session cookie: the panel's name only, HttpOnly, SameSite Strict", session ? `${session.domain} ${session.httpOnly} ${session.sameSite}` : "none", `${NAME} true Strict`);

  await page.goto(`${panelAt(NAME)}/apps/${APP}`);
  await page.waitFor(`!!document.querySelector("iframe.tc-frame")`, { what: "the Preview frame" });
  verdict("the Preview frame's address: the apps' host, not the panel's name", await page.eval(`document.querySelector("iframe.tc-frame").src`), `http://localhost:${dev}/`);
  verdict("its sandbox", await page.eval(`document.querySelector("iframe.tc-frame").getAttribute("sandbox")`), "allow-scripts allow-same-origin allow-forms");
  const policy = await page.eval(`(async () => (await fetch(location.href)).headers.get("content-security-policy"))()`);
  verdict("the page's policy frames that address only", /frame-src ([^;]+)/.exec(policy ?? "")?.[1] ?? "", `http://localhost:${dev}`);

  let r = await received(`http://localhost:${dev}/cookies-received`);
  verdict("the test copy: the browser sends the panel's cookie", r.sent, "not sent");
  verdict("the test copy receives it", r.got, "not received");
  r = await received(`http://localhost:${prod}/cookies-received`);
  verdict("the live app: the browser sends the panel's cookie", r.sent, "not sent");
  verdict("the live app receives it", r.got, "not received");

  console.log("3. the framed test copy, from its own scripts:");
  await sleep(1000);
  // In the frame's own scripts, as the test copy's code would run them; never the page's (a frame
  // from another site has its own process, cdp.mjs evalInFrame).
  const inFrame = async (expression) => (await page.evalInFrame(`http://localhost:${dev}`, expression, { userGesture: true })) ?? "(no such frame)";
  verdict("its scripts run, in its own origin", await inFrame("location.origin"), `http://localhost:${dev}`);
  const topBefore = await page.eval("location.href");
  const targetsBefore = (await page.send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").length;
  verdict("it navigates the top window", await inFrame(`(() => { try { top.location.href = "http://localhost:${dev}/?taken-over"; return "no error"; } catch (e) { return "refused: " + e.name; } })()`), /^refused/);
  await sleep(1500);
  verdict("the top window stays the panel's", await page.eval("location.href"), topBefore);
  verdict("it opens a window", await inFrame(`(() => { const w = window.open("http://localhost:${dev}/?popup"); return w === null ? "refused: no window" : "a window"; })()`), /^refused/);
  await sleep(1000);
  verdict("windows in the browser", (await page.send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").length, targetsBefore);
  const liveBefore = await page.eval(`(async () => { const t = (await (await fetch("/api/session")).json()).result.token; return (await (await fetch("/api/op/app.get", { method: "POST", headers: { "Content-Type": "application/json", "X-Allvibe-Token": t }, body: JSON.stringify({ app: "${APP}" }) })).json()).result.live; })()`);
  await inFrame(`parent.postMessage({ operation: "app.goBack", app: "${APP}" }, "*")`);
  await inFrame(`(() => { const f = document.createElement("form"); f.method = "POST"; f.action = "${panelAt(NAME)}/api/op/app.goBack"; f.target = "_top"; document.body.append(f); try { f.submit(); } catch (e) {} return true; })()`);
  await sleep(3000);
  const liveAfter = await page.eval(`(async () => { const t = (await (await fetch("/api/session")).json()).result.token; return (await (await fetch("/api/op/app.get", { method: "POST", headers: { "Content-Type": "application/json", "X-Allvibe-Token": t }, body: JSON.stringify({ app: "${APP}" }) })).json()).result.live; })()`);
  verdict("a message and a form to the panel: the live version", `${liveBefore} then ${liveAfter}`, `${liveBefore} then ${liveBefore}`);
  verdict("the top window, after them", await page.eval("location.href"), topBefore);
  // The control: the live app framed by the test copy in a tab of its own, without a sandbox:
  // the same script there does take the top window over.
  await other.goto(`http://localhost:${dev}/`);
  await other.eval(`(() => { const f = document.createElement("iframe"); f.src = "http://localhost:${prod}/"; document.body.append(f); return true; })()`);
  await sleep(2000);
  const tried = await other.evalInFrame(`http://localhost:${prod}`, `(() => { top.location.href = "http://localhost:${dev}/?taken-over"; return "tried"; })()`, { userGesture: true });
  await sleep(2000);
  verdict("the control: a frame without the sandbox takes the top window over", `${tried} ${await other.eval("location.search")}`, "tried ?taken-over");

  console.log("4. requests from other origins change nothing:");
  const token = await page.eval(`(async () => (await (await fetch("/api/session")).json()).result.token)()`);
  const cookie = `${COOKIE}=${session.value}`;
  const reports = () => Number(onHost(null, "sh", "-c", `ls /var/lib/${C}/projects/${APP}/reports 2>/dev/null | wc -l`));
  const post = (origin, extra = {}) => new Promise((resolve) => {
    const body = JSON.stringify({ app: APP, text: "a probe of the Origin check" });
    const headers = { Host: `${NAME}:${localPanel}`, Cookie: cookie, "Content-Type": "application/json", "X-Allvibe-Token": token, "Content-Length": Buffer.byteLength(body), ...(origin ? { Origin: origin } : {}), ...extra };
    const req = http.request({ host: "127.0.0.1", port: localPanel, method: "POST", path: "/api/op/app.report", headers, setHost: false }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", (e) => resolve(e.code));
    req.end(body);
  });
  const before = reports();
  for (const [what, origin, extra] of [
    ["another port of the panel's own name (an app's)", `http://${NAME}:${dev}`],
    ["the panel's port, another host", `http://localhost:${localPanel}`],
    ["a sandboxed frame's", "null"],
    ["another site", "http://evil.example"],
    ["none, with same-origin fetch metadata", null, { "Sec-Fetch-Site": "same-origin" }],
    ["none", null],
  ]) verdict(`a report, from ${what}`, await post(origin, extra), "403");
  verdict("reports written by them", reports() - before, 0);
  verdict("the control: from the panel's own origin", await post(`http://${NAME}:${localPanel}`), "200");
  verdict("reports written by it", reports() - before, 1);

  console.log("2. signed in by the machine's address, the fallback, where the panel and the apps share a host:");
  await page.goto(`${panelAt("localhost")}/sign-in`);
  await page.click("#password");
  await page.type(password);
  await page.key("Enter");
  await page.waitFor(`location.pathname === "/"`, { what: "home, by the address" });
  await other.goto(`http://localhost:${dev}/`);
  await other.eval(`document.cookie = "own=1; path=/"`);
  r = await received(`http://localhost:${dev}/cookies-received`);
  verdict("the test copy: the browser sends the panel's cookie (one host)", r.sent, "sent");
  verdict("the test copy receives it", r.got, "not received");
  verdict("and it receives its own", r.names.includes("own") ? "own received" : "own lost", "own received");
  r = await received(`http://localhost:${prod}/cookies-received`);
  verdict("the live app: the browser sends the panel's cookie", r.sent, "sent");
  verdict("the live app receives it", r.got, "not received");
} finally {
  await other.close();
  await page.close();
  await browser.close();
}
console.log(`${total - wrong} of ${total} as they must be`);
process.exitCode = wrong ? 1 : 0;
