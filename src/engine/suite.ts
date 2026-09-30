/**
 * The engine's operations, wired to the CLI's own code (rule 5, D62). Nothing
 * here reimplements an operation: reads come from the functions the CLI
 * prints from, and long operations run the CLI's own commands, the functions
 * `allvibe release`, `allvibe rollback` and `allvibe dev deploy` run, on a
 * thread of their own (job-worker.ts). What is
 * returned is chosen field by field, so that nothing secret can come along.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { listBackups } from "../lib/backup.js";
import { NAMES } from "../lib/brand.js";
import { readConfig } from "../lib/config.js";
import { containerState } from "../lib/docker.js";
import { writeAtomic } from "../lib/files.js";
import { containerName, currentRelease, listProjects, nameProblem, nextVersion, projectDir, readProject, urlFor, type Project } from "../lib/project.js";
import { agentContainer, agentState, hasAgentKey, signInOf } from "../lib/agent.js";
import { readNightly, summarise, type Check } from "../commands/doctor.js";
import { markTried, planView, type PlanView } from "../commands/plan.js";
import { takeLock } from "../lib/lock.js";
import { keyNameProblem, listKeys } from "../lib/vault.js";
import { restoreDataPlan } from "../commands/release.js";
import { appsHost } from "../lib/panel.js";
import { inWorker } from "./jobs.js";
import { LOCK_OPERATION, type LongKind, type Suite } from "./operations.js";

const state = (name: string) => {
  const s = containerState(name);
  // Which container, since when: a new start of it is a new one, and only
  // that reloads the panel's Preview frame (friction log 5).
  return { running: s.status === "running", status: s.status, health: s.health, since: s.exists ? `${s.id.slice(0, 12)}@${s.startedAt}` : null };
};

/** The one thing to do next, as the panel's home screen shows it. */
export function nextAction(testCopyRunning: boolean, plan: Pick<PlanView, "state" | "releasedIn" | "steps">, version: string): Record<string, unknown> {
  if (!testCopyRunning) return { kind: "start-test-copy" };
  if (plan.state === "none" || plan.releasedIn) return { kind: "new-idea" };
  if (plan.state === "invalid") return { kind: "fix-plan" };
  const ready = plan.steps.find((s) => s.state === "ready");
  if (ready) return { kind: "try", step: ready.id, title: ready.title };
  if (plan.steps.length && plan.steps.every((s) => s.state === "tried")) return { kind: "put-live", version };
  return { kind: "building" };
}

function summary(project: Project) {
  const prod = state(containerName(project.name, "prod", "app"));
  const testCopy = state(containerName(project.name, "dev", "app"));
  const plan = planView(project);
  const tried = plan.steps.filter((s) => s.state === "tried").length;
  // Whether the test copy runs a commit the live app does not (D82): with no
  // plan, or one already put live, that is where a release would be refused
  // and work outside a plan is offered.
  const testCopyCommit = containerState(containerName(project.name, "dev", "app")).labels[`${NAMES.label}.commit`] ?? null;
  const liveCommit = currentRelease(project)?.commit ?? null;
  return {
    name: project.name,
    live: currentRelease(project)?.version ?? null,
    prod,
    testCopy,
    plan: { state: plan.state, title: plan.title, tried, steps: plan.steps.length, releasedIn: plan.releasedIn },
    unreleased: Boolean(testCopy.running && testCopyCommit && !(liveCommit ?? "").startsWith(testCopyCommit)),
    // The version a release would be: one past the highest ever released, not
    // past the live one, which is lower after going back (D83).
    nextVersion: nextVersion(project),
    next: nextAction(testCopy.running, plan, nextVersion(project)),
    addresses: { live: urlFor(project, "prod"), testCopy: urlFor(project, "dev") },
    ports: { live: project.ports.prod, testCopy: project.ports.dev },
    // Where a browser reaches the apps: never the panel's own name (D74).
    appsHost: appsHost(),
  };
}

export const realSuite: Suite = {
  exists: (app) => listProjects().some((p) => p.name === app),
  apps: () => listProjects().map(summary),
  app: (app) => {
    const project = readProject(app);
    const current = currentRelease(project)?.version ?? null;
    return {
      ...summary(project),
      versions: [...project.releases].reverse().map((r) => ({
        version: r.version,
        at: r.at,
        from: r.from ?? null,
        live: r.version === current,
        plan: r.plan ? { title: r.plan.title, steps: r.plan.steps.length } : null,
        outsidePlan: r.outsidePlan ?? null,
      })),
      failed: project.failed ? { version: project.failed.version, at: project.failed.at } : null,
    };
  },
  plan: (app) => planView(readProject(app)),
  markTried: (app, step) => markTried(readProject(app), step) as ReturnType<Suite["markTried"]>,
  backups: (app) =>
    listBackups(readConfig(), app).map((b) => ({
      file: b.manifest.file,
      created: b.manifest.created,
      kind: b.manifest.kind,
      version: b.manifest.release?.version ?? b.manifest.prodCheck?.version ?? null,
      entries: b.manifest.prodCheck?.entries ?? null,
      bytes: b.manifest.bytes,
    })),
  report: (app, text) => {
    const dir = path.join(projectDir(app).split(path.sep).join("/"), "reports");
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-something-is-wrong.txt`;
    writeAtomic(path.join(dir, file), `Something is wrong, said in the control panel, ${new Date().toISOString()}:\n\n${text}\n`, 0o640);
    return { file: `reports/${file}` };
  },
  machineStatus: () =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./doctor-worker.js", import.meta.url));
      worker.once("message", (list: Check[]) => resolve({ ...summarise(list), checks: list.map((c) => ({ id: c.id, status: c.status, text: c.text })) }));
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`doctor's checks stopped (${code})`)));
    }),
  lastNight: () => {
    const last = readNightly();
    return last ? { at: last.at, summary: last.summary, problems: last.problems, warnings: last.warnings, checks: last.checks.map((c) => ({ id: c.id, status: c.status, text: c.text })) } : null;
  },
  // The CLI's own command, on a thread of its own (job-worker.ts, D77).
  run: (kind: LongKind, app: string, options, feed) => inWorker(new URL("./job-worker.js", import.meta.url), { kind, app, ...options }, feed),
  lock: (app, kind) => {
    const operation = LOCK_OPERATION[kind];
    if (!operation) return { ok: true, release: () => {} };
    const taken = takeLock(app, operation);
    return taken.ok ? { ok: true, release: taken.release } : { ok: false, message: taken.message };
  },
  agentStatus: (app) => {
    const running = agentState(app).status === "running";
    return { running, signIn: running ? signInOf(agentContainer(app)) : null, hasKey: hasAgentKey(app) };
  },
  nameProblem: (name) => nameProblem(name),
  // Service keys (D82): the vault's own list, names only, and its rule for names.
  keys: (app) => listKeys(app).map((k) => ({ scope: k.scope, name: k.name, changed: k.changed })),
  keyNameProblem: (name) => keyNameProblem(name),
  // Going back with the data (D82): what `allvibe rollback --restore-data` says it would do, field by field.
  dataPlan: async (app) => {
    const plan = await restoreDataPlan(readProject(app));
    if ("error" in plan) return { possible: false, why: plan.error };
    return {
      possible: true,
      from: plan.from,
      to: plan.to,
      backup: { file: plan.backup.manifest.file, created: plan.created },
      entriesAtBackup: plan.entriesAtBackup,
      entriesNow: plan.entriesNow,
      lost: plan.lost,
    };
  },
};
