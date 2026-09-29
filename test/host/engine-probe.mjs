#!/usr/bin/env node
// The engine the control panel calls (D62), probed on the test host, as root,
// after install:
//
//   node engine-probe.mjs <command>
//
// It makes a project of its own, "enginecheck", with stand-in keys and a plan
// of two built steps, and then:
//
//   - who can reach the engine: only its socket, for the service user and the
//     panel's group (not another user of the machine, not a project's
//     container), and no network port at all;
//   - an unknown operation and malformed arguments are refused;
//   - every operation, once: the machine, the apps, the plan, marking a step
//     tried, "Something is wrong", backups, starting the test copy, putting a
//     version live and going back, the jobs, and signing in;
//   - putting a version live with untried steps is refused exactly as the CLI
//     refuses it, word for word, and nothing after that step runs;
//   - no answer holds a secret value: the vault's stand-in values, the
//     databases' passwords, the host key, the panel's password and setup code,
//     or their hashes (the scan is first seen finding one planted on purpose).
//
// The panel's sign-in file is put back as it was, and the project removed.
// The last line counts what is not as it must be.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";

const C = process.argv[2] ?? "allvibe";
const P = "enginecheck";
const STATE = `/var/lib/${C}`;
const SOCK = `${STATE}/engine/engine.sock`;
const AUTH = `${STATE}/panel/auth.json`;
const REPO = `${STATE}/projects/${P}/repo`;
let total = 0;
let wrong = 0;
const answers = [];
// This run's only: an earlier run's project of the same name left its backups (mistake 28).
const SINCE = new Date().toISOString();

const verdict = (label, seen, want) => {
  total += 1;
  const good = typeof want === "function" ? want(seen) : String(seen) === String(want);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(66)} ${String(seen).slice(0, 40).padEnd(40)} ${good ? "as it must be" : "WRONG"}`);
};
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const cli = (...args) => sh(C, args);

/** The engine, as the panel asks it: one JSON line out, one back (D76). */
function ask(op, args = {}, socket = SOCK) {
  return new Promise((resolve) => {
    const client = net.createConnection(socket);
    let data = "";
    client.setEncoding("utf8");
    client.on("connect", () => client.write(`${JSON.stringify({ op, args })}\n`));
    client.on("data", (c) => (data += c));
    client.on("end", () => {
      answers.push(data);
      resolve(JSON.parse(data.split("\n")[0]));
    });
    client.on("error", (error) => resolve({ ok: false, error: { code: error.code } }));
  });
}

async function until(job) {
  if (!job) return null;
  for (let i = 0; i < 900; i++) {
    const answer = await ask("job.get", { job });
    if (!answer.ok) return null;
    if (answer.result.state === "finished") return answer.result;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/* --------------------------------------------------------------- setup -- */
const savedAuth = existsSync(AUTH) ? readFileSync(AUTH) : null;
const mem = `/dev/shm/engine-probe-${process.pid}`;
sh("mkdir", ["-m", "700", mem]);
const values = { dev: randomBytes(24).toString("base64"), prod: randomBytes(24).toString("base64") };
for (const env of ["dev", "prod"]) writeFileSync(`${mem}/${env}`, values[env], { mode: 0o600 });
const password = `probe ${randomBytes(12).toString("base64")}`;

console.log(`the project ${P}, with stand-in keys and a plan of two built steps:`);
if (!existsSync(`${STATE}/projects/${P}`)) {
  const made = cli("project", "create", P);
  if (made.status !== 0) { console.log(made.stdout.slice(-800), made.stderr); process.exit(2); }
}
for (const env of ["dev", "prod"]) sh(C, ["key", "set", P, env, "PROBE_KEY"], { input: values[env] });
// A stand-in for the agent's key, so that it can start: it never talks to a model here.
sh(C, ["key", "set", P, "agent", "ANTHROPIC_API_KEY"], { input: randomBytes(24).toString("base64") });
const plan = {
  title: "The engine's probe",
  steps: [
    { id: 1, title: "A first step", check: "Open the test copy: it answers.", built: true },
    { id: 2, title: "A second step", check: "Open it again: it still answers.", built: true },
  ],
};
sh("runuser", ["-u", C, "--", "tee", `${REPO}/plan.json`], { input: `${JSON.stringify(plan, null, 2)}\n` });
cli("dev", "commit", P, "The engine's probe: a plan");
const deployed = cli("dev", "deploy", P);
verdict("the test copy runs the plan's commit", deployed.status, 0);

/* ------------------------------------------------------ who can reach it -- */
console.log("who can reach the engine:");
const dir = existsSync(`${STATE}/engine`) ? statSync(`${STATE}/engine`) : null;
const sock = existsSync(SOCK) ? statSync(SOCK) : null;
const owner = (s) => (s ? `${sh("id", ["-nu", String(s.uid)]).stdout.trim()}:${sh("getent", ["group", String(s.gid)]).stdout.split(":")[0]} ${(s.mode & 0o7777).toString(8)}` : "absent");
verdict("its folder", owner(dir), `${C}:${C}-panel 2750`);
verdict("its socket", owner(sock), `${C}:${C}-panel 660`);
const pid = sh("systemctl", ["show", "-p", "MainPID", "--value", `${C}-engine`]).stdout.trim();
const tcp = sh("ss", ["-ltnupH"]).stdout.split("\n").filter((l) => l.includes(`pid=${pid},`)).length;
const unix = sh("ss", ["-lxpH"]).stdout.split("\n").filter((l) => l.includes(`pid=${pid},`) && l.includes(SOCK)).length;
verdict("its socket, listened on by the engine's process (a control)", unix, 1);
verdict("network ports the engine's process listens on", tcp, 0);
const other = sh("runuser", ["-u", "nobody", "--", "node", "-e", `require("net").connect(${JSON.stringify(SOCK)}).on("connect",()=>{console.log("CONNECTED");process.exit(0)}).on("error",e=>{console.log(e.code);process.exit(0)})`]);
verdict("another user of the machine, opening the socket", other.stdout.trim(), "EACCES");
const asService = sh("runuser", ["-u", C, "--", "node", "-e", `require("net").connect(${JSON.stringify(SOCK)}).on("connect",()=>{console.log("CONNECTED");process.exit(0)}).on("error",e=>{console.log(e.code);process.exit(0)})`]);
verdict("the service user, opening the socket (a control)", asService.stdout.trim(), "CONNECTED");
const inDev = sh("docker", ["exec", `${C}-${P}-dev-app`, "sh", "-c", `[ -e ${STATE}/engine ] && echo present || echo absent`]);
verdict("the engine's folder, inside the test copy's container", inDev.stdout.trim(), "absent");
const inProd = sh("docker", ["exec", `${C}-${P}-prod-app`, "sh", "-c", `[ -e ${STATE}/engine ] && echo present || echo absent`]);
verdict("the engine's folder, inside the live app's container", inProd.stdout.trim(), "absent");

/* ------------------------------------------------------------ refusals -- */
console.log("refusals:");
for (const op of ["shell", "exec", "app.remove", "constructor", "__proto__"]) {
  const a = await ask(op, {});
  verdict(`an unknown operation, ${op}`, a.error?.code, "unknown_operation");
}
for (const [op, args] of [
  ["app.get", { app: "../../etc" }],
  ["app.get", { app: P, command: "id" }],
  ["app.markTried", { app: P, step: "1; rm -rf /" }],
  ["app.report", { app: P, text: "\u0000" }],
  ["app.putLive", { app: P, outsidePlan: "no reason" }],
  ["app.goBack", { app: P, restoreData: true }],
  ["job.get", { job: "../../../etc/shadow" }],
]) {
  const a = await ask(op, args);
  verdict(`malformed: ${op} ${JSON.stringify(args).slice(0, 30)}`, a.error?.code, "bad_arguments");
}
const missing = await ask("app.get", { app: "nosuchproject" });
verdict("a project that does not exist", missing.error?.code, "not_found");

/* ------------------------------------------------------ every operation -- */
console.log("every operation:");
const status = await ask("machine.status");
verdict("machine.status: doctor's checks", status.ok && status.result.checks.length > 5 && status.result.checks.some((c) => c.id === "engine" && c.status === "ok"), true);
// The panel's check asks the panel, which asks the engine: it must not wait for itself.
if (existsSync(AUTH)) verdict("machine.status: the panel's check, asked from inside the engine", status.result?.checks.find((c) => c.id === "panel")?.status, "ok");
const last = await ask("machine.lastNight");
verdict("machine.lastNight", last.ok, true);
const apps = await ask("apps.list");
const mine = apps.ok ? apps.result.find((a) => a.name === P) : null;
verdict("apps.list: the project, its next thing to do", mine ? `${mine.next.kind} ${mine.next.step}` : "absent", "try 1");
const app = await ask("app.get", { app: P });
verdict("app.get: its live version", app.ok ? app.result.live : "?", "v1");
const planned = await ask("app.plan", { app: P });
verdict("app.plan: its steps", planned.ok ? planned.result.steps.map((s) => s.state).join(",") : "?", "ready,ready");

const cliRefusal = cli("release", P);
const refusedLines = cliRefusal.stdout.split("\n");
const failAt = refusedLines.findIndex((l) => l.startsWith("FAIL "));
const cliStep = refusedLines[failAt] ?? "";
const cliLines = refusedLines.slice(failAt + 1).filter((l) => /^ {5,}\S/.test(l)).map((l) => l.trim());
verdict("the CLI, releasing with untried steps", cliStep, (s) => s.startsWith("FAIL 2/16 every step of the plan is tried"));
const refused = await until((await ask("app.putLive", { app: P })).result?.job);
const [phase] = refused?.phases ?? [{ steps: [] }];
const step2 = phase.steps.find((s) => s.n === 2);
verdict("the engine, putting it live with untried steps", refused ? `${refused.ok} at ${step2?.n}/${step2?.total}` : "no job", "false at 2/16");
verdict("its step's words, the CLI's own, word for word", JSON.stringify(step2?.lines) === JSON.stringify(cliLines), true);
verdict("steps run after it", phase.steps.filter((s) => s.n > 2).length, 0);
verdict("the live version, after both refusals", (await ask("app.get", { app: P })).result?.live, "v1");

const mark1 = await ask("app.markTried", { app: P, step: 1 });
verdict("app.markTried 1", mark1.ok ? mark1.result.step : mark1.error?.message, 'step 1, "A first step"');
const mark2 = await ask("app.markTried", { app: P, step: 2 });
verdict("app.markTried 2: every step tried", mark2.ok ? mark2.result.left.length : "?", 0);
const notBuilt = await ask("app.markTried", { app: P, step: 3 });
verdict("app.markTried 3, a step the plan has not: refused", notBuilt.error?.reason, "no-step");
const report = await ask("app.report", { app: P, text: "The probe says something is wrong.\nOn two lines." });
verdict("app.report: kept in the project's folder", report.ok && readFileSync(`${STATE}/projects/${P}/${report.result.file}`, "utf8").includes("On two lines."), true);
const start = await until((await ask("app.startTestCopy", { app: P })).result?.job);
verdict("app.startTestCopy", start?.ok, true);
// While a job's command runs, the engine answers (D77): the command runs on a
// thread of its own. Asked how it goes every quarter second, as the panel
// asks, the slowest answer; on the engine's own thread, a step that waits on
// Docker held every answer back for as long as it took.
const liveJob = (await ask("app.putLive", { app: P })).result?.job;
let slowest = 0;
let asked = 0;
let live = null;
for (let i = 0; liveJob && i < 3600; i++) {
  const t = Date.now();
  const answer = await ask("job.get", { job: liveJob });
  slowest = Math.max(slowest, Date.now() - t);
  asked += 1;
  if (!answer.ok) break;
  if (answer.result.state === "finished") { live = answer.result; break; }
  await new Promise((r) => setTimeout(r, 250));
}
verdict("app.putLive, every step tried", live ? `${live.ok}, ${live.phases[0].steps.length} steps` : "no job", "true, 16 steps");
verdict(`the engine answering while it runs: the slowest of ${asked} answers`, `${slowest} ms`, (s) => parseInt(s, 10) < 1000);
verdict("the live version after it", (await ask("app.get", { app: P })).result?.live, "v2");
const busyJob = await ask("app.goBack", { app: P });
const busy = await ask("app.startTestCopy", { app: P });
verdict("a second long operation while one runs: busy", busy.error?.code, "busy");
const back = await until(busyJob.result?.job);
verdict("app.goBack: behind a fresh backup", back ? `${back.ok}, ${back.phases[0].steps.length} steps` : "no job", "true, 14 steps");
verdict("the live version after it", (await ask("app.get", { app: P })).result?.live, "v1");
const backups = await ask("app.backups", { app: P });
verdict("app.backups: the one going back took", backups.ok ? backups.result.filter((b) => b.kind === "rollback" && b.created >= SINCE).length : "?", 1);

console.log("its protocol: JSON, one message a line, no HTTP (D66, D76):");
const raw = (text) => new Promise((resolve) => {
  const client = net.createConnection(SOCK);
  let data = "";
  client.setEncoding("utf8");
  client.on("connect", () => client.write(text));
  client.on("data", (c) => (data += c));
  client.on("end", () => resolve(data));
  client.on("error", (e) => resolve(e.code));
});
const firstLine = async (text) => { try { return JSON.parse((await raw(text)).split("\n")[0]); } catch { return {}; } };
verdict("an HTTP request, as a browser would send one", (await firstLine("POST /v1/apps.list HTTP/1.1\r\nHost: engine\r\nContent-Length: 2\r\n\r\n{}\n")).error?.code, "bad_arguments");
verdict("a line of more than 16 kB", (await firstLine(`${JSON.stringify({ op: "app.report", args: { app: P, text: "x".repeat(17000) } })}\n`)).error?.message, (s) => /longer than 16 kB/.test(String(s)));
verdict("a line that never ends", (await firstLine("x".repeat(20000))).error?.code, "bad_arguments");

console.log("the agent, and a new app (D76), each confirmed:");
const NEW = "enginenew";
cli("project", "remove", NEW, "--delete-everything");
verdict("app.create, without confirm", (await ask("app.create", { app: NEW })).error?.code, "bad_arguments");
verdict("app.create, a name that is taken", (await ask("app.create", { app: P, confirm: true })).error?.message, `there is already an app called ${P}`);
verdict("app.create, a name made of the forbidden word", (await ask("app.create", { app: `my${["no", "cry"].join("")}`, confirm: true })).error?.code, "refused");
const created = await until((await ask("app.create", { app: NEW, confirm: true })).result?.job);
verdict("app.create, confirmed: the CLI's own steps", created ? `${created.ok}, ${created.phases[0]?.steps.length} steps` : "no job", (s) => /^true, \d+ steps$/.test(s));
verdict("the new app, as the engine lists it", (await ask("apps.list")).result?.some((a) => a.name === NEW), true);
verdict("its plan: none yet, so it starts in planning", (await ask("app.plan", { app: NEW })).result?.state, "none");
cli("project", "remove", NEW, "--delete-everything");
verdict("agent.start, without confirm", (await ask("agent.start", { app: P, signIn: "key" })).error?.code, "bad_arguments");
verdict("agent.start, another way of signing in", (await ask("agent.start", { app: P, signIn: "password", confirm: true })).error?.code, "bad_arguments");
verdict("agent.stop, without confirm", (await ask("agent.stop", { app: P })).error?.code, "bad_arguments");
verdict("agent.status, before", JSON.stringify((await ask("agent.status", { app: P })).result), JSON.stringify({ running: false, signIn: null, hasKey: true, terminal: { open: false, attached: false } }));
const agentStarted = await until((await ask("agent.start", { app: P, signIn: "key", confirm: true })).result?.job);
verdict("agent.start, confirmed, with the key in the vault", agentStarted ? `${agentStarted.ok}, ${agentStarted.phases[0]?.steps.length} steps` : "no job", "true, 8 steps");
verdict("agent.status, after", JSON.stringify((await ask("agent.status", { app: P })).result), JSON.stringify({ running: true, signIn: "key", hasKey: true, terminal: { open: false, attached: false } }));
const agentStopped = await until((await ask("agent.stop", { app: P, confirm: true })).result?.job);
verdict("agent.stop, confirmed", agentStopped?.ok, true);
verdict("agent.status, once stopped", (await ask("agent.status", { app: P })).result?.running, false);

console.log("signing in:");
rmSync(AUTH, { force: true });
const code = sh("runuser", ["-u", C, "--", "node", "--input-type=module", "-e",
  `import { AuthStore, showCode } from "/opt/${C}/current/dist/engine/auth.js"; console.log(showCode(new AuthStore(${JSON.stringify(AUTH)}).newSetupCode()));`]).stdout.trim();
verdict("auth.status, before", JSON.stringify((await ask("auth.status")).result), JSON.stringify({ claimed: false, hasCode: true, pausedFor: 0 }));
const wrongCode = code.replace(/[A-Z2-9]/, (c) => (c === "A" ? "B" : "A"));
verdict("auth.claim, a wrong code", (await ask("auth.claim", { setupCode: wrongCode, password })).error?.reason, "wrong");
verdict("auth.claim, the right code", (await ask("auth.claim", { setupCode: code, password })).result?.claimed, true);
verdict("auth.claim, the same code again", (await ask("auth.claim", { setupCode: code, password })).error?.reason, "claimed");
verdict("auth.check, the password", (await ask("auth.check", { password })).result?.signedIn, true);
verdict("auth.check, another", (await ask("auth.check", { password: `${password}x` })).error?.reason, "wrong");
const authFile = readFileSync(AUTH, "utf8");
const authMode = (statSync(AUTH).mode & 0o777).toString(8);
verdict("the sign-in file: the service user's alone", `${owner(statSync(AUTH)).split(" ")[0].split(":")[0]} ${authMode}`, `${C} 600`);

/* -------------------------------------------------------------- secrets -- */
console.log("no answer holds a secret value:");
const secrets = [values.dev, values.prod, password, code, code.replace(/-/g, "")];
for (const env of ["dev", "prod"]) secrets.push(readFileSync(`${STATE}/projects/${P}/secrets/${env}/db_password`, "utf8").trim());
for (const line of readFileSync(`/etc/${C}/backup-host.key`, "utf8").split("\n")) if (line.startsWith("AGE-SECRET-KEY-")) secrets.push(line.trim());
const stored = JSON.parse(authFile);
for (const h of [stored.password?.salt, stored.password?.hash]) if (h) secrets.push(h);
const seen = answers.join("\n");
const found = (text) => secrets.filter((s) => s && text.includes(s)).length;
verdict("the scan, on an answer with a planted value (a control)", found(`${seen}\n${values.prod}`), 1);
verdict(`secret values in ${answers.length} answers`, found(seen), 0);
verdict("secret values the scan looked for", secrets.filter(Boolean).length, (n) => n >= 8);

/* ------------------------------------------------------------- cleanup -- */
if (savedAuth) writeFileSync(AUTH, savedAuth, { mode: 0o600 });
else rmSync(AUTH, { force: true });
sh("chown", [`${C}:${C}`, AUTH]);
const removed = cli("project", "remove", P, "--delete-everything");
console.log(`the project ${P} removed: exit ${removed.status}`);
rmSync(mem, { recursive: true, force: true });
console.log(`${total - wrong} of ${total} as they must be`);
process.exit(wrong ? 1 : 0);
