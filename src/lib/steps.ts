/**
 * Operations as steps (rule 7). Every step prints what it found; the first
 * that fails names itself and what would have to be true, and nothing after it
 * runs. Every operation's run is recorded, with its result and, on failure, the
 * reason (item 6).
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NAMES } from "./brand.js";
import { writeAtomic } from "./files.js";

export interface StepOutcome {
  ok: boolean;
  /** What the step found or did, in plain words. */
  evidence: string;
  /** On failure: what went wrong. */
  why?: string;
  /** On failure: what would have to be true. */
  fix?: string;
  /** Whether the step changed anything (for idempotent operations). */
  changed?: boolean;
}

export const ok = (evidence: string, changed?: boolean): StepOutcome => ({ ok: true, evidence, changed });
export const fail = (why: string, fix?: string): StepOutcome => ({ ok: false, evidence: "", why, fix });

export interface Step {
  name: string;
  run(): Promise<StepOutcome> | StepOutcome;
}

export interface RunRecord {
  kind: string;
  project: string | null;
  started: string;
  finished: string;
  ok: boolean;
  dryRun: boolean;
  steps: Array<{ name: string; ok: boolean; evidence: string; why?: string; fix?: string; changed?: boolean }>;
  failedStep: string | null;
  /** Anything worth keeping beside the steps: counts, versions, file names. */
  facts: Record<string, unknown>;
}

export interface RunOptions {
  kind: string;
  project?: string | null;
  dryRun?: boolean;
  record?: boolean;
  /** Where to print; `null` for quiet. */
  out?: ((line: string) => void) | null;
  facts?: Record<string, unknown>;
}

const print = (options: RunOptions) => options.out === undefined ? (line: string) => process.stdout.write(`${line}\n`) : options.out;

export async function runSteps(steps: Step[], options: RunOptions): Promise<RunRecord> {
  const say = print(options) ?? (() => {});
  const record: RunRecord = {
    kind: options.kind,
    project: options.project ?? null,
    started: new Date().toISOString(),
    finished: "",
    ok: true,
    dryRun: options.dryRun ?? false,
    steps: [],
    failedStep: null,
    facts: options.facts ?? {},
  };

  for (const [index, step] of steps.entries()) {
    const number = `${index + 1}/${steps.length}`;
    let outcome: StepOutcome;
    try {
      outcome = await step.run();
    } catch (error) {
      outcome = fail(error instanceof Error ? error.message : String(error));
    }
    record.steps.push({ name: step.name, ...outcome });

    if (outcome.ok) {
      say(`ok   ${number} ${step.name}`);
      for (const line of outcome.evidence.split("\n").filter(Boolean)) say(`       ${line}`);
      continue;
    }

    record.ok = false;
    record.failedStep = step.name;
    say(`FAIL ${number} ${step.name}`);
    for (const line of String(outcome.why).split("\n")) say(`       ${line}`);
    if (outcome.fix) {
      say("");
      say("     what would have to be true:");
      for (const line of outcome.fix.split("\n")) say(`       ${line}`);
    }
    say("");
    say(`stopped at step ${number}. Nothing after it was attempted.`);
    break;
  }

  record.finished = new Date().toISOString();
  if (options.record !== false) saveRecord(record);
  return record;
}

export function saveRecord(record: RunRecord, dir = NAMES.runsDir): string {
  mkdirSync(dir, { recursive: true });
  const stamp = record.started.replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${record.kind}${record.project ? `-${record.project}` : ""}.json`);
  writeAtomic(file, `${JSON.stringify(record, null, 2)}\n`, 0o640);
  return file;
}

export function listRecords(dir = NAMES.runsDir): RunRecord[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as RunRecord);
}

export function lastRecord(kind: string, project?: string | null, dir = NAMES.runsDir): RunRecord | null {
  const matching = listRecords(dir).filter((r) => r.kind === kind && (project === undefined || r.project === project));
  return matching.at(-1) ?? null;
}
