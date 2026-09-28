# Decisions

Every decision about what this is and how it is built, with the reason for it.
**Append-only**: a decision that changes gets a new entry naming the one it
replaces, so the reasoning that was true at the time stays readable.

---

## D1. The name is All vibe no cry, and the command is `allvibe`

*2026-09-26*

The product is **All vibe no cry**, tagline "Vibe fast. Ship safe.", descriptor
"From vibe to live app". The command is `allvibe`; the service user and the
directories on a host use the same name.

- GitHub organisation: github.com/allvibenocry; this repository:
  `allvibenocry/allvibenocry`.
- npm scope: `@allvibenocry`.
- Domains: `allvibenocry.com` and `allvibenocry.se`.
- The website lives in its own repository, `allvibenocry/website`.

**Why.** The name carries the promise: vibe coding, without the crying that
follows losing your data. The command is short to type and names nothing else.

**Defined once.** The product name and the command name are each defined in
exactly one place, [brand.conf](brand.conf), which the installer sources and
the CLI reads. Everything else, including the service user, the directories,
the systemd units and the Docker names, is derived from the command name, so a
rename is a one-line change. Environment variables keep the fixed prefix
`ALLVIBE_`, because they are an interface people write into their own shells.

## D2. Nothing is ever named "nocry"

*2026-09-26*

No command, process, service, container, image, volume, network, package, user,
file or directory is named "nocry" or has it as a part of its name.

**Why.** "NoCry" is the name of a ransomware family. A service that runs around
the clock on people's home computers must never show up in a process list, a
service list or a security scanner under a name that looks like malware. That
would be alarming at best and quarantined at worst.

**How it is kept.** Stricter than the rule's letter: the project's own external
names (the GitHub organisation, the domains, the npm scope, the mail address)
were given to it and are the only places the word appears, and nothing running
on a host is named after them. Everything on a host is named after the command
(D1). `node scripts/guard.mjs` fails on the word anywhere else, and on any file
or directory whose name contains it, and runs in CI on every push.

## D3. AGPL-3.0

*2026-09-26*

The suite is licensed under the GNU Affero General Public License, version 3,
the same as Vikt.

**Why.** Nobody can take the suite and offer it as a hosted service without
sharing their changes with the people who use it. For a project whose promise is
that people own their apps and their data, that is the licence that keeps the
promise when someone else runs it.

## D4. Public from the first commit

*2026-09-26*

This repository has been public since its first commit.

**Why.** The website says the project is free and open source, so the code is
where anyone can read it from the start, not after a clean-up. It also means
every commit is written knowing it is public: no secrets (rule 4) and no details
of anybody's infrastructure (rule 10, D7), checked on every push (D6).

## D5. Pull requests are not accepted yet; issues are welcome

*2026-09-26*

Bug reports and questions as issues are welcome. Pull requests are not accepted
for now.

**Why.** Until there is a contributor licence agreement, keeping every line of
code under a single copyright holder keeps every future licensing option open,
for example dual licensing or moving to a later licence. A merged pull request
would add a second copyright holder whose permission every such change would
then need. This is a statement about copyright, not about the value of
contributions, and [CONTRIBUTING.md](CONTRIBUTING.md) says so in plain words.

## D6. Every push is scanned for secrets

*2026-09-26*

`.github/workflows/checks.yml` scans every push and every pull request for
secrets with [gitleaks](https://github.com/gitleaks/gitleaks), over the whole
git history, and fails the run on any finding. It also runs `scripts/guard.mjs`
(D2, D7).

- **gitleaks runs as its container image, pinned by digest**, not through its
  GitHub Action: the action requires a paid licence for organisation accounts,
  and an image pinned by digest is as fixed as an action pinned by commit.
- **Findings are redacted** (`--redact`): the log of a public repository's CI is
  public, and a scanner that prints the secret it found publishes it a second
  time.
- **Every third-party action is pinned by commit.** There is one,
  `actions/checkout`.

**Why.** The product will require its users never to push a secret (the key
check before push, a later brief). The project's own repository follows the same
rule, enforced the same way, from the first push.

## D7. No details of the owner's infrastructure in the repository

*2026-09-26*

Rule 10: no internal IP addresses, host names, SSH users, or names of the
owner's machines, stacks or containers. Such values live in `local.env`
(gitignored; [local.example.env](local.example.env) shows the placeholders) or
in environment variables read by name.

**Why.** The repository is public (D4). An internal address or a machine's name
tells an attacker what to look for, and nothing in this project needs them to be
committed: the tools read them at run time.

**How it is kept.** `scripts/guard.mjs` fails on any private IPv4 address and
any Windows user profile path in a committed file, and, on the owner's
workstation, on any string in `.local/private-strings.txt`, a gitignored list of
the owner's own host names, addresses and container names. It reports the file
and line, never the matched text.

## D8. Debian 13, x86-64, only, in version 1

*2026-09-26*

A host is Debian 13 ("trixie") on x86-64, on a VM or an old PC. The installer
refuses anything else.

**Why.** Supporting one base keeps support tractable for a one-person project
whose users are beginners: one package manager, one init system, one set of
package names, one Docker repository, and one thing to test. Debian is stable,
free, runs well on old hardware, and its security updates arrive without anybody
doing anything. x86-64 is what old PCs and laptops are.

## D9. Docker Engine with Compose; separate dev and prod stacks per project

*2026-09-26*

Everything a project runs is a Docker Compose stack. Each project has **two
stacks, dev and prod**, with separate containers, separate networks, separate
volumes and separately generated secrets.

**Why.** Containers give each app its own dependencies without touching the
host, and Compose describes a whole stack in a file that the suite can generate,
diff and redeploy. Two stacks that share nothing are what rule 1 rests on: the
agent works in dev, and there is no network, credential or volume through which
dev reaches prod. Docker Engine is installed from Docker's own repository, not
Docker Desktop and not Debian's older package, so the Compose plugin and its
behaviour are the current ones.

## D10. Postgres is the only project database in version 1

*2026-09-26*

A project's data lives in PostgreSQL, one database per environment.

**Why.** Rule 2 makes backup and restore the thing that must never fail, and
every supported database is another backup path, another restore path and
another restore test to get right. One database means exactly one of each,
tested daily. Postgres is also what a beginner's AI agent writes code for most
readily, and it covers everything a beginner's app needs.

## D11. The bootstrap installer is bash; everything after it is TypeScript on Node

*2026-09-26*

`install.sh` is a bash script that turns a fresh Debian 13 machine into a host.
Everything after that, including the `allvibe` CLI, is TypeScript running on
Node.

**Why.** A fresh machine has bash and nothing else that is certain, so the first
step has to be bash. After that, one language for everything: the web UI that
comes later calls the same code as the CLI does today, instead of a second
implementation of the same operations that drifts from the first. The CLI is the
engine (rule 5).

## D12. nginx is the reverse proxy

*2026-09-26*

Every project's web traffic enters through one nginx, running as a container on
the host. Project containers publish nothing to the network themselves.

**Why.** One front door is where access control, TLS and later the panel and the
tunnels belong, and it can refuse requests from dev networks to prod (rule 1).
nginx is small, fast, well understood, and configured in files the suite
generates and checks (`nginx -t`) before reloading.

## D13. Backups are encrypted, and the key cannot be lost unnoticed

*2026-09-26*

**Proposal**, for the architect to accept or change.

Every backup is encrypted with [age](https://age-encryption.org) (the `age`
package in Debian 13) to **two recipients**:

1. **The host key.** Generated at install and kept on the machine, readable only
   by the service user. It is what the daily restore test decrypts with. It dies
   with the machine, which is fine, because of the second key.
2. **The recovery key.** Generated at install. Its public half stays on the
   machine, so every backup is also encrypted to it. Its private half is written
   **once** to a file only the service user and root can read. **It is never
   printed** to a terminal or a log (rule 4). The owner copies it off the machine
   (a password manager, a printout) and then **confirms** it: the copy is handed
   back (`allvibe recovery-key confirm`, which reads it from standard input, and
   later a form in the web UI), the tool checks that it matches the public half,
   and only then deletes the file from the machine. After that, the only copy is
   the owner's.

It **cannot be lost without anyone noticing**:

- **Until it is confirmed**, `allvibe doctor` reports it as a problem as soon as a
  project exists, and `allvibe release` refuses: a backup that only the machine
  itself can decrypt is not an off-machine backup when the machine is what died.
- **Every 180 days** after confirming, `doctor` asks for the copy again. Proving
  you can still produce it is the only way to know you still can.
- **The host key's loss** shows up in the next daily restore test, which fails
  loudly and is recorded.

**Restoring on a new machine** needs the recovery key and nothing else.

**Instead.** A password-derived key: it would have to be typed, which means a
prompt (rule 4), and beginners choose weak passwords. The key only on the
machine: it dies with the machine. The key printed once at install: it would sit
in terminal scrollback and session logs, the places rule 4 keeps secrets out of.

## D14. Development testing uses a disposable test host in a container

*2026-09-26*

Until real hardware is available, the test host is a privileged Debian 13
container with systemd as init, on the owner's workstation, into which
`install.sh` installs Docker Engine and everything else for real. A separate
Docker volume stands in for the off-machine backup target. The harness in
`test/host/` creates, resets and removes it, and labels everything it creates.
Real-hardware verification comes later, on an old laptop with Debian 13; the
same harness then talks to it over SSH (`ALLVIBE_TEST_HOST`, key-based,
`BatchMode=yes`).

**What the container cannot prove**, and how each is handled:

| It cannot prove | Because | In the container |
|---|---|---|
| The system disk's type | Its root is an overlay filesystem with no disk of its own | A test override forces "rotational" |
| That a separate filesystem is a separate physical disk | Every Docker volume sits on the same virtual disk | A test override declares the backup mount a separate disk; everything else still refuses |
| Low-memory behaviour | It sees the whole virtual machine's memory | A test override forces "under 8 GB" |
| Reachability from another machine on the LAN | Its ports are published on the workstation's loopback only | Checked from the workstation's browser |
| Behaviour across a real reboot | There is no reboot | A container restart stands in for one |

**Test overrides cannot be set by accident in production.** They live in one
file, `/etc/allvibe/test-overrides`, and are honoured only when systemd reports
that it runs inside a Docker container, which no supported installation does.
Whenever one is honoured, the installer and `doctor` say so loudly. Each item
that depends on one is listed under "To verify on real hardware" in STATE.md.

**Why a container, not a VM.** The workstation already has Docker; a container
is created and thrown away in seconds, so every test can start from a fresh
host, and nothing else on the workstation has to change.

#### Amendment, 2026-09-26 (item 3): what was found building it

- **The gate is two files, not `systemd-detect-virt`.** Inside the test host on
  Docker Desktop, `systemd-detect-virt --container` answers `wsl`, not `docker`,
  because the kernel is WSL2's and systemd checks for WSL first. The overrides
  are therefore honoured only when `/.dockerenv` exists **and**
  `/run/systemd/container` (written by systemd from the `container` variable
  Docker passes to it) says `docker`. Both are true in the test host on any
  Docker, and neither on a real installation.
- **Memory cannot be measured either.** The container reads the Docker VM's
  memory, 4 GB on the owner's workstation, so the low-memory warning would fire
  on every test host and `doctor` could never be green. So the harness
  **declares** the hardware the test host stands for, as overrides written at
  creation: `memory-mb=16384`, `system-disk=ssd` and
  `external-backup-mount=/mnt/allvibe-backup`. A test forces a warning by
  changing a declaration. That replaces the "force" overrides the table above
  describes, and it tests both directions of each check, not only the warning.
- **The test host's image is committed, not built.** A labelled container runs
  the setup on the pinned Debian image and is committed as a labelled image, so
  no build cache is left on the workstation; if the harness pulled the base
  image, it removes that reference afterwards.

## D15. The CLI runs on Debian's own Node.js, with no runtime dependencies, as the service user

*2026-09-27*

- **Node.js is Debian 13's `nodejs` package** (20.19.2 at the time of writing),
  installed by apt like everything else.
- **The CLI has no runtime dependencies.** It is TypeScript compiled to
  JavaScript that uses only Node's standard library; it drives Docker, git,
  `age` and systemd through their own command lines. A host never runs
  `npm install`.
- **It is installed as a bundle** (`npm run bundle`): install.sh, `brand.conf`,
  the compiled CLI, the templates and a `VERSION` that names the exact commit
  (and says `-dirty` when the tree had uncommitted changes). install.sh copies
  it to `/opt/allvibe/releases/<version>-<content hash>` and points
  `/opt/allvibe/current` at it, so the installed version is always known.
- **It runs as the service user `allvibe`.** `/usr/local/bin/allvibe` is a small
  wrapper: run with sudo, it switches to the service user; run as the service
  user, it runs directly; anyone else is told to use sudo. So every file the
  suite creates has one owner, whoever started the command.

**Why.** Debian patches its own Node.js for the life of the release, through the
same unattended security updates as the rest of the machine, and adds no
third-party repository or signing key to trust. No runtime dependencies means
nothing to install, audit or update on a beginner's machine, and nothing that
can fail to download on the day it is needed. The service user owns the state,
so a file root created cannot later refuse the timer.

**Instead.** NodeSource's repository for a newer Node (another repository and
key to trust, and upgrades on its schedule rather than Debian's); a bundled Node
binary (security updates would be this project's job); running the CLI in a
container (it drives the host's Docker, systemd and files, so it would need all
of them mounted in).

## D16. Docker hands out addresses away from the home network, keeps logs small, and restarts without stopping apps

*2026-09-27*

install.sh writes three settings into `/etc/docker/daemon.json`, keeping
anything else in it:

- **`default-address-pools`**: `172.20.0.0/14`, split into `/24` networks, or
  `10.201.0.0/16` if the first overlaps a network the machine is already on.
  An existing pool is never changed, since networks already made from it would
  be stranded.
- **`log-driver: local`**, 10 MB per file, three files per container.
- **`live-restore: true`**.

**Why.** Every project makes several Docker networks. With Docker's defaults,
once the `172.17`–`172.31` ranges are used up it starts handing out
`192.168.x.0/20`, which is the most common home network range: the day a
beginner creates their fifth or sixth project, their machine can stop reaching
their own router. A fixed pool, checked against the machine's own routes, can
never do that. Small rotating logs keep an old laptop's disk from filling with
container logs. Live restore lets Docker itself be updated or restarted
without stopping every app.

## D17. What install.sh checks, and how it reports

*2026-09-27*

- **It refuses** anything that is not Debian 13 on x86-64, and anything not run
  as root, before it changes anything.
- **It warns, in plain language, and carries on** below 8 GB of memory and on a
  spinning system disk. The memory line is drawn at 7 GiB of `MemTotal`, because
  the kernel reports a little less than what is installed: an 8 GB machine shows
  about 7.6 GiB and must not be warned.
- **Every step says `changed` or `unchanged`**, and the last line says either
  what was installed and how many changes, or "Nothing changed". That is what
  makes idempotency visible rather than claimed.
- **It verifies Docker's signing key by its published fingerprint** before
  trusting Docker's repository.
- **It stops at the first failure** (rule 7), with the step, what went wrong, and
  what would have to be true; command output goes to a log only root can read,
  and the last lines are shown when something fails.
- **It ends by running `allvibe doctor`**, and fails if the doctor finds a
  problem, so a finished installation is a checked one.

#### Amendment, 2026-09-27 (item 5)

**install.sh fails only on problems with the installation itself.** Every
`doctor` check now has a scope, "install" or "data"; install.sh runs
`doctor --for-install`, which prints everything but exits 1 only for install
problems. Found when reinstalling on a host that had a project and no backup
disk yet: the installation had completed, and it was reported as failed
because `doctor` rightly flagged the missing backup target and the unconfirmed
recovery key. Those are about the data the host holds; they are still shown,
in plain language, and `doctor` on its own still exits 1 for them.

## D18. Projects are reached at the host's address and a port per environment

*2026-09-27*

From any machine on the LAN, a project's prod is
`http://<host address>:<port>` and its dev is the next port up. No DNS, router
or hosts file is edited anywhere.

- **One proxy, one port per environment.** Ports come from a range starting at
  8100: project slot *i* gets 8100+2*i* for prod and 8100+2*i*+1 for dev, 49
  projects in all, and the proxy's own health endpoint is 8199 on loopback.
  Ports are checked free on the host before a project gets them.
- **The apps publish nothing to the network.** Each app publishes its port on
  the host's loopback only (the prod or dev port plus 10000), where only the
  proxy, running on the host's network, reaches it.
- **IPv4 only.** The proxy listens on `0.0.0.0`, never on IPv6: a host with a
  global IPv6 address would otherwise be reachable from the internet with no
  router change at all. Publishing is a later brief's decision.
- **Prod refuses every container at its door.** Prod's server block denies every
  range Docker hands out on the host (its address pool and the default
  bridge's subnet, read from Docker when the block is written), so no
  container, dev or otherwise, reaches prod even the way a browser on the LAN
  does. Rule 1 therefore holds at the network level, not only by the absence
  of shared networks. Verified from inside a dev app: prod's containers do not
  resolve by name, time out by address, prod's loopback port refuses, and prod's
  front door answers 403 by the host's and by the LAN address, while dev's own
  door answers.

**Why.** An address and a port work from every device, every browser and every
network without anything configured anywhere, which is the whole requirement
for a beginner. Names are friendlier, but each way of getting them without
touching DNS has a catch: wildcard DNS services such as nip.io depend on a third
party and are blocked by many routers' rebinding protection, and multicast
names (`.local`) do not resolve the same way on every device. The panel, which
comes later, will link to projects, so nobody has to remember a port. Names can
be added in front of this without changing it.

**What the test host could not show:** reachability from *another* machine on the
LAN. Its ports are published on the workstation's loopback only. It is listed in
STATE.md under "To verify on real hardware".

## D19. The starter template is a guestbook in plain Node.js with one dependency

*2026-09-27*

A new project starts as a guestbook: one page, one form, one table
(`templates/guestbook/`). It is **Node.js 24 with `node:http`**, server-rendered
HTML, and **one dependency, the `pg` driver**, locked by `package-lock.json`. It
applies its own migrations at start (numbered SQL files, each applied once and
recorded, never edited afterwards), refuses to start without its database
password, and answers `GET /healthz` with `{"ok":true,"entries":N}` after
asking the database, which is the smoke check the suite runs. The page shows a
coloured "dev" or "prod" badge and the version.

**Why.** The template is what a beginner and their AI agent read first and build
on, so it should be as small as a real app can be: one file of server code that
fits on a screen, nothing hidden in a framework, and one dependency to keep up
to date. Node.js is the language of the suite too (D11). Postgres is the only
database (D10). A health endpoint that queries the database means "healthy"
and "can read its data" are the same thing, which is what a restore test
needs. Frameworks (Express, Next.js, Django) were rejected for the template,
not for projects: an agent can add one when a project needs it.

## D20. Creating a project puts the template's first commit into prod as v1

*2026-09-27*

`allvibe project create` builds dev from the working tree and prod from the
template's first commit, which becomes **v1** (a git tag and an image
`allvibe-<project>:v1`), both with an empty database. Every later version
reaches prod only through `allvibe release` (item 7), with its backup and
restore test (rule 2).

**Why.** A project needs a prod to be released to, and at creation there is no
data anywhere to protect, so there is nothing for a backup to hold. Starting
prod at v1 also gives the first release something to roll back to.

`allvibe project remove <name>` deletes a project with both its environments
and their data, and only with `--delete-everything`; without it, it lists
exactly what would go. Backups on the backup target are never touched. It
exists because a create that fails half-way must be retryable (rule 7 names
the failure; this is what the failure message tells you to run).

## D21. A project's secrets are files, never environment variables

*2026-09-27*

Each environment's database password is generated on the host (32 random
bytes), written to `/var/lib/allvibe/projects/<name>/secrets/<env>/db_password`,
and handed to that environment's containers as a Compose secret, mounted at
`/run/secrets/db_password`. The app and Postgres read the file
(`DATABASE_PASSWORD_FILE`, `POSTGRES_PASSWORD_FILE`). It is never printed.

**Why.** An environment variable shows up in `docker inspect`, in a process's
environment and in crash reports; a file mounted into the one container that
needs it does not (rule 4). The file itself is readable by any uid, because the
app runs as its image's own user and Compose cannot change a file secret's
owner outside Swarm; its directory is mode 0700 and belongs to the service
user, so on the host nothing else can reach it. Prod's password is never mounted
into anything of dev's.

## D22. A backup target must be provably off the machine

*2026-09-27*

`allvibe backup-target set <directory>` accepts a directory only if all of
these hold, and `backup` checks them again every time, because a disk that was
there yesterday may be unplugged today:

1. **It is not on the root filesystem.** An unplugged USB disk leaves its mount
   point behind as an empty directory on the root filesystem, so this also
   catches "the disk is not connected".
2. **A network filesystem** (NFS, SMB/CIFS, SSHFS and the like) **is off the
   machine** by definition, and passes.
3. **It is not on the same filesystem as Docker's data** (compared by device
   number), which is where every project's volumes are.
4. **It is not on the same physical disk** as the root or the data. The disks
   under a mount are found through `/sys/dev/block`, through partitions and
   through device-mapper layers (LVM, LUKS), so a second partition on the system
   disk is refused.
5. **It is a real disk**: a tmpfs or overlay that cannot be told apart from the
   machine is refused.
6. **The service user can write to it**, proven by writing and deleting a file
   as that user (CLAUDE.md, mistake 15).

The test host's `external-backup-mount` override (D14) declares exactly one
mount point a separate disk; nothing else is excused, and the root filesystem
never is. Without the override, the test host's backup volume is refused as
"on the same filesystem as the data", which is true: on the workstation every
Docker volume shares one virtual disk.

**Why.** Rule 2 says outside the machine's own disk, and the failure it guards
against is the one where the disk dies and takes the backups with it. So the
check asks the kernel where the bytes actually go, instead of trusting a path
that looks external.

## D23. What a backup is, and what a restore check proves

*2026-09-27*

**A backup** is one file and its manifest, in
`<target>/allvibe/<project>/`:

- `<project>-prod-<UTC time>.dump.age`: `pg_dump` in its custom format, run
  inside prod's own database container (so the client always matches the
  server), streamed into `age` and encrypted to the host key and the recovery key
  (D13). It is written as `.partial`, flushed and renamed.
- `<same name>.json`, written last: when, which release prod was running, what
  prod's own health check said just before (the entry count), the checksum, and
  the two public keys. A backup without a manifest is incomplete by definition.

Backups taken before a release go in `releases/` and are never pruned. Others
are pruned after 30 days (`backupRetentionDays`), by age and never the newest
three, and only files this code named.

**A restore check** takes a backup (the newest, or a named one), then:

1. checks its checksum and decrypts **the whole file** with the host key into a
   private temporary file, so a damaged backup fails before anything is
   restored;
2. starts a scratch Postgres of the same image on a scratch **internal**
   network, and restores into it with `pg_restore --no-owner --exit-on-error`;
3. starts **the version of the app the backup was taken from** against that
   copy, and asks the app's own `/healthz`, which reads the data;
4. removes the containers, the network and the decrypted file, whatever
   happened.

It reports the entry count from the restored copy beside the count prod
reported when the backup was taken. Nothing it creates shares a name, network
or volume with prod, so it cannot touch prod even by mistake.

**Why.** A dump that `pg_restore` accepts can still be useless to the app: the
right proof is the app itself reading the restored data. Decrypting before
restoring means `age`'s authentication covers every byte before any is used.

## D24. The daily backup is a systemd timer, and every run is recorded

*2026-09-27*

`allvibe-backup.timer` runs `allvibe-backup.service` every day at 03:30 plus
up to 30 random minutes, `Persistent=true` so a run missed while the machine was
off happens at the next boot. install.sh **enables and starts** it. The service
runs `allvibe scheduled-backup` as the service user: for each project, a backup
of prod and then a restore check of that very backup.

- **Each project is its own operation.** It stops at its first failure (rule 7),
  but one project's failure does not leave the others without a backup.
- **Every run is recorded** in `/var/lib/allvibe/runs/` with its steps, its
  result and, on failure, the reason (`allvibe runs` lists them), and the
  journal has the same output.
- **A failure is loud.** The service exits non-zero, systemd marks it failed,
  and `allvibe doctor` shows the last run's failed step as a problem.

**Why.** Vikt's backup schedule was a documented cron line for two passes, and
nothing ran it (Vikt D103). A timer that install.sh enables is running from the
first minute, and a record of every run, failed ones included, is the only way
to know that it still is.

## D25. A release is a commit that dev ran, behind a restorable backup

*2026-09-27*

`allvibe release <project>` runs these steps and stops at the first failure
(rule 7):

1. **Dev runs the commit being released, and answers its smoke check.** The
   repository has nothing uncommitted, and the image dev runs was built from
   exactly its HEAD. Otherwise dev's smoke check tested something other than
   what is about to be released (CLAUDE.md, mistake 4).
2. **The recovery key is confirmed** (D13): until it is, a backup cannot be
   restored anywhere but on this machine, which is not what rule 2 asks for.
3. **A fresh backup of prod**, on a target proven off the machine (D22), kept in
   `releases/` and never pruned, because it is what a data rollback needs.
4. **A restore check of that backup** (D23), in four steps.
5. **Prod built from dev's commit**, from `git archive` of the commit, never from
   the working tree, as `allvibe-<project>:v<N>`. Version numbers are never
   reused, even after a rollback.
6. **Prod deployed** on it, and 7. **prod answers its smoke check**.
8. **The version tag** `v<N>` on the commit, and the release recorded with its
   commit, its backup, and the version it replaced.

**If step 6 or 7 fails, prod goes back automatically** to the version it ran
before, keeping its data (D26), and the release is recorded as failed with
the outcome of the rollback. A crash loop counts as a failure at once, not
after a timeout, and the failure names the line the app printed about why.

`--dry-run` runs every check and changes nothing: dev, the recovery key, the
target, a restore check of the newest existing backup, the commit's Dockerfile,
prod's current answer, and whether the tag is free. What it would change, it
says it would.

**Commands for dev.** `allvibe dev deploy` rebuilds dev from its working tree;
`allvibe dev commit "<message>"` commits it. Both exist because a release is a
commit and dev must run it; the agent that comes later will use the same two.

## D26. Rollback keeps prod's data, and restoring data is a separate, confirmed choice

*2026-09-27*

`allvibe rollback <project>` goes back to **the version prod ran when the current
one was released** (recorded with each release; not simply the one before it
in the list, since after a rollback and a new release those differ). It changes
**only the code**: prod's data stays as it is, so nothing written since the
release is lost, and rule 8 has nothing to ask.

If the older version cannot run on today's data (a migration in the newer one
changed it in a way the old code cannot read), the rollback's smoke check
fails, it stops, and it says so, naming the other way:

- `allvibe rollback <project> --restore-data` also puts the data back, to the
  backup taken just before the current version was released. Without
  `--confirm-data-loss` it only says what would be lost: the time the data goes
  back to, and prod's entry count now against the backup's. With it, it
  **first takes a backup of prod as it is**, then replaces prod's database
  (dropped and created empty, then restored, so nothing mixes), then deploys the
  older version and checks it. Even a confirmed mistake is recoverable from that
  first backup.

**Why.** The common rollback is "the new code is wrong", and the data written
since the release is real (people signed the guestbook). Throwing it away
should never be the default and never happen silently (rule 8). A failed
migration inside a transaction leaves the schema as it was, which is why the
automatic rollback after a failed release keeps every entry.

**Verified on the test host:** a change released and prod's entries intact; a
release whose migration fails in prod (a unique constraint that prod's data
breaks and dev's does not) rolled back automatically with all entries; a manual
rollback; a release stopped at the backup step with the target unmounted, and
prod, images, tags and records unchanged; and a confirmed data rollback, after
which the entry written since the release was gone from prod and present in the
backup taken first.

## D27. The images the suite uses, pinned

*2026-09-27*

Every image the suite pulls is pinned by index digest, the tag beside it for
the reader (Vikt D138):

| Image | Used for |
|---|---|
| `postgres:18.6-alpine` | every project's database, and every restore check's scratch copy |
| `node:24.21.0-alpine` | the starter template's base (Node 24 is the current long-term release) |
| `nginxinc/nginx-unprivileged:1.30.5-alpine` | the reverse proxy, nginx's stable branch |
| `debian:trixie-20260918` | the test host only |

A project's own images are built on the host (`allvibe-<project>:dev` and
`:v<N>`), labelled with the project, the environment and the commit, and never
pulled from anywhere.

**Postgres 18** changed where its image keeps data: the volume is mounted at
`/var/lib/postgresql`, not `…/data` as with 17 and before. The compose file does
that. A restore check uses the image recorded in the backup's manifest, so a
backup is always restored by the Postgres that took it.

**Why pinned.** A tag is somebody else's name for an image, and can be moved
under an unchanged file (CLAUDE.md, mistake 11). Upgrading one of these is a
reviewed change to one line.

## D28. What the first brief deliberately leaves simple

*2026-09-27*

Recorded so they are decisions, not surprises:

- **No lock between operations.** The nightly backup and a release started at
  the same minute would both back up and restore-check; nothing would be lost,
  but the work would be done twice. A lock per project comes with the web UI,
  which will start operations people did not watch start.
- **Release images and release backups are kept.** Every `v<N>` image stays on
  the host and every release backup stays in `releases/`, because any of them
  may be what a rollback needs. Pruning them needs a rule for which rollbacks are
  still possible, and that comes when disk space on real hardware says it must.
- **The owner edits dev by hand, as the service user.** Until the agent
  container exists, a change in dev is a file edited on the host
  (`runuser -u allvibe -- …`), then `allvibe dev deploy` and `dev commit`.
- **Nothing is published to the internet**, and the proxy listens on IPv4 only
  (D18). Publishing, TLS and tunnels are later briefs.

## D29. The architect accepts D13, with two follow-ups

*2026-09-27. The architect's review of the first brief.*

D13 was a proposal: every backup encrypted to a host key and a recovery key,
the recovery key never printed, and confirmed before any release. **The
architect has accepted it as it stands.** Nothing in D13 changes.

Two follow-ups, for later briefs, are in [docs/roadmap.md](docs/roadmap.md),
marked Planned:

- **Keeping the recovery key once there is a web UI.** Today the owner copies a
  file off the machine by hand (docs/walkthrough.md, step 6). A beginner will
  instead get the key as a download and as a printable recovery sheet.
- **A lost recovery key.** A new key for future backups, with a clear warning
  that older backups open only with the old key. Today there is no way to
  replace it: `ensureRecoveryKey` makes one key, once (`src/lib/keys.ts`).

## D30. The architect accepts D18 for version 1

*2026-09-27. The architect's review of the first brief.*

D18, one port per environment on the host's address, with prod's front door
refusing every range Docker hands out, **is accepted for version 1**. Nothing in
D18 changes.

**Beginners should never type a port.** The control panel will show links to
each project's dev and prod, and names come with tunnels later. The port stays
what it is today, an implementation detail that something else presents.

## D31. The architect accepts D26, with a known gap in rollback

*2026-09-27. The architect's review of the first brief.*

D26, rollback keeps prod's data and restoring data needs `--restore-data
--confirm-data-loss`, **is accepted**, with a gap that is now known and
recorded.

**The gap.** Rolling back past a release whose migration *succeeded* runs old
code against a newer schema. Today `allvibe rollback` deploys the older version
on prod's current data and asks its health check; if the old code answers, the
rollback is reported as done (`codeRollbackSteps` in
`src/commands/release.ts`), even though the database now has tables or columns
that the old code was never written for. D26 already covers the two other
cases: a migration that failed left the schema as it was, and old code that
cannot read the data fails its smoke check, stops, and names `--restore-data`.

**What closes it**, in a later brief, Planned in
[docs/roadmap.md](docs/roadmap.md):

- **Releases record their schema version**, alongside the commit and the
  backup they already record.
- **Rollback explains, and offers `--restore-data`, when the database is newer
  than the version it goes back to**, instead of finding out only if a smoke
  check happens to fail.
- **A rule in the project template: within one release, migrations only add,
  never drop or rename**, so that the version before can still run on the
  schema after.

## D32. D15's Node.js 20 is a deliberate choice

*2026-09-27. Makes the reasoning of D15 explicit, at the architect's request;
D15 stays as it was written.*

**Upstream support for Node.js 20 ended on 2026-04-30** (the Node.js release
schedule). The CLI runs on Debian 13's own `nodejs` package, 20.19.2, and that
is deliberate: **Debian keeps patching its package for Debian 13's lifetime**,
through the same unattended security updates as the rest of the machine (D15).
The version number is upstream's; the maintenance is Debian's.

**What was checked, on 2026-09-27**, so this rests on more than the premise:

- Debian's security tracker lists `20.19.2+dfsg-1+deb13u3` in trixie-security,
  with fixes for 2026 CVEs backported into it.
- The same page lists six 2026 CVEs as still open for trixie, fixed in forky and
  sid, which carry Node.js 24. **Debian's patches reach trixie when its security
  team backports them, not when upstream releases a fix.**
- Debian 13's release notes, section 5.2.3, name the packages whose security
  support is limited: browser engines, and Go and Rust packages. Node.js is not
  among them.

**Why that is enough here.** The host's Node.js runs only this CLI, which uses
Node's standard library alone (D15), opens no network port, and is started by
the owner or by the backup timer as the service user. The apps themselves run
in their own containers on Node.js 24 (D19, D27), which is not the host's.
install.sh requires Node.js 20 or later rather than exactly 20, so a newer
Debian package works unchanged.

**Revisit** when Debian's security support for `nodejs` in Debian 13 ends or
becomes limited, or when the CLI needs something Node.js 20 does not have.

## D33. The website's promises are planned here, or they come off the website

*2026-09-27. The architect's review of the website.*

The website's main page promised six things this repository did not have, not
even as planned: a key vault, the control panel at `allvibe.local`, an installer
on a USB stick, disk health warnings, a monthly check-up, and moving to a new
computer. **All six stay, as Planned**, and are now entries in
[docs/roadmap.md](docs/roadmap.md), each with its reason. The review added two
more: **full disk encryption offered at install**, and **a decision about the
control panel's runtime** before it is built.

- `allvibe.local` names the machine, for the control panel, with its address as
  the fallback. Projects keep one port per environment on the host's address,
  as D18 and D30 decided.
- The website may never claim more than this repository supports, at least as
  Planned. Its main page says so in one line, and links to its technical page,
  which shows what is built and what is planned.

**Why.** A promise on the website that nobody has written down here is a promise
nobody is working towards. Writing it down makes it either a plan or a
correction.

## D34. The agent is the vendor's own tool, and the suite stays out of the user's AI account

*2026-09-28. The architect's second review of the website.*

The website promised five things this repository did not support at all. They
are now entries in [docs/roadmap.md](docs/roadmap.md), all Planned, and the
README says who makes the project:

- **Agent adapters.** The coding agent in dev is an official, unmodified vendor
  tool, installed in the dev container, signed in through the vendor's own
  flow, and shown as an interactive session in the web interface. Claude Code
  comes first, with the user's own API key; signing in with a Claude
  subscription only after Anthropic confirms in writing that the setup is
  permitted (asked on 2026-09-28). Then OpenAI's Codex CLI, GitHub's Copilot
  CLI, and Google's agent once its move from Gemini CLI to Antigravity CLI has
  settled, each after its vendor's terms are confirmed. Shared instructions live
  in `AGENTS.md`, with `CLAUDE.md` pointing to it.
- **The suite never collects, reads, stores or proxies subscription credentials
  or tokens, and never pays for, resells or intermediates AI usage**, now or in
  any paid version. This is a rule for every later decision, not only for the
  first adapter.
- **A guided plan**: a short numbered plan with a check the user can try at
  every step, and the agent stopping after each.
- **Sign-in and invitations**: private by default. Today, under D18, any machine
  on the home network can reach a project without signing in; this closes that.
- **The team version**, after version 1. It does not contradict "several users
  per machine" being outside version 1.
- **Credit**: the README says that All vibe no cry is made by Lundstream. That
  is a fact today, not a plan, so it is in the README and not in the roadmap.

**Why.** Same as D33: a promise on the website is either a plan written down
here or a correction on the website. The rule about AI accounts is written as a
rule because it is what a user has to be able to trust about software that runs
their coding agent: their account and their bill stay theirs.

## D35. Releases know their schema, and a rollback never crosses a breaking migration by code alone

*2026-09-28. The second brief, item 1. Closes the gap recorded in D31.*

**The schema is a list of file names.** A project's migrations are the numbered
SQL files in `migrations/`, each applied once, in name order, and recorded by
file name in the database's `schema_migrations` table (D19). So the schema a
database *has* is read from that table, and the schema a version of the code
*knows* is the list of files in its commit, read from git. Every release now
records the schema prod ran with once it was up (`schema` in `project.json`:
the newest migration and the whole list, asked of the database), and v1 records
its own at creation. `project status` shows each database's.

**Every migration is additive or breaking** (`src/lib/migrations.ts`):

- *Additive*: new tables, indexes that are not unique, new columns that are
  nullable or have a default and no constraint, new views, sequences, types,
  functions, comments, and inserted rows. The code before it runs on the
  schema after it, because nothing it reads or writes has changed.
- *Breaking*: anything that drops, renames, changes a type, adds a constraint
  the rows already there may violate (a unique index, `add constraint`, a
  `not null` column without a default), rewrites or deletes rows, replaces
  something that exists, or runs code (`do`). **And anything the classifier
  does not recognise**: a statement it cannot read with certainty is breaking,
  never additive.

The file is split into statements the way Postgres reads it (quotes, dollar
quotes and nested comments included), so a keyword inside a string decides
nothing.

**A breaking migration is released only when its file says so**, on a line of
its own: `-- breaking: <what it changes>`. That line is the user's agreement,
written where the change is and kept in the history. The release checks, as
its second step and before anything changes:

- every migration prod's version had is still there, unchanged (a migration
  that has run is never edited or removed: a change is a new file);
- every new migration is additive, or breaking and marked.

Otherwise it stops, names the file and the statement, and says how to mark it
if the change is agreed.

**A rollback asks prod's database** which migrations it has that the version
being gone back to does not know, and reads each from the release that first
brought it:

- none, or only additive ones: the old code runs on the newer schema, and the
  rollback goes ahead, saying which migrations it runs past;
- any breaking one: it **stops before deploying anything**, names the
  migration and why it is breaking, and points to `--restore-data`, which says
  what would be lost and needs `--confirm-data-loss` as before (D26). A
  migration whose file cannot be found in any release counts as breaking.

So a rollback never reports success while old code runs on a schema it was not
written for. The smoke check after a rollback stays, as the last word.

**A release that fails after its breaking migration has run** cannot be undone
by code alone either. Its automatic rollback stops at the same check, and prod
stays on the failed version, not answering. That is recorded in the project
(`failed`), so that `allvibe rollback --restore-data` goes back from that
release with **the backup it took**, not the one before, and `project status`
says so. Putting the data back is never automatic, even here (rule 8): prod
took writes during the release's restore check.

**Verified on the test host**, on one project: an additive migration released
and rolled back, with every entry and the new column's data still there; a
rename without the mark refused at step 2 with the host's state unchanged; the
same rename marked, released, its code rollback refused with the explanation,
and `--restore-data --confirm-data-loss` working as before; and a marked
breaking release whose app then failed in prod, its automatic rollback
refused, and a data rollback that restored that release's own backup.

**Instead.** Running the old code and trusting its smoke check, which is what
D31 found wanting: a health check that passes says nothing about the queries it
did not run. Asking the database for a schema diff: it would say what changed,
not whether the old code can live with it, and it would need a database of the
old version to compare against.

## D36. Every new project starts with AGENTS.md, and the guided plan is in it

*2026-09-28. The second brief, item 2. Builds the roadmap's "guided plan" as
instructions.*

`allvibe project create` gives every new project four documents of its own,
from the template, with the project's name, the command and the date filled in:

- **`AGENTS.md`**: the instructions for any coding agent, in the cross-tool
  standard's file (D34). In plain words: turn the user's idea into a short
  numbered plan in which every step has a check the user can try themselves;
  build one step at a time; after each step commit, give the check, ask the
  user to deploy dev and try it, and stop until they say it works; keep
  `STATE.md` and `DECISIONS.md` current; write only additive migrations, and a
  breaking one only when the user agrees, marked in the file (D35); never put a
  secret in code, and read keys from the files the key vault provides (D37);
  explain everything to a beginner without jargon. It also says where the
  agent works (dev, by the names of its app and database) and that prod is out
  of its reach, and that `/healthz` must keep answering.
- **`CLAUDE.md`**: says the instructions are in `AGENTS.md`, and imports it
  (`@AGENTS.md`, Claude Code's own syntax), so Claude Code reads them without
  a second copy that could drift.
- **`STATE.md`** (what the app does, the plan, done, next, waiting for you) and
  **`DECISIONS.md`** (append-only, starting with D1: the guestbook), the
  project's own, in the same shape as this repository's.

A placeholder with no value stops the creation instead of being left in a
file. **Existing projects are not changed**: the documents are written only
when a project is created.

**Why.** The guided plan is rule 6 of this repository applied to the apps
people build: a step is done when a person has tried it. The agent is the
vendor's unmodified tool (D34), so the suite shapes how it works the way any
project would, through the instructions file it reads. The agent cannot deploy
(it has no Docker, D39), so stopping after each step and asking the user to
deploy dev and try it is also simply how the work flows.

**What it cannot guarantee.** Instructions are followed by the agent, not
enforced by the suite: an agent can still do two steps at once. What *is*
enforced sits where the agent cannot reach it: the release's migration check
(D35), the key check before every commit (D38), and prod out of reach (rule 1).

## D37. The key vault: encrypted to D13's two keys, files in memory for the apps, and in every backup

*2026-09-28. The second brief, item 3. Builds the roadmap's "key vault".*

`allvibe key set <project> <scope> <NAME>` reads the value from standard input
(never an argument, and it refuses a terminal: nothing prompts, rule 4);
`key list` shows names, scopes and when each changed, never values; `key
remove` deletes one.

**Scopes: dev, prod and agent.** Dev and prod have separate values, and each
environment's containers get only their own scope's keys, so prod's keys are
never in anything of dev's. The third scope is the project's coding agent's
own (D39): its AI key goes to the agent container and to nothing else, not
even dev's app.

**At rest, encrypted to the two keys D13 already has.** Each value is a file
in `/var/lib/allvibe/projects/<project>/vault/<scope>/<NAME>.age`, encrypted
with `age` to the host key and to the recovery key, the same recipients as
every backup; the value reaches `age` on standard input. The host key lets the
suite hand values to apps without anyone present; the recovery key lets a
machine restored from it get its keys back. **No new key exists**, so there is
nothing new to lose, confirm or keep, and D13's promise (the recovery key and
nothing else restores a machine) now covers the keys too.

**In use, in memory, as files.** When an environment is deployed, its keys are
decrypted into `/run/allvibe/keys/<project>/<scope>/`, which is a tmpfs, and
each is mounted into its app as a Compose file secret at `/run/secrets/<NAME>`,
exactly as the database password is (D21: the file readable inside its
container, its directories the service user's alone). The app finds the path,
never the value, in `<NAME>_FILE`. Nothing puts a value in an environment
variable, so `docker inspect` shows paths only. A tmpfs is gone at every
shutdown, so **`allvibe-keys.service`** (install.sh, enabled) decrypts every
key again at boot, **before Docker** starts the apps; `doctor` reports it. A
file whose value is unchanged is not rewritten, so a running app keeps reading
the same file.

**A key reaches its app at once.** `key set` and `key remove` start the
environment's app again on the image it runs. If it does not come up healthy
with a new value, the old value is put back (or a new key removed) and the app
started on that, so a key change never leaves an app down.

**In every backup.** A backup is now the database dump and, when the project
has keys, the vault beside it: a tar of the vault's files, encrypted again to
the same two keys, so the backup disk does not even show which keys there are.
The manifest lists them. The restore check gains a step: the vault's file is
whole, decrypts with the host key, unpacks, and every value in it decrypts,
into memory, never shown; the names must be the manifest's. The scratch app of
a restore check gets prod's keys as files, as prod does, on its network with
no route out.

**Verified on the test host:** set, list and remove, and the refusals (a value
as an argument, a terminal on standard input, a bad name, a bad scope); three
random values, counted in every command output and run record, the journal,
the install log, `docker inspect` and the logs of every container, every
process's arguments and environment, the project's repository and its whole
history, the vault's files and the backup target: 0 each, while the copies in
memory, counted the same way, were found; from inside dev's app, dev's value
and not prod's or the agent's, and no mount of prod's keys; a restore check
restoring all three; the backup's vault opened with the recovery key alone,
each value the one that was set; and a restart of the test host, after which
the unit had run before Docker and both apps came back healthy with their
keys.

**Instead.** Environment variables (visible in `docker inspect`, D21). A
plaintext copy on disk for Compose, as the database password has: it would not
be encrypted at rest. A key of the vault's own: one more thing to lose, and a
restored machine would need it as well as the recovery key.

## D38. The key check before every commit: a pre-commit hook with the scanner CI uses

*2026-09-28. The second brief, item 4.*

Every project's git repository has a **pre-commit hook** that runs a pinned
secret scanner over what is about to be committed, and stops the commit if
anything looks like a key.

- **The scanner is gitleaks 8.30.1**, from the same image, pinned by the same
  digest, as this repository's own CI (D6). `setup` takes the binary out of
  that image once, into `/var/lib/allvibe/tools/`, and checks it against its
  own pinned checksum, so what runs is pinned twice. The agent's image copies
  it from the same image (D39).
- **The hook is in `.git/hooks`**, written by `project create` right after
  `git init` (so even the template's first commit is checked), by `setup` into
  every existing project, and again by every `dev commit`. It is a line of
  shell that runs a small checker beside it (`allvibe-key-check.cjs`: the
  project's `package.json` says ES modules, and `.cjs` keeps the checker's
  kind of module certain). Because it lives in the repository, it runs for the
  user's commits on the host and for the agent's in its container, which
  mounts the same working copy.
- **It says where, never what.** gitleaks runs with `--redact` and its own
  output is not shown; the checker reads only the file, the line and the kind
  of key from its report, and says in plain words to put the key in the vault
  instead. `dev commit` shows that message as the step's reason, and unstages
  the change so the next commit does not carry it by accident.
- **It fails closed.** If the scanner is missing, or does not finish, the
  commit stops and says so.

**What it does not do.** A commit made with `--no-verify`, or after the hook
has been edited, is not checked: the hook guards against mistakes, not against
someone determined to commit a key. AGENTS.md tells the agent never to skip
it. A staged file's content is written into git's object store before any
hook runs, so a blocked commit leaves an unreferenced copy there until git's
own cleanup, or `git prune`, removes it; it is in no commit and nothing sends
it anywhere. The key check before push, with the GitHub integration, will scan
the history again, where it matters.

**Verified on the test host**, in a scratch project, with a fake key made at
random in the shape of an Anthropic API key: `dev commit` and a plain
`git commit` (as the agent commits) both stopped, naming `config.js, line 1`
and the kind of key, never the value; the key in no commit, and, once the
staged copy was unstaged and pruned, in no object at all; a clean commit
passed; and with the scanner taken away, the commit stopped instead of passing.
