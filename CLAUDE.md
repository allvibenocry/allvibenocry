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

The first brief builds the operational core as command-line tools: the host
installer, projects with dev and prod, backups with restore tests, and releases
with rollback. The web UI, the agent container, internet publishing, tunnels,
the GitHub integration and the key check before push come later.

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

Seeded from Vikt's history in item 2 of the first brief.
