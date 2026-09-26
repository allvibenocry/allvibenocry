/**
 * Writing files the way a backup tool should: to a temporary name, flushed,
 * then renamed, so an interrupted write never leaves something that looks
 * finished (CLAUDE.md, mistakes 8). And only when the content differs, so a
 * second run can say "unchanged" truthfully.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import path from "node:path";

export function writeAtomic(file: string, content: string | Buffer, mode = 0o644): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.partial`;
  const fd = openSync(temporary, "w", mode);
  try {
    writeSync(fd, typeof content === "string" ? Buffer.from(content) : content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}

/** Write only if different. Returns whether it changed anything. */
export function ensureFile(file: string, content: string, mode = 0o644): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === content) return false;
  writeAtomic(file, content, mode);
  return true;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}
