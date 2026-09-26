#!/usr/bin/env node
/**
 * The CLI: the engine the web UI will call (rule 5). Installed as
 * /usr/local/bin/<command>, which runs it as the service user.
 */
import { BRAND } from "./lib/brand.js";
import { doctor, suiteVersion } from "./commands/doctor.js";
import { project } from "./commands/project.js";
import { runs } from "./commands/runs.js";
import { scheduledBackup } from "./commands/scheduled.js";
import { setup } from "./commands/setup.js";

const C = BRAND.command;

const HELP = `${BRAND.product}: ${C} <command>

  doctor [--json]              the state of this host, in plain language
  project create <name>        a new project from the starter template, with dev and prod
  project list                 every project, and whether its dev and prod are running
  project status <name>        one project in detail
  project remove <name>        says what would be deleted; --delete-everything deletes it
  runs [project] [--limit N]   what has been done, and whether it worked
  version                      the installed version

Used by the installer and the timer:
  setup                        make the suite's own state what it should be
  scheduled-backup             the daily backup and restore test
`;

type Handler = (args: string[]) => number | Promise<number>;

const COMMANDS: Record<string, Handler> = {
  doctor: (args) => doctor(args),
  runs: (args) => runs(args),
  project: (args) => project(args),
  version: () => {
    process.stdout.write(`${BRAND.product} ${suiteVersion()}\n`);
    return 0;
  },
  setup: () => setup(),
  "scheduled-backup": () => scheduledBackup(),
};

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return command ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`${C}: unknown command "${command}"\n\n${HELP}`);
    return 2;
  }
  return handler(args);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${C}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
