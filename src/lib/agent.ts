/**
 * The agent container (D39): the official, unmodified Claude Code, at a pinned
 * version, working in a project's dev and nowhere else.
 *
 * - **Network**: only the project's dev network, where its dev app and dev
 *   database are. That network has no route out; the one way out is the
 *   egress gate beside it, which passes HTTPS to the hosts of its sign-in and
 *   nothing else (agent/egress.mjs).
 * - **Files**: only the project's working copy, and, when it signs in with a
 *   key, its own AI key from the vault's agent scope, as a single read-only
 *   file (D37). Its home and /tmp are in memory, so a login made in it is
 *   gone with the container (D46).
 * - **Never** (rule 12): the Docker socket, the host's network, privileged
 *   mode, the host key, the recovery key, the backup target, or anything of
 *   prod's. It runs as the service user's uid, not root, with no capabilities,
 *   a read-only root filesystem and limits on memory, CPU and processes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { posix as path } from "node:path";
import { INSTALL_ROOT, NAMES } from "./brand.js";
import { containerState, docker, tryDocker, type ContainerState } from "./docker.js";
import { scannerPath } from "./keycheck.js";
import { networkName, containerName, projectDir, repoDir } from "./project.js";
import { keyNames, runtimeFile, secretPath, unlockScope } from "./vault.js";

const C = NAMES.command;

/** Claude Code's version, as agent/package.json pins it. */
export const CLAUDE_CODE_VERSION = "2.1.283";
/**
 * The agent's permission mode, which agent/entrypoint.sh sets explicitly
 * (D47), and the Claude Code version it was last reviewed for. A unit test
 * fails when that is not the pinned version: a new version means reading its
 * permission modes again first.
 */
export const PERMISSION_MODE = "auto";
export const PERMISSION_MODE_REVIEWED_WITH = "2.1.283";
/** The model's API: with a key, the only host the agent reaches outside its dev network. */
export const MODEL_API_HOST = "api.anthropic.com";
/**
 * How Claude Code in the agent signs in: with the person's own API key from the
 * vault (D39), or with the person's own Claude account, through Claude Code's
 * own sign-in, done by the person in the agent's shell (D46).
 */
export type SignIn = "key" | "account";
export const SIGN_INS: readonly SignIn[] = ["key", "account"];
/**
 * The hosts the egress gate passes, for each way of signing in. With an
 * account, the model's API and the two hosts Claude Code's own documentation
 * lists for signing in to a Claude account from the CLI ("Network access
 * requirements", https://code.claude.com/docs/en/network-config, read
 * 2026-09-28): claude.ai for the account's authentication, and
 * platform.claude.com for the token exchange, refresh and revocation. Nothing
 * else on that list is let through (D46 says why, host by host).
 */
export const ALLOWED_HOSTS: Readonly<Record<SignIn, readonly string[]>> = {
  key: [MODEL_API_HOST],
  account: [MODEL_API_HOST, "claude.ai", "platform.claude.com"],
};
/** The vault's name for the agent's key, in the agent scope (D37). */
export const AGENT_KEY = "ANTHROPIC_API_KEY";
/** The egress gate runs on the same pinned Node image as the template (D27). */
export const EGRESS_IMAGE = "node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1";
export const EGRESS_PORT = 3128;
/** The activity logger beside the agent (D60). */
export const ACTIVITY_PORT = 3129;

export const agentContainer = (project: string) => `${C}-${project}-agent`;
export const egressContainer = (project: string) => `${C}-${project}-agent-egress`;
export const egressNetwork = (project: string) => `${C}-${project}-agent-egress`;
export const activityContainer = (project: string) => `${C}-${project}-agent-activity`;
/**
 * What the agent leaves on the machine on purpose (D60), outside the working
 * copy: its conversations' transcripts and its activity log. Only the service
 * user can read them. Not in the backups; `agent transcripts --delete`
 * deletes the transcripts, and `project remove` deletes both.
 */
export const agentDataDir = (project: string) => path.join(projectDir(project).split("\\").join("/"), "agent");
export const transcriptsDir = (project: string) => path.join(agentDataDir(project), "transcripts");
export const activityDir = (project: string) => path.join(agentDataDir(project), "log");
export const activityLog = (project: string) => path.join(activityDir(project), "activity.jsonl");
const agentDir = () => path.join(INSTALL_ROOT.split("\\").join("/"), "agent");

/** The files the image is built from: they, the version and the uid name it, so a change is a new image. */
export function agentImageTag(uid: number, gid: number, dir = agentDir()): string {
  const hash = createHash("sha256");
  for (const file of ["Dockerfile", "entrypoint.sh", "package.json", "package-lock.json", "activity-hook.mjs", "managed-settings.json"]) hash.update(readFileSync(path.join(dir, file)));
  hash.update(`${uid}:${gid}`);
  return `${C}-agent:${CLAUDE_CODE_VERSION}-${hash.digest("hex").slice(0, 12)}`;
}

export interface AgentRunOptions {
  project: string;
  image: string;
  uid: number;
  gid: number;
  /** The decrypted key's file in memory, or null when the vault has none. Always null with an account. */
  keyFile: string | null;
  /** How it signs in; a key when not said. */
  signIn?: SignIn;
}

/**
 * The agent's `docker run` arguments, and nothing else: every mount, network,
 * user and limit it gets is here, so a test can check that none of rule 12's is.
 */
export function agentRunArgs(o: AgentRunOptions): string[] {
  const signIn = o.signIn ?? "key";
  if (signIn === "account" && o.keyFile) throw new Error("an agent signed in with an account gets no key file (D46)");
  const devApp = containerName(o.project, "dev", "app");
  const devDb = containerName(o.project, "dev", "db");
  const proxy = `http://${egressContainer(o.project)}:${EGRESS_PORT}`;
  return [
    "run", "-d",
    "--name", agentContainer(o.project),
    "--label", `${C}.project=${o.project}`, "--label", `${C}.env=dev`, "--label", `${C}.role=agent`,
    "--label", `${C}.sign-in=${signIn}`,
    "--network", networkName(o.project, "dev", "internal"),
    "--user", `${o.uid}:${o.gid}`,
    "--read-only",
    "--tmpfs", "/tmp:size=512m",
    // Its home, where Claude Code keeps its settings and, with an account, its
    // login: in memory, and gone with the container (D46).
    "--tmpfs", `/home/agent:size=256m,uid=${o.uid},gid=${o.gid},mode=0700`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    // No swap: what it holds in memory, its home included, is never written
    // out to the machine's swap (D46). Docker has no tmpfs option for that;
    // a swap limit of nothing does it for the whole container.
    "--memory", "2g", "--memory-swap", "2g", "--cpus", "2", "--pids-limit", "512",
    "--restart", "no",
    "-v", `${repoDir(o.project)}:/workspace`,
    // Only the directory Claude Code writes its transcripts to, never its
    // login or settings (D60); the entrypoint links it into the home.
    "-v", `${transcriptsDir(o.project)}:/agent-transcripts`,
    ...(o.keyFile ? ["-v", `${o.keyFile}:${secretPath(AGENT_KEY)}:ro`] : []),
    "-w", "/workspace",
    "-e", `AGENT_SIGN_IN=${signIn}`,
    "-e", `AGENT_ACTIVITY_URL=http://${activityContainer(o.project)}:${ACTIVITY_PORT}/log`,
    "-e", `HTTPS_PROXY=${proxy}`, "-e", `https_proxy=${proxy}`,
    "-e", `HTTP_PROXY=${proxy}`, "-e", `http_proxy=${proxy}`,
    "-e", `NO_PROXY=${devApp},${devDb},${activityContainer(o.project)},localhost,127.0.0.1`,
    "-e", `no_proxy=${devApp},${devDb},${activityContainer(o.project)},localhost,127.0.0.1`,
    "-e", "GIT_AUTHOR_NAME=Claude Code (agent)", "-e", "GIT_AUTHOR_EMAIL=agent@localhost",
    "-e", "GIT_COMMITTER_NAME=Claude Code (agent)", "-e", "GIT_COMMITTER_EMAIL=agent@localhost",
    o.image,
  ];
}

/** The egress gate's `docker run` arguments: on the dev network and on its own that reaches out. */
export function egressRunArgs(project: string, script: string, signIn: SignIn = "key"): string[] {
  return [
    "run", "-d",
    "--name", egressContainer(project),
    "--label", `${C}.project=${project}`, "--label", `${C}.env=dev`, "--label", `${C}.role=agent-egress`,
    "--label", `${C}.sign-in=${signIn}`,
    "--network", egressNetwork(project),
    "--user", "node",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--memory", "64m", "--pids-limit", "64", "--restart", "no",
    "-e", `ALLOW=${ALLOWED_HOSTS[signIn].join(",")}`,
    "-v", `${script}:/egress.mjs:ro`,
    EGRESS_IMAGE, "node", "/egress.mjs",
  ];
}

/**
 * The activity logger's `docker run` arguments (D60): on dev's internal
 * network only, as the service user, so that it can write the log, which is
 * mounted into it and into nothing else; the key check's scanner read-only.
 */
export function activityRunArgs(project: string, script: string, uid: number, gid: number, scanner: string): string[] {
  return [
    "run", "-d",
    "--name", activityContainer(project),
    "--label", `${C}.project=${project}`, "--label", `${C}.env=dev`, "--label", `${C}.role=agent-activity`,
    "--network", networkName(project, "dev", "internal"),
    "--user", `${uid}:${gid}`,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--memory", "64m", "--pids-limit", "64", "--restart", "no",
    "-e", `AGENT_HOST=${agentContainer(project)}`,
    "-v", `${script}:/activity.mjs:ro`,
    "-v", `${scanner}:/usr/local/bin/gitleaks:ro`,
    "-v", `${activityDir(project)}:/log`,
    EGRESS_IMAGE, "node", "/activity.mjs",
  ];
}

/* ---------------------------------------------------------- lifecycle -- */

export const agentState = (project: string): ContainerState => containerState(agentContainer(project));

/** How a running agent or gate signs in, from its label; null when there is no such container. */
export function signInOf(container: string): SignIn | null {
  const r = tryDocker(["inspect", "-f", `{{index .Config.Labels "${C}.sign-in"}}`, container]);
  if (r.code !== 0) return null;
  // One started before D46 has no label: it signed in with a key.
  return r.stdout.trim() === "account" ? "account" : "key";
}

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

/** The egress gate, running, on the dev network and its own network out, with the hosts of this sign-in. */
export function ensureEgress(project: string, signIn: SignIn = "key"): string {
  if (tryDocker(["network", "inspect", egressNetwork(project)]).code !== 0) {
    docker(["network", "create", "--label", `${C}.project=${project}`, "--label", `${C}.role=agent-egress`, egressNetwork(project)]);
  }
  const hosts = `${ALLOWED_HOSTS[signIn].join(", ")}, port 443, nothing else`;
  const state = containerState(egressContainer(project));
  if (state.status === "running" && signInOf(egressContainer(project)) === signIn) return `${egressContainer(project)} already running: ${hosts}`;
  tryDocker(["rm", "-f", egressContainer(project)]);
  docker(egressRunArgs(project, path.join(agentDir(), "egress.mjs"), signIn));
  docker(["network", "connect", networkName(project, "dev", "internal"), egressContainer(project)]);
  return `${egressContainer(project)} started: ${hosts}`;
}

/** The agent's transcripts and activity log directories, only the service user's (D60). */
export function ensureAgentData(project: string): void {
  for (const dir of [transcriptsDir(project), activityDir(project)]) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** The activity logger, started afresh beside the agent. */
export function ensureActivity(project: string): string {
  ensureAgentData(project);
  tryDocker(["rm", "-f", activityContainer(project)]);
  docker(activityRunArgs(project, path.join(agentDir(), "activity.mjs"), process.getuid?.() ?? 0, process.getgid?.() ?? 0, scannerPath()));
  return `${activityContainer(project)} started: one line per tool call, to ${activityLog(project)}`;
}

/**
 * The agent container, started afresh: with a key, the key from the vault;
 * with an account, nothing from the vault at all, for the person signs in
 * themselves (D46).
 */
export function startAgent(project: string, image: string, signIn: SignIn = "key"): void {
  tryDocker(["rm", "-f", agentContainer(project)]);
  let keyFile: string | null = null;
  if (signIn === "key") {
    const names = unlockScope(project, "agent");
    keyFile = names.includes(AGENT_KEY) ? runtimeFile(project, "agent", AGENT_KEY) : null;
  }
  docker(agentRunArgs({ project, image, uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0, keyFile, signIn }));
}

/** The agent and its egress gate gone; images are kept. Returns what was removed. */
export function stopAgent(project: string): string[] {
  const removed: string[] = [];
  for (const name of [agentContainer(project), egressContainer(project), activityContainer(project)]) {
    if (!containerState(name).exists) continue;
    // The activity logger writes what it is still gathering when it is stopped (D60).
    if (name === activityContainer(project)) tryDocker(["stop", "--time", "5", name]);
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
