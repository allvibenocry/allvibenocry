/**
 * The engine's allow-list (D62): every operation the panel may ask for, with
 * its arguments checked before anything runs. Nothing else can be asked: an
 * operation that is not in this table is `unknown_operation`. None of them
 * runs a shell or a free-form command, and none returns a secret value.
 *
 * The operations call the suite through `Suite`, which the engine wires to the
 * CLI's own code (suite.ts) and the tests to stand-ins.
 */
import { refusal } from "../lib/lock.js";
import { AuthStore, isCodeShape, PASSWORD_MAX } from "./auth.js";
import type { Feed, Job, Jobs } from "./jobs.js";
import type { StreamStart } from "./server.js";
import { validSize, type Terminals } from "./terminal.js";

export type ErrorCode = "unknown_operation" | "bad_arguments" | "not_found" | "busy" | "refused" | "failed";

export class EngineError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

export type LongKind = "putLive" | "goBack" | "startTestCopy" | "agentStart" | "agentStop" | "createApp";
export type SignIn = "key" | "account";

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
  /**
   * Runs the CLI's command for a long operation, feeding back what it prints;
   * its exit code. `lock`: the app's lock, which the engine already holds for it.
   */
  run(kind: LongKind, app: string, options: { signIn?: SignIn; lock?: string }, feed: Feed): Promise<number>;
  /** The app's lock for a long operation, shared with the CLI (D72), or why not, in plain words. */
  lock(app: string, kind: LongKind): { ok: true; release: () => void } | { ok: false; message: string };
  /** The agent of an app (D76): whether it runs, how it signs in, whether the vault has its key. */
  agentStatus(app: string): { running: boolean; signIn: SignIn | null; hasKey: boolean };
  /** Why a new app may not have this name, in the CLI's words, or null. */
  nameProblem(name: string): string | null;
}

/** The long operations the app's lock covers, as the lock names them (src/lib/lock.ts). */
export const LOCK_OPERATION: Partial<Record<LongKind, string>> = { putLive: "release", goBack: "rollback", startTestCopy: "dev-deploy" };

export interface Context {
  suite: Suite;
  jobs: Jobs;
  auth: AuthStore;
  /** The agents' terminals (D76), for their state. */
  terminals?: { status(app: string): { open: boolean; attached: boolean } };
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

const KIND_OF: Record<string, LongKind> = { "app.putLive": "putLive", "app.goBack": "goBack", "app.startTestCopy": "startTestCopy" };
/** How the other long operations are said, when one of them is the job that runs. */
const SAID: Record<string, (app: string) => string> = {
  "agent.start": (app) => `Starting the AI of ${app}`,
  "agent.stop": (app) => `Stopping the AI of ${app}`,
  "app.create": (app) => `Making the app ${app}`,
};

/** The engine runs one long operation at a time: the one that runs, in the lock's words. */
function busyError(busy: Job): EngineError {
  const kind = KIND_OF[busy.operation];
  const said = SAID[busy.operation];
  const message = said
    ? `${said(busy.app)} is already running, started from the panel. Wait for it to end, then try again.`
    : refusal({ operation: (kind && LOCK_OPERATION[kind]) || busy.operation, app: busy.app, from: "the panel", pid: 0, since: null, started: busy.startedAt });
  return new EngineError("busy", message, { job: busy.id });
}

/**
 * A long operation, as a job: only when no other job runs, and, for those
 * that change an app, only with the app's lock, which the CLI takes too
 * (D72), held until the job ends.
 */
function startJob(ctx: Context, kind: LongKind, operation: string, name: string, options: { signIn?: SignIn } = {}): { job: string } {
  if (ctx.jobs.busy) throw busyError(ctx.jobs.busy);
  const lock = LOCK_OPERATION[kind] ? ctx.suite.lock(name, kind) : { ok: true as const, release: () => {} };
  if (!lock.ok) throw new EngineError("busy", lock.message);
  const job = ctx.jobs.start(operation, name, (feed) => Promise.resolve().then(() => ctx.suite.run(kind, name, { ...options, lock: LOCK_OPERATION[kind] }, feed)).finally(() => lock.release()));
  if (!job) {
    lock.release();
    const running = (ctx.jobs as { busy: Job | null }).busy;
    throw running ? busyError(running) : new EngineError("busy", "another operation started meanwhile: try again");
  }
  return { job: job.id };
}

const long = (kind: LongKind, operation: string) => (args: Args, ctx: Context): { job: string } => {
  only(args, ["app"]);
  return startJob(ctx, kind, operation, app(args, ctx));
};

/** A change the person confirmed in the panel (D66, question 8): the panel says so, or nothing runs. */
function confirmed(args: Args): void {
  if (args.confirm !== true) throw new EngineError("bad_arguments", "confirm: true, once the person has confirmed it");
}

function signIn(args: Args): SignIn {
  if (args.signIn !== "key" && args.signIn !== "account") throw new EngineError("bad_arguments", 'signIn: "key" (the key in the vault) or "account" (the person\'s own Claude account)');
  return args.signIn;
}

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
  // A new app, from the panel (D76): `allvibe project create`, confirmed.
  "app.create": {
    kind: "long",
    args: ["app", "confirm"],
    run: (a, ctx) => {
      only(a, ["app", "confirm"]);
      const name = a.app;
      if (typeof name !== "string" || !APP.test(name)) throw new EngineError("bad_arguments", "app: a name of 2 to 30 lowercase letters, digits and dashes, starting with a letter");
      const problem = ctx.suite.nameProblem(name);
      if (problem) throw new EngineError("refused", problem);
      if (ctx.suite.exists(name)) throw new EngineError("refused", `there is already an app called ${name}`);
      confirmed(a);
      return startJob(ctx, "createApp", "app.create", name);
    },
  },
  // The agent (D76): its state, starting it in either way of signing in, and
  // stopping it, each confirmed. Its terminal is a stream (engine/terminal.ts).
  "agent.status": {
    kind: "read",
    args: ["app"],
    run: (a, ctx) => {
      only(a, ["app"]);
      const name = app(a, ctx);
      return { ...ctx.suite.agentStatus(name), terminal: ctx.terminals?.status(name) ?? { open: false, attached: false } };
    },
  },
  "agent.start": {
    kind: "long",
    args: ["app", "signIn", "confirm"],
    run: (a, ctx) => {
      only(a, ["app", "signIn", "confirm"]);
      const name = app(a, ctx);
      const how = signIn(a);
      confirmed(a);
      return startJob(ctx, "agentStart", "agent.start", name, { signIn: how });
    },
  },
  "agent.stop": {
    kind: "long",
    args: ["app", "confirm"],
    run: (a, ctx) => {
      only(a, ["app", "confirm"]);
      const name = app(a, ctx);
      confirmed(a);
      return startJob(ctx, "agentStop", "agent.stop", name);
    },
  },
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

/** The operations that are streams (D76): the agent's terminal. */
export const STREAMS = ["agent.terminal"] as const;

/**
 * `agent.terminal {app, cols, rows, start}`: a browser, through the panel,
 * attached to the agent's Claude Code, which is started only when `start`
 * says the person asked for it (D48). Its lines, both ways, are the terminal's
 * (engine/terminal.ts).
 */
export function terminalStream(ctx: Context, terminals: Pick<Terminals, "attach">): StreamStart {
  return async (args, peer) => {
    try {
      if (args === null || typeof args !== "object" || Array.isArray(args)) throw new EngineError("bad_arguments", "the arguments are a JSON object");
      const a = args as Args;
      only(a, ["app", "cols", "rows", "start"]);
      const name = app(a, ctx);
      if (!validSize(a.cols, a.rows)) throw new EngineError("bad_arguments", "cols and rows: the terminal's size, 20 to 500 columns and 5 to 300 rows");
      if (a.start !== undefined && typeof a.start !== "boolean") throw new EngineError("bad_arguments", "start: true when the person asked for Claude Code to be opened");
      const attached = await terminals.attach(name, peer, a.cols as number, a.rows as number, a.start === true);
      if (!attached.ok) return { ok: false, answer: { ok: false, error: { code: attached.code, message: attached.message } } };
      return { ok: true, handle: attached.handle, result: attached.result };
    } catch (error) {
      if (error instanceof EngineError) return { ok: false, answer: { ok: false, error: { code: error.code, message: error.message, ...error.details } } };
      throw error;
    }
  };
}

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
