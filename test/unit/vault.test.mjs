// Unit tests for the key vault's names, input and compose files (D37).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../../dist/lib/config.js";
import { composeFor, portsForSlot } from "../../dist/lib/project.js";
import { keyNameProblem, runtimeFile, scopeProblem, secretPath, valueFromInput } from "../../dist/lib/vault.js";

const project = { name: "guestbook", slot: 0, created: "", template: "guestbook", ports: portsForSlot(DEFAULT_CONFIG, 0), releases: [] };

test("key names: capitals, digits and underscores; not the suite's own; not ending in _FILE", () => {
  assert.equal(keyNameProblem("WEATHER_API_KEY"), null);
  assert.equal(keyNameProblem("ANTHROPIC_API_KEY"), null);
  assert.match(keyNameProblem("weather"), /capital/);
  assert.match(keyNameProblem("X"), /2-64/);
  assert.match(keyNameProblem("1KEY"), /starting with a letter/);
  assert.match(keyNameProblem("DATABASE_PASSWORD"), /suite's own/);
  assert.match(keyNameProblem("ALLVIBE_THING"), /suite's own/);
  assert.match(keyNameProblem("TOKEN_FILE"), /_FILE/);
});

test("scopes: dev, prod and agent, nothing else", () => {
  for (const scope of ["dev", "prod", "agent"]) assert.equal(scopeProblem(scope), null);
  assert.match(scopeProblem("staging"), /dev, prod or agent/);
});

test("a value from standard input: one trailing newline dropped, and never empty, huge or binary", () => {
  assert.equal(valueFromInput(Buffer.from("abc\n")), "abc");
  assert.equal(valueFromInput(Buffer.from("abc\r\n")), "abc");
  assert.equal(valueFromInput(Buffer.from("abc\n\n")), "abc\n");
  assert.equal(valueFromInput(Buffer.from("a b c")), "a b c");
  assert.throws(() => valueFromInput(Buffer.from("")), /empty/);
  assert.throws(() => valueFromInput(Buffer.from("\n")), /empty/);
  assert.throws(() => valueFromInput(Buffer.alloc(70 * 1024, 65)), /more than/);
  assert.throws(() => valueFromInput(Buffer.from([0x61, 0x00, 0x62])), /not text/);
  assert.throws(() => valueFromInput(Buffer.from([0x61, 0xff, 0xfe])), /not text/);
});

test("compose: each key a file at /run/secrets/<NAME>, its path, never its value, in <NAME>_FILE", () => {
  const dev = JSON.parse(composeFor(project, "dev", "dev", ["WEATHER_API_KEY"]));
  assert.deepEqual(dev.services.app.secrets, ["db_password", { source: "key_WEATHER_API_KEY", target: "WEATHER_API_KEY" }]);
  assert.equal(dev.services.app.environment.WEATHER_API_KEY_FILE, "/run/secrets/WEATHER_API_KEY");
  assert.equal(secretPath("WEATHER_API_KEY"), "/run/secrets/WEATHER_API_KEY");
  assert.equal(dev.secrets.key_WEATHER_API_KEY.file, runtimeFile("guestbook", "dev", "WEATHER_API_KEY"));
  assert.equal(dev.services.db.secrets.length, 1, "the database gets only its password");
});

test("compose: dev mounts only dev's copies, prod only prod's, both from memory", () => {
  const dev = JSON.parse(composeFor(project, "dev", "dev", ["WEATHER_API_KEY"]));
  const prod = JSON.parse(composeFor(project, "prod", "v1", ["WEATHER_API_KEY"]));
  assert.match(dev.secrets.key_WEATHER_API_KEY.file, /^\/run\/allvibe\/keys\/guestbook\/dev\//);
  assert.match(prod.secrets.key_WEATHER_API_KEY.file, /^\/run\/allvibe\/keys\/guestbook\/prod\//);
  assert.ok(!JSON.stringify(dev).includes("/prod/"), "nothing of prod's in dev's compose file");
});

test("compose: no keys, nothing changes", () => {
  assert.equal(composeFor(project, "prod", "v1"), composeFor(project, "prod", "v1", []));
  const prod = JSON.parse(composeFor(project, "prod", "v1"));
  assert.deepEqual(prod.services.app.secrets, ["db_password"]);
});
