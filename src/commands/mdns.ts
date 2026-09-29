/**
 * `allvibe mdns-publish`: what `allvibe-mdns.service` runs (D74). It announces
 * the control panel's name, `allvibe.local`, on the home network by multicast
 * DNS, through Debian's Avahi, for the machine's home-network address, and
 * follows that address when it changes (a new lease after a reboot).
 *
 * Only the name is announced, with its address: no service, no other record.
 * A device that cannot find `.local` names reaches the panel at the address
 * instead (D74). If another device on the network already has the name, Avahi
 * says so, and so does this, and doctor (`mdns`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { NAMES } from "../lib/brand.js";
import { lanAddress } from "../lib/project.js";

const CHECK_EVERY_MS = 30_000;

export async function mdnsPublish(): Promise<number> {
  let child: ChildProcess | null = null;
  let address = "";
  const say = (line: string) => process.stdout.write(`${line}\n`);

  const start = () => {
    address = lanAddress();
    say(`announcing ${NAMES.panelName} for ${address}`);
    const c = spawn("avahi-publish", ["--address", "--no-reverse", NAMES.panelName, address], { stdio: ["ignore", "pipe", "pipe"] });
    child = c;
    const relay = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        say(/collision/i.test(line) ? `another device on the home network already has the name ${NAMES.panelName} (${line.trim()})` : line.trim());
      }
    };
    c.stdout?.on("data", relay);
    c.stderr?.on("data", relay);
    c.on("exit", (code) => {
      if (child !== c) return;
      say(`avahi-publish ended (${code}); systemd starts this again`);
      process.exit(1);
    });
  };

  start();
  // A new address (after a reboot, a new lease): the name follows it.
  setInterval(() => {
    const now = lanAddress();
    if (now === address || !child) return;
    say(`the machine's address changed from ${address} to ${now}`);
    const old = child;
    child = null;
    old.kill("SIGTERM");
    start();
  }, CHECK_EVERY_MS);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      const c = child;
      child = null;
      c?.kill("SIGTERM");
      process.exit(0);
    });
  }
  return new Promise<number>(() => {});
}
