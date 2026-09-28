/**
 * The plan a project's agent keeps, and the steps its person has tried (D56).
 *
 * - `plan.json`, in the project's working copy, is the agent's: the plan's
 *   title, and its steps, each with a number, a title, the check the person can
 *   try, and whether the builder has finished it. The agent writes it, as the
 *   project's AGENTS.md asks.
 * - `tried.json`, beside the project and outside the working copy, is the
 *   person's: a step is marked tried only by `allvibe plan tried`, which the
 *   person runs (and the panel will call). The agent's container has the
 *   working copy and nothing else of the machine's (D39), so it cannot reach
 *   this file, and anything it writes into plan.json about trying is ignored.
 *
 * A mark belongs to the words of the step it was made for: the plan's title,
 * the step's number, its title and its check. If the agent changes any of them
 * after the person tried the step, the step is untried again.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeAtomic } from "./files.js";
import { projectDir } from "./project.js";

export const PLAN_FILE = "plan.json";
export const triedFile = (name: string) => path.join(projectDir(name), "tried.json");

export interface PlanStep {
  id: number;
  title: string;
  check: string;
  built: boolean;
}

export interface Plan {
  title: string;
  steps: PlanStep[];
}

export interface TriedMark {
  /** The step's number, and the key of its words when it was tried. */
  step: number;
  key: string;
  title: string;
  at: string;
  /** The commit dev ran when the person tried it. */
  commit: string;
}

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** The key of one step's words, within its plan. */
export const stepKey = (plan: Plan, step: PlanStep) => sha([plan.title, step.id, step.title, step.check]);
/** The key of a whole plan's words: what a release records, so a plan is released once. */
export const planKey = (plan: Plan) => sha([plan.title, plan.steps.map((s) => [s.id, s.title, s.check])]);

const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** plan.json's text, read and checked; anything else in it (a "tried" field, say) is ignored. */
export function parsePlan(raw: string): { plan: Plan | null; problem: string | null } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { plan: null, problem: "plan.json is not valid JSON" };
  }
  const d = data as { title?: unknown; steps?: unknown };
  if (!text(d.title, 200)) return { plan: null, problem: "plan.json has no title (a line of words, at most 200 characters)" };
  if (!Array.isArray(d.steps)) return { plan: null, problem: "plan.json has no list of steps" };
  if (d.steps.length > 50) return { plan: null, problem: "plan.json has more than 50 steps" };
  const steps: PlanStep[] = [];
  for (const [i, raw] of (d.steps as unknown[]).entries()) {
    const s = raw as { id?: unknown; title?: unknown; check?: unknown; built?: unknown };
    const where = `step ${i + 1} of plan.json`;
    if (!Number.isInteger(s.id) || (s.id as number) < 1) return { plan: null, problem: `${where} has no number (id: 1, 2, ...)` };
    if (!text(s.title, 300)) return { plan: null, problem: `${where} has no title` };
    if (!text(s.check, 600)) return { plan: null, problem: `${where} has no check for the person to try` };
    if (s.built !== undefined && typeof s.built !== "boolean") return { plan: null, problem: `${where}: built is true or false` };
    if (steps.some((t) => t.id === s.id)) return { plan: null, problem: `${where} repeats the number ${s.id}` };
    steps.push({ id: s.id as number, title: (s.title as string).trim(), check: (s.check as string).trim(), built: s.built === true });
  }
  return { plan: { title: (d.title as string).trim(), steps }, problem: null };
}

export function readMarks(name: string): TriedMark[] {
  const file = triedFile(name);
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as { marks?: TriedMark[] };
  return data.marks ?? [];
}

export function saveMarks(name: string, marks: TriedMark[]): void {
  writeAtomic(triedFile(name), `${JSON.stringify({ marks }, null, 2)}\n`, 0o644);
}

/** The person's mark for this step, if the step's words are still the ones they tried. */
export const markFor = (plan: Plan, step: PlanStep, marks: TriedMark[]) =>
  [...marks].reverse().find((m) => m.step === step.id && m.key === stepKey(plan, step)) ?? null;

export type Gate =
  | { state: "tried"; plan: Plan; marks: TriedMark[] }
  | { state: "untried"; plan: Plan; untried: PlanStep[] }
  | { state: "none"; problem: null }
  | { state: "spent"; plan: Plan; releasedIn: string }
  | { state: "invalid"; problem: string };

/**
 * What a release makes of the plan in the commit it releases: every step tried;
 * steps not tried; no plan at all; a plan already released (so this commit's
 * changes are outside any plan); or a plan.json that cannot be read.
 */
export function gate(raw: string | null, marks: TriedMark[], released: Array<{ version: string; plan?: { key: string } }>): Gate {
  if (raw === null) return { state: "none", problem: null };
  const { plan, problem } = parsePlan(raw);
  if (!plan) return { state: "invalid", problem: problem ?? "plan.json cannot be read" };
  if (plan.steps.length === 0) return { state: "none", problem: null };
  const done = released.find((r) => r.plan?.key === planKey(plan));
  if (done) return { state: "spent", plan, releasedIn: done.version };
  const untried = plan.steps.filter((s) => !markFor(plan, s, marks));
  if (untried.length) return { state: "untried", plan, untried };
  return { state: "tried", plan, marks: plan.steps.map((s) => markFor(plan, s, marks) as TriedMark) };
}

/** How a step reads in a list: `step 2, "Photos are kept with the message"`. */
export const stepName = (s: Pick<PlanStep, "id" | "title">) => `step ${s.id}, "${s.title}"`;
