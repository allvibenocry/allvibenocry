// One lock per app, shared by the engine and the CLI (D72), and doctor counting
// the restore check a release or going back made (friction log 4). Runs on the
// test host as root, with a project of its own, which it removes first and
// leaves behind for a look:
//
//   node lock-probe.mjs <command>
//
//   A. a release from the panel's engine, and one from the command line while
//      it runs: the second refused, in plain words; one release made;
//   B. the other way round, and the engine's other long operations refused too;
//   C. a lock left by a process that has ended: cleared, and said so;
//   D. the nightly backup, started while going back runs: it waits, then backs up;
//   and doctor, after a release and after going back: the restore check each
//   made, counted.
// Every line ends with its verdict; the last counts what is not as it must be.
import { spawn, spawnSync } from "node:child_process";
import { chownSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";

const C = process.argv[2] ?? "allvibe";
const APP = "lockprobe";
const STATE = `/var/lib/${C}`;
const REPO = `${STATE}/projects/${APP}/repo`;
const LOCK = `${STATE}/projects/${APP}/operation.lock`;
const SOCKET = `${STATE}/engine/engine.sock`;
let total = 0;
let wrong = 0;

function verdict(label, seen, must) {
  total += 1;
  const good = must instanceof RegExp ? must.test(String(seen)) : String(seen) === String(must);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(64)} ${String(seen).slice(0, 110).padEnd(28)} ${good ? "as it must be" : "WRONG"}`);
}
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", timeout: 600_000, ...opts });
const cli = (...args) => sh(C, args);
const must = (what, r) => {
  if (r.status !== 0) {
    console.log(`${what} failed (${r.status}): ${(r.stderr || r.stdout).trim().split("\n").slice(-4).join(" | ")}`);
    process.exit(2);
  }
  return r;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(100);
  }
}

/** The engine, as the panel asks it, over its socket: one JSON line each way (D76). */
function engine(operation, args = {}) {
  return new Promise((resolve) => {
    const client = net.createConnection(SOCKET);
    let data = "";
    client.setEncoding("utf8");
    client.on("connect", () => client.write(`${JSON.stringify({ op: operation, args })}\n`));
    client.on("data", (c) => (data += c));
    client.on("end", () => resolve(JSON.parse(data.split("\n")[0])));
    client.on("error", (e) => resolve({ ok: false, error: { code: "socket", message: e.message } }));
  });
}
const jobEnded = async (id) => until(async () => { const j = await engine("job.get", { job: id }); return j.ok && j.result.state === "finished" ? j.result : null; }, 300_000);

function plan(title) {
  const [uid, gid] = [Number(sh("id", ["-u", C]).stdout), Number(sh("id", ["-g", C]).stdout)];
  writeFileSync(`${REPO}/plan.json`, `${JSON.stringify({ title, steps: [{ id: 1, title: "A step to try", check: "Open the test copy.", built: true }] }, null, 2)}\n`);
  chownSync(`${REPO}/plan.json`, uid, gid);
  must("dev commit", cli("dev", "commit", APP, title));
  must("dev deploy", cli("dev", "deploy", APP));
  must("plan tried", cli("plan", "tried", APP, "1"));
}
// Only this run's: an earlier run's project of the same name left its records (mistake 28).
const SINCE = new Date().toISOString();
const records = (kind) => readdirSync(`${STATE}/runs`).filter((f) => f.endsWith(`-${kind}-${APP}.json`)).map((f) => JSON.parse(readFileSync(`${STATE}/runs/${f}`, "utf8"))).filter((r) => r.started >= SINCE);
const live = () => /^ {4}version +(v\d+)/m.exec(cli("project", "status", APP).stdout)?.[1] ?? "?";
const holderFrom = () => { try { return JSON.parse(readFileSync(LOCK, "utf8")).from; } catch { return null; } };
function backupLine() {
  const d = JSON.parse(cli("doctor", "--json").stdout);
  const c = (d.checks ?? d).find((x) => x.id === `backup-${APP}`);
  return c ? `${c.status}: ${c.text}` : "(no line)";
}

console.log(`the app ${APP}, made fresh:`);
cli("project", "remove", APP, "--delete-everything");
must("project create", cli("project", "create", APP));
verdict("doctor, before any backup", backupLine().split(":")[0], "problem");
plan("Lock probe, first");

console.log("A. the panel first, the command line while it runs:");
const a = await engine("app.putLive", { app: APP });
verdict("the engine started a release", a.ok ? "a job" : a.error?.message, "a job");
verdict("the lock, held for the panel", await until(() => holderFrom(), 5000), "the panel");
const second = cli("release", APP);
verdict("a release from the command line meanwhile: exit code", second.status, 1);
verdict("in plain words", second.stderr.trim(), /^A release of lockprobe is already running, started from the panel (just now|1 minute ago)\. Wait for it to end, then try again\.$/);
const jobA = a.ok ? await jobEnded(a.result.job) : null;
verdict("the panel's release ended", jobA ? (jobA.ok ? "ok" : "failed") : "never", "ok");
verdict("releases recorded", records("release").length, 1);
verdict("prod runs", live(), "v2");
verdict("the lock, let go", existsSync(LOCK) ? "still there" : "gone", "gone");
verdict("doctor, after the release", backupLine(), /^ok: lockprobe: last backup .*; last restore check .* passed, in a release/);

console.log("B. the command line first, the panel while it runs:");
plan("Lock probe, second");
const child = spawn(C, ["release", APP], { stdio: "ignore" });
const childEnded = new Promise((r) => child.on("exit", (code) => r(code)));
verdict("the lock, held for the command line", await until(() => holderFrom(), 20000), "the command line");
for (const op of ["app.putLive", "app.goBack", "app.startTestCopy"]) {
  const b = await engine(op, { app: APP });
  verdict(`${op} from the panel meanwhile`, b.ok ? "started" : b.error.code, "busy");
  verdict("in plain words", b.error?.message ?? "", /^A release of lockprobe is already running, started from the command line (just now|1 minute ago)\. Wait for it to end, then try again\.$/);
}
verdict("the command line's release ended", await childEnded, 0);
verdict("releases recorded", records("release").length, 2);
verdict("prod runs", live(), "v3");

console.log("C. a lock left by a process that has ended:");
const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
writeFileSync(LOCK, JSON.stringify({ operation: "release", app: APP, from: "the command line", pid: gone, since: null, started: new Date(Date.now() - 600_000).toISOString() }));
const c = cli("backup", APP);
verdict("a backup, with a stale lock there: exit code", c.status, 0);
verdict("it says it cleared it", c.stderr.trim(), /^\(a lock left by a stopped release, started from the command line 10 minutes ago, was cleared\)$/);

console.log("D. the nightly backup, started while going back runs:");
const back = spawn(C, ["rollback", APP], { stdio: "ignore" });
const backEnded = new Promise((r) => back.on("exit", (code) => r(code)));
verdict("the lock, held for going back", await until(() => holderFrom(), 20000), "the command line");
const nightly = sh("systemctl", ["start", `${C}-backup.service`]);
verdict("going back ended", await backEnded, 0);
verdict("the nightly backup ended", nightly.status, 0);
const rollback = records("rollback").at(-1);
const scheduled = records("backup").filter((r) => r.facts?.scheduled).at(-1);
verdict("the nightly backup of the app began after going back ended", scheduled && rollback ? (scheduled.started >= rollback.finished ? "after" : "during") : "none", "after");
verdict("and it passed", scheduled?.ok, true);
verdict("doctor, after the nightly restore check", backupLine(), /^ok: lockprobe: last backup .*; last restore check .* passed \(/);

console.log("E. going back once more, from the command line:");
must("rollback", cli("rollback", APP));
verdict("doctor, after going back", backupLine(), /^ok: lockprobe: last backup .*; last restore check .* passed, in going back/);

console.log(`${total - wrong} of ${total} as they must be`);
process.exitCode = wrong ? 1 : 0;
