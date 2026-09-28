// Unit tests for the agent container's settings (D39, rule 12).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_KEY, agentRunArgs, CLAUDE_CODE_VERSION, egressRunArgs, MODEL_API_HOST } from "../../dist/lib/agent.js";

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
    "/run/allvibe/keys/recipes/agent/ANTHROPIC_API_KEY:/run/secrets/ANTHROPIC_API_KEY:ro",
  ]);
  const withoutKey = agentRunArgs({ project: "recipes", image: "i", uid: 998, gid: 997, keyFile: null });
  assert.equal(withoutKey.filter((a) => a === "-v").length, 1, "no key, no key mount");
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
