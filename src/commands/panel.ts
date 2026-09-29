/**
 * `allvibe panel`: the control panel's container and its sign-in, on the
 * machine (D63, D64).
 *
 *   panel install                  its image, network, container and door (install.sh runs it)
 *   panel setup-code [--if-new]    a one-time code for the first visit, while nobody has claimed it
 *   panel reset                    a forgotten password: unclaimed again, a new code, everyone signed out
 *   panel status                   where it answers, and whether it is set up
 *
 * The setup code is shown here, on the machine, and nowhere else: it is kept
 * only as a hash, so it cannot be shown again; a new one replaces it.
 */
import { NAMES } from "../lib/brand.js";
import { containerState, tryDocker, waitHealthy } from "../lib/docker.js";
import { ensurePanel, panelWhere } from "../lib/panel.js";
import { AuthStore, showCode } from "../engine/auth.js";

const C = NAMES.command;
const USAGE = `usage: ${C} panel install | setup-code [--if-new] | reset | status`;

async function install(): Promise<number> {
  for (const change of await ensurePanel()) process.stdout.write(`       ${change.changed ? "changed" : "unchanged"}: ${change.what}\n`);
  return 0;
}

function showNew(code: string): void {
  process.stdout.write(
    `The control panel: ${panelWhere()}\n` +
      `Its setup code, for your first visit: ${showCode(code)}\n` +
      "It works once. It is shown here, on the machine, and nowhere else.\n",
  );
}

function setupCode(ifNew: boolean): number {
  const store = new AuthStore(NAMES.panelAuth);
  const status = store.status();
  if (status.claimed) {
    process.stdout.write(`The control panel: ${panelWhere()}\nIt is set up: sign in with its password.\n`);
    return ifNew ? 0 : 1;
  }
  if (ifNew && status.hasCode) {
    process.stdout.write(
      `The control panel: ${panelWhere()}\n` +
        `It waits for the setup code shown when it was made. A new one, which replaces it: sudo ${C} panel setup-code\n`,
    );
    return 0;
  }
  showNew(store.newSetupCode());
  return 0;
}

async function reset(): Promise<number> {
  showNew(new AuthStore(NAMES.panelAuth).reset());
  // Sessions live in the panel's memory: a restart signs everyone out.
  if (containerState(NAMES.panelContainer).status === "running") {
    tryDocker(["restart", NAMES.panelContainer]);
    await waitHealthy(NAMES.panelContainer, 60_000);
  }
  process.stdout.write("Everyone is signed out. The old password no longer works.\n");
  return 0;
}

function status(): number {
  const auth = new AuthStore(NAMES.panelAuth).status();
  const state = containerState(NAMES.panelContainer);
  process.stdout.write(
    `The control panel: ${panelWhere()}\n` +
      `  its container: ${state.exists ? `${state.status}, ${state.health}` : "not there"}\n` +
      `  ${auth.claimed ? "set up: sign in with its password" : auth.hasCode ? "waiting for its setup code" : `not set up, and no setup code: sudo ${C} panel setup-code`}` +
      `${auth.pausedFor ? `; signing in is paused for ${auth.pausedFor} seconds after wrong tries` : ""}\n`,
  );
  return 0;
}

export async function panel(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "install" && !rest.length) return install();
  if (sub === "setup-code" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--if-new"))) return setupCode(rest[0] === "--if-new");
  if (sub === "reset" && !rest.length) return reset();
  if (sub === "status" && !rest.length) return status();
  process.stderr.write(`${USAGE}\n`);
  return 2;
}
