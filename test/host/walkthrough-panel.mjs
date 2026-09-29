// Walkthrough steps 29 to 31, run as written, on a fresh test host (the
// seventh brief, item 9): every block of docs/walkthrough.md in those steps is
// taken from the text in its order, each command run where it says (host or
// workstation) and each quoted output compared with what the machine or the
// page shows; the browser steps in headless Edge, at the address the text
// gives for the test host. A block the script does not expect where it comes
// stops it. It stops where the owner's own sign-in begins (rule 13): step 31's
// "Select login method" in the panel's terminal, then stops the AI as the
// step's last paragraph says.
//
//   node test/host/walkthrough-panel.mjs
//
// It signs in with a fresh setup code and a password it makes up (neither
// printed). One verdict a line; the last counts what is not as the text says.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const C = "allvibe";
const harness = (...a) => spawnSync(process.execPath, ["test/host/host.mjs", ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const localPanel = Number(/panel +test host 80 -> http:\/\/[^:]+:(\d+)\//.exec(harness("status").stdout)?.[1]);
// The address the walkthrough gives for the test host: the fallback, since a workstation does not hear its multicast DNS.
const PANEL = `http://localhost:${localPanel}`;

let total = 0;
let wrong = 0;
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function verdict(label, seen, must) {
  total += 1;
  const good = typeof must === "function" ? must(seen) : must instanceof RegExp ? must.test(String(seen)) : flat(seen) === flat(must);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(66)} ${flat(seen).slice(0, 60).padEnd(60)} ${good ? "as the text says" : "NOT AS THE TEXT SAYS"}`);
  return good;
}

/* ------------------------------------------------- the text, in order -- */
const MD = readFileSync("docs/walkthrough.md", "utf8");
function blocksOf(n) {
  const start = MD.indexOf(`\n## ${n}. `);
  const end = MD.indexOf("\n## ", start + 5);
  if (start === -1) throw new Error(`no step ${n} in the walkthrough`);
  return [...MD.slice(start, end).matchAll(/```(\w*)\n([\s\S]*?)```/g)].map(([, lang, body]) => ({ lang, body: body.trimEnd() }));
}
let queue = [];
let stepNo = 0;
function step(n, title) {
  if (queue.length) throw new Error(`step ${stepNo} has blocks the run did not reach: ${queue.map((b) => b.body.split("\n")[0]).join(" | ")}`);
  stepNo = n;
  queue = blocksOf(n);
  console.log(`\nStep ${n}. ${title} (${queue.length} blocks)`);
}
function take(kind) {
  const b = queue.shift();
  if (!b) throw new Error(`step ${stepNo}: the text has no more blocks, the run expected ${kind}`);
  if ((kind === "command") !== (b.lang === "sh")) throw new Error(`step ${stepNo}: the text has ${b.lang === "sh" ? "a command" : "a quote"} here ("${b.body.split("\n")[0]}"), the run expected ${kind}`);
  return b.body;
}
/** The next command block, run where the text says: the harness on the workstation, everything else on the host. */
function command({ may = false } = {}) {
  const body = take("command");
  if (body.includes("\n")) throw new Error(`step ${stepNo}: a block with more than one line: ${body}`);
  const onWorkstation = body.startsWith("node test/host/host.mjs ");
  const r = onWorkstation ? harness(...body.split(" ").slice(2)) : harness("exec", "--", "sh", "-c", body);
  const out = `${r.stdout}${r.stderr}`;
  const ok = verdict(`${onWorkstation ? "workstation" : "host"}: ${body.slice(0, 58)}`, r.status === 0 ? "ran" : `exit ${r.status}: ${out.trim().split("\n").at(-1)}`, (s) => may || s === "ran");
  if (!ok && !may) throw new Error(`the command failed: ${body}\n${out.slice(-600)}`);
  return { status: r.status, out };
}
/** The next quoted block: what the page or the machine is to show. */
const quote = () => take("quote");
/** Something the owner does, not the run: its block is read, not run. */
function yours() {
  const body = queue.shift()?.body ?? "";
  console.log(`  (the owner's: ${flat(body).slice(0, 80)})`);
}

/* ----------------------------------------------------------- the page -- */
const password = `walk ${randomBytes(12).toString("base64url")}`;
const browser = await launch();
const page = await openPage(browser.port, { width: 1280, height: 860, scheme: "light" });
const text = async (sel) => flat(await page.text(sel));
const guide = () => page.eval(`({ stage: document.querySelector(".stages [aria-current=step] .l")?.firstChild?.textContent.trim() ?? "", text: document.querySelector("#guide-t")?.textContent.trim() ?? "", button: document.querySelector("#guide .guide-acts .btn.pink")?.textContent.trim() ?? "" })`);
const waitButton = (words, timeout = 60000) => page.waitFor(`(document.querySelector("#guide .guide-acts .btn.pink")?.textContent.trim() ?? "") === ${JSON.stringify(words)}`, { what: `the next action "${words}"`, timeout });
const pressNext = () => page.click("#guide .guide-acts .btn.pink");
async function inFrame(expression, opts) {
  const src = await page.eval(`document.querySelector("iframe.tc-frame")?.src ?? ""`);
  return src ? page.evalInFrame(new URL(src).origin, expression, opts) : null;
}
async function tabTo(id) {
  await page.click(`#rtab-${id}`);
  await page.waitFor(`document.querySelector("#rtab-${id}").getAttribute("aria-selected") === "true"`, { what: `the ${id} tab` });
  await sleep(400);
}
async function waitCard(re, timeout = 480000) {
  await page.waitFor(`${re}.test(document.querySelector("#shipcard h2")?.textContent ?? "")`, { what: `a card saying ${re}`, timeout });
  return `${await text("#shipcard h2")} ${await text("#shipcard .stopbox, #shipcard > p")}`;
}
async function signIn() {
  await page.goto(`${PANEL}/sign-in`);
  await page.click("#password");
  await page.type(password);
  await page.key("Enter");
  await page.waitFor(`location.pathname === "/" && !!document.querySelector("#main .head")`, { what: "Your apps", timeout: 15000 });
}
const onScreen = () => page.eval(`document.querySelector("#ai-term .xterm-rows")?.innerText ?? ""`);
async function waitScreen(re, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (re.test(flat(await onScreen()))) return true;
    await sleep(500);
  }
  return false;
}

try {
  /* ------------------------------------------------------------ 29 -- */
  step(29, "The control panel: the first visit");
  const printed = quote();
  verdict("install's last lines, as step 2 printed them (read, not run again)", printed.split("\n")[0], "The control panel: http://allvibe.local/");
  // A new setup code, as `allvibe panel setup-code` makes one, read by the fixture and never printed.
  harness("push", "test/host/panel-fixture.mjs", "/root/");
  const code = harness("exec", "--", "node", "/root/panel-fixture.mjs", "setup-code").stdout.trim();
  if (!/^[A-Z0-9-]{16,19}$/.test(code)) throw new Error("no setup code from the test host");
  await page.goto(`${PANEL}/`);
  verdict("it opens on", await text("h1"), "Set up your control panel");
  await page.click("#code");
  await page.type(code);
  await page.click("#password");
  await page.type(password);
  await page.click("#again");
  await page.type(password);
  await page.click("#setup-form button[type=submit]");
  await page.waitFor(`location.pathname === "/" && !!document.querySelector(".status-row")`, { what: "Your apps" });
  verdict("signed in, on", await text("#main h1"), "Your apps");
  verdict("the line about the nightly checks", await text(".status-row b"), "The nightly checks have not run yet.");
  await page.click('#nav a[href="/machine"]');
  await page.waitFor(`document.querySelector("#main h1")?.textContent === "Machine health"`, { what: "Machine health" });
  await page.click('[data-action="recheck"]');
  await page.waitFor(`/Checked just now/.test(document.querySelector("#main .head").innerText)`, { what: "the checks, now", timeout: 60000 });
  verdict("Machine health, the checks run again", await page.eval(`document.querySelectorAll(".check-row").length`), (n) => n >= 10);
  await page.click("#sign-out");
  await page.waitFor(`location.pathname === "/sign-in"`, { what: "Sign in" });
  await page.click("#password");
  await page.type("a wrong password, typed on purpose");
  await page.key("Enter");
  await page.waitFor(`!document.querySelector("#error").hidden`, { what: "the refusal", timeout: 8000 });
  verdict("a wrong password", await text("#error"), quote());
  await page.eval(`document.querySelector("#password").value = ""`);
  await signIn();
  verdict("the right one: back on", await text("#main h1"), "Your apps");

  /* ------------------------------------------------------------ 30 -- */
  step(30, "The control panel: the guided path, one thing at a time, and back");
  command({ may: true }); // remove hello: refused when there is none, as step 7 says
  verdict("hello is not in the list", command().out.includes("hello"), false);
  command(); // create
  command(); // the heading
  command(); // push the plan (workstation)
  command(); // install it
  command(); // dev commit
  command(); // dev deploy
  await page.goto(`${PANEL}/`);
  await page.waitFor(`[...document.querySelectorAll(".app-card h3")].some((h) => h.textContent.trim() === "hello")`, { what: "hello's card" });
  const card = `[...document.querySelectorAll(".app-card")].find((c) => c.querySelector("h3").textContent.trim() === "hello")`;
  verdict("Your apps: hello", flat(await page.eval(`${card}.innerText`)), /^hello v1 is live Say hello\. Step 1 is ready for you to try\. Try step 1$/);
  verdict("its Try step 1, pink", await page.eval(`getComputedStyle(${card}.querySelector(".card-foot .btn")).backgroundColor`), "rgb(255, 77, 148)");
  await page.click(`a[href="/apps/hello#try"]`);
  await waitButton("Step 1 works");
  let g = await guide();
  verdict("the guided path: where it is", await page.eval(`[...document.querySelectorAll(".stages li")].map((l) => l.className + ":" + l.querySelector(".l").firstChild.textContent.trim()).join(" ")`), "past:Plan now:Try: 1 of 2 next:Live next:Done");
  verdict("its sentence", g.text, quote());
  verdict("the next action, and beside it", await text("#guide .guide-acts"), "Step 1 works Something is wrong");
  verdict("on the left, the plan", await text("#plan-box .plan-top .muted"), "0 of 2 tried");
  verdict("and under it, Your AI", await text("#ai-top h2"), "Your AI");
  verdict("Preview: the line above the frame", await text(".fbar .tc"), "Test copy");
  await sleep(1500);
  verdict("the test copy's heading", flat(await inFrame(`document.querySelector("h1")?.textContent ?? ""`)), /^Hello, how are you\?/);
  verdict("what the step asks, above it", await text("#tryline"), quote());
  await tabTo("live");
  verdict("Live first", await text("#live-pane"), /v2: say hello 2 steps left to try before v2 can go live\./);
  verdict("and no way to put it live", await page.eval(`!!document.querySelector('[data-action="put-live"]')`), false);
  await tabTo("preview");
  await page.click('#guide [data-action="report"]');
  await page.waitFor(`document.activeElement?.id === "report-text"`, { what: "the report" });
  const line = `The heading is fine, but I expected a wave (${randomBytes(3).toString("hex")}).`;
  await page.type(line);
  await page.click('#report-form button[type="submit"]');
  await page.waitFor(`!!document.querySelector("#toast.show")`, { what: "the toast" });
  verdict("Save the report", await text("#toast"), "Saved with the app. Tell your AI in its own session to read it.");
  verdict("where the AI will read it", command().out.includes(line), true);
  await pressNext();
  await waitButton("Try step 2");
  verdict("Step 1 works: the plan", await text("#plan-box .plan-top .muted"), "1 of 2 tried");
  verdict("the next action's sentence", (await guide()).text, "Step 2 is ready: writing still works.");
  await pressNext();
  await waitButton("Step 2 works");
  const name = `Walker ${randomBytes(2).toString("hex")}`;
  await inFrame(`(() => { const el = document.querySelector("input[name=name]"); el.value = ""; el.focus(); return true; })()`);
  await page.type(name);
  await tabTo("live");
  await tabTo("preview");
  verdict("your name, still in the form after Live and Preview", await inFrame(`document.querySelector("input[name=name]")?.value ?? "(gone)"`), name);
  await inFrame(`(() => { const m = document.querySelector("textarea, input[name=message]"); if (m) m.value = "Signed while walking through step 30."; document.querySelector("form button, form [type=submit]").click(); return true; })()`, { userGesture: true });
  await sleep(2500);
  verdict("signed: the entry is listed", await inFrame(`document.body.innerText.includes(${JSON.stringify(name)})`), true);
  await pressNext();
  await waitButton("Put v2 live");
  g = await guide();
  verdict("Step 2 works: on to Live by itself", await page.eval(`document.querySelector("#live-pane").hidden === false ? "Live" : "Preview"`), "Live");
  verdict("its sentence", g.text, quote());
  await page.click("#more-btn");
  await page.click('[data-action="more-backups"]');
  await page.waitFor(`!document.querySelector("#modal").hidden && !!document.querySelector("#dialog .backups-list")`, { what: "Backups, open" });
  command(); // push say-hello-3 (workstation)
  command(); // the button's words
  command(); // the plan with its third step
  command(); // dev commit
  command(); // dev deploy
  await page.key("Escape");
  await page.waitFor(`document.querySelector("#modal").hidden`, { what: "the dialog closed" });
  verdict("the page still shows", (await guide()).button, "Put v2 live");
  await pressNext();
  const untried = await waitCard(/is not live|is live\./);
  verdict("a step you have not tried", untried, (s) => flat(s).startsWith(flat(quote())));
  verdict("the six checks stop at the first", await page.eval(`[...document.querySelectorAll("#shipcard .safety li")].map((l) => l.className).join(",")`), "failed,next,next,next,next,next");
  verdict("the next action at the top", (await guide()).button, "OK");
  await pressNext();
  await waitButton("Try step 3");
  verdict("OK: its sentence", (await guide()).text, "Step 3 is ready: a friendlier button.");
  await pressNext();
  await waitButton("Step 3 works");
  await sleep(1500);
  verdict("the button in the frame", flat(await inFrame(`document.querySelector("form button, form [type=submit]")?.textContent ?? ""`)), "Say hello");
  await pressNext();
  await waitButton("Put v2 live");
  command(); // umount the backup disk
  command(); // restart the engine
  await sleep(3000);
  await page.goto(`${PANEL}/apps/hello`);
  await waitButton("Put v2 live");
  await pressNext();
  const noDisk = await waitCard(/is not live|is live\./);
  verdict("a backup that cannot be taken", noDisk, (s) => flat(s).startsWith(flat(quote())));
  verdict("Tried by you done, Backup taken stopped", await page.eval(`[...document.querySelectorAll("#shipcard .safety li")].slice(0, 2).map((l) => l.className).join(",")`), "done,failed");
  await pressNext();
  // The disk back, as step 16 says for the test host: the test host starts again.
  const restarted = harness("restart");
  verdict("workstation: node test/host/host.mjs restart (step 16's)", restarted.status === 0 ? "ran" : `exit ${restarted.status}`, "ran");
  await sleep(30000);
  await signIn();
  await page.goto(`${PANEL}/apps/hello`);
  await waitButton("Put v2 live", 120000);
  await pressNext();
  await page.waitFor(`/^Putting v2 live/.test(document.querySelector("#shipcard h2")?.textContent ?? "")`, { what: "the release running", timeout: 15000 });
  const refused = command({ may: true });
  verdict("while it runs, the backup from the machine", flat(refused.out).replace(/started from the panel (just now|\d+ minutes? ago)/, "started from the panel just now"), quote());
  verdict("refused, before anything changed", refused.status, 1);
  const live = await waitCard(/is live\.|is not live/);
  verdict("put live", live, (s) => flat(s).startsWith(flat(quote())));
  g = await guide();
  verdict("Done", `${g.stage}: ${g.text}`, "Done: v2 is live. Everyone on your home network uses it now.");
  verdict("its three choices", await text("#guide .guide-acts"), "Open the app Start something new Something feels wrong? Go back to v1");
  const liveUrl = await page.eval(`document.querySelector("#guide .guide-acts a.btn.pink").href`);
  const app = await openPage(browser.port, { width: 1000, height: 800, scheme: "light" });
  await app.goto(liveUrl);
  verdict("Open the app: its heading", flat(await app.text("h1")), /^Hello, how are you\?/);
  verdict("and its button", flat(await app.eval(`document.querySelector("form button, form [type=submit]")?.textContent ?? ""`)), "Say hello");
  const entry = `Live ${randomBytes(2).toString("hex")}`;
  await app.eval(`(() => { document.querySelector("input[name=name]").value = ${JSON.stringify(entry)}; const m = document.querySelector("textarea, input[name=message]"); if (m) m.value = "Written on v2."; document.querySelector("form button, form [type=submit]").click(); return true; })()`);
  await sleep(2500);
  verdict("an entry written there", await app.eval(`document.body.innerText.includes(${JSON.stringify(entry)})`), true);
  verdict("Earlier versions", await text("#live-pane .vers"), /^v2 .*Live now .*v1 .*Go back to v1$/);
  await page.click("#more-btn");
  await page.click('[data-action="more-backups"]');
  await page.waitFor(`!document.querySelector("#modal").hidden && !!document.querySelector("#dialog .backups-list")`, { what: "Backups" });
  verdict("Backups: the one the release took first", await text("#dialog .backups-list .row h3"), /^Before a release, /);
  await page.key("Escape");
  await page.click('#guide [data-action="go-back"]');
  await page.waitFor(`!document.querySelector("#modal").hidden`, { what: "the dialog" });
  verdict("the dialog: your data stays, a fresh backup first", await text("#dialog"), /Your data stays.*a fresh backup is taken and checked/);
  await page.click('#dialog [data-action="confirm-go-back"]');
  const back = await waitCard(/^Back on|^Still on/);
  verdict("back", back, (s) => flat(s).startsWith(flat(quote())));
  await app.goto(liveUrl);
  verdict("the live app, reloaded: its heading", flat(await app.text("h1")), /^Guestbook/);
  verdict("and the entry written on v2", await app.eval(`document.body.innerText.includes(${JSON.stringify(entry)})`), true);
  await app.close();
  const status = harness("exec", "--", C, "project", "status", "hello").stdout;
  verdict("host: allvibe project status hello", flat(status), /prod.*v1.*1 entr/);
  await page.click('#nav a[href="/machine"]');
  await page.waitFor(`document.querySelector("#main h1")?.textContent === "Machine health"`, { what: "Machine health" });
  await page.click('[data-action="recheck"]');
  await page.waitFor(`/Checked just now/.test(document.querySelector("#main .head").innerText)`, { what: "the checks, now", timeout: 60000 });
  verdict("Machine health: hello's backups", await page.eval(`[...document.querySelectorAll(".check-row")].map((r) => r.innerText).find((t) => /hello:/.test(t)) ?? ""`), /hello: last backup less than an hour ago; last restore check .* UTC passed, in going back \(1 entry\)/);
  const runs = harness("exec", "--", "ls", `/var/lib/${C}/runs/`).stdout;
  verdict("host: ls /var/lib/allvibe/runs/: the release and the rollback", `${/release-hello/.test(runs)} ${/rollback-hello/.test(runs)}`, "true true");

  /* ------------------------------------------------------------ 31 -- */
  step(31, "Your AI in the panel: a new app, and your own sign-in");
  command({ may: true }); // remove notes
  verdict("notes is not in the list", command().out.includes("notes"), false);
  await page.goto(`${PANEL}/`);
  await page.waitFor(`!!document.querySelector('[data-action="new-app"]')`, { what: "Make a new app" });
  await page.click('[data-action="new-app"]');
  await page.waitFor(`document.activeElement?.id === "new-app-name"`, { what: "its name" });
  verdict("Make a new app: what it will be", await text("#dialog"), /a small guestbook, with a test copy and a live app of its own/);
  await page.type("notes");
  await page.click("#new-app-go");
  await page.waitFor(`document.querySelectorAll("#new-app-steps li").length > 0`, { what: "its steps", timeout: 30000 });
  verdict("its steps, as they run", await text("#new-app-steps li"), /\S/);
  await page.waitFor(`location.pathname === "/apps/notes" && !!document.querySelector("#guide .guide-acts .btn.pink")`, { what: "notes, open", timeout: 300000 });
  g = await guide();
  verdict("notes, at", g.stage, "Plan");
  verdict("its sentence", g.text, quote());
  verdict("the next action", g.button, "Start your AI");
  verdict("Your AI: how it signs in", await text("#ai-top .ai-choices"), /Sign in with your Claude account In the terminal, when it starts\. Use the key in the vault This app has no key in the vault\./);
  verdict("the key's choice, off", await page.eval(`document.querySelector('input[name="ai-sign-in"][value="key"]').disabled`), true);
  verdict("the account's, chosen", await page.eval(`document.querySelector('input[name="ai-sign-in"]:checked')?.value`), "account");
  await pressNext();
  await page.waitFor(`/Starting your AI\\. The first time takes a minute or two\\./.test(document.querySelector("#ai-top")?.textContent ?? "") || !!document.querySelector("#ai-term .xterm-rows")`, { what: "Starting your AI", timeout: 30000 });
  verdict("Starting your AI", await text("#ai-top .ai-line b"), /^Starting your AI\.$|^Claude Code\.$/);
  await page.waitFor(`!!document.querySelector("#ai-term .xterm-rows")`, { what: "Claude Code's terminal", timeout: 400000 });
  await page.waitFor(`/^Claude Code\\./.test(document.querySelector("#ai-top .ai-line")?.textContent ?? "")`, { what: "the line above it", timeout: 30000 });
  verdict("above its terminal", await text("#ai-top .ai-line"), quote());
  verdict("the line under it", await text("#ai .ai-keys"), "Every key goes to Claude Code. To leave its terminal with the keyboard: Ctrl + ]");
  verdict("1. its welcome and its text style", await waitScreen(/text style/i), true);
  await page.click("#ai-term");
  await page.key("Enter");
  verdict("2. Select login method: the owner's from here", await waitScreen(/Select login method/i, 30000), true);
  verdict("   its first choice", /Claude account with subscription/.test(flat(await onScreen())), true);
  yours(); // the first small change: typed by the owner, once signed in
  // Stopping, as the step's last paragraph says, without signing in.
  await page.click('#ai-top [data-action="stop-ai"]');
  await page.waitFor(`!document.querySelector("#modal").hidden`, { what: "the dialog" });
  verdict("Stop your AI: the dialog", await text("#dialog"), /stopping is not signing out: to end your sign-in at Anthropic too, type \/logout in Claude Code first\./i);
  await page.click('#dialog [data-action="confirm-stop-ai"]');
  await page.waitFor(`!!document.querySelector('input[name="ai-sign-in"]')`, { what: "the choices back", timeout: 120000 });
  verdict("its terminal gone, the choices back", await page.eval(`!document.querySelector("#ai-term .xterm")`), true);
  if (queue.length) throw new Error(`step 31 has blocks the run did not reach: ${queue.map((b) => b.body.split("\n")[0]).join(" | ")}`);
  verdict("console errors in the panel's page", page.log.errors.join(" | ") || "none", "none");
} catch (error) {
  // Where the run stopped: the page as it is, for the reader of the output.
  const where = await page.eval(`location.href + " | alerts: " + [...document.querySelectorAll("[role=alert], .form-error, #error")].map((e) => e.textContent.trim()).filter(Boolean).join(" / ") + " | " + (document.querySelector("main, body")?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 200)`).catch(() => "(no page)");
  console.log(`\nSTOPPED at step ${stepNo}: ${error.message}\n  the page: ${where}\n  console: ${page.log.errors.join(" | ").slice(0, 300) || "none"}`);
  wrong += 1;
} finally {
  await page.close().catch(() => {});
  await browser.close();
}
console.log(`\n${total - wrong} of ${total} as the text says`);
process.exitCode = wrong ? 1 : 0;
