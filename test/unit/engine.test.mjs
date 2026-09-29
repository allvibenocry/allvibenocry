// Unit tests for the engine the panel calls (D62): every operation, every
// refusal, the jobs that run long operations, signing in (D64), and the server
// on its socket. The suite is a stand-in; the real one is probed on the test
// host (test/host/engine-probe.mjs).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AuthStore, CODE_ALPHABET, isCodeShape, normaliseCode, showCode } from "../../dist/engine/auth.js";
import { Jobs, readLines } from "../../dist/engine/jobs.js";
import { OPERATIONS, perform } from "../../dist/engine/operations.js";
import { createEngineServer, MAX_BODY } from "../../dist/engine/server.js";
import { nextAction } from "../../dist/engine/suite.js";
import { runSteps, ok, fail } from "../../dist/lib/steps.js";

const tmp = () => mkdtempSync(path.join(tmpdir(), "engine-"));

function fakeSuite(calls = []) {
  return {
    exists: (app) => app === "guestbook",
    apps: () => (calls.push("apps"), [{ name: "guestbook" }]),
    app: (app) => (calls.push(`app ${app}`), { name: app }),
    plan: (app) => (calls.push(`plan ${app}`), { app, state: "plan", steps: [] }),
    markTried: (app, step) => (calls.push(`tried ${app} ${step}`), step === 2 ? { ok: false, code: "not-built", message: "the builder has not finished step 2 yet" } : { ok: true, step: `step ${step}` }),
    backups: (app) => (calls.push(`backups ${app}`), [{ kind: "release" }]),
    report: (app, text) => (calls.push(`report ${app} ${text.length}`), { file: "reports/x.txt" }),
    machineStatus: () => (calls.push("status"), { summary: "All green.", checks: [] }),
    lastNight: () => (calls.push("last"), null),
    run: async (kind, app) => (calls.push(`run ${kind} ${app}`), 0),
  };
}

// A job takes over the output it is given; in the engine that is the process's,
// here a stand-in, so that the test runner keeps its own.
const fakeStreams = () => ({ out: { write: () => true }, err: { write: () => true } });

function context(dir = tmp(), calls = [], now) {
  return { suite: fakeSuite(calls), jobs: new Jobs(fakeStreams()), auth: new AuthStore(path.join(dir, "auth.json"), now) };
}

const waitFor = async (check, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/* ------------------------------------------------------------ the list -- */

test("the allow-list is exactly the operations the architecture names", () => {
  assert.deepEqual(Object.keys(OPERATIONS).sort(), [
    "app.backups", "app.get", "app.goBack", "app.markTried", "app.plan", "app.putLive", "app.report", "app.startTestCopy",
    "apps.list", "auth.check", "auth.claim", "auth.status", "job.get", "machine.lastNight", "machine.status",
  ]);
});

test("every read and change operation answers from the suite", async () => {
  const calls = [];
  const ctx = context(tmp(), calls);
  assert.deepEqual(await perform("machine.status", {}, ctx), { ok: true, result: { summary: "All green.", checks: [] } });
  assert.deepEqual(await perform("machine.lastNight", {}, ctx), { ok: true, result: null });
  assert.deepEqual((await perform("apps.list", {}, ctx)).result, [{ name: "guestbook" }]);
  assert.deepEqual((await perform("app.get", { app: "guestbook" }, ctx)).result, { name: "guestbook" });
  assert.equal((await perform("app.plan", { app: "guestbook" }, ctx)).result.state, "plan");
  assert.deepEqual((await perform("app.backups", { app: "guestbook" }, ctx)).result, [{ kind: "release" }]);
  assert.equal((await perform("app.markTried", { app: "guestbook", step: 1 }, ctx)).result.step, "step 1");
  assert.deepEqual((await perform("app.report", { app: "guestbook", text: "The photo is gone.\nAfter a restart." }, ctx)).result, { file: "reports/x.txt" });
  assert.deepEqual(calls, ["status", "last", "apps", "app guestbook", "plan guestbook", "backups guestbook", "tried guestbook 1", "report guestbook 35"]);
});

test("a step the suite refuses to mark is refused, in its own words", async () => {
  const answer = await perform("app.markTried", { app: "guestbook", step: 2 }, context());
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "refused");
  assert.match(answer.error.message, /has not finished step 2/);
  assert.equal(answer.error.reason, "not-built");
});

/* ----------------------------------------------------------- refusals -- */

test("an unknown operation is refused, whatever its name", async () => {
  for (const name of ["shell", "app.delete", "constructor", "__proto__", "toString", "hasOwnProperty", "machine.status.x", ""]) {
    const answer = await perform(name, {}, context());
    assert.equal(answer.ok, false, name);
    assert.equal(answer.error.code, "unknown_operation", name);
  }
});

test("malformed arguments are refused before anything runs", async () => {
  const calls = [];
  const ctx = context(tmp(), calls);
  const bad = [
    ["apps.list", []],
    ["apps.list", null],
    ["apps.list", "guestbook"],
    ["apps.list", { app: "guestbook" }],
    ["app.get", {}],
    ["app.get", { app: "../etc" }],
    ["app.get", { app: "Guestbook" }],
    ["app.get", { app: "g" }],
    ["app.get", { app: ["guestbook"] }],
    ["app.get", { app: "guestbook", then: "rm -rf /" }],
    ["app.markTried", { app: "guestbook", step: "1" }],
    ["app.markTried", { app: "guestbook", step: 0 }],
    ["app.markTried", { app: "guestbook", step: 51 }],
    ["app.markTried", { app: "guestbook", step: 1.5 }],
    ["app.report", { app: "guestbook", text: "" }],
    ["app.report", { app: "guestbook", text: "   " }],
    ["app.report", { app: "guestbook", text: "x".repeat(4001) }],
    ["app.report", { app: "guestbook", text: "bell\u0007" }],
    ["app.putLive", { app: "guestbook", outsidePlan: "because" }],
    ["app.goBack", { app: "guestbook", restoreData: true }],
    ["job.get", { job: "../../etc/passwd" }],
    ["job.get", {}],
    ["auth.claim", { setupCode: "ABCD", password: "correct horse battery" }],
    ["auth.claim", { setupCode: "ABCD-EFGH-JKLM-NPQR", password: "x".repeat(201) }],
    ["auth.check", { password: 12345678901234 }],
    ["auth.check", {}],
  ];
  for (const [name, args] of bad) {
    const answer = await perform(name, args, ctx);
    assert.equal(answer.ok, false, `${name} ${JSON.stringify(args)?.slice(0, 40)}`);
    assert.equal(answer.error.code, "bad_arguments", `${name} ${JSON.stringify(args)?.slice(0, 40)}: ${answer.error.message}`);
  }
  assert.deepEqual(calls, [], "nothing reached the suite");
});

test("a project that does not exist is not found, before anything runs", async () => {
  const calls = [];
  for (const name of ["app.get", "app.plan", "app.backups", "app.putLive", "app.goBack", "app.startTestCopy"]) {
    const answer = await perform(name, { app: "nosuchapp" }, context(tmp(), calls));
    assert.equal(answer.error.code, "not_found", name);
  }
  assert.deepEqual(calls, []);
});

/* --------------------------------------------------------------- jobs -- */

test("a long operation is a job; a second while it runs is refused as busy", async () => {
  const ctx = context();
  let release;
  ctx.suite.run = () => new Promise((r) => (release = r));
  const first = await perform("app.putLive", { app: "guestbook" }, ctx);
  assert.equal(first.ok, true);
  assert.match(first.result.job, /^[0-9a-f]{16}$/);
  const second = await perform("app.goBack", { app: "guestbook" }, ctx);
  assert.equal(second.error.code, "busy");
  assert.match(second.error.message, /app.putLive for guestbook/);
  await waitFor(() => typeof release === "function");
  release(0);
  await waitFor(() => ctx.jobs.get(first.result.job).state === "finished");
  const job = (await perform("job.get", { job: first.result.job }, ctx)).result;
  assert.equal(job.ok, true);
  assert.equal(job.exitCode, 0);
  assert.equal((await perform("job.get", { job: "0123456789abcdef" }, ctx)).error.code, "not_found");
  ctx.suite.run = async () => 0;
  for (const name of ["app.startTestCopy", "app.goBack"]) {
    const answer = await perform(name, { app: "guestbook" }, ctx);
    assert.equal(answer.ok, true, name);
    await waitFor(() => !ctx.jobs.busy);
  }
});

test("a job reads the CLI's steps as they run, and gives the output back", async () => {
  const streams = fakeStreams();
  const jobs = new Jobs(streams);
  const before = streams.out.write;
  const job = jobs.start("app.putLive", "guestbook", async () => {
    const record = await runSteps(
      [
        { name: "dev runs the commit", run: () => ok("dev runs abc123") },
        { name: "every step of the plan is tried by you", run: () => fail("the plan has steps you have not tried: step 2", "try each in dev") },
        { name: "never reached", run: () => ok("no") },
      ],
      { kind: "release", project: "guestbook", record: false, out: (line) => streams.out.write(`${line}\n`) },
    );
    return record.ok ? 0 : 1;
  });
  await waitFor(() => job.state === "finished");
  assert.equal(streams.out.write, before, "the output is its own again");
  assert.equal(job.ok, false);
  const [phase] = job.phases;
  assert.deepEqual(phase.steps.map((s) => [s.n, s.total, s.name, s.state]), [
    [1, 3, "dev runs the commit", "ok"],
    [2, 3, "every step of the plan is tried by you", "failed"],
  ]);
  assert.deepEqual(phase.steps[0].lines, ["dev runs abc123"]);
  assert.deepEqual(phase.steps[1].lines, ["the plan has steps you have not tried: step 2", "what would have to be true:", "try each in dev"]);
  assert.ok(phase.notes.some((n) => /stopped at step 2\/3/.test(n)));
});

test("a failed release and its automatic rollback are two phases", () => {
  const phases = readLines([
    "ok   1/16 dev runs the commit being released, and answers its smoke check",
    "       dev runs abc",
    "FAIL 14/16 prod deployed on v3",
    "       prod's app did not come up healthy on v3",
    "",
    "stopped at step 14/16. Nothing after it was attempted.",
    "prod did not come up on v3. Going back to v2 automatically, keeping prod's data.",
    "ok   1/5 the version to go back to: v2",
    "ok   5/5 prod answers its smoke check",
    "guestbook is back on v2, with its data.",
  ]);
  assert.equal(phases.length, 2);
  assert.deepEqual(phases[0].steps.map((s) => s.state), ["ok", "failed"]);
  assert.deepEqual(phases[1].steps.map((s) => `${s.n}/${s.total}`), ["1/5", "5/5"]);
  assert.match(phases[1].notes.at(-1), /back on v2/);
});

/* ------------------------------------------------------------ signing in -- */

test("the setup code: 16 symbols without look-alikes, shown in four groups, typed any way", () => {
  const store = new AuthStore(path.join(tmp(), "auth.json"));
  const code = store.newSetupCode();
  assert.match(code, new RegExp(`^[${CODE_ALPHABET}]{16}$`));
  assert.doesNotMatch(CODE_ALPHABET, /[IO01]/);
  assert.match(showCode(code), /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal(normaliseCode(` ${showCode(code).toLowerCase()} `), code);
  assert.ok(isCodeShape(showCode(code)));
});

test("the first visit: the right code claims the panel once; a second claim is refused", async () => {
  const dir = tmp();
  const ctx = context(dir);
  const code = ctx.auth.newSetupCode();
  assert.deepEqual((await perform("auth.status", {}, ctx)).result, { claimed: false, hasCode: true, pausedFor: 0 });
  assert.equal((await perform("auth.claim", { setupCode: showCode(code), password: "short" }, ctx)).error.reason, "weak");
  assert.equal((await perform("auth.claim", { setupCode: showCode(code), password: "a long enough password" }, ctx)).result.claimed, true);
  assert.equal((await perform("auth.claim", { setupCode: showCode(code), password: "a long enough password" }, ctx)).error.reason, "claimed");
  assert.throws(() => ctx.auth.newSetupCode(), /already set up/);
  assert.equal((await perform("auth.check", { password: "a long enough password" }, ctx)).result.signedIn, true);
  assert.equal((await perform("auth.check", { password: "a wrong password here" }, ctx)).error.reason, "wrong");
  const saved = JSON.stringify(ctx.auth.read());
  assert.doesNotMatch(saved, /a long enough password/, "the password is not kept");
  assert.doesNotMatch(saved, new RegExp(code), "nor the code");
  const status = JSON.stringify((await perform("auth.status", {}, ctx)).result);
  assert.doesNotMatch(status, /salt|hash/);
  rmSync(dir, { recursive: true, force: true });
});

test("wrong tries pause signing in: after 5, 30 seconds, doubling to 15 minutes; a right one resets", async () => {
  let now = Date.parse("2026-09-29T10:00:00Z");
  const ctx = context(tmp(), [], () => new Date(now));
  const code = ctx.auth.newSetupCode();
  const wrongCode = [...code].map((c) => (c === "A" ? "B" : "A")).join("");
  for (let i = 1; i <= 4; i++) assert.equal((await perform("auth.claim", { setupCode: wrongCode, password: "a long enough password" }, ctx)).error.reason, "wrong");
  const fifth = await perform("auth.claim", { setupCode: wrongCode, password: "a long enough password" }, ctx);
  assert.equal(fifth.error.pausedFor, 30);
  const paused = await perform("auth.claim", { setupCode: code, password: "a long enough password" }, ctx);
  assert.equal(paused.error.reason, "paused", "even the right code waits");
  now += 31_000;
  assert.equal((await perform("auth.claim", { setupCode: wrongCode, password: "a long enough password" }, ctx)).error.pausedFor, 60);
  for (let i = 0; i < 8; i++) {
    now += 16 * 60_000;
    await perform("auth.claim", { setupCode: wrongCode, password: "a long enough password" }, ctx);
  }
  assert.equal(ctx.auth.status().pausedFor, 900, "never more than 15 minutes");
  now += 16 * 60_000;
  assert.equal((await perform("auth.claim", { setupCode: code, password: "a long enough password" }, ctx)).ok, true);
  assert.equal(ctx.auth.read().failures, 0);
});

test("a forgotten password: reset makes the panel unclaimed, with a new code", () => {
  const store = new AuthStore(path.join(tmp(), "auth.json"));
  const first = store.newSetupCode();
  assert.equal(store.claim(first, "a long enough password").ok, true);
  const second = store.reset();
  assert.notEqual(second, first);
  assert.deepEqual(store.status(), { claimed: false, hasCode: true, pausedFor: 0 });
  assert.equal(store.check("a long enough password").reason, "unclaimed");
  assert.equal(store.claim(first, "a long enough password").reason, "wrong", "the old code no longer works");
  assert.equal(store.claim(second, "another long password").ok, true);
});

/* ---------------------------------------------------------- next action -- */

test("the next thing to do, as the home screen shows it", () => {
  const plan = (steps, extra = {}) => ({ state: "plan", releasedIn: null, steps, ...extra });
  assert.deepEqual(nextAction(false, plan([]), "v2"), { kind: "start-test-copy" });
  assert.deepEqual(nextAction(true, { state: "none", releasedIn: null, steps: [] }, "v2"), { kind: "new-idea" });
  assert.deepEqual(nextAction(true, plan([{ id: 1, title: "a", state: "tried" }], { releasedIn: "v2" }), "v3"), { kind: "new-idea" });
  assert.deepEqual(nextAction(true, plan([{ id: 1, title: "a", state: "tried" }, { id: 2, title: "b", state: "ready" }]), "v2"), { kind: "try", step: 2, title: "b" });
  assert.deepEqual(nextAction(true, plan([{ id: 1, title: "a", state: "tried" }]), "v2"), { kind: "put-live", version: "v2" });
  assert.deepEqual(nextAction(true, plan([{ id: 1, title: "a", state: "building" }]), "v2"), { kind: "building" });
  assert.deepEqual(nextAction(true, { state: "invalid", releasedIn: null, steps: [] }, "v2"), { kind: "fix-plan" });
});

/* -------------------------------------------------------------- server -- */

const socketPath = () => (process.platform === "win32" ? `\\\\.\\pipe\\allvibe-engine-test-${process.pid}-${Math.random().toString(16).slice(2)}` : path.join(tmp(), "engine.sock"));

function ask(socket, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: socket, method, path: url, headers: { "Content-Type": "application/json", ...headers } }, (response) => {
      let data = "";
      response.on("data", (c) => (data += c));
      response.on("end", () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null, type: response.headers["content-type"] }));
    });
    request.on("error", reject);
    if (body !== undefined) request.end(typeof body === "string" ? body : JSON.stringify(body));
    else request.end();
  });
}

test("the server: POST /v1/<operation> with JSON, and every other request refused", async () => {
  const socket = socketPath();
  const server = createEngineServer(context());
  await new Promise((r) => server.listen(socket, r));
  try {
    const good = await ask(socket, "POST", "/v1/apps.list", {});
    assert.equal(good.status, 200);
    assert.match(good.type, /application\/json/);
    assert.deepEqual(good.body, { ok: true, result: [{ name: "guestbook" }] });
    assert.equal((await ask(socket, "POST", "/v1/apps.list")).status, 200, "no body is no arguments");
    const get = await ask(socket, "GET", "/v1/apps.list");
    assert.equal(get.status, 405);
    assert.equal(get.body.error.code, "unknown_operation");
    assert.equal((await ask(socket, "POST", "/v1/shell", {})).status, 404);
    assert.equal((await ask(socket, "POST", "/", {})).status, 404);
    assert.equal((await ask(socket, "POST", "/v1/../etc/passwd", {})).status, 404);
    const notJson = await ask(socket, "POST", "/v1/apps.list", "{not json");
    assert.equal(notJson.status, 400);
    assert.equal(notJson.body.error.code, "bad_arguments");
    const big = await ask(socket, "POST", "/v1/app.report", JSON.stringify({ app: "guestbook", text: "x".repeat(MAX_BODY) }));
    assert.equal(big.status, 413);
    const badArgs = await ask(socket, "POST", "/v1/app.get", { app: "../x" });
    assert.equal(badArgs.status, 400);
    const missing = await ask(socket, "POST", "/v1/app.get", { app: "nosuchapp" });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "not_found");
  } finally {
    server.close();
  }
});
