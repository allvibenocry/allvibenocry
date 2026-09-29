/**
 * A job's own thread (D77): what its command prints, and each step as it
 * starts, go to the engine as messages, in the order they happen; the app's
 * lock, which the engine took for the job, is adopted; and how the command
 * ended is said last. job-worker.ts runs the CLI's commands with it, and the
 * tests their own, through the same plumbing.
 */
import { parentPort, workerData } from "node:worker_threads";
import { adoptLock, setLockOrigin } from "../lib/lock.js";
import { stepEvents } from "../lib/steps.js";
import type { JobMessage, JobOrder } from "./jobs.js";

export function runHere(command: (order: JobOrder) => Promise<number> | number): void {
  const order = workerData as JobOrder;
  const post = (message: JobMessage) => parentPort?.postMessage(message);
  const take = (chunk: unknown): boolean => {
    post({ t: "text", chunk: typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8") });
    return true;
  };
  process.stdout.write = take as typeof process.stdout.write;
  process.stderr.write = take as typeof process.stderr.write;
  stepEvents.onStart = (n, total, name) => post({ t: "start", n, total, name });
  setLockOrigin("the panel");
  if (order.lock) adoptLock(order.app, order.lock);
  Promise.resolve()
    .then(() => command(order))
    .then(
      (code) => post({ t: "done", code }),
      (error: unknown) => post({ t: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
}
