// Unit tests for the control panel's server (D63, D64): sessions, the pages,
// cross-site refusals, the engine's operations through it, its files and
// headers. The engine is a stand-in; the real panel is probed on the test host
// (test/host/panel-probe.mjs).
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { COOKIE, createPanel, IDLE_MS, policy, testCopyFrame } from "../../panel/server.mjs";

function fakeEngine(state = { claimed: false }) {
  const calls = [];
  const engine = async (op, args = {}) => {
    calls.push(op);
    if (op === "auth.status") return { status: 200, body: { ok: true, result: { claimed: state.claimed, hasCode: true, pausedFor: 0 } } };
    if (op === "auth.claim") {
      if (args.setupCode === "ABCD-EFGH-JKLM-NPQR" && !state.claimed) {
        state.claimed = true;
        return { status: 200, body: { ok: true, result: { claimed: true } } };
      }
      return { status: 403, body: { ok: false, error: { code: "refused", message: "that is not the setup code the machine showed.", reason: "wrong" } } };
    }
    if (op === "auth.check") {
      return args.password === "a long enough password"
        ? { status: 200, body: { ok: true, result: { signedIn: true } } }
        : { status: 403, body: { ok: false, error: { code: "refused", message: "that is not the password.", reason: "wrong" } } };
    }
    if (op === "app.get") return { status: 200, body: { ok: true, result: { name: args.app, ports: { live: 8102, testCopy: 8103 }, appsHost: state.appsHost ?? "192.0.2.10" } } };
    return { status: 200, body: { ok: true, result: { op, args } } };
  };
  return { engine, calls, state };
}

async function serve(options) {
  const handler = createPanel(options);
  const server = http.createServer((q, r) => handler(q, r));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const ask = (method, url, { body, headers = {}, cookie } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port, method, path: url, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (response) => {
        let data = "";
        response.on("data", (c) => (data += c));
        response.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: response.statusCode, headers: response.headers, text: data, json });
        });
      });
      request.on("error", reject);
      request.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
    });
  const post = (url, body, { cookie, token, origin: from = origin, type = "application/json", extra = {} } = {}) =>
    ask("POST", url, { body, cookie, headers: { "Content-Type": type, ...(from ? { Origin: from } : {}), ...(token ? { "X-Allvibe-Token": token } : {}), ...extra } });
  return { server, ask, post, origin, close: () => server.close() };
}

const cookieFrom = (response) => String(response.headers["set-cookie"]?.[0] ?? "").split(";")[0];

async function signedIn(panel) {
  const res = await panel.post("/api/sign-in", { password: "a long enough password" });
  assert.equal(res.status, 200);
  const cookie = cookieFrom(res);
  const token = (await panel.ask("GET", "/api/session", { cookie })).json.result.token;
  return { cookie, token };
}

test("every page needs a session: before setup, to /setup; after it, to /sign-in", async () => {
  const fake = fakeEngine();
  const panel = await serve({ engine: fake.engine });
  try {
    for (const page of ["/", "/apps/guestbook", "/machine", "/sign-in"]) {
      const res = await panel.ask("GET", page);
      assert.equal(res.status, 303, page);
      assert.equal(res.headers.location, "/setup", page);
    }
    assert.equal((await panel.ask("GET", "/setup")).status, 200);
    fake.state.claimed = true;
    for (const page of ["/", "/apps/guestbook", "/machine", "/setup"]) {
      const res = await panel.ask("GET", page);
      assert.equal(res.status, 303, page);
      assert.equal(res.headers.location, "/sign-in", page);
    }
    assert.equal((await panel.ask("GET", "/sign-in")).status, 200);
    assert.equal((await panel.ask("GET", "/apps/Not_A_Name")).status, 404, "not a page at all");
    assert.equal((await panel.ask("GET", "/api/session")).status, 401);
    assert.equal((await panel.post("/api/op/apps.list", {})).status, 401, "an operation needs a session");
    assert.equal((await panel.post("/api/op/apps.list", {}, { cookie: `${COOKIE}=${"x".repeat(43)}` })).status, 401, "nor a made-up one");
  } finally {
    panel.close();
  }
});

test("the first visit: the setup code and a password sign the browser in, with a strict cookie", async () => {
  const fake = fakeEngine();
  const panel = await serve({ engine: fake.engine });
  try {
    const wrong = await panel.post("/api/setup", { setupCode: "WXYZ-WXYZ-WXYZ-WXYZ", password: "a long enough password" });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.json.error.reason, "wrong");
    assert.equal(wrong.headers["set-cookie"], undefined);
    const right = await panel.post("/api/setup", { setupCode: "ABCD-EFGH-JKLM-NPQR", password: "a long enough password" });
    assert.equal(right.status, 200);
    const set = String(right.headers["set-cookie"][0]);
    assert.match(set, new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=/; Max-Age=\\d+$`));
    const cookie = cookieFrom(right);
    const home = await panel.ask("GET", "/", { cookie });
    assert.equal(home.status, 200);
    assert.match(home.headers["content-security-policy"], /default-src 'none'/);
    assert.equal((await panel.post("/api/setup", { setupCode: "ABCD-EFGH-JKLM-NPQR", password: "x" }, { cookie })).status, 409, "signed in already");
    assert.equal((await panel.post("/api/setup", { setupCode: "ABCD-EFGH-JKLM-NPQR", password: "a long enough password" })).status, 403, "the code works once");
  } finally {
    panel.close();
  }
});

test("cross-site requests are refused, before anything reaches the engine", async () => {
  const fake = fakeEngine({ claimed: true });
  const panel = await serve({ engine: fake.engine });
  try {
    const { cookie, token } = await signedIn(panel);
    const before = fake.calls.length;
    const refusals = [
      [panel.post("/api/op/apps.list", {}, { cookie }), 403, "no token"],
      [panel.post("/api/op/apps.list", {}, { cookie, token: "x".repeat(43) }), 403, "a wrong token"],
      [panel.post("/api/op/apps.list", {}, { cookie, token, origin: "http://evil.example" }), 403, "another origin"],
      [panel.post("/api/op/apps.list", {}, { cookie, token, origin: null }), 403, "no origin and no fetch metadata"],
      [panel.post("/api/op/apps.list", {}, { cookie, token, origin: null, extra: { "Sec-Fetch-Site": "cross-site" } }), 403, "cross-site fetch metadata"],
      [panel.post("/api/op/apps.list", {}, { cookie, token, origin: null, extra: { "Sec-Fetch-Site": "same-origin" } }), 403, "no origin, even with same-origin fetch metadata (D74)"],
      [panel.post("/api/op/apps.list", {}, { cookie, token, origin: "null" }), 403, "a sandboxed frame's origin"],
      [panel.post("/api/op/apps.list", {}, { cookie, token, origin: panel.origin.replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`) }), 403, "the same host, another port"],
      [panel.post("/api/op/apps.list", {}, { cookie, token, origin: `${panel.origin}/` }), 403, "not exactly the origin"],
      [panel.post("/api/op/apps.list", "{}", { cookie, token, type: "text/plain" }), 415, "a form's content type"],
      [panel.post("/api/op/apps.list", "{}", { cookie, token, type: "application/x-www-form-urlencoded" }), 415, "a form post"],
      [panel.post("/api/sign-in", { password: "a long enough password" }, { origin: "http://evil.example" }), 403, "signing in from elsewhere"],
    ];
    for (const [pending, status, why] of refusals) assert.equal((await pending).status, status, why);
    assert.equal(fake.calls.length, before, "the engine was asked nothing");
    const ok = await panel.post("/api/op/apps.list", {}, { cookie, token });
    assert.equal(ok.status, 200);
    const options = await panel.ask("OPTIONS", "/api/op/apps.list", { headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" } });
    assert.notEqual(options.status, 200);
    assert.equal(options.headers["access-control-allow-origin"], undefined, "no CORS");
  } finally {
    panel.close();
  }
});

test("the engine's operations go through, but never its sign-in ones", async () => {
  const fake = fakeEngine({ claimed: true });
  const panel = await serve({ engine: fake.engine });
  try {
    const { cookie, token } = await signedIn(panel);
    const res = await panel.post("/api/op/app.plan", { app: "guestbook" }, { cookie, token });
    assert.deepEqual(res.json.result, { op: "app.plan", args: { app: "guestbook" } });
    for (const op of ["auth.claim", "auth.check", "auth.status"]) assert.equal((await panel.post(`/api/op/${op}`, {}, { cookie, token })).status, 404, op);
    assert.equal((await panel.post("/api/op/../../x", {}, { cookie, token })).status, 404);
    assert.equal((await panel.post("/api/op/apps.list", "[1,2]", { cookie, token })).status, 400, "not an object");
    assert.equal((await panel.post("/api/op/apps.list", "x".repeat(13000), { cookie, token })).status, 400, "too big");
  } finally {
    panel.close();
  }
});

test("signing out ends the session; so do 12 idle hours", async () => {
  let now = Date.parse("2026-09-29T10:00:00Z");
  const panel = await serve({ engine: fakeEngine({ claimed: true }).engine, now: () => now });
  try {
    const a = await signedIn(panel);
    assert.equal((await panel.post("/api/sign-out", {}, { cookie: a.cookie, token: a.token })).status, 200);
    assert.equal((await panel.ask("GET", "/api/session", { cookie: a.cookie })).status, 401);
    const b = await signedIn(panel);
    now += IDLE_MS - 1000;
    assert.equal((await panel.ask("GET", "/api/session", { cookie: b.cookie })).status, 200, "still there, just under 12 hours");
    now += IDLE_MS + 1000;
    assert.equal((await panel.ask("GET", "/api/session", { cookie: b.cookie })).status, 401, "gone after 12 idle hours");
  } finally {
    panel.close();
  }
});

test("its own files only, with its headers everywhere", async () => {
  const panel = await serve({ engine: fakeEngine({ claimed: true }).engine });
  try {
    const css = await panel.ask("GET", "/assets/panel.css");
    assert.equal(css.status, 200);
    assert.match(css.headers["content-type"], /text\/css/);
    assert.equal(css.headers["x-content-type-options"], "nosniff");
    for (const bad of ["/assets/../server.mjs", "/assets/%2e%2e/server.mjs", "/assets/nothing.css", "/server.mjs", "/.env"]) {
      assert.equal((await panel.ask("GET", bad)).status, 404, bad);
    }
    const page = await panel.ask("GET", "/sign-in");
    assert.equal(page.headers["content-security-policy"], policy());
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    assert.equal(page.headers["cache-control"], "no-store");
    assert.doesNotMatch(page.text, /\{\{(PRODUCT|COMMAND)\}\}/, "the names are filled in");
    assert.equal(page.headers["set-cookie"], undefined, "no cookie without signing in");
  } finally {
    panel.close();
  }
});

test("an app's page may frame its test copy, on the apps' host the engine gives, and nothing else (D74)", async () => {
  const fake = fakeEngine({ claimed: true });
  const frames = testCopyFrame(fake.engine);
  assert.deepEqual(await frames("guestbook"), ["http://192.0.2.10:8103"], "the machine's address, not the panel's name");
  fake.state.appsHost = "localhost";
  assert.deepEqual(await frames("guestbook"), ["http://localhost:8103"], "the test host's, as the harness declares it");
  fake.state.appsHost = "evil.example/x";
  assert.deepEqual(await frames("guestbook"), [], "nothing that is not a host name");
  fake.state.appsHost = undefined;
  const panel = await serve({ engine: fake.engine, frames });
  try {
    const { cookie } = await signedIn(panel);
    const app = await panel.ask("GET", "/apps/guestbook", { cookie });
    assert.match(app.headers["content-security-policy"], /frame-src http:\/\/192\.0\.2\.10:8103(;|$)/);
    const home = await panel.ask("GET", "/", { cookie });
    assert.doesNotMatch(home.headers["content-security-policy"], /frame-src/);
  } finally {
    panel.close();
  }
});
