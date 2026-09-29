// The control panel's first slice, in a real browser, on the test host (the
// sixth brief, item 9): a step ready to try, tried, put live, and gone back
// from, with every check shown, and the two refusals (a step not tried, a
// failed backup) shown in plain words. Run from the product repository on the
// workstation, after a fresh test host (test/host/README.md):
//
//   node test/host/panel-journey.mjs <folder for screenshots> [--url http://localhost:8099] [--app moods]
//
// It signs in with a fresh setup code and a password it makes up and keeps in
// memory; neither is printed. The builder's part (a plan, built and deployed to
// the test copy) and the unplugged backup disk are done on the test host by
// panel-fixture.mjs, as the builder and the machine would.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = args[0];
const URL_ = opt("--url", "http://localhost:8099");
const APP = opt("--app", "moods");
if (!OUT || OUT.startsWith("--")) {
  process.stderr.write("usage: node test/host/panel-journey.mjs <folder for screenshots> [--url http://localhost:8099] [--app moods]\n");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------ the host -- */
const harness = (...a) => spawnSync("node", ["test/host/host.mjs", ...a], { encoding: "utf8" });
function onHost(...a) {
  const r = harness("exec", "--", "node", "/root/panel-fixture.mjs", ...a);
  if (r.status !== 0) throw new Error(`on the test host, panel-fixture ${a.join(" ")}: ${(r.stderr || r.stdout).trim().slice(-600)}`);
  return r.stdout.trim();
}

/* ------------------------------------------------------------- verdicts -- */
let passed = 0;
const section = (t) => console.log(`\n${t}`);
function expect(label, seen, want) {
  const good = typeof want === "function" ? want(seen) : want instanceof RegExp ? want.test(String(seen)) : String(seen) === String(want);
  const shown = String(seen).replace(/\s+/g, " ").slice(0, 220);
  if (!good) {
    console.log(`  WRONG ${label}\n        seen:   ${shown}\n        wanted: ${want instanceof RegExp ? want : typeof want === "function" ? "(a condition)" : want}`);
    throw new Error(`stopped at: ${label}`);
  }
  passed += 1;
  console.log(`  ok    ${label}: ${shown}`);
}
const note = (t) => console.log(`        ${t}`);

/* --------------------------------------------------------- the browser -- */
const browser = await launch();
let page;
const shot = (name) => page.shot(path.join(OUT, `${name}.png`));
const gates = () => page.eval(`[...document.querySelectorAll("#shipcard .safety li")].map((li) => li.className + ":" + li.firstElementChild.nextElementSibling.firstChild.textContent).join(" | ")`);
async function watchJob(until, name) {
  const seen = [];
  const deadline = Date.now() + 8 * 60 * 1000;
  let mid = false;
  for (;;) {
    const g = await gates().catch(() => "");
    if (g && g !== seen.at(-1)) seen.push(g);
    if (!mid && /now:Backup restored/.test(g)) { await shot(`${name}-running`); mid = true; }
    const h = await page.text("#shipcard h2").catch(() => null);
    if (h && until.test(h)) return { heading: h, seen };
    if (Date.now() > deadline) throw new Error(`waited 8 minutes for ${until}`);
    await sleep(500);
  }
}
const apiGet = (op, body) => page.eval(`(async () => { const t = (await (await fetch("/api/session")).json()).result.token; const r = await fetch("/api/op/${op}", { method: "POST", headers: { "Content-Type": "application/json", "X-Allvibe-Token": t }, body: ${JSON.stringify(JSON.stringify(body))} }); return r.json(); })()`);

try {
  section("On the test host: the builder has built two steps of a plan");
  const pushed = harness("push", "test/host/panel-fixture.mjs", "/root/");
  if (pushed.status !== 0) throw new Error(`push: ${pushed.stderr}`);
  note(onHost("plan", APP, "2"));
  const code = onHost("setup-code");
  const password = `journey ${randomBytes(12).toString("base64url")}`;

  page = await openPage(browser.port, { width: 1280, height: 800, scheme: "light" });

  section("The first visit: the setup code and a password");
  await page.goto(`${URL_}/`);
  expect("an unclaimed panel sends the browser to", await page.eval("location.pathname"), "/setup");
  await page.click("#code");
  await page.type(code);
  await page.click("#password");
  await page.type(password);
  await page.click("#again");
  await page.type(password);
  await shot("01-setup");
  await page.click("#setup-form button[type=submit]");
  await page.waitFor(`location.pathname === "/" && document.querySelector(".app-card")`, { what: "the home screen with an app" });

  section("Home: the calm status line, the app and its next action");
  expect("the status line", await page.text(".status-row"), /^(No problems found\.|\d+ things? needs? you\.|The nightly checks have not run yet\.)/);
  expect("the app's card", await page.text(".app-card"), new RegExp(`^${APP} .*Step 1 is ready for you to try\\.`));
  expect("its next action", await page.text(".app-card .card-foot .btn"), "Try step 1");
  expect("the side's machine line", await page.text("#side-status"), /\S/);
  await shot("02-home");

  section("The app: its plan, and the real test copy in Preview");
  await page.click(".app-card .card-foot .btn");
  await page.waitFor(`location.pathname === "/apps/${APP}" && document.querySelector("#tryline")`, { what: "the app view" });
  expect("the try line", await page.text("#tryline"), /^Step 1 is ready\. Try it: Open the test copy: today's weather is at the top of the page\. It works Something is wrong$/);
  expect("the plan", await page.text("#plan-box"), /^Plan: show the weather beside each mood 0 of 2 tried/);
  expect("the plan's steps, for a screen reader", await page.eval(`[...document.querySelectorAll("#plan-box li")].map((li) => li.textContent.trim()).join(" / ")`), /ready for you to try \/ .*ready for you to try$/);
  expect("the note about the chat", await page.text(".later-note"), /^Talking to your AI here comes in a later version of this panel\./);
  expect("the line above the frame", await page.text(".fbar"), /^Test copy Try anything here\. The live app is not touched\. Restart the test copy$/);
  const frameUrl = await page.eval(`document.querySelector(".tc-frame")?.src`);
  await page.waitFor(`true`);
  const deadline = Date.now() + 15000;
  while (!page.log.frames.some((f) => f.url === frameUrl) && Date.now() < deadline) await sleep(300);
  const frame = page.log.frames.find((f) => f.url === frameUrl);
  expect("the Preview frame: the test copy, answering", frame ? `${frame.url} ${frame.status}` : `${frameUrl} not loaded`, /^http:\/\/localhost:\d+\/ 200$/);
  await sleep(1200);
  await shot("03-app-step-1-ready");

  section("Something is wrong: a report, kept in the project");
  await page.click('[data-action="report"]');
  await page.waitFor(`document.activeElement?.id === "report-text"`, { what: "the report dialog, its text box focused" });
  expect("the dialog", await page.text("#dialog-title"), "Something is wrong with step 1");
  await page.type("The weather at the top says nothing yet, just an empty box.");
  await shot("04-report-dialog");
  await page.click('#report-form button[type="submit"]');
  await page.waitFor(`document.querySelector("#modal").hidden && document.querySelector("#toast.show")`, { what: "the dialog closed, a toast" });
  expect("the toast", await page.text("#toast"), "Saved with the app. Tell your AI in its own session to read it.");
  expect("focus back on", await page.focused(), /Something is wrong/);
  expect("the report, on the test host", onHost("report", APP), /something-is-wrong\.txt\nSomething is wrong, said in the control panel, .*\n\nStep 1: The weather at the top says nothing yet, just an empty box\./);

  section("It works: step 1, then step 2, marked tried through the engine");
  await page.click('[data-action="works"]');
  await page.waitFor(`/1 of 2 tried/.test(document.querySelector("#plan-box").innerText) && /Step 2 is ready/.test(document.querySelector("#tryline").innerText)`, { what: "step 1 tried, step 2 ready" });
  expect("the plan", await page.text("#plan-box .plan-top"), "Plan: show the weather beside each mood 1 of 2 tried");
  expect("step 1, for a screen reader", await page.eval(`document.querySelector("#plan-box li").textContent.trim()`), "Fetch today's weather for the home town, tried by you");
  expect("the toast", await page.text("#toast"), "Step 1 works. Your AI builds the next one.");
  await shot("05-step-1-tried");
  await page.click('[data-action="works"]');
  await page.waitFor(`/All 2 steps are tried/.test(document.querySelector("#tryline").innerText)`, { what: "every step tried" });
  expect("the try line", await page.text("#tryline"), "All 2 steps are tried. Go to Live when you want everyone to get v2. Go to Live");
  expect("the Live tab says it needs you", await page.eval(`document.querySelector("#rtab-live").textContent`), "Live, needs you");
  await shot("06-all-tried");

  section("A refusal: the builder adds a step while the page shows every step tried");
  await page.click('[data-action="to-live"]');
  await page.waitFor(`document.querySelector('[data-action="put-live"]')`, { what: "Put v2 live" });
  expect("Live: the release card", await page.text("#shipcard"), /^v2 is ready: show the weather beside each mood You have tried all 2 steps\. Before anything changes, your data is backed up and the backup is restored and checked\. Then v2 starts, and if it does not answer, v1 comes straight back\. Put v2 live$/);
  await shot("07-live-ready");
  await page.click("#more-btn");
  await page.click('[data-action="more-backups"]');
  await page.waitFor(`document.querySelector(".backups-list")`, { what: "the Backups dialog" });
  expect("More, Backups", await page.text(".backups-list"), /Every night|Before a release|No backups yet|By hand/);
  await shot("08-backups");
  note("while the Backups dialog is open (the page does not refresh behind a dialog), on the test host:");
  note(onHost("plan", APP, "3"));
  await page.key("Escape");
  await page.waitFor(`document.querySelector("#modal").hidden`, { what: "the dialog closed" });
  expect("the page still offers", await page.text('[data-action="put-live"]'), "Put v2 live");
  await page.click('[data-action="put-live"]');
  const refused = await watchJob(/is not live/, "09-refused-untried");
  expect("the answer", refused.heading, "v2 is not live");
  expect("in plain words", await page.text("#shipcard .stopbox"), /^Nothing changed\. It stopped at "every step of the plan is tried by you": the plan "Show the weather beside each mood" has steps you have not tried: .*Let the home town be changed/);
  expect("and where to do it, here", await page.text("#shipcard .stopbox p:last-child"), 'Here: try each step in Preview and press "It works", then come back to Live.');
  expect("the checks", await page.eval(`[...document.querySelectorAll("#shipcard .safety li")].map((li) => li.className).join(",")`), "failed,next,next,next,next,next");
  await shot("09-refused-untried");
  await page.click('[data-action="dismiss-job"]');
  await page.waitFor(`!document.querySelector("#shipcard .stopbox")`, { what: "the card dismissed" });
  await page.click("#rtab-preview");
  await page.waitFor(`/Step 3 is ready/.test(document.querySelector("#tryline")?.innerText)`, { what: "step 3 ready in Preview" });
  expect("Preview now", await page.text("#tryline"), /^Step 3 is ready\. Try it: Change the home town: the weather changes with it\./);
  await page.click('[data-action="works"]');
  await page.waitFor(`/All 3 steps are tried/.test(document.querySelector("#tryline").innerText)`, { what: "every step tried again" });
  expect("the plan", await page.text("#plan-box .plan-top"), "Plan: show the weather beside each mood 3 of 3 tried");

  section("A refusal: the backup disk is not there");
  note(onHost("unplug"));
  await page.click("#rtab-live");
  await page.waitFor(`document.querySelector('[data-action="put-live"]')`, { what: "Put v2 live" });
  await page.click('[data-action="put-live"]');
  const noBackup = await watchJob(/is not live/, "10-refused-backup");
  expect("the answer", noBackup.heading, "v2 is not live");
  expect("in plain words", await page.text("#shipcard .stopbox"), /^Nothing changed\. It stopped at "the backup target is off this machine and writable": /);
  expect("the checks", await page.eval(`[...document.querySelectorAll("#shipcard .safety li")].map((li) => li.className).join(",")`), "done,failed,next,next,next,next");
  await page.click("#shipcard .every-checks summary");
  await shot("10-refused-backup");
  expect("every check, as the machine ran it", await page.text("#shipcard .every"), /done Dev runs the commit being released.*stopped The backup target is off this machine and writable/);
  note(onHost("plug"));
  expect("the live version, after both refusals", (await apiGet("app.get", { app: APP })).result.live, "v1");
  await page.click('[data-action="dismiss-job"]');

  section("Put v2 live: every safety check shown as it runs");
  await page.waitFor(`document.querySelector('[data-action="put-live"]')`, { what: "Put v2 live" });
  await page.click('[data-action="put-live"]');
  const live = await watchJob(/is live\./, "11-putting-live");
  expect("the answer", live.heading, "v2 is live.");
  note(`the checks, as the page showed them while it ran (${live.seen.length} states):`);
  for (const s of live.seen) note(`  ${s}`);
  expect("each of the six checks seen checking, one after another", live.seen.filter((s) => / ?now:/.test(s)).map((s) => s.match(/now:([^|]+)/)[1].trim()).filter((v, i, a) => a.indexOf(v) === i).join(" > "), (s) => s.split(" > ").length >= 4);
  expect("the checks at the end", await page.eval(`[...document.querySelectorAll("#shipcard .safety li")].map((li) => li.className).join(",")`), "done,done,done,done,done,done");
  await page.click("#shipcard .every-checks summary");
  await shot("11-live-v2");
  expect("every check, as the machine ran it", await page.eval(`document.querySelectorAll("#shipcard .every li.ok").length + " done, " + document.querySelectorAll("#shipcard .every li.failed").length + " stopped"`), /^1\d done, 0 stopped$/);
  expect("the live card", await page.text("#rpane .lcard"), /^v2 is live for everyone This is the version everyone uses\. Open the live app$/);
  expect("the earlier versions", await page.text("#rpane .vers"), /^v2 .*Show the weather beside each mood\. Live now v1 .* Go back to v1$/);

  section("Go back to v1, with its confirmation");
  await page.click('[data-action="go-back"]');
  await page.waitFor(`!document.querySelector("#modal").hidden`, { what: "the confirmation" });
  expect("the confirmation", await page.text("#dialog"), /^Go back to v1\? The live app goes back to v1\. Your data stays: everything written since then is kept\. .* Keep v2 Go back to v1$/);
  expect("focus in the dialog, on", await page.focused(), /Keep v2/);
  await shot("12-go-back-confirm");
  await page.click('[data-action="confirm-go-back"]');
  const back = await watchJob(/^Back on|^Still on/, "13-going-back");
  expect("the answer", back.heading, "Back on v1.");
  note(`the checks, as the page showed them while it ran (${back.seen.length} states):`);
  for (const s of back.seen) note(`  ${s}`);
  expect("the checks at the end", await page.eval(`[...document.querySelectorAll("#shipcard .safety li")].map((li) => li.className).join(",")`), "done,done,done,done,done,done");
  await shot("13-back-on-v1");
  expect("the live version, from the engine", (await apiGet("app.get", { app: APP })).result.live, "v1");
  expect("the live version, from the CLI on the test host", onHost("live", APP), /v1/);

  section("Signing out");
  await page.click("#sign-out");
  await page.waitFor(`location.pathname === "/sign-in"`, { what: "the sign-in page" });
  await page.goto(`${URL_}/apps/${APP}`);
  expect("an app's page, signed out, sends the browser to", await page.eval("location.pathname"), "/sign-in");

  section("What the browser logged and asked for");
  const origin = new URL(URL_).origin;
  const frameOrigin = new URL(frameUrl).origin;
  const others = page.log.requests.filter((r) => !r.url.startsWith(`${origin}/`) && !r.url.startsWith(`${frameOrigin}/`) && !r.url.startsWith("data:"));
  expect("console errors", page.log.errors.length, 0);
  expect("requests to other origins (the test copy's own, in its frame, aside)", others.map((r) => r.url).join(", ") || "none", "none");
  console.log(`\n${passed} checks passed. Screenshots: ${OUT}`);
} catch (error) {
  console.log(`\nSTOPPED: ${error.message}`);
  if (page) {
    await shot("stopped").catch(() => {});
    if (page.log.errors.length) console.log(`console errors:\n  ${page.log.errors.join("\n  ")}`);
  }
  process.exitCode = 1;
} finally {
  await page?.close().catch(() => {});
  await browser.close();
}
