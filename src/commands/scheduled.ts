/**
 * `allvibe scheduled-backup`: what the daily timer runs (item 6). For every
 * project, a backup of prod and then a restore check of that very backup.
 *
 * Each project is its own operation: it stops at its first failure (rule 7)
 * and is recorded with its result and reason, and a failure in one project
 * does not leave the others without their backup. The run as a whole fails,
 * and is recorded as failed, if any project's did, so the timer's service is
 * marked failed and `doctor` says so.
 *
 * Then doctor's checks run, and their result is kept for the panel, with a
 * short history (D58).
 */
import { NAMES } from "../lib/brand.js";
import { readConfig, type HostConfig } from "../lib/config.js";
import { listBackups, prune, type Backup } from "../lib/backup.js";
import { setLockOrigin, waitForLock } from "../lib/lock.js";
import { listProjects, type Project } from "../lib/project.js";
import { entries, fail, ok, runSteps, saveRecord } from "../lib/steps.js";
import { backupSteps, runRestoreCheck } from "./backup.js";
import { nightlyDoctor } from "./doctor.js";

/** How long the nightly backup waits for an app's lock. */
const LOCK_WAIT_MS = 30 * 60_000;

interface Result {
  project: string;
  backup: string | null;
  backedUp: boolean;
  restored: boolean;
  entries: number | null;
}

/** One project's backup, and a restore check of that very backup. */
async function backUpOne(project: Project, config: HostConfig): Promise<Result> {
  const out: { backup: Backup | null } = { backup: null };
  const backup = await runSteps(
    [
      ...backupSteps(project, config, "scheduled", out),
      { name: "old backups pruned", run: () => { const gone = prune(config, project.name); return ok(gone.length ? `removed ${gone.join(", ")}` : "none old enough"); } },
    ],
    { kind: "backup", project: project.name, facts: { scheduled: true } },
  );
  if (out.backup) {
    backup.facts.backup = out.backup.manifest.file;
    saveRecord(backup);
  }
  let restored = false;
  let found: number | null = null;
  if (backup.ok && out.backup) {
    process.stdout.write(`\n== ${project.name}: restore check of that backup\n`);
    const file = out.backup.manifest.file;
    const check = await runRestoreCheck(project, () => listBackups(config, project.name).find((b) => b.manifest.file === file) ?? null);
    restored = check.ok;
    found = check.entries;
  }
  return { project: project.name, backup: out.backup?.manifest.file ?? null, backedUp: backup.ok, restored, entries: found };
}

export async function scheduledBackup(): Promise<number> {
  const config = readConfig();
  const projects = listProjects();
  const results: Result[] = [];

  setLockOrigin("the nightly backup");
  for (const project of projects) {
    process.stdout.write(`\n== ${project.name}: backup\n`);
    // Not beside a release or going back of the same app (D72): wait for it
    // to end, up to half an hour, then record why there is no backup tonight.
    const lock = await waitForLock(project.name, "backup", LOCK_WAIT_MS);
    if (!lock.ok) {
      const refused = lock.message;
      await runSteps([{ name: "the app's lock", run: () => fail(refused, `the backup runs again tomorrow night, or now: ${NAMES.command} backup ${project.name}`) }], { kind: "backup", project: project.name, facts: { scheduled: true } });
      results.push({ project: project.name, backup: null, backedUp: false, restored: false, entries: null });
      continue;
    }
    try {
      results.push(await backUpOne(project, config));
    } finally {
      lock.release();
    }
  }

  const failed = results.filter((r) => !r.backedUp || !r.restored);
  process.stdout.write("\n");
  const record = await runSteps(
    [
      {
        name: "every project backed up and restore-checked",
        run: () =>
          projects.length === 0
            ? ok("no projects yet, so there is nothing to back up")
            : failed.length === 0
              ? ok(results.map((r) => `${r.project}: ${r.backup}, restored with ${entries(r.entries)}`).join("\n"))
              : { ok: false, evidence: "", why: failed.map((r) => `${r.project}: ${!r.backedUp ? "the backup failed" : "the restore check failed"}`).join("\n"), fix: `the reasons are in the runs above, and in: ${NAMES.command} runs` },
      },
    ],
    { kind: "scheduled-backup", facts: { results } },
  );

  // doctor, after tonight's backups are recorded, so that it sees them, and
  // kept for the panel (D58). Its result does not change the backups'.
  process.stdout.write("\n== doctor, with the nightly backup\n");
  try {
    const doctor = nightlyDoctor();
    process.stdout.write(`${doctor.summary}${doctor.problems ? `\n${doctor.checks.filter((c) => c.status === "problem").map((c) => `  ✗ ${c.text}`).join("\n")}` : ""}\nkept in ${NAMES.doctorDir}\n`);
  } catch (error) {
    process.stdout.write(`doctor could not run: ${(error as Error).message}\n`);
  }
  return record.ok ? 0 : 1;
}
