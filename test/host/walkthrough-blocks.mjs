#!/usr/bin/env node
// Checks the walkthrough's shape (the seventh brief, item 3 (e); friction log
// 1 and 2): every command block holds one command, so that pasting a block
// runs it whole, and no block runs `project create` for a name that the text
// has not first made sure is free.
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

for (let i = 0; i < lines.length; i += 1) {
  if (lines[i].trim() !== "```sh") continue;
  const start = i + 1;
  const body = [];
  for (i += 1; i < lines.length && lines[i].trim() !== "```"; i += 1) body.push(lines[i]);
  blocks += 1;
  let commands = 0;
  let continued = false;
  for (const line of body) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    if (!continued) commands += 1;
    continued = text.endsWith("\\");
    // Commands joined on one line count as they are: `a && b` is two. Quoted
    // text and a trailing comment are not commands; a loop is one.
    const bare = text.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''").replace(/\s#.*$/, "");
    if (!/^(for|while|until|if)\b/.test(bare)) commands += (bare.match(/&&|\|\||;/g) ?? []).length;
    if (/(^|[^<])<<-?\s*['"]?[A-Za-z_]/.test(text)) problems.push(`line ${start}: a heredoc (rule 16): put the text in a file in docs/walkthrough-files/`);
  }
  if (commands !== 1) problems.push(`line ${start}: ${commands} commands in one block`);
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
