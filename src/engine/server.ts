/**
 * The engine's server (D62): HTTP/1.1 with JSON, on a Unix socket only.
 *
 *   POST /v1/<operation>    a JSON object of arguments, at most 16 kB
 *
 * Anything else is refused: another method or path, a body that is not a JSON
 * object, one that is too big. The answers are JSON, and say what was wrong in
 * plain words; a refusal's HTTP status follows its code.
 */
import http from "node:http";
import { type Answer, type Context, perform } from "./operations.js";

export const MAX_BODY = 16 * 1024;

const STATUS: Record<string, number> = {
  unknown_operation: 404,
  bad_arguments: 400,
  not_found: 404,
  busy: 409,
  refused: 403,
  failed: 500,
};

function send(response: http.ServerResponse, status: number, answer: Answer): void {
  const body = JSON.stringify(answer);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(body);
}

const refuse = (response: http.ServerResponse, status: number, code: "unknown_operation" | "bad_arguments", message: string) =>
  send(response, status, { ok: false, error: { code, message } });

export function createEngineServer(ctx: Context, log: (line: string) => void = () => {}): http.Server {
  return http.createServer((request, response) => {
    const match = /^\/v1\/([a-zA-Z.]{1,40})$/.exec(String(request.url));
    if (request.method !== "POST" || !match) {
      request.resume();
      return refuse(response, request.method === "POST" ? 404 : 405, "unknown_operation", "the engine answers POST /v1/<operation> only");
    }
    let size = 0;
    const chunks: Buffer[] = [];
    let tooBig = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooBig) return refuse(response, 413, "bad_arguments", `the arguments are larger than ${MAX_BODY / 1024} kB`);
      let args: unknown;
      try {
        args = size === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return refuse(response, 400, "bad_arguments", "the arguments are not JSON");
      }
      const operation = match[1];
      perform(operation, args, ctx).then(
        (answer) => {
          if (!answer.ok) log(`${operation}: ${answer.error.code}`);
          else if (operation !== "job.get" && !operation.startsWith("auth.") && !operation.startsWith("machine.") && operation !== "apps.list") log(`${operation}: ok`);
          send(response, answer.ok ? 200 : STATUS[answer.error.code] ?? 500, answer);
        },
        (error: unknown) => send(response, 500, { ok: false, error: { code: "failed", message: error instanceof Error ? error.message : String(error) } }),
      );
    });
  });
}
