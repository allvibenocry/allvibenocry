/**
 * `allvibe dev deploy <project>` and `allvibe dev commit <project> "<message>"`.
 *
 * Dev is where changes are made (by the agent, later; by hand, for now). These
 * are the two things done with a change before it can be released: look at it
 * running in dev, and commit it, because a release is a commit (D25).
 */
import { NAMES } from "../lib/brand.js";
import { withLock } from "../lib/lock.js";
import { buildDev, containerName, deployEnv, gitHead, readProject, repoDir, smoke, urlFor } from "../lib/project.js";
import { run } from "../lib/run.js";
import { fail, ok, runSteps } from "../lib/steps.js";
import { ensureHook } from "../lib/keycheck.js";
import { git, tryGit } from "./project.js";

const C = NAMES.command;

async function deploy(name: string | undefined): Promise<number> {
  if (!name) {
    process.stderr.write(`usage: ${C} dev deploy <project>\n`);
    return 2;
  }
  const project = readProject(name);
  const record = await runSteps(
    [
      { name: "dev built from the working tree", run: () => ok(`built at ${gitHead(name).slice(0, 12)}, uncommitted changes included`, buildDev(project) !== "") },
      {
        name: "dev running and healthy",
        run: async () => {
          const state = await deployEnv(project, "dev", "dev");
          return state.health === "healthy" ? ok(`${containerName(name, "dev", "app")} healthy`) : fail(`dev's app is ${state.status}/${state.health}`, `docker logs ${containerName(name, "dev", "app")} says why`);
        },
      },
      {
        name: "dev answers its smoke check",
        run: async () => {
          const check = await smoke(project, "dev");
          return check.ok ? ok(`${check.said}\nlook at it: ${urlFor(project, "dev")}`) : fail(`dev does not answer: ${check.said}`);
        },
      },
    ],
    { kind: "dev-deploy", project: name },
  );
  return record.ok ? 0 : 1;
}

async function commit(name: string | undefined, message: string | undefined): Promise<number> {
  if (!name || !message) {
    process.stderr.write(`usage: ${C} dev commit <project> "<what changed>"\n`);
    return 2;
  }
  readProject(name);
  const record = await runSteps(
    [
      {
        name: "dev's changes committed",
        run: () => {
          const changes = run("git", ["-C", repoDir(name), "status", "--porcelain"]).stdout.trim();
          if (!changes) return fail("there is nothing to commit: dev has no changes");
          ensureHook(name);
          git(name, "add", "-A");
          // The key check runs as the commit's pre-commit hook (D38): if it stops the
          // commit, what it said is the reason, in full.
          const committed = tryGit(name, "commit", "-q", "-m", message);
          if (committed.code !== 0) {
            // Unstaged again, so the next commit does not carry it by accident.
            tryGit(name, "reset", "-q");
            return fail((committed.stderr || committed.stdout).trim(), "nothing was committed; the changes are still in dev's working tree");
          }
          return ok(`${gitHead(name).slice(0, 12)}: ${message}\n${changes}\nthe key check found nothing that looks like a key`);
        },
      },
    ],
    { kind: "dev-commit", project: name },
  );
  return record.ok ? 0 : 1;
}

export async function dev(args: string[]): Promise<number> {
  const [sub, name, ...rest] = args;
  // A new start of the test copy, under the app's lock (D72).
  if (sub === "deploy") return withLock(name, "dev-deploy", () => deploy(name));
  if (sub === "commit") return commit(name, rest.join(" ") || undefined);
  process.stderr.write(`usage: ${C} dev deploy <project> | dev commit <project> "<what changed>"\n`);
  return 2;
}
