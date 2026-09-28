// Unit tests for doctor's nightly result, kept for the panel (D58).
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { nightlyResult, readNightly, saveNightly, summarise } from "../../dist/commands/doctor.js";

const checks = [
  { id: "os", status: "ok", text: "Debian 13 on x86-64", scope: "install" },
  { id: "proxy", status: "problem", text: "Reverse proxy: exited, none", scope: "install" },
  { id: "disk", status: "warn", text: "System disk: a spinning hard disk", scope: "install" },
];

test("a failing check is in the result, in its own plain words", () => {
  const result = nightlyResult(checks, new Date("2026-09-29T03:31:00Z"), "0.1.0");
  assert.equal(result.problems, 1);
  assert.equal(result.warnings, 1);
  assert.equal(result.summary, "1 problem(s) and 1 warning(s)");
  assert.equal(result.checks.find((c) => c.id === "proxy").text, "Reverse proxy: exited, none");
  assert.equal(summarise([checks[0]]).summary, "All green.");
});

test("kept as latest.json, and a short history of dated results", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nightly-"));
  try {
    for (let day = 1; day <= 20; day += 1) {
      saveNightly(nightlyResult(checks, new Date(Date.UTC(2026, 8, day, 3, 31)), "0.1.0"), dir, 14);
    }
    const history = readdirSync(dir).filter((f) => f !== "latest.json").sort();
    assert.equal(history.length, 14, "the newest fourteen");
    assert.equal(history[0], "20260907T033100Z.json");
    assert.equal(history.at(-1), "20260920T033100Z.json");
    assert.equal(readNightly(dir).at, "2026-09-20T03:31:00.000Z");
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, history.at(-1)), "utf8")), readNightly(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
