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
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** Asks the engine, over its socket: { status, body }. */
export function engineOver(socketPath = ENGINE) {
  return (operation, args = {}) =>
    new Promise((resolve) => {
      const body = JSON.stringify(args);
      const request = http.request(
        { socketPath, method: "POST", path: `/v1/${operation}`, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 30_000 },
        (response) => {
          let data = "";
          response.on("data", (c) => (data += c));
          response.on("end", () => {
            try {
              resolve({ status: response.statusCode ?? 500, body: JSON.parse(data) });
            } catch {
              resolve({ status: 502, body: { ok: false, error: { code: "engine", message: "the engine answered something that is not JSON" } } });
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", () => resolve({ status: 503, body: { ok: false, error: { code: "engine", message: "The engine is not answering. On the machine: sudo systemctl status allvibe-engine" } } }));
      request.end(body);
    });
}

/**
 * The Preview's one allowed frame: the app's test copy, at its own port on the
 * host the browser reached the panel by (the machine's address, or, on the
 * test host, the workstation's loopback that forwards to it).
 */
export function testCopyFrame(engine) {
  return async (app, host) => {
    const hostname = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d+)?$/i.exec(host)?.[1];
    if (!hostname) return [];
    const answer = await engine("app.get", { app });
    const port = answer.body?.result?.ports?.testCopy;
    return Number.isInteger(port) ? [`http://${hostname}:${port}`] : [];
  };
}

/**
 * The panel's request handler. `engine(operation, args)` answers as the engine
 * does; `frames(app)` gives the Preview's allowed origin for an app's page.
 */
export function createPanel({ engine = engineOver(), staticDir = path.join(HERE, "static"), now = () => Date.now(), frames = async () => [] } = {}) {
  const files = readStatic(staticDir);
  const sessions = new Map();

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

  /** A request that changes something: JSON, and from the panel's own pages. */
  const fromHere = (request) => {
    const host = String(request.headers.host ?? "");
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    if (origin !== undefined) return origin === `http://${host}`;
    if (site !== undefined) return site === "same-origin";
    return false;
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

  return async (request, response) => {
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
        return send(response, 200, { ok: true, result: { signedIn: false } }, { "Set-Cookie": cookie("", 0) });
      }
      const op = /^\/api\/op\/([a-zA-Z.]{1,40})$/.exec(p)?.[1];
      if (!op || op.startsWith("auth.")) return refuse(response, 404, "unknown_operation", "the panel has no such request");
      const answer = await engine(op, body.value);
      return send(response, answer.status, answer.body);
    }

    return send(response, 404, "not found\n");
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const handler = createPanel({ frames: testCopyFrame(engineOver()) });
  const server = http.createServer((request, response) => {
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("the panel could not answer\n");
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.listen(PORT, "0.0.0.0", () => process.stdout.write(`the control panel answers on ${PORT}\n`));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
}
