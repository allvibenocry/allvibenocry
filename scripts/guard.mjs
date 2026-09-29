#!/usr/bin/env node
/**
 * Rules 9 and 10, as a check that runs on every file about to be committed.
 *
 *   node scripts/guard.mjs                   every file in the working tree
 *   node scripts/guard.mjs --staged          and every file as it is staged (the pre-commit hook)
 *   node scripts/guard.mjs --message <file>  a commit message (the commit-msg hook)
 *
 * The hooks are scripts/hooks/pre-commit and scripts/hooks/commit-msg, copied
 * into .git/hooks/ of the owner's clone (D71): a commit the guard refuses is
 * not made. The staged copy is read too, because a file can be staged with a
 * finding and then changed in the working tree.
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
  // The private ranges themselves, whole, which the firewall for project
  // containers refuses (D41): definitions from RFC 1918 and RFC 6598, not addresses.
  ["10.0.0.0/8", "a private range (RFC 1918), refused to project containers by firewall.sh (D41)"],
  ["172.16.0.0/12", "a private range (RFC 1918), refused to project containers by firewall.sh (D41)"],
  ["192.168.0.0/16", "a private range (RFC 1918), refused to project containers by firewall.sh (D41)"],
  ["100.64.0.0/10", "the shared range (RFC 6598), refused to project containers by firewall.sh (D41)"],
  // The test host's stand-in for another device on the home network
  // (test/host/lan-fixtures.sh): made inside a disposable test host, nobody's network.
  ["10.99.0.1/24", "the test host's end of the stand-in home network (test/host/lan-fixtures.sh)"],
  ["10.99.0.2/24", "the stand-in device on the test host's home network (test/host/lan-fixtures.sh)"],
  ["10.99.0.2", "the stand-in device on the test host's home network (test/host/lan-fixtures.sh)"],
  ["10.99.0.1", "the test host's end of the stand-in home network (test/host/lan-fixtures.sh)"],
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

/** Every file as it is staged: its path and its bytes, read from the index. */
function stagedFiles() {
  const entries = execFileSync("git", ["ls-files", "-s", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [meta, file] = entry.split("\t");
      return { file, blob: meta.split(" ")[1], mode: meta.split(" ")[0] };
    })
    .filter((e) => e.mode !== "160000");
  if (!entries.length) return [];
  const out = execFileSync("git", ["cat-file", "--batch"], { cwd: ROOT, input: entries.map((e) => e.blob).join("\n") + "\n", maxBuffer: 512 * 1024 * 1024 });
  const found = [];
  let at = 0;
  for (const entry of entries) {
    const end = out.indexOf(0x0a, at);
    const size = Number(out.subarray(at, end).toString("utf8").split(" ")[2]);
    found.push({ file: entry.file, buffer: out.subarray(end + 1, end + 1 + size) });
    at = end + 1 + size + 1;
  }
  return found;
}

const findings = [];
const local = privateStrings();

/** One text's findings, under the name it is reported by. */
function inspect(name, buffer, { markdown = false, ownList = false } = {}) {
  if (buffer.includes(0)) return; // binary
  const lines = buffer.toString("utf8").split("\n");
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}`;
    if (wordFindings(line, markdown)) findings.push(`${where}: rule 9, a name made of the forbidden word`);

    for (const match of line.matchAll(PRIVATE_V4)) {
      if (!ALLOWED_ADDRESSES.has(match[0])) findings.push(`${where}: rule 10, a private IPv4 address`);
    }
    if (WINDOWS_PROFILE.test(line)) findings.push(`${where}: rule 10, a Windows user profile path`);
    WINDOWS_PROFILE.lastIndex = 0;

    if (local && !ownList) {
      const lower = line.toLowerCase();
      if (local.some((s) => lower.includes(s))) findings.push(`${where}: rule 10, a string from .local/private-strings.txt`);
    }
  });
}

const messageAt = process.argv.indexOf("--message");
let checked;
if (messageAt !== -1) {
  const file = process.argv[messageAt + 1];
  if (!file || !existsSync(file)) {
    process.stdout.write("guard: --message needs the commit message's file\n");
    process.exit(2);
  }
  // git's own comment lines are not part of the message.
  const text = readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
  inspect("the commit message", Buffer.from(text), { markdown: true });
  checked = "the commit message checked for rule 9 and rule 10";
} else {
  const list = files();
  for (const file of list) {
    if (file.toLowerCase().includes(WORD)) findings.push(`${file}: rule 9, the file's own name`);
    inspect(file, readFileSync(path.join(ROOT, file)), { markdown: file.endsWith(".md"), ownList: file === ".local/private-strings.txt" });
  }
  checked = `${list.length} files checked for rule 9 and rule 10`;
  if (process.argv.includes("--staged")) {
    const staged = stagedFiles();
    for (const { file, buffer } of staged) {
      if (file.toLowerCase().includes(WORD)) findings.push(`${file} (staged): rule 9, the file's own name`);
      inspect(`${file} (staged)`, buffer, { markdown: file.endsWith(".md"), ownList: file === ".local/private-strings.txt" });
    }
    checked += `, and ${staged.length} as staged`;
  }
}

process.stdout.write(
  `guard: ${checked}` +
    `${local ? `, including ${local.length} local private strings` : " (generic checks only: no .local/private-strings.txt here)"}\n`,
);
if (findings.length > 0) {
  for (const finding of findings) process.stdout.write(`  ${finding}\n`);
  process.stdout.write(`guard: ${findings.length} finding(s); the matched text is not shown\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("guard: clean\n");
}
