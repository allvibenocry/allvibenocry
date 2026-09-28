/**
 * `allvibe plan <project>` and `allvibe plan tried <project> <step>` (D56).
 *
 *   plan <project>                  the plan dev runs now, and where each step stands
 *   plan tried <project> <step>     you tried this step in dev, and it works
 *
 * Only the person marks a step as tried: the agent keeps the plan, in the
 * working copy's plan.json, and cannot reach the marks (see lib/plan.ts). The
 * plan read is the one in the commit dev runs, because that is what the person
 * can try. The panel will call the same engine (rule 5).
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
function devCommit(name: string): string | null {
  const dev = containerState(containerName(name, "dev", "app"));
  if (dev.status !== "running") return null;
  return dev.labels[`${NAMES.label}.commit`] || null;
}

function show(project: Project): number {
  const name = project.name;
  const commit = devCommit(name);
  if (!commit) {
    process.stderr.write(`dev of ${name} is not running, so there is nothing to try. Start it: ${C} dev deploy ${name}\n`);
    return 1;
  }
  const raw = planAt(name, commit);
  const marks = readMarks(name);
  const result = gate(raw, marks, project.releases);
  const out = (line: string) => process.stdout.write(`${line}\n`);
  if (result.state === "none") {
    out(`${name}: dev runs ${commit.slice(0, 12)}, which has no plan.`);
    out("Ask the agent to write your idea as a plan, in plan.json.");
    return 0;
  }
  if (result.state === "invalid") {
    out(`${name}: dev runs ${commit.slice(0, 12)}, and its plan cannot be read: ${result.problem}.`);
    out("Ask the agent to fix plan.json.");
    return 1;
  }
  const plan = result.plan;
  out(`${name}: "${plan.title}", as dev runs it (${commit.slice(0, 12)})`);
  if (result.state === "spent") out(`This plan was released in ${result.releasedIn}. What comes next needs a new plan.`);
  for (const step of plan.steps) {
    const mark = markFor(plan, step, marks);
    const where = mark
      ? `tried by you, ${mark.at.slice(0, 16).replace("T", " ")} UTC`
      : step.built
        ? `ready for you to try: ${step.check}`
        : "the builder is still working on it";
    out(`  ${String(step.id).padStart(2)}. ${step.title}\n      ${where}`);
  }
  const head = gitHead(name);
  if (!head.startsWith(commit)) out(`\nThe agent has committed more since (${head.slice(0, 12)}). To try it: ${C} dev deploy ${name}`);
  return 0;
}

function tried(project: Project, stepText: string): number {
  const name = project.name;
  const id = Number(stepText);
  if (!Number.isInteger(id) || id < 1) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const commit = devCommit(name);
  if (!commit) {
    process.stderr.write(`dev of ${name} is not running, so no step can have been tried in it. Start it: ${C} dev deploy ${name}\n`);
    return 1;
  }
  const raw = planAt(name, commit);
  if (raw === null) {
    process.stderr.write(`dev runs ${commit.slice(0, 12)}, which has no plan, so there is no step ${id} to mark.\n`);
    return 1;
  }
  const { plan, problem } = parsePlan(raw);
  if (!plan) {
    process.stderr.write(`dev's plan cannot be read: ${problem}. Ask the agent to fix plan.json.\n`);
    return 1;
  }
  const step = plan.steps.find((s) => s.id === id);
  if (!step) {
    process.stderr.write(`the plan "${plan.title}" has no step ${id}; its steps are ${plan.steps.map((s) => s.id).join(", ")}.\n`);
    return 1;
  }
  if (!step.built) {
    process.stderr.write(`the builder has not finished ${stepName(step)} yet, so it cannot be tried. Nothing was marked.\n`);
    return 1;
  }
  const marks = readMarks(name);
  const existing = markFor(plan as Plan, step, marks);
  if (existing) {
    process.stdout.write(`${stepName(step)} was already marked as tried by you, ${existing.at.slice(0, 16).replace("T", " ")} UTC.\n`);
    return 0;
  }
  marks.push({ step: id, key: stepKey(plan, step), title: step.title, at: new Date().toISOString(), commit });
  saveMarks(name, marks);
  const left = plan.steps.filter((s) => !markFor(plan, s, marks));
  process.stdout.write(
    `${stepName(step)}: marked as tried by you, in dev at ${commit.slice(0, 12)}.\n` +
      (left.length ? `Still to try: ${left.map(stepName).join("; ")}.\n` : `Every step of "${plan.title}" is tried. It can be put live: ${C} release ${name}\n`),
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
