# State

*Updated 2026-09-30: the seventh brief's items are built (D66 to D79): the
workstation's protections, one lock per app, the panel at `allvibe.local` on
port 80, the guided path, the engine's agent and new app, the chat as Claude
Code's own terminal in the panel, and browser checks for all of it; its
report is [reports/2026-09-30-brief-07.md](reports/2026-09-30-brief-07.md).
The sixth brief's is
[reports/2026-09-29-brief-06.md](reports/2026-09-29-brief-06.md), the fifth
brief's [reports/2026-09-29-brief-05.md](reports/2026-09-29-brief-05.md),
the fourth's [reports/2026-09-28-brief-04.md](reports/2026-09-28-brief-04.md),
the third's [reports/2026-09-28-brief-03.md](reports/2026-09-28-brief-03.md),
the second's [reports/2026-09-28-brief-02.md](reports/2026-09-28-brief-02.md), the
first's [reports/2026-09-27-brief-01.md](reports/2026-09-27-brief-01.md).*

Everything below has been **built and run by the implementer on the local test
host**. Only what is marked **tried by the owner** has been tried by a human
(rule 6): so far, signing in with a Claude account (walkthrough step 23), and
the control panel's first slice (walkthrough steps 29 and 30). None of it has
run on real hardware.

## What works

On a fresh Debian 13 test host, following [docs/walkthrough.md](docs/walkthrough.md):

- **Installing a host.** `install.sh`, in fifteen steps, installs Docker Engine
  from Docker's repository, the service user, the directories, the CLI, the
  reverse proxy, the backup keys, the daily timer, the unit that puts the key
  vault's keys back into memory at boot, the firewall for project containers,
  the key check's scanner, the engine and the control panel, and shows the
  panel's setup code once, at the end; a second run changes nothing and says so. It
  refuses anything but Debian 13 on x86-64, and warns in plain language about
  low memory and a spinning disk. `allvibe doctor` reports the host in plain
  language, or as JSON.
- **Projects.** `allvibe project create` makes a guestbook with its own git
  repository, a dev and a prod that share no network, volume or secret,
  reachable at the host's address and a port each. From inside dev, prod
  cannot be reached at all, not even through its front door. Every new
  project starts with `AGENTS.md` (the agent's instructions, with the guided
  plan), a `CLAUDE.md` that points to it, and its own `STATE.md` and
  `DECISIONS.md` (D36).
- **The firewall for project containers** (D41). Every project container, the
  apps, the databases, the agent and its egress gate, is refused the machine's
  own ports and every private, link-local, shared and multicast address, where
  the router and the rest of the home network live; the apps still reach the
  internet, and the home network still reaches the apps through the proxy.
  The rules are put in place before Docker at every boot and again at every
  Docker restart, checked and repaired every five minutes, and reported by
  `doctor`, which also says whether any of the apps' networks has IPv6 on,
  which the rules would not cover (D49).
- **Backups.** Encrypted to a host key and a recovery key, only to a target
  proven off the machine, restore-checked by running the app against a scratch
  copy, daily by a timer that install enables, every run recorded. The
  recovery key is never printed and must be confirmed before a release. A
  backup carries the project's key vault too, and the restore check proves
  every key in it decrypts (D37).
- **Releases and rollbacks.** A release is dev's commit, behind a fresh backup
  that passed a restore check; a failed deploy rolls back by itself with the
  data intact; a manual rollback keeps the data, and first takes a fresh
  backup of prod that must pass its restore check, kept with the releases'
  backups (D57); putting data back needs explicit confirmation and takes a
  backup first. Every release records the
  schema it ran with; a breaking migration is released only when its file says
  so; a rollback goes ahead across migrations that only add, and stops, before
  changing anything, across a breaking one (D35).
- **A release only after every step of its plan is tried** (D56). The agent
  keeps its plan in `plan.json`; `allvibe plan <project>` shows it, and
  `allvibe plan tried <project> <step>` is the person's mark, kept outside the
  working copy, where the agent cannot reach. A release reads the plan in the
  commit it puts live and refuses while a step is untried; a plan goes live
  once; work outside any plan needs `--outside-plan "reason"`, which the
  release's record keeps.
- **doctor every night** (D58), after the scheduled backup: its result kept in
  `/var/lib/allvibe/doctor` (the newest and fourteen nights), read back with
  `allvibe doctor --last [--json]`, for the control panel.
- **Mains and battery** (D59): doctor says whether the machine is on mains or on
  battery, how full it is and how long it would last, and warns on battery;
  low battery is a problem; no battery is information.
- **The key vault** (D37). `allvibe key set|list|remove`: values from standard
  input, encrypted at rest to the same two keys, given to apps as files in
  memory, separate for dev, prod and the agent, back in memory after a reboot.
- **The key check before every commit** (D38). A pre-commit hook in every
  project's repository runs the pinned gitleaks over what is staged, for the
  user's commits and the agent's, and stops a commit with a key in it, saying
  the file and the line, never the value.
- **The agent** (D39). `allvibe agent start|shell|stop`: the official,
  unmodified Claude Code 2.1.283, in a container on dev's network only, with
  the working copy and its own key from the vault, reaching the model's API
  through an egress gate, a network filter that handles no credentials (D42),
  and nothing else. Its permission mode is set to auto, explicitly (D47).
- **The agent, signed in to the person's own Claude account** (D46).
  `allvibe agent start <project> --sign-in account`: the same Claude Code with
  no key, for the person to sign in through Claude Code's own flow in
  `allvibe agent shell`; the login only in the container's memory, gone when it
  stops; the gate passing the two sign-in hosts as well, and nothing else; and
  the suite never running Claude Code itself (D48). Run up to Claude Code's
  sign-in choice, and no further: the sign-in is the owner's. The owner has
  since followed walkthrough step 23, and it worked as written (tried by the
  owner, 2026-09-28).
- **What the agent did, and its conversations** (D60). One log line per tool
  call (the tool, the path or the command's first line, and whether it
  failed; never contents; anything that looks like a key withheld), written by
  a logger beside the agent that the agent cannot reach, and still written when
  the agent turns hooks off in the settings it can write: `allvibe agent
  activity <project>`. Claude Code's own transcripts kept through a mount of
  only their directory, the login still in memory: `allvibe agent transcripts
  <project> [--delete]`. Neither is in backups.
- **The engine the control panel calls** (D62). `allvibe-engine.service`, as
  the service user, on a Unix socket only the panel's group may open, with no
  network port, speaking JSON one message a line and no HTTP (D76): an
  allow-list of operations, each with its arguments checked, calling the CLI's
  own code; releasing, going back, starting the test copy, making an app and
  starting and stopping the agent as jobs, one at a time, with the CLI's steps
  as progress, each change confirmed; the agent's terminal as a stream, one
  browser at a time; signing in to the panel kept here. It answers while it
  works: doctor's checks and every job's command run off its thread (D65,
  D77). **It keeps what must run** (D80): every 5 seconds for three minutes
  after it starts, then every 30, the panel's container, its door (following
  the machine's address), the proxy, and any app's container Docker could not
  start, under the app's lock; it wants Docker rather than requiring it, starts
  with it, and is started again whatever ends it. After a restart, a Docker
  restart or a hard stop, in any order, everything is back within two minutes,
  the panel signed out and still set up.
- **The control panel** (D63, D64, D65). A container built on the machine from
  the pinned Node.js 24 image, as its own user, read-only, with no
  capabilities, on an internal network with no route out, with only the
  engine's socket mounted; its door, a container of its own that Docker
  publishes on port 80 of the home-network address, at `http://allvibe.local/`
  (announced by multicast DNS) and at the address, private sources and its
  own names only; its cookie never reaching an app, and the Preview frame
  sandboxed (D74). A one-time setup
  code, then a password; a strict session cookie; cross-site requests refused;
  wrong tries paused. Its first slice, simple mode, in the demo's design: home
  with the nightly status and each app's next action; an app's plan, Preview
  (the real test copy) and Live; "It works", "Something is wrong", "Put vN
  live" and "Go back" with the six safety checks as they run and every
  refusal in the engine's words; the app's backups; Machine health. Since
  the seventh brief: the guided path, one next action at a time (D75); a new
  app made from the home screen; and Your AI, Claude Code's own terminal on
  the left under the plan, started from the panel (D77). Checked
  in headless Edge at 1280 and 390 pixels, light and dark
  (`test/host/panel-checks.mjs`), each check first seen failing on a broken
  copy of the panel.
- **Claude Code's deny rules in both repositories** (D61): force pushes,
  moving or deleting pushed refs, hard resets, `git clean -f`, every Docker
  prune, removing Docker volumes and recursive deletion outside the
  repository, for the Bash and PowerShell tools; each seen refusing its
  command (`test/host/deny-probe.mjs`).
- **The repository.** The rules ([CLAUDE.md](CLAUDE.md)), the decisions
  ([DECISIONS.md](DECISIONS.md), D1-D79), the control panel's design rules
  ([docs/design/control-panel.md](docs/design/control-panel.md)), the Vikt
  inventory, the test host harness, its fixtures, probes and browser checks
  (`test/host/`), 170 unit tests, and CI on every push: a secret scan
  (gitleaks, with the two things it may not take for keys in
  `.gitleaks.toml`, D79), the guard for rules 9 and 10, the unit tests, and
  shellcheck of install.sh and firewall.sh. In the owner's clones, the guard
  runs before every commit (D71).

## Gates

**Before any version of the suite that installs or runs Claude Code is offered
to other people** (D52): the question of Anthropic's Commercial Terms is
resolved, in one of three ways: the owner accepts them (which may need a
registered business), Anthropic confirms otherwise in writing, or a design in
which the suite does not install or run Claude Code itself. It does not stop
development, and it does not touch the MCP bridge (D44). Until then the website
says "your own API key", and nothing about signing in with a Claude account.

## The eighth brief

**Tried by the owner**, in their words (2026-09-30): "I followed walkthrough
steps 29 and 30 on the test host until 'Bring the disk back'. After node
test/host/host.mjs restart, the panel did not come back (ERR_EMPTY_RESPONSE;
its container exited)." The seventh brief is **reviewed by the architect**
and accepted, with three points carried forward (D81).

| Item | State |
|---|---|
| 1. The panel after a restart: evidence | Recorded, reading only, before anything was changed: the panel and its door failed to start with a cgroup error; a shell had entered the test host through Docker's API in the second it started, into its root cgroup, so no container with a limit could start. That trigger is the test host's alone. The root cause in the product: nothing brought back a container Docker could not start. In the report. |
| 2. The panel after a restart: fix and proof | Built and probed (D80): the engine keeps the panel, its door, the proxy and what Docker could not start of the apps running, again and again; the panel and its door at fixed addresses; the door written from Docker's address pool; the engine wanting Docker, started with it and again whatever ends it, and Docker never given up on either; doctor and `panel status` saying what Docker could not start and why; the test host booting like a machine, and `host.mjs restart [--hard]` saying whether everything came back within 120 seconds. `restart-probe.mjs` 55 of 55 on a fresh test host, every way back within 11 to 41 seconds; on the previous commit's bundle every one of the nine ways WRONG (and, run again alone, the engine left inactive by Docker stopped and started, and a hard stop hitting the address clash). The upgrade from the previous bundle seen remaking the panel's network. |

## The seventh brief

**All nine items built, in one session** (D66 to D79); the report is
[reports/2026-09-30-brief-07.md](reports/2026-09-30-brief-07.md). **Tried by
the owner:** nothing of it yet. **Waiting for:** the owner to follow
walkthrough steps 29 to 31 on the test host, which is left running, fresh, with
no project on it: the guided path, the frame, the lock, and the chat, ending
with the owner's own sign-in to Claude Code in the panel's terminal and a
first small change; and to say what happened, in their own words, with what
got in the way in [docs/friction-log.md](docs/friction-log.md).

| Item | State |
|---|---|
| 1. Records | Recorded: the owner's try of steps 29 and 30 (below); the friction log's six entries; D66 to D70; TLS at home as the next security milestone in the roadmap. |
| 2. The workstation's protections | Built and seen on the workstation (D71; the website's D34): in the owner's user settings, D61's 90 deny rules, 20 more against skipping commit hooks, and a hook that refuses heredocs and multi-line quoted text; the same in both repositories' project settings; the guard as pre-commit and commit-msg hooks in both clones. A heredoc, a multi-line `node -e` and a here-string refused by the hook; `--no-verify`, `-n`, `core.hooksPath` and a force push refused by deny rules; the guard's hooks 9 of 9 in a throwaway clone of each repository, each refusal with its control; ordinary commands and commits through. |
| 3. Fixes | Built and probed on a fresh test host, each against the previous commit's bundle first: (a) one lock per app (D72), `lock-probe.mjs` 29 of 29, 13 WRONG on the control; (b) Machine health counts a release's and going back's restore checks, (c) the Preview frame keeps its text and reloads only for a new test copy, (d) nothing not yet run is green (D73), `panel-fixes.mjs` 19 of 19 in headless Edge, 10 WRONG on the control; (e) the walkthrough, one command per block and every project's name made free first, `walkthrough-blocks.mjs` 161 blocks, none wrong. |
| 4. The Preview frame and host names | Built and probed on a fresh test host (D74): the panel at `allvibe.local` (Avahi) and the machine's address, on port 80 through a door container Docker publishes (a capability does not reach the proxy's unprivileged user, seen); the apps' doors taking out the panel's cookie and refusing its name; the frame sandboxed; the Origin check exact and required; two firewall rules for the door (D41, amended). `names-probe.mjs` 43 of 43 in headless Edge and on the host, each part with its control; `panel-probe.mjs` 62 of 62 (it found containers reaching the door, fixed); `app-isolation.sh` 59 of 59; `engine-probe.mjs` 54 of 54. |
| 5. The guided path | Built and seen in headless Edge (D75): Plan, Try, Live, Done, and one pink next-action button at the top of an app's page; `guided-probe.mjs` 69 of 69 at 1280 and 390 pixels, from "Try step 1" to "v2 is live" by that button alone, never a tab, one pink thing at every stage, the tabs still working. Walkthrough step 30 still tells the panel before it: rewritten in item 9. |
| 6. The engine: the agent and a new app | Built and probed on the test host (D76): the engine's protocol is JSON lines, no HTTP (D66's condition); `app.create`, `agent.status`, `agent.start`, `agent.stop`, each change confirmed; `agent.terminal`, a stream through Docker's exec API, one browser at a time (a second takes over), 30 minutes idle, resizing, nothing kept; the panel's WebSocket for it. `engine-probe.mjs` 71 of 71; `terminal-probe.mjs` 26 of 26 in two real browsers, refusals with their control, a marker typed and shown found nowhere on the host; a race on take-over found and fixed. |
| 7. The chat in the panel | Built and probed on a fresh test host (D77): Claude Code's own terminal on the left under the plan (xterm.js 6.0.0 and its fit add-on, bundled, pinned by version and checksum, served by the panel); "Start your AI" with the account or the key in the vault; "Make a new app" on the home screen, opening in Plan. `chat-probe.mjs` 30 of 30 in headless Edge at 1280 and 390 pixels: an app made in the panel, its AI started from the panel with a stand-in key (its image built on that first start), Claude Code answering the stand-in for the model in the terminal, and the plan it committed in the checklist and the guided path. Found and fixed: the first plan never reached the guided path; a long job stopped the engine (46 seconds on a first start, and the page gave up), now on a thread of its own, `engine-probe.mjs` 72 of 72 (slowest answer during a release 1 ms, 1358 ms on the control). Signing in with an account is the owner's step. |
| 8. Browser checks | Built and run on a fresh test host (D78): `panel-checks.mjs`, 32 checks, now with the guided path, the frame keeping what is typed, the lock's refusal, a new app, the AI started and stopped, the terminal's keyboard and its refusals from a browser, and the side's lights; 33 broken copies, 47 pairs of copy and check, each seen failing and nothing else with it; then 145, 145, 147 and 147 passed at 1280 and 390 pixels, light and dark. Found and fixed: the side's light for an app being built drawn as a grid; a refusal naming a button that no longer exists; "on the left" on a phone; a key in the vault shown only after a reload. `panel-fixes.mjs` 19 of 19 again, brought up to the guided path; the sixth brief's `panel-journey.mjs` removed, its flows all in the checks. |
| 9. Walkthrough and records | Built and run: step 30 rewritten for the guided path, the frame keeping what is typed, and the lock (a backup from the machine refused while the panel puts a version live); step 31 new, a new app made in the panel and its AI started with the owner's own account, ending with the owner's sign-in in the panel's terminal and a first small change; clean up is step 32. `walkthrough-blocks.mjs` 164 blocks, none wrong. On a fresh test host, steps 29 to 31 run exactly as written, every command and quoted output taken from the text in order (`walkthrough-panel.mjs`): 91 of 91 as the text says, up to "Select login method" in the panel's terminal, where the owner's sign-in begins. The records; the guard in both repositories; every revision of both scanned for rule 10 (only `864be95`, Known, and the website's first day, its D14) and with gitleaks, which found that CI had been failing since item 6 on three things that are not keys: allowed by name (D79), CI green again. The workstation as before, apart from the labelled test host. |

## The sixth brief

**Tried by the owner:** the control panel, walkthrough steps 29 and 30, in the
owner's words: "I followed walkthrough steps 29 and 30 on the test host on
2026-09-29. After two stumbles (friction log 1 and 2) everything worked as
written." **Reviewed by the architect:** accepted, with the nine open questions
of the panel's architecture answered (D66), the history of `864be95` left as
it is (D67), and the deny rules to live in the owner's user settings as well
(D66; built in the seventh brief).

| Item | State |
|---|---|
| 1. The heredoc incident, and deny rules | Recorded and built: the incident reconstructed from the session's own record (report); deny rules in both repositories (D61; the website's D32), 201 of 201 with the pinned Claude Code on the test host, 110 of 110 run without the file; eight rules in a form Claude Code no longer reads were seen matching nothing, and fixed. **For the owner**: the rules apply only to a session whose project is the repository. |
| 2. Product records | Recorded: D60 amended (the activity log is a narrative, not evidence); a key scan of each session's conversations Planned. |
| 3. Website: Under the hood and the claims sheets | Done in the website repository (its D33, `1224d95`), read again at the product's `3bfa5e8`. |
| 4. Release v0.4.0 | Done: the tag v0.4.0 at `1224d95`, its workflow green; v0.3.0 never released, its tag not moved. |
| 5. Deploy and verify v0.4.0 | Done: live, `check-page --deployed` clean at every width, nothing else on the host changed. |
| 6. The panel's architecture | Recorded: D62 to D64 and docs/design/panel-architecture.md, with nine open questions. |
| 7. The engine | Built and run: 15 unit tests; `engine-probe.mjs` 53 of 53 on a fresh test host, 12 of 53 with the engine stopped. A deadlock found by item 10 fixed: doctor's checks now run off the engine's thread. |
| 8. The container, signing in, install | Built and run: 7 unit tests (104); `panel-probe.mjs` 52 of 52, 50 of 52 with the door loosened; install twice, nothing changed the second time. Port 8099, not 80 (D63, amended). |
| 9. The first slice of the interface | Built and run: `panel-journey.mjs` 49 of 49 in headless Edge on a fresh test host, a step ready, tried, refused while untried, refused without the backup disk, put live with every check shown, and gone back from; no console errors, no request to another origin. D65. |
| 10. Browser checks | Built and run: `test/host/panel-checks.mjs`; each of its 23 checks seen failing on a deliberately broken copy of the panel (22 copies, 30 check and copy pairs), then, on a fresh test host, 77, 77, 78 and 78 passed at 1280 and 390 pixels, light and dark. Found and fixed: Machine health, through the engine, waited for itself (D65); the engine probe now 54 of 54. |
| 11. Walkthrough and records | Built and run: walkthrough steps 29 and 30 written; steps 1 to 3, 5, 6, 29 and 30 run as written on a fresh test host (the browser steps in headless Edge), 46 of 46 as the text says; these records; the guard, gitleaks over every commit and the working tree, and a rule 10 scan of every revision, in both repositories: nothing new beyond `864be95` (Known) and the website's first day (its D14). The labelled test host is left running. |

## The fifth brief

**Tried by the owner:** nothing new in this brief yet. **Waiting for:** the
owner to try items 7 to 11 (walkthrough steps 24 to 28), the website's new
demo (item 6, a local preview), and the decision that items 3 and 4 need.

| Item | State |
|---|---|
| 1. The sign-in test | Recorded as **tried by the owner**: "I followed walkthrough step 23 on the test host on 2026-09-28, and it worked as written." |
| 2. The open points | Recorded: the Commercial Terms question as a release gate (D52, "Gates" above); four plans from the demo and the services' reach (D53); the demo's corrections, done in the website repository at its D29. |
| 3. Website release v0.3.0 | **Blocked, for the owner.** The tag v0.3.0 was pushed, and its release workflow failed: its own test still expected `/favicon.ico` to answer 204, which the website's D26 had changed. The test is fixed on the website's main branch (its D30). Releasing needs either the tag moved to the fixed commit, which rewrites a published tag (rule 11), or the owner's word for v0.3.1 (the release was authorized for v0.3.0 only). v0.2.0 stays live. |
| 4. Website deploy of v0.3.0 | **Blocked** by item 3. Nothing was deployed. |
| 5. Documentation | Recorded: MFA in sign-in and invitations, a device on the home network for one app, the first real project with its friction log, a gallery, a session review (D54); the control panel's app view (D55). |
| 6. The website's demo, app view | Done in the website repository (its D31, `415ea52`), pushed, **not tagged, released or deployed**: the page for one app rebuilt to D55, the same layout in both modes (Versions into Live, Files into Code, Backups and Service keys under More; a new app opens in planning); its checks clean at 1440, 768, 390, 360 and 320, light and dark, each seen failing on one of 15 broken copies; the claims sheet read at `f205494`, 98 rows, none without a source; a before-and-after gallery on the workstation; the phone preview shows it. **Waiting for the owner** to look at it. |
| 7. A release only after every step is tried | Built and run: `test/host/plan-gate.sh` 31 of 31 on a fresh test host, WRONG on every gate check against the previous bundle; walkthrough step 24 run as written on a fresh test host. D56. |
| 8. A fresh backup before going back | Built and run: `test/host/rollback-backup.sh` 14 of 14, including a backup damaged as it lands, which stops the rollback with prod untouched; WRONG on every check against the previous bundle; walkthrough steps 14 and 25 run as written. D57. |
| 9. doctor every night | Built and run: `test/host/doctor-nightly.sh` 16 of 16, WRONG against the previous bundle; walkthrough step 26 run as written. D58. |
| 10. Mains and battery | Built and run with stand-ins: `test/host/power-fixtures.sh` 12 of 12 (1 of 12 against the previous bundle); walkthrough step 27 run as written. **Not on a real laptop**: see "To verify on real hardware". D59. |
| 11. The agent's activity log and conversations | Built and run with a stand-in for the model: `test/host/agent-activity.sh` 29 of 29 in both ways of signing in (11 of 22 against the previous bundle, with the probe's first 22 checks); the isolation probe 89 of 89 with a key and 88 of 88 with an account; the leftovers probe 17 of 17 in both; walkthrough step 28 run as written. **Not run with a real model.** D60, an amendment to D46. |
| 12. Walkthrough and records | Walkthrough steps 1 to 28 run on a fresh test host (step 23 up to Claude Code's sign-in choice, the rest being the owner's), with outputs in the text corrected where this brief changed them; these records; the guard and a history scan in both repositories. |

## The fourth brief

**Tried by the owner:** the sign-in test, walkthrough step 23 (the brief's
item 6), in the owner's words: "I followed walkthrough step 23 on the test host
on 2026-09-28, and it worked as written." **Waiting for:** the owner to try the
other items of all four briefs (rule 6).

| Item | State |
|---|---|
| 1. Signing in with a Claude account in the agent | Built and run on a fresh test host: both ways of signing in start; the agent probe 75 of 75 with a key and 74 of 74 with an account; the new leftovers probe 12 of 12 in both (nothing of a session on disk while it runs, nothing anywhere after the stop); `allvibe agent shell` opened Claude Code with an account and showed its sign-in choice, where the run stopped (rule 13). With a stand-in key, its prompt showed `auto mode on`. D46, D47, D48. |
| 2. Records | Recorded: D46 to D51, with notes under D34, D39, D41, D42 and D43; `doctor`'s IPv6 check, with unit tests, seen saying both of its answers on the test host (D49); the roadmap's "Your own services" (D50); the control panel's design rules (D51); walkthrough step 23, replayed on the test host up to the sign-in choice. |
| 3 to 6. The website | Done in the website repository (its STATE.md, D26 to D28): favicons, the control panel's demo at `/demo`, Under the hood and the claims sheets read at this repository's `6a20da8`, and a phone preview for the owner. Its claims sheet for the demo lists seven things the demo shows that nothing here says, for the owner. |
| 6. The owner's sign-in test | **Tried by the owner**, in their words: "I followed walkthrough step 23 on the test host on 2026-09-28, and it worked as written." |

**Reviewed by the architect** (the third brief): D41 is accepted, with five
minutes for its check; not filtering IPv6 is accepted only while it stays true,
now checked by doctor (D49); D42 is accepted.

**The question about Anthropic's Commercial Terms** (D46) is now a release
gate (D52): see "Gates" above.

## The third brief

| Item | State |
|---|---|
| 1. The machine's own ports and the home network, closed to every project container | Built and run: with an SSH server, a service on another port and a stand-in device on the home network, 24 of the app probe's 59 checks were reachable before the rules and 0 after; the app probe 59 of 59 and the agent probe 50 of 50, after a test host restart and after a Docker restart too; doctor reporting, and the check putting back a rule removed by hand. D41. |
| 2. The egress decision | Recorded: D42, with notes under D34 and D39. Documentation only. |
| 3. Findings and roadmap | Recorded: D43 (the VAT finding), D44 (the MCP bridge), D45 (two modes, a bug report builder, the architect), and their roadmap entries. Documentation only. |
| 4. Walkthrough and record | The walkthrough, step 21 new and step 22's probe changed, run end to end on a fresh test host as written; this file, DECISIONS.md, CLAUDE.md's mistakes, the roadmap and the report. |

**Reviewed by the architect** (the second brief): the egress gate is accepted as
a network filter, not a proxy of credentials (D42); the vault's agent scope and
the record of a failed breaking release are accepted; D39's known limit was not,
and D41 closes it.

## The second brief

| Item | State |
|---|---|
| 1. Rollback and schema versions | Built and run: an additive migration released and rolled back with all data; an unmarked rename refused with nothing changed; the marked rename released, its code rollback refused, and `--restore-data --confirm-data-loss` working; a failed breaking release recovered from its own backup. D35. |
| 2. The project template and the guided plan | Built and run: `project create` commits AGENTS.md, CLAUDE.md, STATE.md and DECISIONS.md, every section there and no placeholder left; unit tests check them. D36. |
| 3. The key vault | Built and run: set, list, remove and their refusals; three values found nowhere they must not be; dev holding its own and not prod's; the vault restored by a restore check and opened with the recovery key alone; the keys back before Docker after a restart. D37. |
| 4. Key check before commit | Built and run: a fake key stopped in `dev commit` and in a plain `git commit`, named by file and line; a clean commit passing; a missing scanner stopping the commit. D38. |
| 5. The agent container | Built and run: `claude --version` 2.1.283 inside it; every probe of the brief's list refused, dev and the API answering; its own commits through the key check. D39. |
| 6. The control panel's runtime | Recorded: D40. Documentation only. |
| 7. Live agent test | **Not run, and waiting**: no real key is used. Buying API credits asked the owner, a private person, for a VAT number (D43); the test waits for API credits or a confirmed subscription path. |
| 8. Walkthrough and record | The walkthrough, steps 17 to 22, run end to end on a fresh test host as written; the records and the report. |

## The first brief

| Item | State |
|---|---|
| 1. Foundation | Built and pushed; secret scan green; the planted-key demonstration run. |
| 2. Vikt inventory | Built: [docs/vikt-inventory.md](docs/vikt-inventory.md), 15 seeded mistakes. |
| 3. Local test host | Built: [test/host/](test/host/README.md). Created, reset, restarted and removed repeatedly; nothing unlabelled added, nothing left behind. |
| 4. Host bootstrap | Built and run: 22 changes, then none; doctor all green; both warnings forced; three refusals. |
| 5. Projects | Built and run: dev and prod opened from the workstation's browser, separate; rule 1 probed from inside dev. |
| 6. Backup and restore test | Built and run: a backup on the backup volume; restore check showing the entry count; root filesystem refused; timer active after install and after a restart. |
| 7. Release and rollback | Built and run: a change live with entries intact; a broken release rolled back by itself; a manual rollback; a release stopped at the backup step with the disk gone. |
| 8. Walkthrough | Built and run end to end on a fresh test host. |
| 9. Record | This file, DECISIONS.md, CLAUDE.md and the report. |

**Reviewed by the architect:** D13, the recovery key, is accepted (D29); D18,
how projects are reached, is accepted for version 1 (D30); D26, rollback and
data, is accepted with a known gap (D31), now closed by D35; and D15's use of
Debian's Node.js 20 is recorded as deliberate (D32).

## Known

- **A detail of the owner's network is in the public history** (the sixth
  brief, item 8): commit `864be95` added, in `test/unit/panel.test.mjs`, an
  example address that is on the owner's private list, and a private range in
  a comment of `src/lib/panel.ts`. The guard found both, but its exit code was
  lost in a pipe, so the commit went ahead and was pushed; CI failed on it. The
  next commit removes both from the files. **The history is not rewritten**
  (rule 11), by the owner's decision (D67): the address is an example address
  in a test, from the owner's private list, and stays in `864be95`, as the
  website's first days stay in its history (its D14).
- **An app's own cookies do not work inside Preview** when the panel is
  reached by its name (D74): the frame is from another site, where a browser
  sends only `SameSite=None` cookies, which need HTTPS. An app's own sign-in
  is signed out in the frame; "In a tab of its own" works.
- **A restart of the engine lets go of the agents' terminals** (D76): a Claude
  Code it started keeps running in the agent until the agent stops, and
  opening the terminal again starts another beside it.
- **Another device named `allvibe.local`** on the same network takes the name;
  doctor then says so, and the machine's address still works (D74).
- **A new project shows "no backup yet"** in Machine health until its first
  backup: the first night, its first release, or `allvibe backup <project>`.
  (A release's and going back's restore checks now count, D73.)
- **The panel's home line is the last nightly check**, so a fresh machine says
  "The nightly checks have not run yet." until the first night; Machine health
  runs them on demand. Signing in lives in the panel's memory: restarting it,
  or the machine, signs everyone out (D64).
- **Claude Code's deny rules and the inline-scripts hook are in the owner's
  user settings** (D71), so they apply to every session on the owner's
  workstation, and in each repository's project settings. They catch
  accidents, not a determined agent: a command inside `bash -c` or a script is
  not seen (D61, D71). The project settings' hook relies on
  `$CLAUDE_PROJECT_DIR`, not yet seen in a session opened on a repository on
  Windows.

- **One lock per app** (D72) keeps the suite's own operations apart, from the
  panel, the command line and the nightly backup; it does not stop `docker` or
  a hand in the app's folder.
- Release images and release backups are never pruned yet (D28).
- `doctor` shows the timer's calendar time; `systemctl list-timers` shows the
  actual next run, up to 30 minutes later (the random delay).
- From Git Bash, the harness needs `MSYS_NO_PATHCONV=1` (test/host/README.md).
- **The firewall is checked every five minutes** (D41). A rule removed by hand
  between two checks is put back at the next one; until then `doctor` still
  shows the last check's result.
- **An app cannot reach a device on the home network**, a printer, say: that
  needs an explicit per-app opt-in, planned in D41 and not built.
- **IPv6 is not filtered**: the suite's networks have none (D41), and `doctor`
  says so, or says which network has it on (D49).
- **AGENTS.md is followed by the agent, not enforced**: what is enforced is the
  migration check, the key check, the firewall and rule 1 (D36).
- **A commit made with `--no-verify` is not key-checked**, and a blocked
  commit's staged copy stays in git's object store, unreferenced, until pruned
  (D38).
- **Built and not tried:** `key set` putting the old value back when the app
  does not come up with a new one; Claude Code talking to the model through
  the egress gate with a key. With an account, walkthrough step 23 (the
  sign-in, a change made by the agent, and a new start asking to sign in again)
  was tried by the owner and worked as written.
- **When the terminal of `allvibe agent shell` closes**, Claude Code keeps
  running in the agent until `allvibe agent stop` (D46). Leaving it with
  `/exit`, or `Ctrl-C` twice, ends it.
- **Stopping the agent is not signing out**: the login is gone from the
  machine, and stays valid at Anthropic until it expires or `/logout` (D46).
- **The agent's conversations keep what it read and was told** (D60): a key
  pasted into the conversation, or a file the agent printed, is in its
  transcript on this machine until deleted. The activity log is scanned for
  keys; the transcripts are Claude Code's own files, and are not yet: a scan
  of each session's conversations when the agent stops is planned (D60,
  amended).
- **The activity log is a narrative, not evidence** (D60, amended): the agent
  can add lines of its own making, though it cannot change or delete one; lines are lost, and the agent carries on, if the
  logger is down; the log is not rotated (D60).
- **A plan's marks belong to its words** (D56): if the agent changes a tried
  step's title or check, the step is untried again; a change the agent commits
  after the last step was tried, and before the release, is released with the
  plan, and the release records the commit each step was tried at.
- **Built and not tried by a person:** everything of the fifth brief (items 7
  to 11), including a session with a real model logged and kept; the sixth's
  engine, deny rules and container, whose first slice the owner has since
  tried (steps 29 and 30); and everything of the seventh (the lock,
  `allvibe.local` on port 80, the guided path, the agent and a new app from
  the panel, the chat in its terminal), which ran in a headless browser and in
  the probes, not in a person's hands. **Signing in with an account in the
  panel's terminal** has not run at all: it is the owner's (step 31).
- **The chat was tried against a stand-in for the model**, not a model: it
  wrote and committed a plan of one step it was scripted to. A real model's
  session through the panel, its plan, its steps and its commits, is the
  owner's step 31. With the stand-in, auto mode's classifier cannot be
  answered, so the test fixture allows the stand-in's one command (D77).
- **On a phone the terminal is about 40 columns wide**: Claude Code wraps its
  lines and shows its logo first; it works, and is cramped.
- **A key put in the vault from the command line** shows in the panel within
  a quarter of a minute (the page's quiet look for changes), not at once.

## Next

What is planned is in **[docs/roadmap.md](docs/roadmap.md)**: off-site backups,
the recovery key in the web UI, a lost recovery key, the panel over TLS at
home (the next security milestone, D66), an installer on a USB stick, disk health warnings, a monthly
check-up, moving to a new computer, full disk encryption at install, the rest
of the agent adapters with the MCP bridge next (D44), sign-in and invitations,
two modes in the control panel, a bug report builder, the architect as a role
(D45), your own services (D50), a device on the home network for one app, the
first real project, a gallery and a session review (D54), and the team
version. Its "Built, from this roadmap" part has what the second, fifth and
seventh briefs built. The control panel's design is decided (D51), its app
view (D55), the guided path (D68) and the chat as Claude Code's own terminal
(D69).

Candidates for the next brief: what the owner finds in steps 29 to 31; the
engine's next operations in D66's order, each with the panel's part (service
keys, where values only go in; going back with the data, confirmed by typing
the app's name; work outside a plan, with a reason; removing an app); the
panel over TLS at home, with passkeys (the next security milestone, D66);
advanced mode, and the recovery key and backups pages; the MCP bridge;
sign-in in front of apps, with MFA (D54); the session review (D60); the key
check before push, with the GitHub integration; pruning, and rotating the
activity log; the laptop; and the live agent test with a key, which still
waits for API credits (D43).

## To verify on real hardware

Checks that a container cannot prove (D14). The old laptop running Debian 13
closes these. Each names the test override or stand-in used in the container.

- **install.sh on real hardware.** Docker's repository, the key fingerprint
  check and the whole installation have run only in the container, and
  `live-restore` has not been tried across a Docker upgrade.
- **Memory.** The test host declares 16 GB (`memory-mb`); a real machine's
  `/proc/meminfo` has not been read by the checks. The line is 7 GiB: an 8 GB
  machine must not be warned, a 4 GB one must.
- **The system disk's type.** Declared (`system-disk`); detection from the root
  filesystem's block device has not run on a real SSD or spinning disk.
- **A separate filesystem on a separate physical disk.** Declared for the backup
  volume (`external-backup-mount`); every volume in the container sits on one
  virtual disk. On the laptop, without any override: a USB disk accepted; a
  second partition on the system disk refused; the disk unplugged and the next
  backup failing with "on this machine's own root filesystem"; a NAS share
  mounted over NFS or SMB accepted as off the machine.
- **A real reboot.** A container restart stands in: the filesystem survives, the
  kernel does not restart. On the laptop: reboot, and check that the timer is
  active, the proxy and the projects are back, and that a run missed while the
  machine was off happens after boot (`Persistent=true`). And that
  `allvibe-keys.service` and `allvibe-firewall.service` ran before Docker, so
  that an app with keys comes back healthy and no container ever runs without
  the firewall (on the test host, `/run` is a tmpfs the harness mounts).
- **The daily run at 03:30.** Only started by hand so far; let one happen on its
  own and read `allvibe runs` and `allvibe doctor --last` the next morning.
- **Reachability from another machine on the LAN.** The test host's ports are
  published on the workstation's loopback only; a network namespace on the
  test host stood in for another device, and reached the doors through the
  firewall. On the laptop: open a project's prod and dev at
  `http://<laptop address>:8100/` and `:8101/` from a phone or another
  computer, and check that nothing listens on IPv6 (`ss -ltn6`).
- **The firewall on a real network card and a real home network** (D41). On the
  test host the home network was a network namespace, the router Docker's, and
  SSH a server installed for the test. On the laptop, with its real SSH server:
  `sh test/host/app-isolation.sh allvibe <project> <a device's address> <its
  port>` and `sh test/host/agent-isolation.sh … <the same device>`, with a real
  device on the home network (a printer, the router's web page); every line as
  it must be, and the doors still answering from a phone. Also that names still
  resolve inside the apps when the machine's resolver is the home router, as
  it usually is (on the test host it was Docker Desktop's).
- **Prod's door refusing containers on a real Docker.** The deny list is read
  from Docker when a project is created; on a real host the default bridge
  usually has Docker's standard subnet, not the one the test host's inner
  Docker picked. Since D41 the firewall refuses a container before nginx does,
  so this is the second line: `sh test/host/rule1-isolation.sh allvibe
  <project>` there.
- **The agent's image on the laptop.** Built in about a minute on the
  workstation; it downloads Debian's git and Claude Code.
- **Mains and battery on a real laptop** (D59). On the test host, which has
  no battery, doctor read stand-ins for `/sys/class/power_supply`. On the
  laptop: `allvibe doctor` on mains, then with the charger pulled (a warning,
  with the time left if the laptop reports it), then near empty (a problem);
  and whether its battery reports `energy_now`, `charge_now` or neither.
- **Signing in over SSH.** On the test host the agent's shell was opened in a
  terminal on the host itself. On the laptop it will be opened over SSH, and
  the sign-in's web address has to be copied out of that terminal and its code
  pasted back into it.
- **The harness over SSH.** `exec`, `shell`, `push`, `pull` and `status` with
  `ALLVIBE_TEST_HOST` set have not run against a real machine.
- **The control panel from another device on the home network** (D63, D74).
  On the test host the browser reached the panel through the harness's
  forwarded ports on the workstation's loopback, with `allvibe.local` mapped
  there in the checks' own browser; another device was a network namespace
  that asked for the name over multicast DNS. On the laptop: from a phone
  (iOS and Android) and a computer on the same network, `http://allvibe.local/`
  and the address; which devices find the `.local` name; the door refusing a
  public source address and another host name; port 80 bound by Docker for
  the door, where a real machine's own processes need a privilege below 1024;
  and the Preview frame at the test copy's port on the address.
- **An unplugged backup disk, as the engine sees it** (D65). The test host's
  mounts are private, so the browser checks unplug the disk in the engine's
  view as well. On the laptop, systemd shares mounts with its services: pull
  the USB disk and press "Put vN live" in the panel, which must stop at the
  backup target.
