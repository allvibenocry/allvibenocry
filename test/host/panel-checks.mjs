// The control panel's browser checks, on the test host (the sixth brief, item
// 10): at desktop and phone widths, light and dark; signing in and out, every
// flow of the first slice, every refusal; no console errors, no request to
// another origin, nothing wider than the screen; the keyboard in every dialog
// and tab list. Each check is first seen failing on a deliberately broken copy
// of the panel (panel-fixture.mjs break), then passing on the real one.
//
//   node test/host/panel-checks.mjs <folder for screenshots> [--url http://localhost:8099] [--app moods]
//        [--broken <variant,...>|none] [--configs <name,...>|none]
//
// Run from the product repository on the workstation, on a fresh test host
// (test/host/README.md). It signs in with fresh setup codes and a password it
// makes up and keeps in memory; neither is printed.
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
  process.stderr.write("usage: node test/host/panel-checks.mjs <folder for screenshots> [--url ...] [--app moods] [--broken <variant,...>|none] [--configs <name,...>|none]\n");
  process.exit(2);
}

const CONFIGS = {
  "desktop-light": { width: 1280, height: 800, mobile: false, scheme: "light" },
  "desktop-dark": { width: 1280, height: 800, mobile: false, scheme: "dark" },
  "phone-light": { width: 390, height: 844, mobile: true, scheme: "light" },
  "phone-dark": { width: 390, height: 844, mobile: true, scheme: "dark" },
};

/* ------------------------------------------------------------ the host -- */
const harness = (...a) => spawnSync("node", ["test/host/host.mjs", ...a], { encoding: "utf8" });
function onHost(...a) {
  const r = harness("exec", "--", "node", "/root/panel-fixture.mjs", ...a);
  if (r.status !== 0) throw new Error(`on the test host, panel-fixture ${a.join(" ")}: ${(r.stderr || r.stdout).trim().slice(-600)}`);
  return r.stdout.trim();
}

/* ------------------------------------------------------------- a run -- */
class Stop extends Error {}
const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
function want(seen, wanted) {
  const good = typeof wanted === "function" ? wanted(seen) : wanted instanceof RegExp ? wanted.test(String(seen)) : String(seen) === String(wanted);
  if (!good) throw new Error(`seen: ${String(seen).replace(/\s+/g, " ").slice(0, 200)} | wanted: ${wanted instanceof RegExp ? wanted : typeof wanted === "function" ? "(a condition)" : wanted}`);
  return seen;
}

class Run {
  constructor(name, cfgName, targets = []) {
    this.name = name;
    this.cfgName = cfgName;
    this.cfg = CONFIGS[cfgName];
    this.targets = targets;
    this.results = [];
    this.expectedNetwork = [];
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
      await this.shot(`${target ? "fails" : "wrong"}-${id.replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
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
async function openApp(x) {
  if (!(await P(x).eval(`location.pathname === "/apps/${APP}" && !!document.querySelector("#tryline")`))) {
    await P(x).goto(`${URL_}/apps/${APP}`);
    await P(x).waitFor(`!!document.querySelector("#tryline")`, { what: "the app view" });
  }
}
const focusOn = (x, sel) => P(x).eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.focus(); return document.activeElement === el; })()`);
const focusedIs = (x, sel) => P(x).eval(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`);
const inDialog = (x) => P(x).eval(`document.querySelector("#dialog").contains(document.activeElement)`);
const modalOpen = (x) => P(x).eval(`!document.querySelector("#modal").hidden`);
async function closeAnyDialog(x) {
  if (await modalOpen(x)) await P(x).click('#dialog [data-action="close"]').catch(() => {});
  if (await modalOpen(x)) await P(x).eval(`document.querySelector("#modal").hidden = true`);
}
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

/** Nothing wider than the screen: the page, and every part of it that scrolls on its own. */
async function noOverflow(x, where) {
  return x.check(`no-overflow: ${where}`, async () => {
    const found = await P(x).eval(`(() => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      if (document.documentElement.scrollWidth > vw + 1) out.push("the page is " + document.documentElement.scrollWidth + " px wide in a " + vw + " px screen");
      for (const el of document.querySelectorAll(".pane, .lpane, .dialog, .nav, .every, .plan, .status-row, .apps")) {
        if (el.getClientRects().length && el.scrollWidth > el.clientWidth + 1) out.push((el.id ? "#" + el.id : "." + el.classList[0]) + " is " + el.scrollWidth + " px wide inside " + el.clientWidth);
      }
      return out.join("; ");
    })()`);
    want(found, "");
    return `${x.cfg.width} px, nothing wider`;
  });
}

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
      await x.check("home: the status line", async () => want(await P(x).text(".status-row"), /^(No problems found\.|\d+ things? needs? you\.|The nightly checks have not run yet\.) .*Machine health$/));
      await x.check("home: the app's card", async () => want(await P(x).text(".app-card"), new RegExp(`^${APP} (v\\d+ is live|Not live yet) `)));
      await x.check("home: its next action", async () => want(await P(x).text(".app-card .card-foot .btn"), next));
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
      await P(x).waitFor(`location.pathname === "/apps/${APP}" && !!document.querySelector("#tryline")`, { what: "the app view" });
      const plan = (await x.api("app.plan", { app: APP })).result;
      const detail = (await x.api("app.get", { app: APP })).result;
      const ready = plan.steps.find((s) => s.state === "ready");
      const tried = plan.steps.filter((s) => s.state === "tried").length;
      await x.check("app-view: the try line", async () => {
        const t = await P(x).text("#tryline");
        if (plan.state !== "plan" || plan.releasedIn) return want(t, /^Nothing is in progress\./);
        if (ready && tried === plan.steps.indexOf(ready)) return want(t, `Step ${ready.id} is ready. Try it: ${ready.check} It works Something is wrong`);
        if (tried === plan.steps.length) return want(t, new RegExp(`^All ${plan.steps.length} steps are tried\\.`));
        return want(t, /^Building step \d+:/);
      });
      if (plan.state === "plan" && !plan.releasedIn) await x.check("app-view: the plan", async () => want(await P(x).eval(`[...document.querySelectorAll("#plan-box .plan-top > *")].map((e) => e.textContent).join(" | ")`), `Plan: ${lc(plan.title)} | ${tried} of ${plan.steps.length} tried`));
      await x.check("app-view: the line above the frame", async () => want(await P(x).text(".fbar"), /^Test copy (Try anything here\. The live app is not touched\. )?Restart the test copy$/));
      await x.check("app-view: the test copy, in the frame", async () => {
        const src = await P(x).eval(`document.querySelector(".tc-frame")?.src ?? ""`);
        const expected = `http://localhost:${detail.ports.testCopy}/`;
        const until = Date.now() + 15000;
        while (!P(x).log.frames.some((f) => f.url === expected) && Date.now() < until) await sleep(300);
        const f = P(x).log.frames.find((r) => r.url === expected);
        return want(f ? `${src} ${f.status}` : `${src} (no answer from ${expected})`, `${expected} 200`);
      });
      await sleep(800);
      await noOverflow(x, "the app, Preview");
      await x.shot("app-preview");
      if (x.cfg.mobile) {
        await tab(x, "chat");
        await x.check("app-view: the plan, on a phone, behind its tab", async () => want(await P(x).text(".later-note"), /^Talking to your AI here comes in a later version of this panel\./));
        await noOverflow(x, "the app, Plan");
        await x.shot("app-plan");
        await tab(x, "preview");
      } else {
        await x.check("app-view: the note about the chat", async () => want(await P(x).text(".later-note"), /^Talking to your AI here comes in a later version of this panel\./));
      }
    });
  },

  async "kbd-tabs"(x) {
    return x.check("kbd-tabs", async () => {
      await openApp(x);
      const list = x.cfg.mobile ? "#mtabs" : "#rtabs";
      const names = await P(x).eval(`[...document.querySelectorAll("${list} [role=tab]")].map((t) => t.id)`);
      const selected = () => P(x).eval(`[...document.querySelectorAll("${list} [role=tab]")].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.id).join(",")`);
      const shown = () => P(x).eval(`(() => { const r = document.querySelector("#rpane"); const l = document.querySelector("#lside"); return (r.getClientRects().length && r.closest(".right").getClientRects().length ? (r.querySelector(".tryline") ? "preview" : "live") : "") + (l.getClientRects().length ? "+plan" : ""); })()`);
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
    await openApp(x);
    await tab(x, "preview");
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-report", {
      open: async () => { await focusOn(x, '[data-action="report"]'); await P(x).key("Enter"); },
      opener: '[data-action="report"]',
      first: /^textarea "/,
    });
  },

  async report(x) {
    return x.check("report", async () => {
      await openApp(x);
      await tab(x, "preview");
      const tag = randomBytes(4).toString("hex");
      await P(x).click('[data-action="report"]');
      await P(x).waitFor(`document.activeElement?.id === "report-text"`, { what: "the report dialog" });
      const step = await P(x).eval(`document.querySelector("#dialog-title").textContent.match(/step (\\d+)/)[1]`);
      await P(x).type(`The weather box is empty (${tag}).`);
      await P(x).click('#report-form button[type="submit"]');
      await P(x).waitFor(`document.querySelector("#modal").hidden && !!document.querySelector("#toast.show")`, { what: "the dialog closed, a toast", timeout: 8000 });
      await x.check("report: the toast", async () => want(await P(x).text("#toast"), "Saved with the app. Tell your AI in its own session to read it."));
      await x.check("report: kept in the project, on the test host", async () => want(onHost("report", APP), new RegExp(`Step ${step}: The weather box is empty \\(${tag}\\)\\.`)));
    });
  },

  async works(x) {
    return x.check("works", async () => {
      await openApp(x);
      await tab(x, "preview");
      const before = (await x.api("app.plan", { app: APP })).result;
      const ready = before.steps.filter((s) => s.state === "ready");
      want(ready.length, (n) => n >= 1);
      for (const [i, s] of ready.entries()) {
        const triedBefore = before.steps.filter((t) => t.state === "tried").length + i;
        if (i % 2 === 0) {
          await P(x).click(`[data-action="works"][data-step="${s.id}"]`);
        } else {
          // The next by keyboard: after the last one, focus is on the try line; Tab reaches "It works".
          await P(x).key("Tab");
          want(await P(x).focused(), /It works/);
          await P(x).key("Enter");
        }
        await x.check(`works: step ${s.id}, ${i % 2 ? "by keyboard" : "with the mouse"}`, async () => {
          await P(x).waitFor(`document.querySelector("#plan-box .plan-top .muted")?.textContent === "${triedBefore + 1} of ${before.steps.length} tried"`, { what: `${triedBefore + 1} of ${before.steps.length} tried`, timeout: 8000 });
          return want(await P(x).eval(`[...document.querySelectorAll("#plan-box li")][${before.steps.indexOf(s)}].textContent.trim()`), `${s.title}, tried by you`);
        });
      }
      await x.check("works: every step tried", async () => want(await P(x).text("#tryline"), new RegExp(`^All ${before.steps.length} steps are tried\\. Go to Live when you want everyone to get v\\d+\\. Go to Live$`)));
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
        await P(x).key("ArrowDown");
        want(await P(x).focused(), /^button "Backups/);
        await P(x).key("Escape");
        await sleep(150);
        want(await P(x).eval(`document.querySelector("#more-menu").hidden`), true);
        want(await focusedIs(x, "#more-btn"), true);
        return "Enter opens it on its first item; Escape closes it, back on More";
      } finally {
        if (!(await P(x).eval(`document.querySelector("#more-menu").hidden`))) await P(x).click("#more-btn");
      }
    });
  },

  async "kbd-dialog-backups"(x) {
    await openApp(x);
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-backups", {
      open: async () => { await focusOn(x, "#more-btn"); await P(x).key("Enter"); await sleep(150); await P(x).key("Enter"); },
      opener: "#more-btn",
      first: 'button "Close"',
    });
  },

  async "refusal-untried"(x) {
    return x.check("refusal-untried", async () => {
      await openApp(x);
      const plan = (await x.api("app.plan", { app: APP })).result;
      want(`${plan.steps.length} steps, ${plan.steps.filter((s) => s.state === "tried").length} tried`, "2 steps, 2 tried");
      await tab(x, "live");
      await P(x).waitFor(`!!document.querySelector('[data-action="put-live"]')`, { what: "Put vN live" });
      // The builder adds a step while the page shows every step tried; the page
      // does not refresh behind a dialog, so it still offers to put it live.
      await P(x).click("#more-btn");
      await P(x).click('[data-action="more-backups"]');
      await P(x).waitFor(`!!document.querySelector(".backups-list")`, { what: "the Backups dialog" });
      onHost("plan", APP, "3", x.label);
      await P(x).key("Escape");
      await P(x).waitFor(`document.querySelector("#modal").hidden`, { what: "the dialog closed" });
      const v = await P(x).eval(`document.querySelector('[data-action="put-live"]').dataset.v`);
      await P(x).click('[data-action="put-live"]');
      const card = await waitCard(x, /is not live|is live\./);
      await x.check("refusal-untried: the answer", async () => want(card.heading, `${v} is not live`));
      await x.check("refusal-untried: in plain words", async () => want(await P(x).text("#shipcard .stopbox"), new RegExp(`^Nothing changed\\. It stopped at "every step of the plan is tried by you": the plan ".*" has steps you have not tried: step 3, "Let the home town be changed" What would have to be true: .* Here: try each step in Preview and press "It works", then come back to Live\\.$`)));
      await x.check("refusal-untried: the checks", async () => want(await gateClasses(x), "failed,next,next,next,next,next"));
      await noOverflow(x, "the refusal");
      await x.shot("refusal-untried");
      await P(x).click('[data-action="dismiss-job"]');
      await tab(x, "preview");
      await P(x).waitFor(`/Step 3 is ready/.test(document.querySelector("#tryline")?.innerText)`, { what: "step 3 ready" });
      await P(x).click('[data-action="works"][data-step="3"]');
      await P(x).waitFor(`/All 3 steps are tried/.test(document.querySelector("#tryline").innerText)`, { what: "every step tried" });
    });
  },

  async "refusal-backup"(x) {
    return x.check("refusal-backup", async () => {
      await openApp(x);
      note(onHost("unplug"));
      try {
        await tab(x, "live");
        await P(x).waitFor(`!!document.querySelector('[data-action="put-live"]')`, { what: "Put vN live" });
        const v = await P(x).eval(`document.querySelector('[data-action="put-live"]').dataset.v`);
        await P(x).click('[data-action="put-live"]');
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
      await P(x).click('[data-action="dismiss-job"]');
    });
  },

  async "put-live"(x) {
    return x.check("put-live", async () => {
      await openApp(x);
      await tab(x, "live");
      await P(x).waitFor(`!!document.querySelector('[data-action="put-live"]')`, { what: "Put vN live" });
      const v = await P(x).eval(`document.querySelector('[data-action="put-live"]').dataset.v`);
      x.previous = (await x.api("app.get", { app: APP })).result.live;
      await P(x).click('[data-action="put-live"]');
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
        want(nows.length, (n) => n >= 4);
        return nows.join(" > ");
      });
      await x.check("put-live: every check done", async () => want(await gateClasses(x), "done,done,done,done,done,done"));
      await P(x).click("#shipcard .every-checks summary");
      await x.check("put-live: every check, as the machine ran it", async () => want(await P(x).eval(`document.querySelectorAll("#shipcard .every li.ok").length + " done, " + document.querySelectorAll("#shipcard .every li.failed").length + " stopped"`), /^1\d done, 0 stopped$/));
      await noOverflow(x, "live, every check open");
      await x.shot("live");
      await x.check("put-live: earlier versions, with the way back", async () => want(await P(x).text("#rpane .vers"), new RegExp(`^${v} just now .*Live now .*Go back to ${x.previous}`)));
      x.released = v;
    });
  },

  async backups(x) {
    return x.check("backups", async () => {
      await openApp(x);
      await P(x).click("#more-btn");
      await P(x).click('[data-action="more-backups"]');
      await P(x).waitFor(`!!document.querySelector(".backups-list")`, { what: "the Backups dialog" });
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
    const target = await P(x).eval(`document.querySelector('[data-action="go-back"]')?.dataset.v`);
    const live = (await x.api("app.get", { app: APP })).result.live;
    return CHECKS.dialogByKeyboard(x, "kbd-dialog-goback", {
      open: async () => { await focusOn(x, '[data-action="go-back"]'); await P(x).key("Enter"); },
      opener: '[data-action="go-back"]',
      first: `button "Keep ${live}"`,
      target,
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
      await x.check("go-back: it starts", async () => { await P(x).waitFor(`/^Going back to|^Back on|^Still on/.test(document.querySelector("#shipcard h2")?.textContent ?? "")`, { what: "the card going back", timeout: 10000 }); });
      const card = await waitCard(x, /^Back on|^Still on/);
      await x.check("go-back: the answer", async () => want(card.heading, `Back on ${target}.`));
      await x.check("go-back: every check done", async () => want(await gateClasses(x), "done,done,done,done,done,done"));
      await x.check("go-back: the live version, from the engine", async () => want((await x.api("app.get", { app: APP })).result.live, target));
      await noOverflow(x, "back");
      await x.shot("back");
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

  async "no-other-origins"(x) {
    return x.check("no-other-origins", async () => {
      const detail = (await x.api("app.get", { app: APP }).catch(() => null))?.result;
      const allowed = [new URL(URL_).origin, ...(detail ? [`http://localhost:${detail.ports.testCopy}`] : [])];
      const others = P(x).log.requests.filter((r) => !allowed.some((o) => r.url.startsWith(`${o}/`)) && !r.url.startsWith("data:"));
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
const FULL = ["setup", "home", "kbd-skip", "machine", "app-view", "kbd-tabs", "kbd-dialog-report", "report", "works", "kbd-menu", "kbd-dialog-backups", "refusal-untried", "refusal-backup", "put-live", "backups", "kbd-dialog-goback", "go-back", "sign-out", "sign-in-refused", "sign-in", "no-console-errors", "no-other-origins"];

// Each broken copy, where it is tried, and the checks it must make fail. In
// order: those that need no more than a plan with steps ready, then those that
// change what is live, then those that need a version to go back to.
const BROKEN = [
  ["console-error", "desktop-light", ["no-console-errors"], ["setup", "fresh-plan", "home", "no-console-errors"]],
  ["other-origin", "desktop-light", ["no-other-origins"], ["setup", "home", "no-other-origins"]],
  ["overflow", "phone-light", ["no-overflow"], ["setup", "home"]],
  ["setup-wrong-code", "desktop-light", ["setup"], ["setup"]],
  ["sign-out-fake", "desktop-light", ["sign-out"], ["setup", "sign-out"]],
  ["sign-in-silent", "desktop-light", ["sign-in-refused"], ["setup", "sign-out", "sign-in-refused"]],
  ["sign-in-stays", "desktop-light", ["sign-in"], ["setup", "sign-out", "sign-in"]],
  ["home-no-action", "desktop-light", ["home"], ["setup", "home"]],
  ["machine-stale", "desktop-light", ["machine"], ["setup", "machine"]],
  ["no-skip", "desktop-light", ["kbd-skip"], ["setup", "kbd-skip"]],
  ["frame-wrong", "desktop-light", ["app-view"], ["setup", "app-view"]],
  ["no-arrows", "desktop-light", ["kbd-tabs"], ["setup", "app-view", "kbd-tabs"]],
  ["no-arrows", "phone-light", ["kbd-tabs"], ["setup", "app-view", "kbd-tabs"]],
  ["menu-no-focus", "desktop-light", ["kbd-menu"], ["setup", "app-view", "kbd-menu"]],
  ["report-lost", "desktop-light", ["report"], ["setup", "app-view", "report"]],
  ["works-noop", "desktop-light", ["works"], ["setup", "app-view", "works"]],
  ["stop-mute", "desktop-light", ["refusal-untried", "refusal-backup"], ["setup", "fresh-plan", "app-view", "works", "refusal-untried", "refusal-backup"]],
  ["gates-frozen", "desktop-light", ["put-live"], ["setup", "app-view", "put-live"]],
  ["backups-empty", "desktop-light", ["backups"], ["setup", "fresh-plan", "app-view", "backups"]],
  ["no-trap", "desktop-light", ["kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback"], ["setup", "app-view", "kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback"]],
  ["no-escape", "desktop-light", ["kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback"], ["setup", "app-view", "kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback"]],
  ["no-focus-return", "desktop-light", ["kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback"], ["setup", "app-view", "kbd-dialog-report", "kbd-dialog-backups", "kbd-dialog-goback"]],
  ["go-back-noop", "desktop-light", ["go-back"], ["setup", "app-view", "go-back"]],
];

async function runOne(browser, name, cfgName, targets, sequence) {
  const x = new Run(name, cfgName, targets);
  x.page = await openPage(browser.port, CONFIGS[cfgName]);
  try {
    for (const item of sequence) {
      if (item === "fresh-plan") await freshPlan(x, 2);
      else if (item === "all-tried") await allTried(x);
      else if (item === "released") await released(x);
      else {
        if (item === "refusal-backup" || item === "put-live") x.liveBefore = (await x.api("app.get", { app: APP })).result?.live;
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
  let needRelease = true;
  for (const [variant, cfgName, targets, sequence] of broken) {
    let seq = sequence;
    // The dialog and going-back copies need a version to go back to, and a step ready: one release, then a fresh plan.
    if (targets.includes("kbd-dialog-goback") || targets.includes("go-back")) {
      if (needRelease) { seq = ["setup", "released", "fresh-plan", ...sequence.slice(1)]; needRelease = false; }
    }
    if (targets.includes("put-live")) seq = ["setup", "fresh-plan", "all-tried", ...sequence.slice(1)];
    console.log(`\n${variant} (${cfgName}): it must make ${targets.join(", ")} fail`);
    note(onHost("break", variant));
    let x;
    try {
      x = await runOne(browser, `broken-${variant}-${cfgName}`, cfgName, targets, seq);
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
    const x = await runOne(browser, `real-${cfgName}`, cfgName, [], ["setup", "fresh-plan", ...FULL.slice(1)]);
    const failed = x.results.filter((r) => !r.ok);
    if (failed.length) bad += 1;
    summary.push(`real (${cfgName}): ${x.results.filter((r) => r.ok).length} passed${failed.length ? `, FAILED: ${failed.map((r) => r.id).join(", ")}` : ""}`);
  }
} finally {
  await browser.close();
}
console.log(`\nSummary:\n  ${summary.join("\n  ")}\n${bad ? `${bad} NOT as they should be.` : "All as they should be."} Screenshots: ${OUT}`);
process.exitCode = bad ? 1 : 0;
