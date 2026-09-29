// A real browser for the panel's checks: headless Edge (or Chrome) on this
// workstation, driven over the DevTools protocol, with real mouse and keyboard
// input. It keeps what the page logged and every request it made, so a check
// can say "no console errors" and "no request to another origin" from evidence.
// Nothing is installed: it uses the browser the workstation has.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CANDIDATES = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

const KEYS = {
  Tab: [9, "Tab"], Enter: [13, "Enter", "\r"], Escape: [27, "Escape"], " ": [32, "Space", " "],
  ArrowLeft: [37, "ArrowLeft"], ArrowUp: [38, "ArrowUp"], ArrowRight: [39, "ArrowRight"], ArrowDown: [40, "ArrowDown"],
  Home: [36, "Home"], End: [35, "End"],
};

export async function launch() {
  const exe = CANDIDATES.find((c) => existsSync(c));
  if (!exe) throw new Error("no Edge or Chrome on this workstation (set BROWSER)");
  const profile = mkdtempSync(path.join(tmpdir(), "panel-browser-"));
  const child = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const port = await new Promise((resolve, reject) => {
    let seen = "";
    child.stderr.on("data", (c) => {
      seen += c;
      const m = seen.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) resolve(Number(m[1]));
    });
    setTimeout(() => reject(new Error("the browser did not start")), 20000);
  });
  const close = async () => {
    child.kill();
    await sleep(700);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  };
  return { port, close };
}

export async function openPage(port, { width = 1280, height = 800, mobile = false, scheme = "light" } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
      else p.resolve(m.result);
    } else for (const h of handlers.get(m.method) ?? []) h(m.params);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { id += 1; pending.set(id, { resolve, reject, method }); ws.send(JSON.stringify({ id, method, params })); });
  const on = (method, h) => handlers.set(method, [...(handlers.get(method) ?? []), h]);
  const once = (method) => new Promise((resolve) => {
    const h = (p) => { handlers.set(method, (handlers.get(method) ?? []).filter((x) => x !== h)); resolve(p); };
    on(method, h);
  });

  // errors: what the page's scripts and the browser's checks (a policy, a
  // mixed request) reported; network: a response the browser logged as an
  // error, kept apart, since a refusal the check asked for is one of them.
  const log = { errors: [], network: [], requests: [], frames: [] };
  let mainFrame = null;
  on("Runtime.exceptionThrown", (p) => log.errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
  on("Runtime.consoleAPICalled", (p) => { if (p.type === "error" || p.type === "assert") log.errors.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(" ")}`); });
  on("Log.entryAdded", (p) => {
    if (p.entry.level !== "error") return;
    if (p.entry.source === "network") log.network.push({ text: p.entry.text, url: p.entry.url ?? "" });
    else log.errors.push(`${p.entry.source}: ${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ""}`);
  });
  on("Network.requestWillBeSent", (p) => log.requests.push({ url: p.request.url, frame: p.frameId, main: p.frameId === mainFrame, type: p.type }));
  on("Network.responseReceived", (p) => { if (p.type === "Document" && p.frameId !== mainFrame) log.frames.push({ url: p.response.url, status: p.response.status }); });
  on("Page.frameNavigated", (p) => { if (!p.frame.parentId) mainFrame = p.frame.id; });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Page.setBypassCSP", { enabled: false });

  const page = {
    send, on, once, log,
    async size(w, h, isMobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: isMobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: isMobile });
    },
    async scheme(value) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }, { name: "prefers-reduced-motion", value: "reduce" }] });
    },
    async goto(url) {
      const loaded = once("Page.loadEventFired");
      await send("Page.navigate", { url });
      await loaded;
    },
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    /** Waits until `expression` is truthy in the page; returns its value. */
    async waitFor(expression, { timeout = 15000, what = expression } = {}) {
      const until = Date.now() + timeout;
      for (;;) {
        const v = await page.eval(expression).catch(() => null);
        if (v) return v;
        if (Date.now() > until) throw new Error(`waited ${timeout / 1000} s for: ${what}`);
        await sleep(200);
      }
    },
    /** A real click, with the mouse, in the middle of the element. */
    async click(selector) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
      if (!box) throw new Error(`nothing to click: ${selector}`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    },
    /** A real key press; `shift` for Shift+key. */
    async key(name, { shift = false } = {}) {
      const [code, keyCode, text] = KEYS[name] ?? [name.toUpperCase().charCodeAt(0), `Key${name.toUpperCase()}`, name];
      const base = { key: name, code: keyCode, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
    async type(text) {
      await send("Input.insertText", { text });
    },
    /** What has focus, in words a person would use to find it. */
    async focused() {
      return page.eval(`(() => { const a = document.activeElement; if (!a || a === document.body) return "(nothing)"; const name = a.getAttribute("aria-label") || a.textContent.replace(/\\s+/g, " ").trim().slice(0, 60) || a.id; return \`\${a.tagName.toLowerCase()}\${a.getAttribute("role") ? "[role=" + a.getAttribute("role") + "]" : ""} "\${name}"\`; })()`);
    },
    async text(selector) {
      return page.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText.replace(/\\s+/g, " ").trim() ?? null`);
    },
    async shot(file, { full = false } = {}) {
      const params = { format: "png" };
      if (full) {
        const m = await send("Page.getLayoutMetrics");
        params.clip = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 6000), scale: 1 };
        params.captureBeyondViewport = true;
      }
      const { data } = await send("Page.captureScreenshot", params);
      writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
      ws.close();
    },
  };
  await page.size(width, height, mobile);
  await page.scheme(scheme);
  return page;
}
