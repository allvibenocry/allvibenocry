// The guided path (D68), in a real browser against the panel on the test host:
// a project goes from "Try step 1" to "v2 is live" using only the next-action
// button, without touching a tab; the panel moves on by itself; there is only
// ever one pink thing on the screen; the ending offers its three choices; and
// the tabs still work for anyone who uses them. At a desktop's width and a
// phone's, each with a project of its own.
//
//   node test/host/guided-probe.mjs [--configs desktop,phone]
//
// It signs in with a fresh setup code and a password it makes up (neither
// printed). One verdict a line; the last counts what is not as it must be.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const args = process.argv.slice(2);
const CONFIGS = { desktop: { width: 1280, height: 800, mobile: false }, phone: { width: 390, height: 844, mobile: true } };
const chosen = (args.includes("--configs") ? args[args.indexOf("--configs") + 1] : "desktop,phone").split(",");
const C = "allvibe";
let total = 0;
let wrong = 0;
function verdict(label, seen, must) {
  total += 1;
  const good = typeof must === "function" ? must(seen) : must instanceof RegExp ? must.test(String(seen)) : String(seen) === String(must);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(62)} ${String(seen).replace(/\s+/g, " ").slice(0, 56).padEnd(56)} ${good ? "as it must be" : "WRONG"}`);
}
const harness = (...a) => spawnSync(process.execPath, ["test/host/host.mjs", ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
function onHost(what, ...a) {
  const r = harness("exec", "--", ...a);
  if (r.status !== 0 && what) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
}
const localPanel = Number(/panel +test host 80 -> http:\/\/[^:]+:(\d+)\//.exec(harness("status").stdout)?.[1]);
const URL_ = `http://${C}.local:${localPanel}`;

harness("push", "test/host/panel-fixture.mjs", "/root/");
const password = `guided ${randomBytes(12).toString("base64url")}`;
const browser = await launch();
let signedIn = false;
try {
  for (const name of chosen) {
    const cfg = CONFIGS[name];
    const APP = `guided-${name}`;
    console.log(`${name}, ${cfg.width} px: the app ${APP}, its plan's three steps built`);
    onHost(null, C, "project", "remove", APP, "--delete-everything");
    onHost("project create", C, "project", "create", APP);
    onHost("the plan", "node", "/root/panel-fixture.mjs", "plan", APP, "3");
    const page = await openPage(browser.port, cfg);
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
      }
      await page.goto(`${URL_}/apps/${APP}`);
      await page.waitFor(`!!document.querySelector("#guide .guide-acts .btn")`, { what: "the next action" });
      // What the person sees at the top, and every pink thing on the screen.
      const seen = () => page.eval(`(() => {
        const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        const pink = [...document.querySelectorAll("body *")].filter((el) => vis(el) && [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopColor].some((c) => c === "rgb(255, 77, 148)"));
        const btn = document.querySelector("#guide .guide-acts .btn.pink");
        return { stage: document.querySelector(".stages [aria-current=step] .l")?.firstChild?.textContent.trim() ?? "", button: btn?.textContent.trim() ?? "", text: document.querySelector("#guide-t")?.textContent.trim() ?? "", pinks: pink.length, pinkIsButton: pink.length === 1 && pink[0] === btn, right: document.querySelector("#preview-pane")?.hidden === false ? "Preview" : "Live" };
      })()`);
      const path = [];
      for (let presses = 0; presses < 12; presses += 1) {
        const now = await seen();
        path.push(`${now.stage}: ${now.button || "(none)"}`);
        verdict(`${now.stage}, "${now.button || now.text.slice(0, 30)}": pink things on the screen`, now.pinks, now.button ? 1 : 0);
        if (now.button) verdict("  and it is the next-action button", now.pinkIsButton, true);
        if (/^Step \d works$/.test(now.button)) verdict("  the test copy is in view", now.right, "Preview");
        if (/^Put v\d+ live$/.test(now.button)) {
          verdict("  moved on to Live by itself", now.right, "Live");
          verdict("  in words", now.text, /^Every step is tried\. Next: put v\d+ live\.$/);
        }
        if (now.button === "Open the app") break;
        if (!now.button) {
          await page.waitFor(`!!document.querySelector("#guide .guide-acts .btn.pink")`, { what: "the next action, after the safety checks", timeout: 240000 });
          continue;
        }
        const before = now.button;
        await page.click("#guide .guide-acts .btn.pink");
        await page.waitFor(`(document.querySelector("#guide .guide-acts .btn.pink")?.textContent.trim() ?? "") !== ${JSON.stringify(before)}`, { what: `the panel to move on from "${before}"`, timeout: 30000 });
        await sleep(300);
      }
      verdict("the path, pressing only the next action", path.join(" > "), /^Try: 1 of 3: Try step 1 > Try: 1 of 3: Step 1 works > Try: 2 of 3: Try step 2 > Try: 2 of 3: Step 2 works > Try: 3 of 3: Try step 3 > Try: 3 of 3: Step 3 works > Live: Put v2 live > (Live: \(none\) > )*Done: Open the app$/);
      const end = await page.eval(`(() => ({ text: document.querySelector("#guide-t").textContent.trim(), choices: [...document.querySelectorAll("#guide .guide-acts a, #guide .guide-acts button")].map((b) => b.textContent.trim()), open: document.querySelector("#guide .guide-acts a.btn.pink")?.getAttribute("href") ?? "" }))()`);
      verdict("the ending", end.text, /^v2 is live\. Everyone on your home network uses it now\.$/);
      verdict("its three choices", end.choices.join(" | "), "Open the app | Start something new | Something feels wrong? Go back to v1");
      verdict("open the app: the live app, on the apps' host", end.open, /^http:\/\/localhost:\d+\/$/);
      verdict("every stage passed, in the indicator", await page.eval(`[...document.querySelectorAll(".stages li")].map((l) => l.className).join(" ")`), "past past past past");

      console.log("  the tabs, for anyone who uses them:");
      const tab = (id) => (cfg.mobile ? `#mtab-${id}` : `#rtab-${id}`);
      await page.click(tab("preview"));
      await sleep(400);
      verdict("the Preview tab shows the test copy", await page.eval(`document.querySelector("#preview-pane").hidden === false && !!document.querySelector("iframe.tc-frame")`), true);
      await page.click(tab("live"));
      await sleep(400);
      verdict("the Live tab shows the versions", await page.eval(`document.querySelector("#live-pane").hidden === false && /Earlier versions/.test(document.querySelector("#live-pane").textContent)`), true);
      if (cfg.mobile) {
        await page.click("#mtab-chat");
        await sleep(400);
        verdict("the Plan tab shows the plan", await page.eval(`getComputedStyle(document.querySelector("#lside")).display !== "none" && /Your plan/.test(document.querySelector("#lside").textContent)`), true);
      }
      verdict("the ending stays through the tabs", (await seen()).button, "Open the app");

      console.log("  start something new:");
      await page.click('#guide [data-action="guide-new"]');
      await sleep(600);
      const after = await seen();
      verdict("back to Plan", after.stage, "Plan");
      verdict("and it says what to do", after.text, /^v2 is live\. Tell your AI what you want next/);
      verdict("pink things on the screen", after.pinks, 0);
      verdict("no console errors", page.log.errors.length ? page.log.errors.join(" | ").slice(0, 120) : "none", "none");
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`${total - wrong} of ${total} as they must be`);
process.exitCode = wrong ? 1 : 0;
