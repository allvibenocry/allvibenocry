# The control panel's design

**The reference design is decided (D51).** The panel's first slice is built
(D65), in simple mode; the rest is Planned: see "The control panel at
allvibe.local" and "Two modes in the control panel" in
[the roadmap](../roadmap.md).

**The reference** is the owner's clickable demo of the panel, which the
website serves at `/demo` (its source is `site/demo.html` in the website's
repository; on allvibenocry.com once that version is released). It is a
mock-up in one page: every app, backup and agent in it is made up, and nothing
it shows exists in this repository unless the roadmap says Built. When the
panel is built, it follows the demo's look and the rules here. If the demo and
these rules ever disagree, that is a finding, and one of them is corrected.

## The rules

### 1. Calm when fine, clear when something needs the person

When everything works, the panel is quiet: short lines, no alarms, nothing to
do. When something needs the person, it says so plainly, in one place, with
what to do about it.

### 2. Action first

Each screen leads with the one thing the person can do next. Explanations and
details come after it, never before it.

### 3. Colour has one meaning each

| Colour | Means |
|---|---|
| Green | done, safe, works |
| Pink | the person's next action |
| Yellow | something to check |
| Purple | neutral structure |
| Red | a problem |

No colour is used for anything else.

### 4. Heavy frames only for what matters most

A strong border or a filled box is kept for what matters most on the screen;
everything else sits lightly on the page.

### 5. Simple mode first

Simple mode is what everyone sees first. Advanced mode sits behind an obvious
switch, with a warning and a confirmation before it turns on, and it **never
bypasses the safety net**: it shows more and allows finer control, but a
release still needs its backup and restore check, dev still never reaches
prod, and so on (D45).

### 6. One word per thing

The panel uses one word for each thing, everywhere:

| The thing | The word |
|---|---|
| dev | **test copy** |
| prod | **live app** |
| a release | **put live** |
| a rollback | **go back** |
| the backup, restore check and other checks before a change | **safety checks** |
| a backup that passed its restore check | **restored and checked** |
| the keys in the key vault (D37) | **service keys** (never the recovery key, which keeps its own name) |
| the role that turns an idea into a plan (D45) | **the architect** |
| the coding agent (D39) | **the builder** |
| the brief the architect writes | **instructions** (in advanced mode, **the brief**) |
| an app's or service's access card (D41) | **what it can access** |
| self-hosted services such as Pi-hole | **your own services** |
| the LAN | **home network** |
| the version the family uses, and its tab | **Live**, and its button **Put vN live** |
| making an app reachable from the internet | **publish** |
| a release to the live app | never **deploy**: that word is not used |

**Technical words and port numbers appear only in advanced mode**, and each is
explained where it first appears.

### 7. Keyboard and screen readers

- **Dialogs keep focus inside** while open, and **give it back** to what opened
  them when they close.
- **Tabs follow the tab pattern**: the arrow keys move between tabs, and only
  the selected tab is in the Tab order.
- **Choices are real radio buttons**, not look-alikes.
- **Every pointer action has a keyboard way**, marks on a screenshot included.

## The app view

*Decided with the owner and the architect (D55). The demo shows it.*

The page for one app. **The same layout in simple and advanced mode, so that
nothing moves when the person switches.**

**The left side is who you talk to.**

- **Simple mode: one chat, "Your AI"**, with the plan as a checklist at the top.
- **Advanced mode: two tabs**, **Plan** (the architect) and **Build** (the
  builder's session).

**The right side is what you look at.**

- **Simple mode: Preview and Live.**
- **Advanced mode adds Code**: a file tree, and a viewer of the chosen file with
  its changes.

**Preview** is always there, because a project starts from the starter app.
The line with **"It works"** and **"Something is wrong"** sits above the
preview.

**Live** holds the version the family uses, **"Put vN live"** with the safety
checks shown as progress, and the earlier versions with **"Go back"**.

**"More"** sits next to the app's name, and holds the backups, the service keys
and the app's settings.

**On a phone, one row of tabs**: Chat, Preview, Code (in advanced mode) and
Live.

**Small changes skip the plan** and become one step. **For planning, Claude
Code's own plan mode is used**, not a mechanism of the suite's own.

### The chat, and the guided path

*Decided by the owner in the seventh brief (D68, D69), and built in it (D75,
D77). The demo shows them since the website's D35 (the eighth brief, item 6),
not yet released; where the demo differs, these win.*

- **The chat is Claude Code's own interface**, in both modes: a terminal on the
  left, under the plan's checklist, where the person talks to Claude Code and
  signs in to it through its own flow. It is not a chat of the suite's own, and
  nothing typed or shown in it is recorded by the suite (D69).
- **The guided path** (D68): a step indicator at the top of an app's page,
  **Plan, Try, Live, Done**, with how far along it is ("Try: 1 of 3"); **one
  button for the next action**, always in the same place, whose words change
  with the state ("Try step 1", "Put v2 live"); the panel moving on by itself
  when a stage is over; and an ending, "v2 is live", with three choices: open
  the app, go back if something feels wrong, or start something new. **Pink is
  the next action, and there is only ever one.** The tabs stay, and the
  ordinary path never needs them. Going back and restoring data are never a
  "next": they stay deliberate, with their confirmations.

### Set apart: what loses data, what skips a plan, and what is secret

*Built in the eighth brief (D82, D83), in the demo's design.*

- **Service keys, under More**: listed with where each is used and when it
  changed, the value as hidden dots; added with the value pasted into a
  password field, "never shown again", and gone from the page as soon as the
  engine has it.
- **Going back with the data, under Live**, below the earlier versions, in a
  card of its own: never pink, never in the guided path. Its dialog says what
  is lost, with the entries now and in the backup, and its button works only
  once the app's name is typed.
- **Work outside a plan**, only where a release would be refused for want of
  a plan: a card under Live, and a button in that refusal. The person says
  why; the release keeps it, and the earlier versions show it.
- **Removing an app, in its settings**, set apart at the bottom: what goes, a
  last backup first, the name typed; afterwards, where that backup is kept.
