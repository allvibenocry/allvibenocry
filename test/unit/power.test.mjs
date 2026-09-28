// Unit tests for mains and battery (D59), through stand-ins for the kernel's
// /sys/class/power_supply.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { duration, powerCheck, readPower } from "../../dist/lib/power.js";

function supplies(spec) {
  const root = mkdtempSync(path.join(tmpdir(), "power-"));
  for (const [name, files] of Object.entries(spec)) {
    mkdirSync(path.join(root, name));
    for (const [file, value] of Object.entries(files)) writeFileSync(path.join(root, name, file), `${value}\n`);
  }
  return root;
}
const say = (spec) => {
  const root = supplies(spec);
  try {
    return powerCheck(readPower(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("on mains, with a battery: ok, and its charge", () => {
  const r = say({ AC: { type: "Mains", online: 1 }, BAT0: { type: "Battery", status: "Charging", capacity: 80, energy_now: 30000000, power_now: 15000000 } });
  assert.equal(r.status, "ok");
  assert.equal(r.text, "Power: on mains; the battery is at 80%, charging, ready to carry the machine through a power cut");
});

test("on battery: a warning, with the time left from energy and power", () => {
  const r = say({ AC: { type: "Mains", online: 0 }, BAT0: { type: "Battery", status: "Discharging", capacity: 60, energy_now: 30000000, power_now: 18000000 } });
  assert.equal(r.status, "warn");
  assert.equal(r.text, "Power: ON BATTERY, at 60%, about 1 hour and 40 minutes left. The apps keep running; plug the machine in");
});

test("low battery: a problem, from charge and current", () => {
  const r = say({ AC: { type: "Mains", online: 0 }, BAT0: { type: "Battery", status: "Discharging", capacity: 12, charge_now: 500000, current_now: 1500000 } });
  assert.equal(r.status, "problem");
  assert.match(r.text, /^Power: ON BATTERY, and it is low: at 12%, about 20 minutes left\. The machine will switch itself off soon/);
});

test("no battery: says so, without failing", () => {
  assert.deepEqual(say({ AC: { type: "Mains", online: 1 } }), {
    status: "info",
    text: "Power: no battery, so a power cut stops the machine at once (a battery or a small UPS would carry it through a short one)",
  });
  assert.equal(say({}).status, "info", "no supplies at all, as in a virtual machine");
  assert.equal(powerCheck(readPower("/no/such/dir")).status, "info");
});

test("the machine's own time left wins; a battery reported absent is not one", () => {
  const r = say({ BAT0: { type: "Battery", status: "Discharging", capacity: 50, time_to_empty_now: 7200 } });
  assert.equal(r.status, "warn", "no mains supply reported, and discharging: on battery");
  assert.match(r.text, /about 2 hours left/);
  assert.equal(say({ AC: { type: "Mains", online: 1 }, BAT0: { type: "Battery", present: 0, status: "Unknown" } }).status, "info");
  assert.equal(duration(25), "about 25 minutes");
  assert.equal(duration(61), "about 1 hour");
});
