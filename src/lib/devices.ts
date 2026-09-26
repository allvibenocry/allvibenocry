/**
 * Where a path really lives: its mount, its filesystem, and the physical disks
 * under it. Used to refuse a backup target that is not off the machine
 * (rule 2, D22).
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { posix as path } from "node:path";

export interface Mount {
  majMin: string;
  mountPoint: string;
  fsType: string;
  source: string;
}

/** /proc/self/mountinfo, one mount per line. */
export function parseMountinfo(text: string): Mount[] {
  const mounts: Mount[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [left, right] = line.split(" - ");
    if (!right) continue;
    const fields = left.split(" ");
    const [fsType, source] = right.split(" ");
    mounts.push({ majMin: fields[2], mountPoint: unescape(fields[4]), fsType, source: unescape(source ?? "") });
  }
  return mounts;
}

/** mountinfo escapes spaces and a few other characters as octal. */
const unescape = (text: string) => text.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));

/** The mount a path is on: the longest mount point that contains it (the last one wins when stacked). */
export function mountOf(target: string, mounts: Mount[]): Mount {
  let best: Mount | null = null;
  for (const mount of mounts) {
    const point = mount.mountPoint;
    const inside = point === "/" || target === point || target.startsWith(`${point}/`);
    if (inside && (!best || point.length >= best.mountPoint.length)) best = mount;
  }
  if (!best) throw new Error(`no mount contains ${target}`);
  return best;
}

export const NETWORK_FILESYSTEMS = new Set(["nfs", "nfs4", "cifs", "smb3", "fuse.sshfs", "ceph", "glusterfs", "fuse.glusterfs", "9p"]);

/**
 * The whole disks a block device sits on, through partitions and device-mapper
 * layers (LVM, LUKS): `/sys/dev/block/<maj:min>`. Empty when the device is not
 * a block device (an overlay, a tmpfs).
 */
export function disksOf(majMin: string, sys = "/sys"): Set<string> {
  const disks = new Set<string>();
  const visit = (node: string) => {
    let real: string;
    try {
      real = realpathSync(node);
    } catch {
      return;
    }
    const slaves = path.join(real, "slaves");
    if (existsSync(slaves) && readdirSync(slaves).length > 0) {
      for (const slave of readdirSync(slaves)) visit(path.join(slaves, slave));
      return;
    }
    // A partition's directory is inside its disk's: /sys/devices/.../sda/sda1.
    const isPartition = existsSync(path.join(real, "partition"));
    disks.add(path.basename(isPartition ? path.dirname(real) : real));
  };
  visit(path.join(sys, "dev", "block", majMin));
  return disks;
}

export interface Placement {
  path: string;
  mount: Mount;
  disks: Set<string>;
  network: boolean;
}

export function placementOf(target: string, mountinfo = "/proc/self/mountinfo"): Placement {
  const real = realpathSync(target);
  const mount = mountOf(real, parseMountinfo(readFileSync(mountinfo, "utf8")));
  return { path: real, mount, disks: disksOf(mount.majMin), network: NETWORK_FILESYSTEMS.has(mount.fsType) };
}

export interface OffMachineVerdict {
  ok: boolean;
  why: string;
}

/**
 * Is a backup target off the machine's own disks? `declaredExternal` is the
 * test host's override (D14): the one mount point it names counts as a
 * separate disk. Nothing else is ever excused, and the root filesystem never.
 */
export function judgeTarget(target: Placement, root: Placement, data: Placement, declaredExternal?: string): OffMachineVerdict {
  if (target.mount.mountPoint === "/" || target.mount.majMin === root.mount.majMin) {
    return { ok: false, why: `${target.path} is on this machine's own root filesystem, which is not off the machine` };
  }
  if (target.network) {
    return { ok: true, why: `${target.path} is a ${target.mount.fsType} share (${target.mount.source}): off the machine` };
  }
  if (declaredExternal && target.mount.mountPoint === declaredExternal) {
    return { ok: true, why: `${target.mount.mountPoint} is declared a separate disk by the test host (D14)` };
  }
  if (target.mount.majMin === data.mount.majMin) {
    return { ok: false, why: `${target.path} is on the same filesystem as the data it would back up (${data.path})` };
  }
  const shared = [...target.disks].filter((disk) => data.disks.has(disk) || root.disks.has(disk));
  if (shared.length > 0) {
    return { ok: false, why: `${target.path} is on disk ${shared.join(", ")}, the same physical disk as this machine's system or data` };
  }
  if (target.disks.size === 0) {
    return { ok: false, why: `${target.path} is on ${target.mount.fsType} (${target.mount.source}), which is not a disk that could be told apart from this machine` };
  }
  return { ok: true, why: `${target.path} is on disk ${[...target.disks].join(", ")}, separate from this machine's system and data` };
}
