/** Docker, through its CLI. */
import { setTimeout as sleep } from "node:timers/promises";
import { run, tryRun, type Ran, type RunOptions } from "./run.js";

export const docker = (args: string[], options?: RunOptions): Ran => run("docker", args, options);
export const tryDocker = (args: string[], options?: RunOptions): Ran => tryRun("docker", args, options);

export interface ContainerState {
  exists: boolean;
  id: string;
  status: string;
  health: string;
  image: string;
  startedAt: string;
  restartCount: number;
  labels: Record<string, string>;
}

export function containerState(name: string): ContainerState {
  const result = tryDocker(["container", "inspect", name]);
  if (result.code !== 0) return { exists: false, id: "", status: "absent", health: "none", image: "", startedAt: "", restartCount: 0, labels: {} };
  const [c] = JSON.parse(result.stdout);
  return {
    exists: true,
    id: c.Id,
    status: c.State?.Status ?? "unknown",
    health: c.State?.Health?.Status ?? "none",
    image: c.Config?.Image ?? "",
    startedAt: c.State?.StartedAt ?? "",
    restartCount: c.RestartCount ?? 0,
    labels: c.Config?.Labels ?? {},
  };
}

/**
 * Wait until a container is running and, if it has a health check, healthy.
 * Returns early on a container that has exited, is unhealthy, or has been
 * restarted since the wait began: a crash loop is a failure, not a delay.
 */
export async function waitHealthy(name: string, timeoutMs = 120_000): Promise<ContainerState> {
  const deadline = Date.now() + timeoutMs;
  let state = containerState(name);
  const restartsBefore = state.restartCount;
  while (Date.now() < deadline) {
    state = containerState(name);
    if (state.status === "running" && (state.health === "healthy" || state.health === "none")) return state;
    if (state.status === "exited" || state.status === "dead" || state.status === "restarting" || state.health === "unhealthy") return state;
    if (state.restartCount > restartsBefore) return state;
    await sleep(1000);
  }
  return state;
}

export interface EngineInfo {
  server: string;
  compose: string;
  addressPools: string[];
  rootDir: string;
}

export function engineInfo(): EngineInfo | null {
  const info = tryDocker(["info", "--format", "{{json .}}"]);
  if (info.code !== 0) return null;
  const parsed = JSON.parse(info.stdout);
  const compose = tryDocker(["compose", "version", "--short"]);
  return {
    server: parsed.ServerVersion ?? "?",
    compose: compose.code === 0 ? compose.stdout.trim() : "",
    addressPools: (parsed.DefaultAddressPools ?? []).map((p: { Base: string; Size: number }) => p.Base),
    rootDir: parsed.DockerRootDir ?? "/var/lib/docker",
  };
}

/** `docker compose up -d` for a generated compose file. */
export function composeUp(project: string, file: string, extra: string[] = []): Ran {
  return docker(["compose", "-p", project, "-f", file, "up", "-d", "--remove-orphans", ...extra]);
}

export function composeDown(project: string, file: string, extra: string[] = []): Ran {
  return docker(["compose", "-p", project, "-f", file, "down", ...extra]);
}
