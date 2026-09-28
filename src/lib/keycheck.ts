/**
 * The key check before every commit (D38): every project's git repository has
 * a pre-commit hook that runs a pinned secret scanner over what is about to be
 * committed, and stops the commit if anything looks like a key. It runs for
 * the user's commits on the host and for the agent's in its container (D39),
 * because the hook lives in the repository's `.git/hooks`, which the agent's
 * working copy includes.
 *
 * The scanner is gitleaks, the same version and the same image, pinned by
 * digest, as this repository's own CI (D6). Its binary is taken out of that
 * image once, checked against its own pinned checksum, and kept in the
 * suite's tools directory. The agent's image copies it from the same image.
 *
 * The message names the file and the line, and the kind of key, never the
 * value: gitleaks runs with --redact, its own output is not shown, and only
 * its report's file, line and rule are read.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { posix as path } from "node:path";
import { NAMES } from "./brand.js";
import { docker, tryDocker } from "./docker.js";
import { ensureFile } from "./files.js";
import { repoDir } from "./project.js";

export const SCANNER_VERSION = "8.30.1";
export const SCANNER_IMAGE =
  "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";
/** The binary in that image, by its own checksum: the image is pinned, and so is what is taken out of it. */
export const SCANNER_SHA256 = "09d435057df51b800201bc3bbe0820554b1cac3cd98162e9e02b20c8b441b5bd";
export const scannerPath = () => path.join(NAMES.toolsDir, `gitleaks-${SCANNER_VERSION}`, "gitleaks");
/** Where the agent's image puts it (D39). */
export const AGENT_SCANNER_PATH = "/usr/local/bin/gitleaks";

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The scanner on this machine, taken out of its pinned image and checked. */
export function ensureScanner(): { changed: boolean; evidence: string } {
  const target = scannerPath();
  if (existsSync(target) && sha256(target) === SCANNER_SHA256) {
    return { changed: false, evidence: `gitleaks ${SCANNER_VERSION} at ${target}, checksum as pinned` };
  }
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  const partial = `${target}.partial`;
  const holder = `${NAMES.command}-scanner-extract`;
  tryDocker(["rm", "-f", holder]);
  docker(["pull", "-q", SCANNER_IMAGE]);
  docker(["create", "--name", holder, "--label", `${NAMES.label}.role=scanner-extract`, SCANNER_IMAGE]);
  try {
    docker(["cp", `${holder}:/usr/bin/gitleaks`, partial]);
  } finally {
    tryDocker(["rm", "-f", holder]);
  }
  const got = sha256(partial);
  if (got !== SCANNER_SHA256) {
    rmSync(partial, { force: true });
    throw new Error(`the scanner taken out of ${SCANNER_IMAGE.split("@")[0]} has checksum ${got.slice(0, 16)}…, not the pinned ${SCANNER_SHA256.slice(0, 16)}…`);
  }
  chmodSync(partial, 0o755);
  renameSync(partial, target);
  return { changed: true, evidence: `gitleaks ${SCANNER_VERSION} taken out of its pinned image to ${target}, checksum as pinned` };
}

/* ---------------------------------------------------------------- the hook -- */

const HOOK = "pre-commit";
const CHECKER = `${NAMES.command}-key-check.cjs`;

/** The hook itself: a line of shell that hands over to the checker beside it. */
export function hookScript(): string {
  return `#!/bin/sh
# The key check before every commit (${NAMES.command}, D38). Generated: it is
# rewritten by the suite, so a change here does not last.
exec node "$(dirname "$0")/${CHECKER}"
`;
}

/** The checker: runs the scanner over what is staged, and says what it found without the value. */
export function checkerScript(): string {
  const scanners = JSON.stringify([scannerPath(), AGENT_SCANNER_PATH]);
  return `"use strict";
// The key check before every commit (${NAMES.command}, D38). Generated: it is
// rewritten by the suite, so a change here does not last.
//
// Runs the pinned secret scanner over what is about to be committed. If it
// finds anything that looks like a key, the commit stops, and this says which
// file and line, never the value.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const scanner = ${scanners}.find((p) => fs.existsSync(p));
const say = (lines) => process.stderr.write(lines.join("\\n") + "\\n");
if (!scanner) {
  say(["Stopped: the key check could not run, because its scanner is missing, so nothing was committed.",
    "Install the suite again (install.sh), then commit again."]);
  process.exit(1);
}

const KINDS = {
  "anthropic-api-key": "an Anthropic API key",
  "openai-api-key": "an OpenAI API key",
  "github-pat": "a GitHub access token",
  "aws-access-token": "an AWS access key",
  "private-key": "a private key",
  "generic-api-key": "an API key or a password",
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "key-check-"));
const report = path.join(dir, "report.json");
// Its own output is not shown: the report's file, line and rule are all that is read.
const result = spawnSync(scanner, ["git", "--pre-commit", "--staged", "--redact", "--no-banner", "--log-level", "error",
  "--exit-code", "1", "--report-format", "json", "--report-path", report, "."], { encoding: "utf8" });
let findings = [];
try { findings = JSON.parse(fs.readFileSync(report, "utf8")); } catch { findings = []; }
fs.rmSync(dir, { recursive: true, force: true });

if (result.status === 0) process.exit(0);
if (result.status === 1 && findings.length > 0) {
  say([
    "Stopped: this commit has something in it that looks like a key or a password, so nothing was committed.",
    "",
    ...findings.map((f) => "  " + f.File + ", line " + f.StartLine + ": looks like " + (KINDS[f.RuleID] || "a key (" + f.RuleID + ")")),
    "",
    "The value is not shown. A key never goes into the code: take it out of the file, put it in the key vault",
    "  ${NAMES.command} key set <project> <dev|prod> <NAME> < a-file-with-the-key",
    "and have the app read it from the file named in <NAME>_FILE. Then commit again.",
  ]);
  process.exit(1);
}
say(["Stopped: the key check did not finish (it exited " + result.status + "), so nothing was committed."]);
process.exit(1);
`;
}

/** The hook and its checker in a project's repository. Returns whether anything changed. */
export function ensureHook(project: string): boolean {
  const hooks = path.join(repoDir(project), ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  const a = ensureFile(path.join(hooks, HOOK), hookScript(), 0o755);
  const b = ensureFile(path.join(hooks, CHECKER), checkerScript(), 0o644);
  chmodSync(path.join(hooks, HOOK), 0o755);
  return a || b;
}
