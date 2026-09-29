// The seventh brief's fixes (c) and (d), in a real browser against the panel
// on the test host: the Preview frame keeps what is typed in it across every
// redraw, and is reloaded only by a new start of the test copy (friction log
// 5); and nothing that has not run is green (friction log 3). Run from the
// product repository on the workstation, on a fresh test host whose nightly
// backup has not run yet:
//
//   node test/host/panel-fixes.mjs [--url http://allvibe.local:<the forwarded port>]
//
// It makes a project of its own, frameprobe, signs in with a fresh setup code
// and a password it makes up (neither printed), and prints one verdict a line.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const args = process.argv.slice(2);
/** The panel, by its name, at the port the harness forwards the test host's port 80 to (D74). */
function panelUrl() {
  const status = spawnSync(process.execPath, ["test/host/host.mjs", "status"], { encoding: "utf8" }).stdout;
  const port = /panel +test host 80 -> http:\/\/[^:]+:(\d+)\//.exec(status)?.[1];
  return port ? `http://allvibe.local:${port}` : "http://localhost:8099";
}
const URL_ = args.includes("--url") ? args[args.indexOf("--url") + 1] : panelUrl();
const APP = "frameprobe";
const C = "allvibe";
const GREEN = ["rgb(0, 166, 80)", "rgb(221, 243, 229)", "rgb(19, 48, 31)"];
let total = 0;
let wrong = 0;
function verdict(label, seen, must) {
  total += 1;
  const good = typeof must === "function" ? must(seen) : must instanceof RegExp ? must.test(String(seen)) : String(seen) === String(must);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(66)} ${String(seen).replace(/\s+/g, " ").slice(0, 60).padEnd(30)} ${good ? "as it must be" : "WRONG"}`);
}
const harness = (...a) => spawnSync(process.execPath, ["test/host/host.mjs", ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
function onHost(what, ...a) {
  const r = harness("exec", "--", ...a);
  if (r.status !== 0 && what) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
}
const notGreen = (colours) => colours.every((c) => !GREEN.some((g) => c.startsWith(g.slice(0, -1))));

console.log(`the app ${APP}, with two steps built, and the panel's first visit:`);
harness("push", "test/host/panel-fixture.mjs", "/root/");
onHost(null, C, "project", "remove", APP, "--delete-everything");
onHost("project create", C, "project", "create", APP);
onHost("the plan", "node", "/root/panel-fixture.mjs", "plan", APP, "2");
const code = onHost("a setup code", "node", "/root/panel-fixture.mjs", "setup-code");
const password = `fixes ${randomBytes(12).toString("base64url")}`;

const browser = await launch();
const page = await openPage(browser.port, { width: 1280, height: 800, scheme: "light" });
try {
  await page.goto(`${URL_}/`);
  await page.click("#code");
  await page.type(code);
  await page.click("#password");
  await page.type(password);
  await page.click("#again");
  await page.type(password);
  await page.click("#setup-form button[type=submit]");
  await page.waitFor(`location.pathname === "/" && !!document.querySelector(".status-row")`, { what: "home" });

  console.log("(d) colours, before the nightly checks have run:");
  const colours = (sel) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return ["(none)"]; const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopColor, s.boxShadow]; })()`);
  verdict("the home line says so", await page.text(".status-row b"), "The nightly checks have not run yet.");
  verdict("its light: nothing green", (await colours(".status-row .led")).join(" "), (s) => notGreen(s.split(/ (?=rgb)/)));
  verdict("its line: nothing green", (await colours(".status-row")).join(" "), (s) => notGreen(s.split(/ (?=rgb)/)));
  verdict("the side bar's light: nothing green", (await colours("#side-status .led")).join(" "), (s) => notGreen(s.split(/ (?=rgb)/)));

  // As from home's "Try step 1" (D75): the app opens trying it, and its "Step 1 works" is the next action.
  await page.goto(`${URL_}/apps/${APP}#try`);
  await page.waitFor(`!!document.querySelector("iframe.tc-frame") && !!document.querySelector("[data-action=works]")`, { what: "the frame and Step 1 works" });
  verdict('"Step 1 works": not green', (await colours("[data-action=works]")).join(" "), (s) => notGreen(s.split(/ (?=rgb)/)));

  console.log("(c) the Preview frame keeps what is typed in it:");
  // The frame is the test copy's own origin: read it from an isolated world of its own.
  async function inFrame(expression) {
    const src = await page.eval(`document.querySelector("iframe.tc-frame")?.src ?? ""`);
    return src ? page.evalInFrame(new URL(src).origin, expression) : null;
  }
  await page.waitFor(`true`);
  await sleep(1500);
  verdict("the frame's form", await inFrame(`!!document.querySelector("input[name=name]")`), true);
  // Each redraw below gets text of its own, typed just before it, so that each is tried on its own.
  let typed = "";
  async function typeFresh() {
    typed = `typed before a redraw ${randomBytes(3).toString("hex")}`;
    await inFrame(`(() => { document.documentElement.dataset.probe = "the same page"; const el = document.querySelector("input[name=name]"); el.value = ""; el.focus(); return true; })()`);
    await page.type(typed);
  }
  const kept = async () => (await inFrame(`document.querySelector("input[name=name]")?.value ?? "(gone)"`)) === typed ? "kept" : "lost";
  await typeFresh();
  verdict("typed into the frame", await kept(), "kept");

  await page.click("#rtab-live");
  await page.waitFor(`!document.querySelector("#live-pane, #rpane") || document.querySelector("#rtab-live").getAttribute("aria-selected") === "true"`);
  await sleep(300);
  await page.click("#rtab-preview");
  await sleep(800);
  verdict("after Live and back to Preview", await kept(), "kept");

  await typeFresh();
  await page.click("[data-action=works]");
  await page.waitFor(`/1 of 2 tried/.test(document.querySelector("#plan-box")?.textContent ?? "")`, { what: "step 1 marked tried" });
  await sleep(800);
  verdict("after a step is marked tried, and the page drawn again", await kept(), "kept");

  await typeFresh();
  const apiDone = await page.eval(`(async () => { const t = (await (await fetch("/api/session")).json()).result.token; const r = await fetch("/api/op/app.markTried", { method: "POST", headers: { "Content-Type": "application/json", "X-Allvibe-Token": t }, body: JSON.stringify({ app: "${APP}", step: 2 }) }); return (await r.json()).ok; })()`);
  verdict("step 2 marked tried elsewhere (as from another window)", apiDone, true);
  await page.waitFor(`/2 of 2 tried/.test(document.querySelector("#plan-box")?.textContent ?? "")`, { what: "the quiet look for changes to draw it", timeout: 25000 });
  await sleep(800);
  verdict("after the look for changes drew it", await kept(), "kept");

  console.log("(c) a change to the test copy itself reloads the frame:");
  const reloaded = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const marker = await inFrame(`document.documentElement.dataset.probe ?? "a new page"`).catch(() => null);
      if (marker === "a new page") return "reloaded";
      await sleep(500);
    }
    return "not reloaded";
  };
  await typeFresh();
  onHost("a change", "runuser", "-u", C, "--", "sed", "-i", "s|<h1>Guestbook <span|<h1>A changed heading <span|", `/var/lib/${C}/projects/${APP}/repo/server.js`);
  onHost("dev commit", C, "dev", "commit", APP, "A changed heading");
  onHost("dev deploy", C, "dev", "deploy", APP);
  verdict("the frame, within 30 s of a new start with a change", await reloaded(30000), "reloaded");
  verdict("and it shows the change", await inFrame(`document.querySelector("h1")?.textContent ?? ""`), /^A changed heading/);
  // Every step tried, the page has moved on to Live by itself (D75): the button is in Preview.
  await page.click("#rtab-preview");
  await sleep(400);
  await typeFresh();
  await page.click("[data-action=start-test]");
  verdict('the frame, after "Restart the test copy"', await reloaded(120000), "reloaded");

  console.log("(d) a live app that is not running is not green:");
  const put = await page.eval(`(async () => { const t = (await (await fetch("/api/session")).json()).result.token; const r = await fetch("/api/op/app.putLive", { method: "POST", headers: { "Content-Type": "application/json", "X-Allvibe-Token": t }, body: JSON.stringify({ app: "${APP}" }) }); return r.json(); })()`);
  verdict("put live, through the engine", put.ok ? "a job" : put.error?.message, "a job");
  const ended = put.ok
    ? await (async () => {
        const end = Date.now() + 240000;
        while (Date.now() < end) {
          const j = await page.eval(`(async () => { const t = (await (await fetch("/api/session")).json()).result.token; const r = await fetch("/api/op/job.get", { method: "POST", headers: { "Content-Type": "application/json", "X-Allvibe-Token": t }, body: JSON.stringify({ job: "${put.result.job}" }) }); return (await r.json()).result; })()`);
          if (j?.state === "finished") return j.ok ? "live" : "failed";
          await sleep(1000);
        }
        return "never ended";
      })()
    : "not started";
  verdict("the release", ended, "live");
  onHost("docker stop", "docker", "stop", `${C}-${APP}-prod-app`);
  await page.goto(`${URL_}/`);
  await page.waitFor(`!!document.querySelector(".app-card")`);
  const card = `[href="/apps/${APP}"]`;
  const chip = await page.eval(`(() => { const c = [...document.querySelectorAll(".app-card")].find((x) => x.querySelector(${JSON.stringify(card)})); const chip = c?.querySelector(".chip"); return chip ? [chip.textContent, getComputedStyle(chip).backgroundColor, getComputedStyle(chip).borderTopColor].join(" | ") : "(no chip)"; })()`);
  verdict("its card's chip, with the live app stopped", chip.split(" | ")[0], /^v\d+ is not running$/);
  verdict("and its colours: nothing green", chip, (s) => notGreen(s.split(" | ").slice(1)));
  const dot = await page.eval(`getComputedStyle(document.querySelector('#nav a[href="/apps/${APP}"] .dot')).backgroundColor`);
  verdict("its dot in the side bar: nothing green", dot, (s) => notGreen([s]));
  onHost("docker start", "docker", "start", `${C}-${APP}-prod-app`);
} finally {
  await page.close();
  await browser.close();
}
console.log(`${total - wrong} of ${total} as they must be`);
process.exitCode = wrong ? 1 : 0;
