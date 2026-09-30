/**
 * `allvibe-engine.service` (D62): the engine the panel calls, as the service
 * user, on a Unix socket only. Its folder is the service user's, with the
 * panel's group (install makes it so, 2750); the socket is 0660, so that only
 * the service user and the panel's user can open it. It logs to the journal:
 * what it started, and each operation that changed something or was refused,
 * never an argument's value.
 */
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { NAMES } from "../lib/brand.js";
import { agentContainer, agentState } from "../lib/agent.js";
import { setLockOrigin } from "../lib/lock.js";
import { readOverrides } from "../lib/overrides.js";
import { AuthStore } from "./auth.js";
import type { Round } from "./keeper-worker.js";
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
/**
 * The keeper (D80): the panel, its door, the proxy and whatever of the apps
 * Docker could not start, brought back, again and again: every 5 seconds for
 * the first three minutes after the engine starts, when a boot's late things
 * (the machine's address, Docker itself) come in, then every 30 seconds. The
 * door also follows the machine's address, which a reboot or the home router
 * may change (D63). A round runs on a thread of its own, one at a time. What
 * it changed is logged every time; what it could not do, once, until it
 * changes or goes away.
 */
const startedAt = Date.now();
let rounding = false;
let lastProblems = new Set<string>();
function keeperRound(): void {
  if (rounding) return;
  rounding = true;
  const worker = new Worker(new URL("./keeper-worker.js", import.meta.url));
  let done = false;
  const finish = (round: Round | null, failure?: string) => {
    if (done) return;
    done = true;
    rounding = false;
    for (const line of round?.changes ?? []) log(`keeper: ${line}`);
    const problems = new Set(round ? round.problems : [`the round stopped: ${failure}`]);
    for (const line of problems) if (!lastProblems.has(line)) log(`keeper: ${line} (tried again every ${Date.now() - startedAt < 180_000 ? 5 : 30} seconds)`);
    for (const line of lastProblems) if (!problems.has(line)) log(`keeper: no longer: ${line}`);
    lastProblems = problems;
  };
  worker.once("message", (round: Round) => finish(round));
  worker.once("error", (error) => finish(null, error.message));
  worker.once("exit", (code) => finish(null, `its thread ended (${code})`));
}
function scheduleKeeper(): void {
  setTimeout(() => {
    keeperRound();
    scheduleKeeper();
  }, Date.now() - startedAt < 180_000 ? 5_000 : 30_000).unref();
}

server.listen(NAMES.engineSocket, () => {
  chmodSync(NAMES.engineSocket, 0o660);
  log(`the engine listens on ${NAMES.engineSocket}`);
  keeperRound();
  scheduleKeeper();
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
