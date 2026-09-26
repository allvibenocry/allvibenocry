// Unit tests for deciding whether a backup target is off the machine (D22).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { disksOf, judgeTarget, mountOf, parseMountinfo } from "../../dist/lib/devices.js";

const MOUNTINFO = [
  "22 1 8:2 / / rw,relatime shared:1 - ext4 /dev/sda2 rw",
  "30 22 8:17 / /mnt/usb rw,relatime shared:9 - ext4 /dev/sdb1 rw",
  "31 22 8:3 / /mnt/second\\040partition rw,relatime shared:10 - ext4 /dev/sda3 rw",
  "32 22 0:50 / /mnt/nas rw,relatime shared:11 - nfs4 nas.example:/backups rw",
  "33 22 0:26 / /run rw,nosuid - tmpfs tmpfs rw",
].join("\n");

const place = (target, disks, network = false) => {
  const mount = mountOf(target, parseMountinfo(MOUNTINFO));
  return { path: target, mount, disks: new Set(disks), network };
};

test("mountinfo: mount points unescaped, the longest match wins", () => {
  const mounts = parseMountinfo(MOUNTINFO);
  assert.equal(mounts.length, 5);
  assert.equal(mounts[2].mountPoint, "/mnt/second partition");
  assert.equal(mountOf("/mnt/usb/allvibe", mounts).majMin, "8:17");
  assert.equal(mountOf("/var/lib/docker", mounts).mountPoint, "/");
  assert.equal(mountOf("/mnt/usbx", mounts).mountPoint, "/", "a prefix that is not a path component does not count");
});

test("judging a target: a separate disk passes, everything on this machine's disks is refused", () => {
  const root = place("/", ["sda"]);
  const data = place("/var/lib/docker", ["sda"]);
  assert.equal(judgeTarget(place("/mnt/usb/allvibe", ["sdb"]), root, data).ok, true);
  assert.match(judgeTarget(place("/var/backups", ["sda"]), root, data).why, /own root filesystem/);
  assert.match(judgeTarget(place("/mnt/second partition", ["sda"]), root, data).why, /same physical disk/);
  assert.match(judgeTarget(place("/run/backups", []), root, data).why, /not a disk/);
  assert.equal(judgeTarget(place("/mnt/nas/x", [], true), root, data).ok, true, "a network share is off the machine");
});

test("judging a target: the test override excuses exactly the declared mount, and never the root filesystem", () => {
  const root = place("/", []);
  const data = place("/mnt/usb", ["sdb"]);
  const target = place("/mnt/usb/backups", ["sdb"]);
  assert.match(judgeTarget(target, root, data).why, /same filesystem/);
  assert.equal(judgeTarget(target, root, data, "/mnt/usb").ok, true);
  assert.match(judgeTarget(target, root, data, "/mnt/other").why, /same filesystem/);
  assert.match(judgeTarget(place("/var/x", []), root, data, "/").why, /own root filesystem/);
});

// Linux only: it builds a fake /sys with symlinks and "8:2" names. It runs in CI.
test("disks: a partition resolves to its disk, and LVM through its slaves", { skip: process.platform !== "linux" && "a fake /sys needs Linux; runs in CI" }, () => {
  const sys = mkdtempSync(path.join(tmpdir(), "sys-"));
  const devices = path.join(sys, "devices");
  // sda with partition sda2; dm-0 (LVM) on top of sdb1 and sdc1.
  for (const dir of ["sda/sda2", "sdb/sdb1", "sdc/sdc1", "dm-0/slaves"]) mkdirSync(path.join(devices, dir), { recursive: true });
  for (const part of ["sda/sda2", "sdb/sdb1", "sdc/sdc1"]) writeFileSync(path.join(devices, part, "partition"), "1");
  symlinkSync(path.join(devices, "sdb/sdb1"), path.join(devices, "dm-0/slaves/sdb1"));
  symlinkSync(path.join(devices, "sdc/sdc1"), path.join(devices, "dm-0/slaves/sdc1"));
  mkdirSync(path.join(sys, "dev/block"), { recursive: true });
  symlinkSync(path.join(devices, "sda/sda2"), path.join(sys, "dev/block/8:2"));
  symlinkSync(path.join(devices, "dm-0"), path.join(sys, "dev/block/253:0"));

  assert.deepEqual([...disksOf("8:2", sys)], ["sda"]);
  assert.deepEqual([...disksOf("253:0", sys)].sort(), ["sdb", "sdc"]);
  assert.deepEqual([...disksOf("0:50", sys)], [], "not a block device");
});
