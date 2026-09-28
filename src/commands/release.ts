/**
 * `allvibe release <project> [--dry-run]` and `allvibe rollback <project>`
 * (rules 2, 7 and 8; D25, D26).
 *
 * A release is sixteen steps, in order, stopping at the first failure; these
 * are the lines it prints:
 *
 *    1  dev runs the commit being released, and answers its smoke check
 *    2  every step of the plan is tried by you (D56), or --outside-plan "reason"
 *    3  the migrations since the last release only add, or are marked breaking (D35)
 *    4  the recovery key is confirmed, so a backup can be restored off the machine
 *    5  the backup target is off this machine and writable
 *    6  prod's database is running
 *    7  an encrypted backup of prod, on the target, kept apart from rotation
 *    8  the backup to check                                     (8 to 12: the
 *    9  it is whole, and it decrypts                             restore check
 *   10  its key vault restores (D37)                             of that very
 *   11  it restores into a scratch copy                          backup)
 *   12  the app's own health check passes against the copy
 *   13  prod built from dev's commit
 *   14  prod deployed on the new version
 *   15  prod answers its smoke check
 *   16  the release is tagged with its version
 *
 * If the deploy or prod's smoke check fails (14 or 15), prod goes back to the
 * version it ran before, automatically, keeping its data; unless the failed
 * version's migration has already changed the data in a way the version before
 * cannot read, when it stops there and names the backup this release took.
 *
 * A rollback goes back to the previous version's code and keeps prod's data,
 * behind a fresh backup of prod that has passed its restore check, like a
 * release (D57); the automatic one after a failed release relies on the
 * backup that release took minutes before.
 * If that version cannot run on today's data, it stops and says so; restoring
 * the backup taken before the release is a separate, explicit choice that says
 * exactly what would be lost and needs --confirm-data-loss (rule 8).
 */
import { NAMES } from "../lib/brand.js";
import { readConfig } from "../lib/config.js";
import {
  cleanupRestore,
  listBackups,
  newRestoreContext,
  replaceProdData,
  takeBackup,
  verifyAndDecrypt,
  type Backup,
} from "../lib/backup.js";
import { containerState, tryDocker } from "../lib/docker.js";
import { recoveryStatus } from "../lib/keys.js";
import {
  buildRelease,
  containerName,
  currentRelease,
  deployEnv,
  gitHead,
  imageName,
  nextVersion,
  previousRelease,
  readProject,
  repoDir,
  saveProject,
  smoke,
  type Project,
  type Release,
} from "../lib/project.js";
import { run, tryRun } from "../lib/run.js";
import { appliedMigrations, describeUnknown, releaseMigrations, restoreDataCommand, rollbackSchema, schemaOf } from "../lib/schema.js";
import { fail, ok, runSteps, saveRecord, type Step } from "../lib/steps.js";
import { gate, planKey, readMarks, stepName } from "../lib/plan.js";
import { backupSteps, restoreCheckSteps, targetStep } from "./backup.js";
import { planAt } from "./plan.js";
import { git } from "./project.js";

const C = NAMES.command;

/* --------------------------------------------------------- shared -- */

function deployStep(project: Project, version: string, label = `prod deployed on ${version}`): Step {
  return {
    name: label,
    run: async () => {
      const state = await deployEnv(project, "prod", version);
      if (state.status === "running" && state.health === "healthy") return ok(`${containerName(project.name, "prod", "app")} healthy on ${imageName(project.name, version)}`);
      // The line that says what went wrong, not the end of a stack trace.
      const logs = tryDocker(["logs", "--tail", "60", containerName(project.name, "prod", "app")]);
      const lines = (logs.stdout + logs.stderr).split("\n").map((l) => l.trim()).filter(Boolean);
      const said =
        lines.find((l) => /^(\w*Error|error):\s/.test(l)) ??
        lines.find((l) => /error/i.test(l) && !l.startsWith("at ") && !l.includes("captureStackTrace")) ??
        lines.at(-1) ??
        "nothing";
      return fail(
        `prod's app did not come up healthy on ${version}: ${state.status}/${state.health}, restarted ${state.restartCount} time(s)\n` +
          `it said: ${said.slice(0, 300)}`,
      );
    },
  };
}

function prodSmokeStep(project: Project): Step {
  return {
    name: "prod answers its smoke check",
    run: async () => {
      const check = await smoke(project, "prod");
      return check.ok ? ok(`prod answers: ${check.said}`) : fail(`prod does not answer its smoke check: ${check.said}`);
    },
  };
}

/** The image for a release: kept from when it was built, or built again from its commit. */
function ensureImage(project: Project, release: Release): string {
  if (tryDocker(["image", "inspect", release.image]).code === 0) return `${release.image} is still on this machine`;
  buildRelease(project, release.commit, release.version);
  return `${release.image} rebuilt from ${release.commit.slice(0, 12)}`;
}

/**
 * Whether the code being gone back to was written for the schema prod's
 * database has now (D35). Asked of the database, before anything is deployed:
 * a rollback never runs old code on a schema it does not understand and calls
 * that success.
 */
function schemaStep(project: Project, to: Release, from: string, alsoIn: Array<{ version: string; commit: string }>): Step {
  return {
    name: `prod's database is one ${to.version} can run on`,
    run: () => {
      const { unknown } = rollbackSchema(project, to, alsoIn);
      if (unknown.length === 0) return ok(`it has no migration that ${to.version} does not know`);
      const breaking = unknown.filter((u) => u.kind === "breaking");
      if (breaking.length > 0) {
        return fail(
          `${to.version} was not written for the database as it is now. Since ${to.version}, ` +
            `${breaking.length === 1 ? "this migration has" : "these migrations have"} changed it in a way ${to.version} cannot run on:\n` +
            breaking.map((u) => `  ${describeUnknown(u)}`).join("\n") +
            `\nGoing back to ${to.version}'s code alone would run it on data it does not understand, so this rollback stops here and nothing is changed.`,
          `going back means putting the data back as well, as it was before ${from}. First see what that would lose: ${restoreDataCommand(project)}`,
        );
      }
      return ok(
        `${unknown.length === 1 ? "one migration" : `${unknown.length} migrations`} since ${to.version}, and ${unknown.length === 1 ? "it only adds" : "they only add"}, so ${to.version} runs on it unchanged:\n` +
          unknown.map((u) => describeUnknown(u)).join("\n"),
      );
    },
  };
}

/** The recovery key is confirmed, so a backup taken now can be restored on another machine (D13). */
function recoveryStep(): Step {
  return {
    name: "the recovery key is confirmed",
    run: () => {
      const status = recoveryStatus();
      if (status.state === "pending" || status.state === "missing") {
        return fail(
          "the recovery key has not been confirmed, so a backup could not be restored on another machine (D13)",
          `copy ${NAMES.recoveryPending} off this machine, then: ${C} recovery-key confirm < your-copy`,
        );
      }
      return ok(`confirmed ${status.confirmedAt?.slice(0, 10)}${status.state === "overdue" ? " (more than 180 days ago: confirm it again soon)" : ""}`);
    },
  };
}

/**
 * Back to an earlier version's code, keeping prod's data. `safety` runs after
 * the checks and before anything changes: for a rollback by hand, a fresh
 * backup of prod and its restore check (D57).
 */
function codeRollbackSteps(project: Project, to: Release, from: string, automatic: boolean, alsoIn: Array<{ version: string; commit: string }> = [], safety: Step[] = []): Step[] {
  return [
    {
      name: `the version to go back to: ${to.version}`,
      run: () => ok(`${to.version}, from ${to.commit.slice(0, 12)}; ${ensureImage(project, to)}`),
    },
    schemaStep(project, to, from, alsoIn),
    ...safety,
    {
      name: "prod's data",
      run: () => ok("kept as it is: nothing is restored, so nothing written since the release is lost (rule 8)"),
    },
    deployStep(project, to.version, `prod deployed on ${to.version}`),
    {
      ...prodSmokeStep(project),
      run: async () => {
        const check = await smoke(project, "prod");
        if (!check.ok) {
          return fail(
            `${to.version} does not answer on prod's current data: ${check.said}`,
            automatic
              ? `prod is not answering. Look at: ${C} project status ${project.name}; the release's backup can be restored with ${C} rollback ${project.name} --restore-data`
              : `${to.version} may not run on data that ${from} changed. To also put the data back as it was before ${from}: ${C} rollback ${project.name} --restore-data`,
          );
        }
        project.current = to.version;
        delete project.failed;
        saveProject(project);
        return ok(`prod answers on ${to.version}: ${check.said}`);
      },
    },
  ];
}

/* ------------------------------------------------------------ release -- */

/** `release`'s arguments: the project, --dry-run, and --outside-plan with its reason (D56). */
export function releaseArgs(args: string[]): { name: string; dryRun: boolean; outsidePlan: string | null } | { error: string } {
  const usage = `usage: ${C} release <project> [--dry-run] [--outside-plan "why this goes live outside any plan"]`;
  let name: string | null = null;
  let dryRun = false;
  let outsidePlan: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--outside-plan" || a.startsWith("--outside-plan=")) {
      const reason = a === "--outside-plan" ? args[(i += 1)] : a.slice("--outside-plan=".length);
      if (reason === undefined || reason.startsWith("--") || reason.trim().length < 3) {
        return {
          error:
            `Putting work live outside any plan needs a reason, in your own words, which the release's record keeps:\n` +
            `  ${C} release <project> --outside-plan "why this goes live without a plan"\nNothing was changed.`,
        };
      }
      outsidePlan = reason.trim();
    } else if (a.startsWith("--") || name !== null) return { error: usage };
    else name = a;
  }
  return name === null ? { error: usage } : { name, dryRun, outsidePlan };
}

async function release(args: string[]): Promise<number> {
  const parsed = releaseArgs(args);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }
  const { name, dryRun, outsidePlan } = parsed;
  const project = readProject(name);
  const config = readConfig();
  const from = currentRelease(project);
  const version = nextVersion(project);
  const context = newRestoreContext(project);
  const out: { backup: Backup | null } = { backup: null };
  let commit = "";
  let breaking: string[] = [];
  const planned: { value: NonNullable<Release["plan"]> | null } = { value: null };

  const steps: Step[] = [
    {
      name: "dev runs the commit being released, and answers its smoke check",
      run: async () => {
        commit = gitHead(name);
        const dirty = run("git", ["-C", repoDir(name), "status", "--porcelain"]).stdout.trim();
        if (dirty) {
          return fail(`dev has changes that are not committed:\n${dirty}`, `a release is a commit: ${C} dev commit ${name} "what changed", then ${C} dev deploy ${name}`);
        }
        const running = containerState(containerName(name, "dev", "app")).labels[`${NAMES.label}.commit`] ?? "";
        if (!running || !commit.startsWith(running)) {
          return fail(
            `dev runs ${running || "nothing"}, but the commit to release is ${commit.slice(0, 12)}`,
            `dev runs what is released, so its smoke check tested it: ${C} dev deploy ${name}`,
          );
        }
        const check = await smoke(project, "dev");
        if (!check.ok) return fail(`dev does not answer its smoke check: ${check.said}`, `dev works before it is released: ${C} project status ${name}`);
        return ok(`dev runs ${commit.slice(0, 12)}, nothing uncommitted, and answers: ${check.said}`);
      },
    },
    {
      name: "every step of the plan is tried by you",
      run: () => {
        const result = gate(planAt(name, commit), readMarks(name), project.releases);
        const outside = (why: string) =>
          outsidePlan
            ? ok(`outside any plan, by your choice: "${outsidePlan}". ${why}; the release's record keeps your reason.`)
            : fail(
                `${why}, so nobody has tried this commit's changes as steps of a plan.`,
                `have the agent write the change as a plan in plan.json, try its steps in dev, and mark each: ${C} plan tried ${name} <step>. ` +
                  `Or, for work outside any plan: ${C} release ${name} --outside-plan "your reason"`,
              );
        if (result.state === "invalid") return fail(`plan.json in ${commit.slice(0, 12)} cannot be read: ${result.problem}`, "ask the agent to fix plan.json, then deploy dev and try again");
        if (result.state === "none") return outside(`${commit.slice(0, 12)} has no plan`);
        if (result.state === "spent") return outside(`the plan "${result.plan.title}" was already put live in ${result.releasedIn}`);
        if (result.state === "untried") {
          return fail(
            `the plan "${result.plan.title}" has steps you have not tried: ${result.untried.map(stepName).join("; ")}` +
              (outsidePlan ? `. --outside-plan is for work outside any plan, and this commit has one` : ""),
            `try each in dev (the test copy), then mark it: ${C} plan tried ${name} <step>`,
          );
        }
        planned.value = {
          title: result.plan.title,
          key: planKey(result.plan),
          steps: result.plan.steps.map((s, i) => ({ id: s.id, title: s.title, tried: result.marks[i].at, commit: result.marks[i].commit })),
        };
        if (outsidePlan) return fail(`this commit has a plan, "${result.plan.title}", every step tried: --outside-plan is not needed`, `${C} release ${name}`);
        return ok(`"${result.plan.title}": all ${result.plan.steps.length} steps tried by you, the last ${result.marks.map((m) => m.at).sort().at(-1)?.slice(0, 16).replace("T", " ")} UTC`);
      },
    },
    {
      name: `the migrations since ${from?.version ?? "the start"} only add, or are marked breaking`,
      run: () => {
        const { added, problems } = releaseMigrations(project, from?.commit ?? null, commit);
        if (problems.length > 0) return fail(problems.join("\n"), "nothing has been changed; fix the migrations in dev, commit, and release again");
        breaking = added.filter((a) => a.verdict.kind === "breaking").map((a) => a.file);
        if (added.length === 0) return ok("no new migrations");
        return ok(
          added
            .map((a) => a.verdict.kind === "additive"
              ? `migrations/${a.file}: only adds`
              : `migrations/${a.file}: breaking, and marked so (${a.verdict.mark}); going back past ${version} will mean putting the data back too`)
            .join("\n"),
        );
      },
    },
    recoveryStep(),
    ...(dryRun
      ? [
          { ...targetStep(config), name: "a fresh backup of prod" },
          {
            name: "a restore check of the newest backup",
            run: () =>
              ok(
                listBackups(config, name).length
                  ? "would restore-check the backup this release takes; the newest one is checked below"
                  : "no backup yet: a release takes one and restore-checks it",
              ),
          },
          ...(listBackups(config, name).length ? restoreCheckSteps(project, context, () => listBackups(config, name).at(-1) ?? null) : []),
        ]
      : [...backupSteps(project, config, "release", out), ...restoreCheckSteps(project, context, () => out.backup)]),
    {
      name: `prod ${version} built from dev's commit`,
      run: () => {
        if (dryRun) {
          const has = tryRun("git", ["-C", repoDir(name), "cat-file", "-e", `${commit}:Dockerfile`]).code === 0;
          return has ? ok(`would build ${imageName(name, version)} from ${commit.slice(0, 12)}`) : fail(`${commit.slice(0, 12)} has no Dockerfile`);
        }
        buildRelease(project, commit, version);
        return ok(`${imageName(name, version)} from ${commit.slice(0, 12)}, built from git, not from the working tree`);
      },
    },
    dryRun
      ? { name: `prod deployed on ${version}`, run: () => ok(`would replace ${from?.version ?? "nothing"} with ${version}`) }
      : deployStep(project, version),
    dryRun
      ? {
          name: "prod answers its smoke check",
          run: async () => {
            const check = await smoke(project, "prod");
            return check.ok ? ok(`prod answers now, on ${from?.version}: ${check.said}`) : fail(`prod does not answer now: ${check.said}`);
          },
        }
      : prodSmokeStep(project),
    {
      name: `the release is tagged ${version}`,
      run: () => {
        if (tryRun("git", ["-C", repoDir(name), "rev-parse", "-q", "--verify", `refs/tags/${version}`]).code === 0) {
          return fail(`the tag ${version} already exists`);
        }
        if (dryRun) return ok(`would tag ${commit.slice(0, 12)} as ${version}`);
        const schema = schemaOf(appliedMigrations(project, "prod"));
        git(name, "tag", "-a", version, "-m", `${version}, released ${new Date().toISOString().slice(0, 16)} UTC`, commit);
        project.releases.push({
          version, commit, image: imageName(name, version), at: new Date().toISOString(), backup: out.backup?.manifest.file ?? null, from: from?.version ?? null,
          schema, ...(breaking.length ? { breaking } : {}),
          ...(planned.value ? { plan: planned.value } : {}), ...(outsidePlan ? { outsidePlan } : {}),
        });
        project.current = version;
        delete project.failed;
        saveProject(project);
        return ok(`${commit.slice(0, 12)} tagged ${version}; prod runs ${version}, its database at ${schema?.version ?? "no migrations"}`);
      },
    },
  ];

  if (dryRun) process.stdout.write(`dry run of releasing ${name} ${version}: every check, and nothing changed\n\n`);
  let record;
  try {
    record = await runSteps(steps, { kind: "release", project: name, dryRun, facts: { version, from: from?.version ?? null, ...(outsidePlan ? { outsidePlan } : {}) } });
  } finally {
    cleanupRestore(context);
  }
  record.facts.backup = out.backup?.manifest.file ?? null;
  if (planned.value) record.facts.plan = planned.value.title;
  saveRecord(record);

  if (record.ok) {
    process.stdout.write(
      dryRun
        ? `\nEvery check passed. Nothing was changed: prod still runs ${from?.version}.\n`
        : `\n${name} ${version} is live. Rollback: ${C} rollback ${name}\n`,
    );
    return 0;
  }

  const deployFailed = record.failedStep === `prod deployed on ${version}` || record.failedStep === "prod answers its smoke check";
  if (!dryRun && deployFailed && from) {
    process.stdout.write(`\nprod did not come up on ${version}. Going back to ${from.version} automatically, keeping prod's data.\n\n`);
    const back = await runSteps(codeRollbackSteps(project, from, version, true, [{ version: `${version}, which failed`, commit }]), {
      kind: "rollback",
      project: name,
      facts: { automatic: true, from: version, to: from.version },
    });
    const schemaRefused = back.failedStep === `prod's database is one ${from.version} can run on`;
    if (schemaRefused) {
      // Prod stays on the failed version: a rollback goes back from it, with this release's backup.
      project.failed = { version, commit, image: imageName(name, version), at: new Date().toISOString(), backup: out.backup?.manifest.file ?? null, from: from.version, ...(breaking.length ? { breaking } : {}) };
      saveProject(project);
    }
    process.stdout.write(
      back.ok
        ? `\n${name} is back on ${from.version}, with its data. ${version} was not released; its image and backup are kept for a look.\n`
        : schemaRefused
          ? `\nprod is not answering on ${version}, and ${from.version}'s code alone cannot run on the database ${version}'s migration left. ` +
            `Nothing more was changed. The backup this release took holds the data as it was: ${restoreDataCommand(project)}\n`
          : `\nTHE AUTOMATIC ROLLBACK FAILED TOO. prod is not answering; the steps above say why.\n`,
    );
    record.facts.automaticRollback = back.ok ? "succeeded" : "failed";
    saveRecord(record);
  }
  return 1;
}

/* ----------------------------------------------------------- rollback -- */

async function rollback(args: string[]): Promise<number> {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    process.stderr.write(`usage: ${C} rollback <project> [--restore-data [--confirm-data-loss]]\n`);
    return 2;
  }
  const project = readProject(name);
  const config = readConfig();
  // After a release that failed past its breaking migration, prod is on that
  // release, not on the one recorded as current: go back from it (D35).
  const from = project.failed ?? currentRelease(project);
  const to = project.failed ? currentRelease(project) : previousRelease(project);
  if (!from || !to) {
    process.stderr.write(`prod runs ${from?.version ?? "nothing"}, the first version: there is nothing earlier to go back to.\n`);
    return 1;
  }

  if (!args.includes("--restore-data")) {
    // Going back changes the live app, so it is behind a fresh backup that has
    // passed its restore check, like a release (rule 2, D57).
    const context = newRestoreContext(project);
    const out: { backup: Backup | null } = { backup: null };
    const safety = [recoveryStep(), ...backupSteps(project, config, "rollback", out), ...restoreCheckSteps(project, context, () => out.backup)];
    let record;
    try {
      record = await runSteps(
        codeRollbackSteps(project, to, from.version, false, project.failed ? [{ version: `${project.failed.version}, which failed`, commit: project.failed.commit }] : [], safety),
        { kind: "rollback", project: name, facts: { from: from.version, to: to.version, restoreData: false } },
      );
    } finally {
      cleanupRestore(context);
    }
    record.facts.backup = out.backup?.manifest.file ?? null;
    saveRecord(record);
    if (record.ok) process.stdout.write(`\n${name} is back on ${to.version}, with all its data. The backup taken first: ${out.backup?.file}.\n`);
    return record.ok ? 0 : 1;
  }

  /* --restore-data: the data too, back to the backup taken before `from` was released (rule 8). */
  const backup = listBackups(config, name).find((b) => b.manifest.file === from.backup) ?? null;
  if (!backup) {
    process.stderr.write(`there is no backup from before ${from.version} on the backup target${from.backup ? ` (${from.backup})` : ""}, so the data cannot be put back.\n`);
    return 1;
  }
  const now = await smoke(project, "prod");
  const atBackup = backup.manifest.prodCheck?.entries;
  const lost = [
    `prod's data goes back to how it was at ${backup.manifest.created.slice(0, 16).replace("T", " ")} UTC, just before ${from.version} was released;`,
    "everything written to prod since then is lost from prod",
  ].join(" ") + (now.entries !== null && atBackup !== undefined && atBackup !== null ? ` (prod has ${now.entries} entries now; the backup has ${atBackup})` : "");
  if (!args.includes("--confirm-data-loss")) {
    process.stdout.write(
      `This rollback would also restore data, and that loses data (rule 8):\n  ${lost}.\n` +
        `A backup of prod as it is now is taken first, so even this can be undone.\n\n` +
        `To do it: ${C} rollback ${name} --restore-data --confirm-data-loss\n`,
    );
    return 2;
  }

  const context = newRestoreContext(project);
  context.backup = backup;
  const safety: { backup: Backup | null } = { backup: null };
  let record;
  try {
    record = await runSteps(
      [
        { name: `the backup from before ${from.version}: whole, and it decrypts`, run: async () => ok(`${backup.manifest.file}\n${await verifyAndDecrypt(context)}`) },
        {
          name: "a backup of prod as it is now, first",
          run: async () => {
            safety.backup = await takeBackup(project, config, "manual");
            return ok(`${safety.backup.file}: what is about to be replaced, kept`);
          },
        },
        { name: "prod's data replaced by the backup", run: async () => ok(await replaceProdData(project, context)) },
        ...codeRollbackSteps(project, to, from.version, false, project.failed ? [{ version: `${project.failed.version}, which failed`, commit: project.failed.commit }] : []).filter((step) => step.name !== "prod's data"),
      ],
      { kind: "rollback", project: name, facts: { from: from.version, to: to.version, restoreData: true, lost } },
    );
  } finally {
    cleanupRestore(context);
  }
  if (record.ok) process.stdout.write(`\n${name} is back on ${to.version}, with its data as it was before ${from.version}. The data it replaced is in ${safety.backup?.file}.\n`);
  return record.ok ? 0 : 1;
}

export const releaseCommands = { release, rollback };
