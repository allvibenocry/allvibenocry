// Unit tests for the plan and the steps the person has tried (D56).
import assert from "node:assert/strict";
import { test } from "node:test";
import { gate, markFor, parsePlan, planKey, stepKey } from "../../dist/lib/plan.js";
import { releaseArgs } from "../../dist/commands/release.js";

const plan = {
  title: "Let guests add a photo",
  steps: [
    { id: 1, title: "A photo button on the form", check: "Pick a photo; you see it before you post.", built: true },
    { id: 2, title: "Photos are kept with the message", check: "Post one, restart the test copy: it is still there.", built: true },
  ],
};
const raw = JSON.stringify(plan);
const mark = (p, s) => ({ step: s.id, key: stepKey(p, s), title: s.title, at: "2026-09-29T10:00:00.000Z", commit: "abc123" });

test("plan.json: read and checked; anything about trying is ignored", () => {
  assert.deepEqual(parsePlan(raw).plan, plan);
  const withTried = JSON.stringify({ ...plan, steps: plan.steps.map((s) => ({ ...s, tried: true })) });
  assert.deepEqual(parsePlan(withTried).plan, plan, "a tried field the agent writes is not kept");
  assert.match(parsePlan("{").problem, /not valid JSON/);
  assert.match(parsePlan(JSON.stringify({ steps: [] })).problem, /no title/);
  assert.match(parsePlan(JSON.stringify({ title: "x", steps: [{ id: 1, title: "t" }] })).problem, /no check/);
  assert.match(parsePlan(JSON.stringify({ title: "x", steps: [{ id: 1, title: "t", check: "c" }, { id: 1, title: "u", check: "d" }] })).problem, /repeats the number 1/);
});

test("a mark belongs to the step's words: changed words make it untried", () => {
  const marks = [mark(plan, plan.steps[0])];
  assert.ok(markFor(plan, plan.steps[0], marks));
  const reworded = { ...plan, steps: [{ ...plan.steps[0], check: "Something else." }, plan.steps[1]] };
  assert.equal(markFor(reworded, reworded.steps[0], marks), null);
  const retitled = { ...plan, title: "Another plan" };
  assert.equal(markFor(retitled, retitled.steps[0], marks), null, "the same step in another plan is not tried");
});

test("the gate: none, invalid, untried, tried, and spent once released", () => {
  assert.equal(gate(null, [], []).state, "none");
  assert.equal(gate(JSON.stringify({ title: "x", steps: [] }), [], []).state, "none");
  assert.equal(gate("not json", [], []).state, "invalid");
  const one = gate(raw, [mark(plan, plan.steps[0])], []);
  assert.equal(one.state, "untried");
  assert.deepEqual(one.untried.map((s) => s.id), [2]);
  const all = gate(raw, plan.steps.map((s) => mark(plan, s)), []);
  assert.equal(all.state, "tried");
  assert.equal(all.marks.length, 2);
  const spent = gate(raw, plan.steps.map((s) => mark(plan, s)), [{ version: "v3", plan: { key: planKey(plan) } }]);
  assert.equal(spent.state, "spent");
  assert.equal(spent.releasedIn, "v3");
});

test("release: --outside-plan needs a reason, and keeps it", () => {
  assert.deepEqual(releaseArgs(["moods"]), { name: "moods", dryRun: false, outsidePlan: null });
  assert.deepEqual(releaseArgs(["moods", "--outside-plan", "a fix of the heading, by hand"]), { name: "moods", dryRun: false, outsidePlan: "a fix of the heading, by hand" });
  assert.deepEqual(releaseArgs(["--outside-plan=typo fix", "moods", "--dry-run"]), { name: "moods", dryRun: true, outsidePlan: "typo fix" });
  assert.match(releaseArgs(["moods", "--outside-plan"]).error, /needs a reason/);
  assert.match(releaseArgs(["moods", "--outside-plan", "--dry-run"]).error, /needs a reason/);
  assert.match(releaseArgs(["moods", "--outside-plan", "  "]).error, /needs a reason/);
  assert.match(releaseArgs(["moods", "extra"]).error, /usage/);
});
