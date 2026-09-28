/**
 * `allvibe agent start|shell|stop <project>` (D39).
 *
 *   agent start <project>              the agent container, with its key from the vault
 *   agent shell <project>              Claude Code's own interactive session in it
 *   agent shell <project> -- <cmd...>  a command in it instead, for example claude --version
 *   agent stop <project>               the agent and its egress gate, gone
 */
import { spawnSync } from "node:child_process";
import { NAMES } from "../lib/brand.js";
import { containerState, tryDocker } from "../lib/docker.js";
import {
  AGENT_KEY,
  agentContainer,
  agentState,
  CLAUDE_CODE_VERSION,
  ensureAgentImage,
  ensureEgress,
  hasAgentKey,
  MODEL_API_HOST,
  startAgent,
  stopAgent,
} from "../lib/agent.js";
import { ensureHook } from "../lib/keycheck.js";
import { containerName, networkName, readProject } from "../lib/project.js";
import { fail, ok, runSteps } from "../lib/steps.js";

const C = NAMES.command;
const USAGE = `usage: ${C} agent start <project> | shell <project> [-- <command>] | stop <project>`;

async function start(name: string): Promise<number> {
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
      {
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
      { name: `its only way out: ${MODEL_API_HOST}, over HTTPS`, run: () => ok(ensureEgress(name)) },
      {
        name: "the agent container",
        run: () => {
          startAgent(name, image);
          const state = containerState(agentContainer(name));
          return state.status === "running"
            ? ok(`${agentContainer(name)} running: dev's network only, the working copy only, not root, no capabilities`)
            : fail(`${agentContainer(name)} is ${state.status}`, `docker logs ${agentContainer(name)} says why`);
        },
      },
      {
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

/** Claude Code's own session, or a command, in the running agent, with this terminal. */
function shell(name: string, command: string[]): number {
  readProject(name);
  if (agentState(name).status !== "running") {
    process.stderr.write(`The agent of ${name} is not running. Start it: ${C} agent start ${name}\n`);
    return 1;
  }
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const args = ["exec", "-i", ...(tty ? ["-t"] : []), "-w", "/workspace", agentContainer(name), ...(command.length ? command : ["claude"])];
  return spawnSync("docker", args, { stdio: "inherit" }).status ?? 1;
}

async function stop(name: string): Promise<number> {
  readProject(name);
  const record = await runSteps(
    [{ name: "the agent and its egress gate", run: () => { const gone = stopAgent(name); return ok(gone.length ? `removed ${gone.join(", ")}` : "not running"); } }],
    { kind: "agent-stop", project: name },
  );
  return record.ok ? 0 : 1;
}

export async function agent(args: string[]): Promise<number> {
  const [sub, name, ...rest] = args;
  if (!name) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (sub === "start") return start(name);
  if (sub === "shell") return shell(name, rest[0] === "--" ? rest.slice(1) : rest);
  if (sub === "stop") return stop(name);
  process.stderr.write(`${USAGE}\n`);
  return 2;
}
