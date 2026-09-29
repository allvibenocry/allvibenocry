// A job's thread for the engine's tests (engine.test.mjs): the real plumbing
// (job-thread.js), with commands of the test's own, chosen by the order's app.
import { runHere } from "../../dist/engine/job-thread.js";
import { takeLock } from "../../dist/lib/lock.js";
import { fail, ok, runSteps } from "../../dist/lib/steps.js";

runHere(async ({ app, file }) => {
  if (app === "steps") {
    console.log("a line from console.log, before the steps");
    const record = await runSteps(
      [
        { name: "dev runs the commit", run: () => ok("dev runs abc123") },
        { name: "every step of the plan is tried by you", run: () => fail("the plan has steps you have not tried: step 2", "try each in dev") },
        { name: "never reached", run: () => ok("no") },
      ],
      { kind: "release", project: "guestbook", record: false },
    );
    return record.ok ? 0 : 1;
  }
  if (app === "throws") throw new Error("the command broke");
  if (app === "exits") process.exit(3);
  if (app === "locked") {
    // The command takes the app's lock, as the CLI's commands do (withLock).
    const taken = takeLock(app, "release", file);
    process.stdout.write(`${taken.ok ? "the lock: held already, by this process" : taken.message}\n`);
    return taken.ok ? 0 : 1;
  }
  return 2;
});
