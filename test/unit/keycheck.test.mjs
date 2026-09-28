// Unit tests for the key check's hook and checker (D38).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_SCANNER_PATH, checkerScript, hookScript, scannerPath, SCANNER_IMAGE, SCANNER_SHA256 } from "../../dist/lib/keycheck.js";

test("the scanner is the same pinned gitleaks as CI's, and its binary is pinned too", () => {
  assert.match(SCANNER_IMAGE, /^ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:[0-9a-f]{64}$/);
  assert.match(SCANNER_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(scannerPath(), "/var/lib/allvibe/tools/gitleaks-8.30.1/gitleaks");
});

test("the hook hands over to the checker beside it", () => {
  assert.match(hookScript(), /^#!\/bin\/sh\n/);
  assert.match(hookScript(), /exec node "\$\(dirname "\$0"\)\/allvibe-key-check\.cjs"/);
});

test("the checker looks for the scanner on the host and in the agent's image, and stops if there is none", () => {
  const checker = checkerScript();
  assert.ok(checker.includes(JSON.stringify([scannerPath(), AGENT_SCANNER_PATH])));
  assert.match(checker, /the key check could not run/);
  assert.doesNotThrow(() => new Function("require", "process", checker.replace(/^"use strict";/, "")), "it is valid JavaScript");
});

test("the checker scans what is staged, redacted, and reads only file, line and rule", () => {
  const checker = checkerScript();
  assert.match(checker, /"git", "--pre-commit", "--staged", "--redact"/);
  assert.match(checker, /f\.File/);
  assert.match(checker, /f\.StartLine/);
  assert.match(checker, /f\.RuleID/);
  assert.doesNotMatch(checker, /f\.(Secret|Match|Line)\b/, "never the value, nor the line it is on");
  assert.doesNotMatch(checker, /stdio:\s*"inherit"/, "the scanner's own output is not shown");
});
