// A new project carries no local allow of any kind (D81). The stand-in's allow
// in a working copy's local settings (D77) is a test fixture; the template every
// real project is made from, and the settings the agent's image gives Claude
// Code, allow nothing, widen nothing and skip no question.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PATTERNS = [/"allow"\s*:/, /allowedTools/, /allowed-tools/, /dangerously-skip-permissions/, /bypassPermissions/, /"additionalDirectories"/];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

test("the project template: no Claude Code settings file, and nothing in any file that allows", () => {
  const all = files(path.join(ROOT, "templates"));
  assert.ok(all.length > 5, `files looked at: ${all.length}`);
  assert.deepEqual(all.map(rel).filter((f) => /(^|\/)\.claude(\/|$)|settings\.local\.json$/.test(f)), []);
  const allowing = all.filter((f) => PATTERNS.some((p) => p.test(readFileSync(f, "utf8")))).map(rel);
  assert.deepEqual(allowing, []);
});

test("the agent's image: its settings allow nothing, and its mode is auto, never one that skips questions", () => {
  const managed = readFileSync(path.join(ROOT, "agent", "managed-settings.json"), "utf8");
  const entrypoint = readFileSync(path.join(ROOT, "agent", "entrypoint.sh"), "utf8");
  for (const [name, text] of [["managed-settings.json", managed], ["entrypoint.sh", entrypoint]]) {
    for (const p of PATTERNS) assert.ok(!p.test(text), `${name}: ${p}`);
  }
  assert.equal(JSON.parse(managed).permissions, undefined);
  assert.match(entrypoint, /"permissions": \{ "defaultMode": "auto" \}/);
});

test("the patterns find what they look for (the control)", () => {
  const planted = [
    '{ "permissions": { "allow": ["Bash(git commit:*)"] } }',
    "claude --allowedTools Bash",
    "claude --dangerously-skip-permissions",
    '{ "permissions": { "defaultMode": "bypassPermissions" } }',
    '{ "permissions": { "additionalDirectories": ["/"] } }',
  ];
  for (const text of planted) assert.ok(PATTERNS.some((p) => p.test(text)), text);
  assert.ok(!PATTERNS.some((p) => p.test("Nothing here allows a tool.")));
});
