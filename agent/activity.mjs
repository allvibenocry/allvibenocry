// The agent's activity log (D60): a small server beside the agent, on dev's
// network only, and the only writer of the log. The agent's hook sends it one
// line per tool call; the agent's container never has the log, so the agent
// can add lines and do nothing else to them.
//
//   - it takes lines only from the agent's own address, as POST /log, at most
//     4 kB, in the hook's shape: the tool, a target (a path, a URL or the
//     first line of a command, at most 300 characters), and ok or failed;
//   - it runs the key check's scanner (the pinned gitleaks, D38) over the
//     target, and writes "(held something that looks like a key or a
//     password: not logged)" instead when it finds one, or when the scanner
//     cannot run: it fails closed;
//   - it appends one JSON line, with the time, to /log/activity.jsonl: one
//     per tool call, for Claude Code can report a failed call to both of its
//     hooks. The events of one call (by its id) are gathered for a moment,
//     and a call that either event calls failed is written as failed.
//
// It logs nothing else, and says nothing about what it refused beyond a count.
import { spawnSync } from "node:child_process";
import dns from "node:dns/promises";
import { appendFileSync } from "node:fs";
import http from "node:http";

const PORT = 3129;
const LOG = "/log/activity.jsonl";
const SCANNER = "/usr/local/bin/gitleaks";
const AGENT = process.env.AGENT_HOST ?? "";
export const WITHHELD = "(held something that looks like a key or a password: not logged)";

/** The entry, checked and tidied, or null when it is not in the hook's shape. */
export function clean(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { tool, target = "", outcome, session = "", id = "" } = entry;
  if (typeof tool !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(tool)) return null;
  if (outcome !== "ok" && outcome !== "failed") return null;
  if (typeof target !== "string" || target.length > 400) return null;
  if (typeof session !== "string" || !/^[A-Za-z0-9-]{0,64}$/.test(session)) return null;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{0,80}$/.test(id)) return null;
  return { session, id, tool, target: target.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300), outcome };
}

/** True when the scanner finds something that looks like a secret, or cannot say. */
export function holdsSecret(text, scanner = SCANNER) {
  if (!text) return false;
  const scan = spawnSync(scanner, ["stdin", "--no-banner", "--redact", "--exit-code", "1", "--log-level", "error"], { input: text, timeout: 10000 });
  return scan.status !== 0;
}

async function agentAddresses() {
  try {
    return (await dns.lookup(AGENT, { all: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

/** The moment the events of one tool call are gathered in, before its line is written. */
export const GATHER_MS = 1500;
const pending = new Map();
const write = (entry) =>
  appendFileSync(LOG, `${JSON.stringify({ at: entry.at, session: entry.session, tool: entry.tool, target: entry.target, outcome: entry.outcome })}\n`);

/** One call's events become one line: written once, after `wait`, failed if any of them said so. */
export function gather(entry, writeLine = write, wait = GATHER_MS) {
  const at = new Date().toISOString();
  if (!entry.id) return writeLine({ at, ...entry });
  const known = pending.get(entry.id);
  if (known) {
    if (entry.outcome === "failed") known.entry.outcome = "failed";
    return;
  }
  const item = { entry: { at, ...entry }, timer: null };
  item.timer = setTimeout(() => {
    pending.delete(entry.id);
    writeLine(item.entry);
  }, wait);
  pending.set(entry.id, item);
}

/** What is still gathering, written at once: when the logger is stopped. */
function flush() {
  for (const [id, item] of pending) {
    clearTimeout(item.timer);
    pending.delete(id);
    write(item.entry);
  }
}

let refused = 0;
const server = http.createServer(async (request, response) => {
  const say = (code) => {
    response.writeHead(code, { "Content-Type": "text/plain" });
    response.end();
  };
  const from = String(request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (request.method !== "POST" || request.url !== "/log" || !(await agentAddresses()).includes(from)) {
    refused += 1;
    return say(403);
  }
  let raw = "";
  let tooBig = false;
  request.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 4096) tooBig = true;
  });
  request.on("end", () => {
    let entry = null;
    try {
      entry = tooBig ? null : clean(JSON.parse(raw));
    } catch {
      entry = null;
    }
    if (!entry) {
      refused += 1;
      return say(400);
    }
    if (holdsSecret(entry.target)) entry.target = WITHHELD;
    gather(entry);
    say(204);
  });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, "0.0.0.0", () => process.stdout.write(`the agent's activity log: lines from ${AGENT} only, to ${LOG}\n`));
  setInterval(() => {
    if (refused) process.stdout.write(`refused ${refused} request(s) that were not the agent's lines\n`);
    refused = 0;
  }, 60000).unref();
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      flush();
      process.exit(0);
    });
  }
}
