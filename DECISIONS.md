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
