// Unit tests for the engine the panel calls (D62): every operation, every
// refusal, the jobs that run long operations, signing in (D64), and the server
// on its socket. The suite is a stand-in; the real one is probed on the test
// host (test/host/engine-probe.mjs).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Duplex, PassThrough } from "node:stream";
import { test } from "node:test";
import { AuthStore, CODE_ALPHABET, isCodeShape, normaliseCode, showCode } from "../../dist/engine/auth.js";
import { inWorker, Jobs, readLines } from "../../dist/engine/jobs.js";
import { OPERATIONS, perform, STREAMS, terminalStream } from "../../dist/engine/operations.js";
import { createEngineServer, MAX_LINE } from "../../dist/engine/server.js";
import { Terminals } from "../../dist/engine/terminal.js";
import { nextAction } from "../../dist/engine/suite.js";
import { takeLock } from "../../dist/lib/lock.js";

const tmp = () => mkdtempSync(path.join(tmpdir(), "engine-"));

function fakeSuite(calls = []) {
  const locks = [];
  return {
    calls,
    locks,
    // The app's lock, as the real one keeps it: one holder per app (D72).
    lock: (app) => {
      if (locks.includes(app)) return { ok: false, message: `${app} is locked` };
      locks.push(app);
      return { ok: true, release: () => locks.splice(locks.indexOf(app), 1) };
    },
    exists: (app) => app === "guestbook",
    apps: () => (calls.push("apps"), [{ name: "guestbook" }]),
    app: (app) => (calls.push(`app ${app}`), { name: app }),
    plan: (app) => (calls.push(`plan ${app}`), { app, state: "plan", steps: [] }),
    markTried: (app, step) => (calls.push(`tried ${app} ${step}`), step === 2 ? { ok: false, code: "not-built", message: "the builder has not finished step 2 yet" } : { ok: true, step: `step ${step}` }),
    backups: (app) => (calls.push(`backups ${app}`), [{ kind: "release" }]),
    report: (app, text) => (calls.push(`report ${app} ${text.length}`), { file: "reports/x.txt" }),
    machineStatus: () => (calls.push("status"), { summary: "All green.", checks: [] }),
    lastNight: () => (calls.push("last"), null),
    run: async (kind, app, options = {}) => (calls.push(`run ${kind} ${app} ${options.signIn ?? "-"}`), 0),
    agentStatus: () => ({ running: true, signIn: "key", hasKey: true }),
    nameProblem: (name) => (name === "reserved" ? "that name is reserved" : null),
  };
}

function context(dir = tmp(), calls = [], now) {
  return { suite: fakeSuite(calls), jobs: new Jobs(), auth: new AuthStore(path.join(dir, "auth.json"), now) };
}

const waitFor = async (check, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/* ------------------------------------------------------------ the list -- */

test("the allow-list is exactly the operations the architecture names, and one stream (D76)", () => {
  assert.deepEqual(Object.keys(OPERATIONS).sort(), [
    "agent.start", "agent.status", "agent.stop",
    "app.backups", "app.create", "app.get", "app.goBack", "app.markTried", "app.plan", "app.putLive", "app.report", "app.startTestCopy",
    "apps.list", "auth.check", "auth.claim", "auth.status", "job.get", "machine.lastNight", "machine.status",
  ]);
  assert.deepEqual([...STREAMS], ["agent.terminal"]);
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
  assert.match(second.error.message, /^A release of guestbook is already running, started from the panel just now\./);
  assert.deepEqual(ctx.suite.locks, ["guestbook"], "the first holds the app's lock, and the second took none");
  await waitFor(() => typeof release === "function");
  release(0);
  await waitFor(() => ctx.jobs.get(first.result.job).state === "finished");
  assert.deepEqual(ctx.suite.locks, [], "the lock is let go when the job ends");
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

test("the app's lock, held by the command line, refuses a long operation with its words, and starts no job (D72)", async () => {
  const ctx = context();
  const message = "A release of guestbook is already running, started from the command line 2 minutes ago. Wait for it to end, then try again.";
  ctx.suite.lock = () => ({ ok: false, message });
  const answer = await perform("app.putLive", { app: "guestbook" }, ctx);
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "busy");
  assert.equal(answer.error.message, message);
  assert.equal(ctx.jobs.busy, null);
  assert.deepEqual(ctx.suite.calls.filter((c) => c.startsWith("run ")), []);
});

test("a job that throws still lets the app's lock go", async () => {
  const ctx = context();
  ctx.suite.run = async () => {
    throw new Error("the command broke");
  };
  const answer = await perform("app.startTestCopy", { app: "guestbook" }, ctx);
  assert.equal(answer.ok, true);
  await waitFor(() => !ctx.jobs.busy);
  assert.deepEqual(ctx.suite.locks, []);
  assert.equal(ctx.jobs.get(answer.result.job).ok, false);
});

// A job's command, on a thread of its own, through the real plumbing (D77).
const WORKER = new URL("./job-thread-worker.mjs", import.meta.url);
const inThread = (jobs, order) => jobs.start("app.putLive", order.app, (feed) => inWorker(WORKER, order, feed));

test("a job's command runs on a thread of its own: its steps as they run, what it prints, and the engine's own output left alone", async () => {
  const jobs = new Jobs();
  const before = process.stdout.write;
  const seen = [];
  const job = inThread(jobs, { kind: "putLive", app: "steps" });
  // While it runs, the engine's thread is free: it answers meanwhile.
  const timer = setInterval(() => seen.push(job.state), 1);
  await waitFor(() => job.state === "finished");
  clearInterval(timer);
  assert.ok(seen.includes("running"), "the engine's thread ran while the job did");
  assert.equal(process.stdout.write, before, "the engine's output is never taken");
  assert.equal(job.ok, false);
  const [phase] = job.phases;
  assert.deepEqual(phase.steps.map((s) => [s.n, s.total, s.name, s.state]), [
    [1, 3, "dev runs the commit", "ok"],
    [2, 3, "every step of the plan is tried by you", "failed"],
  ]);
  assert.deepEqual(phase.steps[0].lines, ["dev runs abc123"]);
  assert.deepEqual(phase.steps[1].lines, ["the plan has steps you have not tried: step 2", "what would have to be true:", "try each in dev"]);
  assert.ok(phase.notes.includes("a line from console.log, before the steps"));
  assert.ok(phase.notes.some((n) => /stopped at step 2\/3/.test(n)));
});

test("a job's command that throws, or ends its thread, fails the job and says so", async () => {
  const jobs = new Jobs();
  const threw = inThread(jobs, { kind: "putLive", app: "throws" });
  await waitFor(() => threw.state === "finished");
  assert.equal(threw.ok, false);
  assert.ok(threw.phases.at(-1).notes.includes("the command broke"));
  const exited = inThread(jobs, { kind: "putLive", app: "exits" });
  await waitFor(() => exited.state === "finished");
  assert.equal(exited.ok, false);
  assert.ok(exited.phases.at(-1).notes.some((n) => /stopped without finishing \(3\)/.test(n)));
});

test("a job's command finds the app's lock, taken by the engine for it, already its own; without that it would be refused", async () => {
  const dir = tmp();
  const file = path.join(dir, "operation.lock");
  const taken = takeLock("locked", "release", file);
  assert.equal(taken.ok, true);
  try {
    const jobs = new Jobs();
    const adopted = inThread(jobs, { kind: "putLive", app: "locked", lock: "release", file });
    await waitFor(() => adopted.state === "finished");
    assert.equal(adopted.ok, true);
    assert.deepEqual(adopted.phases.at(-1).notes, ["the lock: held already, by this process"]);
    // The control: the same thread, not told of the lock, is refused by it.
    const told = inThread(jobs, { kind: "putLive", app: "locked", file });
    await waitFor(() => told.state === "finished");
    assert.equal(told.ok, false);
    assert.match(told.phases.at(-1).notes[0], /^A release of locked is already running, started from the command line/);
  } finally {
    taken.release();
  }
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

/** One line to the engine's socket, and the lines it answers with until it closes. */
function lines(socket, raw, { keep = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socket);
    let data = "";
    client.setEncoding("utf8");
    client.on("connect", () => client.write(raw));
    client.on("data", (c) => {
      data += c;
      if (keep && data.split("\n").filter(Boolean).length >= keep) client.end();
    });
    client.on("end", () => resolve(data.split("\n").filter(Boolean).map((l) => JSON.parse(l))));
    client.on("error", reject);
  });
}
const ask = async (socket, op, args) => (await lines(socket, `${JSON.stringify(args === undefined ? { op } : { op, args })}\n`))[0];

test("the server: one JSON line in, one out, no HTTP; every other request refused (D76)", async () => {
  const socket = socketPath();
  const server = createEngineServer(context());
  await new Promise((r) => server.listen(socket, r));
  try {
    assert.deepEqual(await ask(socket, "apps.list", {}), { ok: true, result: [{ name: "guestbook" }] });
    assert.equal((await ask(socket, "apps.list")).ok, true, "no arguments is none");
    assert.equal((await ask(socket, "shell", {})).error.code, "unknown_operation");
    assert.equal((await ask(socket, "../etc/passwd", {})).error.code, "unknown_operation");
    const http11 = await lines(socket, "POST /v1/apps.list HTTP/1.1\r\nHost: x\r\n\r\n");
    assert.equal(http11[0].error.code, "bad_arguments", "an HTTP request is not JSON");
    assert.equal((await lines(socket, "{not json\n"))[0].error.code, "bad_arguments");
    assert.equal((await lines(socket, "[1,2]\n"))[0].error.code, "bad_arguments");
    const big = await lines(socket, `${JSON.stringify({ op: "app.report", args: { app: "guestbook", text: "x".repeat(MAX_LINE) } })}\n`);
    assert.equal(big[0].error.code, "bad_arguments");
    assert.match(big[0].error.message, /longer than 16 kB/);
    const noLine = await lines(socket, "x".repeat(MAX_LINE + 10));
    assert.equal(noLine[0].error.code, "bad_arguments", "a line that never ends is cut off at 16 kB");
    assert.equal((await ask(socket, "app.get", { app: "../x" })).error.code, "bad_arguments");
    assert.equal((await ask(socket, "app.get", { app: "nosuchapp" })).error.code, "not_found");
    const two = await lines(socket, `${JSON.stringify({ op: "apps.list" })}\n${JSON.stringify({ op: "machine.status" })}\n`);
    assert.equal(two.length, 1, "one request, one answer, and the connection closes");
  } finally {
    server.close();
  }
});

/* --------------------------------------------- the agent, a new app (D76) -- */

test("the agent's operations and a new app: arguments checked, and each change confirmed", async () => {
  const ctx = context();
  const bad = async (op, args) => (await perform(op, args, ctx)).error;
  assert.equal((await bad("agent.start", { app: "guestbook", signIn: "key" })).code, "bad_arguments", "no confirm");
  assert.equal((await bad("agent.start", { app: "guestbook", signIn: "key", confirm: "yes" })).code, "bad_arguments", "confirm is true, not a word");
  assert.equal((await bad("agent.start", { app: "guestbook", signIn: "password", confirm: true })).code, "bad_arguments");
  assert.equal((await bad("agent.start", { app: "nosuchapp", signIn: "key", confirm: true })).code, "not_found");
  assert.equal((await bad("agent.stop", { app: "guestbook" })).code, "bad_arguments", "no confirm");
  assert.equal((await bad("app.create", { app: "newapp" })).code, "bad_arguments", "no confirm");
  assert.equal((await bad("app.create", { app: "New App", confirm: true })).code, "bad_arguments");
  assert.equal((await bad("app.create", { app: "guestbook", confirm: true })).message, "there is already an app called guestbook");
  assert.equal((await bad("app.create", { app: "reserved", confirm: true })).message, "that name is reserved");
  assert.equal((await bad("app.create", { app: "newapp", confirm: true, extra: 1 })).code, "bad_arguments");
  assert.deepEqual(ctx.suite.calls.filter((c) => c.startsWith("run ")), [], "nothing ran");

  const started = await perform("agent.start", { app: "guestbook", signIn: "account", confirm: true }, ctx);
  assert.equal(started.ok, true);
  await waitFor(() => !ctx.jobs.busy);
  const made = await perform("app.create", { app: "newapp", confirm: true }, ctx);
  assert.equal(made.ok, true);
  await waitFor(() => !ctx.jobs.busy);
  const stopped = await perform("agent.stop", { app: "guestbook", confirm: true }, ctx);
  assert.equal(stopped.ok, true);
  await waitFor(() => !ctx.jobs.busy);
  assert.deepEqual(ctx.suite.calls.filter((c) => c.startsWith("run ")), ["run agentStart guestbook account", "run createApp newapp -", "run agentStop guestbook -"]);
  assert.deepEqual(ctx.suite.locks, [], "none of them takes an app's lock, and none is left");
  const status = await perform("agent.status", { app: "guestbook" }, ctx);
  assert.deepEqual(status.result, { running: true, signIn: "key", hasKey: true, terminal: { open: false, attached: false } });
});

/** A stand-in for Docker's exec API: each start is a pair of streams, one the test holds. */
function fakeExec() {
  const made = [];
  const resizes = [];
  const hangups = [];
  return {
    made,
    resizes,
    hangups,
    async start(container, cols, rows) {
      const inner = new PassThrough();
      const outer = new PassThrough();
      const stream = Duplex.from({ readable: outer, writable: inner });
      const typed = [];
      inner.on("data", (c) => typed.push(c.toString("utf8")));
      made.push({ container, cols, rows, show: (text) => outer.write(text), end: () => outer.end(), typed });
      return { id: `exec${made.length}`, stream };
    },
    async resize(id, cols, rows) {
      resizes.push(`${id} ${cols}x${rows}`);
    },
    async hangUp(id) {
      hangups.push(id);
    },
  };
}
const client = () => {
  const got = [];
  return { got, closed: false, send(m) { got.push(m); }, close() { this.closed = true; } };
};

test("the terminal: opened only when the person asks, one browser at a time, the second taking over", async () => {
  const exec = fakeExec();
  let running = false;
  const terminals = new Terminals(exec, () => running, (app) => `allvibe-${app}-agent`);
  const a = client();
  assert.deepEqual(await terminals.attach("guestbook", a, 80, 24, true), { ok: false, code: "refused", message: "Your AI is not running. Start it first." });
  running = true;
  const none = await terminals.attach("guestbook", a, 80, 24, false);
  assert.equal(none.code, "not_found", "not started without the person asking");
  assert.equal(exec.made.length, 0);
  const first = await terminals.attach("guestbook", a, 80, 24, true);
  assert.equal(first.result.session, "started");
  assert.deepEqual([exec.made[0].container, exec.made[0].cols, exec.made[0].rows], ["allvibe-guestbook-agent", 80, 24]);
  exec.made[0].show("before its answer");
  await new Promise((r) => setImmediate(r));
  assert.equal(a.got.length, 0, "nothing for the window before the server has written its answer");
  first.handle.start();
  exec.made[0].show("Claude Code, drawing");
  await new Promise((r) => setImmediate(r));
  assert.equal(Buffer.from(a.got.at(-1).d, "base64").toString(), "Claude Code, drawing");
  first.handle.message({ t: "in", d: "hello" });
  first.handle.message({ t: "in", d: "x".repeat(16 * 1024 + 1) });
  first.handle.message({ t: "resize", cols: 100, rows: 30 });
  first.handle.message({ t: "resize", cols: 5000, rows: 30 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(exec.made[0].typed, ["hello"], "what is typed goes in; too much does not");
  assert.deepEqual(exec.resizes, ["exec1 100x30"], "a size it can take");

  const b = client();
  const second = await terminals.attach("guestbook", b, 90, 20, false);
  assert.equal(second.result.session, "joined", "a second browser joins the same Claude Code");
  assert.deepEqual(a.got.at(-1), { t: "taken", message: "This terminal was opened in another window." });
  assert.equal(a.closed, true, "and the first is let go");
  exec.made[0].show("a redraw too early");
  await new Promise((r) => setImmediate(r));
  assert.equal(b.got.length, 0, "the new window gets nothing before its answer either");
  second.handle.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(exec.resizes.slice(-2), ["exec1 90x19", "exec1 90x20"], "and it draws itself again for the new window");
  first.handle.message({ t: "in", d: "from the old window" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(exec.made[0].typed, ["hello"], "the old window types nothing any more");
  assert.deepEqual(terminals.status("guestbook"), { open: true, attached: true });

  second.handle.closed();
  exec.made[0].show("while nobody looks");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(terminals.status("guestbook"), { open: true, attached: false });
  assert.equal(b.got.filter((m) => m.t === "out").length, 0, "what is shown while nobody looks is dropped, not kept");
  const c = client();
  (await terminals.attach("guestbook", c, 80, 24, false)).handle.start();
  assert.equal(c.got.filter((m) => m.t === "out").length, 0, "and not replayed to the next window");

  exec.made[0].end();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(c.got.at(-1), { t: "ended", why: "exit" });
  assert.deepEqual(terminals.status("guestbook"), { open: false, attached: false });
});

test("the terminal: hung up on after the idle time, with nothing typed and nothing shown", async () => {
  const exec = fakeExec();
  let now = 0;
  const terminals = new Terminals(exec, () => true, (app) => app, () => 60_000, () => now);
  const a = client();
  const opened = await terminals.attach("guestbook", a, 80, 24, true);
  opened.handle.start();
  now = 50_000;
  opened.handle.message({ t: "in", d: "still here" });
  now = 100_000;
  assert.deepEqual(await terminals.sweep(), [], "typing keeps it open");
  now = 111_000;
  assert.deepEqual(await terminals.sweep(), ["guestbook"]);
  assert.deepEqual(exec.hangups, ["exec1"]);
  exec.made[0].end();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(a.got.at(-1), { t: "ended", why: "idle" });
});

test("the terminal's stream through the server: arguments checked, then lines both ways", async () => {
  const socket = socketPath();
  const exec = fakeExec();
  const ctx = context();
  const terminals = new Terminals(exec, () => true, (app) => app);
  const server = createEngineServer(ctx, () => {}, { "agent.terminal": terminalStream(ctx, terminals) });
  await new Promise((r) => server.listen(socket, r));
  try {
    assert.equal((await ask(socket, "agent.terminal", { app: "guestbook", cols: 80, rows: 24, start: true, shell: "sh" })).error.code, "bad_arguments");
    assert.equal((await ask(socket, "agent.terminal", { app: "guestbook", cols: 1, rows: 24 })).error.code, "bad_arguments");
    assert.equal((await ask(socket, "agent.terminal", { app: "nosuchapp", cols: 80, rows: 24 })).error.code, "not_found");
    const conn = net.createConnection(socket);
    conn.setEncoding("utf8");
    let got = "";
    conn.on("data", (c) => (got += c));
    await new Promise((r) => conn.on("connect", r));
    conn.write(`${JSON.stringify({ op: "agent.terminal", args: { app: "guestbook", cols: 80, rows: 24, start: true } })}\n`);
    await waitFor(() => got.includes("\n"));
    assert.deepEqual(JSON.parse(got.split("\n")[0]), { ok: true, result: { session: "started" } });
    conn.write(`${JSON.stringify({ t: "in", d: "ls\r" })}\n`);
    exec.made[0].show("an answer");
    await waitFor(() => exec.made[0].typed.length === 1 && got.split("\n").filter(Boolean).length === 2);
    assert.deepEqual(exec.made[0].typed, ["ls\r"]);
    assert.equal(Buffer.from(JSON.parse(got.split("\n")[1]).d, "base64").toString(), "an answer");
    // A second window joins while Claude Code is drawing: its first line is still its answer.
    const conn2 = net.createConnection(socket);
    conn2.setEncoding("utf8");
    let got2 = "";
    conn2.on("data", (c) => (got2 += c));
    await new Promise((r) => conn2.on("connect", r));
    const drawing = setInterval(() => exec.made[0].show("drawing"), 1);
    conn2.write(`${JSON.stringify({ op: "agent.terminal", args: { app: "guestbook", cols: 80, rows: 24 } })}\n`);
    await waitFor(() => got2.includes("\n"));
    clearInterval(drawing);
    assert.deepEqual(JSON.parse(got2.split("\n")[0]), { ok: true, result: { session: "joined" } }, "the answer first, then the drawing");
    await waitFor(() => got.includes('"taken"'));
    conn2.end();
    conn.end();
    await waitFor(() => !terminals.status("guestbook").attached);
  } finally {
    server.close();
  }
});
