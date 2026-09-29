/**
 * `allvibe agent start|shell|stop <project>` (D39, D46).
 *
 *   agent start <project>                      the agent container, with its key from the vault
 *   agent start <project> --sign-in account    the agent container, for you to sign in to your own Claude account in it
 *   agent shell <project>                      Claude Code's own interactive session in it
 *   agent shell <project> -- <cmd...>          a command in it instead, for example claude --version
 *   agent stop <project>                       the agent, its egress gate and its activity logger, gone, and with them any login; its transcripts and activity log are kept
 *   agent activity <project> [--lines N]       what the agent did: one line per tool call (D60)
 *   agent transcripts <project> [--delete]     its kept conversations; --delete deletes them (D60)
 *
 * With an account, the suite never runs Claude Code itself: not to check it,
 * and never with -p. Every session is one the person opens and drives (D48).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { posix as path } from "node:path";
import { NAMES } from "../lib/brand.js";
import { containerState, tryDocker } from "../lib/docker.js";
import {
  AGENT_KEY,
  agentContainer,
  agentState,
  activityLog,
  ALLOWED_HOSTS,
  CLAUDE_CODE_VERSION,
  ensureAgentImage,
  ensureActivity,
  ensureEgress,
  hasAgentKey,
  SIGN_INS,
  signInOf,
  startAgent,
  stopAgent,
  transcriptsDir,
  type SignIn,
} from "../lib/agent.js";
import { ensureHook } from "../lib/keycheck.js";
import { containerName, networkName, readProject } from "../lib/project.js";
import { fail, ok, runSteps } from "../lib/steps.js";

const C = NAMES.command;
const USAGE = `usage: ${C} agent start <project> [--sign-in key|account] | shell <project> [-- <command>] | stop <project> | activity <project> [--lines N] | transcripts <project> [--delete]`;
/** Where the pinned Claude Code's own package.json is in the image. */
const CLAUDE_CODE_PACKAGE = "/opt/claude-code/node_modules/@anthropic-ai/claude-code/package.json";

async function start(name: string, signIn: SignIn): Promise<number> {
  readProject(name);
  let image = "";
  const record = await runSteps(
    [
      {
        name: "dev is running, for the agent to work in",
        run: () => {
          const app = containerState(containerName(name, "dev", "app"));
          const db = containerState(containerName(name, "dev", "db"));
          const network = tryDocker(["network", "inspect", networkName(name, "dev", "internal")]).code === 0;
          if (app.status !== "running" || db.status !== "running" || !network) {
            return fail(`dev is not running (app ${app.status}, database ${db.status})`, `${C} dev deploy ${name}`);
          }
          return ok(`${containerName(name, "dev", "app")} and ${containerName(name, "dev", "db")}, on ${networkName(name, "dev", "internal")}`);
        },
      },
      signIn === "account"
        ? {
            name: "it signs in with your own Claude account",
            run: () =>
              ok(
                "no API key, and nothing from the key vault: you sign in yourself, through Claude Code's own sign-in, in its shell.\n" +
                  "the login stays in the agent's memory only, and is gone when the agent stops (D46)",
              ),
          }
        : {
            name: "the agent's AI key is in the vault",
            run: () =>
              hasAgentKey(name)
                ? ok(`agent ${AGENT_KEY}: the agent gets it as a file, and nothing else does`)
                : fail(`${name} has no agent ${AGENT_KEY} in its key vault`, `put your Anthropic API key there, from a file: ${C} key set ${name} agent ${AGENT_KEY} < the-file`),
          },
      {
        name: `the agent's image: Claude Code ${CLAUDE_CODE_VERSION}, unmodified`,
        run: () => {
          const { tag, built } = ensureAgentImage();
          image = tag;
          return ok(built ? `${tag} built on this machine, from the versions its lock file pins` : `${tag} is on this machine`);
        },
      },
      {
        name: "the key check in its working copy",
        run: () => ok(ensureHook(name) ? "the pre-commit hook put back (D38)" : "the pre-commit hook is in place (D38): the agent's commits are checked too"),
      },
      { name: `its only way out: ${ALLOWED_HOSTS[signIn].join(", ")}, over HTTPS`, run: () => ok(ensureEgress(name, signIn)) },
      {
        name: "its activity log, and a place to keep its conversations",
        run: () => ok(`${ensureActivity(name)}\nits conversations are kept in ${transcriptsDir(name)}; its login is not`),
      },
      {
        name: "the agent container",
        run: () => {
          startAgent(name, image, signIn);
          const state = containerState(agentContainer(name));
          return state.status === "running"
            ? ok(`${agentContainer(name)} running: dev's network only, the working copy only, not root, no capabilities`)
            : fail(`${agentContainer(name)} is ${state.status}`, `docker logs ${agentContainer(name)} says why`);
        },
      },
      signIn === "account"
        ? {
            // Its version, read from its own package; Claude Code itself is not run (D48).
            name: "Claude Code is in it",
            run: () => {
              const version = tryDocker(["exec", agentContainer(name), "node", "-p", `require(${JSON.stringify(CLAUDE_CODE_PACKAGE)}).version`]);
              const found = version.stdout.trim();
              return version.code === 0 && found === CLAUDE_CODE_VERSION
                ? ok(`Claude Code ${found}, as published\nopen it and sign in: ${C} agent shell ${name}`)
                : fail(`Claude Code in the agent is ${found || "not readable"}, not ${CLAUDE_CODE_VERSION}`);
            },
          }
        : {
            name: "Claude Code answers in it",
            run: () => {
              const version = tryDocker(["exec", agentContainer(name), "claude", "--version"]);
              return version.code === 0
                ? ok(`claude --version: ${version.stdout.trim()}\nopen it: ${C} agent shell ${name}`)
                : fail(`claude --version failed: ${(version.stderr || version.stdout).trim().split("\n").at(-1)}`);
            },
          },
    ],
    { kind: "agent-start", project: name },
  );
  return record.ok ? 0 : 1;
}

/** Whether a command given to `agent shell` runs Claude Code without a person at it: -p, --print, or no terminal. */
export function unattendedClaude(command: string[], tty: boolean): boolean {
  const runsClaude = command.length === 0 || /(^|\/)claude$/.test(command[0] ?? "");
  if (!runsClaude) return false;
  return !tty || command.slice(1).some((a) => a === "-p" || a === "--print" || a.startsWith("--print="));
}

/**
 * Claude Code's own session, or a command, in the running agent, with this
 * terminal. Nothing typed here passes through the suite: the terminal is
 * handed to docker exec as it is, and nothing is written down (D46).
 */
function shell(name: string, command: string[]): number {
  readProject(name);
  if (agentState(name).status !== "running") {
    process.stderr.write(`The agent of ${name} is not running. Start it: ${C} agent start ${name}\n`);
    return 1;
  }
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (signInOf(agentContainer(name)) === "account" && unattendedClaude(command, tty)) {
    process.stderr.write(
      `The agent of ${name} signs in with your own Claude account, so Claude Code runs there only in a session you drive yourself, in a terminal: never with -p, and never without a terminal (D48).\n`,
    );
    return 1;
  }
  const args = ["exec", "-i", ...(tty ? ["-t"] : []), "-w", "/workspace", agentContainer(name), ...(command.length ? command : ["claude"])];
  return spawnSync("docker", args, { stdio: "inherit" }).status ?? 1;
}

async function stop(name: string): Promise<number> {
  readProject(name);
  const record = await runSteps(
    [{ name: "the agent, its egress gate and its activity logger", run: () => { const gone = stopAgent(name); return ok(gone.length ? `removed ${gone.join(", ")}` : "not running"); } }],
    { kind: "agent-stop", project: name },
  );
  return record.ok ? 0 : 1;
}

/** One line of the activity log, as a person reads it. */
export function activityLine(json: string): string {
  try {
    const e = JSON.parse(json) as { at: string; tool: string; target: string; outcome: string };
    return `${e.at.slice(0, 19).replace("T", " ")}  ${e.outcome === "ok" ? "  " : "! "}${e.tool.padEnd(10)} ${e.target}`;
  } catch {
    return "(a line that cannot be read)";
  }
}

function activity(name: string, rest: string[]): number {
  readProject(name);
  const at = rest.indexOf("--lines");
  const lines = at >= 0 ? Number(rest[at + 1]) : 30;
  if (!Number.isInteger(lines) || lines < 1) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const file = activityLog(name);
  if (!existsSync(file)) {
    process.stdout.write(`The agent of ${name} has done nothing yet: there is no activity log.\n`);
    return 0;
  }
  const all = readFileSync(file, "utf8").split("\n").filter(Boolean);
  process.stdout.write(`What the agent of ${name} did, the last ${Math.min(lines, all.length)} of ${all.length} tool calls (UTC; ! = it failed):\n`);
  for (const line of all.slice(-lines)) process.stdout.write(`  ${activityLine(line)}\n`);
  return 0;
}

function transcripts(name: string, rest: string[]): number {
  readProject(name);
  const dir = transcriptsDir(name);
  const files = (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : [])
    .map((f) => ({ f, s: statSync(path.join(dir, f)) }))
    .sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
  if (rest.includes("--delete")) {
    if (agentState(name).status === "running") {
      process.stderr.write(`The agent of ${name} is running, and may be writing one. Stop it first: ${C} agent stop ${name}\n`);
      return 1;
    }
    if (existsSync(dir)) for (const entry of readdirSync(dir)) rmSync(path.join(dir, entry), { recursive: true, force: true });
    process.stdout.write(`Deleted ${files.length} conversation${files.length === 1 ? "" : "s"} of the agent of ${name}. Its activity log is kept.\n`);
    return 0;
  }
  if (!files.length) {
    process.stdout.write(`No conversation of the agent of ${name} is kept.\n`);
    return 0;
  }
  process.stdout.write(`The conversations of the agent of ${name}, oldest first, kept in ${dir} (only on this machine, not in backups):\n`);
  for (const { f, s } of files) {
    process.stdout.write(`  ${s.mtime.toISOString().slice(0, 16).replace("T", " ")} UTC  ${String(Math.ceil(s.size / 1024)).padStart(6)} kB  ${f}\n`);
  }
  process.stdout.write(`To delete them all: ${C} agent transcripts ${name} --delete\n`);
  return 0;
}

/** `--sign-in key|account` from start's arguments; null when it names neither. */
export function parseSignIn(rest: string[]): SignIn | null {
  if (rest.length === 0) return "key";
  const value = rest[0] === "--sign-in" ? rest[1] : rest[0]?.startsWith("--sign-in=") ? rest[0].slice("--sign-in=".length) : undefined;
  const used = rest[0] === "--sign-in" ? 2 : 1;
  if (rest.length !== used) return null;
  return SIGN_INS.includes(value as SignIn) ? (value as SignIn) : null;
}

export async function agent(args: string[]): Promise<number> {
  const [sub, name, ...rest] = args;
  if (!name) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (sub === "start") {
    const signIn = parseSignIn(rest);
    if (!signIn) {
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    return start(name, signIn);
  }
  if (sub === "shell") return shell(name, rest[0] === "--" ? rest.slice(1) : rest);
  if (sub === "stop") return stop(name);
  if (sub === "activity") return activity(name, rest);
  if (sub === "transcripts") return transcripts(name, rest);
  process.stderr.write(`${USAGE}\n`);
  return 2;
}
