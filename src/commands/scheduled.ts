/**
 * `allvibe scheduled-backup`: what the daily timer runs (item 6). For every
 * project, a backup of prod and then a restore check of that very backup.
 *
 * Each project is its own operation: it stops at its first failure (rule 7)
 * and is recorded with its result and reason, and a failure in one project
 * does not leave the others without their backup. The run as a whole fails,
 * and is recorded as failed, if any project's did, so the timer's service is
 * marked failed and `doctor` says so.
 */
import { NAMES } from "../lib/brand.js";
import { readConfig } from "../lib/config.js";
import { listBackups, prune, type Backup } from "../lib/backup.js";
import { listProjects } from "../lib/project.js";
import { ok, runSteps, saveRecord } from "../lib/steps.js";
import { backupSteps, runRestoreCheck } from "./backup.js";

export async function scheduledBackup(): Promise<number> {
  const config = readConfig();
  const projects = listProjects();
  const results: Array<{ project: string; backup: string | null; backedUp: boolean; restored: boolean; entries: number | null }> = [];

  for (const project of projects) {
    process.stdout.write(`\n== ${project.name}: backup\n`);
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
    let entries: number | null = null;
    if (backup.ok && out.backup) {
      process.stdout.write(`\n== ${project.name}: restore check of that backup\n`);
      const file = out.backup.manifest.file;
      const check = await runRestoreCheck(project, () => listBackups(config, project.name).find((b) => b.manifest.file === file) ?? null);
      restored = check.ok;
      entries = check.entries;
    }
    results.push({ project: project.name, backup: out.backup?.manifest.file ?? null, backedUp: backup.ok, restored, entries });
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
              ? ok(results.map((r) => `${r.project}: ${r.backup}, restored with ${r.entries ?? "?"} entries`).join("\n"))
              : { ok: false, evidence: "", why: failed.map((r) => `${r.project}: ${!r.backedUp ? "the backup failed" : "the restore check failed"}`).join("\n"), fix: `the reasons are in the runs above, and in: ${NAMES.command} runs` },
      },
    ],
    { kind: "scheduled-backup", facts: { results } },
  );
  return record.ok ? 0 : 1;
}
