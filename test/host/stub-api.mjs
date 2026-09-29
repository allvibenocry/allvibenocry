// A stand-in for the model's API, for the tests only (D60): it answers
// Claude Code's Messages API requests with a fixed script of tool calls, so
// that a real Claude Code session, with real tool calls, hooks and
// transcripts, can run on the test host without a model, an API key or anyone's
// account. It runs as a container on the project's dev network, and Claude Code
// is pointed at it with ANTHROPIC_BASE_URL, for one test session only.
//
// The script, one step per request, counted by the tool results in it:
//   1. Bash: ls the working copy
//   2. Write: a file whose content holds CONTENT_MARKER (the log must not)
//   3. Bash: a command that holds a fake key (the log must not)
//   4. Bash: a command that fails
//   5. the end of the turn, in words
// Every request's method and path is logged, never its body.
//
// With STEPS_FILE, the script is that file's instead (a JSON list of tool
// calls, { name, input }), and each tool result Claude Code sends back is
// written to RESULTS_FILE, one JSON line per step, with the names of the tools
// it offered: the deny rules' probe (deny-probe.mjs) reads them, to see
// which commands were refused. Its commands are harmless test commands.
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";

const PORT = 8080;
const CONTENT_MARKER = process.env.CONTENT_MARKER ?? "content-marker";
const FAKE_KEY = process.env.FAKE_KEY ?? "";
const STEPS_FILE = process.env.STEPS_FILE ?? "";
const RESULTS_FILE = process.env.RESULTS_FILE ?? "";

const SCRIPT = STEPS_FILE
  ? JSON.parse(readFileSync(STEPS_FILE, "utf8"))
  : [
      { name: "Bash", input: { command: "ls /workspace", description: "List the working copy" } },
      { name: "Write", input: { file_path: "/workspace/stub-note.txt", content: `A note from the stub session: ${CONTENT_MARKER}\n` } },
      { name: "Bash", input: { command: `echo ${FAKE_KEY} > /dev/null`, description: "A command holding a fake key" } },
      { name: "Bash", input: { command: "ls /no-such-directory", description: "A command that fails" } },
    ];

/** The newest tool result in a request, as text, for RESULTS_FILE. */
function lastResult(body) {
  const results = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === "tool_result");
  const last = results.at(-1);
  if (!last) return null;
  const text = Array.isArray(last.content) ? last.content.map((c) => c.text ?? "").join("") : String(last.content ?? "");
  return { id: last.tool_use_id, isError: last.is_error === true, text: text.slice(0, 600) };
}

const log = (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);
const toolResults = (body) =>
  (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === "tool_result").length;

function reply(body) {
  const done = toolResults(body);
  const usesTools = Array.isArray(body.tools) && body.tools.length > 0;
  if (RESULTS_FILE && usesTools) {
    const result = lastResult(body);
    if (result) appendFileSync(RESULTS_FILE, `${JSON.stringify({ step: done, ...result })}\n`);
    else appendFileSync(RESULTS_FILE, `${JSON.stringify({ step: 0, tools: body.tools.map((t) => t.name) })}\n`);
  }
  const step = usesTools ? SCRIPT[done] : undefined;
  const model = body.model ?? "stub";
  const content = step
    ? [{ type: "tool_use", id: `toolu_stub_${done + 1}`, name: step.name, input: step.input }]
    : [{ type: "text", text: "Done: the stub session is over." }];
  return { id: `msg_stub_${Date.now()}`, type: "message", role: "assistant", model, content, stop_reason: step ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
}

function sse(response, message) {
  const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  message.content.forEach((block, index) => {
    if (block.type === "tool_use") {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    } else {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    }
    send("content_block_stop", { type: "content_block_stop", index });
  });
  send("message_delta", { type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
  send("message_stop", { type: "message_stop" });
  response.end();
}

http
  .createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const path = String(request.url).split("?")[0];
      log(`${request.method} ${path}`);
      if (request.method === "POST" && path.endsWith("/v1/messages/count_tokens")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      if (request.method === "POST" && path.endsWith("/v1/messages")) {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          /* an empty or odd body gets the end of the turn */
        }
        const message = reply(body);
        if (body.stream) {
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          sse(response, message);
        } else {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(message));
        }
        return;
      }
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "the stub answers only the Messages API" } }));
    });
  })
  .listen(PORT, "0.0.0.0", () => log(`the stub API listens on ${PORT}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => process.exit(0));
