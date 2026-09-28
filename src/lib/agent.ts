/**
 * The agent container (D39): the official, unmodified Claude Code, at a pinned
 * version, working in a project's dev and nowhere else.
 *
 * - **Network**: only the project's dev network, where its dev app and dev
 *   database are. That network has no route out; the one way out is the
 *   egress gate beside it, which passes HTTPS to the model's API and nothing
 *   else (agent/egress.mjs).
 * - **Files**: only the project's working copy, and its own AI key from the
 *   vault's agent scope, as a single read-only file (D37). Its home and /tmp
 *   are in memory.
 * - **Never** (rule 12): the Docker socket, the host's network, privileged
 *   mode, the host key, the recovery key, the backup target, or anything of
 *   prod's. It runs as the service user's uid, not root, with no capabilities,
 *   a read-only root filesystem and limits on memory, CPU and processes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix as path } from "node:path";
import { INSTALL_ROOT, NAMES } from "./brand.js";
import { containerState, docker, tryDocker, type ContainerState } from "./docker.js";
import { networkName, containerName, repoDir } from "./project.js";
import { keyNames, runtimeFile, secretPath, unlockScope } from "./vault.js";

const C = NAMES.command;

/** Claude Code's version, as agent/package.json pins it. */
export const CLAUDE_CODE_VERSION = "2.1.283";
/** The model's API: the only host the agent reaches outside its dev network. */
export const MODEL_API_HOST = "api.anthropic.com";
/** The vault's name for the agent's key, in the agent scope (D37). */
export const AGENT_KEY = "ANTHROPIC_API_KEY";
/** The egress gate runs on the same pinned Node image as the template (D27). */
export const EGRESS_IMAGE = "node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1";
export const EGRESS_PORT = 3128;

export const agentContainer = (project: string) => `${C}-${project}-agent`;
export const egressContainer = (project: string) => `${C}-${project}-agent-egress`;
export const egressNetwork = (project: string) => `${C}-${project}-agent-egress`;
const agentDir = () => path.join(INSTALL_ROOT.split("\\").join("/"), "agent");

/** The files the image is built from: they, the version and the uid name it, so a change is a new image. */
export function agentImageTag(uid: number, gid: number, dir = agentDir()): string {
  const hash = createHash("sha256");
  for (const file of ["Dockerfile", "entrypoint.sh", "package.json", "package-lock.json"]) hash.update(readFileSync(path.join(dir, file)));
  hash.update(`${uid}:${gid}`);
  return `${C}-agent:${CLAUDE_CODE_VERSION}-${hash.digest("hex").slice(0, 12)}`;
}

export interface AgentRunOptions {
  project: string;
  image: string;
  uid: number;
  gid: number;
  /** The decrypted key's file in memory, or null when the vault has none. */
  keyFile: string | null;
}

/**
 * The agent's `docker run` arguments, and nothing else: every mount, network,
 * user and limit it gets is here, so a test can check that none of rule 12's is.
 */
export function agentRunArgs(o: AgentRunOptions): string[] {
  const devApp = containerName(o.project, "dev", "app");
  const devDb = containerName(o.project, "dev", "db");
  const proxy = `http://${egressContainer(o.project)}:${EGRESS_PORT}`;
  return [
    "run", "-d",
    "--name", agentContainer(o.project),
    "--label", `${C}.project=${o.project}`, "--label", `${C}.env=dev`, "--label", `${C}.role=agent`,
    "--network", networkName(o.project, "dev", "internal"),
    "--user", `${o.uid}:${o.gid}`,
    "--read-only",
    "--tmpfs", "/tmp:size=512m",
    "--tmpfs", `/home/agent:size=256m,uid=${o.uid},gid=${o.gid},mode=0700`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--memory", "2g", "--cpus", "2", "--pids-limit", "512",
    "--restart", "no",
    "-v", `${repoDir(o.project)}:/workspace`,
    ...(o.keyFile ? ["-v", `${o.keyFile}:${secretPath(AGENT_KEY)}:ro`] : []),
    "-w", "/workspace",
    "-e", `HTTPS_PROXY=${proxy}`, "-e", `https_proxy=${proxy}`,
    "-e", `HTTP_PROXY=${proxy}`, "-e", `http_proxy=${proxy}`,
    "-e", `NO_PROXY=${devApp},${devDb},localhost,127.0.0.1`, "-e", `no_proxy=${devApp},${devDb},localhost,127.0.0.1`,
    "-e", "GIT_AUTHOR_NAME=Claude Code (agent)", "-e", "GIT_AUTHOR_EMAIL=agent@localhost",
    "-e", "GIT_COMMITTER_NAME=Claude Code (agent)", "-e", "GIT_COMMITTER_EMAIL=agent@localhost",
    o.image,
  ];
}

/** The egress gate's `docker run` arguments: on the dev network and on its own that reaches out. */
export function egressRunArgs(project: string, script: string): string[] {
  return [
    "run", "-d",
    "--name", egressContainer(project),
    "--label", `${C}.project=${project}`, "--label", `${C}.env=dev`, "--label", `${C}.role=agent-egress`,
    "--network", egressNetwork(project),
    "--user", "node",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--memory", "64m", "--pids-limit", "64", "--restart", "no",
    "-e", `ALLOW=${MODEL_API_HOST}`,
    "-v", `${script}:/egress.mjs:ro`,
    EGRESS_IMAGE, "node", "/egress.mjs",
  ];
}

/* ---------------------------------------------------------- lifecycle -- */

export const agentState = (project: string): ContainerState => containerState(agentContainer(project));

/** The image, built on this host from the bundle's agent/ when it is not there yet. */
export function ensureAgentImage(): { tag: string; built: boolean } {
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  const tag = agentImageTag(uid, gid);
  if (tryDocker(["image", "inspect", tag]).code === 0) return { tag, built: false };
  docker(
    ["build", "-q", "-t", tag, "--build-arg", `AGENT_UID=${uid}`, "--build-arg", `AGENT_GID=${gid}`,
      "--label", `${C}.role=agent-image`, "--label", `${C}.claude-code=${CLAUDE_CODE_VERSION}`, agentDir()],
    { timeoutMs: 20 * 60_000 },
  );
  return { tag, built: true };
}

/** The egress gate, running, on the dev network and its own network out. */
export function ensureEgress(project: string): string {
  if (tryDocker(["network", "inspect", egressNetwork(project)]).code !== 0) {
    docker(["network", "create", "--label", `${C}.project=${project}`, "--label", `${C}.role=agent-egress`, egressNetwork(project)]);
  }
  const state = containerState(egressContainer(project));
  if (state.status === "running") return `${egressContainer(project)} already running`;
  tryDocker(["rm", "-f", egressContainer(project)]);
  docker(egressRunArgs(project, path.join(agentDir(), "egress.mjs")));
  docker(["network", "connect", networkName(project, "dev", "internal"), egressContainer(project)]);
  return `${egressContainer(project)} started: ${MODEL_API_HOST}, port 443, nothing else`;
}

/** The agent container, started afresh, with the key from the vault. */
export function startAgent(project: string, image: string): void {
  tryDocker(["rm", "-f", agentContainer(project)]);
  const names = unlockScope(project, "agent");
  const keyFile = names.includes(AGENT_KEY) ? runtimeFile(project, "agent", AGENT_KEY) : null;
  docker(agentRunArgs({ project, image, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0, keyFile }));
}

/** The agent and its egress gate gone; images are kept. Returns what was removed. */
export function stopAgent(project: string): string[] {
  const removed: string[] = [];
  for (const name of [agentContainer(project), egressContainer(project)]) {
    if (!containerState(name).exists) continue;
    docker(["rm", "-f", name]);
    removed.push(name);
  }
  if (tryDocker(["network", "inspect", egressNetwork(project)]).code === 0) {
    docker(["network", "rm", egressNetwork(project)]);
    removed.push(`network ${egressNetwork(project)}`);
  }
  return removed;
}

export const hasAgentKey = (project: string) => keyNames(project, "agent").includes(AGENT_KEY);
