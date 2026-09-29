// The hook that refuses multi-line text through the shell (rule 16, D71).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { refusal } from "../../scripts/hooks/inline-scripts.mjs";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "hooks", "inline-scripts.mjs");

const BASH_REFUSED = [
  ["a heredoc, quoted", "cat <<'END'\nhello\nEND"],
  ["a heredoc, bare", "cat <<END\nx\nEND"],
  ["a heredoc into python", "python - <<EOF\nprint(1)\nEOF"],
  ["a heredoc with a dash, double-quoted", 'cat <<-"END"\n\tx\nEND'],
  ["a heredoc with a space", "cat << END\nx\nEND"],
  ["a heredoc with a backslash", "cat <<\\END\nx\nEND"],
  ["a multi-line node -e", 'node -e "const a = 1;\nconsole.log(a)"'],
  ["a multi-line python -c", "python3 -c 'import sys\nprint(sys.argv)'"],
  ["a commit message over lines", 'git commit -m "subject\n\nbody"'],
  ["ANSI-C text with a line break", "echo $'a\\nb' > f"],
  ["single-quoted text over lines", "printf 'one\ntwo' > f"],
  ["a command substitution over lines", "x=`echo a\necho b`"],
];

const BASH_PASSED = [
  ["a plain command", "ls -la"],
  ["a one-line node -e", 'node -e "console.log(1)"'],
  ["commands on separate lines", "cd /x && ls\ngit status"],
  ["a line continued with a backslash", "docker run \\\n  --rm x"],
  ["a here-string on one line", 'cat <<< "one line"'],
  ["a shift in arithmetic", "echo $((1 << 2))"],
  ["an apostrophe in a comment", "grep -n '^## ' a.md # it's a comment"],
  ["escaped quotes", 'echo "a \\"quoted\\" word"'],
  ["a message from a file", "git commit -F msg.txt"],
  ["quotes next to each other", "echo 'it'\"'\"'s'"],
  ["a literal backslash-n in one line", "printf 'a\\nb'"],
];

const POWERSHELL_REFUSED = [
  ["a here-string", "$m = @'\nline\n'@"],
  ["a double here-string", '$m = @"\nline\n"@'],
  ["a commit message over lines", 'git commit -m "a\nb"'],
  ["a multi-line node -e", "node -e 'x\ny'"],
];

const POWERSHELL_PASSED = [
  ["a plain command", "Get-ChildItem -Force"],
  ["a message from a file", "git commit -F msg.txt"],
  ["a doubled quote", "Write-Output 'it''s one line'"],
  ["a quote in a comment", "# a comment with 'quote\nGet-Date"],
  ["commands on separate lines", "Get-Date\nGet-Location"],
  ["a block comment with quotes", "<# it's\nfine #> Get-Date"],
];

for (const [what, command] of BASH_REFUSED) test(`Bash, refused: ${what}`, () => assert.match(refusal("Bash", command) ?? "", /^Refused before it ran/));
for (const [what, command] of BASH_PASSED) test(`Bash, passed: ${what}`, () => assert.equal(refusal("Bash", command), null));
for (const [what, command] of POWERSHELL_REFUSED) test(`PowerShell, refused: ${what}`, () => assert.match(refusal("PowerShell", command) ?? "", /^Refused before it ran/));
for (const [what, command] of POWERSHELL_PASSED) test(`PowerShell, passed: ${what}`, () => assert.equal(refusal("PowerShell", command), null));

test("other tools are not its business", () => assert.equal(refusal("Write", "a\nb"), null));

test("the message points to the file tool", () => assert.match(refusal("Bash", "cat <<END\nx\nEND"), /Write it to a file with the file tool/));

test("as Claude Code runs it: exit 2 with the reason for a heredoc, 0 for a plain command", () => {
  const run = (call) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(call), encoding: "utf8" });
  const refused = run({ tool_name: "Bash", tool_input: { command: "cat <<'END'\nhello\nEND" } });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /a heredoc/);
  const passed = run({ tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(passed.status, 0);
  assert.equal(passed.stderr, "");
  assert.equal(run("not json").status, 0);
});
