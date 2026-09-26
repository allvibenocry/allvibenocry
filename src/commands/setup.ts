/**
 * `allvibe setup`: the suite's own state on a host, made what it should be.
 * install.sh runs it after it has installed the files. Idempotent: every step
 * says "changed" or "unchanged", and a second run changes nothing.
 */
import { mkdirSync } from "node:fs";
import { NAMES } from "../lib/brand.js";
import { readConfig, writeConfig } from "../lib/config.js";
import { ensureHostKey, ensureRecoveryKey } from "../lib/keys.js";
import { ensureProxy } from "../lib/proxy.js";
import { ok, runSteps } from "../lib/steps.js";

const said = (changed: boolean, what: string) => ok(`${changed ? "changed" : "unchanged"}: ${what}`, changed);

export async function setup(): Promise<number> {
  const config = readConfig();
  const record = await runSteps(
    [
      {
        name: "configuration",
        run: () => said(writeConfig(config), NAMES.configFile),
      },
      {
        name: "state directories",
        run: () => {
          let made = false;
          for (const dir of [NAMES.projectsDir, NAMES.runsDir, NAMES.proxyDir]) {
            made = mkdirSync(dir, { recursive: true, mode: 0o750 }) !== undefined || made;
          }
          return said(made, `${NAMES.projectsDir}, ${NAMES.runsDir}, ${NAMES.proxyDir}`);
        },
      },
      {
        name: "backup key for restore tests",
        run: () => said(ensureHostKey(), `${NAMES.hostKey} (never printed)`),
      },
      {
        name: "recovery key",
        run: () => {
          const made = ensureRecoveryKey();
          return said(
            made,
            made
              ? `recovery key created; it waits in ${NAMES.recoveryPending} until you copy it off this machine and confirm it (never printed)`
              : `${NAMES.recoveryRecipient} exists`,
          );
        },
      },
      {
        name: "reverse proxy",
        run: async () => {
          const { changed, evidence } = await ensureProxy(config);
          return said(changed, evidence);
        },
      },
    ],
    { kind: "setup" },
  );
  return record.ok ? 0 : 1;
}
