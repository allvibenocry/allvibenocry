// Unit tests for the agent container's settings (D39, rule 12).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_KEY, agentRunArgs, ALLOWED_HOSTS, CLAUDE_CODE_VERSION, egressRunArgs, MODEL_API_HOST, PERMISSION_MODE, PERMISSION_MODE_REVIEWED_WITH } from "../../dist/lib/agent.js";
import { parseSignIn, unattendedClaude } from "../../dist/commands/agent.js";

const read = (file) => readFileSync(new URL(`../../agent/${file}`, import.meta.url), "utf8");
const args = agentRunArgs({ project: "recipes", image: "allvibe-agent:x", uid: 998, gid: 997, keyFile: "/run/allvibe/keys/recipes/agent/ANTHROPIC_API_KEY" });
const values = (flag) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));

test("rule 12: no Docker socket, no host network, not privileged, no host key, recovery key, backup target or prod", () => {
  const all = args.join(" ");
  for (const flag of ["--privileged", "--pid", "--ipc", "--cap-add", "--device", "--userns", "--uts"]) {
    assert.ok(!args.some((a) => a === flag || a.startsWith(`${flag}=`)), `no ${flag}`);
  }
  for (const forbidden of ["docker.sock", "/etc/allvibe", "backup-host.key", "recovery", "/mnt/"]) {
    assert.ok(!all.includes(forbidden), `nothing like ${forbidden}`);
  }
  assert.ok(!/--net(work)?[= ]host/.test(all), "not the host's network");
  assert.ok(!all.includes("prod"), "nothing of prod's");
});

test("one network, dev's; one working copy; the key as one read-only file", () => {
  assert.deepEqual(values("--network"), ["allvibe-recipes-dev-internal"]);
  assert.deepEqual(values("-v"), [
    "/var/lib/allvibe/projects/recipes/repo:/workspace",
    "/var/lib/allvibe/projects/recipes/agent/transcripts:/agent-transcripts",
    "/run/allvibe/keys/recipes/agent/ANTHROPIC_API_KEY:/run/secrets/ANTHROPIC_API_KEY:ro",
  ]);
  const withoutKey = agentRunArgs({ project: "recipes", image: "i", uid: 998, gid: 997, keyFile: null });
  assert.equal(withoutKey.filter((a) => a === "-v").length, 2, "no key, no key mount");
});

test("not root, no capabilities, read-only, limited, never restarted by itself", () => {
  assert.deepEqual(values("--user"), ["998:997"]);
  assert.deepEqual(values("--cap-drop"), ["ALL"]);
  assert.ok(args.includes("--read-only"));
  assert.deepEqual(values("--security-opt"), ["no-new-privileges:true"]);
  assert.deepEqual(values("--memory"), ["2g"]);
  assert.deepEqual(values("--cpus"), ["2"]);
  assert.deepEqual(values("--pids-limit"), ["512"]);
  assert.deepEqual(values("--restart"), ["no"]);
});

test("its key is never an environment variable; its way out is the egress gate", () => {
  const env = values("-e");
  assert.ok(!env.some((e) => e.startsWith(`${AGENT_KEY}=`)), "no key in the environment");
  assert.ok(env.includes("HTTPS_PROXY=http://allvibe-recipes-agent-egress:3128"));
  assert.ok(env.some((e) => e.startsWith("NO_PROXY=allvibe-recipes-dev-app,allvibe-recipes-dev-db")));
});

test("the egress gate allows the model's API only", () => {
  const egress = egressRunArgs("recipes", "/opt/allvibe/current/agent/egress.mjs");
  assert.ok(egress.includes(`ALLOW=${MODEL_API_HOST}`));
  assert.equal(MODEL_API_HOST, "api.anthropic.com");
  assert.ok(egress.includes("--read-only") && egress.includes("ALL"));
});

test("Claude Code is pinned: an exact version, locked with integrity hashes, on pinned images", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.dependencies["@anthropic-ai/claude-code"], CLAUDE_CODE_VERSION);
  const main = lock.packages["node_modules/@anthropic-ai/claude-code"];
  assert.equal(main.version, CLAUDE_CODE_VERSION);
  assert.match(main.integrity, /^sha512-/);
  assert.match(lock.packages["node_modules/@anthropic-ai/claude-code-linux-x64"].integrity, /^sha512-/);
  for (const from of read("Dockerfile").split("\n").filter((l) => l.startsWith("FROM "))) {
    assert.match(from, /@sha256:[0-9a-f]{64}/, `pinned by digest: ${from}`);
  }
  assert.match(read("Dockerfile"), /DISABLE_AUTOUPDATER=1/);
});

test("the agent reads its key through apiKeyHelper, from the vault's file", () => {
  const entry = read("entrypoint.sh");
  assert.match(entry, /apiKeyHelper/);
  assert.match(entry, /cat \/run\/secrets\/ANTHROPIC_API_KEY/);
});

/* ------------------------------------------- signing in with an account (D46) -- */

const account = agentRunArgs({ project: "recipes", image: "i", uid: 998, gid: 997, keyFile: null, signIn: "account" });
const valuesOf = (list, flag) => list.flatMap((a, i) => (list[i - 1] === flag ? [a] : []));

test("with an account: no key file, the working copy only, and it says how it signs in", () => {
  assert.deepEqual(valuesOf(account, "-v"), ["/var/lib/allvibe/projects/recipes/repo:/workspace", "/var/lib/allvibe/projects/recipes/agent/transcripts:/agent-transcripts"]);
  assert.ok(!account.join(" ").includes(AGENT_KEY), "nothing of the key");
  assert.ok(valuesOf(account, "-e").includes("AGENT_SIGN_IN=account"));
  assert.ok(valuesOf(account, "--label").includes("allvibe.sign-in=account"));
  assert.ok(valuesOf(args, "-e").includes("AGENT_SIGN_IN=key"), "a key when not said");
  assert.throws(() => agentRunArgs({ project: "recipes", image: "i", uid: 1, gid: 1, keyFile: "/run/x", signIn: "account" }), /no key file/);
});

test("its home, where a login would be, is in memory only: a tmpfs, no swap, and no mount or volume", () => {
  for (const list of [args, account]) {
    const home = valuesOf(list, "--tmpfs").find((t) => t.startsWith("/home/agent:"));
    assert.ok(home, "a tmpfs for its home");
    assert.match(home, /mode=0700/);
    assert.deepEqual(valuesOf(list, "--memory-swap"), valuesOf(list, "--memory"), "a swap limit of nothing");
    assert.ok(!valuesOf(list, "-v").some((v) => v.includes("/home/")), "no bind mount for its home");
    assert.ok(!list.some((a) => a === "--mount" || a === "--volume" || a.startsWith("--volume=") || a === "--volumes-from"), "no volume");
  }
});

test("the gate's list, per sign-in: the model's API with a key; that and the two sign-in hosts with an account", () => {
  assert.deepEqual(ALLOWED_HOSTS.key, [MODEL_API_HOST]);
  assert.deepEqual(ALLOWED_HOSTS.account, ["api.anthropic.com", "claude.ai", "platform.claude.com"]);
  const gate = egressRunArgs("recipes", "/opt/allvibe/current/agent/egress.mjs", "account");
  assert.ok(gate.includes("ALLOW=api.anthropic.com,claude.ai,platform.claude.com"));
  assert.ok(gate.includes("allvibe.sign-in=account"));
  assert.ok(egressRunArgs("recipes", "/x").includes(`ALLOW=${MODEL_API_HOST}`), "a key when not said");
});

test("--sign-in: key or account, nothing else", () => {
  assert.equal(parseSignIn([]), "key");
  assert.equal(parseSignIn(["--sign-in", "account"]), "account");
  assert.equal(parseSignIn(["--sign-in=account"]), "account");
  assert.equal(parseSignIn(["--sign-in", "key"]), "key");
  assert.equal(parseSignIn(["--sign-in", "token"]), null);
  assert.equal(parseSignIn(["--sign-in"]), null);
  assert.equal(parseSignIn(["--sign-in", "account", "extra"]), null);
});

test("with an account, Claude Code never runs unattended: not with -p, not without a terminal (D48)", () => {
  assert.equal(unattendedClaude([], true), false, "its own session, in a terminal");
  assert.equal(unattendedClaude([], false), true, "no terminal");
  assert.equal(unattendedClaude(["claude", "-p", "hello"], true), true);
  assert.equal(unattendedClaude(["claude", "--print", "hello"], true), true);
  assert.equal(unattendedClaude(["/usr/local/bin/claude", "-p", "x"], true), true);
  assert.equal(unattendedClaude(["claude", "--version"], false), true, "no terminal, no Claude Code");
  assert.equal(unattendedClaude(["claude", "--continue"], true), false);
  assert.equal(unattendedClaude(["git", "log"], false), false, "other commands are not Claude Code");
});

test("its settings: auto mode set explicitly, connectors off, and the key helper only with a key", () => {
  const entry = read("entrypoint.sh");
  assert.equal(PERMISSION_MODE, "auto");
  assert.ok(entry.includes(`"defaultMode": "${PERMISSION_MODE}"`));
  assert.match(entry, /"disableClaudeAiConnectors": true/);
  assert.match(entry, /\$\{AGENT_SIGN_IN:-key\}" = key \] && \[ -r \/run\/secrets\/ANTHROPIC_API_KEY/);
  assert.ok(!/forceLoginMethod|forceLoginOrgUUID|disableAutoMode/.test(entry), "no sign-in method restricted");
});

test("the permission mode was reviewed for the pinned Claude Code (D47)", () => {
  assert.equal(
    PERMISSION_MODE_REVIEWED_WITH,
    CLAUDE_CODE_VERSION,
    "a new Claude Code version: read its permission modes page, record what changed in D47, then set PERMISSION_MODE_REVIEWED_WITH",
  );
});
