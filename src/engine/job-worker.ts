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
import { removeKeyFrom, setKey } from "../commands/key.js";
import { project } from "../commands/project.js";
import { releaseCommands } from "../commands/release.js";
import { withLock } from "../lib/lock.js";
import { readProject } from "../lib/project.js";
import { runHere } from "./job-thread.js";

runHere(({ kind, app, signIn, outsidePlan, scope, name, value }) => {
  if (kind === "putLive") return releaseCommands.release(outsidePlan ? [app, "--outside-plan", outsidePlan] : [app]);
  if (kind === "goBack") return releaseCommands.rollback([app]);
  // The agent and a new app (D76): the CLI's own commands, as `allvibe` runs them.
  if (kind === "agentStart") return agent(["start", app, "--sign-in", signIn ?? "key"]);
  if (kind === "agentStop") return agent(["stop", app]);
  if (kind === "createApp") return project(["create", app]);
  // D82: going back with the data, once the person typed the app's name; removing an app; service keys.
  if (kind === "goBackWithData") return releaseCommands.rollback([app, "--restore-data", "--confirm-data-loss"]);
  if (kind === "removeApp") return project(["remove", app, "--delete-everything"]);
  if (kind === "keySet") return withLock(app, "key-set", () => setKey(readProject(app), scope!, name!, Buffer.from(value!, "utf8")));
  if (kind === "keyRemove") return withLock(app, "key-set", () => removeKeyFrom(readProject(app), scope!, name!));
  return dev(["deploy", app]);
});
