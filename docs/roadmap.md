# Roadmap

What is planned, and what has been built from the plan. **Every entry under
Planned is Planned**: none of it exists in the code yet, and none of it has
been tried anywhere. When a brief builds an entry, it moves to **Built, from
this roadmap** at the end, under the same heading, with the decision that
records how. Built means built and run on the test host by the implementer:
not yet tried by the owner (rule 6), and not yet on real hardware. What works
is in [STATE.md](../STATE.md); why things are the way they are is in
[DECISIONS.md](../DECISIONS.md).

---

# Planned

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

**Its own boundaries.** The panel will run in a container (D40), but it is not a
project container: it drives the suite, so D41's firewall, which keeps project
containers off the machine and the home network, is not its fence. What it may
reach, and who may reach it (rule 3), is decided with it.

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

## Agent adapters

**Planned, and begun.** From the architect's review of the website (D34).
**Built** (the second brief, D39): Claude Code, with the user's own API key
from the key vault, in the agent container. **Still planned**: everything else
below, from signing in with a Claude subscription on.

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
- **Later adapters, in this order:** the MCP bridge (below, D44), then OpenAI's
  Codex CLI, GitHub's Copilot CLI, and Google's agent once its move from Gemini
  CLI to Antigravity CLI has settled. **Each vendor's terms are confirmed
  before its adapter ships.**

**Why.** The agent is the vendor's product, and the user's relationship with
the vendor is the user's: an unmodified tool, signed in the vendor's own way,
keeps the user inside the vendor's terms, and keeps the suite out of their
credentials and their bill. Dev is where rule 1 already puts the agent: nothing
in a dev environment reaches prod. One instructions file that every tool reads
means a project does not have to be rewritten for each agent.

**Why the order changed** (D43): buying API credits asked the owner, a private
person, for a VAT number. If that holds for private people in the EU, the own
API key is out of reach for much of the audience, and the paths that use a
subscription the user already has, signing in with it and the MCP bridge,
matter far more. The live agent test waits for either.

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

**The other half of D41.** Since the third brief, the apps cannot reach the home
network (D41); sign-in is the other direction: the home network, its guests and
its devices, not reaching the apps unasked.

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

## The MCP bridge

**Planned.** The second adapter, ahead of Codex (D44). From the architect's
review of the second brief.

**The machine runs an MCP server, and the user works with the AI client they
already pay for**, signed in through its vendor's own flow. The suite handles
no AI credentials at all.

- **Its tools reach dev only**: read and write files in dev's working copy,
  deploy to dev, run the checks, read dev's logs, and commit through the key
  check (D38).
- **Never a release**: the bridge can only propose one, and the person releases
  it in the panel, behind the backup and the restore check.
- **Every tool call is logged** and visible to the person.
- **The method goes with it**: AGENTS.md and the guided plan as MCP resources
  and prompts; and what matters most, dev only, the key check and additive
  migrations, enforced by the tools, not only by instructions.
- **Local clients first**, on the home network: Claude Code, Claude Desktop
  through a small local bridge, VS Code, Cursor. **Cloud connectors** that call
  in from outside need the machine reachable from the internet, which rule 3
  forbids for the panel: later, if ever, and only behind strong sign-in.
- The user's chat client can take the architect's role (below) and a coding
  client the builder's.

**Why.** It is the one path that needs no API credits and no sign-in the suite
would have to be trusted with: the user keeps the client and the subscription
they have (D43), and the suite keeps what it is for, the safety net around dev
and prod.

## Two modes in the control panel

**Planned** (D45). From the architect's review of the second brief.

**A simple mode for beginners, and "Show what's under the hood"** for people who
want details and finer control: a deeper layer of the same panel, which can
never bypass the safety net silently.

- **Insight that only shows:** containers, logs, resources, files and code, the
  diff of each step, migrations with their class (D35), release logs, backup
  details, the agent's sessions, and a live map of which containers can reach
  what (D41).
- **Control inside the safety net:** templates, resource limits, the backup
  schedule and extra targets, the choice of agent, a terminal into dev but never
  into prod, and a read-only view of prod's database.
- **Ideas to keep:** "Load safe defaults", ready-made profiles, an "Explain this"
  button that asks the AI to explain a detail in plain words, a preview of what
  every advanced action will change before it runs, a resource budget per app,
  and exporting an app.

**Why.** A beginner must never need the details (rule 5), and someone who wants
them should not have to leave the panel for a terminal to get them. One panel
with a deeper layer keeps both on the same safety net, instead of an "expert"
path around it.

## A bug report builder

**Planned** (D45). From the architect's review of the second brief.

**A report button inside the test copy only, never in prod:** area screenshots
with marks, guided questions (what did you do, what did you expect, what
happened instead), and context gathered by itself (the browser console's
errors, failed requests, dev's server log for the same time, the version and
the plan's step), bundled into one report file with its images, in the project.
**The agent reproduces the problem first, then fixes it, then stops** for the
person to try again.

**Why.** "It doesn't work" is what a beginner can say; a screenshot, three
answers and the logs of the same minute are what an agent needs. Collecting
them for the person, in dev where nothing is real, turns the one into the
other, and reproducing before fixing is the guided plan's own rule applied to
bugs.

## The architect

**Planned** (D45). From the architect's review of the second brief.

**A second role the person talks to**: it turns an idea into a brief with a
check for every step, and reviews the builder's report against the brief in
plain words (what was built, what to try, what it is unsure about), sized to
the change, so a small change gets a small plan. It can be a second, read-only
Claude Code session with its own instructions that may only write briefs, and
later another vendor's agent, for a second opinion.

**Why.** It is how this repository itself is built (CLAUDE.md, "Roles"): one
role owns what and why, another owns how, and a person tries every step. A
beginner gets the same, without having to be the architect themselves.

## Also planned, and recorded elsewhere

These were named when their decisions were made, and are not repeated here:

- In [CLAUDE.md](../CLAUDE.md): the web UI, internet publishing, tunnels, the
  GitHub integration, and the key check before push. (The agent container is
  built, D39, and so is a key check before every commit, D38.)
- In D28: a lock between operations, and pruning old release images and release
  backups.

---

# Built, from this roadmap

Each moved here when a brief built it; its heading is the one it had above.
Built, run on the test host, and not yet tried by the owner (rule 6).

## Rollback past a migration

**Built** (the second brief, D35). Was: the known gap in D26, from the
architect's review (D31).

- **Every release records the schema it ran with**, asked of the database,
  beside the commit and the backup.
- **Migrations are additive or breaking**, and a release refuses a breaking
  one unless its file says so (`-- breaking: <what it changes>`), and refuses
  an edited or removed one, before anything changes.
- **A rollback across additive migrations goes ahead**, and says so; **across
  a breaking one it stops before deploying**, names the migration, and offers
  `--restore-data` with its confirmation.
- **The project template's rule** is in its AGENTS.md (D36): only add, unless
  the user agrees.

## A key vault

**Built** (the second brief, D37). Was: one of the website's promises (D33).

`allvibe key set|list|remove`. Values from standard input, encrypted to the
host key and the recovery key, handed to apps at run time as files
(`/run/secrets/<NAME>`, the path in `<NAME>_FILE`), never an environment
variable; separate for dev, prod and the agent, so prod's keys are never in
dev; in every backup, and restored by the restore check.

## A guided plan

**Built, as instructions** (the second brief, D36). Was: from the architect's
review of the website (D34).

Every new project's `AGENTS.md` tells the agent to turn an idea into a short
numbered plan with a check the user can try at every step, to build one step
at a time, and to stop after each for the user to try it. It is followed by
the agent, not enforced by the suite.

## The control panel's runtime

**Decided** (the second brief, D40), for the brief that builds the panel; not
built. Was: a decision to make, from the architect's review of the website
(D33).

The panel runs in a container on the official Node.js 24 image, pinned by
digest (D27), not on the host's Node.js 20: acceptable for a command-line tool
that listens on no port (D32), not for a web server.
