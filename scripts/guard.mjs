#!/usr/bin/env node
/**
 * Rules 9 and 10, as a check that runs on every file about to be committed.
 *
 *   node scripts/guard.mjs
 *
 * Rule 9: nothing is ever named after the ransomware family (D2). The word may
 * appear only inside the project's external names, which were given to it: the
 * GitHub organisation and its repositories, the domains, the npm scope and the
 * mail address. In Markdown it may also appear quoted, where a document states
 * the rule. Anywhere else, and in any file or directory name, it is a failure.
 *
 * Rule 10: the repository is public, so it never holds a detail of the owner's
 * own infrastructure (D7). Generically: no private IPv4 address (10/8,
 * 172.16/12, 192.168/16, 100.64/10) and no Windows user profile path. Locally:
 * also every string listed in `.local/private-strings.txt`, a gitignored file
 * that exists only on the owner's workstation. CI has the generic half.
 *
 * A finding is reported as file, line and rule, **never with the text that
 * matched**: CI logs of a public repository are public, and a check that
 * repeats a leaked address has leaked it again.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* The word is assembled so that this file does not contain it. */
const WORD = ["no", "cry"].join("");
const ORG = `allvibe${WORD}`;

/** Where the word may appear: the project's given external names. */
const EXTERNAL_NAMES = [
  `${ORG}.com`,
  `${ORG}.se`,
  `github.com/${ORG}`,
  `@${ORG}`,
  `${ORG}/${ORG}`,
  `${ORG}/website`,
];

/**
 * Private addresses that are in the repository on purpose, each with why.
 * Keep this list short and explain every entry.
 */
const ALLOWED_ADDRESSES = new Map([
  // [address, why it is here]
  ["172.20.0.0/14", "the pool Docker hands project networks from (D16): a design value, nobody's network"],
  ["10.201.0.0/16", "the fallback pool (D16), used when the first overlaps the machine's own networks"],
]);

const PRIVATE_V4 =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})(?:\/\d{1,2})?\b/g;
const WINDOWS_PROFILE = /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/g;

function files() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split("\0").filter(Boolean).filter((f) => existsSync(path.join(ROOT, f)));
}

function privateStrings() {
  const file = path.join(ROOT, ".local", "private-strings.txt");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.toLowerCase());
}

function wordFindings(line, markdown) {
  let rest = line.toLowerCase();
  for (const name of EXTERNAL_NAMES) rest = rest.split(name.toLowerCase()).join(" ");
  if (markdown) rest = rest.replace(new RegExp(`["\`]${WORD}["\`]`, "g"), " ");
  return rest.includes(WORD);
}

const findings = [];
const local = privateStrings();
const list = files();

for (const file of list) {
  if (file.toLowerCase().includes(WORD)) findings.push(`${file}: rule 9, the file's own name`);

  const buffer = readFileSync(path.join(ROOT, file));
  if (buffer.includes(0)) continue; // binary
  const markdown = file.endsWith(".md");
  const lines = buffer.toString("utf8").split("\n");

  lines.forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    if (wordFindings(line, markdown)) findings.push(`${where}: rule 9, a name made of the forbidden word`);

    for (const match of line.matchAll(PRIVATE_V4)) {
      if (!ALLOWED_ADDRESSES.has(match[0])) findings.push(`${where}: rule 10, a private IPv4 address`);
    }
    if (WINDOWS_PROFILE.test(line)) findings.push(`${where}: rule 10, a Windows user profile path`);
    WINDOWS_PROFILE.lastIndex = 0;

    if (local && file !== ".local/private-strings.txt") {
      const lower = line.toLowerCase();
      if (local.some((s) => lower.includes(s))) findings.push(`${where}: rule 10, a string from .local/private-strings.txt`);
    }
  });
}

process.stdout.write(
  `guard: ${list.length} files checked for rule 9 and rule 10` +
    `${local ? `, including ${local.length} local private strings` : " (generic checks only: no .local/private-strings.txt here)"}\n`,
);
if (findings.length > 0) {
  for (const finding of findings) process.stdout.write(`  ${finding}\n`);
  process.stdout.write(`guard: ${findings.length} finding(s); the matched text is not shown\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("guard: clean\n");
}
