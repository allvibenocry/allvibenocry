# State

*Updated 2026-09-26, during the first brief.*

## What works

- `install.sh` and `allvibe doctor` on a fresh Debian 13 test host (item 4).
- The repository, its rules ([CLAUDE.md](CLAUDE.md)), its decisions
  ([DECISIONS.md](DECISIONS.md)) and the checks that run on every push: a
  secret scan (gitleaks) and `scripts/guard.mjs` (rules 9 and 10).

## In progress

The first brief, nine items:

1. Foundation. **Built** (a17ca48).
2. Vikt inventory. **Built**: [docs/vikt-inventory.md](docs/vikt-inventory.md), and the mistakes section of CLAUDE.md.
3. Local test host. **Built**: [test/host/](test/host/README.md). Created, reset, restarted and removed repeatedly; nothing unlabelled added, nothing left behind.
4. Host bootstrap. **Built**: `install.sh` and `allvibe doctor` (D15-D17). On a fresh test host: installed with 22 changes, a second run changed nothing, doctor all green, both warnings shown when forced, refusals shown.
5. Projects: dev and prod stacks.
6. Backup and restore test, with a daily timer.
7. Release and rollback.
8. Walkthrough.
9. Record.

## Next

Item 5.

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
  kernel does not restart.
- **Reachability from another machine on the LAN.** The test host's ports are
  published on the workstation's loopback only.
- **install.sh on real hardware.** Docker's repository, the key fingerprint check,
  real memory and disk detection, and `live-restore` across a Docker upgrade have
  run only in the container.
- **The harness over SSH.** `exec`, `shell`, `push` and `status` with
  `ALLVIBE_TEST_HOST` set have not run against a real machine.
