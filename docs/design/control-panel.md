# The control panel's design

**The reference design is decided (D51). The panel itself is Planned**: see
"The control panel at allvibe.local" and "Two modes in the control panel" in
[the roadmap](../roadmap.md). Nothing below is built yet.

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

**Technical words and port numbers appear only in advanced mode**, and each is
explained where it first appears.

### 7. Keyboard and screen readers

- **Dialogs keep focus inside** while open, and **give it back** to what opened
  them when they close.
- **Tabs follow the tab pattern**: the arrow keys move between tabs, and only
  the selected tab is in the Tab order.
- **Choices are real radio buttons**, not look-alikes.
- **Every pointer action has a keyboard way**, marks on a screenshot included.
