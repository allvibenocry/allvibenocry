// The control panel's browser checks, on the test host (the sixth brief, item
// 10; the seventh brief, item 8): at desktop and phone widths, light and dark;
// signing in and out; the guided path, one pink next action at a time; the
// Preview frame keeping what is typed in it; every refusal, the app's lock
// among them; a new app made in the panel; its AI started and stopped, and its
// terminal's keyboard and refusals; no console errors, no request to another
// origin but the Preview frame's, nothing wider than the screen; the keyboard
// in every dialog and tab list. Each check is first seen failing on a
// deliberately broken copy of the panel (panel-fixture.mjs break), then
// passing on the real one.
//
//   node test/host/panel-checks.mjs <folder for screenshots> [--url http://allvibe.local:<port>] [--app moods]
//        [--broken <variant,...>|none] [--configs <name,...>|none]
//
// Run from the product repository on the workstation, on a fresh test host
// (test/host/README.md). It signs in with fresh setup codes and a password it
// makes up and keeps in memory; neither is printed. The AI is started with a
// stand-in key, never an account (D48), and nothing is typed to it.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, openPage } from "./cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = args[0];
if (!OUT || OUT.startsWith("--")) {
  process.stderr.write("usage: node test/host/panel-checks.mjs <folder for screenshots> [--url ...] [--app moods] [--broken <variant,...>|none] [--configs <name,...>|none]\n");
  process.exit(2);
}

/* ------------------------------------------------------------ the host -- */
const harness = (...a) => spawnSync(process.execPath, ["test/host/host.mjs", ...a], { encoding: "utf8" });
function onHost(...a) {
  const r = harness("exec", "--", "node", "/root/panel-fixture.mjs", ...a);
  if (r.status !== 0) throw new Error(`on the test host, panel-fixture ${a.join(" ")}: ${(r.stderr || r.stdout).trim().slice(-600)}`);
  return r.stdout.trim();
}
// The panel's port 80, forwarded to this workstation (D74), by its name and by the fallback address.
const localPanel = Number(/panel +test host 80 -> http:\/\/[^:]+:(\d+)\//.exec(harness("status").stdout)?.[1]);
const URL_ = opt("--url", `http://allvibe.local:${localPanel}`);
const LOCAL = `http://localhost:${new URL(URL_).port}`;
const APP = opt("--app", "moods");

const CONFIGS = {
  "desktop-light": { width: 1280, height: 800, mobile: false, scheme: "light" },
  "desktop-dark": { width: 1280, height: 800, mobile: false, scheme: "dark" },
  "phone-light": { width: 390, height: 844, mobile: true, scheme: "light" },
  "phone-dark": { width: 390, height: 844, mobile: true, scheme: "dark" },
};

/* ------------------------------------------------------------- a run -- */
class Stop extends Error {}
const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
function want(seen, wanted) {
  const good = typeof wanted === "function" ? wanted(seen) : wanted instanceof RegExp ? wanted.test(String(seen)) : String(seen) === String(wanted);
  if (!good) throw new Error(`seen: ${String(seen).replace(/\s+/g, " ").slice(0, 200)} | wanted: ${wanted instanceof RegExp ? wanted : typeof wanted === "function" ? "(a condition)" : wanted}`);
  return seen;
}

class Run {
  constructor(name, cfgName, targets = [], browser = null) {
    this.name = name;
    this.cfgName = cfgName;
    this.cfg = CONFIGS[cfgName];
    this.targets = targets;
    this.browser = browser;
    this.results = [];
    this.expectedNetwork = [];
    this.made = [];
    this.depth = 0;
    this.dir = path.join(OUT, name);
    this.password = `checks ${randomBytes(12).toString("base64url")}`;
    this.shots = 0;
    mkdirSync(this.dir, { recursive: true });
  }
  isTarget(id) {
    return this.targets.some((t) => id === t || id.startsWith(`${t}:`));
  }
  /** One check: passes, or fails; a failure stops the run, unless the broken copy is there to make this check fail. */
  async check(id, fn) {
    const pad = "  ".repeat(this.depth + 1);
    this.depth += 1;
    try {
      const seen = await fn();
      this.results.push({ id, ok: true });
      console.log(`${pad}ok    ${id}${seen !== undefined ? `: ${String(seen).replace(/\s+/g, " ").slice(0, 150)}` : ""}`);
      return seen;
    } catch (error) {
      if (error instanceof Stop) throw error;
      const target = this.isTarget(id);
      this.results.push({ id, ok: false, target, why: error.message });
      console.log(`${pad}${target ? "FAILS " : "WRONG "}${id}\n${pad}      ${error.message.slice(0, 300)}`);
      await this.shot(`${target ? "fails" : "wrong"}-${id.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}`).catch(() => {});
      if (target) return undefined;
      throw new Stop(id);
    } finally {
      this.depth -= 1;
    }
  }
  async shot(name) {
    this.shots += 1;
    await this.page.shot(path.join(this.dir, `${String(this.shots).padStart(2, "0")}-${name}.png`));
  }
  api(op, body = {}) {
    return this.page.eval(`(async () => { const t = (await (await fetch("/api/session")).json()).result.token; const r = await fetch("/api/op/${op}", { method: "POST", headers: { "Content-Type": "application/json", "X-Allvibe-Token": t }, body: ${JSON.stringify(JSON.stringify(body))} }); return r.json(); })()`);
  }
}

/* ----------------------------------------------------------- helpers -- */
const P = (x) => x.page;
const visible = (x, sel) => P(x).eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; })()`);
async function openMenuIfNeeded(x) {
  if ((await visible(x, "#menu-btn")) && (await P(x).eval(`document.querySelector("#menu-btn").getAttribute("aria-expanded")`)) !== "true") await P(x).click("#menu-btn");
}
async function navTo(x, href) {
  await openMenuIfNeeded(x);
  await P(x).click(`#nav a[href="${href}"]`);
}
async function tab(x, id) {
  await P(x).click(x.cfg.mobile ? `#mtab-${id}` : `#rtab-${id}`);
  await P(x).waitFor(`document.querySelector("${x.cfg.mobile ? "#mtab" : "#rtab"}-${id}").getAttribute("aria-selected") === "true"`, { what: `the ${id} tab` });
}
/** The Plan side: on a phone behind its tab, on a desktop always there. */
async function planSide(x) {
  if (x.cfg.mobile) await tab(x, "chat");
}
// After a preparation changed the app from outside the page (a release, an
// entry, a commit), the page is loaded again, as by a person coming to it: an
// open page would only see the change at its next quiet look, up to 15 s later.
async function openApp(x, app = APP) {
  if (x.stale || !(await P(x).eval(`location.pathname === "/apps/${app}" && !!document.querySelector("#guide .stages")`))) {
    x.stale = false;
    await P(x).goto(`${URL_}/apps/${app}`);
    await P(x).waitFor(`!!document.querySelector("#guide .stages")`, { what: "the app view" });
  }
}
const focusOn = (x, sel) => P(x).eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.focus(); return document.activeElement === el; })()`);
// A dialog's opener: not there is said as such, not as a dialog that did not open.
const focusMust = async (x, sel) => { if (!(await focusOn(x, sel))) throw new Error(`nothing to press: ${sel} is not on the page`); };
const focusedIs = (x, sel) => P(x).eval(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`);
const inDialog = (x) => P(x).eval(`document.querySelector("#dialog").contains(document.activeElement)`);
const modalOpen = (x) => P(x).eval(`!document.querySelector("#modal").hidden`);
async function closeAnyDialog(x) {
  if (await modalOpen(x)) await P(x).click('#dialog [data-action="close"]').catch(() => {});
  if (await modalOpen(x)) await P(x).eval(`document.querySelector("#modal").hidden = true`);
}
// The Backups dialog, open: a closed dialog keeps what it last showed, so the list alone is not enough.
const OPEN_BACKUPS = `!document.querySelector("#modal").hidden && !!document.querySelector("#dialog .backups-list")`;
const gateClasses = (x) => P(x).eval(`[...document.querySelectorAll("#shipcard .safety li")].map((li) => li.className).join(",")`);
const gateStates = (x) => P(x).eval(`[...document.querySelectorAll("#shipcard .safety li")].map((li) => li.className + ":" + li.children[1].firstChild.textContent).join(" | ")`);
async function waitCard(x, until, { timeout = 8 * 60 * 1000 } = {}) {
  const seen = [];
  const deadline = Date.now() + timeout;
  for (;;) {
    const g = await gateStates(x).catch(() => "");
    if (g && g !== seen.at(-1)) seen.push(g);
    const h = await P(x).text("#shipcard h2").catch(() => null);
    if (h && until.test(h)) return { heading: h, seen };
    if (Date.now() > deadline) throw new Error(`waited ${Math.round(timeout / 1000)} s for a card saying ${until}; it says: ${h}`);
    await sleep(400);
  }
}
// Pink is the next action, and there is only ever one (D68): every pink thing on the screen, and the next-action button.
const PINK = "rgb(255, 77, 148)";
const pinkNow = (x) => P(x).eval(`(() => {
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const pink = [...document.querySelectorAll("body *")].filter((el) => vis(el) && [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopColor].includes("${PINK}"));
  return pink.map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + ' "' + el.textContent.trim().slice(0, 30) + '"');
})()`);
const guideNow = (x) => P(x).eval(`(() => {
  const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const pink = [...document.querySelectorAll("body *")].filter((el) => vis(el) && [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopColor].includes("${PINK}"));
  const btn = document.querySelector("#guide .guide-acts .btn.pink");
  return { stage: document.querySelector(".stages [aria-current=step] .l")?.firstChild?.textContent.trim() ?? "", button: btn?.textContent.trim() ?? "", text: document.querySelector("#guide-t")?.textContent.trim() ?? "", pinks: pink.length, pinkIsButton: pink.length === 1 && pink[0] === btn, right: document.querySelector("#preview-pane")?.hidden === false ? "Preview" : "Live" };
})()`);
const guideButton = (x) => P(x).eval(`document.querySelector("#guide .guide-acts .btn.pink")?.textContent.trim() ?? ""`);
async function pressGuide(x, { keyboard = false } = {}) {
  const before = await guideButton(x);
  if (keyboard) {
    want(await P(x).focused(), `button "${before}"`);
    await P(x).key("Enter");
  } else await P(x).click("#guide .guide-acts .btn.pink");
  await P(x).waitFor(`(document.querySelector("#guide .guide-acts .btn.pink")?.textContent.trim() ?? "") !== ${JSON.stringify(before)}`, { what: `the panel to move on from "${before}"`, timeout: 30000 });
  await sleep(300);
  return before;
}
/** A step being tried: its "Something is wrong" in view. */
async function ensureTrying(x) {
  await openApp(x);
  if (await visible(x, '#guide [data-action="report"]')) return;
  const b = await guideButton(x);
  if (!/^Try step \d+$/.test(b)) throw new Error(`no step to try: the next action is "${b}"`);
  await P(x).click("#guide .guide-acts .btn.pink");
  await P(x).waitFor(`!!document.querySelector('#guide [data-action="report"]')`, { what: "trying the step" });
}
const radios = (x) => P(x).eval(`[...document.querySelectorAll('input[name="ai-sign-in"]')].map((r) => r.value + (r.disabled ? " (off)" : "")).join(", ")`);
const inTerm = (x) => P(x).eval(`!!document.activeElement?.closest("#ai-term")`);
const onScreen = (x) => P(x).eval(`document.querySelector("#ai-term .xterm-rows")?.innerText ?? ""`);

/** Nothing wider than the screen: the page, and every part of it that scrolls or draws on its own. */
async function noOverflow(x, where) {
  return x.check(`no-overflow: ${where}`, async () => {
    const found = await P(x).eval(`(() => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      if (document.documentElement.scrollWidth > vw + 1) out.push("the page is " + document.documentElement.scrollWidth + " px wide in a " + vw + " px screen");
      for (const el of document.querySelectorAll(".pane, .lpane, .dialog, .nav, .every, .plan, .status-row, .apps, .guide, .stages, .ai, .ai-top, .ai-term")) {
        if (el.getClientRects().length && el.scrollWidth > el.clientWidth + 1) out.push((el.id ? "#" + el.id : "." + el.classList[0]) + " is " + el.scrollWidth + " px wide inside " + el.clientWidth);
      }
      for (const el of document.querySelectorAll(".ai, .ai-term, .xterm")) {
        const r = el.getBoundingClientRect();
        if (el.getClientRects().length && r.right > vw + 1) out.push((el.id ? "#" + el.id : "." + el.classList[0]) + " reaches " + Math.round(r.right) + " px in a " + vw + " px screen");
      }
      return out.join("; ");
    })()`);
    want(found, "");
    return `${x.cfg.width} px, nothing wider`;
  });
}

// A WebSocket to the terminal, opened from a page as the panel's page opens one, with a token of the check's choosing.
const OPEN = (url, token) => `(() => {
  window.__t = { closed: null, ready: null };
  const ws = new WebSocket(${JSON.stringify(url)});
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token: ${JSON.stringify(token)}, cols: 80, rows: 24, start: false }));
  ws.onmessage = (e) => { if (typeof e.data === "string") { const m = JSON.parse(e.data); if (m.t === "ready") window.__t.ready = m.session ?? "ready"; } };
  ws.onclose = (e) => { window.__t.closed = e.code; };
  return true;
})()`;

/* ------------------------------------------------------------ checks -- */
const CHECKS = {
  async setup(x) {
    return x.check("setup", async () => {
      const code = onHost("setup-code");
      await P(x).goto(`${URL_}/`);
      want(await P(x).eval("location.pathname"), "/setup");
      await noOverflow(x, "the setup page");
      await P(x).click("#code");
      await P(x).type(code);
      await P(x).click("#password");
      await P(x).type(x.password);
      await P(x).click("#again");
      await P(x).type(x.password);
      await P(x).click("#setup-form button[type=submit]");
      await P(x).waitFor(`location.pathname === "/" && !!document.querySelector("#main .head, #main .notice")`, { what: "the home screen after setting up", timeout: 10000 });
      return "the setup code and a new password: signed in, at home";
    });
  },

  async home(x) {
    return x.check("home", async () => {
      await P(x).goto(`${URL_}/`);
      await P(x).waitFor(`!!document.querySelector(".app-card")`, { what: "an app's card" });
      const a = (await x.api("apps.list")).result.find((p) => p.name === APP);
      const next = a.next.kind === "try" ? `Try step ${a.next.step}` : a.next.kind === "put-live" ? `Put ${a.next.version} live` : a.next.kind === "start-test-copy" ? "Start the test copy" : "Open";
      const card = `[...document.querySelectorAll(".app-card")].find((c) => c.querySelector("h3")?.textContent.trim() === ${JSON.stringify(APP)})`;
      await x.check("home: the status line", async () => want(await P(x).text(".status-row"), /^(No problems found\.|\d+ things? needs? you\.|The nightly checks have not run yet\.) .*Machine health$/));
      await x.check("home: the app's card", async () => want(await P(x).eval(`${card}?.innerText.replace(/\\s+/g, " ").trim() ?? "(no card)"`), new RegExp(`^${APP} (v\\d+ is live|Not live yet) `)));
      await x.check("home: its next action", async () => want(await P(x).eval(`${card}?.querySelector(".card-foot .btn")?.textContent.trim() ?? "(none)"`), next));
      await x.check("home: one pink thing at most, the next action", async () => want((await pinkNow(x)).join(", ") || "none", (s) => s === "none" || !s.includes(", ")));
      await x.check("home: each app's light in the side, a dot", async () => {
        if (x.cfg.mobile) {
          // By keyboard: a page that is wider than the screen (a broken copy's) moves the button from under the mouse.
          await focusOn(x, "#menu-btn");
          await P(x).key("Enter");
          await P(x).waitFor(`document.querySelector("#side").classList.contains("open")`, { what: "the side, open", timeout: 5000 });
          await sleep(300);
        }
        const sizes = await P(x).eval(`[...document.querySelectorAll("#nav .dot")].map((d) => { const r = d.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); })`);
        if (x.cfg.mobile) await P(x).key("Escape");
        want(sizes.length, (n) => n >= 1);
        return want(sizes.join(" "), (s) => s.split(" ").every((wh) => wh === "8x8"));
      });
      await noOverflow(x, "home");
      await x.shot("home");
    });
  },

  async "kbd-skip"(x) {
    return x.check("kbd-skip", async () => {
      await P(x).goto(`${URL_}/`);
      await P(x).waitFor(`!!document.querySelector("#main .head")`, { what: "home" });
      await P(x).key("Tab");
      want(await P(x).focused(), 'a "Skip to the content"');
      await P(x).key("Enter");
      await P(x).waitFor(`document.activeElement?.id === "main"`, { what: "focus on the content", timeout: 3000 });
      return "the first Tab reaches the skip link; Enter puts focus on the content";
    });
  },

  async machine(x) {
    return x.check("machine", async () => {
      await navTo(x, "/machine");
      await P(x).waitFor(`document.querySelector("#main h1")?.textContent === "Machine health"`, { what: "Machine health" });
      await x.check("machine: the checks, in plain words", async () => {
        await P(x).click('[data-action="recheck"]');
        await P(x).waitFor(`/Checked just now\\./.test(document.querySelector("#main .head").innerText)`, { what: '"Checked just now."', timeout: 60000 });
        const rows = await P(x).eval(`[...document.querySelectorAll(".check-row h3")].map((h) => h.textContent)`);
        want(rows.length, (n) => n >= 10);
        want(rows.join(" / "), /The engine: fine.*The control panel: fine/);
        return `${rows.length} checks, just now`;
      });
      await noOverflow(x, "machine health");
      await x.shot("machine");
    });
  },

  async "app-view"(x) {
    return x.check("app-view", async () => {
      if (x.cfg.mobile) await openMenuIfNeeded(x);
      await navTo(x, `/apps/${APP}`);
      await P(x).waitFor(`location.pathname === "/apps/${APP}" && !!document.querySelector("#guide .stages")`, { what: "the app view" });
      // The pane an earlier check left open stays open; the frame is in Preview.
      await tab(x, "preview");
      const plan = (await x.api("app.plan", { app: APP })).result;
      const detail = (await x.api("app.get", { app: APP })).result;
      x.appsHost = detail.appsHost;
      const ready = plan.steps.find((s) => s.state === "ready");
      const tried = plan.steps.filter((s) => s.state === "tried").length;
      want(ready ? `step ${ready.id} ready, ${tried} tried` : "no step ready", `step ${tried + 1} ready, ${tried} tried`);
      await x.check("app-view: the guided path, at the top, one pink thing", async () => {
        const g = await guideNow(x);
        want(`${g.stage}: ${g.button}`, `Try: ${tried + 1} of ${plan.steps.length}: Try step ${ready.id}`);
        want(g.text, `Step ${ready.id} is ready: ${lc(ready.title)}.`);
        want(g.pinkIsButton, true);
        return `${g.stage}: ${g.button}`;
      });
      await x.check("app-view: what the step asks, above the test copy", async () => want(await P(x).text("#tryline"), `Step ${ready.id}, to try: ${ready.check}`));
      await x.check("app-view: the plan", async () => want(await P(x).eval(`[...document.querySelectorAll("#plan-box .plan-top > *")].map((e) => e.textContent).join(" | ")`), `Plan: ${lc(plan.title)} | ${tried} of ${plan.steps.length} tried`));
      // On a phone the middle sentence makes room for the buttons.
      await x.check("app-view: the line above the frame", async () => want(await P(x).text(".fbar"), x.cfg.mobile ? /^Test copy In a tab of its own Restart the test copy$/ : /^Test copy Try anything here\. The live app is not touched\. In a tab of its own Restart the test copy$/));
      await x.check("app-view: the test copy, in the frame", async () => {
        const src = await P(x).eval(`document.querySelector(".tc-frame")?.src ?? ""`);
        const expected = `http://${detail.appsHost}:${detail.ports.testCopy}/`;
        const until = Date.now() + 15000;
        while (!P(x).log.frames.some((f) => f.url === expected) && Date.now() < until) await sleep(300);
        const f = P(x).log.frames.find((r) => r.url === expected);
        return want(f ? `${src} ${f.status}` : `${src} (no answer from ${expected})`, `${expected} 200`);
      });
      await sleep(800);
      await noOverflow(x, "the app, Preview");
      await x.shot("app-preview");
      await planSide(x);
      await x.check("app-view: its AI, under the plan, and how it signs in", async () => {
        want(await P(x).text("#ai-top"), /^Your AI It works in the test copy, and never reaches the live app\. (How your AI signs in )?Sign in with your Claude account In the terminal, when it starts\. Use the key in the vault /);
        want(await P(x).eval(`document.querySelector("#ai").getBoundingClientRect().top >= document.querySelector("#plan-box").getBoundingClientRect().bottom - 1`), true);
        return want(await radios(x), "account, key (off)");
      });
      if (x.cfg.mobile) {
        await noOverflow(x, "the app, Plan");
        await x.shot("app-plan");
        await tab(x, "preview");
      }
    });
  },

  // What is typed into the test copy stays there while the panel draws itself again (friction log 5, D73).
  async "frame-text"(x) {
    return x.check("frame-text", async () => {
      await openApp(x);
      await tab(x, "preview");
      const inFrame = async (expression) => {
        const src = await P(x).eval(`document.querySelector("iframe.tc-frame")?.src ?? ""`);
        return src ? P(x).evalInFrame(new URL(src).origin, expression) : null;
      };
      await sleep(1500);
      want(await inFrame(`!!document.querySelector("input[name=name]")`), true);
      const typed = `typed in the frame ${randomBytes(3).toString("hex")}`;
      await inFrame(`(() => { const el = document.querySelector("input[name=name]"); el.value = ""; el.focus(); return true; })()`);
      await P(x).type(typed);
      const kept = async () => ((await inFrame(`document.querySelector("input[name=name]")?.value ?? "(gone)"`)) === typed ? "kept" : "lost");
      await x.check("frame-text: typed into the test copy", async () => want(await kept(), "kept"));
      await tab(x, "live");
      await sleep(300);
      await tab(x, "preview");
      await sleep(800);
      await x.check("frame-text: after Live and back to Preview", async () => want(await kept(), "kept"));
      if (x.cfg.mobile) {
        await tab(x, "chat");
        await sleep(300);
        await tab(x, "preview");
        await sleep(800);
        await x.check("frame-text: after the Plan tab and back", async () => want(await kept(), "kept"));
      }
      await pressGuide(x);
      await sleep(800);
      await x.check("frame-text: after the next action, and the page drawn again", async () => want(await kept(), "kept"));
    });
  },

  async "kbd-tabs"(x) {
    return x.check("kbd-tabs", async () => {
      await openApp(x);
      const list = x.cfg.mobile ? "#mtabs" : "#rtabs";
      const names = await P(x).eval(`[...document.querySelectorAll("${list} [role=tab]")].map((t) => t.id)`);
      const selected = () => P(x).eval(`[...document.querySelectorAll("${list} [role=tab]")].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.id).join(",")`);
      const shown = () => P(x).eval(`(() => { const r = document.querySelector("#rpane"); const l = document.querySelector("#lside"); return (r.getClientRects().length && r.closest(".right").getClientRects().length ? (document.querySelector("#preview-pane").hidden ? "live" : "preview") : "") + (l.getClientRects().length ? "+plan" : ""); })()`);
      await tab(x, "preview");
      const first = names[0];
      const last = names.at(-1);
      await focusOn(x, `${list} [aria-selected=true]`);
      const seen = [];
      for (const [key, expectId] of [["ArrowRight", names[names.indexOf(`${list === "#mtabs" ? "mtab" : "rtab"}-preview`) + 1] ?? first], ["Home", first], ["End", last], ["ArrowRight", first], ["ArrowLeft", last]]) {
        await P(x).key(key);
        await sleep(150);
        const sel = await selected();
        const foc = await P(x).eval("document.activeElement.id");
        want(`${key}: ${sel} focused ${foc}`, `${key}: ${expectId} focused ${expectId}`);
        seen.push(`${key} ${expectId.replace(/^[mr]tab-/, "")} (${await shown()})`);
      }
      want(await P(x).eval(`document.querySelector("#rpane").getAttribute("aria-labelledby")`), (v) => names.includes(v));
      await tab(x, "preview");
      return seen.join(", ");
    });
  },

  /** A dialog, by keyboard: it opens with focus inside, Tab and Shift+Tab stay in it, Escape closes it and focus goes back. */
  async dialogByKeyboard(x, id, { open, opener, first }) {
    return x.check(id, async () => {
      try {
        await open();
        await P(x).waitFor(`!document.querySelector("#modal").hidden`, { what: "the dialog open", timeout: 5000 });
        await sleep(150);
        await x.check(`${id}: focus goes into it`, async () => want(await P(x).focused(), first));
        const n = await P(x).eval(`[...document.querySelectorAll("#dialog a[href], #dialog button:not([disabled]), #dialog textarea, #dialog input")].filter((el) => el.getClientRects().length).length`);
        const start = await P(x).focused();
        await x.check(`${id}: Tab stays in it`, async () => {
          const path = [];
          for (let i = 0; i < n; i++) {
            await P(x).key("Tab");
            path.push(await P(x).focused());
            if (!(await inDialog(x))) throw new Error(`Tab ${i + 1} left the dialog, to ${path.at(-1)}`);
          }
          want(path.at(-1), start);
          return `${n} Tab${n === 1 ? "" : "s"} round, back to ${start}`;
        });
        await x.check(`${id}: Shift+Tab stays in it`, async () => {
          await P(x).key("Tab", { shift: true });
          if (!(await inDialog(x))) throw new Error(`Shift+Tab left the dialog, to ${await P(x).focused()}`);
          return await P(x).focused();
        });
        await noOverflow(x, id);
        await x.shot(id);
        await x.check(`${id}: Escape closes it, and focus goes back`, async () => {
          await P(x).key("Escape");
          await sleep(200);
          if (await modalOpen(x)) throw new Error("the dialog is still open");
          if (!(await focusedIs(x, opener))) throw new Error(`focus is on ${await P(x).focused()}, not on what opened the dialog`);
          return `closed; focus on ${await P(x).focused()}`;
        });
      } finally {
        await closeAnyDialog(x);
      }
    });
  },

  async "kbd-dialog-report"(x) {
    await ensureTrying(x);
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-report", {
      open: async () => { await focusMust(x, '#guide [data-action="report"]'); await P(x).key("Enter"); },
      opener: '#guide [data-action="report"]',
      first: /^textarea "/,
    });
  },

  async report(x) {
    return x.check("report", async () => {
      await ensureTrying(x);
      const tag = randomBytes(4).toString("hex");
      await P(x).click('#guide [data-action="report"]');
      await P(x).waitFor(`document.activeElement?.id === "report-text"`, { what: "the report dialog" });
      const step = await P(x).eval(`document.querySelector("#dialog-title").textContent.match(/step (\\d+)/)[1]`);
      await P(x).type(`The weather box is empty (${tag}).`);
      await P(x).click('#report-form button[type="submit"]');
      await P(x).waitFor(`document.querySelector("#modal").hidden && !!document.querySelector("#toast.show")`, { what: "the dialog closed, a toast", timeout: 8000 });
      await x.check("report: the toast", async () => want(await P(x).text("#toast"), "Saved with the app. Tell your AI in its own session to read it."));
      await x.check("report: kept in the project, on the test host", async () => want(onHost("report", APP), new RegExp(`Step ${step}: The weather box is empty \\(${tag}\\)\\.`)));
    });
  },

  // The guided path (D68, D75): every step tried by its one next action, with
  // the mouse and the keyboard in turn, and the panel moving on to Live by itself.
  async guided(x) {
    return x.check("guided", async () => {
      await openApp(x);
      const plan = (await x.api("app.plan", { app: APP })).result;
      const n = plan.steps.length;
      const path = [];
      let keyboard = false;
      for (let presses = 0; presses < 2 * n + 1; presses++) {
        const g = await guideNow(x);
        path.push(`${g.stage}: ${g.button}`);
        await x.check(`guided: "${g.button}": the one pink thing, the next action`, async () => want(g.pinkIsButton, true));
        if (/^Put v\d+ live$/.test(g.button)) break;
        if (/^Step \d+ works$/.test(g.button)) {
          await x.check(`guided: "${g.button}": the test copy in view, and what to try`, async () => {
            want(g.right, "Preview");
            return want(g.text, /^Try step \d+ in the test copy: /);
          });
        }
        await pressGuide(x, { keyboard });
        keyboard = !keyboard;
      }
      const end = await guideNow(x);
      await x.check("guided: the path, one next action at a time", async () => want(path.join(" > "), new RegExp(`^(Try: 1 of ${n}: Try step 1 > )?Try: 1 of ${n}: Step 1 works > (Try: \\d of ${n}: (Try step|Step) \\d( works)? > )*Live: Put v\\d+ live$`)));
      await x.check("guided: moved on to Live by itself", async () => want(end.right, "Live"));
      await x.check("guided: and says what is next", async () => want(end.text, /^Every step is tried\. Next: put v\d+ live\.$/));
      await x.check("guided: the plan, every step tried", async () => want(await P(x).eval(`document.querySelector("#plan-box .plan-top .muted")?.textContent`), `${n} of ${n} tried`));
      await noOverflow(x, "the guided path, Live");
      await x.shot("all-tried");
    });
  },

  async "kbd-menu"(x) {
    return x.check("kbd-menu", async () => {
      await openApp(x);
      try {
        await focusOn(x, "#more-btn");
        await P(x).key("Enter");
        await sleep(150);
        want(await P(x).eval(`document.querySelector("#more-btn").getAttribute("aria-expanded")`), "true");
        want(await P(x).focused(), /^button "Backups/);
        // Since D83, three items: Backups, Service keys, App settings, round and round with the arrows.
        await P(x).key("ArrowDown");
        want(await P(x).focused(), /^button "Service keys/);
        await P(x).key("ArrowDown");
        want(await P(x).focused(), /^button "App settings/);
        await P(x).key("ArrowDown");
        want(await P(x).focused(), /^button "Backups/);
        await P(x).key("ArrowUp");
        want(await P(x).focused(), /^button "App settings/);
        await P(x).key("Escape");
        await sleep(150);
        want(await P(x).eval(`document.querySelector("#more-menu").hidden`), true);
        want(await focusedIs(x, "#more-btn"), true);
        return "Enter opens it on its first item; the arrows go round its three; Escape closes it, back on More";
      } finally {
        if (!(await P(x).eval(`document.querySelector("#more-menu").hidden`))) await P(x).click("#more-btn");
      }
    });
  },

  async "kbd-dialog-backups"(x) {
    await openApp(x);
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-backups", {
      open: async () => { await focusMust(x, "#more-btn"); await P(x).key("Enter"); await sleep(150); await P(x).key("Enter"); },
      opener: "#more-btn",
      first: 'button "Close"',
    });
  },

  async "refusal-untried"(x) {
    return x.check("refusal-untried", async () => {
      await openApp(x);
      const plan = (await x.api("app.plan", { app: APP })).result;
      want(`${plan.steps.length} steps, ${plan.steps.filter((s) => s.state === "tried").length} tried`, "2 steps, 2 tried");
      await P(x).waitFor(`!!document.querySelector('#guide [data-action="put-live"]')`, { what: "Put vN live" });
      // The builder adds a step while the page shows every step tried; the page
      // does not refresh behind a dialog, so it still offers to put it live.
      await P(x).click("#more-btn");
      await P(x).click('[data-action="more-backups"]');
      await P(x).waitFor(OPEN_BACKUPS, { what: "the Backups dialog" });
      onHost("plan", APP, "3", x.label);
      await P(x).key("Escape");
      await P(x).waitFor(`document.querySelector("#modal").hidden`, { what: "the dialog closed" });
      const v = await P(x).eval(`document.querySelector('#guide [data-action="put-live"]').dataset.v`);
      await P(x).click('#guide [data-action="put-live"]');
      const card = await waitCard(x, /is not live|is live\./);
      await x.check("refusal-untried: the answer", async () => want(card.heading, `${v} is not live`));
      await x.check("refusal-untried: in plain words", async () => want(await P(x).text("#shipcard .stopbox"), new RegExp(`^Nothing changed\\. It stopped at "every step of the plan is tried by you": the plan ".*" has steps you have not tried: step 3, "Let the home town be changed" What would have to be true: .* Here: press OK, and the next action at the top takes you to each step to try\\.$`)));
      await x.check("refusal-untried: the checks", async () => want(await gateClasses(x), "failed,next,next,next,next,next"));
      // D83: work outside a plan is offered only where a plan is missing, never past an untried step.
      await x.check("refusal-untried: no way outside a plan while the plan has untried steps", async () => want(await visible(x, '[data-action="put-outside"]'), false));
      await x.check("refusal-untried: the next action, OK", async () => { const g = await guideNow(x); want(`${g.stage}: ${g.button}`, "Live: OK"); return want(g.pinkIsButton, true); });
      await noOverflow(x, "the refusal");
      await x.shot("refusal-untried");
      await pressGuide(x);
      await x.check("refusal-untried: then, the new step to try", async () => want(`${(await guideNow(x)).stage}: ${await guideButton(x)}`, "Try: 3 of 3: Try step 3"));
      await pressGuide(x);
      await pressGuide(x);
      await P(x).waitFor(`/^Put v\\d+ live$/.test(document.querySelector("#guide .guide-acts .btn.pink")?.textContent.trim() ?? "")`, { what: "every step tried" });
    });
  },

  async "refusal-backup"(x) {
    return x.check("refusal-backup", async () => {
      await openApp(x);
      note(onHost("unplug"));
      try {
        await P(x).waitFor(`!!document.querySelector('#guide [data-action="put-live"]')`, { what: "Put vN live" });
        const v = await P(x).eval(`document.querySelector('#guide [data-action="put-live"]').dataset.v`);
        await P(x).click('#guide [data-action="put-live"]');
        const card = await waitCard(x, /is not live|is live\./);
        await x.check("refusal-backup: the answer", async () => want(card.heading, `${v} is not live`));
        await x.check("refusal-backup: in plain words", async () => want(await P(x).text("#shipcard .stopbox"), /^Nothing changed\. It stopped at "the backup target is off this machine and writable": .* is on this machine's own root filesystem, which is not off the machine What would have to be true: a directory on a separate disk/));
        await x.check("refusal-backup: the checks", async () => want(await gateClasses(x), "done,failed,next,next,next,next"));
        await x.check("refusal-backup: nothing changed", async () => want((await x.api("app.get", { app: APP })).result.live, x.liveBefore));
        await noOverflow(x, "the backup refusal");
        await x.shot("refusal-backup");
      } finally {
        note(onHost("plug"));
      }
      await P(x).click('#guide [data-action="dismiss-job"]');
      await P(x).waitFor(`!!document.querySelector('#guide [data-action="put-live"]')`, { what: "Put vN live again" });
    });
  },

  // One lock per app (D72): the command line holds it, and the panel is refused in plain words, before anything changes.
  async "lock-refusal"(x) {
    return x.check("lock-refusal", async () => {
      await openApp(x);
      await P(x).waitFor(`!!document.querySelector('#guide [data-action="put-live"]')`, { what: "Put vN live" });
      note(onHost("hold-lock", APP, "backup"));
      try {
        x.expectedNetwork.push({ path: "/api/op/app.putLive", status: 409, why: "putting it live while the command line holds the app's lock" });
        // A toast from an earlier step may still be up: it goes first, so that the one read is the refusal's.
        await P(x).eval(`(() => { const t = document.querySelector("#toast"); t.classList.remove("show"); t.textContent = ""; return true; })()`);
        await P(x).click('#guide [data-action="put-live"]');
        await P(x).waitFor(`document.querySelector("#toast").classList.contains("show") && document.querySelector("#toast").textContent !== ""`, { what: "the refusal", timeout: 8000 });
        await x.check("lock-refusal: in plain words", async () => want(await P(x).text("#toast"), new RegExp(`^A backup of ${APP} is already running, started from the command line (just now|1 minute ago)\\. Wait for it to end, then try again\\.$`)));
        await x.shot("lock-refusal");
        await x.check("lock-refusal: nothing started, nothing changed", async () => {
          want(await guideButton(x), /^Put v\d+ live$/);
          want((await x.api("app.get", { app: APP })).result.live, x.liveBefore);
          return "the same next action; the same live version";
        });
        await noOverflow(x, "the lock refusal");
      } finally {
        note(onHost("free-lock", APP));
      }
    });
  },

  async "put-live"(x) {
    return x.check("put-live", async () => {
      await openApp(x);
      await P(x).waitFor(`!!document.querySelector('#guide [data-action="put-live"]')`, { what: "Put vN live" });
      const v = await P(x).eval(`document.querySelector('#guide [data-action="put-live"]').dataset.v`);
      x.previous = (await x.api("app.get", { app: APP })).result.live;
      await P(x).click('#guide [data-action="put-live"]');
      let mid = false;
      const card = await (async () => {
        const seen = [];
        const deadline = Date.now() + 8 * 60 * 1000;
        for (;;) {
          const g = await gateStates(x).catch(() => "");
          if (g && g !== seen.at(-1)) seen.push(g);
          if (!mid && /now:Backup restored/.test(g)) { await x.shot("putting-live"); mid = true; }
          const h = await P(x).text("#shipcard h2").catch(() => null);
          if (h && /is live\.|is not live/.test(h)) return { heading: h, seen };
          if (Date.now() > deadline) throw new Error("waited 8 minutes");
          await sleep(400);
        }
      })();
      await x.check("put-live: the answer", async () => want(card.heading, `${v} is live.`));
      await x.check("put-live: the checks, seen checking one after another", async () => {
        const nows = card.seen.map((s) => s.match(/now:([^|]+)/)?.[1].trim()).filter(Boolean).filter((g, i, a) => a.indexOf(g) === i);
        // The page asks every second; a check that passes quicker is not always caught checking.
        want(nows.length, (n) => n >= 3);
        return nows.join(" > ");
      });
      await x.check("put-live: every check done", async () => want(await gateClasses(x), "done,done,done,done,done,done"));
      await P(x).click("#shipcard .every-checks summary");
      await x.check("put-live: every check, as the machine ran it", async () => want(await P(x).eval(`document.querySelectorAll("#shipcard .every li.ok").length + " done, " + document.querySelectorAll("#shipcard .every li.failed").length + " stopped"`), /^1\d done, 0 stopped$/));
      await noOverflow(x, "live, every check open");
      await x.shot("live");
      await x.check("put-live: earlier versions, with the way back", async () => want(await P(x).text("#live-pane .vers"), new RegExp(`^${v} just now .*Live now .*Go back to ${x.previous}`)));
      await x.check("put-live: Done, and its three choices", async () => {
        const g = await guideNow(x);
        want(`${g.stage}: ${g.text}`, `Done: ${v} is live. Everyone on your home network uses it now.`);
        want(await P(x).eval(`[...document.querySelectorAll("#guide .guide-acts a, #guide .guide-acts button")].map((b) => b.textContent.trim()).join(" | ")`), `Open the app | Start something new | Something feels wrong? Go back to ${x.previous}`);
        return want(g.pinkIsButton, true);
      });
      x.released = v;
    });
  },

  async backups(x) {
    return x.check("backups", async () => {
      await openApp(x);
      await P(x).click("#more-btn");
      await P(x).click('[data-action="more-backups"]');
      await P(x).waitFor(OPEN_BACKUPS, { what: "the Backups dialog" });
      try {
        const rows = await P(x).eval(`[...document.querySelectorAll(".backups-list .row")].map((r) => r.innerText.replace(/\\s+/g, " ").trim())`);
        want(rows.length, (n) => n >= 1);
        return want(rows[0], /^(Before a release|Before going back|Every night|By hand), (just now|\d+ minutes? ago) (Of v\d+, )?(\d+ entr(y|ies), )?\d+ kB, encrypted\.$/);
      } finally {
        await closeAnyDialog(x);
      }
    });
  },

  async "kbd-dialog-goback"(x) {
    await openApp(x);
    await tab(x, "live");
    const live = (await x.api("app.get", { app: APP })).result.live;
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-goback", {
      open: async () => { await focusMust(x, '[data-action="go-back"]'); await P(x).key("Enter"); },
      opener: '[data-action="go-back"]',
      first: `button "Keep ${live}"`,
    });
  },

  async "go-back"(x) {
    return x.check("go-back", async () => {
      await openApp(x);
      await tab(x, "live");
      const target = await P(x).eval(`document.querySelector('[data-action="go-back"]')?.dataset.v`);
      want(target ?? "(no way back offered)", /^v\d+$/);
      await P(x).click('[data-action="go-back"]');
      await P(x).waitFor(`!document.querySelector("#modal").hidden`, { what: "the confirmation" });
      await x.check("go-back: the confirmation", async () => want(await P(x).text("#dialog"), new RegExp(`^Go back to ${target}\\? The live app goes back to ${target}\\. Your data stays: everything written since then is kept\\.`)));
      // Confirmed by keyboard: Tab from "Keep" to "Go back", then Enter.
      await P(x).key("Tab");
      want(await P(x).focused(), `button "Go back to ${target}"`);
      await P(x).key("Enter");
      const started = await x.check("go-back: it starts", async () => { await P(x).waitFor(`/^Going back to|^Back on|^Still on/.test(document.querySelector("#shipcard h2")?.textContent ?? "")`, { what: "the card going back", timeout: 10000 }); return "the card going back"; });
      // Not started (a broken copy's): nothing to wait for.
      if (!started) throw new Error("it did not start");
      const card = await waitCard(x, /^Back on|^Still on/);
      await x.check("go-back: the answer", async () => want(card.heading, `Back on ${target}.`));
      await x.check("go-back: every check done", async () => want(await gateClasses(x), "done,done,done,done,done,done"));
      await x.check("go-back: the live version, from the engine", async () => want((await x.api("app.get", { app: APP })).result.live, target));
      await noOverflow(x, "back");
      await x.shot("back");
    });
  },

  /* ---------------------------------------- the eighth brief (D83) -- */
  // Going back with the data: set apart in Live, never pink, never in the guide;
  // what is lost said with its counts; the name typed before the button works.
  async "kbd-dialog-data"(x) {
    await openApp(x);
    await tab(x, "live");
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-data", {
      open: async () => { await focusMust(x, '[data-action="go-back-data"]'); await P(x).key("Enter"); },
      opener: '[data-action="go-back-data"]',
      first: 'input "data-name"',
    });
  },
  async "data-back"(x) {
    return x.check("data-back", async () => {
      await openApp(x);
      await tab(x, "live");
      const d = (await x.api("app.get", { app: APP })).result;
      const from = d.live;
      await x.check("data-back: set apart in Live, a choice of its own", async () => want(await P(x).text("#data-card h2"), "Go back with the data"));
      await x.check("data-back: never pink, and never the next action", async () => {
        const g = await guideNow(x);
        want(await P(x).eval(`getComputedStyle(document.querySelector('[data-action="go-back-data"]')).backgroundColor !== "${PINK}"`), true);
        return want(`${g.pinks} pink; the next action "${g.button}"`, (s) => !/Go back with the data/.test(s) && /^[01] pink/.test(s));
      });
      await P(x).click('[data-action="go-back-data"]');
      await P(x).waitFor(`!document.querySelector("#modal").hidden && !!document.querySelector("#data-form")`, { what: "the confirmation", timeout: 15000 });
      const plan = (await x.api("app.goBackWithDataPlan", { app: APP })).result;
      await x.check("data-back: what is lost, in plain words, with the counts", async () => want(await P(x).text("#dialog"), new RegExp(`^Go back to ${plan.to} with the data\\? The live app goes back to ${plan.to}, and its data goes back to how it was .*, just before ${from} went live\\. Everything saved in the live app since then is lost from it\\. It has ${plan.entriesNow} entr(y|ies) now; the backup has ${plan.entriesAtBackup}\\. First, a backup of the live app as it is now is taken, restored and checked`)));
      await x.check("data-back: the button waits for the app's name", async () => {
        const off = await P(x).eval(`document.querySelector("#data-go").disabled`);
        await P(x).click("#data-name");
        await P(x).type(`${APP}x`);
        const wrong = await P(x).eval(`document.querySelector("#data-go").disabled`);
        await P(x).key("Backspace");
        want(await P(x).eval(`document.querySelector("#data-name").value`), APP);
        const right = await P(x).eval(`document.querySelector("#data-go").disabled`);
        return want(`nothing typed: ${off ? "off" : "on"}; another name: ${wrong ? "off" : "on"}; the name: ${right ? "off" : "on"}`, "nothing typed: off; another name: off; the name: on");
      });
      await noOverflow(x, "data-dialog");
      await x.shot("data-dialog");
      await P(x).click("#data-go");
      const started = await x.check("data-back: it starts", async () => { await P(x).waitFor(`/^Going back to .* with the data|^Back on|^Going back with the data stopped/.test(document.querySelector("#shipcard h2")?.textContent ?? "")`, { what: "the card going back with the data", timeout: 10000 }); return "the card"; });
      if (!started) throw new Error("it did not start");
      const card = await waitCard(x, /^Back on|stopped$/);
      await x.check("data-back: the answer", async () => want(card.heading, `Back on ${plan.to}, with its data.`));
      await x.check("data-back: every check done", async () => want(await gateClasses(x), "done,done,done,done,done,done"));
      await x.check("data-back: the live app, back, with the backup's entries", async () => {
        const after = (await x.api("app.get", { app: APP })).result.live;
        return want(`${after}; ${onHost("entries", APP)}`, `${plan.to}; ${plan.entriesAtBackup} entries`);
      });
      await noOverflow(x, "data-back");
      await x.shot("data-back");
      await P(x).click('#shipcard [data-action="dismiss-job"]');
    });
  },
  // Work outside a plan: offered only where a release would be refused for want of a plan.
  async "kbd-dialog-outside"(x) {
    await openApp(x);
    await tab(x, "live");
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-outside", {
      open: async () => { await focusMust(x, '#outside-card [data-action="put-outside"]'); await P(x).key("Enter"); },
      opener: '#outside-card [data-action="put-outside"]',
      first: 'input "outside-why"',
    });
  },
  async "outside-plan"(x) {
    return x.check("outside-plan", async () => {
      await openApp(x);
      await tab(x, "live");
      const v = await P(x).eval(`document.querySelector('#outside-card [data-action="put-outside"]')?.dataset.v ?? "(not offered)"`);
      await x.check("outside-plan: offered, where a release would be refused for want of a plan", async () => want(`${v}: ${await P(x).text("#outside-card h2").catch(() => "")}`, /^v\d+: v\d+: changes outside a plan$/));
      await x.check("outside-plan: not pink", async () => want(await P(x).eval(`getComputedStyle(document.querySelector('#outside-card [data-action="put-outside"]')).backgroundColor !== "${PINK}"`), true));
      await P(x).click('#outside-card [data-action="put-outside"]');
      await P(x).waitFor(`!document.querySelector("#modal").hidden && !!document.querySelector("#outside-form")`, { what: "the dialog" });
      await x.check("outside-plan: the dialog says what it means", async () => want(await P(x).text("#dialog"), new RegExp(`^Put ${v} live outside a plan\\? Nobody has tried ${v}'s changes as steps of a plan\\..*The release keeps your reason`)));
      const why = `a fix outside any plan (${x.label ?? x.cfgName})`;
      await P(x).click("#outside-why");
      await P(x).type(why);
      await P(x).key("Enter");
      const started = await x.check("outside-plan: it starts", async () => { await P(x).waitFor(`/^Putting .* live|is live\\.|is not live/.test(document.querySelector("#shipcard h2")?.textContent ?? "")`, { what: "the card putting it live", timeout: 10000 }); return "the card"; });
      if (!started) throw new Error("it did not start");
      const card = await waitCard(x, /is live\.$|is not live$/);
      await x.check("outside-plan: the answer", async () => want(card.heading, `${v} is live.`));
      await x.check("outside-plan: the release keeps the reason, in Earlier versions", async () => want(await P(x).text("#live-pane .vers"), new RegExp(`^${v} just now .*${why.charAt(0).toUpperCase()}${why.slice(1).replace(/[()]/g, "\\$&")}\\.`)));
      await x.check("outside-plan: and the engine too, with the version the panel named", async () => {
        const r = (await x.api("app.get", { app: APP })).result.versions[0];
        return want(`${r.version}: ${r.outsidePlan}`, `${v}: ${why}`);
      });
      await noOverflow(x, "outside");
      await x.shot("outside");
    });
  },
  // Service keys: under More; a value goes in and is never shown again.
  async "kbd-dialog-keys"(x) {
    await openApp(x);
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-keys", {
      open: async () => { await focusMust(x, "#more-btn"); await P(x).key("Enter"); await sleep(150); await P(x).key("ArrowDown"); await P(x).key("Enter"); },
      opener: "#more-btn",
      first: 'button "Close"',
    });
  },
  async keys(x) {
    return x.check("keys", async () => {
      await openApp(x);
      const value = `svc-${randomBytes(16).toString("hex")}`;
      const name = `CHECK_${randomBytes(3).toString("hex").toUpperCase()}`;
      await P(x).click("#more-btn");
      await P(x).click('[data-action="more-keys"]');
      await P(x).waitFor(`!document.querySelector("#modal").hidden && !!document.querySelector("#dialog .keys-list")`, { what: "Service keys", timeout: 10000 });
      await x.check("keys: under More, in the demo's words", async () => want(await P(x).text("#dialog"), new RegExp(`^Service keys of ${APP} Service keys let your app use services outside your machine, like a weather service\\. .* never shown again, not even here\\.`)));
      await P(x).click('#dialog [data-action="add-key"]');
      await P(x).waitFor(`!!document.querySelector("#key-form")`, { what: "Add a service key" });
      await x.check("keys: the value is a password field, and the words say it is never shown again", async () => want(`${await P(x).eval(`document.querySelector("#k-value").type`)}: ${await P(x).text("#k-value-hint")}`, "password: Paste the key here. It is never shown again."));
      await P(x).click("#k-name");
      await P(x).type(name);
      await P(x).eval(`(() => { const s = document.querySelector("#k-where"); s.value = "prod"; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
      await P(x).click("#k-value");
      await P(x).type(value);
      await noOverflow(x, "keys-add");
      await P(x).click("#key-go");
      const row = `[...document.querySelectorAll("#dialog .keys-list .row")].find((r) => r.querySelector("h3")?.textContent.startsWith(${JSON.stringify(`${name} `)}))`;
      await x.check("keys: saved, and back in the list, its value hidden", async () => {
        await P(x).waitFor(`!!document.querySelector("#dialog .keys-list") && document.querySelector("#dialog").innerText.includes(${JSON.stringify(name)})`, { what: "the key in the list", timeout: 120000 });
        return want((await P(x).eval(`${row}?.innerText ?? ""`)).replace(/\s+/g, " ").trim(), new RegExp(`^${name} •••••• Live app, changed just now\\. Remove$`));
      });
      // A dialog opens on a safe control: with keys listed, never on a Remove.
      await x.check("keys: with a key listed, the dialog opens on Close, never on Remove", async () => {
        await closeAnyDialog(x);
        await focusMust(x, "#more-btn");
        await P(x).key("Enter");
        await sleep(150);
        await P(x).key("ArrowDown");
        await P(x).key("Enter");
        await P(x).waitFor(`!!document.querySelector("#dialog .keys-list .row")`, { what: "Service keys, with the key", timeout: 10000 });
        await sleep(150);
        return want(await P(x).focused(), 'button "Close"');
      });
      await x.check("keys: the value is nowhere in the page", async () => want(await P(x).eval(`(document.documentElement.outerHTML + [...document.querySelectorAll("input")].map((i) => i.value).join(" ")).includes(${JSON.stringify(value)})`), false));
      await x.check("keys: the live app reads it, from its file", async () => want(onHost("secret-hash", APP, "prod", name), createHash("sha256").update(value).digest("hex")));
      await noOverflow(x, "keys");
      await x.shot("keys");
      await P(x).click(`#dialog [data-action="remove-key"][data-name="${name}"]`);
      await P(x).waitFor(`!!document.querySelector("#rk-go")`, { what: "the removal's confirmation" });
      await x.check("keys: removing it, confirmed in plain words", async () => want(await P(x).text("#dialog"), new RegExp(`^Remove ${name} from the live app\\? The live app starts again without it\\.`)));
      await P(x).click("#rk-go");
      await x.check("keys: removed, and gone from the list and the live app", async () => {
        await P(x).waitFor(`!!document.querySelector("#dialog .keys-list") && !document.querySelector("#dialog .keys-list").innerText.includes(${JSON.stringify(name)})`, { what: "the key gone", timeout: 120000 });
        return want(`${await P(x).text("#dialog .said")}; the live app: ${onHost("secret-hash", APP, "prod", name)}`, `${name} is removed from the live app.; the live app: none`);
      });
      await closeAnyDialog(x);
    });
  },
  // Removing an app: in its settings, its name typed, its last backup kept and where it is said.
  async "kbd-dialog-settings"(x) {
    await openApp(x, x.newApp);
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-settings", {
      open: async () => { await focusMust(x, "#more-btn"); await P(x).key("Enter"); await sleep(150); await P(x).key("ArrowDown"); await P(x).key("ArrowDown"); await P(x).key("Enter"); },
      opener: "#more-btn",
      first: `button "Remove ${x.newApp}…"`,
    });
  },
  async "kbd-dialog-remove"(x) {
    await openApp(x, x.newApp);
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-remove", {
      open: async () => { await P(x).click("#more-btn"); await P(x).click('[data-action="more-settings"]'); await P(x).waitFor(`!!document.querySelector('#dialog [data-action="remove-app"]')`, { what: "the settings" }); await P(x).click('#dialog [data-action="remove-app"]'); },
      opener: "#more-btn",
      first: 'input "rm-name"',
    });
  },
  async "remove-app"(x) {
    return x.check("remove-app", async () => {
      const app = x.newApp;
      await openApp(x, app);
      await P(x).click("#more-btn");
      await P(x).click('[data-action="more-settings"]');
      await P(x).waitFor(`!!document.querySelector('#dialog [data-action="remove-app"]')`, { what: "the settings" });
      await x.check("remove-app: in the app's settings", async () => want(await P(x).text("#dialog .apart"), /^Remove this app Its test copy and its live app go, with their data, .* A last backup of the live app is taken first, and kept\. Remove /));
      await P(x).click('#dialog [data-action="remove-app"]');
      await P(x).waitFor(`!!document.querySelector("#rm-form")`, { what: "the removal's confirmation" });
      await x.check("remove-app: what goes, and the backup first, in plain words", async () => want(await P(x).text("#dialog"), new RegExp(`^Remove ${app}\\? This deletes, for good: the test copy and the live app, with their data .* First, a last backup of the live app is taken, restored and checked, and kept on the backup disk with the others\\. If that cannot be done, nothing is removed\\.`)));
      await x.check("remove-app: the button waits for the app's name", async () => {
        const off = await P(x).eval(`document.querySelector("#rm-go").disabled`);
        await P(x).click("#rm-name");
        await P(x).type(`${app.slice(0, -1)}`);
        const part = await P(x).eval(`document.querySelector("#rm-go").disabled`);
        await P(x).type(app.slice(-1));
        const right = await P(x).eval(`document.querySelector("#rm-go").disabled`);
        return want(`nothing typed: ${off ? "off" : "on"}; part of it: ${part ? "off" : "on"}; the name: ${right ? "off" : "on"}`, "nothing typed: off; part of it: off; the name: on");
      });
      await noOverflow(x, "remove-dialog");
      await P(x).click("#rm-go");
      await x.check("remove-app: removed, and where its last backup is", async () => {
        await P(x).waitFor(`/ is removed$/.test(document.querySelector("#dialog-title")?.textContent ?? "") || !document.querySelector("#rm-error").hidden`, { what: "the removal's end", timeout: 300000 });
        return want(await P(x).text("#dialog"), new RegExp(`^${app} is removed Its last backup, restored and checked, is kept on the backup disk: /mnt/[a-z-]+backup/[a-z]+/${app}/releases/${app}-prod-\\d{8}T\\d{6}Z\\.dump\\.age\\. Its earlier backups are kept too\\. Back to your apps$`));
      });
      await noOverflow(x, "removed");
      await x.shot("removed");
      await P(x).click("#rm-home");
      await P(x).waitFor(`location.pathname === "/" && !!document.querySelector("#main .head")`, { what: "Your apps" });
      await x.check("remove-app: gone from the home screen and the side", async () => want(await P(x).eval(`document.body.innerText.includes(${JSON.stringify(app)})`), false));
      x.made = x.made.filter((m) => m !== app);
    });
  },

  async "kbd-dialog-new-app"(x) {
    await P(x).goto(`${URL_}/`);
    await P(x).waitFor(`!!document.querySelector('[data-action="new-app"]')`, { what: "Make a new app" });
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-new-app", {
      open: async () => { await focusMust(x, '[data-action="new-app"]'); await P(x).key("Enter"); },
      opener: '[data-action="new-app"]',
      first: 'input "new-app-name"',
    });
  },

  // A new app, made in the panel (D76, D77): its name refused in plain words when it cannot be had, then made, opening in Plan.
  async "new-app"(x) {
    return x.check("new-app", async () => {
      await P(x).goto(`${URL_}/`);
      await P(x).waitFor(`!!document.querySelector('[data-action="new-app"]')`, { what: "Make a new app" });
      const name = `made-${x.cfgName.split("-").map((w) => w[0]).join("")}-${randomBytes(2).toString("hex")}`;
      await P(x).click('[data-action="new-app"]');
      await P(x).waitFor(`document.activeElement?.id === "new-app-name"`, { what: "the name field, focused" });
      const retype = async (text) => {
        await P(x).eval(`document.querySelector("#new-app-name").value = ""`);
        await P(x).click("#new-app-name");
        await P(x).type(text);
        await P(x).key("Enter");
      };
      await x.check("new-app: a name it cannot have, in plain words", async () => {
        await retype("9 lives");
        await P(x).waitFor(`!document.querySelector("#new-app-error").hidden`, { what: "a refusal", timeout: 5000 });
        want(await P(x).text("#new-app-error"), "The name needs 2 to 30 small letters, digits and dashes, starting with a letter.");
        return want(await P(x).eval("document.activeElement.id"), "new-app-error");
      });
      await x.check("new-app: a name already taken, in the engine's words", async () => {
        x.expectedNetwork.push({ path: "/api/op/app.create", status: 403, why: "a name already taken" });
        await retype(APP);
        await P(x).waitFor(`/already|not made/i.test(document.querySelector("#new-app-error").textContent)`, { what: "the engine's refusal", timeout: 8000 });
        return want(await P(x).text("#new-app-error"), `There is already an app called ${APP}`);
      });
      await noOverflow(x, "the new app's dialog");
      x.made.push(name);
      await retype(name);
      const making = await x.check("new-app: its steps, as they run", async () => {
        await P(x).waitFor(`!document.querySelector("#new-app-steps")?.hidden && document.querySelectorAll("#new-app-steps li").length > 0`, { what: "the steps", timeout: 30000 });
        await x.shot("new-app-making");
        return P(x).text("#new-app-steps li");
      });
      if (!making) throw new Error("it is not being made");
      await P(x).waitFor(`location.pathname === "/apps/${name}" && !!document.querySelector("#guide .guide-acts .btn.pink")`, { what: "the new app, opened", timeout: 300000 });
      await x.check("new-app: it opens in Plan; its next action, to start its AI", async () => {
        const g = await guideNow(x);
        want(`${g.stage}: ${g.button}`, "Plan: Start your AI");
        want(g.text, "Start your AI, and tell it what you want to build. It works in the test copy, never the live app.");
        return want(g.pinkIsButton, true);
      });
      await x.check("new-app: its name, on its page and in the side", async () => {
        want(await P(x).text("#app-name"), name);
        return want(await P(x).eval(`[...document.querySelectorAll("#nav a.nav-app")].some((a) => a.getAttribute("href") === "/apps/${name}")`), true);
      });
      await planSide(x);
      await x.check("new-app: how its AI signs in", async () => want(await radios(x), "account, key (off)"));
      await noOverflow(x, "the new app, in Plan");
      await x.shot("new-app");
      x.newApp = name;
    });
  },

  // Its AI, started from the panel with a stand-in key (D77): Claude Code's own terminal under the plan.
  async "ai-start"(x) {
    return x.check("ai-start", async () => {
      const app = want(x.newApp ?? "(no new app)", /^made-/);
      await openApp(x, app);
      note(onHost("agent-key", app));
      await planSide(x);
      await x.check("ai-start: the key, once in the vault, can be chosen", async () => {
        await P(x).waitFor(`!!document.querySelector('input[name="ai-sign-in"][value="key"]:not([disabled])')`, { what: "the key's choice, on", timeout: 25000 });
        return radios(x);
      });
      await x.check("ai-start: its choice, by keyboard", async () => {
        const checked = () => P(x).eval(`document.querySelector('input[name="ai-sign-in"]:checked')?.value ?? "none"`);
        await focusOn(x, 'input[name="ai-sign-in"]:checked');
        await P(x).key("ArrowUp");
        const up = await checked();
        await P(x).key("ArrowDown");
        return want(`${up}, then ${await checked()}`, "account, then key");
      });
      await P(x).click("#guide .guide-acts .btn.pink");
      const starting = await x.check("ai-start: it starts, and says so", async () => {
        await P(x).waitFor(`/Starting your AI/.test(document.querySelector("#ai-top")?.textContent ?? "") || !!document.querySelector("#ai-term .xterm-rows")`, { what: "the AI starting", timeout: 30000 });
        return (await P(x).text("#ai-top")) || "the terminal";
      });
      if (!starting) throw new Error("it did not start");
      await P(x).waitFor(`!!document.querySelector("#ai-term .xterm-rows")`, { what: "Claude Code's terminal", timeout: 400000 });
      await x.check("ai-start: Claude Code's own screen, in its terminal", async () => {
        const end = Date.now() + 60000;
        while (Date.now() < end && !/Choose the text style|Claude Code/.test(await onScreen(x))) await sleep(500);
        // On a phone its logo comes first, and its lines wrap: the words are looked for on the whole screen.
        const screen = (await onScreen(x)).replace(/\s+/g, " ");
        return want(/Choose the text style|Claude Code/.exec(screen)?.[0] ?? `(not on the screen: ${screen.slice(0, 120)})`, /Choose the text style|Claude Code/);
      });
      await x.check("ai-start: how it signs in, beside it", async () => want(await P(x).text("#ai-top .ai-line"), "Claude Code. It uses the key in the vault."));
      await x.check("ai-start: under the plan", async () => want(await P(x).eval(`document.querySelector("#ai-term").getBoundingClientRect().top >= document.querySelector("#plan-box").getBoundingClientRect().bottom - 1`), true));
      await x.check("ai-start: the next action", async () => {
        const g = await guideNow(x);
        want(`${g.stage}: ${g.button}`, "Plan: Go to your AI");
        want(g.text, /^Tell your AI what you want to build, in its terminal under your plan, in your own words\./);
        return want(g.pinkIsButton, true);
      });
      await noOverflow(x, "the AI, running");
      await x.shot("ai-running");
    });
  },

  // The terminal and the keyboard: every key goes to Claude Code, and Ctrl + ] leaves it.
  async "kbd-terminal"(x) {
    return x.check("kbd-terminal", async () => {
      await focusOn(x, '#guide [data-action="focus-ai"]');
      await P(x).key("Enter");
      await sleep(300);
      await x.check("kbd-terminal: Go to your AI puts the keyboard in the terminal", async () => want(await inTerm(x), true));
      await P(x).key("Tab");
      await sleep(200);
      await x.check("kbd-terminal: Tab stays in it, for Claude Code", async () => want(await inTerm(x), true));
      await P(x).key("]", { ctrl: true });
      await sleep(300);
      await x.check("kbd-terminal: Ctrl + ] leaves it", async () => {
        want(await inTerm(x), false);
        return want(await P(x).focused(), 'button "Stop your AI"');
      });
      await x.check("kbd-terminal: the line under it says so", async () => want(await P(x).text("#ai .ai-keys"), "Every key goes to Claude Code. To leave its terminal with the keyboard: Ctrl + ]"));
    });
  },

  // The terminal's refusals, from a browser (D76): a wrong token, and another origin to which the browser sends the panel's cookie.
  async "terminal-refusals"(x) {
    return x.check("terminal-refusals", async () => {
      const app = x.newApp;
      const host = new URL(URL_).host;
      await x.check("terminal-refusals: the control, the page's own terminal, open", async () => want(await P(x).text("#ai-top .ai-line"), /^Claude Code\./));
      await x.check("terminal-refusals: from the panel's own page, with a wrong token", async () => {
        await P(x).eval(OPEN(`ws://${host}/api/terminal/${app}`, "x".repeat(43)));
        await P(x).waitFor("window.__t.closed !== null", { what: "the socket to close", timeout: 10000 });
        return want(`${await P(x).eval("window.__t.ready")} ${await P(x).eval("window.__t.closed")}`, "null 4401");
      });
      // By the fallback address, the test copy's own page shares the panel's
      // host, and the browser sends it the panel's cookie: only the Origin tells them apart.
      const other = await openPage(x.browser.port, x.cfg);
      try {
        await other.goto(`${LOCAL}/sign-in`);
        await other.click("#password");
        await other.type(x.password);
        await other.key("Enter");
        await other.waitFor(`location.pathname === "/"`, { what: "signed in by the fallback address", timeout: 10000 });
        const port = (await x.api("app.get", { app })).result.ports.testCopy;
        await other.goto(`http://localhost:${port}/`);
        await x.check("terminal-refusals: from the test copy's own page, which the browser sends the panel's cookie", async () => {
          await other.eval(OPEN(`ws://localhost:${new URL(URL_).port}/api/terminal/${app}`, "x".repeat(43)));
          await other.waitFor("window.__t.closed !== null", { what: "the socket to close", timeout: 10000 });
          return want(`${await other.eval("window.__t.ready")} ${await other.eval("window.__t.closed")}`, "null 1006");
        });
      } finally {
        await other.close().catch(() => {});
      }
      await sleep(500);
      await x.check("terminal-refusals: the page's own terminal, still open", async () => want(await P(x).text("#ai-top .ai-line"), /^Claude Code\./));
    });
  },

  async "kbd-dialog-stop-ai"(x) {
    await openApp(x, x.newApp);
    await planSide(x);
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-stop-ai", {
      open: async () => { await focusMust(x, '#ai-top [data-action="stop-ai"]'); await P(x).key("Enter"); },
      opener: '#ai-top [data-action="stop-ai"]',
      first: 'button "Keep it running"',
    });
  },

  async "ai-stop"(x) {
    return x.check("ai-stop", async () => {
      await openApp(x, x.newApp);
      await planSide(x);
      await P(x).click('#ai-top [data-action="stop-ai"]');
      await P(x).waitFor(`!document.querySelector("#modal").hidden`, { what: "the confirmation" });
      await x.check("ai-stop: the confirmation", async () => want(await P(x).text("#dialog"), /^Stop your AI\? Claude Code stops, and its container goes\. What it made stays in the test copy, and its conversations are kept\./));
      await P(x).click('#dialog [data-action="confirm-stop-ai"]');
      await x.check("ai-stop: it stops", async () => {
        await P(x).waitFor(`!!document.querySelector('input[name="ai-sign-in"]')`, { what: "the choices back", timeout: 120000 });
        want((await x.api("agent.status", { app: x.newApp })).result.running, false);
        return "the engine says it is not running";
      });
      await x.check("ai-stop: its terminal gone, the choices back", async () => {
        want(await P(x).eval(`!!document.querySelector("#ai-term .xterm") || document.querySelector("#ai").classList.contains("on")`), false);
        return radios(x);
      });
      await x.check("ai-stop: the next action, to start it again", async () => {
        const g = await guideNow(x);
        want(`${g.stage}: ${g.button}`, "Plan: Start your AI");
        return want(g.pinkIsButton, true);
      });
      await noOverflow(x, "the AI, stopped");
      await x.shot("ai-stopped");
    });
  },

  async "sign-out"(x) {
    return x.check("sign-out", async () => {
      await openMenuIfNeeded(x);
      await P(x).click("#sign-out");
      await P(x).waitFor(`location.pathname === "/sign-in"`, { what: "the sign-in page" });
      await P(x).goto(`${URL_}/apps/${APP}`);
      want(await P(x).eval("location.pathname"), "/sign-in");
      x.expectedNetwork.push({ path: "/api/session", status: 401, why: "the session asked for after signing out" });
      want((await P(x).eval(`fetch("/api/session").then((r) => r.status)`)), 401);
      await noOverflow(x, "sign-in page");
      return "signed out: an app's page sends the browser to /sign-in";
    });
  },

  async "sign-in-refused"(x) {
    return x.check("sign-in-refused", async () => {
      if (!(await P(x).eval(`location.pathname === "/sign-in"`))) await P(x).goto(`${URL_}/sign-in`);
      await P(x).click("#password");
      await P(x).type("not the password at all");
      x.expectedNetwork.push({ path: "/api/sign-in", status: 403, why: "the wrong password typed" });
      await P(x).key("Enter");
      await P(x).waitFor(`!document.querySelector("#error").hidden`, { what: "a refusal", timeout: 8000 }).catch(() => {});
      want(await P(x).text("#error"), "That is not the password.");
      want(await P(x).eval(`document.activeElement.id`), "error");
      await x.shot("sign-in-refused");
      return "in plain words, and focus on them";
    });
  },

  async "sign-in"(x) {
    return x.check("sign-in", async () => {
      if (!(await P(x).eval(`location.pathname === "/sign-in"`))) await P(x).goto(`${URL_}/sign-in`);
      await P(x).eval(`document.querySelector("#password").value = ""`);
      await P(x).click("#password");
      await P(x).type(x.password);
      await P(x).key("Enter");
      await P(x).waitFor(`location.pathname === "/" && !!document.querySelector("#main .head")`, { what: "home, signed in", timeout: 10000 });
      return "the password, Enter: home";
    });
  },

  async "no-console-errors"(x) {
    return x.check("no-console-errors", async () => {
      // A refusal a check asked for is logged by the browser as a failed request: those, and only those, are expected.
      const unexplained = P(x).log.network.filter((n) => !x.expectedNetwork.some((e) => n.url.endsWith(e.path) && n.text.includes(`status of ${e.status} `)));
      want([...P(x).log.errors, ...unexplained.map((n) => `network: ${n.text} (${n.url})`)].join(" / ") || "none", "none");
      return `none${P(x).log.network.length ? `; the refusals the checks asked for: ${x.expectedNetwork.map((e) => `${e.status} from ${e.path} (${e.why})`).join(", ")}` : ""}`;
    });
  },

  // No request to another origin (rule 15), but the Preview frame's own: the test copy, at the apps' host, in its frame.
  async "no-other-origins"(x) {
    return x.check("no-other-origins", async () => {
      const panel = new URL(URL_).origin;
      const apps = x.appsHost ?? (await x.api("app.get", { app: APP }).catch(() => null))?.result?.appsHost ?? "localhost";
      const others = P(x).log.requests.filter((r) => {
        if (r.url.startsWith("data:") || r.url.startsWith(`${panel}/`)) return false;
        return r.main || new URL(r.url).hostname !== apps;
      });
      return want(others.map((r) => r.url).join(", ") || "none", "none");
    });
  },
};
function note(t) { console.log(`        ${t}`); }

/* ------------------------------------------------------------- preps -- */
let planCount = 0;
/** A new plan of `n` built steps, none tried, as the builder would leave it. */
async function freshPlan(x, n = 2) {
  planCount += 1;
  x.label = `${x.cfgName.replace("-", ", ")} ${planCount}${randomBytes(2).toString("hex")}`;
  note(onHost("plan", APP, String(n), x.label));
}
async function allTried(x) {
  const plan = (await x.api("app.plan", { app: APP })).result;
  for (const s of plan.steps.filter((t) => t.state === "ready")) await x.api("app.markTried", { app: APP, step: s.id });
  note(`every step of the plan marked tried, through the engine (${plan.steps.length})`);
}
async function released(x) {
  await freshPlan(x, 2);
  await allTried(x);
  const job = (await x.api("app.putLive", { app: APP })).result.job;
  for (;;) {
    const j = (await x.api("job.get", { job })).result;
    if (j.state === "finished") { note(`put live through the engine, for the checks that need a way back: ${j.ok ? "ok" : "FAILED"}`); if (!j.ok) throw new Error("the release for the preparation failed"); return; }
    await sleep(1500);
  }
}

/* --------------------------------------------------------------- runs -- */
const FULL = ["setup", "app", "fresh-plan", "home", "kbd-skip", "machine", "app-view", "frame-text", "kbd-tabs", "kbd-dialog-report", "report", "guided", "kbd-menu", "kbd-dialog-backups", "refusal-untried", "refusal-backup", "lock-refusal", "put-live", "backups", "kbd-dialog-goback", "go-back",
  // D83: going back with the data (from a new release, over an entry written since), then work outside a plan, then service keys.
  "released", "entry", "kbd-dialog-data", "data-back", "unplanned", "kbd-dialog-outside", "outside-plan", "kbd-dialog-keys", "keys",
  "kbd-dialog-new-app", "new-app", "ai-start", "kbd-terminal", "terminal-refusals", "kbd-dialog-stop-ai", "ai-stop",
  // D83: removing the app the run made, in its settings.
  "kbd-dialog-settings", "kbd-dialog-remove", "remove-app",
  "sign-out", "sign-in-refused", "sign-in", "no-console-errors", "no-other-origins"];

// Each broken copy, where it is tried, the checks it must make fail, and what runs.
const DIALOGS = ["kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback", "kbd-dialog-data", "kbd-dialog-outside", "kbd-dialog-keys", "kbd-dialog-new-app", "kbd-dialog-stop-ai", "kbd-dialog-settings", "kbd-dialog-remove"];
const EVERY_DIALOG = ["setup", "app", "released", "kbd-dialog-data", "unplanned", "kbd-dialog-outside", "kbd-dialog-keys", "fresh-plan", "app-view", "kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback", "kbd-dialog-new-app", "new-app", "ai-start", "kbd-dialog-stop-ai", "ai-stop", "kbd-dialog-settings", "kbd-dialog-remove"];
const BROKEN = [
  ["console-error", "desktop-light", ["no-console-errors"], ["setup", "app", "home", "no-console-errors"]],
  ["other-origin", "desktop-light", ["no-other-origins"], ["setup", "app", "home", "no-other-origins"]],
  ["overflow", "phone-light", ["no-overflow"], ["setup", "app", "home"]],
  ["ai-overflow", "phone-light", ["no-overflow"], ["setup", "app", "fresh-plan", "app-view"]],
  ["setup-wrong-code", "desktop-light", ["setup"], ["setup"]],
  ["sign-out-fake", "desktop-light", ["sign-out"], ["setup", "sign-out"]],
  ["sign-in-silent", "desktop-light", ["sign-in-refused"], ["setup", "sign-out", "sign-in-refused"]],
  ["sign-in-stays", "desktop-light", ["sign-in"], ["setup", "sign-out", "sign-in"]],
  ["home-no-action", "desktop-light", ["home"], ["setup", "app", "fresh-plan", "home"]],
  ["dot-wide", "desktop-light", ["home"], ["setup", "app", "home"]],
  ["machine-stale", "desktop-light", ["machine"], ["setup", "machine"]],
  ["no-skip", "desktop-light", ["kbd-skip"], ["setup", "kbd-skip"]],
  ["frame-wrong", "desktop-light", ["app-view"], ["setup", "app", "fresh-plan", "app-view"]],
  ["frame-reload", "desktop-light", ["frame-text"], ["setup", "app", "fresh-plan", "app-view", "frame-text"]],
  ["no-arrows", "desktop-light", ["kbd-tabs"], ["setup", "app", "fresh-plan", "app-view", "kbd-tabs"]],
  ["no-arrows", "phone-light", ["kbd-tabs"], ["setup", "app", "fresh-plan", "app-view", "kbd-tabs"]],
  ["menu-no-focus", "desktop-light", ["kbd-menu"], ["setup", "app", "fresh-plan", "app-view", "kbd-menu"]],
  ["report-lost", "desktop-light", ["report"], ["setup", "app", "fresh-plan", "app-view", "report"]],
  ["works-noop", "desktop-light", ["guided"], ["setup", "app", "fresh-plan", "app-view", "guided"]],
  ["guide-stuck", "desktop-light", ["guided"], ["setup", "app", "fresh-plan", "app-view", "guided"]],
  ["stop-mute", "desktop-light", ["refusal-untried", "refusal-backup"], ["setup", "app", "fresh-plan", "app-view", "guided", "refusal-untried", "refusal-backup"]],
  ["lock-silent", "desktop-light", ["lock-refusal"], ["setup", "app", "fresh-plan", "all-tried", "lock-refusal"]],
  ["gates-frozen", "desktop-light", ["put-live"], ["setup", "app", "fresh-plan", "all-tried", "put-live"]],
  ["backups-empty", "desktop-light", ["backups"], ["setup", "app", "backups"]],
  ["no-trap", "desktop-light", DIALOGS, EVERY_DIALOG],
  ["no-escape", "desktop-light", DIALOGS, EVERY_DIALOG],
  ["no-focus-return", "desktop-light", DIALOGS, EVERY_DIALOG],
  ["go-back-noop", "desktop-light", ["go-back"], ["setup", "app", "released", "go-back"]],
  ["new-app-noop", "desktop-light", ["new-app"], ["setup", "app", "new-app"]],
  ["ai-start-noop", "desktop-light", ["ai-start"], ["setup", "app", "new-app", "ai-start"]],
  ["no-leave", "desktop-light", ["kbd-terminal"], ["setup", "app", "new-app", "ai-start", "kbd-terminal", "ai-stop"]],
  ["ws-any-origin", "desktop-light", ["terminal-refusals"], ["setup", "app", "new-app", "ai-start", "terminal-refusals", "ai-stop"]],
  ["ws-no-token", "desktop-light", ["terminal-refusals"], ["setup", "app", "new-app", "ai-start", "terminal-refusals", "ai-stop"]],
  ["ai-stop-noop", "desktop-light", ["ai-stop"], ["setup", "app", "new-app", "ai-start", "ai-stop"]],
  // The eighth brief's (item 5, D83).
  ["keys-kept", "desktop-light", ["keys"], ["setup", "app", "keys"]],
  ["keys-noop", "desktop-light", ["keys"], ["setup", "app", "keys"]],
  ["keys-no-remove", "phone-light", ["keys"], ["setup", "app", "keys"]],
  ["keys-focus-remove", "desktop-light", ["keys"], ["setup", "app", "keys"]],
  ["ungated", "desktop-light", ["data-back", "remove-app"], ["setup", "app", "released", "entry", "data-back", "new-app", "remove-app"]],
  ["data-silent", "desktop-light", ["data-back"], ["setup", "app", "released", "entry", "data-back"]],
  ["data-pink", "phone-light", ["data-back"], ["setup", "app", "released", "entry", "data-back"]],
  ["data-noop", "desktop-light", ["data-back"], ["setup", "app", "released", "entry", "data-back"]],
  ["outside-always", "desktop-light", ["refusal-untried"], ["setup", "app", "fresh-plan", "app-view", "guided", "refusal-untried"]],
  ["outside-noop", "desktop-light", ["outside-plan"], ["setup", "app", "released", "unplanned", "outside-plan"]],
  ["remove-noop", "desktop-light", ["remove-app"], ["setup", "app", "new-app", "remove-app"]],
  ["remove-silent", "phone-light", ["remove-app"], ["setup", "app", "new-app", "remove-app"]],
];

async function runOne(browser, name, cfgName, targets, sequence) {
  const x = new Run(name, cfgName, targets, browser);
  x.page = await openPage(browser.port, CONFIGS[cfgName]);
  try {
    for (const item of sequence) {
      if (item === "app") note(onHost("app", APP));
      else if (item === "fresh-plan") await freshPlan(x, 2);
      else if (item === "all-tried") await allTried(x);
      else if (item === "released") { await released(x); x.stale = true; }
      else if (item === "entry") { note(onHost("entry", APP)); x.stale = true; }
      else if (item === "unplanned") { note(onHost("unplanned", APP)); x.stale = true; }
      else {
        if (["refusal-backup", "put-live", "lock-refusal"].includes(item)) x.liveBefore = (await x.api("app.get", { app: APP })).result?.live;
        await CHECKS[item](x);
      }
    }
  } catch (error) {
    if (!(error instanceof Stop)) {
      x.results.push({ id: "(the run)", ok: false, target: false, why: error.message });
      console.log(`  STOPPED: ${error.message}`);
      await x.shot("stopped").catch(() => {});
    }
  } finally {
    await x.page.close().catch(() => {});
    // The apps this run made, and their AIs, gone: no name is left to collide.
    if (x.made.length) {
      try {
        note(onHost("remove", ...x.made));
      } catch (error) {
        x.results.push({ id: "(removing what the run made)", ok: false, target: false, why: error.message });
        console.log(`  NOT REMOVED: ${error.message}`);
      }
    }
  }
  return x;
}

const browser = await launch();
const summary = [];
let bad = 0;
try {
  const pushed = harness("push", "test/host/panel-fixture.mjs", "/root/");
  if (pushed.status !== 0) throw new Error(`push: ${pushed.stderr}`);
  const only = opt("--broken", null);
  const broken = only === "none" ? [] : only ? BROKEN.filter(([v]) => only.split(",").includes(v)) : BROKEN;
  if (broken.length) console.log("\nEach check, seen failing on a deliberately broken copy of the panel");
  for (const [variant, cfgName, targets, sequence] of broken) {
    console.log(`\n${variant} (${cfgName}): it must make ${targets.join(", ")} fail`);
    note(onHost("break", variant));
    let x;
    try {
      x = await runOne(browser, `broken-${variant}-${cfgName}`, cfgName, targets, sequence);
    } finally {
      note(onHost("mend"));
    }
    for (const t of targets) {
      const failed = x.results.some((r) => !r.ok && (r.id === t || r.id.startsWith(`${t}:`)));
      const wrong = x.results.filter((r) => !r.ok && !r.target);
      const verdict = failed && !wrong.length ? "seen failing" : failed ? `seen failing, but ${wrong.map((r) => r.id).join(", ")} failed too` : "NOT seen failing";
      if (verdict !== "seen failing") bad += 1;
      summary.push(`broken ${variant} (${cfgName}): ${t}: ${verdict}`);
    }
  }

  const configs = opt("--configs", null);
  const real = configs === "none" ? [] : configs ? configs.split(",") : Object.keys(CONFIGS);
  if (real.length) console.log("\nEvery check, on the real panel");
  for (const cfgName of real) {
    console.log(`\n${cfgName}:`);
    const x = await runOne(browser, `real-${cfgName}`, cfgName, [], FULL);
    const failed = x.results.filter((r) => !r.ok);
    if (failed.length) bad += 1;
    summary.push(`real (${cfgName}): ${x.results.filter((r) => r.ok).length} passed${failed.length ? `, FAILED: ${failed.map((r) => r.id).join(", ")}` : ""}`);
  }
} finally {
  await browser.close();
}
console.log(`\nSummary:\n  ${summary.join("\n  ")}\n${bad ? `${bad} NOT as they should be.` : "All as they should be."} Screenshots: ${OUT}`);
process.exitCode = bad ? 1 : 0;
