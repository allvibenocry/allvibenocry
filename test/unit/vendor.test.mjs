// The panel's bundled libraries (D77, rule 15): each file exactly as the
// pinned version publishes it, by its SHA-256, and nothing in the panel's
// files that is not listed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PANEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "panel");
const manifest = JSON.parse(readFileSync(path.join(PANEL, "vendor.json"), "utf8"));

test("every bundled file is the pinned version's own, by its checksum", () => {
  for (const pkg of manifest.packages) {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, `${pkg.name}: an exact version`);
    assert.match(pkg.integrity, /^sha512-/, `${pkg.name}: npm's integrity`);
    for (const [file, { sha256 }] of Object.entries(pkg.files)) {
      const seen = createHash("sha256").update(readFileSync(path.join(PANEL, file))).digest("hex");
      assert.equal(seen, sha256, file);
      assert.ok(file.includes(`-${pkg.version}/`), `${file}: its folder names the version`);
    }
  }
});

test("nothing else is in the vendor folder", () => {
  const listed = new Set(manifest.packages.flatMap((p) => Object.keys(p.files)));
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
  const found = walk(path.join(PANEL, "static", "assets", "vendor")).map((f) => path.relative(PANEL, f).split(path.sep).join("/"));
  assert.deepEqual(found.sort(), [...listed].sort());
});

test("the panel's pages load the libraries from the panel itself", () => {
  const shell = readFileSync(path.join(PANEL, "static", "pages", "shell.html"), "utf8");
  for (const src of shell.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) assert.match(src[1], /^\/assets\//, src[1]);
});
