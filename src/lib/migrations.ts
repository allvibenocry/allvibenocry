/**
 * Migrations: what a release changes in the database, and whether the version
 * before it can still run on the result (D35, closing the gap in D31).
 *
 * A project's migrations are the numbered SQL files in `migrations/`, each
 * applied once, in name order, and recorded by file name in the database's
 * `schema_migrations` table (the template's convention, D19). So the schema a
 * database has is the list of file names in that table, and the schema a
 * version of the code knows is the list of files in its commit.
 *
 * Every migration is **additive** or **breaking**:
 *
 * - additive: new tables, new indexes that are not unique, new columns that
 *   are nullable or have a default, and a few other things that add without
 *   changing what is there (views, sequences, types, functions, comments,
 *   inserted rows). Code written before it runs on the schema after it,
 *   because nothing it reads or writes has changed.
 * - breaking: anything else, because it drops, renames, changes a type, adds a
 *   constraint the existing data may violate, or changes rows in place. And
 *   anything this code cannot read with certainty: a statement it does not
 *   recognise is breaking, never additive.
 *
 * A breaking migration is released only when its file says so, in a line
 * comment of its own: `-- breaking: <what it changes>`. That line is the
 * user's agreement, written where the change is.
 */

export type MigrationKind = "additive" | "breaking";

export interface StatementVerdict {
  kind: MigrationKind;
  /** The statement's first words, for a message. */
  statement: string;
  /** Why it is breaking, in plain words; empty when additive. */
  why: string;
}

export interface MigrationVerdict {
  kind: MigrationKind;
  /** The `-- breaking: <reason>` mark, if the file has one. */
  mark: string | null;
  statements: StatementVerdict[];
}

/** The mark that allows a breaking migration: a line of its own. */
const MARK = /^[ \t]*--[ \t]*breaking[ \t]*:[ \t]*(\S.*?)[ \t]*$/im;

/**
 * SQL split into statements, with comments removed and the insides of quotes
 * kept whole: `'...'`, `"..."`, `$tag$...$tag$`, `-- ...` and `/* ... *\/`
 * (nested, as Postgres allows).
 */
export function splitSql(text: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const flush = () => {
    const trimmed = current.replace(/\s+/g, " ").trim();
    if (trimmed) statements.push(trimmed);
    current = "";
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end + 1;
      current += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") { depth += 1; i += 2; }
        else if (text[i] === "*" && text[i + 1] === "/") { depth -= 1; i += 2; }
        else i += 1;
      }
      current += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === c && text[j + 1] === c) j += 2;
        else if (text[j] === c) break;
        else j += 1;
      }
      current += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const tag = text.slice(i).match(/^\$[A-Za-z_]?[A-Za-z0-9_]*\$/)?.[0];
      if (tag) {
        const end = text.indexOf(tag, i + tag.length);
        const stop = end === -1 ? text.length : end + tag.length;
        current += text.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      flush();
      i += 1;
      continue;
    }
    current += c;
    i += 1;
  }
  flush();
  return statements;
}

/** Top-level comma-separated parts, outside parentheses and quotes. */
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** Text with quoted parts blanked, so keywords are only found outside them. */
const unquoted = (text: string) => text.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');

const additive = (statement: string): StatementVerdict => ({ kind: "additive", statement: shortly(statement), why: "" });
const breaking = (statement: string, why: string): StatementVerdict => ({ kind: "breaking", statement: shortly(statement), why });
const shortly = (statement: string) => (statement.length > 80 ? `${statement.slice(0, 77)}...` : statement);

/** One added column: nullable, or with a default, and no constraint that existing rows could break. */
function addedColumn(definition: string, statement: string): StatementVerdict {
  const words = unquoted(definition).toLowerCase();
  if (/\b(unique|primary\s+key|references|check|generated|exclude)\b/.test(words)) {
    return breaking(statement, "the new column comes with a constraint the rows already there may not meet");
  }
  if (/\bnot\s+null\b/.test(words) && !/\bdefault\b/.test(words)) {
    return breaking(statement, "the new column must not be empty and has no default, so the rows already there cannot have it");
  }
  return additive(statement);
}

/** One statement: additive, or breaking and why. Anything unrecognised is breaking. */
export function classifyStatement(statement: string): StatementVerdict {
  const s = unquoted(statement).replace(/\s+/g, " ").trim();
  const lower = s.toLowerCase();

  if (/^(begin|commit|start transaction|end)( (work|transaction))?$/.test(lower)) return additive(statement);
  if (/^create (temp |temporary |unlogged )?table /.test(lower)) return additive(statement);
  if (/^create unique index /.test(lower)) return breaking(statement, "a unique index is a constraint the rows already there may not meet");
  if (/^create index /.test(lower)) return additive(statement);
  if (/^create (sequence|type|schema|extension|view|materialized view|function|procedure) /.test(lower)) return additive(statement);
  if (/^create or replace /.test(lower)) return breaking(statement, "it replaces something that already exists, which older code may rely on");
  if (/^comment on /.test(lower)) return additive(statement);
  if (/^insert into /.test(lower)) return additive(statement);

  const alter = s.match(/^alter table (?:if exists )?(?:only )?("(?:[^"]|"")*"|[\w.]+) (.*)$/i);
  if (alter) {
    const actions = topLevelParts(alter[2]);
    for (const action of actions) {
      const add = action.match(/^add (?:column )?(?:if not exists )?(.*)$/i);
      if (!add || /^add (constraint|primary key|unique|check|foreign key|exclude)\b/i.test(action)) {
        return breaking(statement, /^add\b/i.test(action)
          ? "it adds a constraint the rows already there may not meet"
          : `it changes the table in a way older code may not expect (${action.split(" ").slice(0, 3).join(" ").toLowerCase()})`);
      }
      const verdict = addedColumn(add[1], statement);
      if (verdict.kind === "breaking") return verdict;
    }
    return additive(statement);
  }

  if (/^drop /.test(lower)) return breaking(statement, "it deletes something, and older code may still use it");
  if (/^alter /.test(lower)) return breaking(statement, "it changes something that older code may rely on");
  if (/^(update|delete|truncate|merge) /.test(lower)) return breaking(statement, "it changes or removes rows that are already there");
  if (/^do /.test(lower)) return breaking(statement, "it runs code whose effect cannot be read from the file");
  return breaking(statement, "it is not one of the statements known to only add, so it counts as breaking");
}

/** A whole migration file: breaking if any statement is. */
export function classifyMigration(text: string): MigrationVerdict {
  const statements = splitSql(text).map(classifyStatement);
  const mark = text.match(MARK)?.[1] ?? null;
  return { kind: statements.some((v) => v.kind === "breaking") ? "breaking" : "additive", mark, statements };
}

/** The first reason a migration is breaking, in plain words. */
export function breakingReason(verdict: MigrationVerdict): string {
  const first = verdict.statements.find((v) => v.kind === "breaking");
  return first ? `"${first.statement}": ${first.why}` : "";
}

/** Only numbered SQL files directly in migrations/ are migrations. */
export const isMigrationFile = (name: string) => /^[^/]+\.sql$/.test(name);
