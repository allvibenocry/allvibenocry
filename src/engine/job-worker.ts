/**
 * A long job's command, off the engine's thread (D62, D77). The CLI's commands
 * wait while Docker builds and starts things, a minute and more on an agent's
 * first start: on the engine's own thread nothing else was answered meanwhile,
 * not the panel asking how the job goes (it gave up after 30 seconds), not a
 * terminal's keystrokes. Here the command runs as `allvibe` runs it, with
 * job-thread.ts sending the engine what it prints.
 */
import { agent } from "../commands/agent.js";
import { dev } from "../commands/dev.js";
import { project } from "../commands/project.js";
import { releaseCommands } from "../commands/release.js";
import { runHere } from "./job-thread.js";

runHere(({ kind, app, signIn }) => {
  if (kind === "putLive") return releaseCommands.release([app]);
  if (kind === "goBack") return releaseCommands.rollback([app]);
  // The agent and a new app (D76): the CLI's own commands, as `allvibe` runs them.
  if (kind === "agentStart") return agent(["start", app, "--sign-in", signIn ?? "key"]);
  if (kind === "agentStop") return agent(["stop", app]);
  if (kind === "createApp") return project(["create", app]);
  return dev(["deploy", app]);
});
