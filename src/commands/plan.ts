/**
 * `allvibe plan <project>` and `allvibe plan tried <project> <step>` (D56).
 *
 *   plan <project>                  the plan dev runs now, and where each step stands
 *   plan tried <project> <step>     you tried this step in dev, and it works
 *
 * Only the person marks a step as tried: the agent keeps the plan, in the
 * working copy's plan.json, and cannot reach the marks (see lib/plan.ts). The
 * plan read is the one in the commit dev runs, because that is what the person
 * can try. The panel calls the same code through the engine (rule 5, D62):
 * `planView` and `markTried` are what both print from.
 */
import { NAMES } from "../lib/brand.js";
import { containerState } from "../lib/docker.js";
import { gate, markFor, parsePlan, PLAN_FILE, readMarks, saveMarks, stepKey, stepName, type Plan } from "../lib/plan.js";
import { containerName, gitHead, readProject, repoDir, type Project } from "../lib/project.js";
import { tryRun } from "../lib/run.js";

const C = NAMES.command;
const USAGE = `usage: ${C} plan <project> | ${C} plan tried <project> <step number>`;

/** plan.json as it is in a commit, or null when that commit has none. */
export function planAt(name: string, commit: string): string | null {
  const shown = tryRun("git", ["-C", repoDir(name), "show", `${commit}:${PLAN_FILE}`]);
  return shown.code === 0 ? shown.stdout : null;
}

/** The commit dev runs now, from its container's label; null when dev is not running. */
export function devCommit(name: string): string | null {
  const dev = containerState(containerName(name, "dev", "app"));
  if (dev.status !== "running") return null;
  return dev.labels[`${NAMES.label}.commit`] || null;
}

export interface PlanStepView {
  id: number;
  title: string;
  check: string;
  /** Tried by the person; built and ready for them to try; or still being built. */
  state: "tried" | "ready" | "building";
  triedAt: string | null;
}

export interface PlanView {
  app: string;
  /** The commit dev runs, or null when dev is not running. */
  commit: string | null;
  state: "no-test-copy" | "none" | "invalid" | "plan";
  problem: string | null;
  title: string | null;
  /** The version this plan was put live in, if it was. */
  releasedIn: string | null;
  steps: PlanStepView[];
  /** The agent's newest commit, when it is ahead of what dev runs. */
  ahead: string | null;
}

/** The plan dev runs, and where each step stands: what `allvibe plan` prints. */
export function planView(project: Project): PlanView {
  const name = project.name;
  const commit = devCommit(name);
  const view: PlanView = { app: name, commit, state: "no-test-copy", problem: null, title: null, releasedIn: null, steps: [], ahead: null };
  if (!commit) return view;
  const marks = readMarks(name);
  const result = gate(planAt(name, commit), marks, project.releases);
  if (result.state === "none") return { ...view, state: "none" };
  if (result.state === "invalid") return { ...view, state: "invalid", problem: result.problem };
  const plan = result.plan;
  const head = gitHead(name);
  return {
    ...view,
    state: "plan",
    title: plan.title,
    releasedIn: result.state === "spent" ? result.releasedIn : null,
    steps: plan.steps.map((step) => {
      const mark = markFor(plan, step, marks);
      return { id: step.id, title: step.title, check: step.check, state: mark ? "tried" : step.built ? "ready" : "building", triedAt: mark?.at ?? null };
    }),
    ahead: head.startsWith(commit) ? null : head,
  };
}

export type MarkResult =
  | { ok: true; already: boolean; step: string; commit: string; at: string; left: string[]; title: string }
  | { ok: false; code: "no-test-copy" | "no-plan" | "invalid" | "no-step" | "not-built"; message: string };

/** Marks a step as tried by the person, in the commit dev runs: what `allvibe plan tried` does. */
export function markTried(project: Project, id: number): MarkResult {
  const name = project.name;
  const commit = devCommit(name);
  if (!commit) return { ok: false, code: "no-test-copy", message: `dev of ${name} is not running, so no step can have been tried in it. Start it: ${C} dev deploy ${name}` };
  const raw = planAt(name, commit);
  if (raw === null) return { ok: false, code: "no-plan", message: `dev runs ${commit.slice(0, 12)}, which has no plan, so there is no step ${id} to mark.` };
  const { plan, problem } = parsePlan(raw);
  if (!plan) return { ok: false, code: "invalid", message: `dev's plan cannot be read: ${problem}. Ask the agent to fix plan.json.` };
  const step = plan.steps.find((s) => s.id === id);
  if (!step) return { ok: false, code: "no-step", message: `the plan "${plan.title}" has no step ${id}; its steps are ${plan.steps.map((s) => s.id).join(", ")}.` };
  if (!step.built) return { ok: false, code: "not-built", message: `the builder has not finished ${stepName(step)} yet, so it cannot be tried. Nothing was marked.` };
  const marks = readMarks(name);
  const existing = markFor(plan as Plan, step, marks);
  if (existing) return { ok: true, already: true, step: stepName(step), commit, at: existing.at, left: [], title: plan.title };
  const at = new Date().toISOString();
  marks.push({ step: id, key: stepKey(plan, step), title: step.title, at, commit });
  saveMarks(name, marks);
  const left = plan.steps.filter((s) => !markFor(plan, s, marks)).map(stepName);
  return { ok: true, already: false, step: stepName(step), commit, at, left, title: plan.title };
}

function show(project: Project): number {
  const name = project.name;
  const view = planView(project);
  const out = (line: string) => process.stdout.write(`${line}\n`);
  if (view.state === "no-test-copy") {
    process.stderr.write(`dev of ${name} is not running, so there is nothing to try. Start it: ${C} dev deploy ${name}\n`);
    return 1;
  }
  const commit = view.commit as string;
  if (view.state === "none") {
    out(`${name}: dev runs ${commit.slice(0, 12)}, which has no plan.`);
    out("Ask the agent to write your idea as a plan, in plan.json.");
    return 0;
  }
  if (view.state === "invalid") {
    out(`${name}: dev runs ${commit.slice(0, 12)}, and its plan cannot be read: ${view.problem}.`);
    out("Ask the agent to fix plan.json.");
    return 1;
  }
  out(`${name}: "${view.title}", as dev runs it (${commit.slice(0, 12)})`);
  if (view.releasedIn) out(`This plan was released in ${view.releasedIn}. What comes next needs a new plan.`);
  for (const step of view.steps) {
    const where = step.state === "tried"
      ? `tried by you, ${(step.triedAt as string).slice(0, 16).replace("T", " ")} UTC`
      : step.state === "ready"
        ? `ready for you to try: ${step.check}`
        : "the builder is still working on it";
    out(`  ${String(step.id).padStart(2)}. ${step.title}\n      ${where}`);
  }
  if (view.ahead) out(`\nThe agent has committed more since (${view.ahead.slice(0, 12)}). To try it: ${C} dev deploy ${name}`);
  return 0;
}

function tried(project: Project, stepText: string): number {
  const id = Number(stepText);
  if (!Number.isInteger(id) || id < 1) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const result = markTried(project, id);
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    return 1;
  }
  if (result.already) {
    process.stdout.write(`${result.step} was already marked as tried by you, ${result.at.slice(0, 16).replace("T", " ")} UTC.\n`);
    return 0;
  }
  process.stdout.write(
    `${result.step}: marked as tried by you, in dev at ${result.commit.slice(0, 12)}.\n` +
      (result.left.length ? `Still to try: ${result.left.join("; ")}.\n` : `Every step of "${result.title}" is tried. It can be put live: ${C} release ${project.name}\n`),
  );
  return 0;
}

export async function plan(args: string[]): Promise<number> {
  const [first, second, third, ...rest] = args;
  if (first === "tried") {
    if (!second || !third || rest.length) {
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    return tried(readProject(second), third);
  }
  if (!first || second) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  return show(readProject(first));
}
