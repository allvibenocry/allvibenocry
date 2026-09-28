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
The web UI, sign-in in front of apps, internet publishing, tunnels, the GitHub
integration and the key check before push come later.

The product name and the command name are each defined once, in
[brand.conf](brand.conf). The command is `allvibe`, and the service user and
directories use the same name.

## The rules

1. **The agent never reaches prod.** Nothing in a dev environment has network
   access to, credentials for, or volumes of a prod environment.
2. **No release without a fresh backup** on a target outside the machine's own
   disk, and that backup must have passed a restore test.
3. **The control panel is never exposed directly to the internet.** There is no
   panel yet; the rule is recorded now.
4. **Secrets never appear** on a command line, in output, in logs, in the repo or
   in a chat. Tools read them by name from the environment or from files with
   restricted permissions, and never prompt for a password. SSH is key-based
   with `BatchMode=yes`.
5. **Everything a beginner needs to do must eventually be doable in a browser.**
   The CLI is the engine the web UI will call, not the user interface.
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

Before every commit: `node scripts/guard.mjs` is clean, and nothing in the diff
is a secret or a detail of anybody's infrastructure. The CI scans every push for
secrets (D6).

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
