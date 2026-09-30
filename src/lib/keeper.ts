/**
 * What Docker could not start, started again (D80).
 *
 * Docker's restart policy (`unless-stopped`) restarts a container that exits
 * after it has run. A container whose start fails, when Docker itself starts
 * at boot or at any other time, is left as it is, with the reason in its
 * state, and never tried again: at a boot where the panel's container could
 * not start, it stayed down until install ran again (the eighth brief, item
 * 1). The engine calls this again and again, so that whatever was late at a
 * boot (the machine's address, a disk, Docker itself) is only a delay.
 *
 * What it starts:
 *
 *   - the proxy, whenever it is not running: the suite's own, always on;
 *   - an app's containers (its test copy's and live app's, and their
 *     databases) only when Docker tried to start one and could not, which its
 *     state says: a container stopped on purpose has no such error, and stays
 *     stopped. Each app's under that app's lock (D72), never waiting for it: an
 *     operation that holds it (a release that replaces a container, say) is
 *     left alone, and the next round looks again;
 *   - never the agent's containers, which start when the person starts the AI.
 *
 * The panel and its door are `keepPanel`'s (panel.ts).
 */
import { NAMES } from "./brand.js";
import { tryDocker } from "./docker.js";
import { takeLock, type Taken } from "./lock.js";

export interface Seen {
  name: string;
  status: string;
  error: string;
  policy: string;
  role: string;
  project: string;
}

/** Every container on the machine, as the keeper needs to see it. */
export function seeAll(): Seen[] {
  const ids = tryDocker(["ps", "-aq"]).stdout.split("\n").filter(Boolean);
  if (!ids.length) return [];
  const found = tryDocker(["inspect", ...ids]);
  if (found.code !== 0) return [];
  return (JSON.parse(found.stdout) as Array<Record<string, any>>).map((c) => ({
    name: String(c.Name ?? "").replace(/^\//, ""),
    status: c.State?.Status ?? "unknown",
    error: c.State?.Error ?? "",
    policy: c.HostConfig?.RestartPolicy?.Name ?? "",
    role: c.Config?.Labels?.[`${NAMES.command}.role`] ?? "",
    project: c.Config?.Labels?.[`${NAMES.command}.project`] ?? "",
  }));
}

const APP_ROLES = new Set(["app", "db"]);
const DOWN = new Set(["created", "exited", "dead"]);

/** Which of them to start, and why: the rules above, and nothing else. */
export function toStart(seen: Seen[]): Array<Seen & { why: string }> {
  const out: Array<Seen & { why: string }> = [];
  for (const c of seen) {
    if (!DOWN.has(c.status)) continue;
    if (c.name === NAMES.proxyContainer) {
      out.push({ ...c, why: c.error ? `Docker could not start it: ${startError(c.error)}` : `it was ${c.status}` });
    } else if (APP_ROLES.has(c.role) && c.project && c.error && (c.policy === "unless-stopped" || c.policy === "always")) {
      out.push({ ...c, why: `Docker could not start it: ${startError(c.error)}` });
    }
  }
  return out;
}

/**
 * The part of Docker's error that says why, not the layers it went through:
 * "failed to create task for container: failed to create shim task: OCI
 * runtime create failed: ... error during container init: error setting
 * cgroup config ...: openat2 .../pids.max: no such file or directory" says
 * its reason after the last "container init: " or "OCI runtime create
 * failed: ", or is short enough as it is.
 */
export function startError(error: string): string {
  let reason = error.trim();
  for (const layer of ["container init: ", "unable to start container process: ", "OCI runtime create failed: ", "failed to create shim task: ", "failed to create task for container: "]) {
    const at = reason.lastIndexOf(layer);
    if (at >= 0) {
      reason = reason.slice(at + layer.length);
      break;
    }
  }
  return reason.length > 200 ? `${reason.slice(0, 197)}...` : reason;
}

/** One round: what was started, and what could not be, in plain lines for the engine's log. */
export function keepContainers(
  seen = seeAll(),
  lock: (app: string) => Taken = (app) => takeLock(app, "bring-back"),
  start: (c: Seen & { why: string }) => string = startContainer,
): string[] {
  const lines: string[] = [];
  const byApp = new Map<string, Array<Seen & { why: string }>>();
  for (const c of toStart(seen)) {
    if (!c.project) {
      lines.push(start(c));
      continue;
    }
    byApp.set(c.project, [...(byApp.get(c.project) ?? []), c]);
  }
  for (const [app, list] of byApp) {
    const taken = lock(app);
    if (!taken.ok) {
      lines.push(`${app}: ${list.map((c) => c.name).join(", ")} not started yet: ${taken.message}`);
      continue;
    }
    try {
      // Databases first, as compose starts them, so that an app's own check finds its database.
      for (const c of [...list].sort((a, b) => Number(b.role === "db") - Number(a.role === "db"))) lines.push(start(c));
    } finally {
      taken.release();
    }
  }
  return lines;
}

function startContainer(c: Seen & { why: string }): string {
  const ran = tryDocker(["start", c.name]);
  return ran.code === 0
    ? `${c.name} started again (${c.why})`
    : `${c.name} could not be started (${c.why}); now: ${startError(ran.stderr.replace(/^Error response from daemon: /, "").split("\n")[0] ?? "")}`;
}
