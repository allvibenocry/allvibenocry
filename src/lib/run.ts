/**
 * Running other programs. Always an argument list, never a shell string, so
 * nothing is interpreted twice; and a secret never goes into an argument
 * (rule 4): it goes to standard input or into a file with restricted
 * permissions.
 */
import { spawnSync } from "node:child_process";

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  input?: string | Buffer;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class CommandFailed extends Error {
  constructor(
    readonly file: string,
    readonly args: string[],
    readonly result: Ran,
  ) {
    const said = (result.stderr || result.stdout).trim().split("\n").slice(-6).join("\n");
    super(`${file} ${args.slice(0, 4).join(" ")}${args.length > 4 ? " …" : ""} exited ${result.code}${said ? `: ${said}` : ""}`);
  }
}

/** Run and return the result, whatever the exit code. */
export function tryRun(file: string, args: string[], options: RunOptions = {}): Ran {
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeoutMs,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { code: 127, stdout: "", stderr: `${file}: not installed` };
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Run, and throw with what the program said if it fails. */
export function run(file: string, args: string[], options: RunOptions = {}): Ran {
  const result = tryRun(file, args, options);
  if (result.code !== 0) throw new CommandFailed(file, args, result);
  return result;
}
