/**
 * The key vault (D37): the keys a project's apps and its agent need, such as
 * API keys for services outside the machine.
 *
 * - **At rest, encrypted.** Each value is its own file, encrypted with `age` to
 *   the same two recipients as every backup (D13): this machine's key, so the
 *   suite can hand it to apps, and the recovery key, so a machine restored from
 *   the recovery key gets its keys back. No new key exists to be lost.
 * - **Separate by scope.** `dev`, `prod` and `agent` (the project's coding
 *   agent, D39) each have their own values; a scope's keys go only to that
 *   scope's containers, so prod's keys are never in anything of dev's.
 * - **In use, in memory.** When an environment is deployed, its keys are
 *   decrypted into `/run/<command>/keys/`, a tmpfs, and each is mounted into its
 *   app as a file at `/run/secrets/<NAME>`, the way the database password is
 *   (D21); the app finds the path in `<NAME>_FILE`. The value is never an
 *   environment variable, an argument, or output. At boot, a unit decrypts them
 *   again before Docker starts the apps.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { posix as path } from "node:path";
import { NAMES } from "./brand.js";
import { readJson, writeAtomic } from "./files.js";
import { readRecipient } from "./keys.js";
import type { Env } from "./project.js";
import { run, tryRun } from "./run.js";

export type Scope = Env | "agent";
export const SCOPES: Scope[] = ["dev", "prod", "agent"];

export interface VaultEntry {
  scope: Scope;
  name: string;
  /** When its value was last set. */
  changed: string;
}

interface VaultIndex {
  format: 1;
  keys: VaultEntry[];
}

/** Values larger than this are not keys. */
const MAX_BYTES = 64 * 1024;

export const vaultDir = (project: string) => path.join(NAMES.projectsDir, project, "vault");
const indexFile = (project: string) => path.join(vaultDir(project), "index.json");
const valueFile = (project: string, scope: Scope, name: string) => path.join(vaultDir(project), scope, `${name}.age`);
export const runtimeDir = (project: string, scope: Scope) => path.join(NAMES.keysRunDir, project, scope);
export const runtimeFile = (project: string, scope: Scope, name: string) => path.join(runtimeDir(project, scope), name);
/** Where a key is inside a container. */
export const secretPath = (name: string) => `/run/secrets/${name}`;

/** Why a name cannot be a key's, or null when it can. */
export function keyNameProblem(name: string): string | null {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) return "a key's name is 2-64 capital letters, digits and underscores, starting with a letter, like WEATHER_API_KEY";
  if (/^(DATABASE_|ALLVIBE_)/.test(name)) return `names starting with ${name.split("_")[0]}_ are the suite's own`;
  if (name.endsWith("_FILE")) return "a key's name cannot end in _FILE: the app finds each key's file in <NAME>_FILE";
  return null;
}

export function scopeProblem(scope: string): string | null {
  return (SCOPES as string[]).includes(scope) ? null : `the scope is dev, prod or agent, not "${scope}"`;
}

export function listKeys(project: string): VaultEntry[] {
  return readJson<VaultIndex>(indexFile(project), { format: 1, keys: [] }).keys
    .slice()
    .sort((a, b) => SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope) || a.name.localeCompare(b.name));
}

export const keyNames = (project: string, scope: Scope) => listKeys(project).filter((k) => k.scope === scope).map((k) => k.name);

function saveIndex(project: string, keys: VaultEntry[]): void {
  writeAtomic(indexFile(project), `${JSON.stringify({ format: 1, keys } satisfies VaultIndex, null, 2)}\n`, 0o600);
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/**
 * A value as it arrives on standard input: one trailing newline dropped (what
 * `echo` and editors add), and refused if it is empty, too long, or not text.
 */
export function valueFromInput(input: Buffer): string {
  let text = input.toString("utf8");
  if (text.endsWith("\r\n")) text = text.slice(0, -2);
  else if (text.endsWith("\n")) text = text.slice(0, -1);
  if (text.length === 0) throw new Error("standard input was empty: nothing to store");
  if (input.length > MAX_BYTES) throw new Error(`that is ${input.length} bytes, more than a key's ${MAX_BYTES}`);
  if (text.includes("\0") || !Buffer.from(text, "utf8").equals(input.subarray(0, Buffer.byteLength(text)))) {
    throw new Error("that is not text: a key is text");
  }
  return text;
}

/** Encrypt and store one value. The value goes to `age` on standard input, never as an argument. */
export function storeKey(project: string, scope: Scope, name: string, value: string, now = new Date()): { replaced: boolean } {
  ensurePrivateDir(vaultDir(project));
  ensurePrivateDir(path.join(vaultDir(project), scope));
  const file = valueFile(project, scope, name);
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  run("age", ["--encrypt", "-r", readRecipient(NAMES.hostRecipient), "-r", readRecipient(NAMES.recoveryRecipient), "-o", partial], { input: value });
  chmodSync(partial, 0o600);
  renameSync(partial, file);
  const keys = listKeys(project).filter((k) => !(k.scope === scope && k.name === name));
  const replaced = keys.length !== listKeys(project).length;
  saveIndex(project, [...keys, { scope, name, changed: now.toISOString() }]);
  return { replaced };
}

/**
 * A new value stored, with the one it replaces kept aside until the caller
 * knows whether the app works with the new one: `keep()` forgets the old
 * value, `undo()` puts it back, or removes a key that is new.
 */
export function stageKey(project: string, scope: Scope, name: string, value: string): { replaced: boolean; keep(): void; undo(): void } {
  const file = valueFile(project, scope, name);
  const previous = `${file}.previous`;
  const before = listKeys(project).find((k) => k.scope === scope && k.name === name) ?? null;
  const had = before !== null && existsSync(file);
  if (had) renameSync(file, previous);
  const { replaced } = storeKey(project, scope, name, value);
  return {
    replaced,
    keep: () => rmSync(previous, { force: true }),
    undo: () => {
      if (had && before) {
        renameSync(previous, file);
        saveIndex(project, [...listKeys(project).filter((k) => !(k.scope === scope && k.name === name)), before]);
      } else {
        removeKey(project, scope, name);
      }
    },
  };
}

export function removeKey(project: string, scope: Scope, name: string): boolean {
  const keys = listKeys(project);
  const rest = keys.filter((k) => !(k.scope === scope && k.name === name));
  if (rest.length === keys.length) return false;
  rmSync(valueFile(project, scope, name), { force: true });
  saveIndex(project, rest);
  rmSync(runtimeFile(project, scope, name), { force: true });
  return true;
}

/** One value, decrypted with this machine's key, into memory. Never printed. */
export function readKey(project: string, scope: Scope, name: string): string {
  const decrypted = tryRun("age", ["--decrypt", "-i", NAMES.hostKey, valueFile(project, scope, name)]);
  if (decrypted.code !== 0) throw new Error(`the vault's ${scope} ${name} could not be decrypted with this machine's key: ${decrypted.stderr.trim().split("\n").at(-1) ?? ""}`);
  return decrypted.stdout;
}

/**
 * A scope's keys, decrypted into memory-only files for its containers to mount,
 * and nothing else left there. A file whose value has not changed is not
 * rewritten, so a running container keeps reading the same file.
 */
export function unlockScope(project: string, scope: Scope): string[] {
  const names = keyNames(project, scope);
  const dir = runtimeDir(project, scope);
  if (names.length === 0 && !existsSync(dir)) return [];
  if (!existsSync(NAMES.runDir)) throw new Error(`${NAMES.runDir} does not exist: install.sh creates it, and it is recreated at every boot`);
  ensurePrivateDir(path.join(NAMES.keysRunDir));
  ensurePrivateDir(path.dirname(dir));
  ensurePrivateDir(dir);
  for (const name of names) {
    const value = readKey(project, scope, name);
    const file = runtimeFile(project, scope, name);
    const same = existsSync(file) && readFileSync(file, "utf8") === value;
    // Readable by the app's own user inside its container; the directories
    // above are the service user's alone, so nothing else on the host reaches it (D21).
    if (!same) writeAtomic(file, value, 0o644);
  }
  for (const stale of readdirSync(dir).filter((f) => !names.includes(f))) rmSync(path.join(dir, stale), { force: true });
  return names;
}

/** Every project's keys, every scope: what the boot unit runs before Docker starts the apps. */
export function unlockAll(projects: string[]): Array<{ project: string; scope: Scope; names: string[] }> {
  const done: Array<{ project: string; scope: Scope; names: string[] }> = [];
  for (const project of projects) {
    for (const scope of SCOPES) {
      const names = unlockScope(project, scope);
      if (names.length) done.push({ project, scope, names });
    }
  }
  return done;
}

/** Forget a project's decrypted keys (when the project is removed). */
export function lockProject(project: string): void {
  rmSync(path.join(NAMES.keysRunDir, project), { recursive: true, force: true });
}
