#!/usr/bin/env node
// Checks the walkthrough's shape (the seventh brief, item 3 (e); friction log
// 1 and 2; the eighth brief, item 8, friction log 7 and 9):
//
// - every command block holds one command, so that pasting a block runs it
//   whole;
// - no block runs `project create` for a name that the text has not first made
//   sure is free;
// - every command block says where it runs, on the line just above it:
//   **Workstation:** or **Host:**, and a workstation command (the harness,
//   npm) is never marked Host, nor a host command Workstation;
// - no step sends the reader to another for its commands ("as in step 16"):
//   every step carries its own.
//
//   node test/host/walkthrough-blocks.mjs [docs/walkthrough.md]
//
// A command is one line, or several joined by a trailing backslash. A block is
// a fenced block marked sh. Prints each block that breaks a rule, and exits 1.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "docs/walkthrough.md";
const lines = readFileSync(file, "utf8").split("\n");
const problems = [];
let blocks = 0;
const freed = new Set();
const PLACE = /^\*\*(Workstation|Host):\*\*$/;
// What only the workstation runs: the harness and the repository's own tools.
const ON_WORKSTATION = /^(node test\/host\/|npm )/;

for (let i = 0; i < lines.length; i += 1) {
  for (const m of lines[i].matchAll(/as in steps? \d+/gi)) problems.push(`line ${i + 1}: "${m[0]}": say it again here, with its commands (friction log 7)`);
  if (lines[i].trim() !== "```sh") continue;
  const start = i + 1;
  let above = i - 1;
  while (above >= 0 && lines[above].trim() === "") above -= 1;
  const place = PLACE.exec(lines[above]?.trim() ?? "")?.[1] ?? null;
  const body = [];
  for (i += 1; i < lines.length && lines[i].trim() !== "```"; i += 1) body.push(lines[i]);
  blocks += 1;
  let commands = 0;
  let continued = false;
  let first = null;
  for (const line of body) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    if (!continued) commands += 1;
    first ??= text;
    continued = text.endsWith("\\");
    // Commands joined on one line count as they are: `a && b` is two. Quoted
    // text and a trailing comment are not commands; a loop is one.
    const bare = text.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''").replace(/\s#.*$/, "");
    if (!/^(for|while|until|if)\b/.test(bare)) commands += (bare.match(/&&|\|\||;/g) ?? []).length;
    if (/(^|[^<])<<-?\s*['"]?[A-Za-z_]/.test(text)) problems.push(`line ${start}: a heredoc (rule 16): put the text in a file in docs/walkthrough-files/`);
  }
  if (commands !== 1) problems.push(`line ${start}: ${commands} commands in one block`);
  if (!place) problems.push(`line ${start}: no **Workstation:** or **Host:** on the line above it (friction log 9)`);
  else if (first && (place === "Workstation") !== ON_WORKSTATION.test(first)) problems.push(`line ${start}: marked ${place}, but \`${first.slice(0, 40)}\` runs on the ${place === "Host" ? "workstation" : "host"}`);
  const joined = body.join("\n");
  // A project's name is known to be free once the text has removed it, or listed and checked it.
  for (const m of joined.matchAll(/project remove (\S+) --delete-everything/g)) freed.add(m[1]);
  for (const m of joined.matchAll(/project create (\S+)/g)) {
    if (!freed.has(m[1])) problems.push(`line ${start}: project create ${m[1]}, with no removal of an old ${m[1]} before it`);
    freed.delete(m[1]);
  }
}

for (const p of problems) console.log(`  ${p}`);
console.log(`${file}: ${blocks} command blocks, ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
process.exitCode = problems.length ? 1 : 0;
