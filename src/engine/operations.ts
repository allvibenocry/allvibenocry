/**
 * The engine's allow-list (D62): every operation the panel may ask for, with
 * its arguments checked before anything runs. Nothing else can be asked: an
 * operation that is not in this table is `unknown_operation`. None of them
 * runs a shell or a free-form command, and none returns a secret value.
 *
 * The operations call the suite through `Suite`, which the engine wires to the
 * CLI's own code (suite.ts) and the tests to stand-ins.
 */
import { AuthStore, isCodeShape, PASSWORD_MAX } from "./auth.js";
import type { Job, Jobs } from "./jobs.js";

export type ErrorCode = "unknown_operation" | "bad_arguments" | "not_found" | "busy" | "refused" | "failed";

export class EngineError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

export type LongKind = "putLive" | "goBack" | "startTestCopy";

/** What the operations need from the suite. */
export interface Suite {
  exists(app: string): boolean;
  apps(): unknown[];
  app(app: string): unknown;
  plan(app: string): unknown;
  markTried(app: string, step: number): { ok: boolean; message?: string; [key: string]: unknown };
  backups(app: string): unknown[];
  report(app: string, text: string): { file: string };
  machineStatus(): unknown;
  lastNight(): unknown;
  /** Runs the CLI's command for a long operation, printing as it does; its exit code. */
  run(kind: LongKind, app: string): Promise<number>;
}

export interface Context {
  suite: Suite;
  jobs: Jobs;
  auth: AuthStore;
}

type Args = Record<string, unknown>;

/* ------------------------------------------------------------ arguments -- */

const APP = /^[a-z][a-z0-9-]{1,29}$/;
const JOB = /^[0-9a-f]{16}$/;

function only(args: Args, allowed: string[]): void {
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) throw new EngineError("bad_arguments", `not an argument of this operation: ${extra.join(", ")}`);
}

function app(args: Args, ctx: Context): string {
  const name = args.app;
  if (typeof name !== "string" || !APP.test(name)) throw new EngineError("bad_arguments", "app: a project's name, 2 to 30 lowercase letters, digits and dashes, starting with a letter");
  if (!ctx.suite.exists(name)) throw new EngineError("not_found", `there is no project called ${name}`);
  return name;
}

function step(args: Args): number {
  const n = args.step;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 50) throw new EngineError("bad_arguments", "step: a whole number from 1 to 50");
  return n;
}

function text(args: Args): string {
  const t = args.text;
  if (typeof t !== "string" || t.trim().length === 0 || t.length > 4000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)) {
    throw new EngineError("bad_arguments", "text: 1 to 4,000 characters, with no control characters but line breaks and tabs");
  }
  return t;
}

function password(args: Args, key = "password"): string {
  const p = args[key];
  if (typeof p !== "string" || p.length === 0 || p.length > PASSWORD_MAX) throw new EngineError("bad_arguments", `${key}: 1 to ${PASSWORD_MAX} characters`);
  return p;
}

function setupCode(args: Args): string {
  const c = args.setupCode;
  if (typeof c !== "string" || c.length > 40 || !isCodeShape(c)) throw new EngineError("bad_arguments", "setupCode: the code the machine showed, 16 letters and digits in four groups");
  return c;
}

/* ----------------------------------------------------------- operations -- */

export type Kind = "read" | "change" | "long" | "panel";

export interface Operation {
  kind: Kind;
  args: string[];
  run(args: Args, ctx: Context): unknown;
}

const long = (kind: LongKind, operation: string) => (args: Args, ctx: Context): { job: string } => {
  only(args, ["app"]);
  const name = app(args, ctx);
  const job = ctx.jobs.start(operation, name, () => ctx.suite.run(kind, name));
  if (!job) {
    const busy = ctx.jobs.busy as Job;
    throw new EngineError("busy", `another operation is running: ${busy.operation} for ${busy.app}, since ${busy.startedAt.slice(11, 19)} UTC. Wait for it to end.`, { job: busy.id });
  }
  return { job: job.id };
};

export const OPERATIONS: Record<string, Operation> = {
  "machine.status": { kind: "read", args: [], run: (a, ctx) => (only(a, []), ctx.suite.machineStatus()) },
  "machine.lastNight": { kind: "read", args: [], run: (a, ctx) => (only(a, []), ctx.suite.lastNight()) },
  "apps.list": { kind: "read", args: [], run: (a, ctx) => (only(a, []), ctx.suite.apps()) },
  "app.get": { kind: "read", args: ["app"], run: (a, ctx) => (only(a, ["app"]), ctx.suite.app(app(a, ctx))) },
  "app.plan": { kind: "read", args: ["app"], run: (a, ctx) => (only(a, ["app"]), ctx.suite.plan(app(a, ctx))) },
  "app.backups": { kind: "read", args: ["app"], run: (a, ctx) => (only(a, ["app"]), ctx.suite.backups(app(a, ctx))) },
  "app.markTried": {
    kind: "change",
    args: ["app", "step"],
    run: (a, ctx) => {
      only(a, ["app", "step"]);
      const name = app(a, ctx);
      const result = ctx.suite.markTried(name, step(a));
      if (!result.ok) throw new EngineError("refused", String(result.message), { reason: result.code });
      return result;
    },
  },
  "app.report": {
    kind: "change",
    args: ["app", "text"],
    run: (a, ctx) => {
      only(a, ["app", "text"]);
      const name = app(a, ctx);
      return ctx.suite.report(name, text(a));
    },
  },
  "app.startTestCopy": { kind: "long", args: ["app"], run: long("startTestCopy", "app.startTestCopy") },
  "app.putLive": { kind: "long", args: ["app"], run: long("putLive", "app.putLive") },
  "app.goBack": { kind: "long", args: ["app"], run: long("goBack", "app.goBack") },
  "job.get": {
    kind: "read",
    args: ["job"],
    run: (a, ctx) => {
      only(a, ["job"]);
      if (typeof a.job !== "string" || !JOB.test(a.job)) throw new EngineError("bad_arguments", "job: a job's id, 16 hexadecimal digits");
      const job = ctx.jobs.get(a.job);
      if (!job) throw new EngineError("not_found", "no such job: it may have ended long ago, or the engine restarted since");
      return job;
    },
  },
  "auth.status": { kind: "panel", args: [], run: (a, ctx) => (only(a, []), ctx.auth.status()) },
  "auth.claim": {
    kind: "panel",
    args: ["setupCode", "password"],
    run: (a, ctx) => {
      only(a, ["setupCode", "password"]);
      const result = ctx.auth.claim(setupCode(a), password(a));
      if (!result.ok) {
        const words = {
          claimed: "this control panel is already set up. Sign in with its password.",
          paused: `too many wrong tries: wait ${result.pausedFor} seconds, then try again.`,
          "no-code": "there is no setup code. On the machine, make one: allvibe panel setup-code",
          wrong: "that is not the setup code the machine showed.",
          weak: "the password needs 12 characters or more.",
        }[result.reason];
        throw new EngineError("refused", words, { reason: result.reason, pausedFor: result.pausedFor ?? 0 });
      }
      return { claimed: true };
    },
  },
  "auth.check": {
    kind: "panel",
    args: ["password"],
    run: (a, ctx) => {
      only(a, ["password"]);
      const result = ctx.auth.check(password(a));
      if (!result.ok) {
        const words = {
          unclaimed: "this control panel is not set up yet.",
          paused: `too many wrong tries: wait ${result.pausedFor} seconds, then try again.`,
          wrong: "that is not the password.",
        }[result.reason];
        throw new EngineError("refused", words, { reason: result.reason, pausedFor: result.pausedFor ?? 0 });
      }
      return { signedIn: true };
    },
  },
};

export type Answer = { ok: true; result: unknown } | { ok: false; error: { code: ErrorCode; message: string } & Record<string, unknown> };

/** One request, from its operation's name and its arguments, to its answer. */
export async function perform(name: string, args: unknown, ctx: Context): Promise<Answer> {
  const operation = Object.hasOwn(OPERATIONS, name) ? OPERATIONS[name] : undefined;
  if (!operation) return { ok: false, error: { code: "unknown_operation", message: `the engine has no operation called ${name.slice(0, 60)}` } };
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: { code: "bad_arguments", message: "the arguments are a JSON object" } };
  }
  try {
    return { ok: true, result: await operation.run(args as Args, ctx) };
  } catch (error) {
    if (error instanceof EngineError) return { ok: false, error: { code: error.code, message: error.message, ...error.details } };
    return { ok: false, error: { code: "failed", message: error instanceof Error ? error.message : String(error) } };
  }
}
