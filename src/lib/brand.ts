/**
 * The product's names, read from brand.conf, where each is defined once (D1),
 * and every name derived from the command.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The directory holding brand.conf and dist/: the repository, or the installation. */
export const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Brand {
  product: string;
  command: string;
}

export function parseBrand(text: string): Brand {
  const value = (key: string) => {
    const match = text.match(new RegExp(`^${key}="?([^"\\n]*)"?\\s*$`, "m"));
    if (!match || match[1].trim() === "") throw new Error(`brand.conf does not define ${key}`);
    return match[1].trim();
  };
  const brand = { product: value("PRODUCT_NAME"), command: value("COMMAND_NAME") };
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(brand.command)) {
    throw new Error(`brand.conf: COMMAND_NAME "${brand.command}" must be lowercase letters, digits and dashes`);
  }
  return brand;
}

export const BRAND = parseBrand(readFileSync(path.join(INSTALL_ROOT, "brand.conf"), "utf8"));

/** Every name on a host, derived from the command (D1). */
export function namesFor(command: string) {
  const etc = `/etc/${command}`;
  const state = `/var/lib/${command}`;
  return {
    command,
    user: command,
    installDir: `/opt/${command}`,
    etcDir: etc,
    stateDir: state,
    configFile: `${etc}/config.json`,
    overridesFile: `${etc}/test-overrides`,
    hostKey: `${etc}/backup-host.key`,
    hostRecipient: `${etc}/backup-host.pub`,
    recoveryRecipient: `${etc}/recovery.pub`,
    recoveryPending: `${etc}/recovery-key-UNCONFIRMED.txt`,
    recoveryConfirmed: `${etc}/recovery-confirmed.json`,
    projectsDir: `${state}/projects`,
    runsDir: `${state}/runs`,
    proxyDir: `${state}/proxy`,
    toolsDir: `${state}/tools`,
    /** Memory only (a tmpfs): the vault's keys, decrypted, while apps run (D37). */
    runDir: `/run/${command}`,
    keysRunDir: `/run/${command}/keys`,
    backupService: `${command}-backup.service`,
    backupTimer: `${command}-backup.timer`,
    keysService: `${command}-keys.service`,
    /** Written by the root-owned firewall check, read by doctor (D41). */
    firewallStatus: `/run/${command}/firewall.json`,
    firewallService: `${command}-firewall.service`,
    firewallTimer: `${command}-firewall-check.timer`,
    proxyProject: `${command}-proxy`,
    proxyContainer: `${command}-proxy`,
    /** The prefix of every Docker label the suite sets. */
    label: command,
  };
}

export const NAMES = namesFor(BRAND.command);
