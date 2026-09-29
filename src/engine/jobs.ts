/**
 * Long operations, one at a time (D62). A job runs a CLI command, the same
 * function `allvibe` runs, and keeps what it prints, step by step: the steps
 * are the CLI's own (`runSteps`), announced as each one starts and read back
 * from its printed lines as each one ends, so the panel shows exactly what the
 * command prints and stops where it stops (rule 7).
 */
import { randomBytes } from "node:crypto";
import { stepEvents } from "../lib/steps.js";

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

/** What a job takes over while it runs: the process's output, in the engine. */
export interface Streams {
  out: { write: (...args: never[]) => boolean };
  err: { write: (...args: never[]) => boolean };
}

export class Jobs {
  private jobs = new Map<string, Job>();
  private running: Job | null = null;

  constructor(private readonly streams: Streams = { out: process.stdout, err: process.stderr }) {}

  get busy(): Job | null {
    return this.running;
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  /**
   * Starts `run` as a job, or returns null when another is running. While it
   * runs, what the process prints is the job's, not the engine's log.
   */
  start(operation: string, app: string, run: () => Promise<number>): Job | null {
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
    const { out: outStream, err: errStream } = this.streams;
    const out = outStream.write;
    const err = errStream.write;
    let pending = "";
    const take = (chunk: unknown): boolean => {
      pending += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      readLines(lines, job.phases);
      return true;
    };
    outStream.write = take as typeof out;
    errStream.write = take as typeof err;
    stepEvents.onStart = (n, total, name) => started(job.phases, n, total, name);
    const finish = (code: number) => {
      if (pending) readLines([pending], job.phases);
      outStream.write = out;
      errStream.write = err;
      stepEvents.onStart = null;
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
      .then(run)
      .then(finish, (error: unknown) => {
        readLines([`${error instanceof Error ? error.message : String(error)}`], job.phases);
        finish(1);
      });
    return job;
  }
}
