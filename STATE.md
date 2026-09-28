# State

*Updated 2026-09-28: the third brief is built (D41 to D45), and its report is
[reports/2026-09-28-brief-03.md](reports/2026-09-28-brief-03.md). The second
brief's is [reports/2026-09-28-brief-02.md](reports/2026-09-28-brief-02.md), the
first brief's [reports/2026-09-27-brief-01.md](reports/2026-09-27-brief-01.md).*

Everything below has been **built and run by the implementer on the local test
host**. None of it has been tried by a human yet (rule 6), and none of it has
run on real hardware.

## What works

On a fresh Debian 13 test host, following [docs/walkthrough.md](docs/walkthrough.md):

- **Installing a host.** `install.sh`, in thirteen steps, installs Docker Engine
  from Docker's repository, the service user, the directories, the CLI, the
  reverse proxy, the backup keys, the daily timer, the unit that puts the key
  vault's keys back into memory at boot, the firewall for project containers,
  and the key check's scanner; a second run changes nothing and says so. It
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
  `doctor`.
- **Backups.** Encrypted to a host key and a recovery key, only to a target
  proven off the machine, restore-checked by running the app against a scratch
  copy, daily by a timer that install enables, every run recorded. The
  recovery key is never printed and must be confirmed before a release. A
  backup carries the project's key vault too, and the restore check proves
  every key in it decrypts (D37).
- **Releases and rollbacks.** A release is dev's commit, behind a fresh backup
  that passed a restore check; a failed deploy rolls back by itself with the
  data intact; a manual rollback keeps the data; putting data back needs
  explicit confirmation and takes a backup first. Every release records the
  schema it ran with; a breaking migration is released only when its file says
  so; a rollback goes ahead across migrations that only add, and stops, before
  changing anything, across a breaking one (D35).
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
  and nothing else.
- **The repository.** The rules ([CLAUDE.md](CLAUDE.md)), the decisions
  ([DECISIONS.md](DECISIONS.md), D1-D45), the Vikt inventory, the test host
  harness, its fixtures and probes (`test/host/`), 55 unit tests, and CI on
  every push: a secret scan (gitleaks), the guard for rules 9 and 10, the unit
  tests, and shellcheck of install.sh and firewall.sh.

## The third brief

| Item | State |
|---|---|
| 1. The machine's own ports and the home network, closed to every project container | Built and run: with an SSH server, a service on another port and a stand-in device on the home network, 24 of the app probe's 59 checks were reachable before the rules and 0 after; the app probe 59 of 59 and the agent probe 50 of 50, after a test host restart and after a Docker restart too; doctor reporting, and the check putting back a rule removed by hand. D41. |
| 2. The egress decision | Recorded: D42, with notes under D34 and D39. Documentation only. |
| 3. Findings and roadmap | Recorded: D43 (the VAT finding), D44 (the MCP bridge), D45 (two modes, a bug report builder, the architect), and their roadmap entries. Documentation only. |
| 4. Walkthrough and record | The walkthrough, step 21 new and step 22's probe changed, run end to end on a fresh test host as written; this file, DECISIONS.md, CLAUDE.md's mistakes, the roadmap and the report. |

**Waiting for:** the owner to try each item of all three briefs (rule 6).

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

- Nothing locks one operation against another yet (D28).
- Release images and release backups are never pruned yet (D28).
- `doctor` shows the timer's calendar time; `systemctl list-timers` shows the
  actual next run, up to 30 minutes later (the random delay).
- From Git Bash, the harness needs `MSYS_NO_PATHCONV=1` (test/host/README.md).
- **The firewall is checked every five minutes** (D41). A rule removed by hand
  between two checks is put back at the next one; until then `doctor` still
  shows the last check's result.
- **An app cannot reach a device on the home network**, a printer, say: that
  needs an explicit per-app opt-in, planned in D41 and not built.
- **IPv6 is not filtered**: the suite's networks have none (D41).
- **AGENTS.md is followed by the agent, not enforced**: what is enforced is the
  migration check, the key check, the firewall and rule 1 (D36).
- **A commit made with `--no-verify` is not key-checked**, and a blocked
  commit's staged copy stays in git's object store, unreferenced, until pruned
  (D38).
- **Built and not tried:** `key set` putting the old value back when the app
  does not come up with a new one; the agent's interactive session; Claude
  Code talking to the API through the egress gate (the second brief's item 7).
- **Subscription sign-in is not built**, and the egress gate allows no host for
  it (D34, D39, D42).

## Next

What is planned is in **[docs/roadmap.md](docs/roadmap.md)**: off-site backups,
the recovery key in the web UI, a lost recovery key, the control panel at
`allvibe.local`, an installer on a USB stick, disk health warnings, a monthly
check-up, moving to a new computer, full disk encryption at install, the rest
of the agent adapters with the MCP bridge next (D44), sign-in and invitations,
two modes in the control panel, a bug report builder, the architect as a role
(D45), and the team version. Its "Built, from this roadmap" part has what the
second brief built.

Candidates for the next brief: the MCP bridge; the web UI calling this CLI, on
the runtime D40 decided; sign-in in front of apps; the key check before push,
with the GitHub integration; a lock between operations; pruning; the laptop;
and the live agent test, once there are API credits or a subscription path.

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
  own and read `allvibe runs` the next morning.
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
- **The harness over SSH.** `exec`, `shell`, `push`, `pull` and `status` with
  `ALLVIBE_TEST_HOST` set have not run against a real machine.
