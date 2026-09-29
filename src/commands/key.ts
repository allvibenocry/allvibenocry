/**
 * `allvibe key set|list|remove` and `allvibe keys-unlock` (D37).
 *
 *   key set <project> <scope> <NAME> < file    the value from standard input, never an argument
 *   key list <project>                         names, scopes and when each changed; never values
 *   key remove <project> <scope> <NAME>
 *
 * A key that dev or prod uses reaches its app at once: the app is started
 * again with the key mounted as a file. If it does not come up healthy with the
 * new value, the value it had before is put back and the app started on that,
 * so a key change never leaves an app down (rule 7 names the step).
 */
import { NAMES } from "../lib/brand.js";
import { containerState } from "../lib/docker.js";
import { withLock } from "../lib/lock.js";
import { containerName, currentRelease, deployEnv, listProjects, readProject, runningTag, type Env, type Project } from "../lib/project.js";
import { fail, ok, runSteps, type Step } from "../lib/steps.js";
import {
  keyNameProblem,
  listKeys,
  removeKey,
  scopeProblem,
  secretPath,
  stageKey,
  unlockAll,
  vaultDir,
  valueFromInput,
  type Scope,
} from "../lib/vault.js";

const C = NAMES.command;
const USAGE = `usage: ${C} key set <project> <dev|prod|agent> <NAME> < file-with-the-value
       ${C} key list <project>
       ${C} key remove <project> <dev|prod|agent> <NAME>`;

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** The tag an environment should be started on again: what it runs now. */
function tagFor(project: Project, env: Env): string | null {
  return runningTag(project, env) ?? (env === "dev" ? "dev" : (currentRelease(project)?.version ?? null));
}

/**
 * Start the scope's app again with its keys. For the agent there is nothing to
 * restart here: it reads its keys when it starts.
 */
async function restart(project: Project, scope: Scope): Promise<{ ok: boolean; said: string }> {
  if (scope === "agent") return { ok: true, said: `the agent gets it when it next starts (${C} agent start ${project.name})` };
  const app = containerState(containerName(project.name, scope, "app"));
  const tag = tagFor(project, scope);
  if (!app.exists || !tag) return { ok: true, said: `${scope} is not running; it gets it when it is next deployed` };
  const state = await deployEnv(project, scope, tag, { recreateApp: true });
  return state.status === "running" && state.health === "healthy"
    ? { ok: true, said: `${scope}'s app started again on ${tag}, healthy` }
    : { ok: false, said: `${scope}'s app did not come up healthy (${state.status}/${state.health})` };
}

async function set(args: string[]): Promise<number> {
  const [name, scopeArg, key, ...extra] = args;
  if (!name || !scopeArg || !key) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (extra.length > 0) {
    process.stderr.write(`${C} key set reads the value from standard input, never from the command line, where it would be in the shell's history and the process list.\n${USAGE}\n`);
    return 2;
  }
  const project = readProject(name);
  const problem = scopeProblem(scopeArg) ?? keyNameProblem(key);
  if (problem) {
    process.stderr.write(`${problem}\n`);
    return 2;
  }
  const scope = scopeArg as Scope;
  if (process.stdin.isTTY) {
    process.stderr.write(`${C} key set reads the value from standard input and never asks for it.\nPut it in a file, then: ${C} key set ${name} ${scope} ${key} < the-file\n`);
    return 2;
  }
  const input = await readStdin();
  let value = "";
  let staged: ReturnType<typeof stageKey> | null = null;

  const steps: Step[] = [
    {
      name: "the value, from standard input",
      run: () => {
        value = valueFromInput(input);
        return ok(`${Buffer.byteLength(value)} bytes, not shown`);
      },
    },
    {
      name: `${scope} ${key}, encrypted in the vault`,
      run: () => {
        staged = stageKey(name, scope, key, value);
        value = "";
        return ok(`${staged.replaced ? "replaced" : "added"}: encrypted to this machine's key and the recovery key (D13), in ${vaultDir(name)}`);
      },
    },
    {
      name: scope === "agent" ? "the agent" : `${scope}'s app, with the key at ${secretPath(key)}`,
      run: async () => {
        const change = staged!;
        const result = await restart(project, scope);
        if (result.ok) {
          change.keep();
          return ok(scope === "agent" ? result.said : `${result.said}; it finds the file's path in ${key}_FILE`);
        }
        // Put back what it had, and start it on that.
        change.undo();
        const back = await restart(project, scope);
        return fail(
          `${result.said} with the new value, so ${change.replaced ? "the value it had before is back" : "the key is removed again"}` +
            `${back.ok ? `, and ${back.said}` : `, but ${back.said} on that either`}`,
          `the app works with the value given: look at ${C} project status ${name} and the app's log`,
        );
      },
    },
  ];
  const record = await runSteps(steps, { kind: "key-set", project: name, facts: { scope, key } });
  return record.ok ? 0 : 1;
}

function list(args: string[]): number {
  const [name] = args;
  if (!name) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  readProject(name);
  const keys = listKeys(name);
  if (keys.length === 0) {
    process.stdout.write(`${name} has no keys in its vault. Add one: ${C} key set ${name} <dev|prod|agent> <NAME> < file\n`);
    return 0;
  }
  process.stdout.write(`${"SCOPE".padEnd(7)} ${"NAME".padEnd(32)} CHANGED\n`);
  for (const k of keys) process.stdout.write(`${k.scope.padEnd(7)} ${k.name.padEnd(32)} ${k.changed.slice(0, 16).replace("T", " ")} UTC\n`);
  process.stdout.write(`\nValues are never shown. The apps read each one from the file named in <NAME>_FILE.\n`);
  return 0;
}

async function remove(args: string[]): Promise<number> {
  const [name, scopeArg, key] = args;
  if (!name || !scopeArg || !key) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const project = readProject(name);
  const problem = scopeProblem(scopeArg);
  if (problem) {
    process.stderr.write(`${problem}\n`);
    return 2;
  }
  const scope = scopeArg as Scope;
  const record = await runSteps(
    [
      {
        name: `${scope} ${key}, out of the vault`,
        run: () => (removeKey(name, scope, key) ? ok("removed, with its copy in memory") : fail(`${name} has no ${scope} key called ${key}`, `${C} key list ${name}`)),
      },
      {
        name: scope === "agent" ? "the agent" : `${scope}'s app, without it`,
        run: async () => {
          const result = await restart(project, scope);
          return result.ok ? ok(result.said) : fail(result.said, `the app may still need ${key}: ${C} key set ${name} ${scope} ${key} < file`);
        },
      },
    ],
    { kind: "key-remove", project: name, facts: { scope, key } },
  );
  return record.ok ? 0 : 1;
}

export async function key(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  // A key changed restarts the app that uses it: under the app's lock (D72).
  if (sub === "set") return withLock(rest[0], "key-set", () => set(rest));
  if (sub === "list") return list(rest);
  if (sub === "remove") return withLock(rest[0], "key-set", () => remove(rest));
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

/** What the boot unit runs before Docker starts the apps: every key, back in memory. */
export async function keysUnlock(): Promise<number> {
  const record = await runSteps(
    [
      {
        name: "every project's keys, decrypted into memory",
        run: () => {
          const done = unlockAll(listProjects().map((p) => p.name));
          return ok(done.length ? done.map((d) => `${d.project} ${d.scope}: ${d.names.length} key(s)`).join("\n") : "no project has keys");
        },
      },
    ],
    { kind: "keys-unlock" },
  );
  return record.ok ? 0 : 1;
}

