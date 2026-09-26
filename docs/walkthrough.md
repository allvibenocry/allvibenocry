# Walkthrough: from a fresh host to a release and a rollback

This takes you from a fresh Debian 13 host through everything the first brief
built: installing, a project with dev and prod, backups and restore checks, a
release, a broken release that rolls itself back, and a manual rollback. It
takes about twenty minutes.

It works on the **test host** (a container on your workstation, D14) and,
unchanged, on a **real Debian 13 machine** later. Where the two differ, and
only in three places (getting a fresh host, the backup disk's path, and the
address in the browser), the text says so.

## Before you start

On your workstation, in this repository, with Node 22 and Docker:

```sh
npm ci
npm run bundle
```

You should see `bundle: bundle/allvibe-0.1.0 (0.1.0+<commit>)`.

**Two kinds of command.** Lines marked **workstation** run in this repository
on your workstation (PowerShell or Git Bash). Lines marked **host** run in a
root shell on the host, which you open with:

```sh
node test/host/host.mjs shell          # workstation
```

and leave with `exit`. From Git Bash, run `export MSYS_NO_PATHCONV=1` once
first (Git Bash otherwise rewrites `/root/...` into a Windows path).

**On a real machine**, set `ALLVIBE_TEST_HOST=you@the-laptop` in `local.env`
(see `local.example.env`; the user needs sudo without a password and a
key-based SSH login). The same `node test/host/host.mjs` commands then reach it
over SSH, and `shell` opens a root shell there.

---

## 1. A fresh host

**Test host**, workstation:

```sh
node test/host/host.mjs reset
```

You should see, after about twenty seconds:

```
systemd   running
overrides /etc/allvibe/test-overrides: memory-mb=16384, system-disk=ssd, external-backup-mount=/mnt/allvibe-backup
ports     test host 8100-8119 -> http://localhost:8100-8119 on this workstation
ready     a fresh Debian 13 host. Next: node test/host/host.mjs shell
```

(`create` instead of `reset` if there is no test host yet.)

**Real machine:** install Debian 13 (x86-64) on it, with an SSH server and your
key, and nothing else.

## 2. Install

Workstation:

```sh
node test/host/host.mjs push bundle/allvibe-0.1.0 /root/
node test/host/host.mjs exec -- bash /root/allvibe-0.1.0/install.sh
```

You should see eleven steps, `[1/11] This machine` to `[11/11] How the host
is`, each with `changed:` lines, then `allvibe doctor` with only `✓` lines (and
one `i` line saying the test overrides are active, on the test host), `All
green.`, and last:

```
Installed All vibe no cry 0.1.0+<commit>: 22 change(s).
```

It takes about a minute: most of it is Docker Engine arriving from Docker's own
repository.

## 3. Install again

Workstation, the same command:

```sh
node test/host/host.mjs exec -- bash /root/allvibe-0.1.0/install.sh
```

Every step now says `unchanged:`, and the last line is:

```
Nothing changed: this machine was already set up, and everything checked above is as it should be.
```

## 4. The warnings (test host only)

A container cannot measure memory or its disk, so the test host declares them.
Declare an old machine instead. Workstation:

```sh
node test/host/host.mjs override set memory-mb=4096
node test/host/host.mjs override set system-disk=rotational
node test/host/host.mjs exec -- bash /root/allvibe-0.1.0/install.sh
```

Step 2 now shows two warnings in plain words:

```
  ! This computer has about 4.0 GB of memory (declared by the test host). All vibe no cry works best with 8 GB or more.
  ! This computer's system disk is a spinning hard disk, not an SSD (declared by the test host).
```

and the last lines are `Nothing changed: …` and `2 warning(s) above: worth
reading, and nothing that stops the installation.` Put the declarations back:

```sh
node test/host/host.mjs override set memory-mb=16384
node test/host/host.mjs override set system-disk=ssd
```

**Real machine:** skip this. If it has less than 8 GB or a spinning disk, step 2
of the installation showed the warning for real.

## 5. Connect the backup disk

Backups go to a directory on **another disk**. On the test host that is the
volume mounted at `/mnt/allvibe-backup`. **On a real machine**, it is where your
USB disk or NAS share is mounted, for example `/mnt/backup`: use that path
instead in this step.

Host (`node test/host/host.mjs shell`):

```sh
mkdir -p /var/backups/not-a-disk && chown allvibe:allvibe /var/backups/not-a-disk
allvibe backup-target set /var/backups/not-a-disk
```

It refuses, because that directory is on the machine's own disk:

```
FAIL 1/2 the backup target is off this machine and writable
       /var/backups/not-a-disk is on this machine's own root filesystem, which is not off the machine
```

Now the real one. The disk's directory has to belong to the service user:

```sh
chown allvibe:allvibe /mnt/allvibe-backup
allvibe backup-target set /mnt/allvibe-backup
```

```
ok   1/2 the backup target is off this machine and writable
       /mnt/allvibe-backup is declared a separate disk by the test host (D14); … free
ok   2/2 saved as this machine's backup target
```

(On a real machine the first line names the disk instead, for example
`is on disk sdb, separate from this machine's system and data`.)

## 6. Keep the recovery key

Every backup is encrypted twice over: with a key that stays on this machine, and
with a **recovery key** that only you will have. Without it, the backups cannot
be read on any other machine, so the suite refuses to release anything until you
have shown it your copy (D13). It is never shown on the screen.

Workstation: take your copy off the machine, into a file this repository ignores:

```sh
node test/host/host.mjs pull /etc/allvibe/recovery-key-UNCONFIRMED.txt .local/recovery-key.txt
```

```
pulled    /etc/allvibe/recovery-key-UNCONFIRMED.txt to .local/recovery-key.txt (not shown)
```

**On a real machine**, now put that file's contents in your password manager (or
print it), and keep it somewhere that is not this computer. Then show it back:

```sh
node test/host/host.mjs exec --stdin-file .local/recovery-key.txt -- allvibe recovery-key confirm
```

```
ok   1/1 your copy is this machine's recovery key
       it matches the public half every backup is encrypted to; confirmed <today>
       /etc/allvibe/recovery-key-UNCONFIRMED.txt is deleted: your copy is now the only one
```

## 7. A project

Host:

```sh
allvibe project create guestbook
```

Ten `ok` steps, about forty seconds the first time (Docker fetches Node and
Postgres), ending:

```
ok   10/10 both answer through the front door
       dev: {"ok":true,"entries":0,"environment":"dev","version":"dev (<commit>)"}
       prod: {"ok":true,"entries":0,"environment":"prod","version":"v1"}

guestbook is ready:
  prod  http://<address>:8100/
  dev   http://<address>:8101/
```

In your browser, open **prod** and **dev**:

- **Test host:** http://localhost:8100/ and http://localhost:8101/ (the address
  the command prints is the container's own; your workstation reaches it on
  localhost).
- **Real machine:** the two addresses it printed, from any computer or phone on
  the same network.

Each shows "Guestbook" with a badge: green **prod**, orange **dev**. Sign each
guestbook with a different message, and reload both: each shows only its own
entry. They share nothing.

Host, to see the same from the machine's side:

```sh
allvibe project list
allvibe project status guestbook
```

`status` shows prod on `v1` and dev, both `running, healthy`, and `check
answers: 1 entry` for each.

## 8. A backup, and a restore check

Host:

```sh
allvibe backup guestbook
allvibe restore-check guestbook
```

The backup ends with the file it wrote on the backup disk and `prod v1, 1
entry when it was taken`. The restore check puts that backup into a scratch
copy, starts the app against it, and ends:

```
ok   4/4 the app's own health check passes against the copy
       allvibe-guestbook:v1 against the restored copy: {"ok":true,"entries":1,"environment":"restore-check","version":"v1"}
       guestbook entries in the restored copy: 1 (prod had 1 when the backup was taken)
     the scratch copy, its network and the decrypted file are removed; prod was not touched
```

## 9. The daily backup

Host:

```sh
systemctl list-timers allvibe-backup.timer
systemctl start allvibe-backup.service
allvibe runs
```

The timer is listed with its next run (every night between 03:30 and 04:00).
`start` runs tonight's job now: a backup and a restore check of that backup.
`allvibe runs` lists every run so far, the last one `scheduled-backup … ok`.
`allvibe doctor` now shows a line for the project:
`guestbook: last backup less than an hour ago; last restore check … passed`.

## 10. A change in dev

Change the heading, as the service user, who owns the project. Host:

```sh
runuser -u allvibe -- sed -i 's|<h1>Guestbook <span|<h1>Sign our guestbook <span|' /var/lib/allvibe/projects/guestbook/repo/server.js
allvibe dev deploy guestbook
```

Reload **dev** in your browser: the heading says "Sign our guestbook". Reload
**prod**: it still says "Guestbook". A release is a commit, and dev has to run
exactly that commit, so commit it and deploy dev once more:

```sh
allvibe dev commit guestbook "A friendlier heading"
allvibe dev deploy guestbook
```

## 11. A dry run

Host:

```sh
allvibe release guestbook --dry-run
```

Every step says `ok`; the ones that would change something say `would …`. It
ends:

```
Every check passed. Nothing was changed: prod still runs v1.
```

## 12. The release

Host:

```sh
allvibe release guestbook
```

Thirteen steps: dev runs the commit, the recovery key is confirmed, a fresh
backup, a restore check of it, prod built and deployed on v2, prod answers, the
tag. It ends:

```
guestbook v2 is live. Rollback: allvibe rollback guestbook
```

Reload **prod**: "Sign our guestbook", and your entry is still there.

## 13. A release that breaks, and rolls itself back

In your browser, sign the **prod** guestbook twice with **the same name**, say
"Fredrik". Now make a change that works in dev and not in prod: a migration
that allows each name only once. Dev has one entry per name; prod now has two
with the same name. Host:

```sh
printf -- '-- One entry per name.\nalter table entries add constraint entries_name_unique unique (name);\n' | runuser -u allvibe -- tee /var/lib/allvibe/projects/guestbook/repo/migrations/002_unique_names.sql
allvibe dev deploy guestbook
allvibe dev commit guestbook "One entry per name"
allvibe dev deploy guestbook
allvibe release guestbook
```

Dev takes it without complaint. The release gets as far as deploying v3, and
then:

```
FAIL 11/13 prod deployed on v3
       prod's app did not come up healthy on v3: …
       it said: error: could not create unique index "entries_name_unique"

prod did not come up on v3. Going back to v2 automatically, keeping prod's data.
…
guestbook is back on v2, with its data. v3 was not released; its image and backup are kept for a look.
```

Reload **prod**: v2, every entry still there, both of Fredrik's included.

## 14. A rollback by hand

First, see what rule 8 means: ask for the data to go back too, as it was before
v2 was released, without confirming. Host:

```sh
allvibe rollback guestbook --restore-data
```

It changes nothing and says what would be lost:

```
This rollback would also restore data, and that loses data (rule 8):
  prod's data goes back to how it was at <time> UTC, just before v2 was released; everything written to prod since then is lost from prod (prod has 3 entries now; the backup has 1).
A backup of prod as it is now is taken first, so even this can be undone.

To do it: allvibe rollback guestbook --restore-data --confirm-data-loss
```

Do not confirm. The ordinary rollback goes back to the code only:

```sh
allvibe rollback guestbook
```

```
ok   2/4 prod's data
       kept as it is: nothing is restored, so nothing written since the release is lost (rule 8)
…
guestbook is back on v1, with all its data.
```

Reload **prod**: the heading is "Guestbook" again, and every entry is there.

## 15. A release with the backup disk gone

Take the backup disk away. **Test host**, host: `umount /mnt/allvibe-backup`.
**Real machine**: unmount or unplug the USB disk. Then, host:

```sh
allvibe project status guestbook
allvibe release guestbook
allvibe project status guestbook
```

The release stops at the backup:

```
FAIL 3/13 the backup target is off this machine and writable
       /mnt/allvibe-backup is on this machine's own root filesystem, which is not off the machine
stopped at step 3/13. Nothing after it was attempted.
```

(An unplugged disk leaves only its empty mount point, which is on the machine's
own disk.) Both `status` outputs are the same: prod is still on v1, and nothing
was built, tagged or deployed.

## 16. A reboot

Bring the disk back and restart. **Test host**, workstation:

```sh
node test/host/host.mjs restart
```

**Real machine:** plug the disk in and `reboot`. Then, host:

```sh
systemctl is-active allvibe-backup.timer
allvibe doctor
```

`active`, and `doctor` shows the proxy, the backup target and the project again
(give the apps half a minute to become healthy after a restart).

## 17. Clean up

**Test host**, workstation:

```sh
node test/host/host.mjs remove
```

The container, its volumes and its image are gone. Delete `.local/recovery-key.txt`
too; it only opened this test host's backups. **On a real machine**, keep the
recovery key in your password manager, and delete the file from your
workstation.
