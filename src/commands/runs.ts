/** `allvibe runs`: what the suite has done, most recent last. */
import { listRecords } from "../lib/steps.js";

export function runs(args: string[]): number {
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 20;
  const project = args.find((a) => !a.startsWith("--") && a !== String(limit));
  const records = listRecords().filter((r) => !project || r.project === project).slice(-limit);
  if (records.length === 0) {
    process.stdout.write("No runs recorded yet.\n");
    return 0;
  }
  for (const r of records) {
    const when = r.started.slice(0, 19).replace("T", " ");
    const what = `${r.kind}${r.project ? ` ${r.project}` : ""}${r.dryRun ? " (dry run)" : ""}`;
    const result = r.ok ? "ok" : `FAILED at "${r.failedStep}": ${r.steps.at(-1)?.why ?? ""}`;
    process.stdout.write(`${when} UTC  ${what.padEnd(34)} ${result}\n`);
  }
  return 0;
}
