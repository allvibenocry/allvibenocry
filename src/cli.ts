#!/usr/bin/env node
/**
 * The CLI: the engine the web UI will call (rule 5). Installed as
 * /usr/local/bin/<command>, which runs it as the service user.
 */
import { BRAND } from "./lib/brand.js";
import { agent } from "./commands/agent.js";
import { backupCommands } from "./commands/backup.js";
import { dev } from "./commands/dev.js";
import { doctor, suiteVersion } from "./commands/doctor.js";
import { key, keysUnlock } from "./commands/key.js";
import { mdnsPublish } from "./commands/mdns.js";
import { panel } from "./commands/panel.js";
import { plan } from "./commands/plan.js";
import { project } from "./commands/project.js";
import { releaseCommands } from "./commands/release.js";
import { runs } from "./commands/runs.js";
import { scheduledBackup } from "./commands/scheduled.js";
import { setup } from "./commands/setup.js";

const C = BRAND.command;

const HELP = `${BRAND.product}: ${C} <command>

  doctor [--json]              the state of this host, in plain language
  doctor --last [--json]       what the nightly check found, the last time it ran with the backup
  project create <name>        a new project from the starter template, with dev and prod
  project list                 every project, and whether its dev and prod are running
  project status <name>        one project in detail
  project remove <name>        says what would be deleted; --delete-everything deletes it
  dev deploy <project>         rebuild dev from its working tree, and check it
  dev commit <project> <msg>   commit dev's changes: a release is a commit
  agent start <project>        the coding agent (Claude Code) in dev, with its key from the vault
  agent start <project> --sign-in account   the same, for you to sign in to your own Claude account in it
  agent shell <project>        its own session, in this terminal; -- <command> runs a command instead
  agent stop <project>         the agent gone
  agent activity <project>     what the agent did: one line per tool call
  agent transcripts <project>  its kept conversations; --delete deletes them
  panel status                 the control panel: where it answers, and whether it is set up
  panel setup-code             a one-time code for the panel's first visit, shown here only
  panel reset                  a forgotten panel password: a new setup code, everyone signed out
  plan <project>               the plan dev runs, and where each step stands
  plan tried <project> <step>  you tried this step in dev, and it works (only you can mark it)
  release <project>            dev's commit to prod, after a backup and a restore check; every step of its plan tried
  release <project> --outside-plan "reason"   work outside any plan, with your reason, which the record keeps
  release <project> --dry-run  every check, and nothing changed
  rollback <project>           prod back to its previous version, keeping its data
  rollback <project> --restore-data   the data back too, as before the release: says what is lost first
  backup-target set <dir>      where backups go: a directory on a separate disk
  backup-target show           where they go, and whether it is usable
  backup <project>             an encrypted backup of prod, now
  backups <project>            the backups of a project
  restore-check <project>      restore the latest backup into a scratch copy and check it
  key set <project> <dev|prod|agent> <NAME> < file   a key for the apps or the agent, from standard input
  key list <project>           the vault's keys: names, scopes and when each changed, never values
  key remove <project> <scope> <NAME>   a key out of the vault
  recovery-key status          whether the recovery key has been confirmed
  recovery-key confirm < file  confirm your copy of the recovery key
  runs [project] [--limit N]   what has been done, and whether it worked
  version                      the installed version

Used by the installer and the timer:
  setup                        make the suite's own state what it should be
  scheduled-backup             the daily backup and restore test
  keys-unlock                  every key back in memory, at boot, before the apps start
  mdns-publish                 the control panel's name on the home network, by multicast DNS
`;

type Handler = (args: string[]) => number | Promise<number>;

const COMMANDS: Record<string, Handler> = {
  doctor: (args) => doctor(args),
  runs: (args) => runs(args),
  project: (args) => project(args),
  ...backupCommands,
  ...releaseCommands,
  dev: (args) => dev(args),
  key: (args) => key(args),
  agent: (args) => agent(args),
  plan: (args) => plan(args),
  panel: (args) => panel(args),
  "keys-unlock": () => keysUnlock(),
  version: () => {
    process.stdout.write(`${BRAND.product} ${suiteVersion()}\n`);
    return 0;
  },
  setup: () => setup(),
  "scheduled-backup": () => scheduledBackup(),
  "mdns-publish": () => mdnsPublish(),
};

// Output piped into something that stops reading (`| head`) is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
  throw error;
});

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
