# Roadmap

What is planned, and not built. **Every item on this page is Planned**: none of
it exists in the code yet, and none of it has been tried anywhere. What is built
is in [STATE.md](../STATE.md); why things are the way they are is in
[DECISIONS.md](../DECISIONS.md). An item leaves this page when a brief builds
it, and its decision goes into DECISIONS.md then.

---

## Off-site backups

**Planned.**

**Today** a backup goes off the machine: to a USB disk or a NAS, which the suite
proves is not the machine's own disk before it writes to it (D22). That protects
against the computer dying. It does not protect against what takes the whole
house: a fire, a theft, water. The backup disk is usually in the same room as
the computer.

**Off-site** means out of the house as well. The plan:

- **A backup target becomes a type, not a path.** Local disk, as today; an
  [rclone](https://rclone.org) remote; S3-compatible storage. The backup format,
  an encrypted file and its manifest (D23), already works for any target: it is
  two files, and neither needs anything from the place it is kept.
- **Several targets at once.** The release gate still requires only the local
  off-machine backup (rule 2). The off-site copy is sent in the background, and
  raises an alert when it falls behind, so an internet outage never blocks a
  release.
- **Options offered, simplest first:**
  1. Two disks, rotated between home and somewhere else, with a reminder from
     the suite when it is time to swap.
  2. Cloud storage the user already has (Google Drive, OneDrive, Dropbox),
     through rclone.
  3. S3-compatible storage (for example Backblaze B2, Hetzner, Scaleway or
     Cloudflare R2).
  4. Later, perhaps, a friend's machine.
- **Off-site credentials can write but not delete**, so that a compromised
  machine or a misbehaving agent cannot destroy the off-site copies.
- **An occasional restore check of an off-site copy**: downloaded, and tested
  the same way as today's local restore check (D23).
- **The provider only ever sees encrypted files.** Encryption happens on the
  machine, to the host key and the recovery key (D13), before anything leaves
  it.
- **The recovery key has to live outside the house too.** An off-site backup is
  useless after a fire if the only copy of the recovery key burned with the
  laptop. The setup guidance must say so plainly.

## The recovery key, once there is a web UI

**Planned.** A follow-up to D13, from the architect's review (D29).

Today the owner copies the recovery key off the machine by hand, as a file, and
hands it back with `allvibe recovery-key confirm` (D13;
[walkthrough.md](walkthrough.md), step 6). A beginner will instead get it from
the web UI as:

- **a download**, and
- **a printable recovery sheet**,

and will still have to confirm it before the first release, as today.

## A lost recovery key

**Planned.** A follow-up to D13, from the architect's review (D29).

Today there is no way to replace the recovery key: it is made once, at install.
When it is lost, the plan is:

- **a new recovery key for future backups**, and
- **a clear warning that older backups open only with the old key.** Every
  backup already records the public half of the key it was encrypted to, in its
  manifest (D23), so the suite can say exactly which backups the lost key was
  needed for.

## Rollback past a migration

**Planned.** The known gap in D26, from the architect's review (D31).

Rolling back past a release whose migration succeeded runs old code against a
newer schema. Today, if the old code still answers its health check, the
rollback is reported as done. The plan:

- **Releases record their schema version**, beside the commit and the backup
  they already record.
- **Rollback explains, and offers `--restore-data`, when the database is newer
  than the version it goes back to.**
- **The project template gets a rule: within one release, migrations only add,
  never drop or rename.**

## A key vault

**Planned.** One of the website's promises, made a plan by the architect's
review of the website (D33).

API keys, the keys an app needs for services outside the machine, are **stored
encrypted on the machine and handed to apps at run time**: never in code, never
in the repository, never pasted into a chat.

**Why.** A key written into code ends up in git history, and from there on
GitHub once the GitHub integration exists; the key check before push (CLAUDE.md)
catches that mistake, and the vault is the place that makes it unnecessary.
Handing a secret to an app at run time is how a project's database password
already works (D21: a file mounted into the one container that needs it, never
an environment variable). A vault extends that to the keys a user brings, and
keeps dev from ever holding prod's (rule 1).

## The control panel at allvibe.local

**Planned.** One of the website's promises (D33).

The control panel answers at **`allvibe.local`**, a name announced on the home
network by multicast DNS (mDNS), with **the machine's address as the fallback**.
The name is the machine's, not each project's: **projects keep one port per
environment on the host's address**, as D18 and D30 decided, and the panel
links to them.

**Why.** A beginner needs one address to type, once; after that the panel's
links take them everywhere (D30). mDNS needs no DNS server, router change or
hosts file. D18 rejected `.local` names *for projects* because they do not
resolve the same way on every device, and that is why the address stays as the
fallback and why projects are not given such names.

## An installer on a USB stick

**Planned.** One of the website's promises (D33).

**An installer image for a USB stick** that installs Debian 13 and the suite on
an old computer.

**Why.** Today a host starts as a Debian 13 installation with an SSH server,
then `install.sh` run as root (docs/walkthrough.md): a terminal, which the
thesis says a beginner must never need (CLAUDE.md, rule 5). An image that does
both is the one step a beginner can take without one. It is also where full
disk encryption can be offered (below), since that is decided when the system
disk is set up.

## Disk health warnings

**Planned.** One of the website's promises (D33).

**Warnings in plain language from the disk's own health data** (what the disk
reports about its wear and its errors), in `allvibe doctor` and later in the
panel: for example, that the disk is wearing out and should be replaced.

**Why.** On an old computer the disk is the part most likely to fail, and a
warning before it fails is worth more than a restore after. The backups (D22,
D23) make a dead disk survivable; this makes it expected. `doctor` already
speaks in plain language (D17).

## A monthly check-up

**Planned.** One of the website's promises (D33).

Once a month, **updates are prepared in the test copy**, dev, **for the user to
try**, and then **shipped through the gates like any other change**: a fresh
backup, a restore check, the health check, and a rollback if it fails (D25).

**Why.** Every image the suite uses is pinned by digest (D27), and a project's
dependencies are locked, so nothing updates by itself, which is right: a tag is
somebody else's name for an image (CLAUDE.md, mistake 11). But nothing updating
means security fixes wait until something updates them on purpose. The same
gates as any change make an update as safe as one.

## Moving to a new computer

**Planned.** One of the website's promises (D33).

**Install on the new computer, point it at the backups, and restore the whole
machine with the recovery key.**

**Why.** D13 already says that restoring on a new machine needs the recovery key
and nothing else, and every backup can be restore-checked (D23). What is missing
is the move itself. Today a backup holds prod's database only (D23); moving a
machine also needs each project's code, its releases and its settings, which
this entry includes.

## Full disk encryption, offered at install

**Planned.** From the architect's review of the website (D33).

**Encrypting the system disk, offered when the machine is installed.**

**Why.** The host key that decrypts the backups sits on the same computer (D13),
so a thief who takes the laptop and its backup disk together can read the
backups. Disk encryption closes that: without it, a stolen computer is readable
as it is. It belongs with the USB installer, since it is decided when the
system disk is set up. To decide when it is built: how the machine unlocks at
boot without somebody typing a passphrase, since it is meant to come back on its
own after a power cut.

## The control panel's runtime

**Planned: a decision to make before the control panel is built.** From the
architect's review of the website (D33).

**Which Node.js the panel runs on.**

**Why.** The CLI runs on Debian 13's own Node.js 20 (D15), and that is
deliberate (D32): it listens on no port. On 2026-09-27 Debian's security tracker
listed six 2026 CVEs still open for Node.js 20 in Debian 13, fixed only in newer
Debian releases. That is acceptable for a command-line tool; it is not for a
web server. The panel could, for example, run in a container on the official
Node.js 24 image, pinned by digest like every image the suite uses (D27), and
updated through the monthly check-up.

## Agent adapters

**Planned.** From the architect's review of the website (D34).

**The coding agent in dev is an official, unmodified vendor tool**, installed
in the dev container, signed in through the vendor's own flow, and shown to the
user as an interactive session in the web interface.

- **Claude Code comes first, with the user's own API key.**
- **Signing in with a Claude subscription is added only after Anthropic
  confirms in writing** that the setup is permitted. The owner sent them the
  question on 2026-09-28.
- **The suite never collects, reads, stores or proxies subscription
  credentials or tokens, and never pays for, resells or intermediates AI
  usage**, now or in any paid version.
- **Shared instructions live in `AGENTS.md`**, the cross-tool standard, with
  `CLAUDE.md` pointing to it.
- **Later adapters, in this order:** OpenAI's Codex CLI, GitHub's Copilot CLI,
  then Google's agent once its move from Gemini CLI to Antigravity CLI has
  settled. **Each vendor's terms are confirmed before its adapter ships.**

**Why.** The agent is the vendor's product, and the user's relationship with
the vendor is the user's: an unmodified tool, signed in the vendor's own way,
keeps the user inside the vendor's terms, and keeps the suite out of their
credentials and their bill. Dev is where rule 1 already puts the agent: nothing
in a dev environment reaches prod. One instructions file that every tool reads
means a project does not have to be rewritten for each agent.

## A guided plan

**Planned.** From the architect's review of the website (D34).

**Each project gets instructions for the agent** (in its `AGENTS.md`, above) so
that an idea becomes a short numbered plan in which **every step has a check the
user can try**, and **the agent stops after each step** for the user to try it.

**Why.** It is rule 6 of this repository, applied to the apps people build: a
step counts as done when a person has tried it, not when the agent says so.
Small steps with a check each also keep every change in dev small enough to try
before it is released.

## Sign-in and invitations

**Planned.** From the architect's review of the website (D34).

**Every app gets sign-in in front of it, private by default**: only the user
and the people they invite.

**Today, under D18, any machine on the home network can reach a project without
signing in.** This entry closes that gap.

**Why.** A home network is shared: family, guests, and every device that has
ever joined it. The proxy (D12) is already the one way into every app, so it is
where sign-in belongs, once, rather than in every app. And it has to exist
before anything is published to the internet.

## The team version

**Planned, after version 1.** From the architect's review of the website (D34).

- **Single sign-on** with the organisation's own identity provider.
- **Roles, with a second approval before a release.**
- **Approved stacks and databases**, set centrally for everyone.
- **Shared connections to company data**, with fine-grained access.
- **An audit trail** of every release and every AI action.
- **Shared AI keys with spending limits**, owned and paid for by the
  organisation.
- **Running on the organisation's own servers.**

**Why, and what it does not change.** It is the same safety for a whole
organisation: people build the small apps they need, and IT decides where they
run, what they reach and who gets in. It comes after version 1, so it does not
contradict "several users per machine" being outside version 1 (CLAUDE.md).
The AI keys are the organisation's own, bought by the organisation, which keeps
the rule above: the suite never pays for, resells or intermediates AI usage.

## Also planned, and recorded elsewhere

These were named when their decisions were made, and are not repeated here:

- In [CLAUDE.md](../CLAUDE.md): the web UI, the agent container, internet
  publishing, tunnels, the GitHub integration, and the key check before push.
- In D28: a lock between operations, and pruning old release images and release
  backups.
