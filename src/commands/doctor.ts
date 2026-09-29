/**
 * `allvibe doctor`: the state of this host, in plain language.
 *
 * Every line is one of: ✓ fine, ! a warning (works, but worth knowing), ✗ a
 * problem (something will fail), or i information. "All green" means no
 * warnings and no problems. `--json` gives the same for the web UI (rule 5).
 * Exit 1 when there is a problem.
 *
 * Every check has a scope: "install" (is the suite installed and running as it
 * should be) or "data" (is what the host holds protected: the backup target,
 * the recovery key, the last backup). `--for-install` exits 1 only for install
 * problems, so install.sh fails on a broken installation and not on a missing
 * backup disk, which doctor still reports.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { BRAND, INSTALL_ROOT, NAMES } from "../lib/brand.js";
import { checkTarget, humanBytes, listBackups } from "../lib/backup.js";
import { readConfig } from "../lib/config.js";
import { containerState, engineInfo, tryDocker } from "../lib/docker.js";
import { isSupportedArch, isSupportedOs, memory, osInfo, systemDisk } from "../lib/hostfacts.js";
import { hostKeyOk, recoveryStatus } from "../lib/keys.js";
import { readOverrides } from "../lib/overrides.js";
import { POWER_SUPPLY_DIR, powerCheck, readPower } from "../lib/power.js";
import { tryRun } from "../lib/run.js";
import { writeAtomic } from "../lib/files.js";
import { entries, lastRecord } from "../lib/steps.js";

export type Status = "ok" | "warn" | "problem" | "info";

export type Scope = "install" | "data";

export interface Check {
  id: string;
  status: Status;
  text: string;
  scope: Scope;
}

const SYMBOL: Record<Status, string> = { ok: "✓", warn: "!", problem: "✗", info: "i" };

export function suiteVersion(): string {
  const file = path.join(INSTALL_ROOT, "VERSION");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const pkg = JSON.parse(readFileSync(path.join(INSTALL_ROOT, "package.json"), "utf8"));
  return `${pkg.version}+dev`;
}

function projectNames(): string[] {
  try {
    return readdirSync(NAMES.projectsDir).filter((name) => existsSync(path.join(NAMES.projectsDir, name, "project.json")));
  } catch {
    return [];
  }
}

function uidOf(user: string): number | null {
  const result = tryRun("id", ["-u", user]);
  return result.code === 0 ? Number(result.stdout.trim()) : null;
}

/** Minutes after which the firewall's last check counts as not checked at all. */
const FIREWALL_STALE_MINUTES = 15;

/** What the firewall's own check last found (D41), in plain words, with its status. */
export function firewallCheck(now = new Date(), file = NAMES.firewallStatus): [Status, string] {
  let status: { checked?: string; ok?: boolean; repaired?: boolean; problems?: string[] } | null = null;
  try {
    status = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    status = null;
  }
  const restart = `as root: systemctl restart ${NAMES.firewallService}`;
  if (!status?.checked) {
    return ["problem", `The firewall that keeps project containers off this machine and the home network has not been checked since the machine started: run install.sh again, or ${restart}`];
  }
  const minutes = Math.floor((now.getTime() - new Date(status.checked).getTime()) / 60_000);
  if (!status.ok) {
    return ["problem", `The firewall that keeps project containers off this machine and the home network is NOT in place (${(status.problems ?? []).join("; ")}): ${restart}`];
  }
  if (minutes > FIREWALL_STALE_MINUTES) {
    return ["problem", `The firewall for project containers was last checked ${minutes} minutes ago; its check, ${NAMES.firewallTimer}, should run every five: ${restart}`];
  }
  return [
    "ok",
    `Firewall: project containers cannot reach this machine's own ports or the home network (checked ${minutes < 1 ? "less than a minute" : `${minutes} minute${minutes === 1 ? "" : "s"}`} ago)` +
      `${status.repaired ? `; it was not in place, and was put back` : ""}`,
  ];
}

/** A Docker network, as the IPv6 check sees it. */
export interface NetworkFacts {
  name: string;
  subnets: string[];
  ipv6: boolean;
}

const ipv4Number = (address: string) => address.split(".").reduce((n, part) => n * 256 + Number(part), 0);

/** Whether an IPv4 subnet (one of an app network's) lies inside a pool ("172.20.0.0/14"). IPv6 subnets never do. */
export function subnetInPool(subnet: string, pool: string): boolean {
  const [address, bits] = subnet.split("/");
  const [base, poolBits] = pool.split("/");
  if (!address?.includes(".") || !base?.includes(".") || Number(bits) < Number(poolBits)) return false;
  const block = 2 ** (32 - Number(poolBits));
  return Math.floor(ipv4Number(address) / block) === Math.floor(ipv4Number(base) / block);
}

/**
 * D41's firewall filters IPv4 only. That is enough while no network in the
 * suite's address pools has IPv6 on, and this says whether that still holds,
 * in plain words, so that the day it changes doctor says so.
 */
export function ipv6Check(networks: NetworkFacts[], pools: string[]): [Status, string] {
  if (!pools.length) return ["info", "IPv6: not checked, because Docker has no address pools set for the apps' networks"];
  const inPools = networks.filter((n) => n.subnets.some((subnet) => pools.some((pool) => subnetInPool(subnet, pool))));
  const on = inPools.filter((n) => n.ipv6).map((n) => n.name);
  if (on.length) {
    return [
      "problem",
      `IPv6 is on for ${on.join(", ")}. The firewall that keeps project containers off this machine and the home network covers IPv4 only, ` +
        `so over IPv6 they are not kept off. If /etc/docker/daemon.json turns IPv6 on ("ipv6", or an IPv6 default for new networks), take that out and restart Docker; ` +
        `then deploy the apps on ${on.length === 1 ? "that network" : "those networks"} again, or remove ${on.length === 1 ? "it" : "them"} if not an app's`,
    ];
  }
  return ["ok", `IPv6: off on all ${inPools.length} network${inPools.length === 1 ? "" : "s"} of the apps, so the firewall covers everything they can reach`];
}

/** Every Docker network's name, subnets and whether IPv6 is on; null when Docker cannot say. */
function dockerNetworks(): NetworkFacts[] | null {
  const ids = tryDocker(["network", "ls", "-q"]);
  if (ids.code !== 0) return null;
  const list = ids.stdout.split(/\s+/).filter(Boolean);
  if (!list.length) return [];
  const inspected = tryDocker(["network", "inspect", ...list]);
  if (inspected.code !== 0) return null;
  return (JSON.parse(inspected.stdout) as { Name: string; EnableIPv6?: boolean; IPAM?: { Config?: { Subnet?: string }[] | null } }[]).map((n) => ({
    name: n.Name,
    subnets: (n.IPAM?.Config ?? []).map((c) => c.Subnet ?? "").filter(Boolean),
    ipv6: n.EnableIPv6 === true,
  }));
}

export function checks(): Check[] {
  const list: Check[] = [];
  const add = (id: string, status: Status, text: string, scope: Scope = "install") => list.push({ id, status, text, scope });
  const overrides = readOverrides({ file: NAMES.overridesFile });

  /* The machine */
  const os = osInfo();
  add("os", isSupportedOs(os) ? "ok" : "problem", isSupportedOs(os) ? `${os.pretty} on x86-64` : `${os.pretty}: only Debian 13 is supported`);
  if (!isSupportedArch()) add("arch", "problem", `This is a ${process.arch} machine; only x86-64 is supported`);

  const mem = memory(overrides);
  const gb = (mem.mb / 1024).toFixed(mem.mb < 10 * 1024 ? 1 : 0);
  add(
    "memory",
    mem.low ? "warn" : "ok",
    mem.low
      ? `Memory: ${gb} GB. 8 GB or more is recommended: with less, running several apps may be slow${mem.declared ? " (declared by the test host)" : ""}`
      : `Memory: ${gb} GB${mem.declared ? " (declared by the test host)" : ""}`,
  );

  const disk = systemDisk(overrides);
  add(
    "disk",
    disk.kind === "rotational" ? "warn" : disk.kind === "ssd" ? "ok" : "info",
    disk.kind === "rotational"
      ? `System disk: a spinning hard disk. It works, but building and starting apps will be slow; an SSD is the best upgrade for an old computer${disk.declared ? " (declared by the test host)" : ""}`
      : disk.kind === "ssd"
        ? `System disk: SSD${disk.declared ? " (declared by the test host)" : ""}`
        : `System disk: its type could not be determined (${disk.device})`,
  );

  // Mains and battery (D59); a test host declares a stand-in for the kernel's files.
  const powerDir = overrides.active ? overrides.values.get("power-supply-dir") : undefined;
  const power = powerCheck(readPower(powerDir ?? POWER_SUPPLY_DIR));
  add("power", power.status, `${power.text}${powerDir ? " (declared by the test host)" : ""}`, "data");

  /* Docker */
  const engine = engineInfo();
  if (!engine) {
    add("docker", "problem", "Docker Engine is not running, or this user may not use it");
  } else {
    add("docker", engine.compose ? "ok" : "problem", `Docker Engine ${engine.server}${engine.compose ? ` with Compose ${engine.compose}` : ", but the Compose plugin is missing"}`);
    add(
      "pools",
      engine.addressPools.length ? "ok" : "warn",
      engine.addressPools.length
        ? `Docker gives app networks addresses from ${engine.addressPools.join(", ")}, away from your home network`
        : "Docker uses its default address pools, which can collide with a home network once there are many apps",
    );
    // D41 filters IPv4 only, accepted as long as no app network has IPv6.
    const networks = dockerNetworks();
    if (networks) add("ipv6", ...ipv6Check(networks, engine.addressPools));
    else add("ipv6", "problem", "IPv6: Docker's networks could not be read, so whether the firewall covers them is not known");
  }

  /* The installation */
  const uid = uidOf(NAMES.user);
  const groups = tryRun("id", ["-nG", NAMES.user]).stdout.split(/\s+/);
  add(
    "user",
    uid !== null && groups.includes("docker") ? "ok" : "problem",
    uid === null ? `The service user ${NAMES.user} does not exist` : groups.includes("docker") ? `Service user ${NAMES.user}, allowed to run Docker` : `The service user ${NAMES.user} may not use Docker`,
  );

  const wrong = [NAMES.etcDir, NAMES.stateDir].filter((dir) => {
    try {
      return statSync(dir).uid !== uid;
    } catch {
      return true;
    }
  });
  if (!existsSync(NAMES.installDir)) wrong.push(NAMES.installDir);
  add("dirs", wrong.length ? "problem" : "ok", wrong.length ? `Missing or wrongly owned: ${wrong.join(", ")}` : `Directories ${NAMES.installDir}, ${NAMES.etcDir}, ${NAMES.stateDir}`);
  add("version", "ok", `${BRAND.product} ${suiteVersion()} is installed`);

  const proxy = containerState(NAMES.proxyContainer);
  add(
    "proxy",
    proxy.status === "running" && proxy.health === "healthy" ? "ok" : "problem",
    proxy.exists ? `Reverse proxy: ${proxy.status === "running" && proxy.health === "healthy" ? "running and healthy" : `${proxy.status}, ${proxy.health}`}` : "Reverse proxy: not there",
  );

  /* Backups */
  const projects = projectNames();
  const config = readConfig();
  // D41: the rules that keep project containers off this machine and the home
  // network. doctor runs as the service user, which cannot read the firewall, so
  // it reads what the root-owned check (every five minutes) found.
  add("firewall", ...firewallCheck());

  // Without it, an app with keys would not start after the next reboot (D37).
  const keysEnabled = tryRun("systemctl", ["is-enabled", NAMES.keysService]).stdout.trim();
  const runDirOk = existsSync(NAMES.runDir);
  add(
    "keys-at-boot",
    keysEnabled === "enabled" && runDirOk ? "ok" : "problem",
    keysEnabled === "enabled" && runDirOk
      ? `Key vault: its keys go back into memory at every boot, before the apps start (${NAMES.runDir})`
      : `The key vault's boot unit is ${keysEnabled || "missing"}${runDirOk ? "" : `, and ${NAMES.runDir} does not exist`}: run install.sh again`,
  );

  // The engine the control panel calls (D62): a service on a socket only.
  const engineActive = tryRun("systemctl", ["is-active", NAMES.engineService]).stdout.trim();
  const engineSocket = existsSync(NAMES.engineSocket);
  add(
    "engine",
    engineActive === "active" && engineSocket ? "ok" : "problem",
    engineActive === "active" && engineSocket
      ? `Engine: running, for the control panel, on its socket only (${NAMES.engineSocket})`
      : `The engine the control panel calls is ${engineActive || "missing"}${engineSocket ? "" : ", and its socket is not there"}: run install.sh again`,
  );

  const enabled = tryRun("systemctl", ["is-enabled", NAMES.backupTimer]).stdout.trim();
  const active = tryRun("systemctl", ["is-active", NAMES.backupTimer]).stdout.trim();
  const next = tryRun("systemctl", ["show", NAMES.backupTimer, "-p", "NextElapseUSecRealtime", "--value"]).stdout.trim();
  const lastRun = lastRecord("scheduled-backup");
  const lastText = lastRun ? `last run ${lastRun.started.slice(0, 16).replace("T", " ")} UTC ${lastRun.ok ? "succeeded" : `FAILED at "${lastRun.failedStep}"`}` : "no run yet";
  const timerOk = enabled === "enabled" && active === "active";
  add(
    "timer",
    !timerOk ? "problem" : lastRun && !lastRun.ok ? "problem" : "ok",
    timerOk ? `Daily backup and restore test: scheduled${next ? `, next ${next}` : ""}; ${lastText}` : `The daily backup timer is ${enabled}/${active}`,
    timerOk ? "data" : "install",
  );

  if (!config.backupTarget) {
    add(
      "target",
      projects.length ? "problem" : "ok",
      projects.length
        ? `No backup target is set, and there ${projects.length === 1 ? "is a project" : `are ${projects.length} projects`} to protect: ${NAMES.command} backup-target set <path>`
        : "Backups: no projects yet, so nothing needs backing up. Connect a backup disk before creating one",
      "data",
    );
  } else {
    const target = checkTarget(config.backupTarget);
    add(
      "target",
      target.ok ? "ok" : "problem",
      target.ok
        ? `Backup target ${config.backupTarget}: ${target.why}; ${humanBytes(target.freeBytes ?? 0)} free`
        : `Backup target ${config.backupTarget}: ${target.why}. Backups and releases will fail until ${target.fix ?? "it is fixed"}`,
      "data",
    );
  }

  /* Each project: its newest backup, and whether the last restore check passed. */
  const targetUsable = config.backupTarget ? checkTarget(config.backupTarget).ok : false;
  for (const name of projects) {
    if (config.backupTarget && !targetUsable) {
      add(`backup-${name}`, "problem", `${name}: its backups cannot be checked while the backup target is unusable (above)`, "data");
      continue;
    }
    const latest = config.backupTarget ? listBackups(config, name).at(-1) : undefined;
    const check = lastRecord("restore-check", name);
    const hours = latest ? (Date.now() - new Date(latest.manifest.created).getTime()) / 3_600_000 : Infinity;
    const age = !latest ? "" : hours < 1 ? "less than an hour ago" : hours < 48 ? `${Math.round(hours)} hours ago` : `${Math.round(hours / 24)} days ago`;
    if (!latest) {
      add(`backup-${name}`, "problem", `${name}: no backup yet. ${NAMES.command} backup ${name}`, "data");
    } else if (!check || !check.ok) {
      add(
        `backup-${name}`,
        "problem",
        `${name}: last backup ${age}, but ${check ? `its last restore check FAILED at "${check.failedStep}"` : "no backup has been restore-checked yet"}: ${NAMES.command} restore-check ${name}`,
        "data",
      );
    } else {
      add(
        `backup-${name}`,
        hours > 36 ? "warn" : "ok",
        `${name}: last backup ${age}; last restore check ${check.started.slice(0, 16).replace("T", " ")} UTC passed${check.facts.entries !== undefined && check.facts.entries !== null ? ` (${entries(check.facts.entries as number)})` : ""}`,
        "data",
      );
    }
  }

  add("hostkey", hostKeyOk() ? "ok" : "problem", hostKeyOk() ? "The backup key for restore tests is in place" : `The backup key ${NAMES.hostKey} is missing or damaged`);

  const recovery = recoveryStatus();
  if (recovery.state === "missing") {
    add("recovery", "problem", "There is no recovery key for the backups", "data");
  } else if (recovery.state === "pending") {
    add(
      "recovery",
      projects.length ? "problem" : "ok",
      `Recovery key: created, not yet confirmed. Copy ${NAMES.recoveryPending} off this machine, then confirm it: ${NAMES.command} recovery-key confirm < your-copy${projects.length ? ". Releases are refused until then" : ""}`,
      "data",
    );
  } else if (recovery.state === "overdue") {
    add("recovery", "warn", `Recovery key: last confirmed ${recovery.confirmedAt?.slice(0, 10)}. Show it again to prove you still have it: ${NAMES.command} recovery-key confirm < your-copy`, "data");
  } else {
    add("recovery", recovery.pendingOnMachine ? "warn" : "ok", `Recovery key: confirmed ${recovery.confirmedAt?.slice(0, 10)}${recovery.pendingOnMachine ? `, but a copy is still in ${NAMES.recoveryPending}` : ""}`, "data");
  }

  if (overrides.active) {
    add("overrides", "info", `Test host: overrides active (${[...overrides.values].map(([k, v]) => `${k}=${v}`).join(", ")})`);
    if (overrides.unknown.length) add("overrides-unknown", "warn", `Unknown test overrides, ignored: ${overrides.unknown.join(", ")}`);
  } else if (overrides.ignored) {
    add("overrides", "warn", overrides.ignored);
  }

  return list;
}

/* ------------------------------------------------------- every night -- */

/** How many nightly results are kept besides the latest (D58). */
export const NIGHTLY_KEEP = 14;

export interface NightlyResult {
  at: string;
  version: string;
  summary: string;
  problems: number;
  warnings: number;
  checks: Check[];
}

export function summarise(list: Check[]): { problems: number; warnings: number; summary: string } {
  const problems = list.filter((c) => c.status === "problem").length;
  const warnings = list.filter((c) => c.status === "warn").length;
  const summary = problems ? `${problems} problem(s)${warnings ? ` and ${warnings} warning(s)` : ""}` : warnings ? `${warnings} warning(s), no problems` : "All green.";
  return { problems, warnings, summary };
}

export const nightlyResult = (list: Check[], now: Date, version: string): NightlyResult => ({ at: now.toISOString(), version, ...summarise(list), checks: list });

/**
 * Keeps a nightly result where the panel can read it (D58): `latest.json`, and
 * the same under its time, of which the newest NIGHTLY_KEEP are kept.
 */
export function saveNightly(result: NightlyResult, dir = NAMES.doctorDir, keep = NIGHTLY_KEEP): string {
  mkdirSync(dir, { recursive: true });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  const stamped = `${result.at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.json`;
  writeAtomic(path.join(dir, stamped), text);
  writeAtomic(path.join(dir, "latest.json"), text);
  const history = readdirSync(dir).filter((f) => /^\d{8}T\d{6}Z\.json$/.test(f)).sort();
  for (const old of history.slice(0, Math.max(0, history.length - keep))) rmSync(path.join(dir, old));
  return path.join(dir, stamped);
}

export function readNightly(dir = NAMES.doctorDir): NightlyResult | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "latest.json"), "utf8")) as NightlyResult;
  } catch {
    return null;
  }
}

/** doctor's checks, run by the nightly backup and kept (D58). Returns what was kept. */
export function nightlyDoctor(now = new Date()): NightlyResult {
  const result = nightlyResult(checks(), now, suiteVersion());
  saveNightly(result);
  return result;
}

export function doctor(args: string[]): number {
  if (args.includes("--last")) {
    const last = readNightly();
    if (!last) {
      process.stdout.write(`doctor has not run with the nightly backup yet. It runs every night at 03:30, with the backup.\n`);
      return 0;
    }
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(last, null, 2)}\n`);
      return last.problems ? 1 : 0;
    }
    process.stdout.write(`${BRAND.product} on this machine, as the nightly check found it at ${last.at.slice(0, 16).replace("T", " ")} UTC\n\n`);
    for (const check of last.checks) process.stdout.write(`  ${SYMBOL[check.status]} ${check.text}\n`);
    process.stdout.write(`\n${last.summary}\n`);
    return last.problems ? 1 : 0;
  }
  const list = checks();
  const installProblems = list.filter((c) => c.status === "problem" && c.scope === "install").length;
  const { problems, warnings, summary } = summarise(list);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ checks: list, problems, warnings, summary }, null, 2)}\n`);
  } else {
    process.stdout.write(`${BRAND.product} on this machine\n\n`);
    for (const check of list) process.stdout.write(`  ${SYMBOL[check.status]} ${check.text}\n`);
    process.stdout.write(`\n${summary}\n`);
  }
  if (args.includes("--for-install")) return installProblems ? 1 : 0;
  return problems ? 1 : 0;
}
