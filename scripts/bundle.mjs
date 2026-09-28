#!/usr/bin/env node
/**
 * Makes the directory install.sh is run from: bundle/<command>-<version>/.
 *
 *   npm run bundle      # builds first
 *
 * It holds install.sh, brand.conf, the compiled CLI, the templates, the agent's
 * image files (agent/), the licence,
 * a package.json that marks the code as ES modules, and VERSION: the package
 * version and the exact commit, with "-dirty" when the working tree had
 * uncommitted changes, so an installed host always says what it runs.
 * Every text file is written with LF line endings: it runs on Debian.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const command = readFileSync(path.join(ROOT, "brand.conf"), "utf8").match(/^COMMAND_NAME="?([^"\n]+)"?/m)[1];

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const commit = git("rev-parse", "--short=12", "HEAD");
const dirty = git("status", "--porcelain", "--", "src", "install.sh", "brand.conf", "templates", "agent", "package.json") !== "";
const version = `${pkg.version}+${commit}${dirty ? "-dirty" : ""}`;

const out = path.join(ROOT, "bundle", `${command}-${pkg.version}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** Copy a text file with LF endings, keeping the executable bit meaningful on Linux. */
function copyText(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(from, "utf8").replace(/\r\n/g, "\n"), { mode: from.endsWith(".sh") ? 0o755 : 0o644 });
}

function copyTree(from, to) {
  for (const entry of readdirSync(from)) {
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    if (statSync(source).isDirectory()) copyTree(source, target);
    else if (/\.(js|mjs|ts|json|sql|sh|conf|md|txt|html|css|lock)$|^Dockerfile$|^\.dockerignore$/.test(entry)) copyText(source, target);
    else cpSync(source, target);
  }
}

copyText(path.join(ROOT, "install.sh"), path.join(out, "install.sh"));
copyText(path.join(ROOT, "brand.conf"), path.join(out, "brand.conf"));
copyText(path.join(ROOT, "LICENSE"), path.join(out, "LICENSE"));
copyTree(path.join(ROOT, "dist"), path.join(out, "dist"));
if (existsSync(path.join(ROOT, "templates"))) copyTree(path.join(ROOT, "templates"), path.join(out, "templates"));
copyTree(path.join(ROOT, "agent"), path.join(out, "agent"));
writeFileSync(
  path.join(out, "package.json"),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", license: pkg.license }, null, 2)}\n`,
);
writeFileSync(path.join(out, "VERSION"), `${version}\n`);

process.stdout.write(`bundle: ${path.relative(ROOT, out)} (${version})\n`);
