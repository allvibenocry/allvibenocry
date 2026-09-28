/**
 * Backups of prod, and the restore test that proves one works (rule 2, D13,
 * D22).
 *
 * A backup is `pg_dump -Fc`, taken inside prod's own database container (so
 * the client always matches the server), streamed through `age` to both the
 * host key and the recovery key, and written to the backup target as
 * `<name>.partial`, flushed, then renamed. A small manifest is written last: a
 * backup without a manifest is by definition incomplete.
 *
 * A restore check decrypts a whole backup first (so a damaged file fails
 * before anything is restored), restores it into a scratch database on a
 * scratch network, runs the backed-up version of the app against it, asks the
 * app's own health check, and removes everything it made. It never touches
 * prod: nothing it creates shares a name, a network or a volume with prod.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { posix as path } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { NAMES } from "./brand.js";
import type { HostConfig } from "./config.js";
import { judgeTarget, placementOf, type OffMachineVerdict } from "./devices.js";
import { docker, engineInfo, tryDocker } from "./docker.js";
import { writeAtomic } from "./files.js";
import { readRecipient } from "./keys.js";
import { readOverrides } from "./overrides.js";
import { containerName, currentRelease, imageName, POSTGRES_IMAGE, smoke, type Project } from "./project.js";
import { tryRun } from "./run.js";
import { listKeys, runtimeFile, secretPath, unlockScope, vaultDir } from "./vault.js";

const C = NAMES.command;

export type BackupKind = "scheduled" | "manual" | "release";

export interface BackupManifest {
  format: 1;
  project: string;
  environment: "prod";
  kind: BackupKind;
  created: string;
  file: string;
  bytes: number;
  sha256: string;
  release: { version: string; commit: string; image: string } | null;
  /** What prod's own health check said just before the dump. */
  prodCheck: { entries: number | null; version: string | null } | null;
  recipients: { host: string; recovery: string };
  postgresImage: string;
  /**
   * The project's key vault, every scope, as it was (D37): a tar of the vault's
   * files, encrypted again to the same two keys. Absent when it had no keys.
   */
  vault?: { file: string; bytes: number; sha256: string; keys: Array<{ scope: string; name: string }> } | null;
}

/** A manifest and where it is. */
export interface Backup {
  manifest: BackupManifest;
  dir: string;
  file: string;
}

/* ------------------------------------------------------------ the target -- */

export const targetRoot = (config: HostConfig) => path.join(config.backupTarget ?? "/nonexistent", C);
export const projectBackupDir = (config: HostConfig, project: string) => path.join(targetRoot(config), project);
export const releaseBackupDir = (config: HostConfig, project: string) => path.join(projectBackupDir(config, project), "releases");

export interface TargetCheck extends OffMachineVerdict {
  fix?: string;
  freeBytes?: number;
}

/**
 * Is the configured target usable: set, there, off the machine (D22), and
 * writable by this process, which is the one that will write to it.
 */
export function checkTarget(target: string | null): TargetCheck {
  if (!target) return { ok: false, why: "no backup target is set", fix: `${C} backup-target set <directory on a disk that is not this machine's>` };
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return { ok: false, why: `${target} does not exist`, fix: "the backup disk is connected and mounted there" };
  }
  const overrides = readOverrides({ file: NAMES.overridesFile });
  const declared = overrides.active ? overrides.values.get("external-backup-mount") : undefined;
  const dataRoot = engineInfo()?.rootDir ?? "/var/lib/docker";
  let verdict: OffMachineVerdict;
  try {
    verdict = judgeTarget(placementOf(target), placementOf("/"), placementOf(dataRoot), declared);
  } catch (error) {
    return { ok: false, why: `could not tell where ${target} is: ${(error as Error).message}` };
  }
  if (!verdict.ok) {
    return { ...verdict, fix: "a directory on a separate disk (a USB disk, a NAS share mounted on this machine), mounted before the backup runs" };
  }
  // Written and removed as the real writer (CLAUDE.md, mistake 15).
  const probe = path.join(target, `.${C}-write-test-${randomBytes(4).toString("hex")}`);
  try {
    writeFileSync(probe, "test");
    unlinkSync(probe);
  } catch (error) {
    return { ok: false, why: `${target} is not writable by ${NAMES.user}: ${(error as NodeJS.ErrnoException).code}`, fix: `the directory belongs to ${NAMES.user} or is writable by it` };
  }
  const stats = statfsSync(target);
  return { ...verdict, freeBytes: Number(stats.bavail) * Number(stats.bsize) };
}

/* ----------------------------------------------------------------- write -- */

function stamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** Two programs, the first piped into the second, the second into a file. */
function pipeToFile(first: [string, string[]], second: [string, string[]], file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = openSync(file, "w", 0o600);
    const a = spawn(first[0], first[1], { stdio: ["ignore", "pipe", "pipe"] });
    const b = spawn(second[0], second[1], { stdio: ["pipe", fd, "pipe"] });
    a.stdout.pipe(b.stdin!);
    let aSaid = "";
    let bSaid = "";
    a.stderr.on("data", (d) => (aSaid += d));
    b.stderr!.on("data", (d) => (bSaid += d));
    const codes: { a?: number | null; b?: number | null } = {};
    const finish = () => {
      if (!("a" in codes) || !("b" in codes)) return;
      fsyncSync(fd);
      closeSync(fd);
      if (codes.a !== 0) reject(new Error(`${first[0]} ${first[1].slice(0, 3).join(" ")} exited ${codes.a}: ${aSaid.trim().slice(-300)}`));
      else if (codes.b !== 0) reject(new Error(`${second[0]} exited ${codes.b}: ${bSaid.trim().slice(-300)}`));
      else resolve();
    };
    a.on("close", (code) => { codes.a = code; finish(); });
    b.on("close", (code) => { codes.b = code; finish(); });
    a.on("error", reject);
    b.on("error", reject);
  });
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (d) => hash.update(d)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

export async function takeBackup(project: Project, config: HostConfig, kind: BackupKind): Promise<Backup> {
  const target = checkTarget(config.backupTarget);
  if (!target.ok) throw new Error(target.why);
  const dir = kind === "release" ? releaseBackupDir(config, project.name) : projectBackupDir(config, project.name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const recipients = { host: readRecipient(NAMES.hostRecipient), recovery: readRecipient(NAMES.recoveryRecipient) };
  const release = currentRelease(project);
  const check = await smoke(project, "prod");
  const created = new Date();
  const file = `${project.name}-prod-${stamp(created)}.dump.age`;
  const partial = path.join(dir, `${file}.partial`);

  await pipeToFile(
    ["docker", ["exec", containerName(project.name, "prod", "db"), "pg_dump", "-U", "app", "-d", "app", "-Fc", "--no-owner", "--no-privileges"]],
    ["age", ["--encrypt", "-r", recipients.host, "-r", recipients.recovery]],
    partial,
  );
  renameSync(partial, path.join(dir, file));

  // The key vault goes with the data, so a machine restored from the recovery
  // key gets its keys back too (D37). Its values are already encrypted; the
  // whole is encrypted again, so the backup disk shows no key's name either.
  let vault: BackupManifest["vault"] = null;
  const keys = listKeys(project.name);
  if (keys.length > 0) {
    const vaultFile = file.replace(/\.dump\.age$/, ".vault.tar.age");
    const vaultPartial = path.join(dir, `${vaultFile}.partial`);
    await pipeToFile(
      ["tar", ["-C", path.dirname(vaultDir(project.name)), "-cf", "-", "--exclude=*.partial", "--exclude=*.previous", path.basename(vaultDir(project.name))]],
      ["age", ["--encrypt", "-r", recipients.host, "-r", recipients.recovery]],
      vaultPartial,
    );
    renameSync(vaultPartial, path.join(dir, vaultFile));
    vault = {
      file: vaultFile,
      bytes: statSync(path.join(dir, vaultFile)).size,
      sha256: await sha256File(path.join(dir, vaultFile)),
      keys: keys.map((k) => ({ scope: k.scope, name: k.name })),
    };
  }

  const manifest: BackupManifest = {
    format: 1,
    project: project.name,
    environment: "prod",
    kind,
    created: created.toISOString(),
    file,
    bytes: statSync(path.join(dir, file)).size,
    sha256: await sha256File(path.join(dir, file)),
    release: release ? { version: release.version, commit: release.commit, image: release.image } : null,
    prodCheck: check.ok ? { entries: check.entries, version: check.version } : null,
    recipients,
    postgresImage: POSTGRES_IMAGE,
    vault,
  };
  writeAtomic(path.join(dir, file.replace(/\.dump\.age$/, ".json")), `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
  return { manifest, dir, file: path.join(dir, file) };
}

/* ------------------------------------------------------------------ list -- */

export function listBackups(config: HostConfig, project: string): Backup[] {
  const found: Backup[] = [];
  for (const dir of [projectBackupDir(config, project), releaseBackupDir(config, project)]) {
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of files.filter((f) => f.endsWith(".json"))) {
      try {
        const manifest = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as BackupManifest;
        if (manifest.format === 1 && manifest.project === project && existsSync(path.join(dir, manifest.file))) {
          found.push({ manifest, dir, file: path.join(dir, manifest.file) });
        }
      } catch {
        /* not ours */
      }
    }
  }
  return found.sort((a, b) => a.manifest.created.localeCompare(b.manifest.created));
}

/**
 * Scheduled and manual backups older than the retention window go, but never
 * the newest three and never a release backup: those live in releases/ and
 * are what a rollback would need (CLAUDE.md, mistake 9). Only files this code
 * wrote, by their exact names.
 */
export function prune(config: HostConfig, project: string, now = new Date()): string[] {
  const removed: string[] = [];
  const cutoff = now.getTime() - config.backupRetentionDays * 86_400_000;
  const scheduled = listBackups(config, project).filter((b) => b.manifest.kind !== "release");
  for (const backup of scheduled.slice(0, Math.max(0, scheduled.length - 3))) {
    if (new Date(backup.manifest.created).getTime() >= cutoff) continue;
    const pattern = new RegExp(`^${project}-prod-\\d{8}T\\d{6}Z\\.dump\\.age$`);
    if (!pattern.test(backup.manifest.file)) continue;
    rmSync(backup.file);
    if (backup.manifest.vault?.file === backup.manifest.file.replace(/\.dump\.age$/, ".vault.tar.age")) {
      rmSync(path.join(backup.dir, backup.manifest.vault.file), { force: true });
    }
    rmSync(backup.file.replace(/\.dump\.age$/, ".json"));
    removed.push(backup.manifest.file);
  }
  return removed;
}

/* --------------------------------------------------------- restore check -- */

export interface RestoreCheckContext {
  backup: Backup | null;
  work: string;
  decrypted: string;
  scratchDb: string;
  scratchApp: string;
  network: string;
  image: string;
  entries: number | null;
  said: string;
}

export function newRestoreContext(project: Project): RestoreCheckContext {
  const work = path.join(NAMES.stateDir, "tmp", `restore-${project.name}-${stamp()}`);
  return {
    backup: null,
    work,
    decrypted: path.join(work, "backup.dump"),
    scratchDb: `${C}-${project.name}-restore-db`,
    scratchApp: `${C}-${project.name}-restore-app`,
    network: `${C}-${project.name}-restore`,
    image: "",
    entries: null,
    said: "",
  };
}

const scratchLabels = (project: Project) => ["--label", `${C}.project=${project.name}`, "--label", `${C}.role=restore-check`];

/** Remove whatever a restore check made, including leftovers of an earlier one. */
export function cleanupRestore(context: RestoreCheckContext): void {
  tryDocker(["rm", "-f", "-v", context.scratchApp, context.scratchDb]);
  tryDocker(["network", "rm", context.network]);
  rmSync(context.work, { recursive: true, force: true });
}

/** Whole file, checksum, then decryption to a private temporary file. */
export async function verifyAndDecrypt(context: RestoreCheckContext): Promise<string> {
  const backup = context.backup;
  if (!backup) throw new Error("no backup chosen");
  const sum = await sha256File(backup.file);
  if (sum !== backup.manifest.sha256) throw new Error(`${backup.manifest.file} does not match its checksum: it is damaged`);
  mkdirSync(context.work, { recursive: true, mode: 0o700 });
  const result = tryRun("age", ["--decrypt", "-i", NAMES.hostKey, "-o", context.decrypted, backup.file]);
  if (result.code !== 0) throw new Error(`age could not decrypt it with this machine's backup key: ${result.stderr.trim()}`);
  return `checksum matches; decrypted with this machine's backup key (${statSync(context.decrypted).size} bytes, not kept)`;
}

/**
 * The backup's key vault (D37): whole, decrypted with this machine's key,
 * unpacked into the private work directory, and every value in it decrypted as
 * well, into memory, and thrown away. Proves the keys come back with the data.
 */
export async function restoreVault(context: RestoreCheckContext): Promise<string> {
  const backup = context.backup;
  if (!backup) throw new Error("no backup chosen");
  const vault = backup.manifest.vault;
  if (!vault) return "the project had no keys when this backup was taken";
  const file = path.join(backup.dir, vault.file);
  if (!existsSync(file)) throw new Error(`${vault.file} is missing: the backup's keys are not there`);
  if ((await sha256File(file)) !== vault.sha256) throw new Error(`${vault.file} does not match its checksum: it is damaged`);
  const tar = path.join(context.work, "vault.tar");
  const into = path.join(context.work, "vault-restored");
  mkdirSync(into, { recursive: true, mode: 0o700 });
  const opened = tryRun("age", ["--decrypt", "-i", NAMES.hostKey, "-o", tar, file]);
  if (opened.code !== 0) throw new Error(`age could not decrypt the backup's key vault with this machine's key: ${opened.stderr.trim()}`);
  const unpacked = tryRun("tar", ["-C", into, "-xf", tar]);
  if (unpacked.code !== 0) throw new Error(`the backup's key vault does not unpack: ${unpacked.stderr.trim()}`);
  const index = JSON.parse(readFileSync(path.join(into, "vault", "index.json"), "utf8")) as { keys: Array<{ scope: string; name: string }> };
  const restored: string[] = [];
  for (const k of index.keys) {
    // Decrypted into memory to prove it can be, never written or shown.
    const one = tryRun("age", ["--decrypt", "-i", NAMES.hostKey, path.join(into, "vault", k.scope, `${k.name}.age`)]);
    if (one.code !== 0) throw new Error(`the backup's ${k.scope} ${k.name} does not decrypt with this machine's key`);
    restored.push(`${k.scope} ${k.name}`);
  }
  const expected = vault.keys.map((k) => `${k.scope} ${k.name}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify([...restored].sort())) {
    throw new Error(`the backup's key vault holds ${restored.join(", ") || "nothing"}, not what its manifest lists: ${expected.join(", ")}`);
  }
  return `${restored.length} key${restored.length === 1 ? "" : "s"} restored, each one decrypted with this machine's key (not shown): ${restored.join(", ")}`;
}

async function until(test: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (test()) return true;
    await sleep(1000);
  }
  return false;
}

/** A scratch database on a scratch network, and the backup restored into it. */
export async function restoreIntoScratch(project: Project, context: RestoreCheckContext): Promise<string> {
  cleanupRestore({ ...context, work: "/nonexistent" });
  docker(["network", "create", "--internal", ...scratchLabels(project), context.network]);
  docker([
    "run", "-d", "--name", context.scratchDb, "--network", context.network, ...scratchLabels(project),
    // Nothing else is on this network and it has no route out: no password needed.
    "-e", "POSTGRES_USER=app", "-e", "POSTGRES_DB=app", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    context.backup?.manifest.postgresImage ?? POSTGRES_IMAGE,
  ]);
  // Over TCP: during its first start Postgres listens only on its socket, then restarts.
  const ready = await until(() => tryDocker(["exec", context.scratchDb, "pg_isready", "-h", "127.0.0.1", "-U", "app", "-d", "app"]).code === 0, 90_000);
  if (!ready) throw new Error("the scratch database did not start within 90 s");

  await pgRestore(context.scratchDb, context.decrypted);
  return `restored into ${context.scratchDb} on the scratch network ${context.network}: ${publicTables(context.scratchDb)} tables`;
}

/** pg_restore inside a database container, from a decrypted dump, streamed. */
function pgRestore(container: string, file: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fd = openSync(file, "r");
    const restore = spawn("docker", ["exec", "-i", container, "pg_restore", "-U", "app", "-d", "app", "--no-owner", "--no-privileges", "--exit-on-error"], {
      stdio: [fd, "pipe", "pipe"],
    });
    let said = "";
    restore.stderr!.on("data", (d) => (said += d));
    restore.on("close", (code) => {
      closeSync(fd);
      if (code === 0) resolve();
      else reject(new Error(`pg_restore exited ${code}: ${said.trim().slice(-300)}`));
    });
    restore.on("error", reject);
  });
}

const publicTables = (container: string) =>
  tryDocker(["exec", container, "psql", "-U", "app", "-d", "app", "-At", "-c", "select count(*) from information_schema.tables where table_schema = 'public'"]).stdout.trim();

/**
 * Prod's database replaced by a decrypted backup: only for an explicit,
 * confirmed data rollback (rule 8), after a backup of the current state. The
 * database is dropped and created empty first, so nothing of the replaced
 * data mixes with the restored.
 */
export async function replaceProdData(project: Project, context: RestoreCheckContext): Promise<string> {
  const db = containerName(project.name, "prod", "db");
  tryDocker(["stop", containerName(project.name, "prod", "app")]);
  docker(["exec", db, "psql", "-U", "app", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "drop database app with (force)", "-c", "create database app owner app"]);
  await pgRestore(db, context.decrypted);
  return `prod's app stopped, its database emptied and restored from the backup: ${publicTables(db)} tables`;
}

/** The backed-up version of the app, against the restored copy, and its own health check. */
export async function smokeScratch(project: Project, context: RestoreCheckContext): Promise<string> {
  const wanted = context.backup?.manifest.release?.image;
  const fallback = currentRelease(project)?.image ?? imageName(project.name, "v1");
  context.image = wanted && tryDocker(["image", "inspect", wanted]).code === 0 ? wanted : fallback;
  const password = path.join(context.work, "password");
  // The scratch database trusts its network, but the app refuses to start without the file.
  writeFileSync(password, "restore-check", { mode: 0o644 });
  // An app that reads its keys when it starts gets prod's, as files, the way prod does (D37).
  // The scratch network has no route out, so they can reach nothing from here.
  const keys = unlockScope(project.name, "prod").flatMap((key) => ["-v", `${runtimeFile(project.name, "prod", key)}:${secretPath(key)}:ro`, "-e", `${key}_FILE=${secretPath(key)}`]);
  docker([
    "run", "-d", "--name", context.scratchApp, "--network", context.network, ...scratchLabels(project),
    "-e", "APP_ENV=restore-check", "-e", `DATABASE_HOST=${context.scratchDb}`, "-e", "DATABASE_USER=app",
    "-e", "DATABASE_NAME=app", "-e", "DATABASE_PASSWORD_FILE=/run/secrets/db_password",
    "-v", `${password}:/run/secrets/db_password:ro`,
    ...keys,
    "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    context.image,
  ]);
  const ask = () =>
    tryDocker(["exec", context.scratchApp, "node", "-e",
      "fetch('http://127.0.0.1:3000/healthz').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"]);
  let answer = ask();
  const answered = await until(() => (answer = ask()).code === 0, 90_000);
  if (!answered) {
    const logs = tryDocker(["logs", "--tail", "5", context.scratchApp]);
    throw new Error(`the app did not pass its health check against the restored copy: ${(logs.stdout + logs.stderr).trim().slice(-300)}`);
  }
  context.said = answer.stdout.trim();
  const body = JSON.parse(context.said);
  if (body.ok !== true) throw new Error(`the health check said: ${context.said}`);
  context.entries = typeof body.entries === "number" ? body.entries : null;
  const atBackup = context.backup?.manifest.prodCheck?.entries;
  return `${context.image} against the restored copy: ${context.said}` +
    `${context.entries !== null ? `\nguestbook entries in the restored copy: ${context.entries}${atBackup !== undefined && atBackup !== null ? ` (prod had ${atBackup} when the backup was taken)` : ""}` : ""}`;
}

export const humanBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} kB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
