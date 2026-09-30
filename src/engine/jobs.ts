/**
 * Long operations, one at a time (D62). A job runs a CLI command, the same
 * function `allvibe` runs, and keeps what it prints, step by step: the steps
 * are the CLI's own (`runSteps`), announced as each one starts and read back
 * from its printed lines as each one ends, so the panel shows exactly what the
 * command prints and stops where it stops (rule 7). The command runs on a
 * thread of its own (job-worker.ts, D77), so the engine answers meanwhile.
 */
import { randomBytes } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { LongKind, SignIn } from "./operations.js";

export interface JobStep {
  n: number;
  total: number;
  name: string;
  state: "running" | "ok" | "failed";
  lines: string[];
}

/** One run of steps; an operation can have more than one (a failed release, then its automatic rollback). */
export interface JobPhase {
  steps: JobStep[];
  notes: string[];
}

export interface Job {
  id: string;
  operation: string;
  app: string;
  state: "running" | "finished";
  ok: boolean | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  phases: JobPhase[];
}

const STEP_LINE = /^(ok  |FAIL) (\d+)\/(\d+) (.+)$/;

/** What a job's lines say, as phases of steps. Pure, for the tests. */
export function readLines(lines: string[], phases: JobPhase[] = []): JobPhase[] {
  const current = () => phases.at(-1) ?? (phases.push({ steps: [], notes: [] }), phases[phases.length - 1]);
  for (const line of lines) {
    const m = line.match(STEP_LINE);
    if (m) {
      const [n, total, name] = [Number(m[2]), Number(m[3]), m[4]];
      let phase = current();
      if (n === 1 && phase.steps.some((s) => s.state !== "running" || s.n !== 1)) {
        phases.push({ steps: [], notes: [] });
        phase = current();
      }
      const known = phase.steps.find((s) => s.n === n && s.total === total);
      const step = known ?? { n, total, name, state: "running" as const, lines: [] };
      step.name = name;
      step.state = m[1] === "ok  " ? "ok" : "failed";
      if (!known) phase.steps.push(step);
      continue;
    }
    const phase = current();
    const last = phase.steps.at(-1);
    if (last && last.state !== "running" && /^ {5,}/.test(line) && line.trim()) last.lines.push(line.trim());
    else if (line.trim()) phase.notes.push(line.trim());
  }
  return phases;
}

/** A step that has started: before any line of it is printed. */
function started(phases: JobPhase[], n: number, total: number, name: string): void {
  let phase = phases.at(-1);
  if (!phase || (n === 1 && phase.steps.length > 0)) {
    phase = { steps: [], notes: [] };
    phases.push(phase);
  }
  if (!phase.steps.some((s) => s.n === n && s.total === total)) phase.steps.push({ n, total, name, state: "running", lines: [] });
}

/** What a job's command sends while it runs: what it prints, and each step as it starts. */
export interface Feed {
  text(chunk: string): void;
  started(n: number, total: number, name: string): void;
}

/** What the worker is to run: the operation, the app, and the lock the engine already holds for it. */
export interface JobOrder {
  kind: LongKind;
  app: string;
  signIn?: SignIn;
  lock?: string;
  /** Putting live outside any plan: the person's reason, which the release keeps (D82). */
  outsidePlan?: string;
  /** A service key (D82): where it is used, its name, and, to set it, its value, handed to the job's thread in memory and nowhere else. */
  scope?: "dev" | "prod" | "agent";
  name?: string;
  value?: string;
}

/** What the worker sends, in the order it happens. */
export type JobMessage =
  | { t: "text"; chunk: string }
  | { t: "start"; n: number; total: number; name: string }
  | { t: "done"; code: number }
  | { t: "failed"; message: string };

/**
 * Runs a worker (job-worker.js, or a test's) and feeds the job what it sends;
 * its exit code. A worker that stops without saying how it ended has failed,
 * and says so in the job's lines.
 */
export function inWorker(script: URL, order: JobOrder, feed: Feed): Promise<number> {
  return new Promise((resolve) => {
    const worker = new Worker(script, { workerData: order });
    let ended = false;
    const end = (code: number, line?: string) => {
      if (ended) return;
      ended = true;
      if (line) feed.text(`${line}\n`);
      void worker.terminate();
      resolve(code);
    };
    worker.on("message", (message: JobMessage) => {
      if (message.t === "text") feed.text(message.chunk);
      else if (message.t === "start") feed.started(message.n, message.total, message.name);
      else if (message.t === "done") end(message.code);
      else end(1, message.message);
    });
    worker.once("error", (error) => end(1, `the command stopped: ${error.message}`));
    worker.once("exit", (code) => end(1, `the command stopped without finishing (${code})`));
  });
}

export class Jobs {
  private jobs = new Map<string, Job>();
  private running: Job | null = null;

  get busy(): Job | null {
    return this.running;
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  /**
   * Starts `run` as a job, or returns null when another is running. What it
   * feeds back is the job's; the engine's own log stays the engine's.
   */
  start(operation: string, app: string, run: (feed: Feed) => Promise<number>): Job | null {
    if (this.running) return null;
    const job: Job = {
      id: randomBytes(8).toString("hex"),
      operation,
      app,
      state: "running",
      ok: null,
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      phases: [],
    };
    this.jobs.set(job.id, job);
    this.running = job;
    let pending = "";
    const feed: Feed = {
      text: (chunk) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        readLines(lines, job.phases);
      },
      started: (n, total, name) => started(job.phases, n, total, name),
    };
    const finish = (code: number) => {
      if (pending) readLines([pending], job.phases);
      job.state = "finished";
      job.exitCode = code;
      job.ok = code === 0;
      job.finishedAt = new Date().toISOString();
      this.running = null;
      // Keep the last few finished jobs for the panel to read back, and no more.
      const finished = [...this.jobs.values()].filter((j) => j.state === "finished");
      for (const old of finished.slice(0, Math.max(0, finished.length - 20))) this.jobs.delete(old.id);
    };
    Promise.resolve()
      .then(() => run(feed))
      .then(finish, (error: unknown) => {
        readLines([`${error instanceof Error ? error.message : String(error)}`], job.phases);
        finish(1);
      });
    return job;
  }
}
