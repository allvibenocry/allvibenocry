/**
 * One round of the keeper (D80), off the engine's thread: it waits on Docker,
 * for seconds when it starts something, and the engine answers meanwhile
 * (mistakes 47 and 52). What it changed, and what it could not do, go back to
 * the engine, which logs them.
 */
import { parentPort } from "node:worker_threads";
import { keepContainers } from "../lib/keeper.js";
import { setLockOrigin } from "../lib/lock.js";
import { keepPanel } from "../lib/panel.js";

export interface Round {
  changes: string[];
  problems: string[];
}

setLockOrigin("the machine");
const round: Round = { changes: [], problems: [] };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
try {
  for (const change of keepPanel()) if (change.changed) round.changes.push(change.what.startsWith("door ") ? `the panel's door, written again: ${change.what.slice(5)}` : change.what);
} catch (error) {
  round.problems.push(`the panel: ${message(error)}`);
}
try {
  for (const line of keepContainers()) (/ started again /.test(line) ? round.changes : round.problems).push(line);
} catch (error) {
  round.problems.push(`the containers: ${message(error)}`);
}
parentPort?.postMessage(round);
