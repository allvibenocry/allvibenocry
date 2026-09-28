#!/usr/bin/env node
// Claude Code's hook for the agent's activity log (D60), set in its managed
// settings for PostToolUse and PostToolUseFailure. For each tool call it sends
// one line to the activity logger beside the agent: the tool, the file path or
// the command, and how it went. Never a file's contents, never a tool's
// output. It never blocks the agent: whatever happens, it exits 0.
//
// Only the command's first line is sent: a command of several lines (a
// heredoc, say) carries file contents in the rest. The logger scans what it
// is given for anything that looks like a key before it writes it.

/** The line for one hook call, from the JSON Claude Code gives the hook. */
export function entryOf(input) {
  const tool = String(input?.tool_name ?? "unknown").slice(0, 64);
  const i = input?.tool_input ?? {};
  let target = "";
  if (tool === "Bash") {
    const lines = String(i.command ?? "").split("\n");
    target = lines[0] + (lines.length > 1 ? ` (and ${lines.length - 1} more line${lines.length > 2 ? "s" : ""}, not logged)` : "");
  } else if (["Read", "Write", "Edit", "MultiEdit"].includes(tool)) target = String(i.file_path ?? "");
  else if (tool === "NotebookEdit") target = String(i.notebook_path ?? "");
  else if (tool === "Glob" || tool === "Grep") target = [i.pattern, i.path].filter(Boolean).map(String).join(" in ");
  else if (tool === "WebFetch") target = String(i.url ?? "");
  else if (tool === "WebSearch") target = String(i.query ?? "");
  else if (tool === "Task" || tool === "Agent") target = String(i.description ?? "");
  target = target.replace(/\s+/g, " ").trim();
  if (target.length > 300) target = `${target.slice(0, 297)}...`;
  const outcome = input?.hook_event_name === "PostToolUseFailure" ? "failed" : "ok";
  return { tool, target, outcome, session: String(input?.session_id ?? "").slice(0, 64), id: String(input?.tool_use_id ?? "").slice(0, 80) };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const url = process.env.AGENT_ACTIVITY_URL;
  if (!url) return;
  const entry = entryOf(JSON.parse(raw));
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry), signal: AbortSignal.timeout(3000) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {}).finally(() => process.exit(0));
}
