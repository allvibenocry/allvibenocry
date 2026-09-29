# All vibe no cry

**Vibe fast. Ship safe.** From vibe to live app.

This file is for whoever works on this repository next, human or assistant. Read
it before changing anything. The decisions and their reasons are in
[DECISIONS.md](DECISIONS.md); where things stand is in [STATE.md](STATE.md).

## The thesis

A total beginner can build, publish and operate their own web apps on an old
computer at home, **without a terminal and without losing data**.

AI coding agents made building an app easy. What they did not make easy is
running one: the first time a beginner's app holds data that matters, one bad
change, one dead disk or one confident agent can wipe it out. All vibe no cry is
the part that makes that impossible: it keeps the agent away from the real data,
refuses to release without a backup that is known to restore, and can always go
back.

The long-term shape:

- **A machine**, a VM or an old PC, running Debian 13 with Docker.
- **A control panel** in the browser, and a reverse proxy in front of everything.
- **Per project, two environments**: *dev*, where an AI coding agent works, and
  *prod*, with the real data, which the agent can never reach.
- **Releases** that refuse to run without an off-machine backup that has passed
  a restore test, and that roll back on their own when the new version does not
  answer.

The first brief built the operational core as command-line tools: the host
installer, projects with dev and prod, backups with restore tests, and releases
with rollback. The second built the foundations for the agent: rollback that
knows the schema, the project template with the guided plan, the key vault,
the key check before every commit, and the agent container itself. The third
kept every project container off the machine's own ports and the home network.
The fourth and fifth signed the agent in to the person's own account, gated
releases on a tried plan, and kept what the agent did. The sixth built the
control panel's first slice: an engine on a socket that runs the CLI's own code
(D62), the panel in a fenced container behind the proxy (D63), signing in to it
(D64), and its simple mode for one app's plan, preview, release and going back
(D65). The rest of the panel, sign-in in front of apps, internet publishing,
tunnels, the GitHub integration and the key check before push come later.

The product name and the command name are each defined once, in
[brand.conf](brand.conf). The command is `allvibe`, and the service user and
directories use the same name.

## The rules

1. **The agent never reaches prod.** Nothing in a dev environment has network
   access to, credentials for, or volumes of a prod environment.
2. **No release without a fresh backup** on a target outside the machine's own
   disk, and that backup must have passed a restore test.
3. **The control panel is never exposed directly to the internet.** It answers
   only through its door, on the machine's home-network address, by its own
   names, to private source addresses (D63, D74).
4. **Secrets never appear** on a command line, in output, in logs, in the repo or
   in a chat. Tools read them by name from the environment or from files with
   restricted permissions, and never prompt for a password. SSH is key-based
   with `BatchMode=yes`.
5. **Everything a beginner needs to do must eventually be doable in a browser.**
   The CLI is the engine the panel calls (through the engine service, D62),
   not the user interface; the panel never reimplements what it does.
6. **Every numbered item is tried by a human before it counts as done.** Reports
   keep what was actually run and observed apart from what was only built.
7. **Stop at the first failure.** An operation that fails part-way names the step
   and what would have to be true, and takes no further steps.
8. **Rollback never loses data silently.** If a rollback would discard data
   written since the release, it says so and requires explicit confirmation.
9. **Nothing is ever named "nocry"**: no command, process, service, container,
   image, package or file. "NoCry" is the name of a ransomware family, and a
   service that runs around the clock on people's home computers must not share
   a name with one. `node scripts/guard.mjs` checks it.
10. **The repository never contains details of the owner's infrastructure**:
    internal IP addresses, host names, SSH users, or the names of machines,
    stacks or containers. Such values live in a gitignored local configuration
    (`local.env`, see [local.example.env](local.example.env)) or in environment
    variables read by name. `node scripts/guard.mjs` checks it, with a local list
    of private strings that never leaves the owner's workstation.
11. **Never rewrite the repository's git history without asking the owner
    first.** No force push, no amend of a pushed commit, no rebase of pushed
    work.

## Not in version 1

- An own code editor.
- Local AI models.
- Several users per machine.
- Any architecture other than x86-64.
- Any OS other than Debian 13.

## Roles

- **Fredrik**, the owner, relays between the two assistants below, tries every
  item before it counts as done, and publishes.
- **The architect** (a separate Claude chat) owns *what* and *why*: the briefs,
  the review, the decisions about the product.
- **The implementer** (Claude Code, in this repository) owns *how*: code, tests,
  verification, and the record of what was actually run.

## The working loop

1. **A brief** arrives with numbered items, each with a "done when".
2. **One item at a time.** Build it, verify it as far as it can be verified here,
   and commit it: one commit per item, pushed. Never start the next item inside
   an unfinished one; a session that runs out of room stops after a completed
   item and says which remain.
3. **A human tries it** (rule 6). Until then it is built, not done.
4. **Record.** [STATE.md](STATE.md) at the end of every session, including "To
   verify on real hardware"; [DECISIONS.md](DECISIONS.md) for every decision,
   with its reason; this file's mistakes section for every lesson; and a report
   in `reports/` that keeps what was run and observed apart from what was only
   built.

Before every commit: `node scripts/guard.mjs` is clean, run on its own and its
exit code checked, never piped (mistake 42), and nothing in the diff is a
secret or a detail of anybody's infrastructure. In the owner's clone, git runs
it itself before every commit, on the staged files and on the message, and
refuses a commit it finds anything in (`scripts/hooks/`, D71); in a new clone,
copy `scripts/hooks/pre-commit` and `scripts/hooks/commit-msg` into
`.git/hooks/`. The CI scans every push for secrets (D6).

## Mistakes we do not repeat

Each of these happened, in Vikt or here, and cost something. The ones from Vikt
name its decision ("Vikt D103" is Vikt's DECISIONS.md, not ours); the inventory
is [docs/vikt-inventory.md](docs/vikt-inventory.md). Add to this list whenever
something goes wrong for a reason that could happen again.

1. **A schedule that is documented is not a schedule.** Vikt's nightly backup was
   a cron line in a comment for two passes, so the only backups were the ones
   somebody started by hand, and later the host turned out to have no copy of the
   scripts at all (Vikt D103, D163). *Here:* install enables the timer, and
   `doctor` reports whether it is active and what its last run did.
2. **A backup that has never been restored is a hope.** A file of the right size
   and a green job prove nothing until something has read it back (Vikt D96,
   D168). *Here:* a restore check after every backup and before every release.
3. **Built is not done.** Vikt documented a Dockerfile layer as done that had
   never been built, and it failed the first time anything did (Vikt D103, the
   `postgresql-client` layer). *Here:* rule 6, and reports that keep what was run
   apart from what was only written.
4. **A check that answers an adjacent question.** "The newest workflow run"
   instead of "this tag's run", "CI for the branch tip" instead of "CI for the
   commit being released", an authenticated pull instead of the anonymous one the
   host would make: each passed while the real question failed (Vikt D183,
   D160). *Here:* identify things by their exact identity, and ask the question
   the real consumer will ask, the way it will ask it.
5. **A test that cannot fail the way the real thing fails.** Eleven tests of a
   network destination connected to an address that refused at TCP, so none
   reached the authentication that was broken; and a green test once asserted
   the very bug it guarded against (Vikt D132, D157). *Here:* before trusting a
   check, make it fail once for the right reason.
6. **A value that is not forwarded is silently absent.** A setting typed into a
   panel that the compose file never passed on left features off while every
   screen showed them configured (Vikt D147). *Here:* the suite generates both
   the configuration and the file that consumes it, from one description.
7. **The file that runs is not the file in the repository.** Vikt's production
   stack was a hand-edited file that did not read the variable the runbook set,
   so the runbook could not have worked (Vikt D156). *Here:* the suite writes
   every file it deploys, and never edits one in place by hand.
8. **An interrupted write leaves something that looks finished.** *Here:* write
   to a temporary name and rename when complete, as Vikt's backup does (Vikt
   D96), and flush before renaming.
9. **Cleanup that deletes what it did not create.** Vikt's retention job recursed
   and would have deleted the rollback dump of the running release (Vikt D159).
   *Here:* delete only what this code made, where it made it, and never the
   backup a rollback needs. On the workstation: only what carries the test
   harness's label, and never a global prune.
10. **A step that needs a password ends with the password in a transcript.** A
    credential pasted into a session was burned and rotated, twice (Vikt D158).
    *Here:* no step asks for one (rule 4).
11. **A tag is somebody else's name for an image.** Two images vanished or
    changed under unchanged tags in one week (Vikt D138). *Here:* every image is
    pinned by index digest.
12. **Prose and the thing that runs must not be the same text.** A regular
    expression over a document read a sentence explaining when *not* to set a
    variable as an instruction to set it (Vikt D193, D194). *Here:* inputs are
    structured data, never scraped from documentation.
13. **A working copy is not the committed file.** On Windows, CRLF working copies
    differ from their LF blobs, and a script sent from one fails on Linux with
    "bad interpreter" (Vikt D163). *Here:* `.gitattributes` keeps LF everywhere.
14. **A client of another version fails only at restore time.** A `pg_dump` one
    major version behind the server refuses to run (Vikt D96, D103). *Here:* dump
    and restore through the database image of the right version.
15. **A directory that looks right is not writable by the process that writes.**
    Vikt's scheduled backup failed with `EACCES` because a mount's owner did not
    match the app's uid (Vikt D168). *Here:* a backup target is tested by
    writing to it as the real writer before it is accepted.

From the first brief, here:

16. **Check an environment signal in the real environment before building on
    it.** The test overrides were to be gated on `systemd-detect-virt`, which on
    Docker Desktop answers `wsl`, not `docker`; the gate would never have opened
    (D14 amendment). *Here:* look at what the signal actually says on every
    kind of machine it must work on, first.
17. **A check about one thing must not fail an operation about another.** The
    installer reported a completed reinstall as failed, because `doctor` rightly
    flagged a missing backup disk (D17 amendment). *Here:* checks carry a scope,
    and an operation fails only on the checks that are about it.
18. **"Previous" is what actually ran before, not the entry before it in a
    list.** After a rollback and a new release, rollback went to the version
    before in the list, not the one prod had run (D26). *Here:* record what was
    replaced, and go back to that. The same mistake as number 4, in a new place.
19. **A failure message names the cause.** A failed deploy first reported the
    last line of a stack trace, "Node.js v24.21.0". *Here:* pick the line that
    says what went wrong, and show that.
20. **An operation that can fail half-way must be retryable.** A project whose
    creation failed at step 6 could not be created again, because its name was
    taken by the half-made one. *Here:* the failure says how to clear it
    (`project remove`), and clearing it is one command.
21. **Paths on the host are POSIX paths, wherever the code is tested.** `path.join`
    on Windows produced backslashes in paths meant for Debian; the code was
    right on Debian and its tests failed on the workstation. *Here:*
    `path.posix` for every host path.
22. **Keep the guard strict; change the example instead.** Docker's default
    ranges in a test tripped the rule 10 guard. *Here:* examples use the
    documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`), and the guard's
    allowlist holds only the address pools the product itself sets (D16).

From the second brief, here:

23. **"The rest of the line" must not reach the next one.** `\s*` matches a
    newline: an empty `-- breaking:` mark took the next line, the SQL itself,
    as its reason, and would have let an unexplained breaking migration
    through (D35). *Here:* `[ \t]*` inside a line, and a test that an empty
    mark is no mark.
24. **A search for a secret's prefix finds the scanner's rule for it.** Looking
    for `AGE-SECRET-KEY-1` inside the agent container found one file: the
    gitleaks binary, which holds that prefix as a detection rule. *Here:* search
    for the whole shape of the secret, and look at what matched before counting
    it.
25. **A substring is not a flag.** A test that forbade `--pid` failed on
    `--pids-limit`. *Here:* compare arguments whole, or as `flag=`.
26. **A stopped commit has still written what was staged.** git stores a
    staged file in its object store at `git add`, before any hook runs, so a key
    stopped by the pre-commit check sits in `.git/objects`, unreferenced, until
    it is pruned (D38). *Here:* say so, unstage after a block, and search the
    object store, not only the history.
27. **"The backup from before the release" depends on which release prod is
    on.** After a release that failed past its breaking migration, prod runs the
    failed version, not the recorded current one; restoring the current one's
    backup would have gone back two releases. *Here:* record what prod actually
    runs, and go back from that (D35). Mistake 18 again, in a third place.
28. **A probe must show the same thing when it runs twice.** The agent probe's
    clean commit wrote the line its last run had written, so the second run had
    nothing to commit and printed nothing. *Here:* what a probe changes is
    unique to each run.

From the third brief, here:

29. **A probe that cannot fail proves nothing, however green.** Busybox's `nc`
    has no `-z`, so every probe of the databases answered "refused" whatever
    happened. *Here:* run a new probe once without the thing it checks: without
    the firewall, 24 of its 59 checks had to say WRONG, and did (mistake 5,
    again).
30. **A target that is down looks exactly like a target that is blocked.** The
    test's listeners died on the first probe that hung up on them, so a
    "refused" meant nothing. *Here:* try every target from the machine itself
    first, where it must answer, in the same run as the containers.
31. **sh has no local variables.** A helper's `seen` overwrote the caller's list
    of hashes, and a check of dev's key passed because it compared against the
    word "blocked". *Here:* a function's variables have names of their own
    (`v_seen`), and the caller's say what they hold (`hashes`).
32. **A self-check must not ask about what is not there yet.** The firewall's
    unit runs before Docker at boot, and checked Docker's own jump, so it
    failed at every boot while the rules were in place. *Here:* check at apply
    only what apply did; check the rest after what it depends on has started.
33. **A unit's command line is not a shell's.** systemd turned the `\n` in a
    `node -e` string into a line break, and the service never started. *Here:*
    a unit runs a file, not code written into its command line.

From the fourth brief, here:

34. **An option that a tool documents elsewhere may not exist in the tool you
    have.** The agent's home got the kernel's `noswap` tmpfs option, in the code
    and in a unit test, and Docker 29 refused to start the container with it.
    *Here:* try a new option on the real engine before building on it; the
    agent now gets no swap from Docker's own swap limit, seen as 0 inside it.
35. **An interface's default can be the way out.** Claude Code's question
    whether to trust the working copy defaults to "No, exit", so pressing Enter
    through its first start left it. *Here:* every "press Enter" in the
    walkthrough is replayed before it is written down, and a default that
    leaves is named.
36. **Closing a terminal does not end what it started in a container.** Killing
    the terminal of `allvibe agent shell` left `claude` running in the agent
    until the container was stopped. *Here:* say how to leave properly
    (`/exit`, or `Ctrl-C` twice), and count on `agent stop` for the rest.

From the fifth brief, here and in the website:

37. **A decision that changes what is served must change every test of it,
    the release workflow's included.** The website's D26 made `/favicon.ico`
    an icon, and its release workflow still expected 204; the tag v0.3.0 was
    pushed, its workflow failed, and a published tag cannot be moved without
    rewriting history. *Here:* in the same commit as the change, search every
    test and workflow for the old behaviour; run the release workflow's own
    test against the commit before tagging it.
38. **A check that compares nothing, or matches everything, passes.** The plan
    gate's probe compared prod's `current` before and after, and it was
    undefined both times; a leak probe's pattern file had an empty line, and
    `grep -f` matched every file. *Here:* every "unchanged" check compares
    something that exists and prints it (the image prod runs, the number of
    backups); pattern files are built without empty lines, and the number of
    patterns is itself a checked line.
39. **A probe that races the code it tests proves luck.** The damage meant for
    the rollback's fresh backup came from a watcher polling too slowly, after
    the restore check had read the file. *Here:* act on the event itself
    (inotify), and check that the damage landed before trusting the verdict.
40. **An old version that ignores a new flag passes for the wrong reason.** The
    previous bundle's doctor ignored `--last` and printed its usual checks, so
    the negative control passed. *Here:* a negative control looks for what only
    the new behaviour prints (the nightly result's header). And a setting the
    agent can change is proved read before it is proved powerless: its own hook
    is seen running, then seen off, beside the log's hook still writing.
41. **A heredoc inside a heredoc ends the outer one.** Walkthrough text holding
    its own `EOF` line, passed to Python through a shell heredoc, ended it
    early, and the rest of the text ran as shell commands on the workstation; a
    bare `sh` waited for input until it was stopped (the fifth report said
    `node`; the session's record shows `sh`). Nothing was written or removed.
    *Here:* text with heredocs in it goes into a file with the file tool, never
    through a shell heredoc, and the walkthrough's own heredocs end with `END`.
42. **A pipe keeps only the last command's exit code.** `npm run guard | tail
    -1 && git commit` committed and pushed what the guard had refused: an
    address from the owner's private list (the sixth brief, item 8). *Here:*
    the guard runs on its own, unpiped, and its exit code is checked before
    every commit.
43. **Rule 16 is kept by habit, not by a tool.** After mistake 41, two commit
    messages and one Python edit still went through shell heredocs, and, after
    this entry was written, a multi-line `node -e` script in shell quotes
    inserted a section into STATE.md; nothing went wrong, and nothing stopped
    them. *Here:* a commit message is a file written with the file tool,
    committed with `git commit -F`; so is every script, however short it
    looks, and every edit goes through the Edit tool. Since D71, a hook in the
    owner's user settings and in this repository's refuses a heredoc or
    multi-line quoted text before it runs.
44. **A service's sandbox is part of its environment.** The engine ran the
    CLI's release under `PrivateTmp=yes`, which hid its temporary files from
    Docker, and then under a tighter umask, which made the restore check's
    password file unreadable to the app's container; each broke the restore
    check. *Here:* a service that runs the CLI's operations runs them in the
    CLI's own environment, and a hardening option stays only after a real
    release has run under it.
45. **A rule in a form the tool no longer reads matches nothing, silently.**
    Deny rules ending in `:*`, Claude Code's old prefix form, refused nothing.
    *Here:* every deny rule is seen refusing a harmless command, and the same
    commands seen running without the settings file (`deny-probe.mjs`).
46. **A mount changed in one namespace is not changed in another.** On the test
    host, the backup disk unmounted from a root shell was still mounted in the
    engine's own namespace, and a release meant to be refused went live, on
    the real disk. *Here:* a fixture changes the machine where the service
    under test sees it, and says what that view shows.
47. **A service must not wait for a client that is waiting for it.** doctor,
    run on the engine's thread, asked the panel, whose `/health` asked the
    engine: only a timeout ended it, and it was reported as the panel's
    problem. *Here:* the engine does blocking work off its thread, and the
    engine probe checks the panel's line as the engine sees it.

From the seventh brief, here:

48. **A trigger that did not happen looks like a fix that does not work.**
    The Preview frame's probe deployed the test copy with nothing changed, and
    the frame rightly stayed as it was: the deploy had left the container
    running as before, so there was no new test copy to reload for. The probe
    said WRONG about a panel that was right. *Here:* a probe makes the real
    event happen (a committed change, deployed) and checks that it did before
    judging what followed.
49. **A frame from another site runs in another process.** Once the panel was
    reached by its own name, the test copy's frame moved to a process of its
    own, which the page's debugging session does not see; the probe's "inside
    the frame" commands ran in the panel's page instead, which navigated
    itself and opened windows, and the probe reported that as the frame's.
    *Here:* a check that runs inside something first asks it where it is, and
    says "no such frame" rather than run anywhere else (`cdp.mjs`,
    `evalInFrame`).
50. **Moving a service changes which rules apply to it.** The panel's door
    moved from the proxy, on the host's network, into a container: D41's
    rules for containers then dropped its replies to the home network, and
    let the apps' containers reach it. The existing probes caught both.
    *Here:* when something moves between the host and a container, every
    isolation probe of both runs again before it counts as done.
51. **A stream must not speak before it has answered.** When a second window
    took the terminal over, the engine made it the terminal's before writing
    its answer, and Claude Code's redraw reached the panel first; the panel
    read the redraw as the answer, and refused the window. *Here:* a stream
    sends nothing of its own until its answer is written, and the test for it
    has the other side talking while it joins. (And the probe of it pressed
    Enter at Claude Code's "No, exit", mistake 35 again: a probe waits for each
    screen before it answers it.)
52. **Work that waits must not wait on the thread that answers.** Mistake 47
    again, for jobs: a job ran the CLI's command on the engine's own thread,
    and during the agent's first image build the engine answered nothing for
    46 seconds; the panel's question timed out, and the page, on one failed
    answer, stopped asking for good, so "Start your AI" never ended on a fresh
    machine. *Here:* a job's command runs on a thread of its own; a page that
    follows something asks again when an answer does not come; the engine
    probe measures its slowest answer while a release runs, against a control.
53. **What a view says about "since" must not wait for the rest of it.** The
    plan's view worked out whether the AI had committed more only after it had
    read a plan from the test copy, so an app whose test copy had no plan yet
    never showed its first one. *Here:* what does not depend on the plan is
    worked out before any early return, and the chat probe starts from an app
    with no plan at all.
54. **A class name is global.** A side light's state, `work`, was also the app
    view's layout, and the light became a grid 90 pixels wide. No check looked,
    and only a screenshot showed it. *Here:* a state's class says the state
    (`building`), and the browser checks measure the lights.
55. **A closed dialog keeps what it last showed.** A check waited for the
    Backups list and read the one left from the dialog's last opening, before
    the new one arrived. *Here:* a check waits for the dialog to be open, not
    for its content to exist.
56. **A stand-in for the model is asked more than the model's turns.** Auto
    mode's classifier asks the same API before a command runs; the stand-in
    answered with the end of a turn, and Claude Code blocked the command "for
    safety" while the probe waited for a commit. *Here:* the fixture allows
    the stand-in's own command in the working copy's local settings, and a
    probe that waits on Claude Code shows what Claude Code sent back for each
    tool call when it gives up.
