# State

*Updated 2026-09-26, during the first brief.*

## What works

- The repository, its rules ([CLAUDE.md](CLAUDE.md)), its decisions
  ([DECISIONS.md](DECISIONS.md)) and the checks that run on every push: a
  secret scan (gitleaks) and `scripts/guard.mjs` (rules 9 and 10).

## In progress

The first brief, nine items:

1. Foundation. **Built** (a17ca48).
2. Vikt inventory. **Built**: [docs/vikt-inventory.md](docs/vikt-inventory.md), and the mistakes section of CLAUDE.md.
3. Local test host.
4. Host bootstrap: `install.sh` and `allvibe doctor`.
5. Projects: dev and prod stacks.
6. Backup and restore test, with a daily timer.
7. Release and rollback.
8. Walkthrough.
9. Record.

## Next

Item 3.

## To verify on real hardware

Checks that a container cannot prove (D14). The old laptop running Debian 13
closes these.

- None recorded yet.
