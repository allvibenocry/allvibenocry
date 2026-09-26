/**
 * The two backup keys (D13).
 *
 * - The **host key** stays on the machine and is what the daily restore test
 *   decrypts with.
 * - The **recovery key**'s public half stays on the machine, so every backup is
 *   also encrypted to it. Its private half is written once to a file only the
 *   service user can read, **never printed**, until the owner has copied it off
 *   the machine and confirmed it; then that file is deleted.
 *
 * Keys are made by `age-keygen`, which creates its output file with mode 0600.
 * Nothing here ever puts a private key on a command line or in output.
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { NAMES } from "./brand.js";
import { ensureFile, readJson, writeAtomic } from "./files.js";
import { run, tryRun } from "./run.js";

/** How often the owner is asked to show the recovery key again. */
export const RECONFIRM_DAYS = 180;

export const readRecipient = (file: string) => readFileSync(file, "utf8").trim();

/** The public key of an identity file, or of identity text given on stdin. */
function publicOf(source: { file: string } | { text: string }): string {
  const result =
    "file" in source ? tryRun("age-keygen", ["-y", source.file]) : tryRun("age-keygen", ["-y"], { input: source.text });
  if (result.code !== 0) throw new Error("that is not an age identity (age-keygen -y could not read it)");
  return result.stdout.trim();
}

export function ensureHostKey(): boolean {
  if (existsSync(NAMES.hostKey) && existsSync(NAMES.hostRecipient)) return false;
  if (!existsSync(NAMES.hostKey)) run("age-keygen", ["-o", NAMES.hostKey]);
  ensureFile(NAMES.hostRecipient, `${publicOf({ file: NAMES.hostKey })}\n`);
  return true;
}

/** Created once. If its public half exists, the key exists (and may be confirmed). */
export function ensureRecoveryKey(): boolean {
  if (existsSync(NAMES.recoveryRecipient)) return false;
  if (!existsSync(NAMES.recoveryPending)) run("age-keygen", ["-o", NAMES.recoveryPending]);
  ensureFile(NAMES.recoveryRecipient, `${publicOf({ file: NAMES.recoveryPending })}\n`);
  return true;
}

export type RecoveryState = "missing" | "pending" | "confirmed" | "overdue";

export interface RecoveryStatus {
  state: RecoveryState;
  confirmedAt: string | null;
  pendingOnMachine: boolean;
}

export function recoveryStatus(now = new Date()): RecoveryStatus {
  const pendingOnMachine = existsSync(NAMES.recoveryPending);
  if (!existsSync(NAMES.recoveryRecipient)) return { state: "missing", confirmedAt: null, pendingOnMachine };
  const confirmed = readJson<{ confirmedAt?: string } | null>(NAMES.recoveryConfirmed, null);
  if (!confirmed?.confirmedAt) return { state: "pending", confirmedAt: null, pendingOnMachine };
  const age = (now.getTime() - new Date(confirmed.confirmedAt).getTime()) / 86_400_000;
  return { state: age > RECONFIRM_DAYS ? "overdue" : "confirmed", confirmedAt: confirmed.confirmedAt, pendingOnMachine };
}

/**
 * The owner hands back their copy (on stdin). If it matches the stored public
 * half, the confirmation is recorded and the on-machine copy is deleted.
 */
export function confirmRecovery(identityText: string, now = new Date()): { removedPending: boolean } {
  const expected = readRecipient(NAMES.recoveryRecipient);
  const given = publicOf({ text: identityText });
  if (given !== expected) throw new Error("that is not this machine's recovery key: its public half does not match");
  writeAtomic(NAMES.recoveryConfirmed, `${JSON.stringify({ confirmedAt: now.toISOString() }, null, 2)}\n`, 0o640);
  const removedPending = existsSync(NAMES.recoveryPending);
  if (removedPending) rmSync(NAMES.recoveryPending);
  return { removedPending };
}

export function hostKeyOk(): boolean {
  try {
    return statSync(NAMES.hostKey).isFile() && publicOf({ file: NAMES.hostKey }) === readRecipient(NAMES.hostRecipient);
  } catch {
    return false;
  }
}
