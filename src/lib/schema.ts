/**
 * The schema a version of the code knows, the schema a database has, and what
 * that means for a release and for a rollback (D35).
 *
 * - What a commit knows: the files in its `migrations/`, read from git.
 * - What a database has: the file names in its `schema_migrations` table,
 *   read from the database itself, never from a record of what should be there.
 */
import { NAMES } from "./brand.js";
import { tryDocker } from "./docker.js";
import { breakingReason, classifyMigration, isMigrationFile, type MigrationVerdict } from "./migrations.js";
import { containerName, repoDir, type Env, type Project, type Release } from "./project.js";
import { tryRun } from "./run.js";

const C = NAMES.command;
const DIR = "migrations";

/** The migrations in one commit: file name to git blob id. */
export function migrationsAt(project: Project, commit: string): Map<string, string> {
  const listed = tryRun("git", ["-C", repoDir(project.name), "ls-tree", commit, `${DIR}/`]);
  const files = new Map<string, string>();
  if (listed.code !== 0) return files;
  for (const line of listed.stdout.split("\n").filter(Boolean)) {
    const [meta, file] = line.split("\t");
    const [, type, blob] = meta.split(" ");
    const name = file.slice(DIR.length + 1);
    if (type === "blob" && isMigrationFile(name)) files.set(name, blob);
  }
  return files;
}

export function migrationText(project: Project, commit: string, file: string): string | null {
  const shown = tryRun("git", ["-C", repoDir(project.name), "show", `${commit}:${DIR}/${file}`]);
  return shown.code === 0 ? shown.stdout : null;
}

/**
 * The migrations a database has applied, in order, asked of the database. An
 * empty list when it has no `schema_migrations` table yet.
 */
export function appliedMigrations(project: Project, env: Env): string[] {
  const db = containerName(project.name, env, "db");
  const sql = "select case when to_regclass('public.schema_migrations') is null then '' else (select coalesce(string_agg(version, E'\\n' order by version), '') from schema_migrations) end";
  const asked = tryDocker(["exec", db, "psql", "-U", "app", "-d", "app", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  if (asked.code !== 0) throw new Error(`could not ask ${env}'s database which migrations it has: ${asked.stderr.trim().split("\n").at(-1) ?? ""}`);
  return asked.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** What a release records about the schema it ran with. */
export function schemaOf(applied: string[]): Release["schema"] {
  return { version: applied.at(-1) ?? null, migrations: applied };
}

/* ---------------------------------------------------------------- release -- */

export interface ReleaseMigrations {
  /** New migrations in this release, each with its verdict. */
  added: Array<{ file: string; verdict: MigrationVerdict }>;
  /** Why the release must not go ahead, if anything. */
  problems: string[];
}

/**
 * The migrations a release brings, against the version prod runs: none of
 * the old ones changed or removed (a migration that has run is never edited),
 * and every new one additive or marked breaking.
 */
export function releaseMigrations(project: Project, fromCommit: string | null, commit: string): ReleaseMigrations {
  const before = fromCommit ? migrationsAt(project, fromCommit) : new Map<string, string>();
  const after = migrationsAt(project, commit);
  const problems: string[] = [];
  for (const [file, blob] of before) {
    if (!after.has(file)) problems.push(`${DIR}/${file} has been removed. A migration that has run in prod stays: to undo it, add a new one.`);
    else if (after.get(file) !== blob) problems.push(`${DIR}/${file} has been changed since it was released. A migration that has run is never edited: put the change in a new one.`);
  }
  const added: ReleaseMigrations["added"] = [];
  for (const file of [...after.keys()].filter((f) => !before.has(f)).sort()) {
    const verdict = classifyMigration(migrationText(project, commit, file) ?? "");
    added.push({ file, verdict });
    if (verdict.kind === "breaking" && !verdict.mark) {
      problems.push(
        `${DIR}/${file} is a breaking change: ${breakingReason(verdict)}.\n` +
          `The version before it could not run on the database after it, so going back would mean losing data.\n` +
          `If that is agreed, say so in the file, on a line of its own: -- breaking: <what it changes>`,
      );
    }
  }
  return { added, problems };
}

/* --------------------------------------------------------------- rollback -- */

export interface RollbackSchema {
  /** Migrations the database has that the version being gone back to does not know. */
  unknown: Array<{ file: string; kind: "additive" | "breaking"; why: string; releasedIn: string | null }>;
}

/**
 * The migrations prod's database has that `to` was never written for, and
 * whether each only added. A migration whose file cannot be found in any
 * release counts as breaking: what cannot be read cannot be trusted.
 */
export function rollbackSchema(project: Project, to: Release, alsoIn: Array<{ version: string; commit: string }> = []): RollbackSchema {
  const applied = appliedMigrations(project, "prod");
  const known = migrationsAt(project, to.commit);
  const unknown: RollbackSchema["unknown"] = [];
  // The release that first brought each migration. A release that failed is in
  // no list of releases, but its migration may have run, so it is looked at too.
  const oldestFirst = [...project.releases, ...alsoIn];
  for (const file of applied.filter((f) => !known.has(f))) {
    const release = oldestFirst.find((r) => migrationsAt(project, r.commit).has(file)) ?? null;
    const text = release ? migrationText(project, release.commit, file) : null;
    if (text === null) {
      unknown.push({ file, kind: "breaking", why: "its file is in no released version, so what it did cannot be read", releasedIn: null });
      continue;
    }
    const verdict = classifyMigration(text);
    unknown.push({
      file,
      kind: verdict.kind,
      why: verdict.kind === "breaking" ? (verdict.mark ? `it is marked breaking: ${verdict.mark}` : breakingReason(verdict)) : "",
      releasedIn: release?.version ?? null,
    });
  }
  return { unknown };
}

export const describeUnknown = (u: RollbackSchema["unknown"][number]) =>
  `${DIR}/${u.file}${u.releasedIn ? ` (from ${u.releasedIn})` : ""}${u.kind === "breaking" ? `: ${u.why}` : ": only adds"}`;

/** The command that puts the data back as well. */
export const restoreDataCommand = (project: Project) => `${C} rollback ${project.name} --restore-data`;
