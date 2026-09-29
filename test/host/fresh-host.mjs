#!/usr/bin/env node
// A fresh test host, installed and ready for the probes and browser checks:
// walkthrough steps 1, 2, 5 and 6, from one bundle, with nothing typed.
//
//   node test/host/fresh-host.mjs [<bundle dir>] [--keep]
//
// The bundle is bundle/<command>-<version> unless another is given (an older
// one, for a negative control). --keep installs it over the test host that is
// there instead of making a fresh one: an upgrade. Prints each step's last
// line; never the setup code or the recovery key, which stays in
// .local/recovery-key.txt (gitignored), as in the walkthrough.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const command = readFileSync(path.join(ROOT, "brand.conf"), "utf8").match(/^COMMAND_NAME="?([^"\n]+)"?/m)[1];
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const bundle = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(ROOT, "bundle", `${command}-${version}`));
if (!existsSync(path.join(bundle, "install.sh"))) throw new Error(`no bundle at ${bundle}: npm run bundle first`);

const host = (...a) => spawnSync(process.execPath, [path.join(ROOT, "test/host/host.mjs"), ...a], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const step = (what, result, { show = 1 } = {}) => {
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").filter((l) => l.trim() && !/setup code/i.test(l));
  console.log(`${result.status === 0 ? "ok  " : "FAIL"} ${what}${out.length ? `: ${out.slice(-show).join(" | ").trim()}` : ""}`);
  if (result.status !== 0) {
    console.log(out.slice(-15).join("\n"));
    process.exit(1);
  }
  return result;
};

if (!keep) step("a fresh test host", host("reset"), { show: 2 });
step(`the bundle, ${readFileSync(path.join(bundle, "VERSION"), "utf8").trim()}`, host("push", bundle, "/root/"));
step("install.sh", host("exec", "--", "bash", `/root/${path.basename(bundle)}/install.sh`), { show: 2 });
if (!keep) {
  step("the backup disk, the service user's", host("exec", "--", "chown", `${command}:${command}`, `/mnt/${command}-backup`));
  step("the backup target", host("exec", "--", command, "backup-target", "set", `/mnt/${command}-backup`));
  step("the recovery key, taken off the machine", host("pull", `/etc/${command}/recovery-key-UNCONFIRMED.txt`, ".local/recovery-key.txt"));
  step("the recovery key, confirmed", host("exec", "--stdin-file", ".local/recovery-key.txt", "--", command, "recovery-key", "confirm"));
}
step("doctor", host("exec", "--", command, "doctor"), { show: 1 });
