/**
 * Signing in to the panel (D64), kept by the engine, in one file only the
 * service user can read (`/var/lib/allvibe/panel/auth.json`):
 *
 *   - a one-time setup code for the first visit, shown on the machine by
 *     install, kept only as a hash, working once and only while the panel is
 *     unclaimed;
 *   - the password the person then chooses, as an scrypt hash with its salt;
 *   - the count of wrong attempts in a row, and until when sign-in is paused:
 *     after 5, 30 seconds, doubling up to 15 minutes; a right one resets it.
 *
 * Nothing here returns a hash, a code or a password: only right or wrong.
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeAtomic } from "../lib/files.js";

/** No look-alike letters or digits: no I, O, 0 or 1. 32 symbols, 5 bits each. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 16;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;
export const FREE_ATTEMPTS = 5;
export const FIRST_PAUSE_S = 30;
export const LONGEST_PAUSE_S = 15 * 60;

interface Hashed {
  salt: string;
  hash: string;
}

export interface AuthFile {
  claimed: boolean;
  password: Hashed | null;
  setupCode: Hashed | null;
  failures: number;
  pausedUntil: string | null;
  claimedAt: string | null;
}

const EMPTY: AuthFile = { claimed: false, password: null, setupCode: null, failures: 0, pausedUntil: null, claimedAt: null };

function hash(secret: string, salt = randomBytes(16)): Hashed {
  const key = scryptSync(secret, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt: salt.toString("base64"), hash: key.toString("base64") };
}

function matches(secret: string, stored: Hashed): boolean {
  const key = scryptSync(secret, Buffer.from(stored.salt, "base64"), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const want = Buffer.from(stored.hash, "base64");
  return key.length === want.length && timingSafeEqual(key, want);
}

/** A setup code as a person may type it: any case, with or without dashes and spaces. */
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export const isCodeShape = (code: string) => new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(normaliseCode(code));

/** "ABCD-EFGH-JKLM-NPQR": how install shows it. */
export const showCode = (code: string) => code.match(/.{4}/g)!.join("-");

export class AuthStore {
  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {}

  read(): AuthFile {
    if (!existsSync(this.file)) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(readFileSync(this.file, "utf8")) as Partial<AuthFile>) };
  }

  private write(data: AuthFile): void {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`, 0o600);
  }

  /** Seconds until sign-in may be tried again; 0 when it may be tried now. */
  pausedFor(data = this.read()): number {
    if (!data.pausedUntil) return 0;
    return Math.max(0, Math.ceil((Date.parse(data.pausedUntil) - this.now().getTime()) / 1000));
  }

  status(): { claimed: boolean; hasCode: boolean; pausedFor: number } {
    const data = this.read();
    return { claimed: data.claimed, hasCode: data.setupCode !== null, pausedFor: this.pausedFor(data) };
  }

  /** A new one-time code, while nobody has claimed the panel; the old one stops working. */
  newSetupCode(): string {
    const data = this.read();
    if (data.claimed) throw new Error("the panel is already set up: its setup code was used. To start again: allvibe panel reset");
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    this.write({ ...data, setupCode: hash(code), failures: 0, pausedUntil: null });
    return code;
  }

  /** Back to unclaimed, with a new setup code: for a forgotten password, on the machine. */
  reset(): string {
    this.write({ ...EMPTY });
    return this.newSetupCode();
  }

  private wrong(data: AuthFile): void {
    const failures = data.failures + 1;
    const pause = failures < FREE_ATTEMPTS ? 0 : Math.min(FIRST_PAUSE_S * 2 ** (failures - FREE_ATTEMPTS), LONGEST_PAUSE_S);
    this.write({ ...data, failures, pausedUntil: pause ? new Date(this.now().getTime() + pause * 1000).toISOString() : null });
  }

  /** The first visit: the setup code and the chosen password. */
  claim(code: string, password: string): { ok: true } | { ok: false; reason: "claimed" | "paused" | "no-code" | "wrong" | "weak"; pausedFor?: number } {
    const data = this.read();
    if (data.claimed) return { ok: false, reason: "claimed" };
    const paused = this.pausedFor(data);
    if (paused) return { ok: false, reason: "paused", pausedFor: paused };
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { ok: false, reason: "weak" };
    if (!data.setupCode) return { ok: false, reason: "no-code" };
    if (!matches(normaliseCode(code), data.setupCode)) {
      this.wrong(data);
      return { ok: false, reason: "wrong", pausedFor: this.pausedFor() };
    }
    this.write({ ...data, claimed: true, password: hash(password), setupCode: null, failures: 0, pausedUntil: null, claimedAt: this.now().toISOString() });
    return { ok: true };
  }

  /** Signing in. */
  check(password: string): { ok: true } | { ok: false; reason: "unclaimed" | "paused" | "wrong"; pausedFor?: number } {
    const data = this.read();
    if (!data.claimed || !data.password) return { ok: false, reason: "unclaimed" };
    const paused = this.pausedFor(data);
    if (paused) return { ok: false, reason: "paused", pausedFor: paused };
    if (!matches(password, data.password)) {
      this.wrong(data);
      return { ok: false, reason: "wrong", pausedFor: this.pausedFor() };
    }
    if (data.failures || data.pausedUntil) this.write({ ...data, failures: 0, pausedUntil: null });
    return { ok: true };
  }
}
