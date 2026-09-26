# State

*Updated 2026-09-26, during the first brief.*

## What works

- `install.sh` and `allvibe doctor` on a fresh Debian 13 test host (item 4).
- Projects with separate dev and prod, reachable from the workstation's browser (item 5).
- Encrypted backups of prod on an off-machine target, restore checks, the recovery
  key's confirmation, and the daily timer (item 6).
- Releases from dev's commit, automatic and manual rollback, and data rollback
  only with confirmation (item 7).
- The repository, its rules ([CLAUDE.md](CLAUDE.md)), its decisions
  ([DECISIONS.md](DECISIONS.md)) and the checks that run on every push: a
  secret scan (gitleaks) and `scripts/guard.mjs` (rules 9 and 10).

## In progress

The first brief, nine items:

1. Foundation. **Built** (a17ca48).
2. Vikt inventory. **Built**: [docs/vikt-inventory.md](docs/vikt-inventory.md), and the mistakes section of CLAUDE.md.
3. Local test host. **Built**: [test/host/](test/host/README.md). Created, reset, restarted and removed repeatedly; nothing unlabelled added, nothing left behind.
4. Host bootstrap. **Built**: `install.sh` and `allvibe doctor` (D15-D17). On a fresh test host: installed with 22 changes, a second run changed nothing, doctor all green, both warnings shown when forced, refusals shown.
5. Projects. **Built**: `allvibe project create|list|status|remove` (D18-D21). On a fresh test host: a guestbook created, an entry written through a browser in prod and another in dev, each seeing only its own; rule 1 probed from inside dev.
6. Backup and restore test. **Built**: `allvibe backup-target`, `backup`, `backups`, `restore-check`, `recovery-key`, and the daily timer (D22-D24). On the test host: a backup on the backup volume, a restore check showing the entry count from the restored copy, the root filesystem refused, and the timer active after install and after a restart.
7. Release and rollback. **Built**: `allvibe release [--dry-run]`, `rollback [--restore-data --confirm-data-loss]`, `dev deploy`, `dev commit` (D25, D26). On the test host: a dev change live in prod with its entries intact; a broken release rolled back automatically; a manual rollback; a release with the backup target unmounted stopped at the backup step and changed nothing; a confirmed data rollback.
8. Walkthrough.
9. Record.

## Next

Item 8.

## To verify on real hardware

Checks that a container cannot prove (D14). The old laptop running Debian 13
closes these.

Each names the test override or stand-in used in the container.

- **Memory.** The test host declares 16 GB (`memory-mb`); a real machine's
  `/proc/meminfo` has not been read by the checks yet.
- **The system disk's type.** Declared (`system-disk`); detection from the root
  filesystem's block device has not run on a real disk, SSD or rotational.
- **A separate filesystem on a separate physical disk.** Declared for the backup
  volume (`external-backup-mount`); every volume in the container sits on one
  virtual disk. A USB disk on a real machine has to be accepted without an
  override, and a directory on the system disk refused.
- **A real reboot.** A container restart stands in: the filesystem survives, the
  kernel does not restart. On the laptop: reboot, and check that the timer is
  active, the proxy and projects are back, and a missed run happens
  (`Persistent=true`).
- **A USB disk as the backup target**, accepted without any override; a second
  partition on the system disk refused; the disk unplugged, and the next backup
  failing with "on this machine's own root filesystem". And a NAS share mounted
  over NFS or SMB, accepted as off the machine.
- **The daily run at 03:30.** Only started by hand so far; let one happen on its
  own.
- **Reachability from another machine on the LAN.** The test host's ports are
  published on the workstation's loopback only. On the laptop: open a project's
  prod and dev at `http://<laptop address>:8100/` and `:8101/` from a phone or
  another computer, and check that nothing listens on IPv6 (`ss -ltn6`).
- **Prod's door refusing containers on a real Docker.** The deny list is read
  from Docker at run time; on a real host the default bridge usually has
  Docker's standard subnet, not the one the test host's inner Docker picked.
- **install.sh on real hardware.** Docker's repository, the key fingerprint check,
  real memory and disk detection, and `live-restore` across a Docker upgrade have
  run only in the container.
- **The harness over SSH.** `exec`, `shell`, `push` and `status` with
  `ALLVIBE_TEST_HOST` set have not run against a real machine.
