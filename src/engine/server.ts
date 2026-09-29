/**
 * The engine's server (D62, D76): JSON, one message per line, on a Unix
 * socket only. No HTTP and no TLS (D66, question 6): what the engine reads is
 * a line, at most 16 kB, parsed by JSON.parse and nothing else.
 *
 *   -> {"op": "<operation>", "args": {...}}
 *   <- {"ok": true, "result": ...}  or  {"ok": false, "error": {"code", "message"}}
 *
 * An ordinary operation is one line each way, and the engine closes the
 * connection. A stream operation (the agent's terminal, D76) answers its first
 * line the same way and, when that is `ok`, keeps the connection for lines both
 * ways, each at most 16 kB, until either side closes it.
 *
 * Anything else is refused: a line that is not a JSON object, one that is too
 * long, an operation that is not on the list.
 */
import net from "node:net";
import { type Answer, type Context, perform } from "./operations.js";

export const MAX_LINE = 16 * 1024;

/** What a stream operation is given: the connection, as lines. */
export interface StreamPeer {
  send(message: Record<string, unknown>): void;
  close(): void;
}

/** A stream operation's side of the connection, once it has started. */
export interface StreamHandle {
  message(message: unknown): void;
  closed(): void;
  /** Called once the first answer is written: only then may the stream send lines of its own. */
  start?(): void;
}

export type StreamStart = (args: unknown, peer: StreamPeer) => Promise<{ ok: true; handle: StreamHandle; result?: unknown } | { ok: false; answer: Answer }>;

const refuse = (code: "unknown_operation" | "bad_arguments", message: string): Answer => ({ ok: false, error: { code, message } });

export function createEngineServer(ctx: Context, log: (line: string) => void = () => {}, streams: Record<string, StreamStart> = {}): net.Server {
  return net.createServer((socket) => {
    let buffer = "";
    let first = true;
    let handle: StreamHandle | null = null;
    let open = true;
    socket.setEncoding("utf8");
    const write = (message: unknown) => {
      if (open && !socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
    };
    const finish = (answer: Answer) => {
      write(answer);
      socket.end();
    };
    const peer: StreamPeer = {
      send: (message) => write(message),
      close: () => {
        open = false;
        socket.end();
      },
    };

    const request = async (line: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return finish(refuse("bad_arguments", "the request is not JSON"));
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { op?: unknown }).op !== "string") {
        return finish(refuse("bad_arguments", 'the request is a JSON object: {"op": "<operation>", "args": {...}}'));
      }
      const { op, args = {} } = parsed as { op: string; args?: unknown };
      if (!/^[a-zA-Z.]{1,40}$/.test(op)) return finish(refuse("unknown_operation", "the engine has no such operation"));
      const stream = Object.hasOwn(streams, op) ? streams[op] : undefined;
      if (stream) {
        const started = await stream(args, peer).catch((error: unknown) => ({ ok: false as const, answer: { ok: false as const, error: { code: "failed" as const, message: error instanceof Error ? error.message : String(error) } } }));
        if (!started.ok) {
          log(`${op}: ${started.answer.ok ? "ok" : started.answer.error.code}`);
          return finish(started.answer);
        }
        // Never an argument's value, and nothing of the stream itself (D76).
        log(`${op}: open`);
        handle = started.handle;
        write({ ok: true, result: started.result ?? null });
        // Its own lines come after the answer, never before it.
        handle.start?.();
        return;
      }
      const answer = await perform(op, args, ctx);
      if (!answer.ok) log(`${op}: ${answer.error.code}`);
      else if (op !== "job.get" && !op.startsWith("auth.") && !op.startsWith("machine.") && op !== "apps.list" && !op.endsWith(".status")) log(`${op}: ok`);
      finish(answer);
    };

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.length > MAX_LINE) return finish(refuse("bad_arguments", `a message is longer than ${MAX_LINE / 1024} kB`));
        if (first) {
          first = false;
          void request(line);
        } else if (handle) {
          let message: unknown;
          try {
            message = JSON.parse(line);
          } catch {
            continue; // a stream's line that is not JSON is dropped
          }
          handle.message(message);
        }
        // A line after an ordinary request is not read: the engine answers one.
      }
      if (buffer.length > MAX_LINE) finish(refuse("bad_arguments", `a message is longer than ${MAX_LINE / 1024} kB`));
    });
    socket.on("close", () => {
      open = false;
      handle?.closed();
      handle = null;
    });
    socket.on("error", () => socket.destroy());
  });
}
