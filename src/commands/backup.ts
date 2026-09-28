/**
 * `allvibe backup-target`, `backup`, `restore-check`, `backups` and
 * `recovery-key` (rule 2, D13, D22).
 *
 * The steps are exported so that `release` runs exactly the same backup and
 * restore check, not a second copy of them.
 */
import { NAMES } from "../lib/brand.js";
import { readConfig, writeConfig, type HostConfig } from "../lib/config.js";
import {
  checkTarget,
  cleanupRestore,
  humanBytes,
  listBackups,
  newRestoreContext,
  prune,
  restoreIntoScratch,
  restoreVault,
  smokeScratch,
  takeBackup,
  verifyAndDecrypt,
  type Backup,
  type BackupKind,
  type RestoreCheckContext,
} from "../lib/backup.js";
import { containerState } from "../lib/docker.js";
import { confirmRecovery, recoveryStatus } from "../lib/keys.js";
import { containerName, readProject, type Project } from "../lib/project.js";
import { entries, fail, ok, runSteps, saveRecord, type Step } from "../lib/steps.js";

const C = NAMES.command;

/* ------------------------------------------------------ shared steps -- */

export function targetStep(config: HostConfig): Step {
  return {
    name: "the backup target is off this machine and writable",
    run: () => {
      const check = checkTarget(config.backupTarget);
      if (!check.ok) return fail(check.why, check.fix);
      return ok(`${check.why}; ${humanBytes(check.freeBytes ?? 0)} free`);
    },
  };
}

export function backupSteps(project: Project, config: HostConfig, kind: BackupKind, out: { backup: Backup | null }): Step[] {
  return [
    targetStep(config),
    {
      name: "prod's database is running",
      run: () => {
        const db = containerState(containerName(project.name, "prod", "db"));
        return db.status === "running"
          ? ok(`${containerName(project.name, "prod", "db")} ${db.health === "none" ? "running" : db.health}`)
          : fail(`prod's database is ${db.status}`, `the ${project.name} prod database is running: ${C} project status ${project.name}`);
      },
    },
    {
      name: "an encrypted backup of prod, on the target",
      run: async () => {
        out.backup = await takeBackup(project, config, kind);
        const m = out.backup.manifest;
        return ok(
          `${out.backup.file} (${humanBytes(m.bytes)}, sha256 ${m.sha256.slice(0, 12)}…)\n` +
            `encrypted to this machine's backup key and to the recovery key; prod ${m.release?.version ?? "?"}` +
            `${m.prodCheck?.entries !== undefined && m.prodCheck?.entries !== null ? `, ${entries(m.prodCheck.entries)} when it was taken` : ""}` +
            `${m.vault ? `\nand the key vault beside it: ${m.vault.file} (${m.vault.keys.length} key${m.vault.keys.length === 1 ? "" : "s"}, encrypted to the same two keys)` : ""}`,
        );
      },
    },
  ];
}

export function restoreCheckSteps(project: Project, context: RestoreCheckContext, choose: () => Backup | null): Step[] {
  return [
    {
      name: "the backup to check",
      run: () => {
        context.backup = choose();
        if (!context.backup) return fail(`there is no backup of ${project.name} on the target`, `${C} backup ${project.name}`);
        const m = context.backup.manifest;
        return ok(`${context.backup.file}, taken ${m.created.slice(0, 19).replace("T", " ")} UTC (${m.kind})`);
      },
    },
    { name: "it is whole, and it decrypts", run: async () => ok(await verifyAndDecrypt(context)) },
    { name: "its key vault restores", run: async () => ok(await restoreVault(context)) },
    { name: "it restores into a scratch copy", run: async () => ok(await restoreIntoScratch(project, context)) },
    { name: "the app's own health check passes against the copy", run: async () => ok(await smokeScratch(project, context)) },
  ];
}

/* ----------------------------------------------------------- commands -- */

async function backupTarget(args: string[]): Promise<number> {
  const [sub, target] = args;
  const config = readConfig();
  if (sub === "show" || sub === undefined) {
    if (!config.backupTarget) {
      process.stdout.write(`No backup target is set. ${C} backup-target set <directory on a separate disk>\n`);
      return 1;
    }
    const check = checkTarget(config.backupTarget);
    process.stdout.write(`${config.backupTarget}\n  ${check.ok ? "✓" : "✗"} ${check.why}${check.freeBytes !== undefined ? `; ${humanBytes(check.freeBytes)} free` : ""}\n`);
    return check.ok ? 0 : 1;
  }
  if (sub !== "set" || !target) {
    process.stderr.write(`usage: ${C} backup-target set <directory> | show\n`);
    return 2;
  }
  const absolute = target.replace(/\/+$/, "") || "/";
  const record = await runSteps(
    [
      targetStep({ ...config, backupTarget: absolute }),
      {
        name: "saved as this machine's backup target",
        run: () => {
          const changed = writeConfig({ ...config, backupTarget: absolute });
          return ok(changed ? `backups will go to ${absolute}` : `already ${absolute}`);
        },
      },
    ],
    { kind: "backup-target" },
  );
  return record.ok ? 0 : 1;
}

async function backup(args: string[]): Promise<number> {
  const [name] = args;
  if (!name) {
    process.stderr.write(`usage: ${C} backup <project>\n`);
    return 2;
  }
  const project = readProject(name);
  const config = readConfig();
  const out: { backup: Backup | null } = { backup: null };
  const record = await runSteps(
    [
      ...backupSteps(project, config, "manual", out),
      { name: "old backups pruned", run: () => { const gone = prune(config, name); return ok(gone.length ? `removed ${gone.join(", ")}` : "none old enough"); } },
    ],
    { kind: "backup", project: name },
  );
  if (out.backup) {
    record.facts.backup = out.backup.manifest.file;
    saveRecord(record);
  }
  return record.ok ? 0 : 1;
}

export async function runRestoreCheck(project: Project, choose: () => Backup | null, kind = "restore-check"): Promise<{ ok: boolean; entries: number | null }> {
  const context = newRestoreContext(project);
  let record;
  try {
    record = await runSteps(restoreCheckSteps(project, context, choose), {
      kind,
      project: project.name,
      facts: {},
    });
  } finally {
    cleanupRestore(context);
    process.stdout.write(`     the scratch copy, its network and the decrypted file are removed; prod was not touched\n`);
  }
  record.facts.backup = context.backup?.manifest.file ?? null;
  record.facts.entries = context.entries;
  saveRecord(record);
  return { ok: record.ok, entries: context.entries };
}

async function restoreCheck(args: string[]): Promise<number> {
  const [name] = args;
  const at = args.indexOf("--backup");
  const wanted = at >= 0 ? args[at + 1] : null;
  if (!name) {
    process.stderr.write(`usage: ${C} restore-check <project> [--backup <file name>]\n`);
    return 2;
  }
  const project = readProject(name);
  const config = readConfig();
  const result = await runRestoreCheck(project, () => {
    const all = listBackups(config, name);
    return wanted ? (all.find((b) => b.manifest.file === wanted || b.file === wanted) ?? null) : (all.at(-1) ?? null);
  });
  return result.ok ? 0 : 1;
}

function backups(args: string[]): number {
  const [name] = args;
  if (!name) {
    process.stderr.write(`usage: ${C} backups <project>\n`);
    return 2;
  }
  readProject(name);
  const list = listBackups(readConfig(), name);
  if (list.length === 0) {
    process.stdout.write(`No backups of ${name} yet.\n`);
    return 0;
  }
  for (const b of list) {
    const m = b.manifest;
    process.stdout.write(`${m.created.slice(0, 19).replace("T", " ")} UTC  ${m.kind.padEnd(9)} ${m.release?.version ?? "?"}  ${humanBytes(m.bytes).padStart(8)}  ${m.file}\n`);
  }
  return 0;
}

/**
 * The owner hands back their copy of the recovery key on standard input. It is
 * never asked for (rule 4): if standard input is a terminal, this refuses and
 * says how to pipe it in.
 */
async function recoveryKey(args: string[]): Promise<number> {
  const [sub] = args;
  if (sub === "status" || sub === undefined) {
    const status = recoveryStatus();
    process.stdout.write(
      status.state === "pending"
        ? `Not yet confirmed. Copy ${NAMES.recoveryPending} off this machine, then: ${C} recovery-key confirm < your-copy\n`
        : status.state === "missing"
          ? "There is no recovery key.\n"
          : `Confirmed ${status.confirmedAt?.slice(0, 10)}${status.state === "overdue" ? ", more than 180 days ago: confirm it again" : ""}.${status.pendingOnMachine ? ` A copy is still in ${NAMES.recoveryPending}.` : ""}\n`,
    );
    return status.state === "confirmed" ? 0 : 1;
  }
  if (sub !== "confirm") {
    process.stderr.write(`usage: ${C} recovery-key status | confirm < your-copy\n`);
    return 2;
  }
  if (process.stdin.isTTY) {
    process.stderr.write(
      `${C} recovery-key confirm reads your copy of the key from standard input and never asks for it.\n` +
        `Pipe it in: ${C} recovery-key confirm < your-copy\n`,
    );
    return 2;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const record = await runSteps(
    [
      {
        name: "your copy is this machine's recovery key",
        run: () => {
          const { removedPending } = confirmRecovery(text);
          return ok(
            `it matches the public half every backup is encrypted to; confirmed ${new Date().toISOString().slice(0, 10)}` +
              `${removedPending ? `\n${NAMES.recoveryPending} is deleted: your copy is now the only one` : ""}`,
          );
        },
      },
    ],
    { kind: "recovery-key-confirm" },
  );
  return record.ok ? 0 : 1;
}

export const backupCommands = {
  "backup-target": backupTarget,
  backup,
  "restore-check": restoreCheck,
  backups: async (args: string[]) => backups(args),
  "recovery-key": recoveryKey,
};

