#!/usr/bin/env node
// Claude Code's deny rules (D61), proved with the real, pinned Claude Code on
// the test host. Run as root on the test host:
//
//   node deny-probe.mjs <settings.json> [--control] [--pwsh <PowerShell dir>]
//
// It gives the agent's image a scratch repository (with a bare "remote", a
// tag, an untracked folder, and folders outside it), puts <settings.json> in
// it as the project's .claude/settings.json, and runs one session of
// `claude -p` against the stand-in for the model's API (stub-api.mjs), which
// asks for one tool call per step: for every deny rule a harmless command that
// the rule must refuse, and controls that must run. Bash is allowed outright
// (--allowedTools), so only the deny rules can refuse. The container has no
// Docker socket and no network but the stand-in's; its scratch folder is
// thrown away. With --control there is no settings file, and every command
// must run: that proves the probe sees a command run. With --pwsh, a pinned
// PowerShell is mounted and Claude Code's PowerShell tool turned on, and the
// PowerShell rules are tried too. No key or login is used: the stand-in key is
// random and made here. The last line counts what is not as it must be.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const settingsFile = args[0];
const control = args.includes("--control");
const pwshDir = args.includes("--pwsh") ? args[args.indexOf("--pwsh") + 1] : null;
if (!settingsFile || !existsSync(settingsFile)) {
  process.stderr.write("usage: node deny-probe.mjs <settings.json> [--control] [--pwsh <dir>]\n");
  process.exit(2);
}
const AGENT_IMAGE = spawnSync("docker", ["image", "ls", "--format", "{{.Repository}}:{{.Tag}}", "allvibe-agent"], { encoding: "utf8" }).stdout.trim().split("\n")[0];
const NODE_IMAGE = "node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1";
const USER = "996:995";
const DIR = `/var/tmp/deny-probe-${control ? "control" : "rules"}${pwshDir ? "-pwsh" : ""}`;
const NET = "allvibe-denyprobe";
const STUB = "allvibe-denyprobe-stub";
const LABEL = "allvibe.test=deny-probe";

/* ------------------------------------------------------------- cases -- */
// Every rule, with a command it must refuse. Targets are scratch: the bare
// remote, the scratch repository, folders under /t/outside and /t/home, and
// Docker, which is not in the container at all.
const B = (rule, command) => ({ tool: "Bash", rule: `Bash(${rule})`, command, expect: "refused" });
const P = (rule, command) => ({ tool: "PowerShell", rule: `PowerShell(${rule})`, command, expect: "refused" });
const rmStarts = [
  [" /", (d) => `/t/outside/${d}`],
  [" ~", (d) => `~/${d}`],
  [" ..", (d) => `../outside/${d}`],
  [" $", (d) => `$OUTSIDE/${d}`],
  [' "', (d) => `"/t/outside/${d}"`],
  [" '", (d) => `'/t/outside/${d}'`],
  [" C:*", (d) => `C:/${d}`],
  [" c:*", (d) => `c:/${d}`],
];
const rmFlags = [
  ["rm -*r*", "rm -rf", "a"],
  ["rm -*R*", "rm -Rf", "b"],
  ["rm *--recursive*", "rm --recursive --force", "c"],
];
const bash = [
  B("git push *--force*", "git push --force origin main"),
  B("git push *--force*", "git push --force-with-lease origin main"),
  B("git push -f*", "git push -f origin main"),
  B("git push * -f*", "git push origin main -f"),
  B("git push *+*", "git push origin +main"),
  B("git push *--mirror*", "git push --mirror /t/mirror.git"),
  B("git push *--delete*", "git push origin --delete v0.1"),
  B("git push -d *", "git push -d origin v0.1"),
  B("git push * -d *", "git push origin -d v0.1"),
  B("git push * :**", "git push origin :refs/tags/v0.1"),
  B("git * push *--force*", "git -C /t/repo push --force origin main"),
  B("git * push * -f*", "git -C /t/repo push origin main -f"),
  B("git * push *+*", "git -C /t/repo push origin +main"),
  B("git * push *--delete*", "git -C /t/repo push origin --delete v0.1"),
  B("git * push * :**", "git -C /t/repo push origin :refs/tags/v0.1"),
  B("git tag -f*", "git tag -f v0.1"),
  B("git tag * -f*", "git tag v0.1 -f"),
  B("git tag *--force*", "git tag --force v0.1"),
  B("git reset *--hard*", "git reset --hard HEAD"),
  B("git * reset *--hard*", "git -C /t/repo reset --hard HEAD"),
  B("git clean *-*f*", "git clean -fd"),
  B("git * clean *-*f*", "git -C /t/repo clean -fd"),
  ...["system", "container", "image", "volume", "network", "builder", "buildx"].map((kind) => B("docker * prune*", `docker ${kind} prune -f`)),
  B("docker volume rm*", "docker volume rm allvibe-denyprobe-none"),
  B("docker volume remove*", "docker volume remove allvibe-denyprobe-none"),
  B("docker * volume rm*", "docker --context default volume rm allvibe-denyprobe-none"),
  B("docker * volume remove*", "docker --context default volume remove allvibe-denyprobe-none"),
  B("docker compose *down*-v*", "docker compose down -v"),
  B("docker compose *down*-v*", "docker compose -p denyprobe down --volumes"),
  B("docker-compose *down*-v*", "docker-compose down -v"),
  B("docker rm *-v*", "docker rm -v allvibe-denyprobe-none"),
  B("docker container rm *-v*", "docker container rm -v allvibe-denyprobe-none"),
  ...rmFlags.flatMap(([rule, flags, letter]) =>
    rmStarts.map(([start, target], i) => B(`${rule}${start}*`, `${flags} ${target(`${letter}${i + 1}`)}`))),
  B("find * -delete*", "find /t/outside/d1 -delete"),
  B("find *-exec rm *", "find /t/outside/d2 -exec rm -rf {} +"),
  B("xargs *rm *", "echo /t/outside/d3 | xargs rm -rf"),
  // Around the rules: a compound command and a wrapper, which Claude Code
  // looks through (its documentation says so).
  B("git push *--force*", "true && git push --force origin main"),
  B("git reset *--hard*", "timeout 20 git reset --hard HEAD"),
];
const powershell = [
  P("git push *--force*", "git push --force origin main"),
  P("git push -f*", "git push -f origin main"),
  P("git push * -f*", "git push origin main -f"),
  P("git push *+*", "git push origin +main"),
  P("git push *--mirror*", "git push --mirror /t/mirror.git"),
  P("git push *--delete*", "git push origin --delete v0.1"),
  P("git push -d *", "git push -d origin v0.1"),
  P("git push * -d *", "git push origin -d v0.1"),
  P("git push * :**", "git push origin :refs/tags/v0.1"),
  P("git * push *--force*", "git -C /t/repo push --force origin main"),
  P("git * push * -f*", "git -C /t/repo push origin main -f"),
  P("git * push *+*", "git -C /t/repo push origin +main"),
  P("git * push *--delete*", "git -C /t/repo push origin --delete v0.1"),
  P("git * push * :**", "git -C /t/repo push origin :refs/tags/v0.1"),
  P("git tag -f*", "git tag -f v0.1"),
  P("git tag * -f*", "git tag v0.1 -f"),
  P("git tag *--force*", "git tag --force v0.1"),
  P("git reset *--hard*", "git reset --hard HEAD"),
  P("git * reset *--hard*", "git -C /t/repo reset --hard HEAD"),
  P("git clean *-*f*", "git clean -fd"),
  P("git * clean *-*f*", "git -C /t/repo clean -fd"),
  P("docker * prune*", "docker system prune -f"),
  P("docker volume rm*", "docker volume rm allvibe-denyprobe-none"),
  P("docker volume remove*", "docker volume remove allvibe-denyprobe-none"),
  P("docker * volume rm*", "docker --context default volume rm allvibe-denyprobe-none"),
  P("docker * volume remove*", "docker --context default volume remove allvibe-denyprobe-none"),
  P("docker compose *down*-v*", "docker compose down -v"),
  P("docker-compose *down*-v*", "docker-compose down -v"),
  P("docker rm *-v*", "docker rm -v allvibe-denyprobe-none"),
  P("docker container rm *-v*", "docker container rm -v allvibe-denyprobe-none"),
  P("Remove-Item *-r*", "Remove-Item -Recurse -Force /t/outside/p1"),
  P("Remove-Item *-r*", "Remove-Item /t/outside/p2 -r"),
  P("cmd *rd /s*", "cmd /c rd /s /q C:\\denyprobe"),
  P("cmd *rmdir /s*", "cmd /c rmdir /s /q C:\\denyprobe"),
];
// Controls: ordinary commands the rules must leave alone.
const controls = [
  { tool: "Bash", command: "git status --short", expect: "ran" },
  { tool: "Bash", command: "git push origin main", expect: "ran" },
  { tool: "Bash", command: "git push origin feature-fix", expect: "ran" },
  { tool: "Bash", command: "rm -rf dist", expect: "ran" },
  { tool: "Bash", command: "git clean -n", expect: "ran" },
  { tool: "Bash", command: "git reset --soft HEAD", expect: "ran" },
  { tool: "Bash", command: "docker version", expect: "ran" },
];
const psControls = [
  { tool: "PowerShell", command: "git status --short", expect: "ran" },
  { tool: "PowerShell", command: "Remove-Item /t/repo/dist2/file.txt", expect: "ran" },
];
// Limits: what the rules do not see, recorded, never counted as right or wrong.
const limits = [
  { tool: "Bash", command: 'bash -c "git reset --hard HEAD"', expect: "limit", note: "a command inside bash -c" },
  { tool: "Bash", command: "sh -c 'rm -rf /t/outside/e2'", expect: "limit", note: "a deletion inside sh -c" },
  { tool: "Bash", command: "cd /t && rm -rf outside/e1", expect: "limit", note: "a relative path after cd" },
  { tool: "Bash", command: "git push origin main -uf", expect: "limit", note: "-f joined to another short flag" },
];
const psLimits = [{ tool: "PowerShell", command: "rm -r /t/outside/p3", expect: "limit", note: "rm in PowerShell, which on Linux is not an alias of Remove-Item" }];

// --cases <file>: a JSON list of { tool, command, expect } instead, to try a
// candidate rule's form; the rules are then not checked for a case each.
const casesFile = args.includes("--cases") ? args[args.indexOf("--cases") + 1] : null;
const cases = casesFile
  ? JSON.parse(readFileSync(casesFile, "utf8"))
  : [...controls, ...bash, ...limits, ...(pwshDir ? [...psControls, ...powershell, ...psLimits] : [])];
const deny = JSON.parse(readFileSync(settingsFile, "utf8")).permissions?.deny ?? [];

/* ------------------------------------------------------------- setup -- */
const run = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, { encoding: "utf8", ...opts });
const outsideDirs = ["a", "b", "c"].flatMap((l) => [1, 3, 4, 5, 6].map((n) => `${l}${n}`)).concat(["d1", "d2", "d3", "e1", "e2", "p1", "p2", "p3"]);
const homeDirs = ["a2", "b2", "c2"];
rmSync(DIR, { recursive: true, force: true });
mkdirSync(`${DIR}/outside`, { recursive: true });
for (const d of outsideDirs) { mkdirSync(`${DIR}/outside/${d}`, { recursive: true }); writeFileSync(`${DIR}/outside/${d}/keep.txt`, "keep\n"); }
for (const d of homeDirs) { mkdirSync(`${DIR}/home/${d}`, { recursive: true }); writeFileSync(`${DIR}/home/${d}/keep.txt`, "keep\n"); }
writeFileSync(`${DIR}/steps.json`, JSON.stringify(cases.map((c, i) => ({ name: c.tool, input: { command: c.command, description: `Probe step ${i + 1}` } }))));
if (!control) writeFileSync(`${DIR}/settings.json`, readFileSync(settingsFile));
writeFileSync(`${DIR}/setup.sh`, [
  "set -e",
  "cd /t",
  "git init -q --bare remote.git",
  "git init -q -b main repo",
  "cd repo",
  "git config user.name probe && git config user.email probe@example.invalid",
  "echo one > file.txt && git add file.txt && git commit -qm one && git tag v0.1",
  "mkdir dist dist2 C: c: && echo x > dist/a && echo x > dist2/file.txt",
  "for d in a7 a8 b7 b8 c7 c8; do mkdir -p C:/$d c:/$d; done",
  "git remote add origin /t/remote.git && git push -q origin main v0.1 && git branch feature-fix && git push -q origin feature-fix",
  "if [ -f /t/settings.json ]; then mkdir -p .claude && cp /t/settings.json .claude/settings.json; fi",
  "",
].join("\n"));
const secrets = `/dev/shm/deny-probe-${process.pid}.env`;
writeFileSync(secrets, `ANTHROPIC_API_KEY=${["sk", "ant", "api03", randomBytes(60).toString("base64url")].join("-")}\n`, { mode: 0o600 });
chmodSync(DIR, 0o777);
run("chmod", ["-R", "a+rwX", DIR]);

/* --------------------------------------------------------------- run -- */
run("docker", ["rm", "-f", STUB]);
if (run("docker", ["network", "inspect", NET]).status !== 0) run("docker", ["network", "create", "--internal", "--label", LABEL, NET]);
run("docker", ["run", "-d", "--name", STUB, "--label", LABEL, "--network", NET, "--read-only", "--cap-drop", "ALL",
  "-e", "STEPS_FILE=/t/steps.json", "-e", "RESULTS_FILE=/t/results.jsonl",
  "-v", `${DIR}:/t`, "-v", "/root/stub-api.mjs:/stub.mjs:ro", NODE_IMAGE, "node", "/stub.mjs"]);
spawnSync("sleep", ["2"]);
const env = [
  "-e", `ANTHROPIC_BASE_URL=http://${STUB}:8080`, "-e", "HOME=/t/home", "-e", "OUTSIDE=/t/outside",
  "-e", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", "-e", "DISABLE_AUTOUPDATER=1",
  ...(pwshDir ? ["-e", "CLAUDE_CODE_USE_POWERSHELL_TOOL=1", "-e", "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1",
    "-e", "PATH=/opt/pwsh:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "-v", `${pwshDir}:/opt/pwsh:ro`] : []),
];
const session = run("timeout", ["900", "docker", "run", "--rm", "--label", LABEL, "--network", NET, "--user", USER, "--cap-drop", "ALL",
  "--env-file", secrets, ...env, "-v", `${DIR}:/t`, "--entrypoint", "sh", AGENT_IMAGE, "-c",
  `sh /t/setup.sh && cd /t/repo && claude -p "Run the scripted steps." --permission-mode acceptEdits --allowedTools Bash PowerShell --max-turns 400 --output-format text`]);
rmSync(secrets, { force: true });
run("docker", ["rm", "-f", STUB]);
run("docker", ["network", "rm", NET]);

/* ----------------------------------------------------------- verdicts -- */
const lines = existsSync(`${DIR}/results.jsonl`) ? readFileSync(`${DIR}/results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const tools = lines.find((l) => l.tools)?.tools ?? [];
const byStep = new Map(lines.filter((l) => !l.tools).map((l) => [l.step, l]));
const refusedText = /has been denied|permission to use .* denied|denied by .*rule/i;
let total = 0;
let wrong = 0;
const out = (s) => process.stdout.write(`${s}\n`);
out(`Claude Code ${run("docker", ["run", "--rm", "--entrypoint", "claude", AGENT_IMAGE, "--version"]).stdout.trim()}, ${control ? "WITHOUT the settings file (the control)" : `with ${settingsFile}`}${pwshDir ? ", PowerShell tool on" : ""}`);
out(`tools offered: ${tools.join(", ") || "(none seen)"}; the session's exit: ${session.status}`);
cases.forEach((c, i) => {
  const r = byStep.get(i + 1);
  const seen = !r ? "no result" : r.isError && refusedText.test(r.text) ? "refused" : "ran";
  const want = c.expect === "limit" ? null : control ? "ran" : c.expect;
  const ok = want === null ? "limit, not counted" : seen === want ? "as it must be" : "WRONG";
  if (want !== null) { total += 1; if (seen !== want) wrong += 1; }
  out(`  ${String(i + 1).padStart(3)} ${c.tool.padEnd(10)} ${c.command.slice(0, 58).padEnd(58)} ${seen.padEnd(9)} ${ok}${c.note ? ` (${c.note})` : ""}`);
});
if (!control && !casesFile) {
  const tested = new Set([...bash, ...(pwshDir ? powershell : [])].map((c) => c.rule));
  for (const rule of deny) {
    if (!rule.startsWith("PowerShell(") || pwshDir) {
      total += 1;
      if (!tested.has(rule)) { wrong += 1; out(`  a rule with no case: ${rule}  WRONG`); }
    }
  }
  const kept = outsideDirs.filter((d) => !["e1", "e2", "p3"].includes(d)).filter((d) => existsSync(`${DIR}/outside/${d}/keep.txt`)).length;
  total += 1;
  const want = outsideDirs.length - 3;
  if (kept !== want) wrong += 1;
  out(`  folders outside the repository still there: ${kept} of ${want}  ${kept === want ? "as it must be" : "WRONG"}`);
}
const sample = lines.find((l) => l.isError && refusedText.test(l.text)) ?? lines.find((l) => l.isError);
if (sample) out(`a refusal, as Claude Code words it: ${sample.text.split("\n")[0].slice(0, 160)}`);
out(`${total - wrong} of ${total} as they must be`);
rmSync(DIR, { recursive: true, force: true });
process.exit(wrong ? 1 : 0);
