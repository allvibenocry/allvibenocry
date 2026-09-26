/**
 * `allvibe release <project> [--dry-run]` and `allvibe rollback <project>`
 * (rules 2, 7 and 8; D25, D26).
 *
 * A release is, in order, stopping at the first failure:
 *
 *   dev runs the commit being released and answers its smoke check
 *   the recovery key is confirmed, so a backup can be restored off the machine
 *   a fresh backup of prod, kept apart from rotation
 *   a restore check of that backup (four steps)
 *   prod built from dev's commit
 *   prod deployed on the new version
 *   prod answers its smoke check
 *   the version tag
 *
 * If the deploy or prod's smoke check fails, prod goes back to the version it
 * ran before, automatically, keeping its data.
 *
 * A rollback goes back to the previous version's code and keeps prod's data.
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
import { fail, ok, runSteps, saveRecord, type Step } from "../lib/steps.js";
import { backupSteps, restoreCheckSteps, targetStep } from "./backup.js";
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

/** Back to an earlier version's code, keeping prod's data. */
function codeRollbackSteps(project: Project, to: Release, from: string, automatic: boolean): Step[] {
  return [
    {
      name: `the version to go back to: ${to.version}`,
      run: () => ok(`${to.version}, from ${to.commit.slice(0, 12)}; ${ensureImage(project, to)}`),
    },
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
        saveProject(project);
        return ok(`prod answers on ${to.version}: ${check.said}`);
      },
    },
  ];
}

/* ------------------------------------------------------------ release -- */

async function release(args: string[]): Promise<number> {
  const name = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  if (!name) {
    process.stderr.write(`usage: ${C} release <project> [--dry-run]\n`);
    return 2;
  }
  const project = readProject(name);
  const config = readConfig();
  const from = currentRelease(project);
  const version = nextVersion(project);
  const context = newRestoreContext(project);
  const out: { backup: Backup | null } = { backup: null };
  let commit = "";

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
    },
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
        git(name, "tag", "-a", version, "-m", `${version}, released ${new Date().toISOString().slice(0, 16)} UTC`, commit);
        project.releases.push({ version, commit, image: imageName(name, version), at: new Date().toISOString(), backup: out.backup?.manifest.file ?? null, from: from?.version ?? null });
        project.current = version;
        saveProject(project);
        return ok(`${commit.slice(0, 12)} tagged ${version}; prod runs ${version}`);
      },
    },
  ];

  if (dryRun) process.stdout.write(`dry run of releasing ${name} ${version}: every check, and nothing changed\n\n`);
  let record;
  try {
    record = await runSteps(steps, { kind: "release", project: name, dryRun, facts: { version, from: from?.version ?? null } });
  } finally {
    cleanupRestore(context);
  }
  record.facts.backup = out.backup?.manifest.file ?? null;
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
    const back = await runSteps(codeRollbackSteps(project, from, version, true), {
      kind: "rollback",
      project: name,
      facts: { automatic: true, from: version, to: from.version },
    });
    process.stdout.write(
      back.ok
        ? `\n${name} is back on ${from.version}, with its data. ${version} was not released; its image and backup are kept for a look.\n`
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
  const from = currentRelease(project);
  const to = previousRelease(project);
  if (!from || !to) {
    process.stderr.write(`prod runs ${from?.version ?? "nothing"}, the first version: there is nothing earlier to go back to.\n`);
    return 1;
  }

  if (!args.includes("--restore-data")) {
    const record = await runSteps(codeRollbackSteps(project, to, from.version, false), {
      kind: "rollback",
      project: name,
      facts: { from: from.version, to: to.version, restoreData: false },
    });
    if (record.ok) process.stdout.write(`\n${name} is back on ${to.version}, with all its data.\n`);
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
        ...codeRollbackSteps(project, to, from.version, false).filter((step) => step.name !== "prod's data"),
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
