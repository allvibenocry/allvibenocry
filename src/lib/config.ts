/**
 * The host's configuration: /etc/<command>/config.json. Created by `setup` with
 * defaults, and kept when it exists, so a second install changes nothing.
 */
import { NAMES } from "./brand.js";
import { ensureFile, readJson } from "./files.js";

export interface HostConfig {
  /** The first port the proxy uses: prod of project i is base + 2i, dev base + 2i + 1 (D16). */
  portBase: number;
  /** How many projects fit in the port range. */
  maxProjects: number;
  /** Where backups go: a mounted directory on another device (D13, item 6). */
  backupTarget: string | null;
  /** Days a scheduled backup is kept (release backups are kept apart). */
  backupRetentionDays: number;
}

export const DEFAULT_CONFIG: HostConfig = {
  portBase: 8100,
  maxProjects: 49,
  backupTarget: null,
  backupRetentionDays: 30,
};

export function readConfig(file = NAMES.configFile): HostConfig {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<HostConfig>>(file, {}) };
}

export function writeConfig(config: HostConfig, file = NAMES.configFile): boolean {
  return ensureFile(file, `${JSON.stringify(config, null, 2)}\n`, 0o640);
}

/** The proxy's own health endpoint, on loopback, at the top of the range. */
export const statusPort = (config: HostConfig) => config.portBase + 99;
