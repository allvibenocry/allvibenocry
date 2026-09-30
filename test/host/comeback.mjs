/**
 * Whether the suite came back after the test host started again (D80): what
 * `host.mjs restart` and `restart-probe.mjs` wait for, within a stated time.
 *
 *   - doctor all green (no warning, no problem), as the machine itself says;
 *     after `host.mjs restart`, nothing new since just before it (a problem
 *     the machine already had, such as an app with no backup yet, is named as
 *     already there, and a start does not have to mend it);
 *   - the suite's units active: the engine, the panel's name, the firewall,
 *     the key vault's boot unit, Docker, and both timers;
 *   - every container the suite runs running, and healthy where it has a
 *     health check: the proxy, the panel, its door, every app's and database's;
 *   - the panel answering on its name (`allvibe.local`, which a browser here
 *     maps to this workstation's loopback) and at the address (on the test
 *     host, `localhost` through the forwarded port; the machine's own address
 *     is doctor's "panel" check, from the machine).
 *
 * Signing in is the probe's: it needs the panel's password.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

/** The stated time: everything back within two minutes of the machine's start. */
export const COMEBACK_SECONDS = 120;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = readFileSync(path.join(ROOT, "brand.conf"), "utf8").match(/^COMMAND_NAME="?([^"\n]*)"?/m)[1];
const UNITS_ALL = ["docker.service", `${C}-engine.service`, `${C}-mdns.service`, `${C}-firewall.service`, `${C}-keys.service`, `${C}-backup.timer`, `${C}-firewall-check.timer`];
const ROLES = new Set(["proxy", "panel", "panel-door", "app", "db"]);

function onHost(name, args) {
  const r = spawnSync("docker", ["exec", name, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** GET /health through the forwarded port, with the Host a browser would send. */
function health(port, host) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/health", headers: { host }, timeout: 4000 }, (res) => {
      res.resume();
      res.on("end", () => resolve(String(res.statusCode)));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve(`no answer (${e.code ?? e.message})`));
    req.end();
  });
}

/** Doctor's warnings and problems now, by check and status (`problem:backup-hello`), with their words. */
export function doctorOff(name) {
  try {
    const checks = JSON.parse(onHost(name, [C, "doctor", "--json"]).out).checks ?? [];
    return new Map(checks.filter((c) => c.status !== "ok" && c.status !== "info").map((c) => [`${c.status}:${c.id}`, c.text]));
  } catch {
    return null;
  }
}

/**
 * One look: what is back, and what is not, each in a line. `notYet`: units
 * that have not had a boot to run at. `before`: doctor's warnings and problems
 * just before the machine stopped (doctorOff), which a start does not have to
 * mend: a warning or problem counts only when it is new.
 */
export async function look(name, panelPort, { notYet = [], before = null } = {}) {
  const UNITS = UNITS_ALL.filter((u) => !notYet.includes(u));
  const notBack = [];
  const back = [];

  const doctor = onHost(name, [C, "doctor", "--json"]);
  let checks = [];
  try {
    checks = JSON.parse(doctor.out).checks ?? [];
  } catch {
    notBack.push(`doctor: no answer (${(doctor.err || doctor.out).trim().split("\n").at(-1) ?? ""})`);
  }
  const off = checks.filter((c) => c.status !== "ok" && c.status !== "info");
  const already = off.filter((c) => before?.has(`${c.status}:${c.id}`));
  if (checks.length && !off.length) back.push("doctor all green");
  else if (checks.length && already.length === off.length) back.push(`doctor as before the restart, nothing new (already there: ${already.map((c) => c.text).join("; ")})`);
  for (const c of off.filter((o) => !already.includes(o))) notBack.push(`doctor ${c.status}: ${c.text}`);

  const units = onHost(name, ["systemctl", "is-active", ...UNITS]).out.trim().split("\n");
  const inactive = UNITS.filter((u, i) => units[i] !== "active");
  if (inactive.length) notBack.push(`units not active: ${inactive.map((u) => `${u} (${units[UNITS.indexOf(u)] ?? "?"})`).join(", ")}`);
  else back.push(`${UNITS.length} units active`);

  const listed = onHost(name, ["sh", "-c", `docker ps -aq | xargs -r docker inspect --format '{{.Name}}|{{index .Config.Labels "${C}.role"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.Error}}'`]);
  const containers = listed.out.trim().split("\n").filter(Boolean).map((l) => {
    const [cname, role, status, healthState, error] = l.split("|");
    return { name: cname.replace(/^\//, ""), role, status, health: healthState, error };
  }).filter((c) => ROLES.has(c.role));
  const down = containers.filter((c) => c.status !== "running" || (c.health && c.health !== "healthy"));
  if (!containers.some((c) => c.role === "panel")) notBack.push("the panel's container is not there");
  if (down.length) notBack.push(`containers: ${down.map((c) => `${c.name} ${c.status}${c.health ? `/${c.health}` : ""}${c.error ? ` (${c.error.slice(-90)})` : ""}`).join("; ")}`);
  else if (containers.length) back.push(`${containers.length} containers running (${[...ROLES].filter((r) => containers.some((c) => c.role === r)).join(", ")})`);

  const byName = await health(panelPort, `${C}.local`);
  const byAddress = await health(panelPort, "localhost");
  if (byName === "200" && byAddress === "200") back.push(`the panel answers at http://${C}.local/ and at the address`);
  else notBack.push(`the panel: by its name ${byName}, at the address ${byAddress}`);

  return { ok: notBack.length === 0, back, notBack };
}

/** When the test host's container last started, from Docker. */
export function startedAt(name) {
  const r = spawnSync("docker", ["inspect", "-f", "{{.State.StartedAt}}", name], { encoding: "utf8" });
  return Date.parse(r.stdout.trim());
}

/**
 * Looks every few seconds until everything is back or the stated time since
 * `since` (the machine's start, or the moment Docker was restarted) has passed.
 */
export async function waitForSuite(name, panelPort, { since = startedAt(name), seconds = COMEBACK_SECONDS, notYet = [], before = null } = {}) {
  // At least one look, even when the time is already up (the harness's restart may have waited it out).
  for (;;) {
    const last = await look(name, panelPort, { notYet, before });
    const seen = Math.round((Date.now() - since) / 1000);
    if (last.ok || Date.now() >= since + seconds * 1000) return { ...last, ok: last.ok && seen <= seconds, seconds: seen };
    await sleep(3000);
  }
}
