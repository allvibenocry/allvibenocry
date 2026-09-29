/**
 * One lock per app, taken by the CLI and by the engine alike (D72; D66,
 * question 5): two operations that change the same app never run at once,
 * whichever of the two started them. Whoever comes second is refused before
 * anything changes, in plain words: "A release of hello is already running,
 * started from the panel 2 minutes ago."
 *
 * The lock is a file in the app's own folder, `operation.lock`, made whole
 * under a temporary name and linked into place, which fails when one is
 * already there, so two takers can never both have it (and none can find a
 * half-written one, mistake 8). It says what holds it: the operation, where
 * it was started (the panel, the command line, the nightly backup), the
 * process and when. A lock whose process has ended (a command stopped with
 * Ctrl-C, an engine restarted mid-job) is cleared by the next taker, and only
 * then: a process that still runs, even one the taker may not signal, holds
 * its lock.
 *
 * Within one process the lock is taken once: the engine takes it before it
 * starts a job, and the command the job runs, on a thread of its own, adopts
 * it (`adoptLock`), so a release's own rollback, run inside it, is not refused
 * either.
 */
import { existsSync, linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { posix as path } from "node:path";
import { projectDir } from "./project.js";

export type Origin = "the panel" | "the command line" | "the nightly backup";

let origin: Origin = "the command line";
/** Where this process's operations are started from: the engine says "the panel". */
export const setLockOrigin = (value: Origin) => {
  origin = value;
};

export interface LockHolder {
  operation: string;
  app: string;
  from: Origin;
  pid: number;
  /** The process's start time, in clock ticks since boot, when it could be read: a reused process id is not its holder. */
  since: string | null;
  started: string;
}

/** An operation, as the refusal names it. */
const WORDS: Record<string, (app: string) => string> = {
  release: (app) => `A release of ${app}`,
  rollback: (app) => `Going back to an earlier version of ${app}`,
  "dev-deploy": (app) => `A new start of ${app}'s test copy`,
  backup: (app) => `A backup of ${app}`,
  "restore-check": (app) => `A restore check of ${app}`,
  "key-set": (app) => `A change to ${app}'s service keys`,
  "project-remove": (app) => `Removing ${app}`,
};
export const OPERATIONS = Object.keys(WORDS);

const held = new Map<string, string>();

export const lockFile = (app: string) => path.join(projectDir(app).split("\\").join("/"), "operation.lock");

/** When a process started, from /proc, or null where that cannot be read. */
function startOf(pid: number): string | null {
  try {
    // The field after the command's name, which may itself hold spaces and brackets: the 22nd.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

/** Whether the process that took a lock still runs, as the same process. */
export function holderRuns(holder: Pick<LockHolder, "pid" | "since">): boolean {
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  const now = startOf(holder.pid);
  return !(holder.since && now && now !== holder.since);
}

/** "just now", "1 minute ago", "3 hours ago". */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/** The refusal, in plain words. */
export function refusal(holder: LockHolder, now = Date.now()): string {
  const what = (WORDS[holder.operation] ?? ((app: string) => `An operation on ${app}`))(holder.app);
  return `${what} is already running, started from ${holder.from} ${ago(holder.started, now)}. Wait for it to end, then try again.`;
}

export type Taken = { ok: true; release: () => void; cleared: LockHolder | null } | { ok: false; holder: LockHolder | null; message: string };

/** The app's lock, for this operation, or why not. `file` is for the tests. */
export function takeLock(app: string, operation: string, file = lockFile(app)): Taken {
  if (held.has(app)) return { ok: true, release: () => {}, cleared: null };
  const mine: LockHolder = { operation, app, from: origin, pid: process.pid, since: startOf(process.pid), started: new Date().toISOString() };
  const partial = `${file}.${process.pid}.partial`;
  let cleared: LockHolder | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    writeFileSync(partial, `${JSON.stringify(mine)}\n`, { mode: 0o640 });
    try {
      linkSync(partial, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder: LockHolder | null = null;
      try {
        holder = JSON.parse(readFileSync(file, "utf8")) as LockHolder;
      } catch {
        holder = null;
      }
      if (holder && !holderRuns(holder)) {
        rmSync(file, { force: true });
        cleared = holder;
        continue;
      }
      if (!holder && !existsSync(file)) continue;
      return {
        ok: false,
        holder,
        message: holder ? refusal(holder) : `Another operation on ${app} holds its lock (${file} cannot be read). If nothing is running, remove that file.`,
      };
    } finally {
      rmSync(partial, { force: true });
    }
    held.set(app, operation);
    const release = () => {
      if (held.get(app) !== operation) return;
      held.delete(app);
      try {
        const now = JSON.parse(readFileSync(file, "utf8")) as LockHolder;
        if (now.pid === mine.pid && now.started === mine.started) rmSync(file, { force: true });
      } catch {
        /* already gone */
      }
    };
    return { ok: true, release, cleared };
  }
  return { ok: false, holder: null, message: `The lock of ${app} could not be taken: try again.` };
}

/**
 * A lock this process already holds, taken on another of its threads: the
 * engine takes it before a job, and the job's command runs on a thread of its
 * own (D77), whose view of what is held starts empty. The file is untouched:
 * it already names this process, and the engine lets it go when the job ends.
 */
export function adoptLock(app: string, operation: string): void {
  held.set(app, operation);
}

/** Runs a command under the app's lock; refuses in plain words when another holds it. */
export async function withLock(app: string | undefined, operation: string, run: () => Promise<number> | number): Promise<number> {
  // No project by that name, or no name: the command itself says so.
  if (!app || !/^[a-z][a-z0-9-]{1,29}$/.test(app) || !existsSync(projectDir(app))) return run();
  const lock = takeLock(app, operation);
  if (!lock.ok) {
    process.stderr.write(`${lock.message}\n`);
    return 1;
  }
  if (lock.cleared) process.stderr.write(`(a lock left by a stopped ${lock.cleared.operation}, started from ${lock.cleared.from} ${ago(lock.cleared.started)}, was cleared)\n`);
  try {
    return await run();
  } finally {
    lock.release();
  }
}

/** Waits for the app's lock, up to `timeoutMs`, for the nightly backup: a release is minutes, not hours. */
export async function waitForLock(app: string, operation: string, timeoutMs: number, pollMs = 5000): Promise<Taken> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const lock = takeLock(app, operation);
    if (lock.ok || Date.now() >= until) return lock;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
