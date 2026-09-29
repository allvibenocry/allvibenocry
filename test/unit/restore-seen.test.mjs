// doctor counts the restore check that a release or going back made (D73,
// friction log 4): the newest restore check in the records, whoever ran it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lastRestoreCheck, RESTORE_CHECK_FIRST, RESTORE_CHECK_LAST } from "../../dist/lib/steps.js";

const CHECK = [RESTORE_CHECK_FIRST, "it is whole, and it decrypts", "its key vault restores", "it restores into a scratch copy", RESTORE_CHECK_LAST];
const step = (name, ok = true) => ({ name, ok, evidence: "" });
const record = (kind, started, steps, facts = {}, project = "hello") => ({
  kind, project, started, finished: started, ok: steps.every((s) => s.ok), dryRun: false, steps, failedStep: steps.find((s) => !s.ok)?.name ?? null, facts,
});

test("a release that restore-checked its backup counts, with its entries", () => {
  const records = [
    record("restore-check", "2026-09-28T03:30:00Z", CHECK.map((n) => step(n)), { entries: 1 }),
    record("release", "2026-09-29T10:00:00Z", [step("dev runs the commit"), ...CHECK.map((n) => step(n)), step("prod deployed on v2")], { entries: 3 }),
  ];
  assert.deepEqual(lastRestoreCheck("hello", records), { at: "2026-09-29T10:00:00Z", ok: true, failedStep: null, entries: 3, kind: "release" });
});

test("going back counts the same way", () => {
  const records = [record("rollback", "2026-09-29T11:00:00Z", [step("the recovery key"), ...CHECK.map((n) => step(n)), step("prod's data")], { entries: 4 })];
  assert.equal(lastRestoreCheck("hello", records).kind, "rollback");
});

test("a release that stopped before its restore check made none, and the one before counts", () => {
  const records = [
    record("restore-check", "2026-09-28T03:30:00Z", CHECK.map((n) => step(n)), { entries: 1 }),
    record("release", "2026-09-29T10:00:00Z", [step("dev runs the commit"), step("every step of the plan is tried by you", false)]),
  ];
  assert.equal(lastRestoreCheck("hello", records).kind, "restore-check");
  assert.equal(lastRestoreCheck("hello", records).ok, true);
});

test("a release that stopped inside its restore check made a failed one", () => {
  const records = [record("release", "2026-09-29T10:00:00Z", [step("dev runs the commit"), step(CHECK[0]), step(CHECK[1], false)])];
  assert.deepEqual(lastRestoreCheck("hello", records), { at: "2026-09-29T10:00:00Z", ok: false, failedStep: CHECK[1], entries: null, kind: "release" });
});

test("another project's records, and other kinds, are passed over", () => {
  const records = [
    record("release", "2026-09-29T10:00:00Z", CHECK.map((n) => step(n)), {}, "other"),
    record("dev-deploy", "2026-09-29T10:05:00Z", [step("dev deployed")]),
  ];
  assert.equal(lastRestoreCheck("hello", records), null);
});
