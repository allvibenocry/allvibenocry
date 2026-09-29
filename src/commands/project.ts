/**
 * `allvibe project create|list|status`.
 *
 * `create` makes a project from the starter template (D19): its own git
 * repository on the host, a dev stack built from the working tree, and a prod
 * stack running the template's first commit as v1, each with its own network,
 * volume and generated secret, both behind the proxy (D18).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { BRAND, INSTALL_ROOT, NAMES } from "../lib/brand.js";
import { readConfig } from "../lib/config.js";
import { containerState, docker, tryDocker } from "../lib/docker.js";
import { reloadProxy, removeServerConf } from "../lib/proxy.js";
import {
  buildDev,
  buildRelease,
  composeProject,
  containerName,
  currentRelease,
  deployEnv,
  envDir,
  ENVS,
  ensureSecret,
  ensureServerBlocks,
  freeSlot,
  gitHead,
  imageName,
  lanAddress,
  networkName,
  listProjects,
  nameProblem,
  projectDir,
  projectFile,
  readProject,
  repoDir,
  saveProject,
  smoke,
  urlFor,
  volumeName,
  type Env,
  type Project,
} from "../lib/project.js";
import { run, tryRun } from "../lib/run.js";
import { appliedMigrations, schemaOf } from "../lib/schema.js";
import { renderProjectDocs } from "../lib/template.js";
import { lockProject } from "../lib/vault.js";
import { ensureHook } from "../lib/keycheck.js";
import { agentContainer, agentState, signInOf, stopAgent } from "../lib/agent.js";
import { fail, ok, runSteps } from "../lib/steps.js";
import { withLock } from "../lib/lock.js";

const TEMPLATE = "guestbook";
const GIT_IDENTITY = ["-c", `user.name=${BRAND.product}`, "-c", `user.email=${NAMES.command}@localhost`];

/** git in the project's repository, whatever the exit code: for a commit whose hook may stop it. */
export function tryGit(project: string, ...args: string[]) {
  return tryRun("git", ["-C", repoDir(project), ...GIT_IDENTITY, ...args]);
}

export function git(project: string, ...args: string[]) {
  return run("git", ["-C", repoDir(project), ...GIT_IDENTITY, ...args]);
}

async function create(name: string | undefined): Promise<number> {
  if (!name) {
    process.stderr.write(`usage: ${NAMES.command} project create <name>\n`);
    return 2;
  }
  const config = readConfig();
  let project: Project | null = null;
  let commit = "";

  const record = await runSteps(
    [
      {
        name: "the name",
        run: () => {
          const problem = nameProblem(name);
          if (problem) return fail(problem, "a name like guestbook, my-shop or recipes2");
          if (existsSync(projectFile(name))) return fail(`there is already a project called ${name}`, "a name no project has");
          return ok(`${name} is free`);
        },
      },
      {
        name: "ports",
        run: () => {
          const { slot, ports } = freeSlot(config, listProjects());
          project = { name, slot, created: new Date().toISOString(), template: TEMPLATE, ports, releases: [] };
          return ok(`prod on port ${ports.prod}, dev on ${ports.dev}; the apps themselves on loopback ${ports.prodApp} and ${ports.devApp}; all free`);
        },
      },
      {
        name: "the project's git repository",
        run: () => {
          const p = project as Project;
          mkdirSync(projectDir(name), { recursive: true, mode: 0o750 });
          cpSync(path.join(INSTALL_ROOT, "templates", TEMPLATE), repoDir(name), { recursive: true });
          const docs = renderProjectDocs(repoDir(name), { PROJECT: name, COMMAND: NAMES.command, DATE: new Date().toISOString().slice(0, 10) });
          run("git", ["init", "-q", "-b", "main", repoDir(name)]);
          ensureHook(name);
          git(name, "config", "user.name", BRAND.product);
          git(name, "config", "user.email", `${NAMES.command}@localhost`);
          git(name, "add", "-A");
          git(name, "commit", "-q", "-m", `Start ${name} from the ${TEMPLATE} template`);
          commit = gitHead(name);
          saveProject(p);
          return ok(
            `${repoDir(name)}, first commit ${commit.slice(0, 12)}\n` +
              `with ${docs.join(", ")}: the agent's instructions, and the project's own state and decisions\n` +
              "and the key check before every commit, which checked this one",
          );
        },
      },
      {
        name: "secrets for dev and prod",
        run: () => {
          for (const env of ENVS) ensureSecret(name, env);
          return ok("a database password for each, generated here and never printed");
        },
      },
      {
        name: "dev: built from the working tree",
        run: () => ok(`image ${imageName(name, buildDev(project as Project))}`),
      },
      {
        name: "dev: running and healthy",
        run: async () => {
          const state = await deployEnv(project as Project, "dev", "dev");
          return state.health === "healthy"
            ? ok(`${containerName(name, "dev", "app")} healthy, data in volume ${volumeName(name, "dev")}`)
            : fail(`dev's app is ${state.status}/${state.health}`, `docker logs ${containerName(name, "dev", "app")} says why`);
        },
      },
      {
        name: "prod: v1 built from the first commit",
        run: () => ok(`image ${imageName(name, buildRelease(project as Project, commit, "v1"))} from ${commit.slice(0, 12)}`),
      },
      {
        name: "prod: running and healthy",
        run: async () => {
          const p = project as Project;
          const state = await deployEnv(p, "prod", "v1");
          if (state.health !== "healthy") {
            return fail(`prod's app is ${state.status}/${state.health}`, `docker logs ${containerName(name, "prod", "app")} says why`);
          }
          p.releases.push({ version: "v1", commit, image: imageName(name, "v1"), at: new Date().toISOString(), backup: null, schema: schemaOf(appliedMigrations(p, "prod")) });
          saveProject(p);
          git(name, "tag", "-a", "v1", "-m", "v1: the template, deployed when the project was created", commit);
          return ok(`${containerName(name, "prod", "app")} healthy on v1, data in volume ${volumeName(name, "prod")}; tagged v1`);
        },
      },
      {
        name: "the proxy serves both",
        run: () => {
          ensureServerBlocks(project as Project);
          return ok(`server blocks for ${name}-prod and ${name}-dev, checked with nginx -t and reloaded`);
        },
      },
      {
        name: "both answer through the front door",
        run: async () => {
          const p = project as Project;
          const checks = await Promise.all(ENVS.map(async (env) => ({ env, result: await smoke(p, env) })));
          const bad = checks.filter((c) => !c.result.ok);
          if (bad.length) return fail(bad.map((c) => `${c.env}: ${c.result.said}`).join("; "));
          return ok(checks.map((c) => `${c.env}: ${c.result.said}`).join("\n"));
        },
      },
    ],
    { kind: "project-create", project: name },
  );

  if (record.ok && project) {
    const p = project as Project;
    process.stdout.write(`\n${name} is ready:\n  prod  ${urlFor(p, "prod")}\n  dev   ${urlFor(p, "dev")}\n`);
  } else if (existsSync(projectDir(name)) && record.failedStep !== "the name") {
    process.stdout.write(
      `\nThe half-made project is still there. To start again:\n` +
        `  ${NAMES.command} project remove ${name} --delete-everything\n  ${NAMES.command} project create ${name}\n`,
    );
  }
  return record.ok ? 0 : 1;
}

/**
 * Removes a project and everything it has: both environments, their data,
 * their images and the repository. Nothing is deleted without
 * --delete-everything; without it, this says exactly what would go. Backups on
 * the backup target are never touched.
 */
async function remove(name: string | undefined, flags: string[]): Promise<number> {
  if (!name) {
    process.stderr.write(`usage: ${NAMES.command} project remove <name> [--delete-everything]\n`);
    return 2;
  }
  if (!existsSync(projectDir(name))) {
    process.stderr.write(`there is no project called ${name}\n`);
    return 1;
  }
  const what = [
    `the dev and prod apps and databases of ${name}`,
    `their data, for good: volumes ${volumeName(name, "dev")} and ${volumeName(name, "prod")}`,
    "their networks, their images and their entries in the proxy",
    `the repository ${repoDir(name)}, with its whole history`,
    "its key vault, with every key in it (backups keep a copy)",
    "the agent's kept conversations and its activity log (backups keep no copy)",
  ];
  if (!flags.includes("--delete-everything")) {
    process.stdout.write(
      `This would delete, and nothing could bring it back except a backup:\n${what.map((w) => `  - ${w}`).join("\n")}\n` +
        `Backups on the backup target are kept.\n\nTo do it: ${NAMES.command} project remove ${name} --delete-everything\n`,
    );
    return 2;
  }
  const record = await runSteps(
    [
      {
        name: "the agent, if it runs",
        run: () => {
          const gone = stopAgent(name);
          return ok(gone.length ? `removed ${gone.join(", ")}` : "not running");
        },
      },
      ...ENVS.map((env) => ({
        name: `${env}: containers, networks and data`,
        run: () => {
          const file = path.join(envDir(name, env), "compose.json");
          if (existsSync(file)) {
            docker(["compose", "-p", composeProject(name, env), "-f", file, "down", "--volumes", "--remove-orphans"]);
          } else {
            for (const service of ["app", "db"] as const) tryDocker(["rm", "-f", containerName(name, env, service)]);
            for (const kind of ["internal", "edge"] as const) tryDocker(["network", "rm", networkName(name, env, kind)]);
            tryDocker(["volume", "rm", volumeName(name, env)]);
          }
          return ok(`${env} removed, with volume ${volumeName(name, env)}`);
        },
      })),
      {
        name: "the proxy's entries",
        run: () => {
          const changed = ENVS.map((env) => removeServerConf(`${name}-${env}`)).some(Boolean);
          if (changed) reloadProxy();
          return ok(changed ? "removed, and the proxy reloaded" : "none there");
        },
      },
      {
        name: "images",
        run: () => {
          const images = tryDocker(["image", "ls", "--filter", `label=${NAMES.label}.project=${name}`, "--format", "{{.Repository}}:{{.Tag}}"])
            .stdout.split("\n")
            .filter((image) => image && !image.endsWith(":<none>"));
          for (const image of images) tryDocker(["image", "rm", image]);
          return ok(images.length ? images.join(", ") : "none");
        },
      },
      {
        name: "the repository and the project's files",
        run: () => {
          rmSync(projectDir(name), { recursive: true, force: true });
          lockProject(name);
          return ok(`${projectDir(name)} removed, with its key vault, the keys in memory, and the agent's conversations and activity log`);
        },
      },
    ],
    { kind: "project-remove", project: name },
  );
  return record.ok ? 0 : 1;
}

function describe(state: ReturnType<typeof containerState>): string {
  if (!state.exists) return "not there";
  return state.health === "none" ? state.status : `${state.status}, ${state.health}`;
}

function list(): number {
  const projects = listProjects();
  if (projects.length === 0) {
    process.stdout.write(`No projects yet. Create one: ${NAMES.command} project create <name>\n`);
    return 0;
  }
  const address = lanAddress();
  process.stdout.write(`${"PROJECT".padEnd(20)} ${"PROD".padEnd(28)} ${"DEV".padEnd(20)} URLS\n`);
  for (const p of projects) {
    const prod = `${currentRelease(p)?.version ?? "-"}: ${describe(containerState(containerName(p.name, "prod", "app")))}`;
    const dev = describe(containerState(containerName(p.name, "dev", "app")));
    process.stdout.write(`${p.name.padEnd(20)} ${prod.padEnd(28)} ${dev.padEnd(20)} prod http://${address}:${p.ports.prod}/  dev http://${address}:${p.ports.dev}/\n`);
  }
  return 0;
}

async function status(name: string | undefined): Promise<number> {
  if (!name) {
    process.stderr.write(`usage: ${NAMES.command} project status <name>\n`);
    return 2;
  }
  const p = readProject(name);
  const head = gitHead(name);
  const dirty = run("git", ["-C", repoDir(name), "status", "--porcelain"]).stdout.trim() !== "";
  const out = (line = "") => process.stdout.write(`${line}\n`);
  out(`${p.name}  (created ${p.created.slice(0, 10)} from the ${p.template} template)`);
  out(`  repository  ${repoDir(name)}, at ${head.slice(0, 12)}${dirty ? ", with uncommitted changes" : ""}`);
  for (const env of ["prod", "dev"] as Env[]) {
    const app = containerState(containerName(name, env, "app"));
    const db = containerState(containerName(name, env, "db"));
    const check = await smoke(p, env);
    out("");
    out(`  ${env}  ${urlFor(p, env)}`);
    if (env === "prod") {
      const release = currentRelease(p);
      out(`    version   ${release ? `${release.version}, from ${release.commit.slice(0, 12)}, since ${release.at.slice(0, 16).replace("T", " ")} UTC` : "none"}`);
    }
    out(`    app       ${describe(app)}  (${app.image || "-"})`);
    out(`    database  ${describe(db)}, data in volume ${volumeName(name, env)}`);
    if (db.status === "running") {
      let schema: string;
      try {
        const applied = appliedMigrations(p, env);
        schema = applied.length ? `${applied.at(-1)} (${applied.length} migration${applied.length === 1 ? "" : "s"} applied)` : "no migrations applied yet";
      } catch (error) {
        schema = `could not be read: ${(error as Error).message}`;
      }
      out(`    schema    ${schema}`);
    }
    out(`    check     ${check.ok ? `answers: ${check.entries} ${check.entries === 1 ? "entry" : "entries"}, version ${check.version}` : `NOT answering: ${check.said}`}`);
  }
  const agent = agentState(name);
  out("");
  const signIn = agent.exists ? (signInOf(agentContainer(name)) === "account" ? ", your own Claude account" : ", its key") : "";
  out(`  agent       ${agent.exists ? `${agent.status} (${agent.image}${signIn})` : `not running: ${NAMES.command} agent start ${name}`}`);
  if (p.releases.length > 1) {
    out("");
    out(`  releases    ${p.releases.map((r) => `${r.version}${r.breaking?.length ? " (breaking)" : ""}`).join(", ")}`);
  }
  if (p.failed) {
    out("");
    out(`  NOTE        ${p.failed.version} failed after its breaking migration had run, and prod is still on it: ${NAMES.command} rollback ${name} --restore-data`);
  }
  return 0;
}

export async function project(args: string[]): Promise<number> {
  const [sub, name] = args;
  if (sub === "create") return create(name);
  if (sub === "list") return list();
  if (sub === "status") return status(name);
  // Not while a release, going back or a backup of it runs (D72).
  if (sub === "remove") return withLock(name, "project-remove", () => remove(name, args.slice(2)));
  process.stderr.write(`usage: ${NAMES.command} project create <name> | list | status <name> | remove <name>\n`);
  return 2;
}
