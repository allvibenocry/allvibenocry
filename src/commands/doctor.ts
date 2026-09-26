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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BRAND, INSTALL_ROOT, NAMES } from "../lib/brand.js";
import { readConfig } from "../lib/config.js";
import { containerState, engineInfo } from "../lib/docker.js";
import { isSupportedArch, isSupportedOs, memory, osInfo, systemDisk } from "../lib/hostfacts.js";
import { hostKeyOk, recoveryStatus } from "../lib/keys.js";
import { readOverrides } from "../lib/overrides.js";
import { tryRun } from "../lib/run.js";
import { lastRecord } from "../lib/steps.js";

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
        ? `No backup target is set, and there ${projects.length === 1 ? "is a project" : `are ${projects.length} projects`} to protect: allvibe backup-target set <path>`
        : "Backups: no projects yet, so nothing needs backing up. Connect a backup disk before creating one",
      "data",
    );
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

export function doctor(args: string[]): number {
  const list = checks();
  const installProblems = list.filter((c) => c.status === "problem" && c.scope === "install").length;
  const problems = list.filter((c) => c.status === "problem").length;
  const warnings = list.filter((c) => c.status === "warn").length;
  const summary = problems ? `${problems} problem(s)${warnings ? ` and ${warnings} warning(s)` : ""}` : warnings ? `${warnings} warning(s), no problems` : "All green.";

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
