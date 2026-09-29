# Friction log

Kept by the owner: every place where the suite got in the way, was confusing,
or was missing something, while following the walkthrough and, later, while
building the suite's first real project, the homelab documentation site
([roadmap](roadmap.md), D54). It feeds the briefs that follow. Nothing here is
a decision; the decisions are in [DECISIONS.md](../DECISIONS.md).

**Every entry is triaged in the next brief** (D70): it is fixed there, or it
gets an entry in the roadmap, and this log says which, under "Where it goes".
An entry is never closed by being forgotten.

One entry per snag, numbered in the order they came:

- **Date, and where** (the step, the screen or the command)
- **What happened**, in plain words
- **How much it hurt**: a little, a lot, or it stopped me
- **Where it goes**: fixed in which brief and item, or its roadmap entry

## Entries

### 1. The walkthrough assumed a new project called hello

- **2026-09-29, walkthrough step 30.** The step starts with `allvibe project
  create hello`, but the test host already had a used hello from the
  implementer's own run, so the panel showed nothing to try.
- **How much it hurt:** it stopped me, until I saw why.
- **Where it goes:** fixed in the seventh brief, item 3 (e): the walkthrough
  never assumes a project's name is unused. Each project has a name of its own,
  or the old one is removed first, with a check that it is gone.

### 2. Blocks with several commands

- **2026-09-29, the walkthrough, everywhere.** Pasting a block with several
  commands, the last line does not run until Enter is pressed, and the next
  paste lands after it, on the same line.
- **How much it hurt:** a little, twice.
- **Where it goes:** fixed in the seventh brief, item 3 (e): one command per
  block, everywhere in the walkthrough.

### 3. A green dot beside "The nightly checks have not run yet"

- **2026-09-29, the control panel, the side bar and the home screen.** Green
  means done and safe (docs/design/control-panel.md, rule 3), and nothing had
  run.
- **How much it hurt:** a little.
- **Where it goes:** fixed in the seventh brief, item 3 (d): nothing that has
  not run yet is green, anywhere in the panel.

### 4. Machine health said no backup was restore-checked, right after a release that checked one

- **2026-09-29, the control panel, Machine health**, after step 30's release.
- **How much it hurt:** a little: it looked like a problem that was not there.
- **Where it goes:** fixed in the seventh brief, item 3 (b): Machine health
  counts the restore check a release or going back made.

### 5. The Preview frame reloads whenever the pane redraws

- **2026-09-29, the control panel, Preview.** Anything half typed in the test
  copy is lost when the page redraws (a step marked tried, a job ending,
  switching between Preview and Live).
- **How much it hurt:** a little.
- **Where it goes:** fixed in the seventh brief, item 3 (c): the frame is
  reloaded only by "Restart the test copy" or by a change to the test copy
  itself.

### 6. The steps should feel linear, like a wizard

- **2026-09-29, the control panel, an app's page.** Next, next, done: a step
  indicator at the top, one button for the next action in the same place, the
  panel moving on by itself, and an ending that feels like one.
- **How much it hurt:** a little; it is how it should feel.
- **Where it goes:** the guided path, decided in D68 and built in the seventh
  brief, item 5.
