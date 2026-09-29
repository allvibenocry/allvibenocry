// The control panel (D63, D64): a small web server in its own container, on
// an internal network with no route out, behind the proxy. It draws the
// screens and asks the engine, over the one socket it has; it never acts on
// its own. Node's standard library only.
//
//   pages        need a session; without one, /sign-in (or /setup, before the
//                panel is claimed)
//   /api/setup   the first visit: the setup code and the chosen password
//   /api/sign-in the password; /api/sign-out
//   /api/session whether this browser is signed in, and its request token
//   /api/op/<operation>   the engine's operations, but never its auth.*
//   /assets/...  the panel's own styles, scripts and fonts
//   /health      the panel and the engine answer
//
// Every request that changes something must be JSON, from the panel's own
// origin, and, once signed in, carry the session's token in X-Allvibe-Token.
// The panel answers no cross-origin request, sets no cookie but its session's,
// and logs nothing about requests.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handshake, refuseUpgrade, WebSocketConnection } from "./ws.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COOKIE = process.env.PANEL_COOKIE ?? "allvibe_panel";
const ENGINE = process.env.ENGINE_SOCKET ?? "/run/engine/engine.sock";
const PORT = Number(process.env.PANEL_PORT ?? 8080);
export const IDLE_MS = 12 * 3600_000;
export const LONGEST_MS = 7 * 24 * 3600_000;
const MAX_BODY = 12 * 1024;

/** The pages, each drawn by the same shell: home, an app, the machine. */
export const PAGE = /^\/(apps\/[a-z][a-z0-9-]{1,29}|machine)?$/;

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

/** The product's names, from brand.conf through the container's environment (D1). */
const NAMES = { PRODUCT: process.env.PANEL_PRODUCT ?? "All vibe no cry", COMMAND: process.env.PANEL_COMMAND ?? "allvibe" };

/** The panel's own files, read once: nothing outside static/ can be served. */
function readStatic(dir) {
  const files = new Map();
  const walk = (sub) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      const rel = path.posix.join(sub, name);
      if (statSync(path.join(dir, rel)).isDirectory()) walk(rel);
      else if (TYPES[path.extname(name)]) {
        let body = readFileSync(path.join(dir, rel));
        if (name.endsWith(".html")) body = Buffer.from(body.toString("utf8").replace(/\{\{(PRODUCT|COMMAND)\}\}/g, (_, key) => NAMES[key]));
        files.set(rel, { type: TYPES[path.extname(name)], body });
      }
    }
  };
  walk("");
  return files;
}

/** The policy for the panel's pages: its own files only (D63). The Preview's frames come in the app view. */
export function policy(frames = []) {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    frames.length ? `frame-src ${frames.join(" ")}` : null,
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].filter(Boolean).join("; ");
}

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // No Cross-Origin-Opener-Policy: a browser ignores it on plain HTTP at a
  // name that is not localhost, as allvibe.local is, and says so as an error.
  // It comes back with TLS at home (roadmap).
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** The HTTP status the panel answers with, for each of the engine's refusals. */
export const STATUS = { unknown_operation: 404, bad_arguments: 400, not_found: 404, busy: 409, refused: 403, failed: 500 };
const ENGINE_DOWN = { ok: false, error: { code: "engine", message: "The engine is not answering. On the machine: sudo systemctl status allvibe-engine" } };

/**
 * A line-by-line connection to the engine (D76): one JSON message per line,
 * each way. `first` is its first answer; then `onLine` gets each line it
 * sends, `send` sends one, `close` ends it.
 */
export function engineConnection(socketPath, request) {
  const socket = net.createConnection(socketPath);
  let buffer = "";
  let settle;
  let listener = () => {};
  let ended = () => {};
  const first = new Promise((resolve) => (settle = resolve));
  let answered = false;
  socket.setEncoding("utf8");
  socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        message = { ok: false, error: { code: "engine", message: "the engine answered something that is not JSON" } };
      }
      if (!answered) {
        answered = true;
        settle(message);
      } else listener(message);
    }
  });
  socket.on("error", () => {
    if (!answered) {
      answered = true;
      settle(ENGINE_DOWN);
    }
  });
  socket.on("close", () => {
    if (!answered) {
      answered = true;
      settle(ENGINE_DOWN);
    }
    ended();
  });
  return {
    first,
    onLine: (fn) => (listener = fn),
    onEnd: (fn) => (ended = fn),
    send: (message) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
    },
    close: () => socket.end(),
  };
}

/** Asks the engine, over its socket, one question: { status, body }. */
export function engineOver(socketPath = ENGINE) {
  return (operation, args = {}) =>
    new Promise((resolve) => {
      const connection = engineConnection(socketPath, { op: operation, args });
      const timer = setTimeout(() => {
        connection.close();
        resolve({ status: 504, body: { ok: false, error: { code: "engine", message: "The engine did not answer in time." } } });
      }, 30_000);
      connection.first.then((body) => {
        clearTimeout(timer);
        connection.close();
        resolve({ status: body.ok ? 200 : body.error?.code === "engine" ? 503 : STATUS[body.error?.code] ?? 500, body });
      });
    });
}

/** The agent's terminal, as a stream from the engine (D76). */
export const terminalOver = (socketPath = ENGINE) => (args) => engineConnection(socketPath, { op: "agent.terminal", args });

/**
 * The Preview's one allowed frame: the app's test copy, at its own port on the
 * apps' host, which the engine gives: the machine's address, never the panel's
 * own name, whose cookie the browser would send to it (D74). On the test host,
 * the host the harness declares.
 */
export function testCopyFrame(engine) {
  return async (app) => {
    const answer = await engine("app.get", { app });
    const host = answer.body?.result?.appsHost;
    const port = answer.body?.result?.ports?.testCopy;
    return Number.isInteger(port) && typeof host === "string" && /^[a-z0-9.-]{1,253}$/i.test(host) ? [`http://${host}:${port}`] : [];
  };
}

/**
 * The panel's request handler. `engine(operation, args)` answers as the engine
 * does; `frames(app)` gives the Preview's allowed origin for an app's page.
 */
export function createPanel({ engine = engineOver(), staticDir = path.join(HERE, "static"), now = () => Date.now(), frames = async () => [], terminal = terminalOver(), pingMs = 30_000 } = {}) {
  const files = readStatic(staticDir);
  const sessions = new Map();
  /** Each session's open terminals, so that signing out closes them. */
  const terminals = new Map();

  const cookieOf = (request) => {
    for (const part of String(request.headers.cookie ?? "").split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === COOKIE) return rest.join("=");
    }
    return null;
  };
  const sessionOf = (request) => {
    const id = cookieOf(request);
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const s = sessions.get(id);
    if (!s) return null;
    const t = now();
    if (t - s.last > IDLE_MS || t - s.created > LONGEST_MS) {
      sessions.delete(id);
      return null;
    }
    s.last = t;
    return s;
  };
  const newSession = () => {
    const id = randomBytes(32).toString("base64url");
    const s = { id, token: randomBytes(32).toString("base64url"), created: now(), last: now() };
    sessions.set(id, s);
    return s;
  };
  const cookie = (id, maxAge) => `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

  const send = (response, status, body, headers = {}) => {
    const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
    const payload = isJson ? JSON.stringify(body) : body;
    response.writeHead(status, {
      ...HEADERS,
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(payload),
      ...headers,
    });
    response.end(payload);
  };
  const refuse = (response, status, code, message, extra = {}) => send(response, status, { ok: false, error: { code, message, ...extra } });
  const page = (response, file, frameOrigins = []) => {
    const f = files.get(`pages/${file}`);
    send(response, 200, f.body, { "Content-Type": f.type, "Content-Security-Policy": policy(frameOrigins) });
  };
  const redirect = (response, where) => send(response, 303, "", { Location: where });

  /**
   * A request that changes something comes from the panel's own pages: its
   * Origin is exactly the panel's, port included (D66, D74). Browsers send one
   * with every such request; a request without one, or with "null" (a
   * sandboxed frame), or with another port of the same host (a test copy, a
   * live app), is refused. The Host is the panel's own: its door lets no other
   * name through.
   */
  const fromHere = (request) => {
    const host = String(request.headers.host ?? "");
    const origin = request.headers.origin;
    return typeof origin === "string" && host !== "" && origin === `http://${host}`;
  };
  const tokenMatches = (request, s) => {
    const given = String(request.headers["x-allvibe-token"] ?? "");
    const a = Buffer.from(given);
    const b = Buffer.from(s.token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const readJson = (request) =>
    new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      request.on("data", (c) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
      });
      request.on("end", () => {
        if (size > MAX_BODY) return resolve({ error: "too big" });
        try {
          const value = size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          resolve(value && typeof value === "object" && !Array.isArray(value) ? { value } : { error: "not an object" });
        } catch {
          resolve({ error: "not JSON" });
        }
      });
    });

  /**
   * The agent's terminal (D76): `/api/terminal/<app>`, a WebSocket, only for a
   * signed-in browser, from the panel's own origin exactly (a WebSocket is
   * not held back by the same-origin rules, so the Origin is the check), and
   * only once its first message carries the session's own token. Then the
   * engine's stream, both ways: what Claude Code shows, as binary; what the
   * person types and the window's size, as JSON. Nothing of it is logged or
   * kept here.
   */
  const upgrade = (request, socket, head) => {
    const app = /^\/api\/terminal\/([a-z][a-z0-9-]{1,29})$/.exec(new URL(String(request.url), "http://panel").pathname)?.[1];
    const key = request.headers["sec-websocket-key"];
    if (!app || String(request.headers.upgrade ?? "").toLowerCase() !== "websocket" || typeof key !== "string" || request.headers["sec-websocket-version"] !== "13") return refuseUpgrade(socket, 400, "Bad Request");
    const s = sessionOf(request);
    if (!s) return refuseUpgrade(socket, 401, "Unauthorized");
    if (!fromHere(request)) return refuseUpgrade(socket, 403, "Forbidden");
    handshake(socket, key);
    const ws = new WebSocketConnection(socket, head);
    const open = terminals.get(s.id) ?? new Set();
    open.add(ws);
    terminals.set(s.id, open);
    let stream = null;
    let alive = true;
    const hello = setTimeout(() => ws.close(4401, "no token"), 5000);
    const pinger = setInterval(() => {
      if (!alive) return ws.close(1001, "no answer");
      alive = false;
      ws.ping();
    }, pingMs);
    ws.on("pong", () => (alive = true));
    ws.on("close", () => {
      clearTimeout(hello);
      clearInterval(pinger);
      open.delete(ws);
      stream?.close();
    });
    ws.on("message", async (data, text) => {
      if (!text) return;
      let m;
      try {
        m = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      if (!stream) {
        if (m?.t !== "hello" || !tokenMatches({ headers: { "x-allvibe-token": m.token } }, s)) return ws.close(4401, "not signed in");
        clearTimeout(hello);
        const args = { app, cols: m.cols, rows: m.rows, start: m.start === true };
        stream = terminal(args);
        const answer = await stream.first;
        if (ws.closed) return stream.close();
        if (!answer.ok) {
          ws.sendText(JSON.stringify({ t: "refused", code: answer.error?.code, message: answer.error?.message }));
          return ws.close(4000, "refused");
        }
        ws.sendText(JSON.stringify({ t: "ready", session: answer.result?.session }));
        stream.onLine((line) => {
          if (line?.t === "out" && typeof line.d === "string") ws.sendBinary(Buffer.from(line.d, "base64"));
          else if (line?.t === "taken" || line?.t === "ended") ws.sendText(JSON.stringify(line));
        });
        stream.onEnd(() => ws.close(1000, "ended"));
        return;
      }
      if (m?.t === "in" && typeof m.d === "string" && m.d.length <= 16 * 1024) stream.send({ t: "in", d: m.d });
      else if (m?.t === "resize" && Number.isInteger(m.cols) && Number.isInteger(m.rows)) stream.send({ t: "resize", cols: m.cols, rows: m.rows });
    });
  };

  const handler = async (request, response) => {
    const url = new URL(String(request.url), "http://panel");
    const p = url.pathname;
    const method = request.method;

    if (method === "GET" && p === "/health") {
      const answer = await engine("auth.status");
      return send(response, answer.status === 200 ? 200 : 503, answer.status === 200 ? "ok\n" : "the engine is not answering\n");
    }
    if (method === "GET" && p.startsWith("/assets/")) {
      const f = files.get(p.slice(1));
      if (!f) return send(response, 404, "not found\n");
      return send(response, 200, f.body, { "Content-Type": f.type, "Cache-Control": "no-cache" });
    }

    if (method === "GET" && (PAGE.test(p) || p === "/setup" || p === "/sign-in")) {
      const signedIn = sessionOf(request);
      if (signedIn && PAGE.test(p)) {
        const app = p.startsWith("/apps/") ? p.slice(6) : null;
        return page(response, "shell.html", app ? await frames(app, String(request.headers.host ?? "")) : []);
      }
      if (signedIn) return redirect(response, "/");
      const status = await engine("auth.status");
      if (status.status !== 200) return page(response, "engine-down.html");
      const claimed = status.body.result.claimed;
      if (!claimed) return p === "/setup" ? page(response, "setup.html") : redirect(response, "/setup");
      return p === "/sign-in" ? page(response, "sign-in.html") : redirect(response, "/sign-in");
    }

    if (p.startsWith("/api/")) {
      if (method !== "GET" && method !== "POST") return refuse(response, 405, "method", "the panel's API answers GET and POST only");
      const s = sessionOf(request);

      if (method === "GET" && p === "/api/session") {
        if (!s) return refuse(response, 401, "signed_out", "Sign in first.");
        return send(response, 200, { ok: true, result: { signedIn: true, token: s.token } });
      }
      if (method !== "POST") return refuse(response, 404, "not_found", "no such request");

      // Every change: JSON, from the panel's own pages.
      if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
        request.resume();
        return refuse(response, 415, "not_json", "the panel takes JSON only");
      }
      if (!fromHere(request)) {
        request.resume();
        return refuse(response, 403, "cross_site", "refused: this request did not come from the control panel's own pages");
      }
      const body = await readJson(request);
      if (body.error) return refuse(response, 400, "bad_request", `the request is ${body.error}`);

      if (p === "/api/setup" || p === "/api/sign-in") {
        if (s) return refuse(response, 409, "signed_in", "You are signed in already.");
        const answer = p === "/api/setup"
          ? await engine("auth.claim", { setupCode: body.value.setupCode, password: body.value.password })
          : await engine("auth.check", { password: body.value.password });
        if (!answer.body.ok) return send(response, answer.status, answer.body);
        const fresh = newSession();
        return send(response, 200, { ok: true, result: { signedIn: true } }, { "Set-Cookie": cookie(fresh.id, Math.floor(LONGEST_MS / 1000)) });
      }

      if (!s) return refuse(response, 401, "signed_out", "Sign in first.");
      if (!tokenMatches(request, s)) return refuse(response, 403, "cross_site", "refused: this request did not come from the control panel's own pages");

      if (p === "/api/sign-out") {
        sessions.delete(s.id);
        for (const ws of terminals.get(s.id) ?? []) ws.close(4401, "signed out");
        terminals.delete(s.id);
        return send(response, 200, { ok: true, result: { signedIn: false } }, { "Set-Cookie": cookie("", 0) });
      }
      const op = /^\/api\/op\/([a-zA-Z.]{1,40})$/.exec(p)?.[1];
      if (!op || op.startsWith("auth.")) return refuse(response, 404, "unknown_operation", "the panel has no such request");
      const answer = await engine(op, body.value);
      return send(response, answer.status, answer.body);
    }

    return send(response, 404, "not found\n");
  };
  handler.upgrade = upgrade;
  return handler;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const handler = createPanel({ frames: testCopyFrame(engineOver()) });
  const server = http.createServer((request, response) => {
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("the panel could not answer\n");
    });
  });
  server.on("upgrade", handler.upgrade);
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.listen(PORT, "0.0.0.0", () => process.stdout.write(`the control panel answers on ${PORT}\n`));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
}
