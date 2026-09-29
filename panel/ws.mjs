// A WebSocket, as RFC 6455 has it, with only what the terminal needs (D76):
// the handshake, text and binary messages both ways, ping and pong, and
// closing. Node's standard library only, as the rest of the panel.
//
// A browser's frames must be masked, and a message is at most 64 kB, however
// it is split; anything else closes the connection.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_MESSAGE = 64 * 1024;

export const acceptKey = (key) => createHash("sha1").update(`${key}${GUID}`).digest("base64");

/** The answer that opens a WebSocket. */
export function handshake(socket, key) {
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`, "", ""].join("\r\n"));
}

/** A refusal, before any WebSocket is opened. */
export function refuseUpgrade(socket, status, reason) {
  const body = `${reason}\n`;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

/** One frame from the server: unmasked, whole. */
export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const head = data.length < 126 ? Buffer.alloc(2) : data.length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (data.length < 126) head[1] = data.length;
  else if (data.length < 65536) {
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([head, data]);
}

/**
 * An open WebSocket. Events: "message" (a Buffer, and whether it was text),
 * "close" (the code). Methods: sendText, sendBinary, ping, close.
 */
export class WebSocketConnection extends EventEmitter {
  constructor(socket, head = Buffer.alloc(0)) {
    super();
    this.socket = socket;
    this.buffer = head;
    this.parts = [];
    this.partOpcode = 0;
    this.closed = false;
    socket.setNoDelay?.(true);
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.read();
    });
    socket.on("close", () => this.finish(1006));
    socket.on("error", () => this.finish(1006));
    if (head.length) this.read();
  }

  read() {
    for (;;) {
      if (this.closed || this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let at = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009, "too big");
        length = Number(big);
        at = 10;
      }
      if (!masked) return this.close(1002, "a browser's frames are masked");
      if (length > MAX_MESSAGE) return this.close(1009, "too big");
      if (this.buffer.length < at + 4 + length) return;
      const mask = this.buffer.subarray(at, at + 4);
      const payload = Buffer.from(this.buffer.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(at + 4 + length);

      if (opcode === 0x8) return this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000);
      if (opcode === 0x9) {
        this.write(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) {
        this.emit("pong");
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        this.partOpcode = opcode;
        this.parts = [payload];
      } else if (opcode === 0x0 && this.partOpcode) {
        this.parts.push(payload);
      } else {
        return this.close(1002, "an unknown frame");
      }
      const total = this.parts.reduce((n, p) => n + p.length, 0);
      if (total > MAX_MESSAGE) return this.close(1009, "too big");
      if (fin) {
        const message = Buffer.concat(this.parts);
        const text = this.partOpcode === 0x1;
        this.parts = [];
        this.partOpcode = 0;
        this.emit("message", message, text);
      }
    }
  }

  write(frame) {
    if (!this.closed && !this.socket.destroyed) this.socket.write(frame);
  }
  sendText(text) {
    this.write(encodeFrame(0x1, Buffer.from(text, "utf8")));
  }
  sendBinary(data) {
    this.write(encodeFrame(0x2, data));
  }
  ping() {
    this.write(encodeFrame(0x9));
  }
  close(code = 1000, reason = "") {
    if (this.closed) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.write(encodeFrame(0x8, payload));
    this.socket.end();
    this.finish(code);
  }
  finish(code) {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", code);
  }
}
