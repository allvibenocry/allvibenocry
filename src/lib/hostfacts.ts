/**
 * What kind of machine this is: the facts install.sh checks before it installs
 * anything and `doctor` reports afterwards. install.sh has its own bash copy of
 * these checks, because it runs before Node is installed; the thresholds are
 * the same and the tests hold both to the same answers.
 */
import { readFileSync } from "node:fs";
import type { Overrides } from "./overrides.js";
import { tryRun } from "./run.js";

/**
 * Warn under 8 GB installed. The kernel reports a little less than what is
 * installed (an 8 GB machine shows about 7.6 GiB), so the line is drawn at
 * 7 GiB: anything below that has less than 8 GB installed.
 */
export const LOW_MEMORY_MB = 7 * 1024;

export interface OsInfo {
  id: string;
  versionId: string;
  pretty: string;
}

export function parseOsRelease(text: string): OsInfo {
  const value = (key: string) => text.match(new RegExp(`^${key}="?([^"\\n]*)"?`, "m"))?.[1] ?? "";
  return { id: value("ID"), versionId: value("VERSION_ID"), pretty: value("PRETTY_NAME") };
}

export function osInfo(file = "/etc/os-release"): OsInfo {
  try {
    return parseOsRelease(readFileSync(file, "utf8"));
  } catch {
    return { id: "", versionId: "", pretty: "unknown" };
  }
}

export const isSupportedOs = (os: OsInfo) => os.id === "debian" && os.versionId === "13";
export const isSupportedArch = (arch = process.arch) => arch === "x64";

export interface MemoryFact {
  mb: number;
  low: boolean;
  declared: boolean;
}

export function parseMemTotalMb(meminfo: string): number {
  const kb = Number(meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m)?.[1] ?? NaN);
  return Math.floor(kb / 1024);
}

export function memory(overrides: Overrides, meminfo = "/proc/meminfo"): MemoryFact {
  const declared = overrides.active ? overrides.values.get("memory-mb") : undefined;
  const mb = declared !== undefined ? Number(declared) : parseMemTotalMb(readFileSync(meminfo, "utf8"));
  return { mb, low: mb < LOW_MEMORY_MB, declared: declared !== undefined };
}

export type DiskKind = "ssd" | "rotational" | "unknown";

export interface DiskFact {
  kind: DiskKind;
  device: string;
  declared: boolean;
}

/**
 * The system disk: the block device under `/`, and whether the kernel calls it
 * rotational. A root that is not a block device (an overlay, as in a container)
 * is `unknown`: nothing to measure.
 */
export function systemDisk(overrides: Overrides): DiskFact {
  const declared = overrides.active ? overrides.values.get("system-disk") : undefined;
  if (declared === "ssd" || declared === "rotational") return { kind: declared, device: "(declared)", declared: true };

  const source = tryRun("findmnt", ["-n", "-o", "SOURCE", "/"]).stdout.trim();
  if (!source.startsWith("/dev/")) return { kind: "unknown", device: source || "?", declared: false };
  const rota = tryRun("lsblk", ["-n", "-d", "-o", "ROTA", source]).stdout.trim();
  return { kind: rota === "1" ? "rotational" : rota === "0" ? "ssd" : "unknown", device: source, declared: false };
}
