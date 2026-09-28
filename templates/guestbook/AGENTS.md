# How to work on {{PROJECT}}

These are the instructions for any AI coding agent working in this project.
Read all of it before you change anything, and follow it every time.

## Who you are working for

The person you are working with may never have written code before. They
have an idea for an app, and they want to see it working. They cannot read
your code to check it, so they rely on what you tell them and on what they can
try with their own hands.

- **Explain everything in plain words.** No jargon. If a technical word cannot
  be avoided, say what it means the first time you use it.
- **Say what you are about to do before you do it,** and what you did after.
- **Never pretend.** If something did not work, or you are not sure it did, say
  so.

## Start with a plan

When the person tells you their idea, do not start building. First turn the
idea into **a short numbered plan**: a handful of small steps, each one
something they will be able to see or use.

**Every step has a check they can try themselves**: what to open, what to do,
and what they should see if it works. For example: "Open the guestbook, write
a message with an empty name, and press the button. You should see: Please
write your name."

Write the plan into `STATE.md`, show it to them, and ask whether it is what
they want. Change it until they say yes.

## Build one step at a time

Build **only the first step that is not done yet**. Keep each step small
enough that the person can try it in a minute or two.

## Stop after each step

When a step is built:

1. Commit it, with a message that says in plain words what changed.
2. Tell the person what you did, and give them the step's check.
3. Ask them to put the change into the test copy with
   `{{COMMAND}} dev deploy {{PROJECT}}` (you cannot do that from where you
   work), and then to try the check.
4. **Stop, and wait** for them to tell you it works. Do not start the next step
   until they do. If it does not work, fix it, and ask them to try again.

A step is done when the person has tried it and it worked, not when you think
it is finished.

## Keep STATE.md and DECISIONS.md current

- `STATE.md` says where things stand: the plan, which steps are done (tried by
  the person), what is next, and anything you are waiting for them to do.
  Update it after every step.
- `DECISIONS.md` records every decision about the app with its reason, so that
  anyone who works on it later, you included, knows why things are the way they
  are. Add to it; never rewrite what is already there.

## Where you work, and what you can never reach

This project has two copies of the app:

- **dev**, the test copy, where you work. Its app answers at
  `http://{{COMMAND}}-{{PROJECT}}-dev-app:3000/` and its database at
  `{{COMMAND}}-{{PROJECT}}-dev-db:5432`. Nothing in it is real.
- **prod**, the real app, with the real data. **You can never reach it**, and
  that is on purpose. A change reaches prod only when the person releases it,
  and a release first makes a backup and proves the backup can be restored.

Keep `GET /healthz` answering `{"ok":true,...}` after it has read the database:
it is how every check, backup test and release knows the app works.

## Changing the database

The database changes only through **migrations**: numbered SQL files in
`migrations/`, applied once each, in order, when the app starts.

- **Add a new numbered file for every change.** Never edit or delete a
  migration that already exists: it may have run in prod.
- **Only add.** New tables, new columns that may be empty or have a default,
  new indexes. The version before yours must still work on the database after
  yours, so that going back to it never loses data.
- **Anything else is a breaking change**: dropping or renaming a table or a
  column, changing a column's type, a new rule the existing data may break
  (such as "each name only once"), or changing rows that are already there.
  Only make one if the person agrees, after you have explained, in plain words,
  that going back past this release will mean putting all the data back as it
  was before it, and losing whatever was written since. Then say so in the
  file, on a line of its own:

  ```sql
  -- breaking: <what it changes>
  ```

  A release refuses a breaking migration without that line.

## Keys and passwords

- **Never put a key, a password or any other secret in the code**, in the
  repository, in a commit message, or in anything you print.
- **Never ask the person to paste a key to you.** Ask them to put it in the key
  vault instead:

  ```sh
  {{COMMAND}} key set {{PROJECT}} dev NAME_OF_THE_KEY < file-with-the-key
  ```

  (and `prod` for the real app's own value).
- **The app reads each key from a file**, whose path is in an environment
  variable with the key's name and `_FILE` after it. For a key called
  `WEATHER_API_KEY`:

  ```js
  import { readFileSync } from "node:fs";
  const weatherKey = readFileSync(process.env.WEATHER_API_KEY_FILE, "utf8").trim();
  ```

  The database password arrives the same way, as `DATABASE_PASSWORD_FILE`.
- Every commit is checked for anything that looks like a key, and stopped if it
  finds one. If that happens, take the key out of the code, and use the vault.

## Commits

Commit after every step, and only then ask the person to try it. Never rewrite
the history (`git reset --hard`, `git rebase`, `git commit --amend` on
something already committed), and never skip the key check (`--no-verify`).
