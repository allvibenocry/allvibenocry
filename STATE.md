# State

*Updated 2026-09-27: the architect's reviews are recorded (D29 to D33), and
what is planned is in [docs/roadmap.md](docs/roadmap.md). The
first brief's report is
[reports/2026-09-27-brief-01.md](reports/2026-09-27-brief-01.md).*

Everything below has been **built and run by the implementer on the local test
host**. None of it has been tried by a human yet (rule 6), and none of it has
run on real hardware.

## What works

On a fresh Debian 13 test host, following [docs/walkthrough.md](docs/walkthrough.md):

- **Installing a host.** `install.sh` installs Docker Engine from Docker's
  repository, the service user, the directories, the CLI, the reverse proxy,
  the backup keys and the daily timer; a second run changes nothing and says
  so. It refuses anything but Debian 13 on x86-64, and warns in plain language
  about low memory and a spinning disk. `allvibe doctor` reports the host in
  plain language, or as JSON.
- **Projects.** `allvibe project create` makes a guestbook with its own git
  repository, a dev and a prod that share no network, volume or secret,
  reachable at the host's address and a port each. From inside dev, prod
  cannot be reached at all, not even through its front door.
- **Backups.** Encrypted to a host key and a recovery key, only to a target
  proven off the machine, restore-checked by running the app against a scratch
  copy, daily by a timer that install enables, every run recorded. The
  recovery key is never printed and must be confirmed before a release.
- **Releases and rollbacks.** A release is dev's commit, behind a fresh backup
  that passed a restore check; a failed deploy rolls back by itself with the
  data intact; a manual rollback keeps the data; putting data back needs
  explicit confirmation and takes a backup first.
- **The repository.** The rules ([CLAUDE.md](CLAUDE.md)), the decisions
  ([DECISIONS.md](DECISIONS.md), D1-D28), the Vikt inventory, the test host
  harness, 21 unit tests, and CI on every push: a secret scan (gitleaks), the
  guard for rules 9 and 10, the unit tests and shellcheck.

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

**Waiting for:** the owner to try each item (rule 6).

**Reviewed by the architect:** D13, the recovery key, is accepted (D29); D18,
how projects are reached, is accepted for version 1 (D30); D26, rollback and
data, is accepted with a known gap (D31); and D15's use of Debian's Node.js 20
is recorded as deliberate (D32). The review changes no code.

## Known

- Nothing locks one operation against another yet (D28).
- Release images and release backups are never pruned yet (D28).
- `doctor` shows the timer's calendar time; `systemctl list-timers` shows the
  actual next run, up to 30 minutes later (the random delay).
- From Git Bash, the harness needs `MSYS_NO_PATHCONV=1` (test/host/README.md).

## Next

What is planned, and not built, is in **[docs/roadmap.md](docs/roadmap.md)**,
all of it Planned: off-site backups, the recovery key in the web UI, a lost
recovery key, rollback past a migration, and, from the review of the website
(D33), a key vault, the control panel at `allvibe.local`, an installer on a USB
stick, disk health warnings, a monthly check-up, moving to a new computer, full
disk encryption at install, and the control panel's runtime.

The next brief. Candidates from the first one: a lock between operations,
pruning old release images and backups, the web UI calling this CLI, and the
laptop.

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
  machine was off happens after boot (`Persistent=true`).
- **The daily run at 03:30.** Only started by hand so far; let one happen on its
  own and read `allvibe runs` the next morning.
- **Reachability from another machine on the LAN.** The test host's ports are
  published on the workstation's loopback only. On the laptop: open a project's
  prod and dev at `http://<laptop address>:8100/` and `:8101/` from a phone or
  another computer, and check that nothing listens on IPv6 (`ss -ltn6`).
- **Prod's door refusing containers on a real Docker.** The deny list is read
  from Docker when a project is created; on a real host the default bridge
  usually has Docker's standard subnet, not the one the test host's inner
  Docker picked. Run `sh test/host/rule1-isolation.sh allvibe <project>` there.
- **The harness over SSH.** `exec`, `shell`, `push`, `pull` and `status` with
  `ALLVIBE_TEST_HOST` set have not run against a real machine.
