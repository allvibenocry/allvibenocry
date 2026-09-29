// One lock per app, shared by the engine and the CLI (D72).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ago, holderRuns, refusal, setLockOrigin, takeLock } from "../../dist/lib/lock.js";

const file = () => path.join(mkdtempSync(path.join(tmpdir(), "lock-")), "operation.lock");
const minutesAgo = (n) => new Date(Date.now() - n * 60_000 - 5_000).toISOString();
/** A process id that has ended: one of a process that ran and exited. */
const endedPid = () => spawnSync(process.execPath, ["-e", "0"]).pid;

test("the refusal, in the architect's words", () => {
  const holder = { operation: "release", app: "hello", from: "the panel", pid: 1, since: null, started: minutesAgo(2) };
  assert.equal(refusal(holder), "A release of hello is already running, started from the panel 2 minutes ago. Wait for it to end, then try again.");
  assert.match(refusal({ ...holder, operation: "rollback", from: "the command line" }), /^Going back to an earlier version of hello is already running, started from the command line 2 minutes ago\./);
  assert.match(refusal({ ...holder, operation: "dev-deploy", started: new Date().toISOString() }), /^A new start of hello's test copy is already running, started from the panel just now\./);
});

test("ago: just now, minutes, hours", () => {
  assert.equal(ago(new Date().toISOString()), "just now");
  assert.equal(ago(minutesAgo(1)), "1 minute ago");
  assert.equal(ago(minutesAgo(59)), "59 minutes ago");
  assert.equal(ago(minutesAgo(125)), "2 hours ago");
});

test("a lock held by a process that runs refuses, and leaves the lock as it is", () => {
  const f = file();
  const holder = { operation: "release", app: "held-app", from: "the command line", pid: process.ppid, since: null, started: minutesAgo(2) };
  writeFileSync(f, JSON.stringify(holder));
  const taken = takeLock("held-app", "rollback", f);
  assert.equal(taken.ok, false);
  assert.equal(taken.message, "A release of held-app is already running, started from the command line 2 minutes ago. Wait for it to end, then try again.");
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), holder);
});

test("a lock left by a process that has ended is cleared, and taken", () => {
  const f = file();
  const stale = { operation: "release", app: "stale-app", from: "the command line", pid: endedPid(), since: null, started: minutesAgo(30) };
  assert.equal(holderRuns(stale), false);
  writeFileSync(f, JSON.stringify(stale));
  setLockOrigin("the panel");
  const taken = takeLock("stale-app", "rollback", f);
  assert.equal(taken.ok, true);
  assert.equal(taken.cleared.pid, stale.pid);
  const now = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(now.pid, process.pid);
  assert.equal(now.operation, "rollback");
  assert.equal(now.from, "the panel");
  taken.release();
  assert.equal(existsSync(f), false);
  setLockOrigin("the command line");
});

test("taken, then taken again in the same process (a release's own rollback): one lock, let go once", () => {
  const f = file();
  const outer = takeLock("nested-app", "release", f);
  assert.equal(outer.ok, true);
  const inner = takeLock("nested-app", "rollback", f);
  assert.equal(inner.ok, true);
  inner.release();
  assert.equal(existsSync(f), true, "the inner release leaves the outer's lock");
  outer.release();
  assert.equal(existsSync(f), false);
});

test("letting go never removes a lock that another has taken since", () => {
  const f = file();
  const mine = takeLock("taken-app", "backup", f);
  const other = { operation: "release", app: "taken-app", from: "the command line", pid: process.ppid, since: null, started: new Date().toISOString() };
  writeFileSync(f, JSON.stringify(other));
  mine.release();
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), other);
});
