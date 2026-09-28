// Unit tests for telling additive migrations from breaking ones (D35).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyMigration, classifyStatement, splitSql } from "../../dist/lib/migrations.js";

const kind = (sql) => classifyMigration(sql).kind;

test("statements are split on semicolons outside quotes, comments and dollar quotes", () => {
  const sql = `-- a comment; not a statement
create table a (t text default 'x;y');
/* a block; comment /* nested; */ still comment */
create function f() returns int as $body$ select 1; $body$ language sql;
insert into a (t) values ('it''s; fine')`;
  assert.deepEqual(splitSql(sql), [
    "create table a (t text default 'x;y')",
    "create function f() returns int as $body$ select 1; $body$ language sql",
    "insert into a (t) values ('it''s; fine')",
  ]);
});

test("the template's first migration only adds", () => {
  const text = readFileSync(new URL("../../templates/guestbook/migrations/001_create_entries.sql", import.meta.url), "utf8");
  assert.equal(kind(text), "additive");
});

test("additive: new tables, plain indexes, nullable or defaulted columns, rows, views, comments", () => {
  for (const sql of [
    "create table moods (id int primary key, name text not null unique)",
    "CREATE TABLE IF NOT EXISTS tags (name text)",
    "create index entries_created on entries (created_at)",
    "alter table entries add column mood text",
    "alter table entries add mood text null",
    "alter table entries add column if not exists stars int not null default 0",
    "alter table entries add column a text, add column b int default 1",
    "insert into moods (name) values ('happy')",
    "create view recent as select * from entries",
    "comment on table entries is 'drop column is not a statement here'",
    "begin; create table t (x int); commit",
  ]) assert.equal(kind(sql), "additive", sql);
});

test("breaking: drops, renames, type changes, new constraints, rewritten rows, and anything unknown", () => {
  for (const [sql, why] of [
    ["drop table entries", /deletes/],
    ["alter table entries drop column mood", /changes the table/],
    ["alter table entries rename column name to author", /changes the table/],
    ["alter table entries rename to posts", /changes the table/],
    ["alter table entries alter column message type varchar(200)", /changes the table/],
    ["alter table entries alter column mood set not null", /changes the table/],
    ["alter table entries add column rating int not null", /no default/],
    ["alter table entries add column code text unique", /constraint/],
    ["alter table entries add constraint entries_name_unique unique (name)", /constraint/],
    ["create unique index entries_name on entries (name)", /unique index/],
    ["update entries set name = trim(name)", /rows/],
    ["delete from entries where name = ''", /rows/],
    ["truncate entries", /rows/],
    ["do $$ begin perform 1; end $$", /code/],
    ["grant select on entries to public", /not one of the statements/],
    ["create or replace view recent as select 1", /replaces/],
  ]) {
    const verdict = classifyMigration(sql);
    assert.equal(verdict.kind, "breaking", sql);
    assert.match(verdict.statements.find((s) => s.kind === "breaking").why, why, sql);
  }
});

test("one breaking statement makes the whole file breaking", () => {
  assert.equal(kind("alter table entries add column mood text; alter table entries drop column name"), "breaking");
});

test("the walkthrough's unique-names migration is breaking, and needs the mark", () => {
  const unmarked = classifyMigration("-- One entry per name.\nalter table entries add constraint entries_name_unique unique (name);\n");
  assert.equal(unmarked.kind, "breaking");
  assert.equal(unmarked.mark, null);
  const marked = classifyMigration("-- One entry per name.\n-- breaking: one entry per name, which older entries may not meet\nalter table entries add constraint entries_name_unique unique (name);\n");
  assert.equal(marked.kind, "breaking");
  assert.equal(marked.mark, "one entry per name, which older entries may not meet");
});

test("the mark needs a reason, on a line of its own", () => {
  assert.equal(classifyMigration("-- breaking:\ndrop table x").mark, null);
  assert.equal(classifyMigration("drop table x -- breaking: inline does not count").mark, null);
  assert.equal(classifyMigration("--breaking: drops x\ndrop table x").mark, "drops x");
});

test("keywords inside strings do not decide anything", () => {
  assert.equal(classifyStatement("insert into entries (name, message) values ('x', 'drop table entries')").kind, "additive");
  assert.equal(classifyStatement("alter table entries add column note text default 'not null'").kind, "additive");
});
