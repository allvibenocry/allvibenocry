// Unit tests for the pure parts of the host checks. Run: npm test
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { namesFor, parseBrand } from "../../dist/lib/brand.js";
import { isSupportedOs, LOW_MEMORY_MB, memory, parseMemTotalMb, parseOsRelease } from "../../dist/lib/hostfacts.js";
import { parseOverrides, readOverrides } from "../../dist/lib/overrides.js";

const FORBIDDEN = ["no", "cry"].join("");

test("brand.conf: both names are read, and the command must be a plain name", () => {
  assert.deepEqual(parseBrand('PRODUCT_NAME="All vibe no cry"\nCOMMAND_NAME="allvibe"\n'), { product: "All vibe no cry", command: "allvibe" });
  assert.throws(() => parseBrand('PRODUCT_NAME="x"\n'), /COMMAND_NAME/);
  assert.throws(() => parseBrand('PRODUCT_NAME="x"\nCOMMAND_NAME="Has Space"\n'), /lowercase/);
});

test("every name on a host derives from the command, and none contains the forbidden word (rule 9)", () => {
  const names = namesFor("allvibe");
  for (const value of Object.values(names)) {
    assert.ok(String(value).includes("allvibe"), `${value} derives from the command`);
    assert.ok(!String(value).toLowerCase().includes(FORBIDDEN), `${value} is clean`);
  }
  const renamed = namesFor("othername");
  assert.equal(renamed.installDir, "/opt/othername");
  assert.equal(renamed.backupTimer, "othername-backup.timer");
});

test("memory: MemTotal is read in MiB, and under 7 GiB means under 8 GB installed", () => {
  assert.equal(parseMemTotalMb("MemTotal:        4008128 kB\nMemFree: 1 kB\n"), 3914);
  assert.equal(LOW_MEMORY_MB, 7168);
  // An 8 GB machine reports about 7.6 GiB: not low.
  assert.equal(parseMemTotalMb("MemTotal:        7969212 kB\n") < LOW_MEMORY_MB, false);
});

test("memory: a declared value is used only when overrides are active", () => {
  const meminfo = path.join(mkdtempSync(path.join(tmpdir(), "mem-")), "meminfo");
  writeFileSync(meminfo, "MemTotal:        16384000 kB\n");
  const active = { active: true, values: new Map([["memory-mb", "4096"]]), unknown: [] };
  const inactive = { active: false, values: new Map(), unknown: [] };
  assert.deepEqual(memory(active, meminfo), { mb: 4096, low: true, declared: true });
  assert.deepEqual(memory(inactive, meminfo), { mb: 16000, low: false, declared: false });
});

test("os-release: only Debian 13 is supported", () => {
  const trixie = parseOsRelease('PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nID=debian\nVERSION_ID="13"\n');
  const bookworm = parseOsRelease('PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\nVERSION_ID="12"\n');
  const ubuntu = parseOsRelease('ID=ubuntu\nVERSION_ID="24.04"\n');
  assert.equal(isSupportedOs(trixie), true);
  assert.equal(isSupportedOs(bookworm), false);
  assert.equal(isSupportedOs(ubuntu), false);
});

test("overrides: parsed as key=value, comments ignored", () => {
  const values = parseOverrides("# comment\nmemory-mb=16384\n\nsystem-disk = ssd\nbroken\n");
  assert.deepEqual([...values], [["memory-mb", "16384"], ["system-disk", "ssd"]]);
});

test("overrides: honoured only with /.dockerenv AND systemd saying docker", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ovr-"));
  const file = path.join(dir, "test-overrides");
  const dockerenv = path.join(dir, "dockerenv");
  const container = path.join(dir, "container");
  writeFileSync(file, "memory-mb=4096\nnonsense-key=1\n");

  const gate = { file, dockerenv, systemdContainer: container };
  // Neither file: a real machine. Ignored, and said so.
  let result = readOverrides(gate);
  assert.equal(result.active, false);
  assert.equal(result.values.size, 0);
  assert.match(result.ignored, /not a Docker test container/);

  // /.dockerenv alone is not enough.
  writeFileSync(dockerenv, "");
  assert.equal(readOverrides(gate).active, false);

  // systemd saying something else (WSL, LXC) is not enough either.
  writeFileSync(container, "lxc\n");
  assert.equal(readOverrides(gate).active, false);

  writeFileSync(container, "docker\n");
  result = readOverrides(gate);
  assert.equal(result.active, true);
  assert.equal(result.values.get("memory-mb"), "4096");
  assert.deepEqual(result.unknown, ["nonsense-key"]);
});
