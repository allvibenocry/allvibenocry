/**
 * A project: a git repository on the host, and two stacks built from it, dev
 * and prod, that share nothing (D9, rule 1).
 *
 * What keeps dev away from prod:
 *
 * - **Separate networks.** Each environment's database is on an internal
 *   network of its own, with no route anywhere; its app is on that network and
 *   on an edge network of its own. No network is shared between environments.
 * - **Separate volumes and secrets.** Each environment's data is its own named
 *   volume; each has its own generated database password, a file only its own
 *   containers get.
 * - **Nothing published.** An app publishes its port on the host's loopback
 *   only, which no container can reach; the proxy is the only way in.
 * - **The front door refuses containers.** Prod's server block denies every
 *   address Docker hands out, so no container, dev or otherwise, can reach prod
 *   even the way a browser on the LAN does (D18).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { posix as path } from "node:path";
import { NAMES } from "./brand.js";
import type { HostConfig } from "./config.js";
import { docker, tryDocker, waitHealthy, type ContainerState } from "./docker.js";
import { ensureFile, readJson, writeAtomic } from "./files.js";
import { reloadProxy, writeServerConf } from "./proxy.js";
import { run, tryRun } from "./run.js";

export const POSTGRES_IMAGE =
  "postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873";

export type Env = "dev" | "prod";
export const ENVS: Env[] = ["dev", "prod"];

export interface Release {
  version: string;
  commit: string;
  image: string;
  at: string;
  /** The backup taken just before this release, which a data rollback would restore. */
  backup: string | null;
}

export interface Project {
  name: string;
  slot: number;
  created: string;
  template: string;
  ports: { prod: number; dev: number; prodApp: number; devApp: number };
  /** Every version prod has run, oldest first. The last is what runs now. */
  releases: Release[];
}

/* ------------------------------------------------------------- names -- */

const C = NAMES.command;
export const projectDir = (name: string) => path.join(NAMES.projectsDir, name);
export const projectFile = (name: string) => path.join(projectDir(name), "project.json");
export const repoDir = (name: string) => path.join(projectDir(name), "repo");
export const envDir = (name: string, env: Env) => path.join(projectDir(name), env);
export const secretFile = (name: string, env: Env) => path.join(projectDir(name), "secrets", env, "db_password");
export const composeProject = (name: string, env: Env) => `${C}-${name}-${env}`;
export const imageName = (name: string, tag: string) => `${C}-${name}:${tag}`;
export const containerName = (name: string, env: Env, service: "app" | "db") => `${C}-${name}-${env}-${service}`;
export const volumeName = (name: string, env: Env) => `${C}-${name}-${env}-db`;
export const networkName = (name: string, env: Env, kind: "internal" | "edge") => `${C}-${name}-${env}-${kind}`;

/* ---------------------------------------------------- the name itself -- */

const FORBIDDEN = ["no", "cry"].join("");
const RESERVED = new Set(["proxy", "test-host", "backup", "all"]);

/** Why a name cannot be a project, or null when it can. */
export function nameProblem(name: string): string | null {
  if (!/^[a-z][a-z0-9-]{1,29}$/.test(name)) return "a project name is 2-30 lowercase letters, digits and dashes, starting with a letter";
  if (name.endsWith("-") || name.includes("--")) return "a project name cannot end with a dash or have two in a row";
  if (name.includes(FORBIDDEN)) return "that name is not allowed: nothing here is ever named after the ransomware family (rule 9)";
  if (RESERVED.has(name)) return `"${name}" is reserved`;
  return null;
}

/* ---------------------------------------------------------- the store -- */

export function listProjects(): Project[] {
  let names: string[] = [];
  try {
    names = readdirSync(NAMES.projectsDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => existsSync(projectFile(name)))
    .map((name) => readProject(name))
    .sort((a, b) => a.slot - b.slot);
}

export function readProject(name: string): Project {
  const project = readJson<Project | null>(projectFile(name), null);
  if (!project) throw new Error(`there is no project called ${name}`);
  return project;
}

export function saveProject(project: Project): void {
  writeAtomic(projectFile(project.name), `${JSON.stringify(project, null, 2)}\n`, 0o640);
}

export const currentRelease = (project: Project): Release | null => project.releases.at(-1) ?? null;

/* ------------------------------------------------------------- ports -- */

export function portsForSlot(config: HostConfig, slot: number) {
  return {
    prod: config.portBase + 2 * slot,
    dev: config.portBase + 2 * slot + 1,
    prodApp: config.portBase + 10_000 + 2 * slot,
    devApp: config.portBase + 10_000 + 2 * slot + 1,
  };
}

/** TCP ports something on the host listens on. */
export function listeningPorts(): Set<number> {
  const out = tryRun("ss", ["-Hltn"]).stdout;
  const ports = new Set<number>();
  for (const line of out.split("\n")) {
    const local = line.trim().split(/\s+/)[3] ?? "";
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    if (port) ports.add(port);
  }
  return ports;
}

export function freeSlot(config: HostConfig, projects: Project[]): { slot: number; ports: Project["ports"] } {
  const taken = new Set(projects.map((p) => p.slot));
  const busy = listeningPorts();
  for (let slot = 0; slot < config.maxProjects; slot += 1) {
    if (taken.has(slot)) continue;
    const ports = portsForSlot(config, slot);
    if (Object.values(ports).some((port) => busy.has(port))) continue;
    return { slot, ports };
  }
  throw new Error(`no free ports: all ${config.maxProjects} project slots from port ${config.portBase} are in use`);
}

/** The address other machines on the LAN reach this one at. */
export function lanAddress(): string {
  const route = tryRun("ip", ["-4", "route", "get", "1.1.1.1"]).stdout;
  return route.match(/\bsrc\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? "this-machine";
}

export const urlFor = (project: Project, env: Env) => `http://${lanAddress()}:${project.ports[env]}/`;

/* ------------------------------------------------------------ secrets -- */

/**
 * One database password per environment, generated here and never printed.
 * The file is readable by any process that can reach it, because the app runs
 * as another uid inside its container; its directory is the service user's
 * alone, so on the host nothing else can reach it (rule 4).
 */
export function ensureSecret(name: string, env: Env): boolean {
  const file = secretFile(name, env);
  if (existsSync(file)) return false;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.join(projectDir(name), "secrets"), 0o700);
  writeAtomic(file, randomBytes(32).toString("base64url"), 0o644);
  return true;
}

/* ------------------------------------------------------------ compose -- */

export function composeFor(project: Project, env: Env, imageTag: string): string {
  const name = project.name;
  const labels = (role: string) => ({ [`${C}.project`]: name, [`${C}.env`]: env, [`${C}.role`]: role });
  const appPort = env === "prod" ? project.ports.prodApp : project.ports.devApp;
  const compose = {
    name: composeProject(name, env),
    services: {
      db: {
        image: POSTGRES_IMAGE,
        container_name: containerName(name, env, "db"),
        restart: "unless-stopped",
        environment: { POSTGRES_USER: "app", POSTGRES_DB: "app", POSTGRES_PASSWORD_FILE: "/run/secrets/db_password" },
        secrets: ["db_password"],
        volumes: ["db:/var/lib/postgresql"],
        networks: ["internal"],
        security_opt: ["no-new-privileges:true"],
        healthcheck: { test: ["CMD-SHELL", "pg_isready -U app -d app"], interval: "5s", timeout: "5s", retries: 20 },
        labels: labels("db"),
      },
      app: {
        image: imageName(name, imageTag),
        container_name: containerName(name, env, "app"),
        restart: "unless-stopped",
        environment: {
          APP_ENV: env,
          DATABASE_HOST: "db",
          DATABASE_USER: "app",
          DATABASE_NAME: "app",
          DATABASE_PASSWORD_FILE: "/run/secrets/db_password",
        },
        secrets: ["db_password"],
        depends_on: { db: { condition: "service_healthy" } },
        // The host's loopback only: the proxy reaches it, nothing else can.
        ports: [`127.0.0.1:${appPort}:3000`],
        networks: ["internal", "edge"],
        read_only: true,
        tmpfs: ["/tmp"],
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        healthcheck: {
          test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
          interval: "5s",
          timeout: "5s",
          retries: 20,
          start_period: "10s",
        },
        labels: labels("app"),
      },
    },
    networks: {
      internal: { name: networkName(name, env, "internal"), internal: true, labels: labels("network") },
      edge: { name: networkName(name, env, "edge"), labels: labels("network") },
    },
    volumes: { db: { name: volumeName(name, env), labels: labels("data") } },
    secrets: { db_password: { file: secretFile(name, env) } },
  };
  return `${JSON.stringify(compose, null, 2)}\n`;
}

/** Bring one environment up on an image, and wait until its app is healthy. */
export async function deployEnv(project: Project, env: Env, imageTag: string): Promise<ContainerState> {
  const file = path.join(envDir(project.name, env), "compose.json");
  ensureFile(file, composeFor(project, env, imageTag), 0o640);
  docker(["compose", "-p", composeProject(project.name, env), "-f", file, "up", "-d", "--remove-orphans", "--pull", "missing"]);
  return waitHealthy(containerName(project.name, env, "app"), 180_000);
}

/* ------------------------------------------------------------- images -- */

export function gitHead(name: string): string {
  return run("git", ["-C", repoDir(name), "rev-parse", "HEAD"]).stdout.trim();
}

/** dev: the working tree as it is, uncommitted changes included. */
export function buildDev(project: Project): string {
  const commit = gitHead(project.name).slice(0, 12);
  const tag = "dev";
  docker([
    "build", "-q",
    "-t", imageName(project.name, tag),
    "--build-arg", `APP_VERSION=dev (${commit})`,
    "--label", `${C}.project=${project.name}`,
    "--label", `${C}.env=dev`,
    "--label", `${C}.commit=${commit}`,
    repoDir(project.name),
  ]);
  return tag;
}

/** prod: exactly one commit, from git, never the working tree. */
export function buildRelease(project: Project, commit: string, version: string): string {
  const tar = gitArchive(project.name, commit);
  docker(
    [
      "build", "-q",
      "-t", imageName(project.name, version),
      "--build-arg", `APP_VERSION=${version}`,
      "--label", `${C}.project=${project.name}`,
      "--label", `${C}.env=prod`,
      "--label", `${C}.version=${version}`,
      "--label", `${C}.commit=${commit}`,
      "-",
    ],
    { input: tar },
  );
  return version;
}

/** The tree of one commit, as a tar, for `docker build -`. Binary, so not through run(). */
function gitArchive(name: string, commit: string): Buffer {
  const result = spawnSync("git", ["-C", repoDir(name), "archive", "--format=tar", commit], { maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git archive ${commit} failed: ${result.stderr?.toString().trim()}`);
  return result.stdout;
}

/* --------------------------------------------------------------- proxy -- */

/** Every range Docker hands addresses from on this host: prod refuses them all. */
export function dockerRanges(): string[] {
  const pools = tryDocker(["info", "--format", "{{range .DefaultAddressPools}}{{.Base}} {{end}}"]).stdout.trim().split(/\s+/).filter(Boolean);
  const bridge = tryDocker(["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Subnet}} {{end}}"]).stdout.trim().split(/\s+/).filter(Boolean);
  return [...new Set([...pools, ...bridge])];
}

export function serverConf(project: Project, env: Env, ranges: string[] = env === "prod" ? dockerRanges() : []): string {
  const listen = env === "prod" ? project.ports.prod : project.ports.dev;
  const upstream = env === "prod" ? project.ports.prodApp : project.ports.devApp;
  const deny =
    env === "prod"
      ? [
          "    # Rule 1 at the front door: no container reaches prod, not even the way",
          "    # a browser on the LAN does. Every address Docker hands out is refused.",
          ...ranges.map((range) => `    deny ${range};`),
          "    allow all;",
        ]
      : [];
  return `# ${project.name}, ${env}. Generated by ${C}; rewritten on every change.
server {
    # IPv4 only: a global IPv6 address would put this on the internet (D18).
    listen 0.0.0.0:${listen};
${deny.join("\n")}${deny.length ? "\n" : ""}
    location / {
        proxy_pass http://127.0.0.1:${upstream};
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
`;
}

export function ensureServerBlocks(project: Project): boolean {
  const changed = ENVS.map((env) => writeServerConf(`${project.name}-${env}`, serverConf(project, env))).some(Boolean);
  if (changed) reloadProxy();
  return changed;
}

/* ------------------------------------------------------------- checks -- */

export interface Smoke {
  ok: boolean;
  entries: number | null;
  version: string | null;
  said: string;
}

/** The project's smoke check, through the front door: GET /healthz. */
export async function smoke(project: Project, env: Env, timeoutMs = 10_000): Promise<Smoke> {
  const port = env === "prod" ? project.ports.prod : project.ports.dev;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    if (!response.ok) return { ok: false, entries: null, version: null, said: `HTTP ${response.status}` };
    const body = JSON.parse(text);
    return { ok: body.ok === true, entries: body.entries ?? null, version: body.version ?? null, said: text.trim() };
  } catch (error) {
    return { ok: false, entries: null, version: null, said: error instanceof Error ? error.message : String(error) };
  }
}

