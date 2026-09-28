/**
 * The documents every new project starts with (D36): AGENTS.md, the
 * instructions for any coding agent; CLAUDE.md, which points to it; and the
 * project's own STATE.md and DECISIONS.md. They come with the template, and
 * their placeholders are filled in when the project is created. Existing
 * projects are never changed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { posix as path } from "node:path";

export const PROJECT_DOCS = ["AGENTS.md", "CLAUDE.md", "STATE.md", "DECISIONS.md"] as const;

export interface DocValues {
  PROJECT: string;
  COMMAND: string;
  DATE: string;
}

/** Every `{{NAME}}` replaced; a placeholder with no value is an error, not left behind. */
export function fillPlaceholders(text: string, values: DocValues): string {
  return text.replace(/\{\{([A-Z]+)\}\}/g, (match, key: string) => {
    if (!(key in values)) throw new Error(`the template has a placeholder with no value: ${match}`);
    return values[key as keyof DocValues];
  });
}

/** Fill in the project's documents in a freshly copied template. Returns the files written. */
export function renderProjectDocs(repo: string, values: DocValues): string[] {
  const written: string[] = [];
  for (const name of PROJECT_DOCS) {
    const file = path.join(repo, name);
    if (!existsSync(file)) throw new Error(`the template has no ${name}: every project starts with one`);
    writeFileSync(file, fillPlaceholders(readFileSync(file, "utf8"), values));
    written.push(name);
  }
  return written;
}
