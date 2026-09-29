// What the browser checks of the control panel need done on the test host, as
// the builder or the machine would do it (the sixth brief, items 9 and 10).
// Runs on the test host as root; test/host/panel-journey.mjs calls it through
// the harness.
//
//   node panel-fixture.mjs plan <app> <steps>   the fixture plan's first <steps> steps, built: committed and deployed to the test copy
//   node panel-fixture.mjs unplug               the backup disk, taken away (it stays mounted elsewhere, to come back)
//   node panel-fixture.mjs plug                 the backup disk, back
//   node panel-fixture.mjs setup-code           a new setup code for the panel (it resets the panel when it is set up)
//   node panel-fixture.mjs report <app>         the newest "Something is wrong" report of an app
//   node panel-fixture.mjs live <app>           the app's live version, as the CLI says it
//   node panel-fixture.mjs break <variant>      a deliberately broken copy of the panel, run in the real one's place (item 10)
//   node panel-fixture.mjs mend                 the real panel back, as install makes it
import { spawnSync } from "node:child_process";
import { chownSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const C = process.env.SUITE_COMMAND ?? "allvibe";
const STATE = `/var/lib/${C}`;
const DISK = `/mnt/${C}-backup`;
const KEPT = `/mnt/.${C}-backup-kept`;
const PANEL = `${C}-panel`;
const COPY = "/var/tmp/panel-broken";

/*
 * The broken copies: each breaks what one of the browser checks is there to
 * catch, so that the check is seen failing before it is trusted (the sixth
 * brief, item 10). A change that no longer fits the panel's files is an
 * error, never silently a copy that is not broken.
 */
const SHELL = "static/assets/shell.js";
const ENTRY = "static/assets/entry.js";
const BROKEN = {
  "console-error": [[SHELL, "session().then((ok) => ok && load());", 'console.error("a broken copy"); session().then((ok) => ok && load());']],
  "other-origin": [
    ["server.mjs", "\"img-src 'self' data:\",", "\"img-src 'self' data: http:\","],
    ["static/pages/shell.html", '<main id="main" tabindex="-1">', '<img src="http://127.0.0.2:9/pixel.png" alt="" hidden><main id="main" tabindex="-1">'],
  ],
  overflow: [["static/assets/panel.css", ".backups-list{margin-top:14px}", ".backups-list{margin-top:14px}\n.head{min-width:720px}"]],
  "setup-wrong-code": [[ENTRY, "delete data.again;", 'delete data.again; data.setupCode = "WXYZ-WXYZ-WXYZ-WXYZ";']],
  "sign-in-stays": [[ENTRY, "if (answer.ok) {", 'if (answer.ok && form.id === "setup-form") {']],
  "sign-in-silent": [[ENTRY, "say(message.charAt(0).toUpperCase() + message.slice(1));", 'say("");']],
  "sign-out-fake": [[SHELL, 'await fetch("/api/sign-out"', 'if (0) await fetch("/api/sign-out"']],
  "home-no-action": [[SHELL, 'if (n.kind === "try") return `<a class="btn small pink"', 'if (n.kind === "try") return ""; if (0) return `<a class="btn small pink"']],
  "frame-wrong": [[SHELL, 'src="${esc(hostUrl(d.ports.testCopy))}"', 'src="${esc(hostUrl(d.ports.live))}"']],
  "works-noop": [[SHELL, 'const r = await api("app.markTried", { app: S.app, step: Number(b.dataset.step) });', "const r = { ok: true, result: { left: [0] } };"]],
  "report-lost": [[SHELL, 'const r = await api("app.report", { app: S.app, text: `Step ${step}: ${text}` });', "const r = { ok: true };"]],
  "stop-mute": [[SHELL, "  function stopBox(job, heading) {", '  function stopBox(job, heading) {\n    return "";']],
  "gates-frozen": [[SHELL, "const g = gatesOf(job, gates);", 'const g = gatesOf(job, gates).map(([n]) => [n, "next"]);']],
  "go-back-noop": [[SHELL, 'if (a === "confirm-go-back") { closeModal(); selectTab("live"); return startJob("goBack", "app.goBack", { for: b.dataset.v }); }', 'if (a === "confirm-go-back") { closeModal(); return; }']],
  "machine-stale": [[SHELL, 'const r = await api("machine.status");', 'const r = { ok: false, error: { message: "not asked" } };']],
  "backups-empty": [[SHELL, 'const r = await api("app.backups", { app: S.app });', "const r = { ok: true, result: [] };"]],
  "no-trap": [[SHELL, 'if (modal && e.key === "Tab") {', 'if (false && modal && e.key === "Tab") {']],
  "no-escape": [[SHELL, "if (modal) { e.preventDefault(); closeModal(); return; }", "if (modal) { e.preventDefault(); return; }"]],
  "no-focus-return": [[SHELL, 'back.focus({ preventScroll: back === $("#main") });', "void back;"]],
  "no-arrows": [[SHELL, 'if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {', "if (false && tab) {"]],
  "menu-no-focus": [[SHELL, 'if (S.moreOpen) $("#more-menu button")?.focus();', 'if (0) $("#more-menu button")?.focus();']],
  "no-skip": [["static/pages/shell.html", '<a class="skip" href="#main">Skip to the content</a>', ""]],
};
const inspect = (format) => sh("docker", ["inspect", "-f", format, PANEL]).stdout.trim();
function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    if (inspect("{{.State.Health.Status}}") === "healthy") return true;
    sh("sleep", ["1"]);
  }
  return false;
}
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const must = (what, r) => {
  if (r.status !== 0) {
    process.stderr.write(`${what} failed (${r.status}):\n${(r.stdout ?? "").slice(-1500)}${(r.stderr ?? "").slice(-800)}`);
    process.exit(1);
  }
  return r;
};

const PLAN = {
  title: "Show the weather beside each mood",
  steps: [
    { id: 1, title: "Fetch today's weather for the home town", check: "Open the test copy: today's weather is at the top of the page." },
    { id: 2, title: "Show the weather beside each new mood", check: "Add a mood: the weather shows beside it." },
    { id: 3, title: "Let the home town be changed", check: "Change the home town: the weather changes with it." },
  ],
};

const [action, ...rest] = process.argv.slice(2);
if (action === "plan") {
  const [app, count, label] = rest;
  const repo = `${STATE}/projects/${app}/repo`;
  const plan = { title: label ? `${PLAN.title} (${label})` : PLAN.title, steps: PLAN.steps.slice(0, Number(count)).map((s) => ({ ...s, built: true })) };
  writeFileSync(`${repo}/plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
  const [uid, gid] = [sh("id", ["-u", C]).stdout.trim(), sh("id", ["-g", C]).stdout.trim()].map(Number);
  chownSync(`${repo}/plan.json`, uid, gid);
  must("dev commit", sh(C, ["dev", "commit", app, `The builder: ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"} of the plan built`]));
  const deployed = must("dev deploy", sh(C, ["dev", "deploy", app]));
  console.log(`plan: ${plan.steps.length} steps, built; the test copy deployed (${deployed.stdout.split("\n").filter((l) => l.startsWith("ok")).length} steps ok)`);
} else if (action === "cookies") {
  // What the app receives (D74): a route, added as the builder would, that
  // answers with the names of the cookies the request brought, never their
  // values; committed and deployed to the test copy.
  const [app] = rest;
  const repo = `${STATE}/projects/${app}/repo`;
  const file = `${repo}/server.js`;
  const anchor = '    if (request.method === "GET" && url.pathname === "/") {';
  const route = [
    '    if (request.method === "GET" && url.pathname === "/cookies-received") {',
    '      const names = String(request.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")[0]).filter(Boolean);',
    '      response.writeHead(200, { "Content-Type": "application/json" });',
    "      response.end(JSON.stringify({ cookies: names }));",
    "      return;",
    "    }",
    "",
  ].join("\n");
  const text = readFileSync(file, "utf8");
  if (!text.includes("/cookies-received")) {
    if (!text.includes(anchor)) { process.stderr.write("the app's server.js has no GET / route to put the new one before\n"); process.exit(1); }
    writeFileSync(file, text.replace(anchor, `${route}${anchor}`));
  }
  must("dev commit", sh(C, ["dev", "commit", app, "A route that names the cookies it receives"]));
  must("dev deploy", sh(C, ["dev", "deploy", app]));
  console.log("cookies: /cookies-received, in the test copy");
} else if (action === "stub" || action === "stub-stop") {
  // The stand-in for the model's API (stub-api.mjs), for the chat's check
  // (D77): on the app's dev network, playing two tool calls, a plan with one
  // step written and committed, as the builder would; and Claude Code in the
  // agent pointed at it by the working copy's own local settings, which it
  // reads at its start. Test tooling only: nothing of the suite does this.
  const [app] = rest;
  const name = `${C}-${app}-dev-stubapi`;
  const repo = `${STATE}/projects/${app}/repo`;
  sh("docker", ["rm", "-f", name]);
  rmSync(`${repo}/.claude/settings.local.json`, { force: true });
  if (action === "stub-stop") {
    console.log("stub: gone");
    process.exit(0);
  }
  const plan = { title: "A first step", steps: [{ id: 1, title: "Say hello on the page", check: "Open the test copy: the page says hello.", built: false }] };
  const steps = [
    { name: "Write", input: { file_path: "/workspace/plan.json", content: `${JSON.stringify(plan, null, 2)}\n` } },
    { name: "Bash", input: { command: "git add plan.json && git commit -q -m 'Plan: a first step'", description: "Commit the plan" } },
  ];
  const dir = "/var/tmp/stub-api";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/out`, { recursive: true });
  cpSync("/root/stub-api.mjs", `${dir}/stub-api.mjs`);
  writeFileSync(`${dir}/steps.json`, JSON.stringify(steps));
  must("readable", sh("chmod", ["-R", "a+rX", dir]));
  // What Claude Code sent back for each tool call, for the probe to show when a step goes wrong.
  must("writable", sh("chmod", ["a+rwx", `${dir}/out`]));
  must("the stub", sh("docker", ["run", "-d", "--name", name, "--label", `${C}.test=stub-api`, "--network", `${C}-${app}-dev-internal`, "--read-only", "--cap-drop", "ALL",
    "-e", "STEPS_FILE=/steps.json", "-e", "RESULTS_FILE=/out/results.jsonl", "-v", `${dir}/stub-api.mjs:/stub.mjs:ro`, "-v", `${dir}/steps.json:/steps.json:ro`, "-v", `${dir}/out:/out`,
    "node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1", "node", "/stub.mjs"]));
  // The agent's own exceptions to its egress gate (src/lib/agent.ts, agentRunArgs), and the stub's name.
  const noProxy = [`${C}-${app}-dev-app`, `${C}-${app}-dev-db`, `${C}-${app}-agent-activity`, "localhost", "127.0.0.1"].join(",");
  // Auto mode asks a classifier, through the same API, before a command runs;
  // the stand-in cannot answer it, so the command it plays is allowed here
  // (the deny rules still come first). A person's session asks the real one.
  const settings = {
    env: { ANTHROPIC_BASE_URL: `http://${name}:8080`, NO_PROXY: `${noProxy},${name}`, no_proxy: `${noProxy},${name}` },
    permissions: { allow: ["Bash(git add plan.json)", "Bash(git commit -q -m 'Plan: a first step')"] },
  };
  mkdirSync(`${repo}/.claude`, { recursive: true });
  writeFileSync(`${repo}/.claude/settings.local.json`, `${JSON.stringify(settings, null, 2)}\n`);
  const [uid, gid] = [sh("id", ["-u", C]).stdout.trim(), sh("id", ["-g", C]).stdout.trim()].map(Number);
  chownSync(`${repo}/.claude`, uid, gid);
  chownSync(`${repo}/.claude/settings.local.json`, uid, gid);
  console.log(`stub: ${name}, two tool calls, and the working copy's local settings pointing at it`);
} else if (action === "unplug" || action === "plug") {
  // The test host's mounts are private (Docker's default), so an unmount here
  // does not reach a service with its own mount namespace, as the engine has
  // (ProtectHome): it is done in the engine's view too. On a real machine,
  // systemd shares the mounts, and unplugging the disk reaches every service.
  const pid = sh("systemctl", ["show", "-p", "MainPID", "--value", `${C}-engine`]).stdout.trim();
  const own = pid && pid !== "0" && sh("readlink", [`/proc/${pid}/ns/mnt`]).stdout.trim() !== sh("readlink", ["/proc/1/ns/mnt"]).stdout.trim();
  const views = [["the machine", []], ...(own ? [["the engine", ["nsenter", "-t", pid, "-m", "--"]]] : [])];
  mkdirSync(KEPT, { recursive: true });
  const [from, to] = action === "unplug" ? [DISK, KEPT] : [KEPT, DISK];
  const seen = [];
  for (const [view, prefix] of views) {
    const run = (cmd, a) => (prefix.length ? sh(prefix[0], [...prefix.slice(1), cmd, ...a]) : sh(cmd, a));
    must(`${action}, in ${view}'s view`, run("mount", ["--bind", from, to]));
    must(`${action}, in ${view}'s view`, run("umount", [from]));
    seen.push(`${view}: ${run("mountpoint", ["-q", DISK]).status === 0 ? "mounted" : "not mounted"}`);
  }
  console.log(`backup disk: ${action === "unplug" ? "unplugged" : "plugged in"} (${seen.join("; ")})`);
} else if (action === "setup-code") {
  const status = sh(C, ["panel", "status"]).stdout;
  const r = must("setup code", sh(C, ["panel", /set up: sign in/.test(status) ? "reset" : "setup-code"]));
  const code = /setup code, for your first visit: ([A-Z0-9-]+)/.exec(r.stdout)?.[1];
  if (!code) { process.stderr.write("no setup code in the answer\n"); process.exit(1); }
  console.log(code);
} else if (action === "report") {
  const dir = `${STATE}/projects/${rest[0]}/reports`;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".txt")).sort() : [];
  console.log(files.length ? `${files.at(-1)}\n${readFileSync(`${dir}/${files.at(-1)}`, "utf8")}` : "no reports");
} else if (action === "live") {
  const status = must("status", sh(C, ["project", "status", rest[0]])).stdout;
  console.log(status.split("\n").filter((l) => /prod|live|v\d/.test(l)).slice(0, 6).join("\n"));
} else if (action === "break") {
  const variant = rest[0];
  const changes = BROKEN[variant];
  if (!changes) { process.stderr.write(`no broken copy called ${variant}: ${Object.keys(BROKEN).join(", ")}\n`); process.exit(2); }
  rmSync(COPY, { recursive: true, force: true });
  cpSync(`/opt/${C}/current/panel`, COPY, { recursive: true });
  for (const [file, find, replace] of changes) {
    const text = readFileSync(`${COPY}/${file}`, "utf8");
    if (!text.includes(find)) { process.stderr.write(`the broken copy ${variant} no longer fits ${file}: "${find.slice(0, 70)}" is not there\n`); process.exit(1); }
    writeFileSync(`${COPY}/${file}`, text.replace(find, replace));
  }
  must("readable", sh("chmod", ["-R", "a+rX", COPY]));
  // The real panel's own arguments (src/lib/panel.ts), with the copy mounted over its files.
  const { panelRunArgs } = await import(`/opt/${C}/current/dist/lib/panel.js`);
  const image = inspect("{{.Config.Image}}");
  const ip = inspect("{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}");
  const [uid, gid] = [sh("id", ["-u", PANEL]).stdout.trim(), sh("id", ["-g", PANEL]).stdout.trim()].map(Number);
  if (!image || !ip) { process.stderr.write("the real panel is not running to take the place of\n"); process.exit(1); }
  const args = panelRunArgs(image, ip, uid, gid);
  args.splice(args.length - 1, 0, "--mount", `type=bind,source=${COPY},target=/panel,readonly`, "--label", `${C}.panel-broken=${variant}`);
  must("remove the real panel", sh("docker", ["rm", "-f", PANEL]));
  must("run the broken copy", sh("docker", args));
  if (!waitHealthy()) { process.stderr.write("the broken copy did not become healthy\n"); process.exit(1); }
  console.log(`panel: the broken copy "${variant}" runs in its place (${changes.length} change${changes.length === 1 ? "" : "s"})`);
} else if (action === "mend") {
  const r = must("panel install", sh(C, ["panel", "install"]));
  const left = inspect(`{{index .Config.Labels "${C}.panel-broken"}}`);
  rmSync(COPY, { recursive: true, force: true });
  console.log(`panel: the real one back (${left ? `STILL BROKEN: ${left}` : "no broken copy"}; ${r.stdout.split("\n").filter((l) => /^\s*changed:/.test(l)).length} changed)`);
  if (left) process.exit(1);
} else {
  process.stderr.write("usage: node panel-fixture.mjs plan <app> <steps> [label] | cookies <app> | unplug | plug | setup-code | report <app> | live <app> | break <variant> | mend\n");
  process.exit(2);
}
