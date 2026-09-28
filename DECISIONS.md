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

#### Amendment, 2026-09-29 (D57)

A rollback by code now takes a fresh backup of prod and restore-checks it
first, like a release, and stops at the first failure without changing
anything (D57).

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

#### Amendment, 2026-09-28 (D42)

"Proxies" in the rule above means handling credentials: receiving, holding,
forwarding, injecting or reading them, or standing in the user's account. A
network egress filter that only lets an encrypted connection through to a
vendor's host, cannot read it, and handles no credentials, as the agent's
egress gate does (D39), is not a proxy in this sense. D42 draws the line.

#### Amendment, 2026-09-28 (D46, D47, D48)

Signing in with a Claude subscription no longer waits for Anthropic's written
confirmation: the architect decided it on Anthropic's published text, with
conditions the suite enforces (D46), and revisits it if Anthropic answers or
the text changes. The rule above stands unchanged: the suite still never
collects, reads, stores or proxies the login, which stays in the agent's
memory, and never runs Claude Code on the person's behalf (D48).

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

## D39. The agent container: Claude Code, unmodified, on dev's network, with one way out

*2026-09-28. The second brief, item 5. Builds the first of the roadmap's "agent
adapters" (D34), with an API key only.*

`allvibe agent start <project>` runs the official, unmodified Claude Code in a
container of its own; `allvibe agent shell <project>` opens Claude Code's own
interactive session in it (or, with `-- <command>`, runs a command there);
`allvibe agent stop <project>` removes it. `project status` shows whether it
runs, and `project remove` removes it first.

**The image** (`agent/`, in the bundle) is built on the host, for the service
user's uid, never pulled: Node 24 on Debian 13 (`node:24.21.0-trixie-slim`,
pinned by digest), git from Debian for its commits, the key check's scanner
copied from its pinned image (D38), and Claude Code **2.1.283 installed with
`npm ci` from a lock file**, so npm checks the integrity hash of the package
and of its native binary. Claude Code is not changed in any way. Its own
settings are used as documented: `DISABLE_AUTOUPDATER` (the pinned version
stays the version) and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (no
telemetry or error reports, so its only traffic is to the model's API).

**Its key comes from the vault only**, from the vault's own `agent` scope
(D37): the decrypted copy in memory is mounted as one read-only file, and the
container's start writes Claude Code's user settings with `apiKeyHelper`
reading that file, the way Claude Code documents for API keys. So the key is
never an environment variable and `docker inspect` shows only the file's path.
Nothing else gets this key, not even dev's app. It is a user setting, not a
managed one: every one of Claude Code's own ways of signing in stays as it is.

**What the container has** (`agentRunArgs`, checked by unit tests):

- **One network: dev's internal network**, where the dev app and the dev
  database are. That network has no route out.
- **One way out: the egress gate** (`agent/egress.mjs`, on the pinned Node
  image the template uses), which sits on dev's network and on one of its own
  that reaches the internet. It passes a `CONNECT` to `api.anthropic.com`
  port 443 when the name resolves to public addresses only, and refuses
  everything else with 403, logging the host name. What passes is TLS between
  Claude Code and the API, which the gate cannot read. Claude Code uses it
  through `HTTPS_PROXY`, as it documents for proxies.
- **One working copy**, the project's repository, read-write, and the key file,
  read-only. Its home and `/tmp` are in memory; its root filesystem is
  read-only.
- **The service user's uid and gid**, not root, so what it writes belongs to the
  same owner as everything else there; no capabilities, no new privileges;
  2 GB of memory, 2 CPUs, 512 processes; never restarted on its own.
- **None of rule 12's**: no Docker socket (so the agent cannot deploy: it asks
  the user to, D36), not the host's network, not privileged, no host key,
  recovery key, backup target, or anything of prod's.

**Why a gate, and not a firewall rule.** The CLI runs as the service user
(D15), which cannot change the host's firewall, and a rule that keeps a
container from the home network would have to be kept in step with Docker's
own rules across restarts and upgrades. A gate is one small program the suite
owns, its allow list is one line, and its log says what was refused.

**Subscription sign-in is not built** (D34): the gate's allow list is the API
host alone, so no subscription traffic passes through anything of the suite's.
When Anthropic confirms the setup in writing, the sign-in hosts are added to
the list. Nothing in Claude Code is changed either way.

**Verified on the test host**, from inside the agent container: prod's
containers do not resolve by name; prod's database and app are unreachable by
address; prod's front door answers 403 through the dev network's gateway and
is unreachable by the host's own address, and the gate refuses it; the host's
loopback ports are refused; the Docker socket, `/etc/allvibe` with both keys,
the backup target, `/var/lib/allvibe` and `/run/allvibe` are absent, no file
holds an age private key, and no secret file holds prod's or dev's key value;
the host's address and the router are unreachable, and the gate refuses them;
`api.anthropic.com` does not resolve directly, and another internet host is
refused, while through the gate the API answers over TLS; the dev app answers
and the dev database accepts connections. `claude --version` answers 2.1.283.
Its own commits go through the key check: a fake key is stopped and a clean
commit is made. A `dev deploy` while it runs leaves it on dev's network.

**Known limits.** Through its network's gateway the container can open a
connection to any port the host itself listens on at every address: on the
test host that is the proxy's doors, where prod answers 403 and dev answers,
and nothing else; on a real machine it would also be, for example, SSH, which
would still ask for a key. It is listed under "To verify on real hardware". The
interactive session, and Claude Code talking to the API through the gate,
have not been tried by a person (item 7 needs a real key).

#### Amendment, 2026-09-28 (D41, D42)

The architect accepted the gate as a **network egress filter, not a proxy of
credentials** in D34's sense: it tunnels encrypted traffic it cannot read, to
`api.anthropic.com` only, and handles no credentials. D42 records the line it
must stay on. The known limit above did not stand: D41 closes it, for every
project container, not only the agent; since D41, prod's door is refused to
the agent by the firewall before nginx answers 403.

#### Amendment, 2026-09-28 (D46, D47, D48)

"Subscription sign-in is not built" no longer holds: `--sign-in account` runs
the same container for the person to sign in to their own Claude account, and
the gate then passes the two sign-in hosts as well (D46). The permission mode
is now set explicitly to auto in both ways of signing in (D47), and the
container may use no swap.

## D40. The control panel will run in a container on a pinned official Node 24 image

*2026-09-28. The second brief, item 6. A decision made now, for the brief that
builds the control panel; nothing is built by it. Settles the roadmap's "The
control panel's runtime".*

**The control panel runs in a container, on the official `node` image at a
Node.js 24 release, pinned by index digest** (D27), like every image the suite
uses, and updated through the monthly check-up once that exists. It does not
run on the host's Node.js.

**Why.** The host's Node.js is Debian 13's `nodejs` package, 20.19.2, and D32
records why that is right for the CLI: on 2026-09-27 Debian's security tracker
listed six 2026 CVEs still open for Node.js 20 in Debian 13, fixed only in
newer Debian releases, which carry Node.js 24. Debian's patches reach Debian
13 when its security team backports them, not when upstream releases a fix.
That is acceptable for a command-line tool that listens on no port and is
started by the owner or the backup timer. **It is not acceptable for a web
server**, which is what the panel is: it listens on the network, parses what
any browser on the home network sends it, and is the one place the whole
machine is driven from. Its runtime has to be the one that gets fixes first,
and a pinned official image of the current long-term release is that, updated
as one reviewed line (D27).

**What stays.** The CLI keeps running on Debian's Node.js (D15, D32): the
panel calls the CLI, the engine (rule 5), so the operations themselves do not
move. A container also gives the panel the same boundaries as everything else
the suite runs, and rule 3 still holds: it is never exposed directly to the
internet.

**Instead.** The panel on the host's Node.js 20, which D32 already rules out
for anything that listens. NodeSource's repository for a newer Node.js on the
host (D15 rejected it: another repository and signing key to trust, on its
schedule rather than Debian's), which would also change the CLI's runtime for
no gain to it.

## D41. Project containers are kept off the machine's own ports and the home network

*2026-09-28. The third brief, item 1. Closes the limit D39 recorded, and more:
the architect's review found it wider than D39 said.*

**The gap.** Through its network's gateway, any project container could open a
connection to any port the host itself listens on, and, through the host's
routing, to the router and every other device on the home network. Not only the
agent: dev's app runs code the agent wrote, and even a database on an internal
network reached the host through that network's gateway. Measured on the test
host before this change, with an SSH server, one other service and a stand-in
device on the home network: 24 of the probe's 59 checks were reachable that
must not be, from dev's and prod's apps and databases alike.

**The rules.** `firewall.sh`, installed as `/usr/local/sbin/allvibe-firewall` and
run as root, keys on the suite's own address pools (D16), from which every
project container, and nothing else on the machine, takes its address:

- **`ALLVIBE-FWD`, the first rule of Docker's `DOCKER-USER` chain**, for traffic
  the machine routes. Between two addresses of the pools it returns to Docker's
  own rules (a container reaches its own network's containers, and no others:
  rule 1 stays Docker's to enforce, as before). From the pools to any private
  range (10/8, 172.16/12, 192.168/16), link-local (169.254/16), the shared
  range carriers and VPNs use (100.64/10) and multicast, it is refused. The
  public internet stays reachable.
- **`ALLVIBE-IN`, the first rule of `INPUT`**, for traffic to the machine
  itself: every new connection from the pools is refused, whatever the port and
  whichever of the machine's addresses. Replies to the machine's own
  connections pass (the proxy reaching an app, the CLI's checks), and nothing
  from anywhere else is touched, so other machines on the home network reach
  the proxy's doors exactly as before.
- **Refused, not dropped**: a connection fails at once (`ECONNREFUSED`,
  `EHOSTUNREACH`) instead of hanging, which is kinder to an app and makes every
  probe fast.

**DNS needs no exception.** Docker's embedded DNS asks the machine's resolver
from the machine's own network namespace, not the container's: on the test
host, with every rule in place, names asked for the first time resolved while
the rules' reject counters stayed at 0. If a later Docker changed that, apps
would fail to resolve names (it fails closed), and the probes' check of the
public internet would say so.

**Kept in place**, since the CLI, as the service user, cannot touch the
firewall (D15, D39):

- `allvibe-firewall.service` applies them **before Docker at every boot**, so no
  container ever starts without them; it is **part of Docker**, so it applies
  them again whenever Docker is restarted; and Docker itself wants it.
- `allvibe-firewall-check.service` checks them, and **puts back** anything
  missing, as soon as Docker is up and every five minutes (a timer). Each
  check writes what it found to `/run/allvibe/firewall.json`.
- **`doctor`** reads that and says, in plain words, that project containers
  cannot reach this machine's own ports or the home network, when that was last
  checked, and whether anything had to be put back; or that they are NOT in
  place, what is missing, and the one command that puts them back. It is an
  installation problem, so install.sh fails on it.
- install.sh (a thirteenth step) writes the pool into
  `/etc/allvibe/firewall.conf`, installs the script and the units, and applies
  the rules; a second run changes nothing.

prod's front door still denies every Docker range (D18) as a second line; a
container is now refused by the firewall before nginx is asked.

**Verified on the test host**, with an SSH server, a service on another port
and a stand-in device on the home network (`test/host/lan-fixtures.sh`):
`test/host/app-isolation.sh` (dev's and prod's apps and databases) 59 of 59
as they must be, and `test/host/agent-isolation.sh` (the agent and its egress
gate) 50 of 50: the machine's SSH and other service by its address and by
every gateway, prod's door, the apps' loopback ports, the router, the device
and a link-local address all refused; the public internet reached from the
apps, and the API from the gate; each app reading its own database, the
agent reaching its dev app, database and gate, and the doors answering the
machine and the device. The same after the test host restarted, and after
Docker restarted. And the check put back a rule removed by hand, with doctor
saying so first.

**An app that genuinely needs a device on the home network** (a printer, a
smart plug) would need, later, an explicit opt-in per app, not built now: the
owner names the app, its environment and the one address and port, the suite
adds a rule for that app's network to that one destination ahead of the
refusals, prod's needs a confirmation, and the panel shows it on its map of
what can reach what. The machine itself stays refused to every container,
opt-in or not.

**Not covered.** IPv6: the suite's networks have none, so there is nothing to
filter. A container on a network the suite did not make (Docker's default
bridge, which image builds use) is not a project container and is not
covered; nothing the suite runs for a project is on it.

**Instead.** A rule per container or per network, which would have to follow
every create and remove; the pools are fixed at install and never change
(D16). The CLI managing the firewall: it runs as the service user. Dropping
instead of refusing: slower failures, and no difference in what gets through.

#### Amendment, 2026-09-28 (D49)

The architect accepted D41, and five minutes for its check. Not filtering IPv6
is accepted only while it stays true, so `allvibe doctor` now checks that no
network in the suite's address pools has IPv6 on, and says so plainly when one
does (D49).

## D42. The egress gate is a network filter, and the suite still never proxies credentials

*2026-09-28. The third brief, item 2. The architect's review of the second
brief; D34 and D39 carry a note pointing here.*

**D34's rule** says the suite never collects, reads, stores or proxies
subscription credentials or tokens, and never pays for, resells or
intermediates AI usage. **D39's egress gate** passes the agent's connections to
`api.anthropic.com`. Read side by side, the gate could look like a proxy. It is
not one in D34's sense, and this is where the line runs.

**A proxy of credentials** handles them: it receives, holds, forwards, injects or
reads a credential or a token, terminates the encrypted connection so that it
can see inside it, or stands in the user's account towards the vendor. D34
forbids all of that, now and in any paid version.

**A network egress filter** decides only whether a connection may open, and to
where. The gate does that and nothing else:

- it passes a `CONNECT` to port 443 of the one allowed host, when the name
  resolves to public addresses only, and refuses everything else;
- what passes is TLS between Claude Code and the API, end to end: the gate
  cannot read it, and it never terminates, inspects or changes it;
- it handles no credentials: the API key goes from the vault's file (D37) into
  Claude Code, and from there, encrypted, to the API; the gate never sees it;
- it logs host names and ports, and nothing else.

**The line it stays on.** If the gate ever had to terminate TLS, read or change
what passes, add or hold a credential, or log more than hosts and ports, it
would no longer be a filter, and that would be a new decision against D34, for
the architect. The same holds for anything else the suite puts between a user
and a vendor.

**Subscription sign-in**, when Anthropic confirms it (D34), would add the
sign-in hosts to the gate's allow list and pass them in the same way: the
suite would still handle no credential. Likewise for later adapters' hosts.

#### Amendment, 2026-09-28 (D46)

Subscription sign-in is now built, on the architect's decision rather than
Anthropic's confirmation (D46): with an account, the gate passes
`claude.ai` and `platform.claude.com` besides the API, in exactly the way
above, and handles no credential.

## D43. A finding: buying API credits asked a private person for a VAT number

*2026-09-28. The third brief, item 3. A finding, recorded so that later
decisions rest on it; nothing is built by it.*

**What happened.** When the owner, buying as a private person in the EU, tried
to buy API credits on the Claude Developer Platform, it asked for a VAT number,
which a private person does not have. So the owner could not buy credits, and
`ALLVIBE_TEST_ANTHROPIC_API_KEY` is deliberately not set.

**Not verified:** whether this applies to every private person in the EU, or
only to this case. It is one observation, not a policy anyone has confirmed.

**If it does apply**, the "own API key" path the first adapter was built on
(D34, D39) is out of reach for much of the suite's audience, who are private
people. Then two paths matter far more than they did:

- **signing in with a Claude subscription**, which waits for Anthropic's written
  confirmation (D34, asked on 2026-09-28);
- **adapters that use a subscription the user already has**, through that
  vendor's own client, above all the MCP bridge (D44).

**The live agent test** (the second brief's item 7) waits for either API credits
or a confirmed subscription path. Until then no real key is used, and Claude
Code has not talked to the model through the suite.

#### Amendment, 2026-09-28 (D46)

The subscription path is now decided on Anthropic's published text (D46), so
the live agent test can be the owner signing in to their own Claude account in
the agent (walkthrough step 23), without API credits.

## D44. The MCP bridge is the second adapter, ahead of Codex

*2026-09-28. The third brief, item 3. A plan, in docs/roadmap.md; nothing is
built by it. Changes the order of D34's later adapters.*

**The bridge.** The machine runs an MCP server, and the user works with the AI
client they already pay for, signed in through its vendor's own flow. The suite
handles no AI credentials at all: not a key, not a token, not a sign-in (D34,
D42). That is why it comes second, **ahead of OpenAI's Codex CLI**, and why the
finding in D43 makes it matter more.

**What its tools can do, and what they cannot:**

- **Dev only**: read and write files in dev's working copy, deploy to dev, run
  the checks, read dev's logs, and commit, through the key check (D38).
- **Never a release.** The bridge can only propose one; the person releases it
  in the panel, where the backup and the restore check happen (rule 2).
- **Everything visible**: every tool call is logged and shown to the person.
- **The method goes with it**: AGENTS.md and the guided plan (D36) are served as
  MCP resources and prompts. What matters most, dev only, the key check and
  additive migrations (D35), is **enforced by the tools**, not only asked for
  in instructions.

**Local clients first**, on the home network: Claude Code, Claude Desktop through
a small local bridge, VS Code, Cursor. **Cloud connectors** that call in from
outside would need the machine reachable from the internet, which rule 3
forbids for the panel; they come later, if ever, and only behind strong
sign-in.

**Two roles.** The user's chat client can take the architect's role (D45) and a
coding client the builder's, both through the same bridge, each with its own
tools.

## D45. Three more plans: two modes in the panel, a bug report builder, and the architect

*2026-09-28. The third brief, item 3. Plans, each in docs/roadmap.md; nothing is
built by them.*

- **Two modes in the control panel.** A simple mode for beginners, and "Show
  what's under the hood" for people who want details and finer control: a
  deeper layer of the same panel, which can never bypass the safety net
  silently. It shows (containers, logs, resources, files and code, each step's
  diff, migrations with their class, release logs, backup details, the agent's
  sessions, a live map of which containers can reach what), and it controls
  within the safety net (templates, resource limits, the backup schedule and
  extra targets, the choice of agent, a terminal into dev but never into prod,
  a read-only view of prod's database). Ideas kept for it: "Load safe
  defaults", ready-made profiles, an "Explain this" button that asks the AI to
  explain a detail in plain words, a preview of what every advanced action will
  change before it runs, a resource budget per app, and exporting an app.
- **A bug report builder**, in the test copy only, never in prod: area
  screenshots with marks, guided questions (what did you do, what did you
  expect, what happened instead), and the context gathered by itself (the
  browser console's errors, failed requests, dev's server log for the same
  time, the version and the plan's step), bundled into one report file with its
  images, in the project. The agent reproduces the problem first, then fixes
  it, then stops for the person to try again.
- **The architect**, a second role the person talks to: it turns an idea into a
  brief with a check for every step, and reviews the builder's report against
  the brief in plain words (what was built, what to try, what it is unsure
  about), sized to the change, so a small change gets a small plan. It can be a
  second, read-only Claude Code session with its own instructions that may only
  write briefs, and later another vendor's agent, for a second opinion.

**Why these are plans.** Each came from the architect's review of the second
brief, and each rests on what the suite already has: the panel's runtime (D40),
dev and prod kept apart (rule 1), the guided plan (D36), and the agent in dev
(D39). Writing them down makes them plans rather than promises.

## D46. The agent may sign in with the person's own Claude account

*2026-09-28. The fourth brief, item 1. The architect's decision, on what the
owner found by hand and on Anthropic's published text. It changes D34's
condition for subscription sign-in; D34, D39 and D42 carry a note pointing
here.*

**What the owner found by hand.** The official, unmodified Claude Code 2.1.283,
in a plain Node 24 container, signed in with the owner's own Claude
subscription through Claude Code's own flow: a web address opened in the
owner's own browser, and a code pasted back. It worked on Claude Max.

**Anthropic's published text.** Read on 2026-09-28 at
https://code.claude.com/docs/en/legal-and-compliance ("Legal and compliance";
the page shows no date of its own). Quoted exactly; the links in the original
are left out, their words kept.

From "Usage policy", "Authentication and credential use":

> **Developers** building products or services that interact with Claude's
> capabilities, including those using the Agent SDK, should use API key
> authentication through Claude Console or a supported cloud provider.
> Anthropic does not permit third-party developers to offer Claude.ai login
> into their own applications, or to route requests through Free, Pro, or Max
> plan credentials on behalf of their users. Moreover, developers may not
> collect, store, or intermediate Claude.ai credentials or session tokens —
> sign-in to a Claude account must complete through Anthropic's own flow.
>
> This does not restrict how customers provision and manage their own API keys
> or third-party inference provider credentials — for example, configuring an
> API key in a development environment, secrets manager, or machine image for
> use by the customer's own authorized users — provided the resulting usage is
> billed to the key owner under their agreement with Anthropic (or the
> applicable provider) and is not resold or intermediated as described above.
> Nor does it prevent an end user from signing in to the unmodified Claude Code
> binary with their own Claude subscription, including where a platform hosts
> Claude Code as described under *Can customers offer Claude Code in their
> products?* above.
>
> Anthropic reserves the right to take measures to enforce these restrictions
> and may do so without prior notice.

From "Legal agreements", "Can customers offer Claude Code in their products?":

> Unless we've mutually agreed otherwise, preinstalling or running Claude Code
> in your products or services (e.g. in hosted sandboxes or other agent
> infrastructure) requires agreeing to our Commercial Terms of Service and
> complying with the conditions below:
>
> - **The Claude Code binary must not be modified.** Claude Code must be
>   installed and run as published by Anthropic, and customers may not remove,
>   disable, or restrict any authentication method built into it (including
>   methods that permit signing in with a Claude account or the user's own API
>   key).
> - **Customers may not pay for, resell, or intermediate Claude usage on their
>   end users' behalf.** Each end user must authenticate with their own
>   Anthropic API key, Claude subscription plan credentials, or 3P inference
>   provider credential (Amazon Bedrock, Google Cloud's Agent Platform,
>   Microsoft Foundry). That usage is billed directly to the end user under
>   their own agreement with Anthropic or, for third-party inference
>   providers, with the applicable provider.

**The decision.** The agent may run with the person's own Claude account
instead of an API key: `allvibe agent start <project> --sign-in account`. It
is decided now, on the published text, and revisited if Anthropic answers the
question asked on 2026-09-28 (D34) or the text changes. Every condition is
enforced by the suite, not asked of anyone:

1. **Claude Code stays official, unmodified and pinned, with all its sign-in
   methods.** The same image as D39, built from the lock file. Its settings
   set nothing about signing in: no `forceLoginMethod`, no
   `forceLoginOrgUUID`, no key helper. Seen on the test host: its sign-in
   choice offers all three of its methods (a Claude account, a Console
   account, a third-party platform).
2. **The person signs in themselves, through Claude Code's own flow**: `/login`
   (or its first start) in `allvibe agent shell`, the address opened in their
   own browser, the code pasted back into the same terminal.
3. **The login lives only in the agent container's memory.** Claude Code keeps
   a login on Linux in `~/.claude/.credentials.json` (its Authentication page);
   the agent's home is a tmpfs, with no volume or bind mount, and the container
   may use no swap (its swap limit equals its memory limit, so nothing in
   memory is written out to the machine's swap; Docker has no tmpfs option for
   that). The suite never reads, copies, logs or backs up the agent's home:
   backups hold prod's data and the key vault only (D13, D37). Removing the
   container removes the login from the machine.
4. **Nothing typed into the agent's terminal is recorded or logged by the
   suite.** `allvibe agent shell` hands the terminal to `docker exec` as it
   is and writes no run record; Docker logs only the container's main
   process, which is `sleep`.
5. **The egress gate lets through only the hosts Claude Code's own
   documentation lists for signing in and for its traffic**, still `CONNECT`
   to port 443 only, to public addresses only, reading nothing (D42). The list
   is "Network access requirements" on
   https://code.claude.com/docs/en/network-config, read on 2026-09-28. With an
   account the gate passes three hosts; with a key, still one:
   - `api.anthropic.com`: "Claude API requests"; both ways of signing in.
   - `claude.ai`: "claude.ai account authentication".
   - `platform.claude.com`: "OAuth token exchange, refresh, and revocation also
     go to this host for claude.ai accounts, so both Console and claude.ai
     sign-ins require it".

   Every other host on that list stays refused, each for its reason:
   `claude.com` is opened in the person's own browser, not by the agent (its
   other use is documentation lookups); `mcp-proxy.anthropic.com` carries
   claude.ai connectors, which would reach the person's other connected
   services, so they are also turned off in the agent's settings
   (`disableClaudeAiConnectors`); `downloads.claude.ai` and
   `storage.googleapis.com` are for the native installer, the auto-updater
   and plugins, and the agent's Claude Code is installed from npm, pinned,
   with updates off; `registry.npmjs.org` is for plugins, MCP servers started
   with npx, and installing Claude Code, which is done when the image is built;
   `bridge.claudeusercontent.com` is Claude in Chrome;
   `*.frame.claudeusercontent.com` is artifacts; `github.com` is plugin
   marketplaces; `raw.githubusercontent.com` is the changelog feed;
   `*-review.googlesource.com` is only for Claude Desktop; the two Datadog
   hosts are telemetry and error reports, which are off
   (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, D39); `formulae.brew.sh` is
   Homebrew; `code.claude.com` is documentation lookups.
6. **The suite never starts Claude Code on the person's behalf** in this mode
   (D48).
7. **The website keeps saying "your own API key"** until the owner has tried
   this mode and the architect decides to say more.

**Stopping is not signing out.** `allvibe agent stop` removes the login from
this machine, and the next start asks the person to sign in again. It does not
sign out at Anthropic; `/logout` in the session, before stopping, signs out
the way Claude Code does it.

**Verified on a fresh test host (built, not tried by a person).** Both ways of
signing in start. The isolation probe passes in both, 74 of 74 with an
account and 75 of 75 with a key: with an account the gate passes the three
hosts and refuses the fifteen others it was asked for (every other host on
that list, with an example for each of its two wildcard entries, and one on no
list), the key file and the key helper are absent, the home is a tmpfs with no mount or volume, and swap is
0; with a key, `claude.ai` and `platform.claude.com` are refused. A second
probe (`test/host/agent-leftovers.sh`) puts a stand-in login into the agent's
`~/.claude` and types a marker through `allvibe agent shell` in a terminal: both
are there inside the agent, on no file on the machine's disk while it runs,
and nowhere at all after `allvibe agent stop` (every file but `/proc`, `/sys`
and `/dev`, the journal, Docker's containers and volumes), 12 of 12 in both
ways of signing in, with a control the agent writes to disk found first.
`allvibe agent shell` opened Claude Code with an account: after its theme, its
sign-in choice, where the test stopped, because the sign-in is the owner's.
On its first start Claude Code reached `api.anthropic.com` and
`platform.claude.com` through the gate, and nothing was refused.

**Open questions, for the owner and the architect, not decided here:**

- **The Commercial Terms.** The second quote says that preinstalling or running
  Claude Code in "your products or services (e.g. in hosted sandboxes or other
  agent infrastructure)" requires agreeing to Anthropic's Commercial Terms of
  Service, unless agreed otherwise. The suite builds Claude Code into a
  container on the person's own machine, in both ways of signing in (D39
  too). Whether that makes the suite such a product, and what it would then
  have to agree to, is not decided by this text.
- **Ordinary use.** The same page says OAuth sign-in "is designed to support
  ordinary use of Claude Code", and that the plans' limits "assume ordinary,
  individual usage". A person working in their own agent's session fits that;
  anything the suite ran by itself would not, which is D48.

**Known limits.** When the terminal of `allvibe agent shell` closes, Claude
Code keeps running in the container until `allvibe agent stop`. The sign-in
itself, and Claude Code working with an account through the gate, have not
been tried through the suite: that is the owner's test (walkthrough step 23).
If the sign-in needs a host the documentation does not list, the gate's log
names it, and adding it is a change to this decision, not a quiet fix.

#### Amendment, 2026-09-29 (D52)

The open question about Anthropic's Commercial Terms is now a gate for releasing
the product to other people, not a stop for developing it (D52). The owner has
tried this mode: walkthrough step 23 worked as written (2026-09-28).

#### Amendment, 2026-09-29 (D60)

The agent's conversations are now kept on the machine: Claude Code's own
transcripts, through a mount of only the directory it writes them to, so what
the person types to Claude Code and what it answers stays on disk until
deleted, and is in no backup. Point 3 holds: the login stays in memory, and the
leftovers probe finds no stand-in login in the kept files. Point 4 holds for the
terminal itself: what is typed into the shell outside Claude Code is still not
recorded. Every tool call is also logged, one line each, outside the agent's
reach.

## D47. The agent's permission mode is auto, set explicitly

*2026-09-28. The fourth brief, item 1. The architect's decision.*

**What.** The agent's start writes Claude Code's user settings with
`"permissions": { "defaultMode": "auto" }`, in both ways of signing in
(`agent/entrypoint.sh`). The mode is never left to Claude Code's default.

**Auto mode**, as Claude Code documents it ("Choose a permission mode",
https://code.claude.com/docs/en/permission-modes, read 2026-09-28): "A
separate classifier model reviews actions before they run, blocking anything
that escalates beyond your request, targets unrecognized infrastructure, or
appears driven by hostile content Claude read." With 2.1.283, auto mode is
also Claude Code's own starting mode for interactive terminal sessions, which
Claude Code announces.

**Why auto.** The walls are the real boundary: whatever the agent is allowed
to try, it cannot reach prod, the machine, the home network or any key that
is not its own (D39, D41). Inside those walls, auto keeps a check on every
action without asking the person about each one: Manual mode asks before
almost everything, which teaches a beginner to say yes to everything, and
bypassing permissions checks nothing. Claude Code's own warning stands, and
is why the walls come first: "Auto mode reduces permission prompts but does
not guarantee safety."

**Why explicitly.** A default can change with a version. Set in the settings,
the mode is the suite's decision, reviewed, and not a side effect of an update.

**Why in the user settings.** Claude Code takes `auto`, and `bypassPermissions`,
only from the user's or managed settings, never from a project's own
`.claude/settings.json` (the same page). The agent can write its project's
files, so a project file could at most choose a stricter mode, never a looser
one. When auto mode is not available to a session (an unsupported model, or
Anthropic turning it off), Claude Code starts in Manual instead: the safe side.

**Reviewed with every change of the pinned version.** `PERMISSION_MODE_REVIEWED_WITH`
in `src/lib/agent.ts` names the version this was last reviewed for, and a unit
test fails when it is not the pinned `CLAUDE_CODE_VERSION`: changing the
version means reading the permission modes page again and recording what
changed here.

## D48. With an account, the suite never runs Claude Code itself

*2026-09-28. The fourth brief, item 1. The architect's decision.*

**What.** When the agent signs in with the person's own Claude account (D46),
every session of Claude Code is one the person opens and drives, in a
terminal. The suite runs no `claude` command of its own:

- `allvibe agent start --sign-in account` reads Claude Code's version from its
  own package file instead of running `claude --version`;
- `allvibe agent shell` refuses `claude -p` or `--print`, and refuses to start
  Claude Code without a terminal;
- the probes do not run it either.

**Why.** Anthropic's text draws the line between "an end user ... signing in to
the unmodified Claude Code binary with their own Claude subscription", which it
allows, and routing "requests through Free, Pro, or Max plan credentials on
behalf of their users", which it does not (D46). A session the suite started
by itself, with the person's login, would be the suite using the person's
subscription. And because the control panel will call the CLI (rule 5),
refusing it in the CLI means the panel cannot do it either.

**What it does not stop.** A person in the agent's shell can run whatever they
like, `claude -p` included: that is their own use, not the suite's. With a key
(D39) nothing changes.

## D49. The architect accepts D41 and D42, and IPv6 is checked by doctor

*2026-09-28. The fourth brief, the architect's review of the third. D41 carries
a note pointing here.*

- **D41 is accepted**, and five minutes for the firewall's check is right.
- **Not filtering IPv6 is accepted only as long as it stays true**: D41's rules
  are IPv4 rules, which is enough while no network in the suite's address
  pools has IPv6 on. `allvibe doctor` now checks exactly that, so that the day
  it changes, it says so in plain words. It reads every Docker network, takes
  those whose IPv4 subnet lies in Docker's address pools (D16), and reports:
  - all of them with IPv6 off: `✓ IPv6: off on all 4 networks of the apps, so
    the firewall covers everything they can reach`;
  - any of them with IPv6 on: a problem, naming each such network and what to
    do: `✗ IPv6 is on for <network>. The firewall that keeps project containers
    off this machine and the home network covers IPv4 only, so over IPv6 they
    are not kept off.` followed by where to turn it off.

  `ipv6Check` and `subnetInPool` are pure functions with unit tests. On the
  test host, doctor said the first; with a network made by hand in the pool
  with IPv6 on, it said the second and exited 1; with that network removed, the
  first again.
- **D42 is accepted.**

## D50. Your own services, planned

*2026-09-28. The fourth brief. A plan, in docs/roadmap.md, marked Planned and
in development; nothing of it is in the code yet.*

Services the person runs for their home beside their apps, Pi-hole and Home
Assistant first: tested recipes, never an app store; what each can access
shown before it is installed; updates through the safety checks (a backup
first, the new version started and checked, the old one back automatically);
networks of their own, outside the apps' safety net and never touched by the
builder; their data in the nightly backup, with a size warning; Pi-hole's
dependency made plain (a backup DNS server in the router); Home Assistant's
limits in a container made plain (no add-ons; the home network, and possibly a
USB stick, only through D41's opt-in per app); and later the person's own
compose file, marked as their responsibility. The roadmap entry has the
details and the why.

## D51. The control panel's design: the owner's demo, and its rules

*2026-09-28. The fourth brief. A design decision for the panel, which is still
Planned.*

The owner's clickable demo of the control panel is the **reference design**.
It goes onto the website at `/demo`, and its rules are recorded here in
[docs/design/control-panel.md](docs/design/control-panel.md): calm when fine
and clear when something needs the person; action first; one meaning per
colour (green done, safe, works; pink the person's next action; yellow
something to check; purple neutral structure; red a problem); heavy frames
only for what matters most; simple mode first, with advanced mode behind an
obvious switch, a warning and a confirmation, never bypassing the safety net
(D45); one word per thing (test copy, live app, put live, go back, safety
checks, restored and checked, service keys, the architect, the builder,
instructions, what it can access, your own services, home network), with
technical words and port numbers only in advanced mode, explained where they
first appear; and keyboard and screen readers served properly (focus kept in
dialogs and given back, the tab pattern, real radio buttons, a keyboard way
for every pointer action).

**What the demo is not.** It is a mock-up: nothing it shows is built unless
the roadmap says so.

## D52. The Commercial Terms question is a release gate, not a stop

*2026-09-29. The fifth brief, item 2. The architect's review of the fourth
brief, and the owner's decision. D46 carries a note pointing here.*

**The architect accepted the fourth brief** (D46 to D51). The two limits seen
there, Claude Code running on after the terminal of `allvibe agent shell`
closes, and stopping the agent not being a sign-out at Anthropic, are accepted
for now and noted for the control panel.

**The question** (D46): Anthropic's legal page says that preinstalling or
running Claude Code "in your products or services (e.g. in hosted sandboxes or
other agent infrastructure) requires agreeing to our Commercial Terms of
Service", unless agreed otherwise. The suite builds Claude Code into a
container on the person's own machine, with a key (D39) and with an account
(D46).

**Decided: it stays open, and it is a gate for releasing the product, not for
developing it.** Before any version of the suite that installs or runs Claude
Code is offered to other people, the question must be resolved in one of three
ways:

- the owner accepts Anthropic's Commercial Terms, which may need a registered
  business;
- Anthropic confirms otherwise, in writing;
- or a design in which the suite does not install or run Claude Code itself.

**Not affected: the MCP bridge** (D44). There the person runs their own AI app,
signed in their own way, and the suite installs and runs no vendor's agent.

**Until it is resolved, the website** keeps saying "your own API key", and says
nothing about signing in with a Claude account. STATE.md carries the gate.

## D53. Four things the demo showed become plans, and your own services stay at home

*2026-09-29. The fifth brief, item 2. The architect's review of the demo's
claims: four of the seven things it showed without a source in this
repository become plans; the other three are corrected in the demo.*

Each is an entry in [docs/roadmap.md](docs/roadmap.md), Planned, with its
reasons there, and this brief's items 7 to 10 build them:

- **A release only after every step is tried**: a release refuses unless every
  step of the current plan is confirmed as tried by the person. Today the plan
  is prose the agent keeps, and the agent's instructions ask it to stop after
  each step (D36); nothing checks it.
- **A fresh backup before every change to the live app**, going back to an
  earlier version included: today a code rollback takes none (D26).
- **Doctor every night**, with the backup, its result kept for the panel.
- **Mains and battery**: whether the machine runs on mains or on battery, and
  for how long it would last.

**Your own services** (D50) are reachable only from the home network by
default, and never directly from the internet; reaching them from outside
would later go through the same sign-in as apps.

**Corrected in the demo, not planned**: the gate's container name (the
product's is `allvibe-<project>-agent-egress`), and the MCP bridge's command,
address and connection code, which are not decided (D44 decides none of them).
The demo now says only that the person adds the machine with the address the
machine shows them and a one-time connection code, shown once, and the MCP
bridge's roadmap entry says the same, leaving the details to the brief that
builds it.

## D54. Sign-in with MFA, the first real project, a gallery, a session review

*2026-09-29. The fifth brief, item 5. Plans, in docs/roadmap.md; nothing is
built by them.*

- **Sign-in and invitations require multi-factor authentication from the
  start**, for the owner and everyone they invite.
- **The first real project is the owner's homelab documentation site**: an IP
  plan imported from Excel, documentation pages, read-only monitoring, sign-in
  with MFA, publishing, and a public view for a forum signature built from an
  explicit list of the fields that may be public, never a filtered private
  view. The owner keeps a friction log while building it
  ([docs/friction-log.md](docs/friction-log.md)).
- **D41's opt-in per app gets its first real use case**: that site must read the
  APIs of a Proxmox host and a backup server, read-only.
- **A gallery, after publishing**: offered when a person publishes an app and
  off until they turn it on; nothing of it in anyone's app; a page per project
  that shares well; the plan shareable, so that others can "Build something
  like this"; submissions reviewed by hand, by email to begin with, so the
  website stays static; easy removal; links checked; never a promise of
  visitors.
- **A session review**, in advanced mode: a timeline of what was asked, the
  plan, the tool calls, the commits and diffs, the checks, the confirmations
  and the reports, with a summary that flags any claim without evidence behind
  it.

## D55. The app view: the same layout in both modes

*2026-09-29. The fifth brief, item 5. Settled by the owner and the architect;
recorded in [docs/design/control-panel.md](docs/design/control-panel.md), "The
app view"; the website's demo shows it. The panel itself is still Planned.*

The page for one app keeps the same layout in simple and advanced mode, so that
nothing moves when the person switches. On the left, who you talk to: in
simple mode one chat, "Your AI", with the plan as a checklist at its top; in
advanced mode the tabs Plan (the architect) and Build (the builder's session).
On the right, what you look at: Preview and Live, and in advanced mode Code (a
file tree and the chosen file with its changes). The preview is always there,
because a project starts from the starter app; "It works" and "Something is
wrong" sit above it. Live holds the version the family uses, "Put vN live" with
the safety checks as progress, and earlier versions with "Go back". "More",
next to the app's name, holds backups, service keys and the app's settings. On
a phone, one row of tabs: Chat, Preview, Code in advanced mode, and Live.

Small changes skip the plan and become one step. Planning uses Claude Code's own
plan mode, not a mechanism of the suite's own.

**Words**: the tab is "Live" and its button "Put vN live"; "publish" is kept for
making an app reachable from the internet; "deploy" is never used in the panel.

## D56. A release only after every step of its plan is tried by the person

*2026-09-29. The fifth brief, item 7. Builds D53's first plan.*

**The plan becomes something the suite can read.** Each project's working copy
holds `plan.json`: the plan's title, and its steps, each with a number, a
title, the check the person can try, and `built`, whether the builder has
finished it. The agent keeps it, as the project's AGENTS.md now asks (a new
section, "The plan, in plan.json"); STATE.md keeps a short version for people.

**Only the person marks a step as tried**: `allvibe plan tried <project>
<step>`, which the control panel will call (rule 5). The marks are in
`tried.json` beside the project, outside the working copy, which the agent's
container does not have (D39); anything the agent writes about trying into
`plan.json`, or a `tried.json` of its own in the working copy, is ignored. A
mark belongs to the words of the step it was made for (the plan's title, the
step's number, title and check): if the agent changes them after the person
tried the step, it is untried again. A step the builder has not finished
cannot be marked. `allvibe plan <project>` shows the plan dev runs, and where
each step stands.

**The release's second step**, "every step of the plan is tried by you",
reads `plan.json` from the commit being released and refuses, before anything
changes, naming each untried step in plain words. A plan is put live once: a
release records it (its title, a key of its words, and when each step was
tried, at which commit), and a later release of the same plan counts as
outside any plan. **Work outside any plan** (no plan.json, an empty plan, or a
plan already put live) needs `--outside-plan "reason"`: refused without a
reason, and the reason kept in the release's record and in the run's. It does
not stand in for trying: a commit with a plan whose steps are untried is
refused with or without it. A release now has sixteen steps.

**Verified on a fresh test host** (`test/host/plan-gate.sh`, 31 of 31): the
agent's plan committed from inside its container; a release with untried steps
refused at step 2, with the releases, tags, prod's version and the backups as
before; from inside the agent, no `allvibe` command and no marks file, and its
own `"tried": true` and `tried.json` committed and ignored; step 1 marked, a
release still refused; step 2 marked, the release through, with the plan in
its record; the same plan refused the second time; `--outside-plan` refused
without a reason or with a blank one, nothing changed, and put live with one,
the reason in both records. The same probe against the previous bundle, which
has no gate, said WRONG on every check the gate is for.

**Known limit.** A change the agent commits after the person tried the last
step, and before the release, is released with the plan: the steps were tried,
but not that last commit. The release records, for each step, the commit it
was tried at, so the panel can show the difference; refusing it is left for a
later decision.

## D57. A fresh backup, restore-checked, before going back

*2026-09-29. The fifth brief, item 8. Builds D53's second plan; amends D26.*

**What.** `allvibe rollback <project>`, going back by code (D26), now does
what a release does before it changes the live app: the recovery key is
confirmed, a fresh backup of prod is taken, and that backup's restore check
runs, all five steps of it. Only then are prod's data kept and the older
version deployed. It stops at the first failure without changing anything. A
rollback has fourteen steps.

**The backup is kept**, beside the releases', and never pruned: a new backup
kind, `rollback`, which the manifest names.

**Unchanged:** `--restore-data` keeps its own backup step ("a backup of prod as
it is now, first"). The automatic rollback after a failed release takes no
second backup: it goes back to the version before, with the backup and restore
check that release took minutes earlier, and a second backup at that moment
could only delay putting prod back while it is down.

**Verified on the test host** (`test/host/rollback-backup.sh`, 14 of 14): a
rollback as the person runs it took and kept a backup marked as a rollback's
and passed its restore check before the deploy, went back, and kept prod's
entries; a rollback whose fresh backup was damaged the moment it was written
(one byte flipped inside its encrypted data, as a failing disk would; inotify
on the test host makes the timing certain) stopped at "it is whole, and it
decrypts", step 8 of 14, with prod on its version, answering, and its entries
as before. The same probe against the previous bundle said WRONG on every
check this change is for.

## D58. doctor every night, its result kept for the panel

*2026-09-29. The fifth brief, item 9. Builds D53's third plan.*

**What.** The nightly service (`allvibe scheduled-backup`, D24) now ends with
doctor's checks, run after that night's backups and restore checks are
recorded, so that they see them. The full result, every check with its status
and its plain words, the summary and the counts, is kept on the machine in
`/var/lib/allvibe/doctor/`: `latest.json`, and the same under its time, of which
the newest fourteen are kept. The service user owns it, and nobody else can
write it. `allvibe doctor --last` shows it, as the nightly check found it, and
exits 1 when it found a problem; `--json` gives the file's content for the
panel (rule 5).

**A failing check does not fail the night's backups.** The service's result is
the backups' and restore checks', as before; doctor's result is beside it, and
a doctor that could not run at all says so in the service's log.

**Verified on the test host** (`test/host/doctor-nightly.sh`, 16 of 16): the
service started as its timer starts it; the result kept, recent, with every
check, owned by the service user; with the reverse proxy stopped, the service
still succeeding, and the kept result and `doctor --last` naming "Reverse
proxy: exited" with exit 1; the proxy back, all well again. Against the
previous bundle, WRONG on every check this is for.

## D59. Mains and battery, in doctor

*2026-09-29. The fifth brief, item 10. Builds D53's fourth plan.*

**What.** doctor reads the kernel's power supplies (`/sys/class/power_supply`):
whether a mains supply is online; each battery's status and charge; and, where
the machine reports it, how long it would last: `time_to_empty_now`, or
`energy_now` over `power_now`, or `charge_now` over `current_now`, only while
it is discharging. It says, in one line (scope "data", so it never fails an
installation):

- on mains, with a battery: "Power: on mains; the battery is at 80%, charging,
  ready to carry the machine through a power cut" (ok);
- on battery: "Power: ON BATTERY, at 60%, about 1 hour and 40 minutes left. The
  apps keep running; plug the machine in" (a warning);
- on battery at 20% or less: "... and it is low ... The machine will switch
  itself off soon; plug it in now" (a problem);
- no battery: "Power: no battery, so a power cut stops the machine at once (a
  battery or a small UPS would carry it through a short one)" (information,
  never a failure).

**The test host has no battery.** Its test overrides (D14), honoured only
inside a container, take `power-supply-dir`, a stand-in for the kernel's
directory; doctor then adds "(declared by the test host)". Nothing else can
point doctor elsewhere.

**Verified**: unit tests with stand-ins for every case, including a battery
reported absent and the machine's own time estimate; on the test host
(`test/host/power-fixtures.sh`, 12 of 12), doctor's words and status for mains,
battery, low battery and no battery through stand-ins, and, without the
override, the kernel's own, which has no battery there. Against the previous
bundle, 1 of 12. **Not verified on a real laptop**: see STATE.md, "To verify
on real hardware".

## D60. The agent's activity log, and its conversations kept

*2026-09-29. The fifth brief, item 11. An amendment to D46, recorded here in
full with a note under D46.*

**What.** Two things the agent leaves on the machine on purpose, in
`/var/lib/allvibe/projects/<project>/agent/`, outside the working copy, the
service user's alone (mode 0700):

1. **The activity log**, `log/activity.jsonl`: one line per tool call, with
   the time, the session, the tool, its target and whether it failed. The
   target is the file's path (Read, Write, Edit, MultiEdit, NotebookEdit), the
   pattern and where (Glob, Grep), the address (WebFetch), the query
   (WebSearch), the task's description (Task, Agent), or a command's first
   line (Bash), with "(and N more lines, not logged)" when it has more, since
   the rest of a heredoc is a file's content. Never a file's content, never a
   tool's output, at most 300 characters. `allvibe agent activity <project>
   [--lines N]` shows it.
2. **Its conversations**: Claude Code's own transcripts of each session, one
   JSONL file per session, and whatever else Claude Code keeps per project
   there (its memory directory). `allvibe agent transcripts <project>` lists
   them; `--delete` deletes them all.

**How the log is written.** Claude Code's managed settings, baked into the
agent's image at `/etc/claude-code/managed-settings.json`, owned by root and
read-only to the agent, set two hooks, PostToolUse and PostToolUseFailure, on
every tool. The hook sends its line over HTTP to a small logger beside the
agent (`<command>-<project>-agent-activity`): on dev's internal network only,
as the service user, read-only, with no capabilities, and with the log's
directory mounted into it and into nothing else. So the agent can add lines
and do nothing else to them: the log is not in its container. The logger:

- takes lines only from the agent's own address, as `POST /log`, at most 4 kB,
  in the hook's shape; anything else is refused (403 or 400);
- runs the key check's pinned scanner (gitleaks, D38) over each target and
  writes "(held something that looks like a key or a password: not logged)"
  instead when it finds one, or when the scanner cannot run: it fails closed;
- writes one line per tool call: Claude Code calls both hooks for some failed
  calls, so a call's events are gathered by its id for a moment and written
  once, as failed if either says so.

The hook never blocks the agent: if the logger does not answer within three
seconds, the line is lost and the agent carries on.

**Turning it off is not the agent's to do.** Claude Code does not let user or
project settings turn off hooks set in managed settings. Seen on the test host:
with `"disableAllHooks": true` in the agent's own settings and in its
project's (`.claude/settings.json` and `.claude/settings.local.json`), a hook of
its own stops running, and the log's hook still writes every line. Before
that, as a control, the same hook of its own is seen running, so the settings
are known to be read.

**How the conversations are kept, and the login is not.** The agent's home
stays in memory (D46). One directory is mounted from the machine, the one
Claude Code writes its transcripts to, and nothing else from the home: the
project's transcripts directory at `/agent-transcripts`, linked by the
entrypoint to `~/.claude/projects/-workspace`. The login
(`~/.claude/.credentials.json`) and the settings stay in memory, and go when
the agent stops.

**Not in backups.** Neither the transcripts nor the log is in a backup.
Backups carry what is needed to bring the apps back: prod's data and the key
vault (D13, D37). A conversation can hold anything the person typed to the
agent or the agent read, including something secret, and a backup goes to the
backup target and is kept for a long time. Losing the machine loses the
conversations, which is the lesser harm. The session review (D54) may ask for
this again; it would be a new decision.

**Deleting them.** `allvibe agent transcripts <project> --delete` deletes
every conversation, and refuses while the agent runs, since it may be writing
one; the log is kept. `allvibe project remove` deletes both, and says so
before it does. The log is not rotated yet: at about 150 bytes a line, ten
thousand tool calls are 1.5 MB.

**Known limits.**

- **What the agent reads or is told is in its transcript.** If the person
  pastes a key into the conversation, or the agent prints a file holding one,
  the transcript keeps it, on this machine, until it is deleted. The log is
  scanned; the transcripts are not, since they are Claude Code's own files.
- **The agent can add lines of its own making.** It cannot change or delete
  one, but a line the agent sent itself looks like one its hook sent.
- **If the logger is down, lines are lost**, and the agent does not stop.
  `agent start` starts it, and `agent stop` stops it last, gently, so it
  writes what it is still gathering.
- **The log records tool calls, not the model's words**: those are in the
  transcript.

**Verified (built, not tried by a person).** Unit tests for the hook's line,
the logger's checks and the gathering. On the test host, a real session of
the pinned Claude Code, run against a stand-in for the model's API
(`test/host/stub-api.mjs`, which asks for four tool calls and never needs a
model, a key or an account), in both ways of signing in
(`test/host/agent-activity.sh`, 29 of 29 in each): one line per call, the
written file's path without its content, a fake key withheld, a failed call
once and as failed, a line from dev's app refused, a line the agent sent
itself with a fake key withheld, the log absent from the agent, the managed
settings read-only to it, the hooks off in its own and its project's settings
with the log still written, a transcript kept for each session, deleting them
refused while it runs, and neither a stand-in login nor a stand-in key nor the
vault's values in the log or the transcripts. The isolation probe, extended to
the logger and to the agent's mounts, 89 of 89 with a key and 88 of 88 with an
account; the leftovers probe, extended to the kept files, 17 of 17 in both;
the vault check finds no value in them. Against the previous bundle the new
probe fails, 11 of 22 as they must be (the probe then had 22 checks).
**Not verified**: a session with a real model, in either way of signing in:
that is the owner's to try.
