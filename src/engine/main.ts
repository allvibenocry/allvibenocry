/**
 * `allvibe-engine.service` (D62): the engine the panel calls, as the service
 * user, on a Unix socket only. Its folder is the service user's, with the
 * panel's group (install makes it so, 2750); the socket is 0660, so that only
 * the service user and the panel's user can open it. It logs to the journal:
 * what it started, and each operation that changed something or was refused,
 * never an argument's value.
 */
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { NAMES } from "../lib/brand.js";
import { containerState } from "../lib/docker.js";
import { agentContainer, agentState } from "../lib/agent.js";
import { setLockOrigin } from "../lib/lock.js";
import { readOverrides } from "../lib/overrides.js";
import { ensurePanelDoor } from "../lib/panel.js";
import { AuthStore } from "./auth.js";
import { Jobs } from "./jobs.js";
import { terminalStream } from "./operations.js";
import { createEngineServer } from "./server.js";
import { realSuite } from "./suite.js";
import { DEFAULT_IDLE_MS, dockerExec, Terminals } from "./terminal.js";

// Taken now, before any job can take the process's output for itself.
const write = process.stderr.write.bind(process.stderr);
const log = (line: string) => write(`${line}\n`);

// What this process starts, it starts for the panel: the lock says so (D72).
setLockOrigin("the panel");

// The CLI's own umask, left as it is: the operations write files for the
// projects' containers (a restore check's password file, 0644), which a
// tighter one would make unreadable to them. The socket's mode is set below,
// and its folder (2750) keeps everyone else out meanwhile.
mkdirSync(NAMES.engineDir, { recursive: true, mode: 0o2750 });
if (existsSync(NAMES.engineSocket)) unlinkSync(NAMES.engineSocket);

// The agents' terminals (D76): Claude Code, streamed to one browser at a
// time; hung up on after 30 minutes with nothing typed and nothing shown (on
// a test host, what it declares, so that a probe can see it happen).
const idleMs = () => {
  const declared = readOverrides({ file: NAMES.overridesFile });
  const seconds = declared.active ? Number(declared.values.get("terminal-idle-seconds")) : NaN;
  return Number.isInteger(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_IDLE_MS;
};
const terminals = new Terminals(dockerExec, (app) => agentState(app).status === "running", agentContainer, idleMs);
setInterval(() => {
  void terminals.sweep().then((apps) => {
    for (const app of apps) log(`agent.terminal: ${app}, idle, hung up`);
  });
}, 10_000).unref();

const ctx = { suite: realSuite, jobs: new Jobs(), auth: new AuthStore(NAMES.panelAuth), terminals };
const server = createEngineServer(ctx, log, { "agent.terminal": terminalStream(ctx, terminals) });
server.listen(NAMES.engineSocket, () => {
  chmodSync(NAMES.engineSocket, 0o660);
  log(`the engine listens on ${NAMES.engineSocket}`);
  // The panel's door follows the machine's address, which a reboot may have
  // changed (D63). Before install has made the panel, there is none to follow.
  try {
    if (containerState(NAMES.panelContainer).exists) {
      const door = ensurePanelDoor();
      log(`${door.changed ? "the panel's door moved to" : "the panel's door is"} ${door.what}`);
    }
  } catch (error) {
    log(`the panel's door could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
