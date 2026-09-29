// The chat in the panel (D69, D77), end to end in a real browser against a
// fresh test host: a new app made in the panel; its AI started from the panel;
// Claude Code, in the terminal on the left, answering against the stand-in
// for the model's API (stub-api.mjs, which asks for a plan with one step to be
// written and committed); and that planned step appearing in the checklist
// and in the guided path. With a stand-in key: never an account (D48).
//
//   node test/host/chat-probe.mjs [--configs desktop,phone]
//
// It signs in with a fresh setup code and a password it makes up (neither
// printed). One verdict a line; the last counts what is not as it must be.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const args = process.argv.slice(2);
const CONFIGS = { desktop: { width: 1280, height: 860, mobile: false }, phone: { width: 390, height: 844, mobile: true } };
const chosen = (args.includes("--configs") ? args[args.indexOf("--configs") + 1] : "desktop").split(",");
const C = "allvibe";
let total = 0;
let wrong = 0;
function verdict(label, seen, must) {
  total += 1;
  const good = typeof must === "function" ? must(seen) : must instanceof RegExp ? must.test(String(seen)) : String(seen) === String(must);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(64)} ${String(seen).replace(/\s+/g, " ").slice(0, 52).padEnd(52)} ${good ? "as it must be" : "WRONG"}`);
}
const harness = (...a) => spawnSync(process.execPath, ["test/host/host.mjs", ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
function onHost(what, ...a) {
  const r = harness("exec", "--", ...a);
  if (r.status !== 0 && what) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
  return r.stdout.trim();
}
const localPanel = Number(/panel +test host 80 -> http:\/\/[^:]+:(\d+)\//.exec(harness("status").stdout)?.[1]);
const URL_ = `http://${C}.local:${localPanel}`;
for (const f of ["panel-fixture.mjs", "stub-api.mjs"]) harness("push", `test/host/${f}`, "/root/");

const password = `chat ${randomBytes(12).toString("base64url")}`;
const browser = await launch();
let signedIn = false;
try {
  for (const name of chosen) {
    const cfg = CONFIGS[name];
    const APP = `chat-${name}`;
    console.log(`${name}, ${cfg.width} px, the app ${APP}:`);
    onHost(null, C, "agent", "stop", APP);
    onHost(null, "node", "/root/panel-fixture.mjs", "stub-stop", APP);
    onHost(null, C, "project", "remove", APP, "--delete-everything");
    const page = await openPage(browser.port, cfg);
    const onScreen = () => page.eval(`document.querySelector("#ai-term .xterm-rows")?.innerText ?? ""`);
    async function waitTerm(re, ms = 60000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const text = await onScreen();
        if (re.test(text)) return true;
        await sleep(400);
      }
      return false;
    }
    const guideNow = () => page.eval(`({ stage: document.querySelector(".stages [aria-current=step] .l")?.firstChild?.textContent.trim() ?? "", text: document.querySelector("#guide-t")?.textContent.trim() ?? "", button: document.querySelector("#guide .guide-acts .btn.pink")?.textContent.trim() ?? "" })`);
    try {
      if (!signedIn) {
        const code = onHost("a setup code", "node", "/root/panel-fixture.mjs", "setup-code");
        await page.goto(`${URL_}/`);
        await page.click("#code");
        await page.type(code);
        await page.click("#password");
        await page.type(password);
        await page.click("#again");
        await page.type(password);
        await page.click("#setup-form button[type=submit]");
        await page.waitFor(`location.pathname === "/"`, { what: "home" });
        signedIn = true;
      } else await page.goto(`${URL_}/`);

      console.log("  a new app, made in the panel:");
      await page.waitFor(`!!document.querySelector('[data-action="new-app"]')`, { what: "Make a new app" });
      await page.click('[data-action="new-app"]');
      await page.waitFor(`document.activeElement?.id === "new-app-name"`, { what: "the name field, focused" });
      await page.type(APP);
      await page.key("Enter");
      await page.waitFor(`location.pathname === "/apps/${APP}"`, { what: "the new app's page", timeout: 300000 });
      await page.waitFor(`!!document.querySelector("#guide .guide-acts .btn.pink")`, { what: "its next action" });
      let g = await guideNow();
      verdict("it opens in planning", g.stage, "Plan");
      verdict("its next action", g.button, "Start your AI");
      verdict("the choice of how it signs in, beside its terminal", await page.eval(`[...document.querySelectorAll('input[name="ai-sign-in"]')].map((r) => r.value + (r.disabled ? " (off)" : "")).join(", ")`), "account, key (off)");

      console.log("  its AI, started from the panel, with a stand-in key:");
      onHost("a stand-in key", "sh", "-c", `head -c 24 /dev/urandom | base64 | ${C} key set ${APP} agent ANTHROPIC_API_KEY > /dev/null`);
      onHost("the stand-in for the model", "node", "/root/panel-fixture.mjs", "stub", APP);
      await page.goto(`${URL_}/apps/${APP}`);
      await page.waitFor(`!!document.querySelector('input[name="ai-sign-in"][value="key"]:not([disabled])')`, { what: "the key, now in the vault" });
      if (cfg.mobile) await page.click("#mtab-chat");
      await page.click('input[name="ai-sign-in"][value="key"]');
      await page.click("#guide .guide-acts .btn.pink");
      await page.waitFor(`!!document.querySelector("#ai-term .xterm-rows")`, { what: "Claude Code's terminal", timeout: 400000 });
      verdict("its terminal, on the left, under the plan", await page.eval(`(() => { const plan = document.querySelector("#plan-box").getBoundingClientRect(); const term = document.querySelector("#ai-term").getBoundingClientRect(); return term.top >= plan.bottom - 1 ? "under the plan" : "elsewhere"; })()`), "under the plan");
      verdict("Claude Code's own first start, in it", await waitTerm(/Choose the text style/), true);
      await page.click("#ai-term");
      await page.key("Enter");
      verdict("its security notes", await waitTerm(/Security notes/, 20000), true);
      await page.key("Enter");
      verdict("trusting the working copy, No first (mistake 35)", await waitTerm(/No, exit[\s\S]*Yes, I trust this folder/, 20000), true);
      await page.key("ArrowDown");
      await sleep(400);
      await page.key("Enter");
      verdict("its prompt", await waitTerm(/auto mode on/, 30000), true);
      // A notice of its own may come first (seen: one about auto mode's
      // classifier, since its requests go to a stand-in): a person reads it
      // and presses Enter, and so does this, until the notice is gone.
      for (let i = 0; i < 5; i += 1) {
        await sleep(1500);
        const tail = (await onScreen()).split("\n").slice(-20).join("\n");
        if (!/Nothing breaks|Enter to continue|Press Enter/.test(tail)) break;
        await page.key("Enter");
      }
      await page.type("Plan a first step for this app.");
      await page.key("Enter");
      // If it asks before a tool runs, the person answers as they would: yes;
      // and a notice shown again mid-turn is read and passed by Enter.
      for (let i = 0; i < 12 && !/the stub session is over/.test(await onScreen()); i += 1) {
        const tail = (await onScreen()).split("\n").slice(-20).join("\n");
        if (/Do you want to|Nothing breaks|Enter to continue|Press Enter/.test(tail)) await page.key("Enter");
        await sleep(2500);
      }
      async function explain(why) {
        console.log("  what the terminal shows:\n" + (await onScreen()).split("\n").filter((l) => l.trim()).slice(-25).map((l) => `    | ${l}`).join("\n"));
        console.log("  what the stand-in was asked:\n" + harness("exec", "--", "docker", "logs", `${C}-${APP}-dev-stubapi`).stdout.split("\n").slice(-12).map((l) => `    | ${l}`).join("\n"));
        console.log("  what Claude Code sent back for each tool call:\n" + onHost(null, "cat", "/var/tmp/stub-api/out/results.jsonl").split("\n").map((l) => `    | ${l.slice(0, 400)}`).join("\n"));
        console.log("  the working copy:\n" + onHost(null, "runuser", "-u", C, "--", "git", "-C", `/var/lib/${C}/projects/${APP}/repo`, "status", "--short").split("\n").map((l) => `    | ${l}`).join("\n"));
        throw new Error(why);
      }
      const answered = await waitTerm(/the stub session is over/, 30000);
      verdict("Claude Code answers, in the terminal", answered, true);
      if (!answered) await explain("no answer");

      console.log("  the step it planned, in the checklist and the guided path:");
      await page.waitFor(`/Update the test copy/.test(document.querySelector("#guide .guide-acts .btn.pink")?.textContent ?? "")`, { what: "the panel to see what the AI committed", timeout: 40000 }).catch(() => explain("the panel did not see a commit"));
      g = await guideNow();
      verdict("the panel sees what it committed", g.text, /^Your AI has changed the app since the test copy started/);
      await page.click("#guide .guide-acts .btn.pink");
      await page.waitFor(`/Say hello on the page/.test(document.querySelector("#plan-box")?.textContent ?? "")`, { what: "the plan in the checklist", timeout: 300000 });
      verdict("the checklist", (await page.text("#plan-box")).replace(/\s+/g, " "), /^Plan: a first step 0 of 1 tried 1 Say hello on the page ?, being built$/);
      g = await guideNow();
      verdict("the guided path", `${g.stage}: ${g.text}`, "Try: 1 of 1: Your AI is building step 1: say hello on the page. The test copy keeps working meanwhile.");
      verdict("pink things on the screen", await page.eval(`[...document.querySelectorAll("body *")].filter((el) => el.getClientRects().length && [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopColor].includes("rgb(255, 77, 148)")).length`), 0);
      verdict("no console errors (the terminal's styles within the page's policy)", page.log.errors.length ? page.log.errors.join(" | ").slice(0, 160) : "none", "none");
      const others = page.log.requests.filter((r) => { const u = new URL(r.url); return !["data:", "about:"].includes(u.protocol) && u.origin !== new URL(URL_).origin && !(u.hostname === "localhost" && !r.main); });
      verdict("requests to other origins, but the Preview frame's", others.map((r) => r.url).join(" ").slice(0, 80) || "none", "none");
    } finally {
      await page.close();
      onHost(null, C, "agent", "stop", APP);
      onHost(null, "node", "/root/panel-fixture.mjs", "stub-stop", APP);
    }
  }
} finally {
  await browser.close();
}
console.log(`${total - wrong} of ${total} as they must be`);
process.exitCode = wrong ? 1 : 0;
