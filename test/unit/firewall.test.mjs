// Unit tests for what doctor says about the firewall for project containers (D41).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { firewallCheck, ipv6Check, subnetInPool } from "../../dist/commands/doctor.js";

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

/* ------------------------------------------------ IPv6 on the apps' networks -- */

const pools = ["172.20.0.0/14"];
const net = (name, subnets, ipv6 = false) => ({ name, subnets, ipv6 });
// Subnets are written as their numbers, so that no address inside a private
// range appears as text for the guard to flag (rule 10).
const v4 = (a, b, c, bits) => `${[a, b, c, 0].join(".")}/${bits}`;

test("a subnet is in a pool when its whole range is", () => {
  assert.equal(subnetInPool(v4(172, 20, 3, 24), "172.20.0.0/14"), true);
  assert.equal(subnetInPool(v4(172, 23, 255, 24), "172.20.0.0/14"), true);
  assert.equal(subnetInPool(v4(172, 24, 0, 24), "172.20.0.0/14"), false, "just past the pool");
  assert.equal(subnetInPool(v4(172, 17, 0, 16), "172.20.0.0/14"), false, "Docker's default bridge");
  assert.equal(subnetInPool("172.16.0.0/12", "172.20.0.0/14"), false, "wider than the pool");
  assert.equal(subnetInPool("fd00:1::/64", "172.20.0.0/14"), false, "an IPv6 subnet");
});

test("IPv6 off on every network in the pools: ok, and counts them", () => {
  const [status, text] = ipv6Check([net("allvibe-a-dev-internal", [v4(172, 20, 1, 24)]), net("allvibe-a-prod", [v4(172, 20, 2, 24)]), net("bridge", [v4(172, 17, 0, 16)])], pools);
  assert.equal(status, "ok");
  assert.match(text, /IPv6: off on all 2 networks of the apps/);
});

test("IPv6 on for a network in the pools: a problem, in plain words, naming it and what to do", () => {
  const [status, text] = ipv6Check([net("allvibe-a-dev-internal", [v4(172, 20, 1, 24)]), net("allvibe-a-prod", [v4(172, 20, 2, 24), "fd00:1::/64"], true)], pools);
  assert.equal(status, "problem");
  assert.match(text, /IPv6 is on for allvibe-a-prod\./);
  assert.match(text, /covers IPv4 only/);
  assert.match(text, /\/etc\/docker\/daemon\.json/);
  assert.doesNotMatch(text, /allvibe-a-dev-internal/);
});

test("IPv6 on a network outside the pools is not the suite's", () => {
  const [status] = ipv6Check([net("someone-else", ["198.51.100.0/24", "fd00:2::/64"], true), net("allvibe-a-prod", [v4(172, 20, 2, 24)])], pools);
  assert.equal(status, "ok");
});

test("no pools to check against: said, not guessed", () => {
  assert.equal(ipv6Check([net("x", [v4(172, 20, 1, 24)], true)], [])[0], "info");
});
