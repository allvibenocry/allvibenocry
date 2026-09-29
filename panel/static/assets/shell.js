// The control panel's first slice (the sixth brief, item 9): simple mode, in
// the demo's design, words and colours (D51, D55), with real data from the
// engine (D62). Home: the calm status line, the apps with their next action,
// machine health from the last nightly check. An app: its plan on the left,
// Preview (the real test copy) and Live on the right; "It works", "Something
// is wrong", "Put vN live" and "Go back", with every check as the machine ran
// it. More: the app's backups. No chat, no advanced mode, no code yet.
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const up = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const CHECK = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9.5l3.2 3.2L14 5.5" fill="none" stroke="#1B1530" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const WARN = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 4.5v6M9 13.5v.2" fill="none" stroke="#1B1530" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const STOP = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5 5l8 8M13 5l-8 8" fill="none" stroke="#1B1530" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const narrowMQ = matchMedia("(max-width:1080px)");

  let token = null;
  const S = { view: "home", app: null, apps: [], last: null, now: null, detail: null, plan: null, right: "preview", m: "preview", job: null, jobKind: null, jobApp: null, jobFor: null, moreOpen: false, checkedNow: false };

  /* ------------------------------------------------------------ talking -- */
  async function session() {
    const r = await fetch("/api/session", { credentials: "same-origin" });
    if (r.status === 401) {
      location.assign("/sign-in");
      return false;
    }
    token = (await r.json()).result.token;
    return true;
  }
  async function api(op, args = {}) {
    let r;
    try {
      r = await fetch(`/api/op/${op}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Allvibe-Token": token }, body: JSON.stringify(args) });
    } catch {
      return { ok: false, error: { code: "offline", message: "the panel did not answer. Is the machine on?" } };
    }
    if (r.status === 401) {
      location.assign("/sign-in");
      return { ok: false, error: { code: "signed_out", message: "Signed out." } };
    }
    try {
      return await r.json();
    } catch {
      return { ok: false, error: { code: "failed", message: "the panel answered something it could not read." } };
    }
  }

  /* ------------------------------------------------------------- helpers -- */
  const announce = (t) => { $("#announce").textContent = t; };
  let toastT;
  function toast(t) {
    const el = $("#toast");
    el.textContent = t;
    el.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("show"), 4200);
  }
  const when = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  };
  const hostUrl = (port) => `${location.protocol}//${location.hostname}:${port}/`;
  const nextV = (d) => `v${d.next?.version?.replace(/^v/, "") ?? Number((d.live ?? "v0").replace(/^v/, "")) + 1}`;
  const jobKey = (app) => `panel-job-${app}`;
  const remember = (app, value) => { try { if (value) sessionStorage.setItem(jobKey(app), JSON.stringify(value)); else sessionStorage.removeItem(jobKey(app)); } catch {} };
  const recalled = (app) => { try { return JSON.parse(sessionStorage.getItem(jobKey(app)) ?? "null"); } catch { return null; } };

  /* ------------------------------------------------------------- routing -- */
  function route() {
    const p = location.pathname;
    const m = /^\/apps\/([a-z][a-z0-9-]{1,29})$/.exec(p);
    if (p === "/machine") S.view = "machine";
    else if (m) { S.view = "app"; S.app = m[1]; }
    else S.view = "home";
    document.body.classList.toggle("appview", S.view === "app");
  }
  // An app's page is the only one whose policy lets it frame that app's test
  // copy (panel/server.mjs), so going into or out of an app loads the page.
  const appIn = (path) => /^\/apps\/([a-z][a-z0-9-]{1,29})$/.exec(path)?.[1] ?? null;
  function go(path, hash = "") {
    if (appIn(path) !== (S.view === "app" ? S.app : null)) { location.assign(path + hash); return; }
    closeMenu();
    S.moreOpen = false;
    if (location.pathname !== path) history.pushState(null, "", path);
    route();
    load().then(() => { window.scrollTo({ top: 0 }); $("#main").focus({ preventScroll: true }); });
  }
  window.addEventListener("popstate", () => {
    const was = S.view === "app" ? S.app : null;
    route();
    if ((S.view === "app" ? S.app : null) !== was) location.reload();
    else load();
  });

  /* ---------------------------------------------------------- loading -- */
  // `quiet`: the periodic look for what the builder changed, which renders
  // only when something did.
  async function load({ quiet = false } = {}) {
    const [apps, last] = await Promise.all([api("apps.list"), api("machine.lastNight")]);
    S.apps = apps.ok ? apps.result : [];
    S.last = last.ok ? last.result : null;
    if (S.view === "app") {
      const [detail, plan] = await Promise.all([api("app.get", { app: S.app }), api("app.plan", { app: S.app })]);
      if (!detail.ok) {
        S.detail = null;
        render(`<div class="head"><div><h1>There is no app called ${esc(S.app)}</h1><p class="muted">${esc(up(detail.error.message))}.</p></div></div><a class="btn line" href="/" data-link>Back home</a>`);
        return;
      }
      S.detail = detail.result;
      S.plan = plan.ok ? plan.result : null;
      const kept = recalled(S.app);
      if (!S.job && kept) {
        const job = await api("job.get", { job: kept.id });
        if (job.ok) { S.job = job.result; S.jobKind = kept.kind; S.jobApp = S.app; S.jobFor = kept.for; if (job.result.state === "running") poll(); }
        else remember(S.app, null);
      }
    }
    const sig = JSON.stringify([S.view, S.app, S.apps, S.last, S.view === "app" ? [S.detail, S.plan] : null]);
    if (quiet && sig === S.sig) return;
    S.sig = sig;
    render();
  }

  /* ------------------------------------------------------------ the side -- */
  // Green only for a live app that runs; a live app that does not is a problem, and says so first.
  const dotOf = (a) => (a.live && !a.prod?.running ? "down" : a.next?.kind === "try" || a.next?.kind === "put-live" ? "act" : a.next?.kind === "building" ? "work" : a.live ? "live" : "");
  const liveChip = (a) => (!a.live ? '<span class="chip idle">Not live yet</span>' : a.prod?.running ? `<span class="chip live">${esc(a.live)} is live</span>` : `<span class="chip stop">${esc(a.live)} is not running</span>`);
  function renderNav() {
    const item = (label, href, current, cls = "") => `<a href="${href}" data-link class="${cls}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
    let h = item("Home", "/", S.view === "home");
    h += '<p class="nav-group">Your apps</p>';
    for (const a of S.apps) {
      const d = dotOf(a);
      const sr = d === "act" ? '<span class="sr">, waiting for you</span>' : d === "work" ? '<span class="sr">, the builder is working</span>' : d === "down" ? '<span class="sr">, its live app is not running</span>' : "";
      h += item(`<span class="dot ${d || "idle"}"></span>${esc(a.name)}${sr}`, `/apps/${a.name}`, S.view === "app" && S.app === a.name, "nav-app");
    }
    if (!S.apps.length) h += '<p class="nav-empty">No apps yet.</p>';
    h += '<div class="nav-machine"><p class="nav-group">This machine</p>';
    h += item("Machine health", "/machine", S.view === "machine");
    h += "</div>";
    const nav = $("#nav");
    const had = nav.contains(document.activeElement) ? document.activeElement.getAttribute("href") : null;
    nav.innerHTML = h;
    if (had) nav.querySelector(`a[href="${had}"]`)?.focus();
    const st = $("#side-status");
    const problems = S.last?.problems ?? 0;
    // Nothing that has not run is green (friction log 3): neutral until the first night.
    st.className = `side-status${!S.last ? " none" : problems ? " stop" : S.last.warnings ? " warn" : ""}`;
    st.innerHTML = !S.last
      ? '<span class="led" aria-hidden="true"></span><span>The nightly checks have not run yet.</span>'
      : problems
        ? `<span class="led" aria-hidden="true"></span><span>${problems} thing${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} you. Machine health says what.</span>`
        : `<span class="led" aria-hidden="true"></span><span>No problems found. Last night's checks passed.</span>`;
  }
  function closeMenu() { $("#side").classList.remove("open"); $("#menu-btn").setAttribute("aria-expanded", "false"); }

  /* -------------------------------------------------------------- home -- */
  function nextButton(a) {
    const n = a.next ?? {};
    if (n.kind === "try") return `<a class="btn small pink" href="/apps/${a.name}" data-link>Try step ${n.step}</a>`;
    if (n.kind === "put-live") return `<a class="btn small pink" href="/apps/${a.name}#live" data-link>Put ${esc(n.version)} live</a>`;
    if (n.kind === "start-test-copy") return `<a class="btn small line" href="/apps/${a.name}" data-link>Start the test copy</a>`;
    return `<a class="btn small line" href="/apps/${a.name}" data-link>Open</a>`;
  }
  function workText(a) {
    const n = a.next ?? {};
    if (n.kind === "try") return `Step ${n.step} is ready for you to try.`;
    if (n.kind === "put-live") return `Every step is tried. ${esc(n.version)} can go live.`;
    if (n.kind === "building") return "The builder is working on the next step.";
    if (n.kind === "start-test-copy") return "Its test copy is not running.";
    if (n.kind === "fix-plan") return "Its plan cannot be read. Ask your AI to fix it.";
    return "Nothing is in progress. Tell your AI what to change next.";
  }
  function statusRow() {
    const l = S.last;
    if (!l) return '<div class="status-row none" role="status"><span class="led" aria-hidden="true"></span><b>The nightly checks have not run yet.</b><span class="facts-inline"><span class="fact">They run every night after the backups</span></span><a class="linkbtn" href="/machine" data-link>Machine health</a></div>';
    const ok = (id) => l.checks.find((c) => c.id === id)?.status === "ok";
    const facts = [];
    const backups = l.checks.filter((c) => c.id.startsWith("backup-"));
    if (backups.length && backups.every((c) => c.status === "ok")) facts.push("Last night's backups restored and checked");
    if (ok("recovery")) facts.push("Recovery key confirmed");
    if (ok("firewall")) facts.push("Apps kept off the home network");
    const head = l.problems ? `${l.problems} thing${l.problems === 1 ? "" : "s"} need${l.problems === 1 ? "s" : ""} you.` : "No problems found.";
    return `<div class="status-row${l.problems ? " stop" : l.warnings ? " warn" : ""}" role="status"><span class="led" aria-hidden="true"></span><b>${head}</b><span class="facts-inline">${facts.map((f) => `<span class="fact">${f}</span>`).join("")}<span class="fact">Checked ${when(l.at)}</span></span><a class="linkbtn" href="/machine" data-link>Machine health</a></div>`;
  }
  function viewHome() {
    const cards = S.apps.map((a) => {
      const chip = liveChip(a);
      return `<article class="app-card"><h3><a class="card-link" href="/apps/${a.name}" data-link>${esc(a.name)}</a></h3>${chip}<p class="muted">${a.plan?.title && !a.plan.releasedIn ? `${esc(a.plan.title)}. ` : ""}${workText(a)}</p><div class="card-foot"><span></span>${nextButton(a)}</div></article>`;
    }).join("");
    return `${statusRow()}
      <div class="head"><div><h1>Your apps</h1><p class="muted">On this machine, for everyone on your home network.</p></div></div>
      ${S.apps.length ? `<div class="apps">${cards}</div>` : '<div class="notice"><p><b>No apps yet.</b> Making a new app from here comes in a later version of this panel.</p></div>'}`;
  }

  /* ----------------------------------------------------------- machine -- */
  // What each of the doctor's checks is about, as a heading; its text says the rest.
  const CHECK_TITLES = {
    os: "The operating system", arch: "The processor", memory: "Memory", disk: "The computer's own disk", power: "Power",
    docker: "Docker", pools: "Docker's networks", ipv6: "IPv6", user: "The service user", dirs: "Folders", version: "The version",
    proxy: "The doors", firewall: "The firewall", "keys-at-boot": "Keys at start-up", engine: "The engine", panel: "The control panel",
    timer: "The nightly backup", target: "Backup disk", hostkey: "The key for restore tests", recovery: "Recovery key",
    overrides: "Test host settings", "overrides-unknown": "Test host settings",
  };
  const titleOf = (c) => (c.id.startsWith("backup-") ? `Backups of ${c.id.slice(7)}` : CHECK_TITLES[c.id] ?? c.id);
  function viewMachine() {
    const l = S.now ?? S.last;
    const words = { ok: "fine", problem: "a problem", warn: "worth a look", info: "for your information" };
    const icon = (s) => (s === "ok" ? `<span class="ico ok">${CHECK}</span>` : s === "problem" ? `<span class="ico stop">${STOP}</span>` : s === "warn" ? `<span class="ico warn">${WARN}</span>` : '<span class="ico info" aria-hidden="true">i</span>');
    const rows = l ? l.checks.map((c) => `<div class="check-row">${icon(c.status)}<div><h3>${esc(titleOf(c))}<span class="sr">: ${words[c.status] ?? c.status}</span></h3><p>${esc(c.text)}</p></div></div>`).join("") : "";
    const at = S.now ? "Checked just now." : l ? `The last nightly check, ${when(l.at)}.` : "";
    return `<div class="head"><div><h1>Machine health</h1><p class="muted">The same checks run every night. Here they are in plain words. ${at}</p></div><button type="button" class="btn small line" data-action="recheck">Run the checks again</button></div>
      ${l ? `<div class="quiet checks">${rows}</div>` : '<div class="notice"><p><b>The nightly checks have not run yet.</b> They run after the backups, every night. Run them now to see how the machine is.</p></div>'}`;
  }

  /* --------------------------------------------------------- the app view -- */
  const planOf = () => S.plan ?? { state: "no-test-copy", steps: [] };
  const triedCount = (p) => p.steps.filter((s) => s.state === "tried").length;
  const allTried = (p) => p.state === "plan" && !p.releasedIn && p.steps.length > 0 && p.steps.every((s) => s.state === "tried");
  const current = (p) => p.steps.find((s) => s.state !== "tried");
  const jobHere = () => S.job && S.jobApp === S.app;
  const running = () => jobHere() && S.job.state === "running";

  // The app view is drawn once per page (going into an app loads the page),
  // and after that only its parts are drawn again, each in its own box. The
  // Preview's frame has a box of its own that nothing redraws: it is replaced
  // only when the test copy itself is a new one (a new start, "Restart the
  // test copy") or stops, so what is half typed in it stays (friction log 5).
  function viewApp() {
    const d = S.detail;
    return `<div class="work" id="work" data-m="${S.m}" data-app="${esc(d.name)}">
      <section class="left" aria-label="Your plan">
        <div class="apphead" id="apphead"></div>
        <div class="mtabs" id="mtabs" role="tablist" aria-label="${esc(d.name)}"></div>
        <div class="lside" id="lside"><div class="lpane" id="lpane"></div></div>
      </section>
      <section class="right" aria-label="What you look at">
        <div class="rtabs" id="rtabs" role="tablist" aria-label="${esc(d.name)}"></div>
        <div class="pane" id="rpane" role="tabpanel" tabindex="-1">
          <div class="pview" id="preview-pane">
            <div class="pview-top" id="preview-top"></div>
            <section class="frame" id="preview-frame" aria-label="The test copy"><div class="fbar" id="fbar"></div><div class="frame-slot" id="frame-slot"></div></section>
          </div>
          <div class="pview" id="live-pane" hidden></div>
        </div>
      </section>
    </div>`;
  }
  function renderApp() {
    const d = S.detail;
    if ($("#work")?.dataset.app !== d.name) {
      $("#main").innerHTML = viewApp();
      frameKey = null;
    }
    const part = (id, html) => keepFocus($(`#${id}`), () => { $(`#${id}`).innerHTML = html; });
    part("apphead", headHTML(d));
    part("mtabs", [["chat", "Plan"], ["preview", "Preview"], ["live", "Live"]].map(([id, l]) => tabHTML("mtab", id, l, S.m === id, id === "chat" ? "lside" : "rpane")).join(""));
    part("rtabs", [["preview", "Preview"], ["live", "Live"]].map(([id, l]) => tabHTML("rtab", id, l, S.right === id, "rpane")).join(""));
    const lside = $("#lside");
    if (narrowMQ.matches) { lside.setAttribute("role", "tabpanel"); lside.setAttribute("aria-labelledby", "mtab-chat"); }
    else { lside.removeAttribute("role"); lside.removeAttribute("aria-labelledby"); }
    part("lpane", leftHTML());
    $("#work").dataset.m = S.m;
    renderRight();
  }
  // The test copy the frame was loaded for: its address, and which container since when.
  let frameKey = null;
  function syncFrame() {
    const d = S.detail;
    const slot = $("#frame-slot");
    const restarting = running() && S.jobKind === "startTestCopy";
    const up = d.testCopy?.running && !restarting;
    const src = hostUrl(d.ports.testCopy);
    const key = up ? `up ${src} ${d.testCopy.since ?? ""}` : `down ${restarting}`;
    if (key === frameKey && slot.firstChild) return;
    frameKey = key;
    if (!up) {
      slot.innerHTML = `<div class="tc-empty-frame"><p>${restarting ? "The test copy is starting. This takes a minute." : "The test copy is not running."}</p></div>`;
      return;
    }
    const frame = document.createElement("iframe");
    frame.className = "tc-frame";
    frame.title = `The test copy of ${d.name}`;
    frame.src = src;
    slot.replaceChildren(frame);
  }
  function tabHTML(pre, id, label, selected, controls) {
    const needs = id === "live" && allTried(planOf()) && !running();
    const dot = needs ? '<span class="tdot" aria-hidden="true"></span><span class="sr">, needs you</span>' : "";
    return `<button type="button" role="tab" id="${pre}-${id}" aria-controls="${controls}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" data-${pre}="${id}">${label}${dot}</button>`;
  }
  function headHTML(d) {
    const chip = liveChip(d);
    return `<h1 id="app-name">${esc(d.name)}</h1>
      <div class="more" id="more"><button type="button" class="more-btn" id="more-btn" aria-expanded="${S.moreOpen}" aria-controls="more-menu" data-action="more">More</button>
        <div class="more-menu" id="more-menu"${S.moreOpen ? "" : " hidden"}>
          <button type="button" data-action="more-backups">Backups<small>${d.live ? "Every night, and before every change to the live app" : "They start when the app goes live"}</small></button>
        </div></div>
      <div class="chipline">${chip}</div>`;
  }
  function leftHTML() {
    const p = planOf();
    let box;
    if (p.state === "no-test-copy") box = '<p class="note">The test copy is not running, so its plan cannot be read. Start it from the preview.</p>';
    else if (p.state === "none" || p.releasedIn) box = `<p class="note">${p.releasedIn ? `The last plan went live in ${esc(p.releasedIn)}. ` : ""}Nothing is in progress. Tell your AI what you want to change, in your own words.</p>`;
    else if (p.state === "invalid") box = `<p class="note">The plan cannot be read: ${esc(p.problem)}. Ask your AI to fix it.</p>`;
    else {
      const words = { tried: "tried by you", ready: "ready for you to try", building: "being built" };
      const items = p.steps.map((s) => `<li class="${s.state}"><span class="m" aria-hidden="true">${s.state === "tried" ? CHECK : `<span>${s.id}</span>`}</span><span>${esc(s.title)}<span class="sr">, ${words[s.state]}</span></span></li>`).join("");
      box = `<div class="plan-top"><h3>Plan: ${esc(lc(p.title))}</h3><span class="muted">${triedCount(p)} of ${p.steps.length} tried</span></div><ol>${items}</ol>`;
    }
    return `<div class="who"><h2 id="who-h" tabindex="-1">Your plan</h2><p>Your AI builds one step at a time and stops for you to try each one.</p></div>
      <div class="plan" id="plan-box">${box}</div>
      <p class="later-note">Talking to your AI here comes in a later version of this panel. For now, talk to it in its own session.</p>`;
  }
  function tryLine() {
    const p = planOf();
    const line = (cls, text, acts = "") => `<div class="tryline ${cls}" id="tryline" tabindex="-1"><p class="t">${text}</p>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`;
    if (p.state === "no-test-copy") return line("info", "<b>The test copy is not running.</b> Start it to try the app.", '<button type="button" class="btn small" data-action="start-test">Start the test copy</button>');
    if (p.state === "none" || p.releasedIn) return line("info", "<b>Nothing is in progress.</b> Tell your AI what you want to change next.");
    if (p.state === "invalid") return line("info", "<b>The plan cannot be read.</b> Ask your AI to fix it.");
    if (running() && S.jobKind === "putLive") return line("building", "<b>Putting it live.</b> The safety checks are running in Live.", '<button type="button" class="btn pink small" data-action="to-live">Go to Live</button>');
    if (allTried(p)) return line("done", `<b>All ${p.steps.length} steps are tried.</b> Go to Live when you want everyone to get ${nextV(S.detail)}.`, '<button type="button" class="btn pink small" data-action="to-live">Go to Live</button>');
    const s = current(p);
    if (s.state === "ready") return line("ready", `<b>Step ${s.id} is ready.</b> Try it: ${esc(s.check)}`, `<button type="button" class="btn small pink" data-action="works" data-step="${s.id}">${CHECK} It works</button><button type="button" class="linkbtn" data-action="report" data-step="${s.id}">Something is wrong</button>`);
    return line("building", `<b>Building step ${s.id}:</b> ${esc(lc(s.title))}. The test copy keeps working, so you can look around meanwhile.`);
  }
  function previewTopHTML() {
    const failed = jobHere() && S.jobKind === "startTestCopy" && S.job.state === "finished" && !S.job.ok ? stopBox(S.job, "The test copy did not start") : "";
    return `${tryLine()}${failed}`;
  }
  function fbarHTML() {
    const restarting = running() && S.jobKind === "startTestCopy";
    const up = S.detail.testCopy?.running;
    return `<span class="tc">Test copy</span><span class="fmid">${restarting ? "Restarting the test copy…" : "Try anything here. The live app is not touched."}</span>${up && !running() ? '<button type="button" data-action="start-test">Restart the test copy</button>' : ""}`;
  }

  /* --------------------------------------------------------- Live -- */
  // The demo's six safety checks, each a group of the CLI's own steps
  // (release.ts, backup.ts), told apart by the steps' names.
  const RELEASE_GATES = (v) => [
    ["Tried by you", /^dev runs the commit|^every step of the plan|^the migrations since|^the recovery key/],
    ["Backup taken", /backup target|database is running|an encrypted backup/],
    ["Backup restored and checked", /^the backup to check|decrypts|key vault restores|scratch copy|against the copy/],
    [`${v} started`, /built from|deployed on/],
    [`${v} answers`, /answers its smoke check/],
    ["Live", /is tagged/],
  ];
  const BACK_GATES = (v) => [
    ["It can go back", /^the version to go back to|can run on$|^the recovery key/],
    ["Backup taken", /backup target|database is running|an encrypted backup/],
    ["Backup restored and checked", /^the backup to check|decrypts|key vault restores|scratch copy|against the copy/],
    ["Your data kept", /^prod's data$/],
    [`${v} started`, /deployed on/],
    [`${v} answers`, /answers its smoke check/],
  ];
  function gatesOf(job, gates) {
    const steps = job.phases[0]?.steps ?? [];
    let at = 0;
    const of = steps.map((s) => {
      const i = gates.findIndex(([, re]) => re.test(s.name));
      at = i === -1 ? at : Math.max(at, i);
      return at;
    });
    const failedAt = steps.findIndex((s) => s.state === "failed");
    const reached = steps.length ? of[of.length - 1] : 0;
    return gates.map(([name], i) => {
      let st;
      if (job.state === "finished" && job.ok) st = "done";
      else if (failedAt !== -1) st = i < of[failedAt] ? "done" : i === of[failedAt] ? "failed" : "next";
      else if (job.state === "finished") st = i < reached ? "done" : i === reached ? "failed" : "next";
      else st = i < reached ? "done" : i === reached ? "now" : "next";
      return [name, st];
    });
  }
  function safetyList(job, gates) {
    const words = { done: ", done", now: ", checking now", next: ", waiting", failed: ", stopped here" };
    const g = gatesOf(job, gates);
    const items = g.map(([name, st]) => `<li class="${st}"><span class="g">${st === "done" ? CHECK : st === "failed" ? STOP : ""}</span><span>${esc(name)}<span class="sr">${words[st]}</span></span></li>`).join("");
    const f = g.filter(([, st]) => st === "done").length / Math.max(1, g.length - 1);
    return `<ol class="safety" aria-label="The safety checks" data-f="${Math.min(1, f).toFixed(3)}">${items}</ol>`;
  }
  function everyCheck(job) {
    const phase = (ph, i) => `<ol class="every">${ph.steps.map((s) => `<li class="${s.state}"><span class="st">${s.state === "ok" ? "done" : s.state === "failed" ? "stopped" : "checking"}</span> <b>${esc(up(s.name))}</b>${s.lines.length ? `<span class="lines">${s.lines.map(esc).join("<br>")}</span>` : ""}</li>`).join("")}</ol>${i === 0 && job.phases.length > 1 ? "<p class=\"muted\">Then, going back by itself:</p>" : ""}`;
    return `<details class="every-checks"${S.everyOpen ? " open" : ""}><summary>Every check, as the machine ran it</summary>${job.phases.map(phase).join("")}</details>`;
  }
  function failedStep(job) {
    for (const ph of job.phases) for (const s of ph.steps) if (s.state === "failed") return s;
    return null;
  }
  function stopBox(job, heading) {
    const s = failedStep(job);
    const lines = s?.lines ?? [];
    const cut = lines.findIndex((l) => l === "what would have to be true:");
    const why = cut === -1 ? lines : lines.slice(0, cut);
    const fix = cut === -1 ? [] : lines.slice(cut + 1);
    const note = job.phases.flatMap((p) => p.notes).find((n) => !/^stopped at step/.test(n)) ?? "";
    // The engine's words name the CLI; for the steps a person does here, the panel says where.
    const here = s && /^every step of the plan is tried/.test(s.name) ? '<p><b>Here:</b> try each step in Preview and press "It works", then come back to Live.</p>' : "";
    return `<div class="stopbox" role="alert"><p><b>${esc(heading)}.</b> ${s ? `It stopped at "${esc(s.name)}": ${esc(why.join(" "))}` : esc(note)}</p>${fix.length ? `<p><b>What would have to be true:</b> ${esc(fix.join(" "))}</p>` : ""}${here}</div>`;
  }
  function jobCard() {
    const job = S.job;
    const d = S.detail;
    if (S.jobKind === "putLive") {
      const v = S.jobFor;
      if (job.state === "running") return `<section class="strong lcard" id="shipcard" tabindex="-1"><h2>Putting ${esc(v)} live</h2><p>Nothing anyone sees changes until every check has passed. If ${esc(v)} does not answer, ${d.live ? `${esc(d.live)} comes straight back` : "nothing live changes"}.</p>${safetyList(job, RELEASE_GATES(v))}${everyCheck(job)}</section>`;
      if (job.ok) return `<section class="strong lcard" id="shipcard" tabindex="-1"><h2>${esc(v)} is live.</h2><p>Nothing lost. The version before it is kept below, so you can go back any time.</p>${safetyList(job, RELEASE_GATES(v))}${everyCheck(job)}</section>`;
      const back = job.phases.length > 1;
      return `<section class="strong lcard warncard" id="shipcard" tabindex="-1"><h2>${esc(v)} is not live</h2>${stopBox(job, back ? `${v} did not come up, so the live app went back by itself, keeping its data` : "Nothing changed")}${safetyList(job, RELEASE_GATES(v))}${everyCheck(job)}<div class="acts"><button type="button" class="btn small line" data-action="dismiss-job">OK</button></div></section>`;
    }
    if (S.jobKind === "goBack") {
      const v = S.jobFor;
      if (job.state === "running") return `<section class="strong lcard" id="shipcard" tabindex="-1"><h2>Going back to ${esc(v)}</h2><p>A fresh backup is taken and checked first. Your data stays as it is.</p>${safetyList(job, BACK_GATES(v))}${everyCheck(job)}</section>`;
      if (job.ok) return `<section class="strong lcard" id="shipcard" tabindex="-1"><h2>Back on ${esc(v)}.</h2><p>Your data is as it was. The backup taken first is kept with the others.</p>${safetyList(job, BACK_GATES(v))}${everyCheck(job)}<div class="acts"><button type="button" class="btn small line" data-action="dismiss-job">OK</button></div></section>`;
      return `<section class="strong lcard warncard" id="shipcard" tabindex="-1"><h2>Still on ${esc(d.live)}</h2>${stopBox(job, "Nothing changed")}${safetyList(job, BACK_GATES(v))}${everyCheck(job)}<div class="acts"><button type="button" class="btn small line" data-action="dismiss-job">OK</button></div></section>`;
    }
    return "";
  }
  function liveHTML() {
    const d = S.detail;
    const p = planOf();
    const v = nextV(d);
    const top = d.live
      ? `<section class="quiet lcard"><h2>${esc(d.live)} is live ${d.prod?.running ? '<span class="chip live">for everyone</span>' : '<span class="chip stop">not running</span>'}</h2><p>This is the version everyone uses.</p><div class="acts"><a class="btn small line" href="${esc(hostUrl(d.ports.live))}" target="_blank" rel="noopener noreferrer">Open the live app</a></div></section>`
      : '<section class="quiet lcard"><h2>Not live yet</h2><p>Only the test copy exists so far.</p></section>';
    let next = "";
    if (jobHere() && (S.jobKind === "putLive" || S.jobKind === "goBack")) next = jobCard();
    else if (allTried(p)) {
      next = `<section class="strong lcard" id="shipcard" tabindex="-1"><h2>${esc(v)} is ready: ${esc(lc(p.title))}</h2><p>You have tried all ${p.steps.length} steps. Before anything changes, your data is backed up and the backup is restored and checked. Then ${esc(v)} starts, and if it does not answer, ${d.live ? `${esc(d.live)} comes straight back` : "nothing live changes"}.</p><div class="acts"><button type="button" class="btn pink" data-action="put-live" data-v="${esc(v)}">Put ${esc(v)} live</button></div></section>`;
    } else if (p.state === "plan" && !p.releasedIn) {
      const left = p.steps.length - triedCount(p);
      next = `<section class="quiet lcard"><h2>${esc(v)}: ${esc(lc(p.title))}</h2><p>${left} step${left === 1 ? "" : "s"} left to try before ${esc(v)} can go live.</p><div class="acts"><button type="button" class="btn small line" data-action="to-preview">Back to the preview</button></div></section>`;
    }
    const target = d.versions.find((x) => x.live)?.from ?? null;
    const rows = d.versions.map((x) => {
      const act = x.live ? '<span class="chip live">Live now</span>' : x.version === target && !running() ? `<button type="button" class="btn small line" data-action="go-back" data-v="${esc(x.version)}">Go back to ${esc(x.version)}</button>` : "";
      const what = x.plan ? up(x.plan.title) : x.outsidePlan ? up(x.outsidePlan) : "";
      return `<div class="vrow"><div><b>${esc(x.version)}</b> <span class="muted">${esc(when(x.at))}</span>${what ? `<p>${esc(what)}.</p>` : ""}</div>${act}</div>`;
    }).join("");
    const vers = d.versions.length
      ? `<section class="quiet lcard"><h2>Earlier versions</h2><p>Every version you put live is kept. Going back keeps your data: what was written since then stays where it is.</p><div class="vers">${rows}</div></section>`
      : "";
    return top + next + vers;
  }

  /* ----------------------------------------------------------- render -- */
  // What has focus, as a selector that finds the same control after a render,
  // so that nothing a keyboard or a screen reader is on is lost (the demo's keepFocusIn).
  function keyOf(el) {
    if (!el || el === document.body) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.closest(".every-checks") && el.tagName === "SUMMARY") return "#shipcard .every-checks summary";
    if (el.dataset.action) return `[data-action="${el.dataset.action}"]${el.dataset.step ? `[data-step="${el.dataset.step}"]` : ""}${el.dataset.v ? `[data-v="${el.dataset.v}"]` : ""}`;
    if (el.getAttribute("href")) return `a[href="${el.getAttribute("href")}"]`;
    return null;
  }
  function keepFocus(box, fn) {
    const a = document.activeElement;
    const key = a && box.contains(a) ? keyOf(a) : null;
    fn();
    for (const ol of box.querySelectorAll(".safety[data-f]")) ol.style.setProperty("--f", ol.dataset.f);
    for (const d of box.querySelectorAll(".every-checks")) d.addEventListener("toggle", () => { S.everyOpen = d.open; });
    if (key && (!document.activeElement || document.activeElement === document.body)) box.querySelector(key)?.focus({ preventScroll: true });
  }
  function render(html) {
    renderNav();
    const m = $("#main");
    if (!html && S.view === "app" && S.detail) renderApp();
    else {
      keepFocus(m, () => {
        if (html) m.innerHTML = html;
        else if (S.view === "home") m.innerHTML = viewHome();
        else if (S.view === "machine") m.innerHTML = viewMachine();
      });
    }
    document.title = S.view === "app" && S.detail ? `${S.detail.name}: control panel` : S.view === "machine" ? "Machine health: control panel" : "Your apps: control panel";
  }
  // The right side's parts: the line above the preview, the frame's bar, the
  // frame (only when the test copy changed), and Live. Preview and Live are
  // shown and hidden, never drawn in each other's place.
  function renderRight(focusId) {
    const rp = $("#rpane");
    if (!rp) return;
    $("#preview-pane").hidden = S.right !== "preview";
    $("#live-pane").hidden = S.right !== "live";
    rp.setAttribute("aria-labelledby", `${narrowMQ.matches ? "mtab" : "rtab"}-${S.right}`);
    const part = (id, html) => keepFocus($(`#${id}`), () => { $(`#${id}`).innerHTML = html; });
    part("preview-top", previewTopHTML());
    part("fbar", fbarHTML());
    syncFrame();
    part("live-pane", liveHTML());
    if (focusId) $(`#${focusId}`)?.focus();
  }
  function selectTab(id) {
    S.right = id === "chat" ? S.right : id;
    S.m = id;
    const work = $("#work");
    work.dataset.m = id;
    for (const b of document.querySelectorAll("#mtabs [role=tab], #rtabs [role=tab]")) {
      const on = b.dataset.mtab ? b.dataset.mtab === id : b.dataset.rtab === S.right;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    renderRight();
  }

  /* ----------------------------------------------------------- dialogs -- */
  let lastFocus = null;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select,[tabindex]:not([tabindex="-1"])';
  function openModal(html, opener) {
    lastFocus = opener ?? document.activeElement;
    const dialog = $("#dialog");
    dialog.innerHTML = html;
    $("#modal").hidden = false;
    (dialog.querySelector("[autofocus]") ?? dialog.querySelector(FOCUSABLE))?.focus();
  }
  function closeModal() {
    $("#modal").hidden = true;
    const back = lastFocus && lastFocus.isConnected && lastFocus.getClientRects().length ? lastFocus : $("#main");
    back.focus({ preventScroll: back === $("#main") });
  }
  function reportDialog(step, opener) {
    openModal(`<h2 id="dialog-title">Something is wrong with step ${step}</h2>
      <p>Say what you tried and what happened, in your own words. It is kept with the app for your AI to read.</p>
      <form id="report-form"><div class="field"><label for="report-text">What happened?</label><textarea id="report-text" required maxlength="4000" autofocus></textarea></div>
      <p class="form-error" id="report-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="button" class="btn line" data-action="close">Cancel</button><button type="submit" class="btn">Save the report</button></div></form>`, opener);
    $("#report-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#report-text").value.trim();
      if (!text) { const er = $("#report-error"); er.textContent = "Say what happened first."; er.hidden = false; return; }
      const r = await api("app.report", { app: S.app, text: `Step ${step}: ${text}` });
      if (!r.ok) { const er = $("#report-error"); er.textContent = up(r.error.message); er.hidden = false; return; }
      closeModal();
      toast("Saved with the app. Tell your AI in its own session to read it.");
    });
  }
  async function backupsDialog(opener) {
    const r = await api("app.backups", { app: S.app });
    const kinds = { scheduled: "Every night", release: "Before a release", rollback: "Before going back", manual: "By hand" };
    const rows = r.ok && r.result.length
      ? [...r.result].sort((a, b) => b.created.localeCompare(a.created)).map((b) => `<div class="row"><div><h3>${esc(kinds[b.kind] ?? b.kind)}, ${esc(when(b.created))}</h3><p>${b.version ? `Of ${esc(b.version)}, ` : ""}${b.entries !== null ? `${b.entries} ${b.entries === 1 ? "entry" : "entries"}, ` : ""}${Math.max(1, Math.round(b.bytes / 1024))} kB, encrypted.</p></div></div>`).join("")
      : `<p>${!r.ok ? esc(up(r.error.message)) : S.detail?.live ? "No backups yet. The first is taken tonight, or before the next change to the live app." : "No backups yet. They start when the app goes live."}</p>`;
    openModal(`<h2 id="dialog-title">Backups of ${esc(S.app)}</h2><p>Every night the app's data is copied to the backup disk, then restored into a scratch copy and checked. A release and going back each take one first.</p><div class="quiet rows backups-list">${rows}</div><div class="dialog-actions"><button type="button" class="btn line" data-action="close">Close</button></div>`, opener);
  }
  function goBackDialog(v, opener) {
    openModal(`<h2 id="dialog-title">Go back to ${esc(v)}?</h2>
      <p>The live app goes back to ${esc(v)}. Your data stays: everything written since then is kept.</p>
      <p>Before switching, a fresh backup is taken and checked, like every release. If that cannot be done, nothing changes.</p>
      <div class="dialog-actions"><button type="button" class="btn line" data-action="close">Keep ${esc(S.detail.live)}</button><button type="button" class="btn" data-action="confirm-go-back" data-v="${esc(v)}">Go back to ${esc(v)}</button></div>`, opener);
  }

  /* -------------------------------------------------------------- jobs -- */
  let pollT = null;
  function poll() {
    clearTimeout(pollT);
    pollT = setTimeout(async () => {
      if (!S.job) return;
      const r = await api("job.get", { job: S.job.id });
      if (!r.ok) return;
      const before = S.job.phases.flatMap((p) => p.steps).filter((s) => s.state !== "running").length;
      S.job = r.result;
      const after = S.job.phases.flatMap((p) => p.steps);
      const doneNow = after.filter((s) => s.state !== "running").length;
      if (doneNow > before) announce(`${up(after[doneNow - 1].name)}: ${after[doneNow - 1].state === "ok" ? "done" : "stopped"}.`);
      if (S.job.state === "running") {
        if (S.view === "app" && S.app === S.jobApp) renderRight();
        poll();
        return;
      }
      remember(S.jobApp, null);
      const kind = S.jobKind;
      announce(kind === "putLive" ? (S.job.ok ? `${S.jobFor} is live.` : `${S.jobFor} is not live. Nothing was lost.`) : kind === "goBack" ? (S.job.ok ? `Back on ${S.jobFor}.` : "Nothing changed.") : S.job.ok ? "The test copy is running." : "The test copy did not start.");
      if (kind === "startTestCopy" && S.job.ok) { S.job = null; S.jobKind = null; }
      if (S.view === "app" && S.app === S.jobApp) {
        await load();
        $("#shipcard")?.focus();
      }
    }, 1000);
  }
  async function startJob(kind, op, extra = {}) {
    const r = await api(op, { app: S.app });
    if (!r.ok) {
      toast(up(r.error.message));
      return;
    }
    S.job = { id: r.result.job, state: "running", ok: null, phases: [] };
    S.everyOpen = false;
    S.jobKind = kind;
    S.jobApp = S.app;
    S.jobFor = extra.for ?? null;
    remember(S.app, { id: r.result.job, kind, for: S.jobFor });
    renderRight("shipcard");
    poll();
  }

  /* ----------------------------------------------------------- actions -- */
  document.addEventListener("click", async (e) => {
    const link = e.target.closest("a[data-link]");
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      const to = new URL(link.href);
      go(to.pathname, to.hash);
      return;
    }
    const tab = e.target.closest("[role=tab]");
    if (tab) { selectTab(tab.dataset.mtab ?? tab.dataset.rtab); return; }
    const b = e.target.closest("[data-action]");
    if (!b) {
      if (S.moreOpen && !e.target.closest("#more")) { S.moreOpen = false; $("#more-menu").hidden = true; $("#more-btn").setAttribute("aria-expanded", "false"); }
      return;
    }
    const a = b.dataset.action;
    if (a === "close") return closeModal();
    if (a === "more") {
      S.moreOpen = !S.moreOpen;
      $("#more-menu").hidden = !S.moreOpen;
      b.setAttribute("aria-expanded", String(S.moreOpen));
      if (S.moreOpen) $("#more-menu button")?.focus();
      return;
    }
    if (a === "more-backups") { S.moreOpen = false; $("#more-menu").hidden = true; $("#more-btn").setAttribute("aria-expanded", "false"); return backupsDialog($("#more-btn")); }
    if (a === "to-live") return selectTab("live");
    if (a === "to-preview") return selectTab("preview");
    if (a === "works") {
      b.disabled = true;
      const r = await api("app.markTried", { app: S.app, step: Number(b.dataset.step) });
      if (!r.ok) { b.disabled = false; toast(up(r.error.message)); return; }
      announce(`Step ${b.dataset.step} is marked as tried by you.`);
      toast(r.result.left.length ? `Step ${b.dataset.step} works. Your AI builds the next one.` : "Every step is tried. You can put it live from Live.");
      await load();
      $("#tryline")?.focus();
      return;
    }
    if (a === "report") return reportDialog(b.dataset.step, b);
    if (a === "start-test") return startJob("startTestCopy", "app.startTestCopy");
    if (a === "put-live") return startJob("putLive", "app.putLive", { for: b.dataset.v });
    if (a === "go-back") return goBackDialog(b.dataset.v, b);
    if (a === "confirm-go-back") { closeModal(); selectTab("live"); return startJob("goBack", "app.goBack", { for: b.dataset.v }); }
    if (a === "dismiss-job") { S.job = null; S.jobKind = null; remember(S.app, null); renderRight(); $("#rpane")?.focus(); return; }
    if (a === "recheck") {
      b.disabled = true;
      b.textContent = "Checking…";
      const r = await api("machine.status");
      if (r.ok) { S.now = { ...r.result, at: new Date().toISOString() }; }
      else toast(up(r.error.message));
      render();
      $("[data-action=recheck]")?.focus();
    }
  });

  /* ---------------------------------------------------------- keyboard -- */
  document.addEventListener("keydown", (e) => {
    const modal = !$("#modal").hidden;
    if (e.key === "Escape") {
      if (modal) { e.preventDefault(); closeModal(); return; }
      if (S.moreOpen) { S.moreOpen = false; $("#more-menu").hidden = true; const mb = $("#more-btn"); mb.setAttribute("aria-expanded", "false"); mb.focus(); return; }
      if ($("#side").classList.contains("open")) { closeMenu(); $("#menu-btn").focus(); return; }
    }
    if (modal && e.key === "Tab") {
      const f = [...$("#dialog").querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const tab = e.target.closest?.("[role=tab]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      const tabs = [...tab.parentElement.querySelectorAll("[role=tab]")];
      const i = tabs.indexOf(tab);
      const j = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault();
      selectTab(tabs[j].dataset.mtab ?? tabs[j].dataset.rtab);
      tabs[j].focus();
      return;
    }
    const menu = e.target.closest?.("#more-menu");
    if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = [...menu.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  });

  $("#menu-btn").addEventListener("click", () => {
    const open = !$("#side").classList.contains("open");
    $("#side").classList.toggle("open", open);
    $("#menu-btn").setAttribute("aria-expanded", String(open));
  });
  $("#sign-out").addEventListener("click", async () => {
    await fetch("/api/sign-out", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Allvibe-Token": token }, body: "{}" });
    location.assign("/sign-in");
  });
  narrowMQ.addEventListener("change", () => { if (S.view === "app" && S.detail) render(); });

  // Every quarter of a minute, what the builder changed shows up, unless something runs.
  setInterval(() => { if (!document.hidden && !(S.job && S.job.state === "running") && $("#modal").hidden) load({ quiet: true }); }, 15000);

  route();
  if (S.view === "app" && location.hash === "#live") { S.right = "live"; S.m = "live"; }
  if (location.hash) history.replaceState(null, "", location.pathname);
  session().then((ok) => ok && load());
})();
