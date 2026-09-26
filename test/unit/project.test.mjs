// Unit tests for projects: names, ports, the generated compose file and proxy blocks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../../dist/lib/config.js";
import { composeFor, nameProblem, portsForSlot, serverConf } from "../../dist/lib/project.js";

const FORBIDDEN = ["no", "cry"].join("");

const project = {
  name: "guestbook",
  slot: 0,
  created: "2026-09-27T00:00:00Z",
  template: "guestbook",
  ports: portsForSlot(DEFAULT_CONFIG, 0),
  releases: [],
};

test("project names: plain, and never the forbidden word (rule 9)", () => {
  assert.equal(nameProblem("guestbook"), null);
  assert.equal(nameProblem("my-shop2"), null);
  assert.match(nameProblem("Guestbook"), /lowercase/);
  assert.match(nameProblem("a"), /2-30/);
  assert.match(nameProblem("bad-"), /dash/);
  assert.match(nameProblem("a--b"), /dash/);
  assert.match(nameProblem(`my${FORBIDDEN}app`), /rule 9/);
  assert.match(nameProblem("proxy"), /reserved/);
});

test("ports: prod even, dev odd, apps 10000 above, one pair per slot", () => {
  assert.deepEqual(portsForSlot(DEFAULT_CONFIG, 0), { prod: 8100, dev: 8101, prodApp: 18100, devApp: 18101 });
  assert.deepEqual(portsForSlot(DEFAULT_CONFIG, 3), { prod: 8106, dev: 8107, prodApp: 18106, devApp: 18107 });
});

test("compose: dev and prod share no network, volume or secret", () => {
  const dev = JSON.parse(composeFor(project, "dev", "dev"));
  const prod = JSON.parse(composeFor(project, "prod", "v1"));
  const networks = (c) => Object.values(c.networks).map((n) => n.name);
  assert.equal(networks(dev).filter((n) => networks(prod).includes(n)).length, 0);
  assert.notEqual(dev.volumes.db.name, prod.volumes.db.name);
  assert.notEqual(dev.secrets.db_password.file, prod.secrets.db_password.file);
  assert.match(dev.secrets.db_password.file, /secrets\/dev\/db_password$/);
  assert.match(prod.secrets.db_password.file, /secrets\/prod\/db_password$/);
});

test("compose: the database is internal only, the app publishes on loopback only, no password in the environment", () => {
  const prod = JSON.parse(composeFor(project, "prod", "v1"));
  assert.deepEqual(prod.services.db.networks, ["internal"]);
  assert.equal(prod.networks.internal.internal, true);
  assert.equal(prod.services.db.ports, undefined);
  assert.deepEqual(prod.services.app.ports, ["127.0.0.1:18100:3000"]);
  const env = JSON.stringify([prod.services.app.environment, prod.services.db.environment]);
  assert.ok(!/PASSWORD"\s*:\s*"(?!\/run\/secrets)/.test(env), "passwords are only ever files");
  assert.equal(prod.services.app.environment.DATABASE_PASSWORD_FILE, "/run/secrets/db_password");
  assert.equal(prod.services.db.environment.POSTGRES_PASSWORD_FILE, "/run/secrets/db_password");
});

test("proxy: prod refuses every Docker range, dev does not, both IPv4 only", () => {
  // The pool, and a documentation range standing in for the default bridge.
  const prod = serverConf(project, "prod", ["172.20.0.0/14", "198.51.100.0/24"]);
  const dev = serverConf(project, "dev");
  assert.match(prod, /listen 0\.0\.0\.0:8100;/);
  assert.match(prod, /deny 172\.20\.0\.0\/14;/);
  assert.match(prod, /deny 198\.51\.100\.0\/24;/);
  assert.match(prod, /proxy_pass http:\/\/127\.0\.0\.1:18100;/);
  assert.match(dev, /listen 0\.0\.0\.0:8101;/);
  assert.doesNotMatch(dev, /deny/);
  assert.doesNotMatch(prod + dev, /listen \[::\]/);
});

test("nothing the suite names for a project contains the forbidden word", () => {
  const all = composeFor(project, "dev", "dev") + composeFor(project, "prod", "v1");
  assert.ok(!all.toLowerCase().includes(FORBIDDEN));
});
