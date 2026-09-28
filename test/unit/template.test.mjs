// Unit tests for the documents every new project starts with (D36).
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fillPlaceholders, PROJECT_DOCS, renderProjectDocs } from "../../dist/lib/template.js";

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "guestbook");
const values = { PROJECT: "recipes", COMMAND: "allvibe", DATE: "2026-09-28" };

/** A project as `project create` makes it: the template copied, its documents filled in. */
function created() {
  const dir = mkdtempSync(path.join(tmpdir(), "template-test-"));
  cpSync(TEMPLATE, dir, { recursive: true });
  renderProjectDocs(dir.split(path.sep).join("/"), values);
  const read = (name) => readFileSync(path.join(dir, name), "utf8");
  return { dir, read };
}

test("a new project gets AGENTS.md, CLAUDE.md, STATE.md and DECISIONS.md, with nothing left unfilled", () => {
  const { dir, read } = created();
  try {
    for (const name of PROJECT_DOCS) {
      const text = read(name);
      assert.ok(text.length > 100, `${name} has content`);
      assert.doesNotMatch(text, /\{\{/, `${name} has no placeholder left`);
    }
    assert.match(read("STATE.md"), /^# recipes: where things stand/);
    assert.match(read("DECISIONS.md"), /\*2026-09-28\*/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AGENTS.md says what the brief asks, in its own sections", () => {
  const { dir, read } = created();
  try {
    const agents = read("AGENTS.md");
    const headings = [...agents.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, [
      "Who you are working for",
      "Start with a plan",
      "Build one step at a time",
      "Stop after each step",
      "Keep STATE.md and DECISIONS.md current",
      "Where you work, and what you can never reach",
      "Changing the database",
      "Keys and passwords",
      "Commits",
    ]);
    const section = (name) => agents.split(`## ${name}`)[1].split("\n## ")[0];
    assert.match(section("Start with a plan"), /short numbered plan/);
    assert.match(section("Start with a plan"), /check they can try themselves/);
    assert.match(section("Stop after each step"), /Stop, and wait/);
    assert.match(section("Stop after each step"), /allvibe dev deploy recipes/);
    assert.match(section("Changing the database"), /Only add/);
    assert.match(section("Changing the database"), /-- breaking: <what it changes>/);
    assert.match(section("Keys and passwords"), /Never put a key, a password or any other secret in the code/);
    assert.match(section("Keys and passwords"), /allvibe key set recipes dev/);
    assert.match(section("Keys and passwords"), /_FILE/);
    assert.match(section("Who you are working for"), /No jargon/);
    assert.match(section("Where you work, and what you can never reach"), /allvibe-recipes-dev-app:3000/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLAUDE.md points to AGENTS.md, and imports it", () => {
  const { dir, read } = created();
  try {
    const claude = read("CLAUDE.md");
    assert.match(claude, /AGENTS\.md/);
    assert.match(claude, /^@AGENTS\.md$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("STATE.md has the sections the agent keeps current", () => {
  const { dir, read } = created();
  try {
    const headings = [...read("STATE.md").matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ["What the app does now", "The plan", "Done", "Next", "Waiting for you"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a placeholder with no value is an error, not left behind", () => {
  assert.throws(() => fillPlaceholders("{{UNKNOWN}}", values), /no value/);
  assert.equal(fillPlaceholders("{{PROJECT}} on {{DATE}}", values), "recipes on 2026-09-28");
});
