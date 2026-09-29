#!/usr/bin/env node
/**
 * A Claude Code hook (PreToolUse, for the Bash and PowerShell tools) that
 * refuses, before it runs, any shell command that carries multi-line text
 * through the shell (rule 16, D71):
 *
 *   - a heredoc (`<<END`, `<<-'END'`, `<<"END"`), whatever its text;
 *   - a PowerShell here-string (`@'` or `@"` at the end of a line);
 *   - a quoted argument that spans lines: an inline script over several lines
 *     passed through `python -c`, `node -e` or any other command, or any other
 *     multi-line text in single, double or back quotes;
 *   - ANSI-C quoted text with a line break in it (`$'a\nb'`).
 *
 * Why: text with its own heredoc in it ended the outer one, and the rest ran
 * as shell commands on the owner's workstation (CLAUDE.md, mistake 41); and
 * backslashes in code passed through shell quoting were lost, silently
 * (mistake 43). Multi-line text goes into a file with the file tool, and the
 * command takes the file.
 *
 * Commands on several lines outside quotes, a line continued with a
 * backslash, and one-line scripts (`node -e "console.log(1)"`) pass.
 *
 * Claude Code runs it with the tool call as JSON on standard input. Exit 2
 * refuses the call and gives Claude Code the reason; exit 0 lets it run. Input
 * it cannot read lets the call run: this catches accidents, it is not a sandbox.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORD_START = /[A-Za-z_'"\\]/;

/** Why a POSIX shell command carries multi-line text, or null. */
function posix(command) {
  let i = 0;
  const n = command.length;
  const atWordStart = (k) => k === 0 || /[\s;&|()]/.test(command[k - 1]);
  while (i < n) {
    const c = command[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "#" && atWordStart(i)) {
      while (i < n && command[i] !== "\n") i += 1;
      continue;
    }
    if (c === "<" && command[i + 1] === "<" && command[i - 1] !== "<" && command[i + 2] !== "<") {
      let k = i + 2;
      if (command[k] === "-") k += 1;
      while (command[k] === " " || command[k] === "\t") k += 1;
      if (k < n && WORD_START.test(command[k])) return "a heredoc";
      i = k;
      continue;
    }
    if (c === "$" && command[i + 1] === "'") {
      let k = i + 2;
      while (k < n && command[k] !== "'") {
        if (command[k] === "\n") return "quoted text over several lines";
        if (command[k] === "\\") {
          if (command[k + 1] === "n" || command[k + 1] === "r") return "ANSI-C quoted text with a line break ($'...\\n...')";
          k += 1;
        }
        k += 1;
      }
      i = k + 1;
      continue;
    }
    if (c === "'" || c === "`") {
      let k = i + 1;
      while (k < n && command[k] !== c) {
        if (command[k] === "\n") return "quoted text over several lines";
        if (c === "`" && command[k] === "\\") k += 1;
        k += 1;
      }
      i = k + 1;
      continue;
    }
    if (c === '"') {
      let k = i + 1;
      while (k < n && command[k] !== '"') {
        if (command[k] === "\\") {
          k += 2;
          continue;
        }
        if (command[k] === "\n") return "quoted text over several lines";
        k += 1;
      }
      i = k + 1;
      continue;
    }
    i += 1;
  }
  return null;
}

/** Why a PowerShell command carries multi-line text, or null. */
function powershell(command) {
  if (/@['"][ \t]*\r?\n/.test(command)) return "a PowerShell here-string";
  let i = 0;
  const n = command.length;
  while (i < n) {
    const c = command[i];
    if (c === "`") {
      i += 2;
      continue;
    }
    if (c === "<" && command[i + 1] === "#") {
      const end = command.indexOf("#>", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "#") {
      while (i < n && command[i] !== "\n") i += 1;
      continue;
    }
    if (c === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      let k = i + 2;
      if (command[k] === "-") k += 1;
      while (command[k] === " " || command[k] === "\t") k += 1;
      if (k < n && WORD_START.test(command[k])) return "a heredoc";
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      for (;;) {
        if (k >= n) break;
        if (c === '"' && command[k] === "`") {
          k += 2;
          continue;
        }
        if (command[k] === c) {
          if (command[k + 1] === c) {
            k += 2;
            continue;
          }
          break;
        }
        if (command[k] === "\n") return "quoted text over several lines";
        k += 1;
      }
      i = k + 1;
      continue;
    }
    i += 1;
  }
  return null;
}

/** Why this tool call must not run, in plain words, or null when it may. */
export function refusal(tool, command) {
  if (typeof command !== "string") return null;
  const why = tool === "PowerShell" ? powershell(command) : tool === "Bash" ? posix(command) : null;
  if (!why) return null;
  return (
    `Refused before it ran (rule 16): this command carries ${why}. ` +
    "Multi-line text never goes through a shell heredoc, shell quoting, python -c or node -e. " +
    "Write it to a file with the file tool (Write), then give the command the file: " +
    "git commit -F <file>, node <file>, python <file>, --body-file <file>."
  );
}

const self = (p) => path.resolve(p).toLowerCase();
if (process.argv[1] && self(fileURLToPath(import.meta.url)) === self(process.argv[1])) {
  let call;
  try {
    call = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const why = refusal(call?.tool_name, call?.tool_input?.command);
  if (why) {
    process.stderr.write(`${why}\n`);
    process.exit(2);
  }
  process.exit(0);
}
