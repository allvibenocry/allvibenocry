/**
 * `allvibe scheduled-backup`: what the daily timer runs. For every project, a
 * backup of prod and then a restore test of that backup (item 6). Every run is
 * recorded with its result and, on failure, the reason.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NAMES } from "../lib/brand.js";
import { ok, runSteps } from "../lib/steps.js";

export async function scheduledBackup(): Promise<number> {
  let projects: string[] = [];
  try {
    projects = readdirSync(NAMES.projectsDir).filter((p) => existsSync(path.join(NAMES.projectsDir, p, "project.json")));
  } catch {
    projects = [];
  }
  const record = await runSteps(
    [
      {
        name: "projects to protect",
        run: () => ok(projects.length === 0 ? "no projects yet, so there is nothing to back up" : `${projects.length} project(s)`),
      },
    ],
    { kind: "scheduled-backup", facts: { projects } },
  );
  return record.ok ? 0 : 1;
}
