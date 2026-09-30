// What Docker could not start, started again (D80), and the panel's fixed addresses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NAMES } from "../../dist/lib/brand.js";
import { keepContainers, startError, toStart } from "../../dist/lib/keeper.js";
import { panelAddresses } from "../../dist/lib/panel.js";

const CGROUP = "failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error setting cgroup config for procHooks process: openat2 /sys/fs/cgroup/system.slice/docker-53bb.scope/pids.max: no such file or directory";
const seen = (over) => ({ name: "x", status: "running", error: "", policy: "unless-stopped", role: "", project: "", ...over });
const app = (over) => seen({ name: "allvibe-hello-prod-app", role: "app", project: "hello", ...over });

test("an app's container Docker could not start is started; one stopped on purpose is not", () => {
  assert.deepEqual(toStart([app({ status: "exited", error: CGROUP })]).map((c) => c.name), ["allvibe-hello-prod-app"]);
  assert.deepEqual(toStart([app({ status: "created", error: "failed to set up container networking: Address already in use" })]).map((c) => c.name), ["allvibe-hello-prod-app"]);
  // The control: the same container, stopped with no error (a person, compose, the CLI), stays stopped.
  assert.deepEqual(toStart([app({ status: "exited" })]), []);
  // Running, or restarting by Docker's own policy: left to Docker.
  assert.deepEqual(toStart([app({ status: "running", error: CGROUP }), app({ status: "restarting", error: CGROUP })]), []);
});

test("its database too; never the agent's, and never one whose policy is not to come back", () => {
  assert.equal(toStart([seen({ name: "allvibe-hello-dev-db", role: "db", project: "hello", status: "exited", error: CGROUP })]).length, 1);
  assert.equal(toStart([seen({ name: "allvibe-hello-agent", role: "agent", project: "hello", status: "exited", error: CGROUP, policy: "no" })]).length, 0);
  assert.equal(toStart([app({ status: "exited", error: CGROUP, policy: "no" })]).length, 0);
  assert.equal(toStart([app({ status: "exited", error: CGROUP, project: "" })]).length, 0);
});

test("the proxy whenever it is not running, with or without an error", () => {
  assert.equal(toStart([seen({ name: NAMES.proxyContainer, role: "proxy", status: "exited" })]).length, 1);
  assert.match(toStart([seen({ name: NAMES.proxyContainer, role: "proxy", status: "created", error: CGROUP })])[0].why, /^Docker could not start it: error setting cgroup config/);
  assert.equal(toStart([seen({ name: NAMES.proxyContainer, role: "proxy", status: "running" })]).length, 0);
});

test("Docker's error, said by its reason and not its layers", () => {
  assert.match(startError(CGROUP), /^error setting cgroup config for procHooks process: openat2 .*pids\.max: no such file or directory$/);
  assert.equal(startError("failed to set up container networking: Address already in use"), "failed to set up container networking: Address already in use");
  assert.ok(startError(`container init: ${"x".repeat(400)}`).length <= 200);
});

test("an app's containers under its lock, databases first; an app whose lock is held is left for the next round", () => {
  const started = [];
  const released = [];
  const list = [
    app({ name: "allvibe-hello-prod-app", status: "exited", error: CGROUP }),
    seen({ name: "allvibe-hello-prod-db", role: "db", project: "hello", status: "exited", error: CGROUP }),
    app({ name: "allvibe-moods-dev-app", project: "moods", status: "exited", error: CGROUP }),
  ];
  const lock = (name) => (name === "moods" ? { ok: false, holder: null, message: "A release of moods is already running, started from the panel just now." } : { ok: true, cleared: null, release: () => released.push(name) });
  // Docker is not asked here: the lines say what would have been started, in order.
  const lines = keepContainers(list, lock, (c) => {
    started.push(c.name);
    return `${c.name} started again (${c.why})`;
  });
  assert.deepEqual(started, ["allvibe-hello-prod-db", "allvibe-hello-prod-app"]);
  assert.deepEqual(released, ["hello"]);
  assert.ok(lines.some((l) => /^moods: allvibe-moods-dev-app not started yet: A release of moods is already running/.test(l)), lines.join("\n"));
});

test("the panel's network: the panel and its door at fixed addresses, anything else from the upper half", () => {
  // A documentation range stands for the last /24 of Docker's first pool (mistake 22).
  assert.deepEqual(panelAddresses("198.51.100.0/24"), { gateway: "198.51.100.1", panel: "198.51.100.2", door: "198.51.100.3", range: "198.51.100.128/25" });
});
