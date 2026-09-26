// Unit tests for release versions and what a rollback goes back to.
import assert from "node:assert/strict";
import { test } from "node:test";
import { currentRelease, nextVersion, previousRelease } from "../../dist/lib/project.js";

const release = (version, from) => ({ version, commit: `${version}c`, image: `x:${version}`, at: "", backup: null, ...(from !== undefined ? { from } : {}) });
const project = (releases, current) => ({ name: "p", slot: 0, created: "", template: "t", ports: {}, releases, ...(current ? { current } : {}) });

test("the next version is never reused, even after a rollback", () => {
  assert.equal(nextVersion(project([release("v1")])), "v2");
  assert.equal(nextVersion(project([release("v1"), release("v2"), release("v3")], "v1")), "v4");
});

test("current: the last release, or the one a rollback went back to", () => {
  assert.equal(currentRelease(project([release("v1"), release("v2")])).version, "v2");
  assert.equal(currentRelease(project([release("v1"), release("v2")], "v1")).version, "v1");
});

test("a rollback goes back to what prod ran when the current version was released", () => {
  // v1, then v2, rolled back to v1, then v3 released on top of v1.
  const p = project([release("v1", null), release("v2", "v1"), release("v3", "v1")], "v3");
  assert.equal(previousRelease(p).version, "v1", "not v2, which is only earlier in the list");
  assert.equal(previousRelease(project([release("v1", null)])), null, "nothing before the first");
});

test("releases recorded without a from fall back to the list's order", () => {
  assert.equal(previousRelease(project([release("v1"), release("v2")])).version, "v1");
});
