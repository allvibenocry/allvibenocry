/**
 * The agent's terminal (D69, D76): Claude Code's own interface, in the agent's
 * container, with a terminal of its own, streamed through the panel to one
 * browser at a time. The person drives it; the suite never types into it
 * (D48, rule 17), and keeps nothing of it: what passes is handed on, and what
 * arrives while no browser is attached is dropped. Not logged, not written,
 * not kept for a browser that comes back.
 *
 * - **Opened by the person.** Claude Code is started in the agent only when
 *   the person asks for it (`start`); a browser that comes to a running one
 *   joins it, and it draws itself again for the new window's size.
 * - **One browser at a time.** A second takes over: the first is told
 *   ("taken") and let go. There is one person, and a window left open on
 *   another device must not lock them out.
 * - **Idle.** After a while with nothing typed and nothing shown, Claude Code
 *   is hung up on, as a closed terminal hangs up on a program, and the browser
 *   is told ("idle"). Its conversation is kept by Claude Code itself (D60).
 * - **Resizing** follows the browser's window.
 *
 * Docker is asked through its own API, on its socket, as the engine's user
 * (the service user, as for every other operation): an exec with a terminal,
 * its raw stream, and its size.
 */
import http from "node:http";
import type { Duplex } from "node:stream";
import type { StreamHandle } from "./server.js";

/** What the terminal needs from Docker. */
export interface ExecApi {
  /** Claude Code started in the container, with a terminal of that size: its id and its raw stream. */
  start(container: string, cols: number, rows: number): Promise<{ id: string; stream: Duplex }>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  /** Hangs up on it, as a closed terminal does. */
  hangUp(id: string): Promise<void>;
}

/** A browser, through the panel: messages to it, and letting it go. */
export interface Client {
  send(message: Record<string, unknown>): void;
  close(): void;
}

interface Session {
  app: string;
  id: string;
  stream: Duplex;
  client: Client | null;
  last: number;
  why: string | null;
}

export const MAX_INPUT = 16 * 1024;
export const DEFAULT_IDLE_MS = 30 * 60_000;
const size = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
export const validSize = (cols: unknown, rows: unknown) => size(cols, 20, 500) && size(rows, 5, 300);

export type Attached = { ok: true; handle: StreamHandle; result: { session: "started" | "joined" } } | { ok: false; code: "refused" | "not_found"; message: string };

export class Terminals {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly api: ExecApi,
    private readonly agentRunning: (app: string) => boolean,
    private readonly container: (app: string) => string,
    private readonly idleMs: () => number = () => DEFAULT_IDLE_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  status(app: string): { open: boolean; attached: boolean } {
    const s = this.sessions.get(app);
    return { open: Boolean(s), attached: Boolean(s?.client) };
  }

  /** A browser attaches: to Claude Code as it runs, or, when the person asked, to a new one. */
  async attach(app: string, client: Client, cols: number, rows: number, start: boolean): Promise<Attached> {
    if (!this.agentRunning(app)) return { ok: false, code: "refused", message: "Your AI is not running. Start it first." };
    const running = this.sessions.get(app);
    if (running) {
      if (running.client && running.client !== client) {
        running.client.send({ t: "taken", message: "This terminal was opened in another window." });
        running.client.close();
      }
      // Nobody's until the new window has its answer (start, below).
      running.client = null;
      running.last = this.now();
      const handle = this.handle(running, client, () => {
        // A resize is how a terminal program learns to draw itself again: one
        // row fewer, then the size, so that it redraws even at the same size.
        void this.api
          .resize(running.id, cols, Math.max(5, rows - 1))
          .then(() => this.api.resize(running.id, cols, rows))
          .catch(() => {});
      });
      return { ok: true, handle, result: { session: "joined" } };
    }
    if (!start) return { ok: false, code: "not_found", message: "Claude Code is not open in your AI. Open it to talk to it." };
    const { id, stream } = await this.api.start(this.container(app), cols, rows);
    const session: Session = { app, id, stream, client: null, last: this.now(), why: null };
    this.sessions.set(app, session);
    stream.on("data", (chunk: Buffer) => {
      session.last = this.now();
      // To the browser, if one is attached; otherwise dropped, never kept.
      session.client?.send({ t: "out", d: Buffer.from(chunk).toString("base64") });
    });
    const ended = () => {
      if (this.sessions.get(app) !== session) return;
      this.sessions.delete(app);
      session.client?.send({ t: "ended", why: session.why ?? "exit" });
      session.client?.close();
      session.client = null;
    };
    stream.on("end", ended);
    stream.on("close", ended);
    stream.on("error", ended);
    return { ok: true, handle: this.handle(session, client), result: { session: "started" } };
  }

  private handle(session: Session, client: Client, then: () => void = () => {}): StreamHandle {
    return {
      // Once the browser has its answer: from now on what Claude Code shows is its.
      start: () => {
        session.client = client;
        then();
      },
      message: (m) => {
        if (session.client !== client || !m || typeof m !== "object") return;
        const message = m as { t?: unknown; d?: unknown; cols?: unknown; rows?: unknown };
        if (message.t === "in" && typeof message.d === "string" && message.d.length > 0 && message.d.length <= MAX_INPUT) {
          session.last = this.now();
          session.stream.write(message.d, "utf8");
        } else if (message.t === "resize" && validSize(message.cols, message.rows)) {
          void this.api.resize(session.id, message.cols as number, message.rows as number).catch(() => {});
        }
      },
      closed: () => {
        if (session.client === client) session.client = null;
      },
    };
  }

  /** Hangs up on every Claude Code that has had nothing typed and nothing shown for too long. */
  async sweep(): Promise<string[]> {
    const limit = this.idleMs();
    const idle = [...this.sessions.values()].filter((s) => this.now() - s.last > limit);
    for (const s of idle) await this.end(s.app, "idle");
    return idle.map((s) => s.app);
  }

  /** Ends an app's terminal: a hang-up, and, if that is not enough, the stream closed. */
  async end(app: string, why: string): Promise<void> {
    const s = this.sessions.get(app);
    if (!s) return;
    s.why = why;
    await this.api.hangUp(s.id).catch(() => {});
    setTimeout(() => {
      if (this.sessions.get(app) === s) s.stream.destroy();
    }, 5000).unref?.();
  }
}

/* ------------------------------------------------------ Docker's API -- */

const DOCKER_SOCKET = "/var/run/docker.sock";

function dockerJson(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      { socketPath: DOCKER_SOCKET, method, path, headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {} },
      (response) => {
        let data = "";
        response.on("data", (c) => (data += c));
        response.on("end", () => {
          let json: unknown = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

/** The exec API on the machine's Docker. */
export const dockerExec: ExecApi = {
  async start(container, cols, rows) {
    const created = await dockerJson("POST", `/containers/${encodeURIComponent(container)}/exec`, {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      ConsoleSize: [rows, cols],
      Cmd: ["claude"],
      WorkingDir: "/workspace",
      Env: ["TERM=xterm-256color"],
    });
    const id = (created.json as { Id?: string } | null)?.Id;
    if (created.status !== 201 || !id) throw new Error(`Docker would not start Claude Code in ${container} (${created.status})`);
    const stream = await new Promise<Duplex>((resolve, reject) => {
      const payload = JSON.stringify({ Detach: false, Tty: true, ConsoleSize: [rows, cols] });
      const request = http.request({
        socketPath: DOCKER_SOCKET,
        method: "POST",
        path: `/exec/${id}/start`,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Connection: "Upgrade", Upgrade: "tcp" },
      });
      request.on("upgrade", (_response, socket: Duplex, head: Buffer) => {
        if (head.length) socket.unshift(head);
        resolve(socket);
      });
      request.on("response", (response) => reject(new Error(`Docker did not open Claude Code's terminal (${response.statusCode})`)));
      request.on("error", reject);
      request.end(payload);
    });
    return { id, stream };
  },
  async resize(id, cols, rows) {
    await dockerJson("POST", `/exec/${id}/resize?h=${rows}&w=${cols}`);
  },
  async hangUp(id) {
    const inspected = await dockerJson("GET", `/exec/${id}/json`);
    const pid = (inspected.json as { Pid?: number; Running?: boolean } | null)?.Pid;
    if (!pid || !(inspected.json as { Running?: boolean }).Running) return;
    // Claude Code runs as the service user, as the engine does: a hang-up,
    // then, if it is still there, a stop.
    try {
      process.kill(pid, "SIGHUP");
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
    const again = await dockerJson("GET", `/exec/${id}/json`);
    if ((again.json as { Running?: boolean } | null)?.Running) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* gone meanwhile */
      }
    }
  },
};
