// Unit tests for what doctor says about the firewall for project containers (D41).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { firewallCheck } from "../../dist/commands/doctor.js";

const now = new Date("2026-09-29T12:00:00Z");
function withStatus(status, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "firewall-test-"));
  const file = path.join(dir, "firewall.json");
  if (status !== undefined) writeFileSync(file, JSON.stringify(status));
  try {
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("in place and checked recently: ok, in plain words", () => {
  const [status, text] = withStatus({ checked: "2026-09-29T11:57:00Z", ok: true, repaired: false, problems: [] }, (f) => firewallCheck(now, f));
  assert.equal(status, "ok");
  assert.match(text, /cannot reach this machine's own ports or the home network \(checked 3 minutes ago\)/);
});

test("put back by the check: ok, and says so", () => {
  const [status, text] = withStatus({ checked: "2026-09-29T11:59:30Z", ok: true, repaired: true, problems: ["INPUT does not start with ALLVIBE-IN"] }, (f) => firewallCheck(now, f));
  assert.equal(status, "ok");
  assert.match(text, /was not in place, and was put back/);
});

test("not in place: a problem that names what is missing and how to put it back", () => {
  const [status, text] = withStatus({ checked: "2026-09-29T11:59:00Z", ok: false, problems: ["INPUT does not start with ALLVIBE-IN"] }, (f) => firewallCheck(now, f));
  assert.equal(status, "problem");
  assert.match(text, /NOT in place \(INPUT does not start with ALLVIBE-IN\)/);
  assert.match(text, /systemctl restart allvibe-firewall\.service/);
});

test("not checked for too long, or never: a problem", () => {
  const [stale] = withStatus({ checked: "2026-09-29T11:30:00Z", ok: true, problems: [] }, (f) => firewallCheck(now, f));
  assert.equal(stale, "problem");
  const [never, text] = withStatus(undefined, (f) => firewallCheck(now, f));
  assert.equal(never, "problem");
  assert.match(text, /has not been checked/);
});
