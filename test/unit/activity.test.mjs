// Unit tests for the agent's activity log and kept conversations (D60).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { activityRunArgs, agentRunArgs } from "../../dist/lib/agent.js";
import { activityLine } from "../../dist/commands/agent.js";
import { entryOf } from "../../agent/activity-hook.mjs";
import { clean, gather, holdsSecret, WITHHELD } from "../../agent/activity.mjs";

const read = (file) => readFileSync(new URL(`../../agent/${file}`, import.meta.url), "utf8");
const values = (list, flag) => list.flatMap((a, i) => (list[i - 1] === flag ? [a] : []));

test("the hook's line: the tool, a path or the command's first line, how it went; never contents", () => {
  assert.deepEqual(entryOf({ hook_event_name: "PostToolUse", session_id: "s-1", tool_use_id: "toolu_1", tool_name: "Bash", tool_input: { command: "ls /workspace" } }), { tool: "Bash", target: "ls /workspace", outcome: "ok", session: "s-1", id: "toolu_1" });
  const heredoc = entryOf({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "cat > a.js <<'EOF'\nconst secret = 1;\nEOF" } });
  assert.equal(heredoc.target, "cat > a.js <<'EOF' (and 2 more lines, not logged)");
  const write = entryOf({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "/workspace/a.js", content: "the file's words" } });
  assert.equal(write.target, "/workspace/a.js");
  assert.ok(!JSON.stringify(write).includes("the file's words"));
  assert.equal(entryOf({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" } }).outcome, "failed");
  assert.equal(entryOf({ tool_name: "Bash", tool_input: { command: "x".repeat(500) } }).target.length, 300);
});

test("the logger takes only the hook's shape, and fails closed when it cannot scan", () => {
  assert.deepEqual(clean({ tool: "Bash", target: "ls", outcome: "ok", session: "s-1", id: "toolu_1" }), { session: "s-1", id: "toolu_1", tool: "Bash", target: "ls", outcome: "ok" });
  assert.equal(clean({ tool: "Bash", target: "ls", outcome: "ok", id: "toolu 1;" }), null);
  assert.equal(clean({ tool: "Bash; rm", target: "ls", outcome: "ok" }), null);
  assert.equal(clean({ tool: "Bash", target: "ls", outcome: "maybe" }), null);
  assert.equal(clean({ tool: "Bash", target: "x".repeat(500), outcome: "ok" }), null);
  assert.equal(clean({ tool: "Bash", target: "a\u0007b", outcome: "ok" }).target, "a b");
  assert.equal(holdsSecret("ls /workspace", "/no/such/scanner"), true, "no scanner: nothing is written as it is");
  assert.equal(holdsSecret(""), false);
  assert.match(WITHHELD, /not logged/);
});

test("the agent gets its transcripts directory and nothing else of what it leaves; the log is only the logger's", () => {
  const agent = agentRunArgs({ project: "recipes", image: "i", uid: 998, gid: 997, keyFile: null, signIn: "account" });
  const mounts = values(agent, "-v");
  assert.ok(mounts.includes("/var/lib/allvibe/projects/recipes/agent/transcripts:/agent-transcripts"));
  assert.ok(!mounts.some((m) => m.includes("/agent/log")), "the log is not the agent's");
  assert.ok(!mounts.some((m) => m.includes(".claude")), "nothing of Claude Code's own home, its login least of all");
  assert.ok(values(agent, "-e").includes("AGENT_ACTIVITY_URL=http://allvibe-recipes-agent-activity:3129/log"));
  const logger = activityRunArgs("recipes", "/opt/allvibe/current/agent/activity.mjs", 998, 997, "/var/lib/allvibe/tools/gitleaks-8.30.1/gitleaks");
  assert.deepEqual(values(logger, "--network"), ["allvibe-recipes-dev-internal"], "dev's internal network only: no way out");
  assert.deepEqual(values(logger, "--user"), ["998:997"]);
  assert.ok(logger.includes("--read-only") && values(logger, "--cap-drop").includes("ALL"));
  assert.ok(values(logger, "-v").includes("/var/lib/allvibe/projects/recipes/agent/log:/log"));
  assert.ok(values(logger, "-e").includes("AGENT_HOST=allvibe-recipes-agent"));
});

test("the hook is in Claude Code's managed settings, which a project's settings cannot turn off", () => {
  const managed = JSON.parse(read("managed-settings.json"));
  for (const event of ["PostToolUse", "PostToolUseFailure"]) {
    assert.equal(managed.hooks[event][0].matcher, "*");
    assert.equal(managed.hooks[event][0].hooks[0].command, "node /usr/local/lib/agent/activity-hook.mjs");
  }
  assert.deepEqual(Object.keys(managed), ["hooks"], "nothing else is set there");
  assert.match(read("Dockerfile"), /COPY managed-settings.json \/etc\/claude-code\/managed-settings.json/);
  assert.match(read("entrypoint.sh"), /ln -sfn \/agent-transcripts "\$HOME\/.claude\/projects\/-workspace"/);
  assert.equal(activityLine('{"at":"2026-09-29T10:00:00.000Z","tool":"Bash","target":"ls","outcome":"failed"}'), "2026-09-29 10:00:00  ! Bash       ls");
});

test("one line per tool call, failed if either of its events says so", async () => {
  const lines = [];
  gather({ id: "t-1", tool: "Bash", target: "ls /x", outcome: "failed", session: "" }, (l) => lines.push(l), 50);
  gather({ id: "t-1", tool: "Bash", target: "ls /x", outcome: "ok", session: "" }, (l) => lines.push(l), 50);
  gather({ id: "t-2", tool: "Bash", target: "ls /y", outcome: "ok", session: "" }, (l) => lines.push(l), 50);
  gather({ id: "t-2", tool: "Bash", target: "ls /y", outcome: "failed", session: "" }, (l) => lines.push(l), 50);
  gather({ id: "", tool: "Read", target: "/a", outcome: "ok", session: "" }, (l) => lines.push(l), 50);
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(lines.map((l) => `${l.tool} ${l.target} ${l.outcome}`), ["Read /a ok", "Bash ls /x failed", "Bash ls /y failed"]);
});
