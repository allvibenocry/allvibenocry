#!/usr/bin/env node
// The engine's next operations (D82; D66, question 8), probed on the test host,
// as root, after install, with test/host/panel-fixture.mjs beside it in /root:
//
//   node ops-probe.mjs <command>
//
// With a project of its own, "opscheck", and, for each operation, its every
// refusal first, each seen to change nothing, then the operation itself:
//
//   - service keys: the list (names, never values); setting one, whose value
//     reaches the live app and is found nowhere else (no answer, no job, the
//     engine's journal, the suite's folders); removing one; refusals of a bad
//     place, a bad name, the suite's own names, an empty value, no confirm, a
//     key that is not there, and the app's lock held;
//   - work outside a plan: a reason too short, no confirm, then refused by the
//     release's own gate while the commit has a plan with untried steps, and
//     put live with a reason the release keeps;
//   - going back with the data: what it would lose, in the CLI's words; the
//     app's name not typed, no confirm, the lock held; then the fresh backup
//     taken and restore-checked before prod's data is replaced, prod on the
//     version before with the backup's entries, and nothing earlier after;
//   - removing an app: its name not typed, the lock held, the backup disk gone
//     (refused at the backup, nothing removed); then removed, with its last
//     backup kept on the target and where it is said.
//
// The last line counts what is not as it must be.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";

const C = process.argv[2] ?? "allvibe";
const P = "opscheck";
const STATE = `/var/lib/${C}`;
const SOCK = `${STATE}/engine/engine.sock`;
const SINCE = new Date();
let total = 0;
let wrong = 0;
const answers = [];

const verdict = (label, seen, want) => {
  total += 1;
  const good = typeof want === "function" ? want(seen) : String(seen) === String(want);
  if (!good) wrong += 1;
  console.log(`  ${label.padEnd(72)} ${String(seen).replace(/\s+/g, " ").slice(0, 60).padEnd(60)} ${good ? "as it must be" : "WRONG"}`);
  return good;
};
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const cli = (...args) => sh(C, args);
const fixture = (...args) => sh("node", ["/root/panel-fixture.mjs", ...args]);

/** The engine, as the panel asks it: one JSON line out, one back (D76). */
function ask(op, args = {}) {
  return new Promise((resolve) => {
    const client = net.createConnection(SOCK);
    let data = "";
    client.setEncoding("utf8");
    client.on("connect", () => client.write(`${JSON.stringify({ op, args })}\n`));
    client.on("data", (c) => (data += c));
    client.on("end", () => {
      answers.push(data);
      try {
        resolve(JSON.parse(data.split("\n")[0]));
      } catch {
        resolve({ ok: false, error: { code: "unreadable", message: data.slice(0, 80) } });
      }
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
/** A long operation to its end: the job, or the refusal. */
async function run(op, args) {
  const started = await ask(op, args);
  if (!started.ok) return { refused: started.error };
  return { job: await until(started.result.job) };
}
// The whole of what a job said, for the verdicts to read; each verdict line prints only its start.
const said = (x) => (x.refused ? `${x.refused.code}: ${x.refused.message}` : `${x.job?.ok ? "done" : "failed"}: ${JSON.stringify(x.job?.phases ?? [])}`);

const project = () => (existsSync(`${STATE}/projects/${P}/project.json`) ? JSON.parse(readFileSync(`${STATE}/projects/${P}/project.json`, "utf8")) : null);
const live = () => {
  const p = project();
  if (!p) return "no app";
  const r = (p.releases ?? []).find((x) => x.version === p.current) ?? p.releases?.at(-1);
  return r?.version ?? "none";
};
async function entries() {
  const p = project();
  if (!p) return "no app";
  try {
    return (await (await fetch(`http://127.0.0.1:${p.ports.prodApp}/healthz`)).json()).entries;
  } catch {
    return "no answer";
  }
}
async function write(name) {
  const p = project();
  await fetch(`http://127.0.0.1:${p.ports.prodApp}/entries`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `name=${name}&message=ops+probe` });
}
const keysNow = async () => JSON.stringify((await ask("keys.list", { app: P })).result ?? null);
const backups = () => sh("sh", ["-c", `find /mnt/${C}-backup -name '${P}-prod-*.dump.age' | sort`]).stdout.trim().split("\n").filter(Boolean);

/* --------------------------------------------------------------- setup -- */
console.log(`the engine's next operations (D82), with the project ${P}`);
if (existsSync(`${STATE}/projects/${P}`)) cli("project", "remove", P, "--delete-everything");
verdict("setup: the project made", cli("project", "create", P).status, 0);
await write("Ada");
await write("Bo");
verdict("setup: two entries in the live app", await entries(), 2);

/* ------------------------------------------------------- service keys -- */
console.log("\nservice keys");
const MARK = `ops-${randomBytes(12).toString("hex")}`;
verdict("keys.list: none yet", await keysNow(), "[]");
for (const [label, args, code] of [
  ["a place that is not dev, prod or agent", { scope: "live", name: "OPS_TOKEN", value: MARK, confirm: true }, "bad_arguments"],
  ["a name the vault refuses", { scope: "prod", name: "ops_token", value: MARK, confirm: true }, "refused"],
  ["the suite's own name", { scope: "prod", name: "DATABASE_URL", value: MARK, confirm: true }, "refused"],
  ["an empty value", { scope: "prod", name: "OPS_TOKEN", value: "", confirm: true }, "bad_arguments"],
  ["no confirm", { scope: "prod", name: "OPS_TOKEN", value: MARK }, "bad_arguments"],
]) {
  const r = await run("keys.set", { app: P, ...args });
  verdict(`keys.set refused: ${label}`, r.refused?.code ?? said(r), code);
}
verdict("keys.set: after the refusals, still none", await keysNow(), "[]");
fixture("hold-lock", P);
const busyKey = await run("keys.set", { app: P, scope: "prod", name: "OPS_TOKEN", value: MARK, confirm: true });
verdict("keys.set refused while the command line holds the app's lock", busyKey.refused ? `${busyKey.refused.code}: ${busyKey.refused.message}` : said(busyKey), (s) => /^busy: .* is already running, started from the command line/.test(s));
fixture("free-lock", P);
verdict("keys.set: after the lock, still none", await keysNow(), "[]");
const setKey = await run("keys.set", { app: P, scope: "prod", name: "OPS_TOKEN", value: MARK, confirm: true });
verdict("keys.set: the live app's OPS_TOKEN, confirmed", said(setKey), (s) => s.startsWith("done") && /bytes, not shown/.test(s));
verdict("keys.list: its name, where it is used and when, and no value", await keysNow(), (s) => /"scope":"prod","name":"OPS_TOKEN","changed":"20/.test(s) && !s.includes(MARK));
// Compared, never printed: even a stand-in value is not shown (rule 4).
verdict("the live app reads it from its file", sh("docker", ["exec", `${C}-${P}-prod-app`, "cat", "/run/secrets/OPS_TOKEN"]).stdout === MARK ? "the value given" : "another value, or none", "the value given");
const journal = sh("journalctl", ["-u", `${C}-engine`, "--since", SINCE.toISOString().slice(0, 19).replace("T", " "), "--no-pager", "-o", "cat"], { maxBuffer: 64 * 1024 * 1024 }).stdout;
verdict("the value in no answer of the engine's", answers.filter((a) => a.includes(MARK)).length, 0);
verdict("nor in the engine's journal", journal.includes(MARK), false);
verdict("nor in the suite's folders or the temporary ones", sh("sh", ["-c", `grep -rl -- '${MARK}' ${STATE} /etc/${C} /tmp /var/tmp 2>/dev/null | wc -l`]).stdout.trim(), "0");
verdict("the search finds a marker put there on purpose (the control)", sh("sh", ["-c", `echo '${MARK}' > /tmp/ops-probe-control && grep -rl -- '${MARK}' /tmp | wc -l; rm -f /tmp/ops-probe-control`]).stdout.trim(), "1");
const notThere = await run("keys.remove", { app: P, scope: "dev", name: "OPS_TOKEN", confirm: true });
verdict("keys.remove refused: a key that is not there", notThere.refused ? `${notThere.refused.code}: ${notThere.refused.message}` : said(notThere), `refused: ${P} has no key called OPS_TOKEN for the test copy.`);
verdict("keys.remove refused: no confirm", (await run("keys.remove", { app: P, scope: "prod", name: "OPS_TOKEN" })).refused?.code, "bad_arguments");
const removedKey = await run("keys.remove", { app: P, scope: "prod", name: "OPS_TOKEN", confirm: true });
verdict("keys.remove: the live app's OPS_TOKEN, confirmed", said(removedKey), (s) => s.startsWith("done"));
verdict("keys.list: none again", await keysNow(), "[]");
verdict("the live app's file is gone", sh("docker", ["exec", `${C}-${P}-prod-app`, "test", "-e", "/run/secrets/OPS_TOKEN"]).status, 1);

/* ----------------------------------------------------- outside a plan -- */
console.log("\nwork outside a plan");
sh("sh", ["-c", `cd ${STATE}/projects/${P}/repo && printf '\\n<!-- ops probe ${SINCE.getTime()} -->\\n' >> README.md && chown ${C}:${C} README.md`]);
verdict("setup: a change committed in the test copy", cli("dev", "commit", P, "A change outside any plan").status, 0);
verdict("setup: the test copy runs it", cli("dev", "deploy", P).status, 0);
verdict("app.get: the test copy runs what is not live", (await ask("app.get", { app: P })).result?.unreleased, true);
verdict("app.putLive refused: a reason too short", (await run("app.putLive", { app: P, outsidePlan: "ok", confirm: true })).refused?.code, "bad_arguments");
verdict("app.putLive refused: a reason and no confirm", (await run("app.putLive", { app: P, outsidePlan: "the ops probe's change" })).refused?.code, "bad_arguments");
const noPlan = await run("app.putLive", { app: P });
verdict("app.putLive with no plan and no reason: stopped at the plan", said(noPlan), (s) => s.startsWith("failed") && /has no plan/.test(s));
verdict("still on v1", live(), "v1");
const outside = await run("app.putLive", { app: P, outsidePlan: "the ops probe's change", confirm: true });
// The job's words are JSON here, where the reason's quotes are escaped.
verdict("app.putLive outside a plan, with a reason, confirmed", said(outside), (s) => s.startsWith("done") && s.includes('outside any plan, by your choice: \\"the ops probe\'s change\\"'));
verdict("live now", live(), "v2");
verdict("app.get: nothing in the test copy that is not live", (await ask("app.get", { app: P })).result?.unreleased, false);
verdict("the release keeps the reason", project()?.releases?.find((r) => r.version === "v2")?.outsidePlan ?? "none", "the ops probe's change");
verdict("app.get says it", JSON.stringify((await ask("app.get", { app: P })).result?.versions?.[0] ?? {}), (s) => /"version":"v2".*"outsidePlan":"the ops probe's change"/.test(s));
fixture("plan", P, "1", "ops");
const untried = await run("app.putLive", { app: P, outsidePlan: "the ops probe's change", confirm: true });
verdict("a reason, while the commit has a plan with an untried step: refused by the gate", said(untried), (s) => s.startsWith("failed") && /steps you have not tried.*--outside-plan is for work outside any plan, and this commit has one/.test(s));
verdict("still v2", live(), "v2");

/* ------------------------------------------------ going back with data -- */
console.log("\ngoing back with the data");
await write("Cy");
verdict("setup: an entry written on v2", await entries(), 3);
const plan = (await ask("app.goBackWithDataPlan", { app: P })).result ?? {};
verdict("the plan: from v2 to v1", `${plan.possible} ${plan.from} ${plan.to}`, "true v2 v1");
verdict("what is lost, in the CLI's words, with the counts", plan.lost ?? "", (s) => /prod's data goes back to how it was at .* UTC, just before v2 was released; everything written to prod since then is lost from prod \(prod has 3 entries now; the backup has 2\)/.test(s));
for (const [label, args, code] of [
  ["the app's name not typed", { confirm: true }, "refused"],
  ["another name typed", { typedName: "opscheck2", confirm: true }, "refused"],
  ["no confirm", { typedName: P }, "bad_arguments"],
]) {
  const r = await run("app.goBackWithData", { app: P, ...args });
  verdict(`app.goBackWithData refused: ${label}`, r.refused ? `${r.refused.code}: ${r.refused.message}` : said(r), (s) => s.startsWith(code) && (code !== "refused" || /type the app's name, opscheck, exactly/.test(s)));
}
fixture("hold-lock", P);
const busyBack = await run("app.goBackWithData", { app: P, typedName: P, confirm: true });
verdict("app.goBackWithData refused while the command line holds the lock", busyBack.refused?.code ?? said(busyBack), "busy");
fixture("free-lock", P);
verdict("after the refusals: still v2, with its 3 entries", `${live()} ${await entries()}`, "v2 3");
const before = backups();
const back = await run("app.goBackWithData", { app: P, typedName: P, confirm: true });
verdict("app.goBackWithData, the name typed and confirmed", said(back), (s) => s.startsWith("done"));
const names = (back.job?.phases ?? []).flatMap((p) => p.steps.map((st) => st.name));
const at = (n) => names.indexOf(n);
verdict("a fresh backup, restore-checked, before prod's data is replaced", `${at("an encrypted backup of prod, on the target") >= 0} ${at("the app's own health check passes against the copy") < at("prod's data replaced by the backup")}`, "true true");
verdict("that backup is on the target", backups().filter((b) => !before.includes(b)).length, 1);
verdict("on v1, with the backup's 2 entries", `${live()} ${await entries()}`, "v1 2");
const nothingEarlier = (await ask("app.goBackWithDataPlan", { app: P })).result ?? {};
verdict("from the first version: nothing earlier", `${nothingEarlier.possible} ${nothingEarlier.why}`, (s) => /^false .*first version: there is nothing earlier/.test(s));
const refusedFirst = await run("app.goBackWithData", { app: P, typedName: P, confirm: true });
verdict("and going back with the data is refused in those words", refusedFirst.refused ? `${refusedFirst.refused.code}: ${refusedFirst.refused.message}` : said(refusedFirst), (s) => /^refused: .*nothing earlier/.test(s));

/* ----------------------------------------------------------- removing -- */
console.log("\nremoving the app");
verdict("app.remove refused: the name not typed", (await run("app.remove", { app: P, typedName: "", confirm: true })).refused?.code, "refused");
verdict("app.remove refused: no confirm", (await run("app.remove", { app: P, typedName: P })).refused?.code, "bad_arguments");
fixture("hold-lock", P);
verdict("app.remove refused while the command line holds the lock", (await run("app.remove", { app: P, typedName: P, confirm: true })).refused?.code, "busy");
fixture("free-lock", P);
fixture("unplug");
const noDisk = await run("app.remove", { app: P, typedName: P, confirm: true });
verdict("app.remove with the backup disk gone: stopped at the backup target", said(noDisk), (s) => s.startsWith("failed") && /on this machine's own root filesystem/.test(s));
verdict("and nothing removed: the app, its folder and its live app", `${existsSync(`${STATE}/projects/${P}`)} ${sh("docker", ["inspect", "-f", "{{.State.Status}}", `${C}-${P}-prod-app`]).stdout.trim()} ${await entries()}`, "true running 2");
fixture("plug");
const before2 = backups();
const removed = await run("app.remove", { app: P, typedName: P, confirm: true });
const kept = JSON.stringify(removed.job?.phases ?? []).match(/Its last backup is kept on the backup target: ([^\s"\\]+)/)?.[1] ?? "";
verdict("app.remove, the name typed and confirmed", said(removed), (s) => s.startsWith("done"));
verdict("it says where the last backup is", kept, (s) => s.startsWith(`/mnt/${C}-backup/`));
verdict("and that file is there, a new one", `${existsSync(kept)} ${!before2.includes(kept)}`, "true true");
verdict("the earlier backups are kept", before2.every((b) => existsSync(b)), true);
verdict("the app is gone: its folder, its containers, the list", `${existsSync(`${STATE}/projects/${P}`)} ${sh("sh", ["-c", `docker ps -aq --filter name=${C}-${P}- | wc -l`]).stdout.trim()} ${JSON.stringify((await ask("apps.list")).result ?? []).includes(`"${P}"`)}`, "false 0 false");

console.log(`\n${total - wrong} of ${total} as they must be${wrong ? `; ${wrong} WRONG` : ""}`);
process.exit(wrong ? 1 : 0);
