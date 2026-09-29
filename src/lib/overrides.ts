/**
 * Test overrides (D14): the hardware a test host declares, because a container
 * cannot measure it. Honoured only inside a Docker container, so they cannot be
 * set by accident on a real machine.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * power-supply-dir: a stand-in for /sys/class/power_supply, for the tests of mains and battery (D59).
 * apps-host: where the workstation's browser reaches the test host's apps, through the harness's
 * forwarded ports, instead of the machine's own address, which it cannot reach (D74).
 */
export const KNOWN_OVERRIDES = ["memory-mb", "system-disk", "external-backup-mount", "power-supply-dir", "apps-host"] as const;
export type OverrideKey = (typeof KNOWN_OVERRIDES)[number];

export interface Overrides {
  /** True when the file exists and this is a Docker container. */
  active: boolean;
  values: Map<string, string>;
  /** Set when a file exists but is ignored, and why. */
  ignored?: string;
  unknown: string[];
}

export interface OverrideGate {
  file: string;
  dockerenv?: string;
  systemdContainer?: string;
}

export function parseOverrides(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return values;
}

/**
 * Both must hold: Docker's `/.dockerenv` exists, and systemd was started with
 * `container=docker`, which it records in `/run/systemd/container`.
 * `systemd-detect-virt` is not asked: on Docker Desktop it answers `wsl`.
 */
export function inDockerContainer(dockerenv = "/.dockerenv", systemdContainer = "/run/systemd/container"): boolean {
  if (!existsSync(dockerenv)) return false;
  try {
    return readFileSync(systemdContainer, "utf8").trim() === "docker";
  } catch {
    return false;
  }
}

export function readOverrides(gate: OverrideGate): Overrides {
  if (!existsSync(gate.file)) return { active: false, values: new Map(), unknown: [] };
  const values = parseOverrides(readFileSync(gate.file, "utf8"));
  const unknown = [...values.keys()].filter((key) => !(KNOWN_OVERRIDES as readonly string[]).includes(key));
  if (!inDockerContainer(gate.dockerenv, gate.systemdContainer)) {
    return {
      active: false,
      values: new Map(),
      unknown,
      ignored: `${gate.file} exists, but this machine is not a Docker test container, so it is ignored`,
    };
  }
  return { active: true, values, unknown };
}
