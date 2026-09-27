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

## Also planned, and recorded elsewhere

These were named when their decisions were made, and are not repeated here:

- In [CLAUDE.md](../CLAUDE.md): the web UI, the agent container, internet
  publishing, tunnels, the GitHub integration, and the key check before push.
- In D28: a lock between operations, and pruning old release images and release
  backups.
