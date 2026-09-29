# Walkthrough: from a fresh host to a release, a rollback, the vault and the agent

This takes you from a fresh Debian 13 host through everything the first five
briefs built. Steps 1 to 16 are the first brief's: installing, a project with
dev and prod, backups and restore checks, a release, a broken release that
rolls itself back, and a manual rollback. Steps 17 to 20 and 22 are the second
brief's: rolling back across a change to the database that only adds, and one
that breaks; the key vault; the key check before every commit; and the coding
agent in its container. Step 21 is the third's: every project container kept off
the machine's own ports and the home network. Step 23 is the fourth's: the agent
signed in to your own Claude account, which only you can do. Steps 24 to 28 are
the fifth's: a release only after you have tried every step of its plan; going
back behind a fresh backup; doctor every night; mains and battery; and what the
agent did, and its conversations. Steps 29 and 30 are the sixth's: the control
panel in your browser, from its first visit to a step tried, put live and gone
back from; they need only steps 1, 2, 5 and 6, and take about twenty minutes.
All of it takes about two hours.

It works on the **test host** (a container on your workstation, D14) and,
unchanged, on a **real Debian 13 machine** later. Where the two differ, and
only in three places (getting a fresh host, the backup disk's path, and the
address in the browser), the text says so.

## Before you start

On your workstation, in this repository, with Node 22 and Docker:

```sh
npm ci
```

```sh
npm run bundle
```

You should see `bundle: bundle/allvibe-0.1.0 (0.1.0+<commit>)`.

**One command per block.** Every block below holds one command: paste it, and
press Enter if your terminal waits for it. A block of output (no `sh` on it)
is what you should see, not something to type.

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
overrides /etc/allvibe/test-overrides: memory-mb=16384, system-disk=ssd, external-backup-mount=/mnt/allvibe-backup, apps-host=localhost
ports     test host 8099-8119 -> http://localhost:8099-8119 on this workstation
panel     test host 80 -> http://allvibe.local:8120/ (a browser mapping allvibe.local to 127.0.0.1), or http://localhost:8120/
ready     a fresh Debian 13 host. Next: node test/host/host.mjs shell
```

(`create` instead of `reset` if there is no test host yet.)

**Real machine:** install Debian 13 (x86-64) on it, with an SSH server and your
key, and nothing else.

## 2. Install

Workstation:

```sh
node test/host/host.mjs push bundle/allvibe-0.1.0 /root/
```

```sh
node test/host/host.mjs exec -- bash /root/allvibe-0.1.0/install.sh
```

You should see sixteen steps, `[1/16] This machine` to `[16/16] How the host
is`, each with `changed:` lines, then `allvibe doctor` with only `✓` lines (and,
on the test host, two `i` lines: that it has no battery, and that the test
overrides are active), `All green.`, and last:

```
Installed All vibe no cry 0.1.0+<commit>: <n> change(s).

The control panel: http://allvibe.local/
  (from a device that cannot find .local names: http://<address>/)
Its setup code, for your first visit: <four groups of four>
It works once. It is shown here, on the machine, and nowhere else.
```

Keep the setup code for step 29. It takes a minute or two: most of it is
Docker Engine arriving from Docker's own repository, and the control panel's
image being built from the pinned Node.js image.

## 3. Install again

Workstation, the same command:

```sh
node test/host/host.mjs exec -- bash /root/allvibe-0.1.0/install.sh
```

Every step now says `unchanged:`, and the last lines are:

```
Nothing changed: this machine was already set up, and everything checked above is as it should be.

The control panel: http://allvibe.local/
  (from a device that cannot find .local names: http://<address>/)
It waits for the setup code shown when it was made. A new one, which replaces it: sudo allvibe panel setup-code
```

## 4. The warnings (test host only)

A container cannot measure memory or its disk, so the test host declares them.
Declare an old machine instead. Workstation:

```sh
node test/host/host.mjs override set memory-mb=4096
```

```sh
node test/host/host.mjs override set system-disk=rotational
```

```sh
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
```

```sh
node test/host/host.mjs override set system-disk=ssd
```

**Real machine:** skip this. If it has less than 8 GB or a spinning disk, step 2
of the installation showed the warning for real.

## 5. Connect the backup disk

Backups go to a directory on **another disk**. On the test host that is the
volume mounted at `/mnt/allvibe-backup`. **On a real machine**, it is where your
USB disk or NAS share is mounted, for example `/mnt/backup`: use that path
instead in this step.

Host (`node test/host/host.mjs shell`), a folder on the machine's own disk
first:

```sh
install -d -o allvibe -g allvibe /var/backups/not-a-disk
```

```sh
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
```

```sh
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

**A name of its own.** Every project in this walkthrough is made on a name
that is first made free: if a project with that name is already on this host,
from an earlier run, it is removed, with everything in it. On a fresh host
there is none, and the removal says `there is no project called guestbook`,
which is fine. Host:

```sh
allvibe project remove guestbook --delete-everything
```

Check that it is gone:

```sh
allvibe project list
```

guestbook is not in the list (on a fresh host: `No projects yet.`). Now make
it:

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
  localhost). The ports in this walkthrough are a fresh host's; on a host with
  other projects, use the ports `project create` printed.
- **Real machine:** the two addresses it printed, from any computer or phone on
  the same network.

Each shows "Guestbook" with a badge: green **prod**, orange **dev**. Sign each
guestbook with a different message, and reload both: each shows only its own
entry. They share nothing.

Host, to see the same from the machine's side:

```sh
allvibe project status guestbook
```

`status` shows prod on `v1` and dev, both `running, healthy`, and `check
answers: 1 entry` for each.

## 8. A backup, and a restore check

Host:

```sh
allvibe backup guestbook
```

Then the restore check:

```sh
allvibe restore-check guestbook
```

The backup ends with the file it wrote on the backup disk and `prod v1, 1
entry when it was taken`. The restore check puts that backup into a scratch
copy, starts the app against it, and ends:

```
ok   5/5 the app's own health check passes against the copy
       allvibe-guestbook:v1 against the restored copy: {"ok":true,"entries":1,"environment":"restore-check","version":"v1"}
       guestbook entries in the restored copy: 1 (prod had 1 when the backup was taken)
     the scratch copy, its network and the decrypted file are removed; prod was not touched
```

## 9. The daily backup

Host:

```sh
systemctl list-timers allvibe-backup.timer
```

The timer is listed with its next run (every night between 03:30 and 04:00).
Run tonight's job now, a backup and a restore check of that backup:

```sh
systemctl start allvibe-backup.service
```

Then:

```sh
allvibe runs
```

It lists every run so far, the last one `scheduled-backup … ok`.
`allvibe doctor` now shows a line for the project:
`guestbook: last backup less than an hour ago; last restore check … passed`.

## 10. A change in dev

Change the heading, as the service user, who owns the project. Host:

```sh
runuser -u allvibe -- sed -i 's|<h1>Guestbook <span|<h1>Sign our guestbook <span|' /var/lib/allvibe/projects/guestbook/repo/server.js
```

Then deploy dev:

```sh
allvibe dev deploy guestbook
```

Reload **dev** in your browser: the heading says "Sign our guestbook". Reload
**prod**: it still says "Guestbook". A release is a commit, and dev has to run
exactly that commit, so commit it:

```sh
allvibe dev commit guestbook "A friendlier heading"
```

and deploy dev once more:

```sh
allvibe dev deploy guestbook
```

## 11. A dry run

Host:

```sh
allvibe release guestbook --dry-run --outside-plan "the heading, changed by hand"
```

The change was made by hand, not as the steps of a plan the agent keeps, so a
release needs your reason for putting it live outside any plan, and its record
keeps it (D56; step 24 shows a plan). Every step says `ok`; the ones that would
change something say `would …`. It ends:

```
Every check passed. Nothing was changed: prod still runs v1.
```

## 12. The release

Host:

```sh
allvibe release guestbook --outside-plan "the heading, changed by hand and tried in dev"
```

Sixteen steps: dev runs the commit, the plan (here, outside any plan, with your
reason), its migrations only add, the recovery key is confirmed, a fresh
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
with the same name. A new constraint is a breaking change (D35), so the file
says it is agreed, on a line of its own. Host, the migration:

```sh
printf -- '-- One entry per name.\n-- breaking: one entry per name, which older entries may not meet\nalter table entries add constraint entries_name_unique unique (name);\n' | runuser -u allvibe -- tee /var/lib/allvibe/projects/guestbook/repo/migrations/002_unique_names.sql
```

Dev, then the commit, then dev again on that commit:

```sh
allvibe dev deploy guestbook
```

```sh
allvibe dev commit guestbook "One entry per name"
```

```sh
allvibe dev deploy guestbook
```

And the release:

```sh
allvibe release guestbook --outside-plan "one entry per name, by hand"
```

Dev takes it without complaint. The release gets as far as deploying v3, and
then:

```
FAIL 14/16 prod deployed on v3
       prod's app did not come up healthy on v3: …
       it said: error: could not create unique index "entries_name_unique"

prod did not come up on v3. Going back to v2 automatically, keeping prod's data.
…
guestbook is back on v2, with its data. v3 was not released; its image and backup are kept for a look.
```

The migration failed inside its transaction, so the database is as it was:
the automatic rollback's check says `it has no migration that v2 does not
know`, and goes ahead. Reload **prod**: v2, every entry still there, both of
Fredrik's included.

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

Do not confirm. The ordinary rollback goes back to the code only, and, since it
changes the live app, first takes a fresh backup of prod and checks that it
restores, as a release does (D57):

```sh
allvibe rollback guestbook
```

```
ok   6/14 an encrypted backup of prod, on the target
       /mnt/allvibe-backup/allvibe/guestbook/releases/guestbook-prod-<time>.dump.age (3.7 kB, sha256 …)
       encrypted to this machine's backup key and to the recovery key; prod v2, 3 entries when it was taken
…
ok   11/14 the app's own health check passes against the copy
…
ok   12/14 prod's data
       kept as it is: nothing is restored, so nothing written since the release is lost (rule 8)
…
guestbook is back on v1, with all its data. The backup taken first: /mnt/allvibe-backup/allvibe/guestbook/releases/guestbook-prod-<time>.dump.age.
```

Reload **prod**: the heading is "Guestbook" again, and every entry is there.

## 15. A release with the backup disk gone

Take the backup disk away. **Test host**, host: `umount /mnt/allvibe-backup`.
**Real machine**: unmount or unplug the USB disk. Then, host, what prod runs
now:

```sh
allvibe project status guestbook
```

The release:

```sh
allvibe release guestbook --outside-plan "a release with the backup disk gone, on purpose"
```

And what prod runs after it:

```sh
allvibe project status guestbook
```

The release stops at the backup:

```
FAIL 5/16 the backup target is off this machine and writable
       /mnt/allvibe-backup is on this machine's own root filesystem, which is not off the machine
stopped at step 5/16. Nothing after it was attempted.
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
```

`active`. And:

```sh
allvibe doctor
```

`doctor` shows the proxy, the firewall, the backup target and the
project again
(give the apps half a minute to become healthy after a restart).

## 17. A change to the database that only adds, and back past it

The second brief's steps use a second project, `moods`, so that they start
from a clean prod. Every release now records the database's schema, and a
rollback asks the database which changes the older version does not know
(D35). A name of its own first, as in step 7. Host:

```sh
allvibe project remove moods --delete-everything
```

```sh
allvibe project list
```

moods is not in the list. Make it:

```sh
allvibe project create moods
```

and sign its prod twice:

```sh
for n in Ada Bo; do curl -s -o /dev/null -d "name=$n&message=hello" http://127.0.0.1:8102/entries; done
```

(`moods` is the second project, so its prod is port 8102 and its dev 8103.
**Test host:** http://localhost:8102/ in your browser; **real machine:** the
address `project create` printed.)

Now a change that only adds: a new column for how the writer felt, and the
code that fills it in. The migration:

```sh
printf -- '-- How the writer felt.\nalter table entries add column mood text;\n' | runuser -u allvibe -- tee /var/lib/allvibe/projects/moods/repo/migrations/002_add_mood.sql
```

The code:

```sh
runuser -u allvibe -- sed -i "s|insert into entries (name, message) values (\$1, \$2)|insert into entries (name, message, mood) values (\$1, \$2, 'happy')|" /var/lib/allvibe/projects/moods/repo/server.js
```

Dev, the commit, dev on that commit, and the release:

```sh
allvibe dev deploy moods
```

```sh
allvibe dev commit moods "Remember the mood"
```

```sh
allvibe dev deploy moods
```

```sh
allvibe release moods --outside-plan "remember the mood, by hand"
```

The release's third step reads the new migration:

```
ok   3/16 the migrations since v1 only add, or are marked breaking
       migrations/002_add_mood.sql: only adds
```

and it ends `moods v2 is live.` Sign it once more on v2:

```sh
curl -s -o /dev/null -d "name=Cy&message=on v2" http://127.0.0.1:8102/entries
```

then go back to v1:

```sh
allvibe rollback moods
```

```
ok   2/14 prod's database is one v1 can run on
       one migration since v1, and it only adds, so v1 runs on it unchanged:
       migrations/002_add_mood.sql (from v2): only adds
…
ok   14/14 prod answers its smoke check
       prod answers on v1: {"ok":true,"entries":3,"environment":"prod","version":"v1"}

moods is back on v1, with all its data. The backup taken first: …
```

v1 was written before the column existed, and runs on the database after it:
all three entries are there, and Cy's mood is still in the database.

## 18. A change that breaks, and why it needs your word

Renaming a column is a breaking change: the version before it still reads
the old name. Host, the migration:

```sh
printf -- '-- The writer is the author.\nalter table entries rename column name to author;\n' | runuser -u allvibe -- tee /var/lib/allvibe/projects/moods/repo/migrations/003_name_to_author.sql
```

The code:

```sh
runuser -u allvibe -- sed -i -e 's|insert into entries (name, message, mood)|insert into entries (author, message, mood)|' -e 's|select name, message, created_at from entries|select author as name, message, created_at from entries|' /var/lib/allvibe/projects/moods/repo/server.js
```

Dev, the commit, dev on that commit, and the release:

```sh
allvibe dev deploy moods
```

```sh
allvibe dev commit moods "The writer is the author"
```

```sh
allvibe dev deploy moods
```

```sh
allvibe release moods --outside-plan "the writer is the author, by hand"
```

Dev takes it. The release refuses at its third step, before anything
changes:

```
FAIL 3/16 the migrations since v1 only add, or are marked breaking
       migrations/003_name_to_author.sql is a breaking change: "alter table entries rename column name to author": it changes the table in a way older code may not expect (rename column name).
       The version before it could not run on the database after it, so going back would mean losing data.
       If that is agreed, say so in the file, on a line of its own: -- breaking: <what it changes>
```

`allvibe project status moods` shows prod still on v1: no backup, no image, no
tag. Agree to it, in the file:

```sh
printf -- '-- The writer is the author.\n-- breaking: renames name to author, and versions before it still read name\nalter table entries rename column name to author;\n' | runuser -u allvibe -- tee /var/lib/allvibe/projects/moods/repo/migrations/003_name_to_author.sql
```

Commit it, deploy dev on that commit, and release:

```sh
allvibe dev commit moods "Agree that renaming the writer is breaking"
```

```sh
allvibe dev deploy moods
```

```sh
allvibe release moods --outside-plan "the writer is the author, marked breaking"
```

The release says the migration is `breaking, and marked so`, and v3 goes
live. Sign it once more, on v3:

```sh
curl -s -o /dev/null -d "name=Di&message=on v3" http://127.0.0.1:8102/entries
```

Now try to go back by code alone:

```sh
allvibe rollback moods
```

```
FAIL 2/14 prod's database is one v1 can run on
       v1 was not written for the database as it is now. Since v1, this migration has changed it in a way v1 cannot run on:
         migrations/003_name_to_author.sql (from v3): it is marked breaking: renames name to author, and versions before it still read name
       Going back to v1's code alone would run it on data it does not understand, so this rollback stops here and nothing is changed.
```

Nothing changed, and no backup was taken: the check comes first. Prod still
answers on v3. Going back means putting the data
back too, which says first what it loses:

```sh
allvibe rollback moods --restore-data
```

It says prod's data goes back to just before v3 (`prod has 4 entries now; the
backup has 3`), and changes nothing. Confirm it:

```sh
allvibe rollback moods --restore-data --confirm-data-loss
```

It takes a backup of prod as it is, restores the one from before v3, and ends
`moods is back on v1, with its data as it was before v3.` Di's entry is gone from prod, and is
in the backup taken first.

## 19. The key vault

Apps get keys, such as an API key for a weather service, from the vault: set
from a file, never typed into a command, encrypted on disk, and handed to the
app as a file (D37). Make two stand-in keys, one for dev and one for prod, in
files only root can read. Host, dev's:

```sh
head -c 24 /dev/urandom | base64 | install -m 600 /dev/stdin /root/weather-dev
```

and prod's:

```sh
head -c 24 /dev/urandom | base64 | install -m 600 /dev/stdin /root/weather-prod
```

Put each in the vault, from its file:

```sh
allvibe key set moods dev WEATHER_API_KEY < /root/weather-dev | tee /root/key-set-dev.out
```

```sh
allvibe key set moods prod WEATHER_API_KEY < /root/weather-prod | tee /root/key-set-prod.out
```

And list them:

```sh
allvibe key list moods
```

Each `key set` ends with the app started again with its key:

```
ok   3/3 prod's app, with the key at /run/secrets/WEATHER_API_KEY
       prod's app started again on v1, healthy; it finds the file's path in WEATHER_API_KEY_FILE
```

and `key list` shows names and times, never values. Now look for the values
everywhere they must not be, and from inside dev. Workstation:

```sh
node test/host/host.mjs push test/host/vault-check.sh /root/
```

```sh
node test/host/host.mjs exec -- sh /root/vault-check.sh allvibe moods /root/weather-dev /root/weather-prod
```

Every count is `0` (command outputs and run records, the journal, `docker
inspect`, container logs, every process's arguments and environment, the
repository and its history, the vault's files, the backup disk, the agent's
activity log and conversations), except the
copy in memory, which the app reads, at `1`. From inside dev's app: `holds
dev's value: 1`, `holds prod's value: 0`. The vault goes into every backup, and
the restore check proves it comes back. Host:

```sh
allvibe backup moods
```

```sh
allvibe restore-check moods
```

```
ok   3/5 its key vault restores
       2 keys restored, each one decrypted with this machine's key (not shown): dev WEATHER_API_KEY, prod WEATHER_API_KEY
```

The keys are decrypted into memory only, which a reboot empties. **Test host**,
workstation: `node test/host/host.mjs restart`; **real machine**: `reboot`.
Then, host:

```sh
systemctl is-active allvibe-keys.service
```

`active`: the unit put every key back before Docker started the apps. And:

```sh
allvibe project status moods
```

Both of moods' apps are `running, healthy`.

## 20. The key check before every commit

Every commit in a project is checked for anything that looks like a key, and
stopped if it finds one, whether you commit or the agent does (D38). A script
makes a fake key at random, so no key is ever written into these instructions,
plants it, and commits it both ways. Workstation:

```sh
node test/host/host.mjs push test/host/key-check.sh /root/
```

```sh
node test/host/host.mjs exec -- sh /root/key-check.sh allvibe moods
```

Both commits stop, with:

```
Stopped: this commit has something in it that looks like a key or a password, so nothing was committed.

  config.js, line 1: looks like an Anthropic API key
```

and the key is in no commit and, once the staged copy is unstaged and pruned,
in no object. A clean commit then passes, and with the scanner taken away, the
commit stops rather than pass unchecked.

## 21. The machine and the home network, out of every container's reach

Every project container, the apps, the databases, the agent and its gate, is
refused this machine's own ports and every private, link-local, shared or
multicast address, which is where the router and every other device on the
home network live. The apps still reach the internet, and the home network
still reaches the apps through the proxy (D41). install.sh put the rules in
place, in its step 11, and a check keeps them there. Host:

```sh
allvibe doctor | grep Firewall
```

```
  ✓ Firewall: project containers cannot reach this machine's own ports or the home network (checked 2 minutes ago)
```

**Test host only:** give it what a real machine has around it, an SSH server,
a service on port 9999, and another device on the home network (a network
namespace of its own at `10.99.0.2`, with a service on port 8080). Workstation:

```sh
node test/host/host.mjs push test/host/lan-fixtures.sh /root/
```

```sh
node test/host/host.mjs exec -- sh /root/lan-fixtures.sh
```

**Real machine:** it has SSH already. For the device, add the address of a real
one on your home network and a port it answers on (a printer, say) to the probe
below, after `moods`.

Now probe it. Workstation:

```sh
node test/host/host.mjs push test/host/app-isolation.sh /root/
```

```sh
node test/host/host.mjs exec -- sh /root/app-isolation.sh allvibe moods
```

It tries every target from the machine itself first, where each must answer,
then from inside moods' dev and prod apps and databases, where each must be
refused, and every line ends with its verdict:

```
from inside allvibe-moods-dev-app:
  this machine's SSH, by its address                   ECONNREFUSED                 as it must be
  …
  prod's door, by the gateway, 8102                    ECONNREFUSED                 as it must be
  the router, <its address>:80                         EHOSTUNREACH                 as it must be
  a device on the home network, 10.99.0.2:8080         EHOSTUNREACH                 as it must be
  link-local, 169.254.169.254:80                       EHOSTUNREACH                 as it must be
  the public internet, https://example.com             HTTP 200                     as it must be
  its own database, through its /healthz               HTTP 200 ok                  as it must be
…
what must keep working, from outside the containers:
  …
  the device on the home network, to the door 8102     HTTP 200                     as it must be
59 of 59 as they must be
```

(The router is the one the machine uses: on the test host, Docker's; on a real
machine, yours.) The
rules outlast a restart of Docker, and of the machine. Host:

```sh
systemctl restart docker
```

Then the probe again (workstation, as above): `59 of 59 as they must be`. Then
**test host**, workstation: `node test/host/host.mjs restart`; **real machine**:
`reboot`. Then, host:

```sh
systemctl is-active allvibe-firewall.service allvibe-firewall-check.timer
```

`active` twice, and the probe once more: `59 of 59 as they must be`.

## 22. The coding agent

The agent is Claude Code, unmodified, in a container of its own that can
reach dev and the model's API, and nothing else (D39). It needs an Anthropic
API key, in the vault's `agent` scope, from a file. With a key of your own, put
it in a file on the host that only root can read, say `/root/anthropic-key`;
without one, a stand-in lets everything below run except talking to the model.
Host, only without a real key, the stand-in:

```sh
head -c 24 /dev/urandom | base64 | install -m 600 /dev/stdin /root/anthropic-key
```

The key into the agent's scope of the vault:

```sh
allvibe key set moods agent ANTHROPIC_API_KEY < /root/anthropic-key
```

And the agent:

```sh
allvibe agent start moods
```

The first start builds the agent's image, about a minute. It ends:

```
ok   6/8 its activity log, and a place to keep its conversations
       allvibe-moods-agent-activity started: one line per tool call, to /var/lib/allvibe/projects/moods/agent/log/activity.jsonl
       its conversations are kept in /var/lib/allvibe/projects/moods/agent/transcripts; its login is not
…
ok   8/8 Claude Code answers in it
       claude --version: 2.1.283 (Claude Code)
       open it: allvibe agent shell moods
```

Now probe it from inside. Workstation:

```sh
node test/host/host.mjs push test/host/agent-isolation.sh /root/
```

```sh
node test/host/host.mjs exec -- sh /root/agent-isolation.sh allvibe moods /root/weather-prod /root/weather-dev /root/anthropic-key
```

From inside the agent: prod refused by name and by address; the machine's own
ports, prod's door among them, the router, the device and link-local refused;
the Docker socket, both backup keys, the backup disk and prod's keys absent;
`api.anthropic.com` answering through the egress gate, and every other host
refused by it; dev's app, dev's database and the gate answering; and a fake key
committed from inside the agent stopped by the key check. From inside the gate:
the machine, the router, the device and link-local refused, and the API
answering. From inside the activity logger (step 28): the machine, the router,
the device, link-local, prod and the internet refused. The agent's settings say
auto mode, and its home is in memory, with no mount or volume; its only mounts
are its working copy, the directory its conversations are kept in, and its key.
It ends `89 of 89 as they must be`, and the gate's log lists every connection it
refused.

**With a real key**, open the agent's own session, host:

```sh
allvibe agent shell moods
```

Tell it what you want, for example "Change the page heading to Sign our
guestbook". Following the project's AGENTS.md, it writes a short plan with a
check for each step, and stops after each step for you to try it:
`allvibe dev deploy moods`, then reload dev in your browser. Leave it with
`/exit`. Then, host:

```sh
allvibe agent stop moods
```

It removes the agent, its gate and its activity logger.

## 23. Signing in with your own Claude account

This one only you can do: the agent signs in to **your own** Claude account,
through Claude Code's own sign-in, and nobody else touches it (D46). The suite
gives Claude Code no key, keeps the login in the agent's memory only, lets it
reach `api.anthropic.com`, `claude.ai` and `platform.claude.com` and nothing
new, and never runs Claude Code for you (D48). You need a Claude plan that
includes Claude Code (Pro, Max, Team or Enterprise), a browser, and about
fifteen minutes.

A scratch project, so nothing else is touched, on a name made free first, as
in step 7. Host:

```sh
allvibe project remove scratch --delete-everything
```

```sh
allvibe project list
```

scratch is not in the list. Make it:

```sh
allvibe project create scratch
```

`project create` ends with the scratch project's two addresses; note **dev**'s.
Then the agent in it:

```sh
allvibe agent start scratch --sign-in account
```

The agent's start ends:

```
ok   2/8 it signs in with your own Claude account
       no API key, and nothing from the key vault: you sign in yourself, through Claude Code's own sign-in, in its shell.
       the login stays in the agent's memory only, and is gone when the agent stops (D46)
…
ok   5/8 its only way out: api.anthropic.com, claude.ai, platform.claude.com, over HTTPS
…
ok   8/8 Claude Code is in it
       Claude Code 2.1.283, as published
       open it and sign in: allvibe agent shell scratch
```

Open Claude Code in it. Host:

```sh
allvibe agent shell scratch
```

1. It starts with its welcome and **its text style**: press Enter for the one
   it marks, or pick another.
2. Then **Select login method**. Choose **1. Claude account with
   subscription**. (If you see its prompt instead, type `/login` and Enter.)
3. It shows a long web address, which may run over several lines, and **Paste
   code here if prompted**. The agent cannot open your browser: press `c` to
   copy the address if your terminal allows it, or select all of it with the
   mouse, and open it in **your own browser**, on your workstation or phone.
4. Sign in there as you always do, and allow access. The page then shows a
   code. Copy it, paste it into the terminal at **Paste code here if
   prompted**, and press Enter.
5. `Login successful`: press Enter. Claude Code shows its security notes
   (Enter), and then asks whether you trust `/workspace`, the scratch
   project's working copy. **Its default is "No, exit", which leaves Claude
   Code**: press the down arrow to **Yes, I trust this folder**, then Enter.
6. Its prompt. The line under it says `⏵⏵ auto mode on`: the suite sets that
   mode, and Claude Code checks each of its actions before it runs (D47).

Now ask it for a change, in its prompt:

```
Change the page heading to "Sign our guestbook". Follow AGENTS.md.
```

It writes a short plan, makes the change, **commits it**, and stops for you to
try it (AGENTS.md, D36). Leave Claude Code running, and in a second host
shell check the commit:

```sh
runuser -u allvibe -- git -C /var/lib/allvibe/projects/scratch/repo log --format='%h %an: %s' -3
```

The newest line is by `Claude Code (agent)`, with its plain message. Then
deploy it to dev, and look:

```sh
allvibe dev deploy scratch
```

Reload **dev** in your browser (the dev address `project create` printed; on
the test host, its port on `http://localhost`):
the heading says "Sign our guestbook". **Prod** still says "Guestbook". Tell
the agent that it works, or what does not.

Leave Claude Code with `/exit`. Then stop the agent, start it again, and open
it. Host:

```sh
allvibe agent stop scratch
```

```sh
allvibe agent start scratch --sign-in account
```

```sh
allvibe agent shell scratch
```

It shows its text style and, after Enter, **Select login method** again: the
login went with the container, and nothing of it was left on the machine.
Leave without signing in: press `Ctrl-C` twice, quickly. Then stop it:

```sh
allvibe agent stop scratch
```

**Stopping is not signing out.** The login is gone from this machine, but the
session is still valid at Anthropic until it expires. To end it there too,
type `/logout` in Claude Code before you leave it.

**If the sign-in fails**, before stopping the agent, host:

```sh
docker logs allvibe-scratch-agent-egress | grep refused
```

It names every host the gate refused, and nothing else. A sign-in host that
Claude Code's documentation does not list would show there; adding one is a
decision for the architect (D46), not a change to make by hand.

**Tell what happened**, in your own words: whether you could sign in, whether
the change was made and committed, what dev showed, and whether the second
start asked you to sign in again. That is recorded in STATE.md as tried by you,
exactly as you say it.

## 24. A plan, and a release only after you have tried every step

The agent keeps its plan in `plan.json`, in the project's working copy: each
step with the check you can try (D56). A release reads the plan in the commit
it would put live, and goes ahead only when you have tried every step of it in
dev. Only you can mark a step as tried: the marks live beside the project,
outside the working copy, where the agent cannot reach. Here you write the plan
yourself, as the agent would, with a change to go with it, in a new project
whose history is short, on a name made free first, as in step 7. Host:

```sh
allvibe project remove ideas --delete-everything
```

```sh
allvibe project list
```

ideas is not in the list. Make it:

```sh
allvibe project create ideas
```

The change, a new heading:

```sh
runuser -u allvibe -- sed -i 's|<h1>Guestbook <span|<h1>How are you? <span|' /var/lib/allvibe/projects/ideas/repo/server.js
```

The plan is a file in this repository. Workstation:

```sh
node test/host/host.mjs push docs/walkthrough-files/ask-how-people-are.json /root/
```

Host, the plan into the working copy, as the agent would write it:

```sh
install -o allvibe -g allvibe -m 644 /root/ask-how-people-are.json /var/lib/allvibe/projects/ideas/repo/plan.json
```

Commit, deploy dev on that commit, and look at the plan:

```sh
allvibe dev commit ideas "Ask how people are"
```

```sh
allvibe dev deploy ideas
```

```sh
allvibe plan ideas
```

`allvibe plan` shows the plan dev runs, and where each step stands:

```
ideas: "Ask how people are", as dev runs it (<commit>)
   1. A new heading
      ready for you to try: Open dev: the heading says How are you?
   2. Writing still works
      ready for you to try: Sign the guestbook in dev: your entry is listed.
```

Put it live before trying anything:

```sh
allvibe release ideas
```

```
FAIL 2/16 every step of the plan is tried by you
       the plan "Ask how people are" has steps you have not tried: step 1, "A new heading"; step 2, "Writing still works"

     what would have to be true:
       try each in dev (the test copy), then mark it: allvibe plan tried ideas <step>

stopped at step 2/16. Nothing after it was attempted.
```

Nothing changed: prod still runs v1. Now try both steps in dev (the dev address
`project create` printed; on the test host, its port on http://localhost), and
mark each one you tried:

```sh
allvibe plan tried ideas 1
```

```
step 1, "A new heading": marked as tried by you, in dev at <commit>.
Still to try: step 2, "Writing still works".
```

```sh
allvibe plan tried ideas 2
```

```
step 2, "Writing still works": marked as tried by you, in dev at <commit>.
Every step of "Ask how people are" is tried. It can be put live: allvibe release ideas
```

```sh
allvibe release ideas
```

```
ok   2/16 every step of the plan is tried by you
       "Ask how people are": all 2 steps tried by you, the last <time> UTC
…
ideas v2 is live. Rollback: allvibe rollback ideas
```

Reload **prod**: "How are you?". A plan goes live once. Ask for it again:

```sh
allvibe plan ideas
```

It says `This plan was released in v2. What comes next needs a new plan.`, with
both steps tried by you. A change after it, without a new plan, is outside any
plan, and a release then needs your reason, as in step 11.

## 25. Going back, behind a fresh backup

Going back changes the live app too, so, like a release, it first takes a
fresh backup of prod and checks that it restores (D57): step 14 showed those
steps. When that cannot be done, it changes nothing. Take the backup disk away,
as in step 15. **Test host**, host: `umount /mnt/allvibe-backup`. **Real
machine**: unmount or unplug the USB disk. Then, host:

```sh
allvibe rollback ideas
```

```
ok   1/14 the version to go back to: v1
…
FAIL 4/14 the backup target is off this machine and writable
       /mnt/allvibe-backup is on this machine's own root filesystem, which is not off the machine
…
stopped at step 4/14. Nothing after it was attempted.
```

Prod still runs v2. Bring the disk back as in step 16 (**test host**,
workstation: `node test/host/host.mjs restart`; **real machine**: plug it in and
`reboot`), give the apps half a minute, and go back. Host:

```sh
allvibe rollback ideas
```

Fourteen steps, the backup and its restore check (steps 3 to 11) before prod is
touched, ending:

```
ideas is back on v1, with all its data. The backup taken first: /mnt/allvibe-backup/allvibe/ideas/releases/ideas-prod-<time>.dump.age.
```

That backup is kept with the releases' backups, which are never rotated away:

```sh
allvibe backups ideas
```

```
<time> UTC  release   v1    3.6 kB  ideas-prod-<time>.dump.age
<time> UTC  rollback  v2    3.6 kB  ideas-prod-<time>.dump.age
```

## 26. doctor, every night

Every night, after the backup and its restore check, the machine runs `doctor`
and keeps what it found (D58): the newest in `/var/lib/allvibe/doctor/latest.json`,
and a copy for each of the last fourteen nights, for the control panel to show.
Run tonight's now, then read it back. Host:

```sh
systemctl start allvibe-backup.service
```

```sh
allvibe doctor --last
```

```
All vibe no cry on this machine, as the nightly check found it at <time> UTC

  ✓ Debian GNU/Linux 13 (trixie) on x86-64
…
  ✓ ideas: last backup less than an hour ago; last restore check <time> UTC passed (0 entries)
…
All green.
```

And where it is kept:

```sh
ls /var/lib/allvibe/doctor
```

The directory holds `latest.json` and one dated file for each night so far
(step 9's run made the first).

## 27. Mains and battery

`doctor` now says how the machine is powered (D59). A laptop's battery carries
it through a short power cut; a desktop without one stops at once. Host:

```sh
allvibe doctor | grep Power
```

**Test host:** it has no battery, and says so:

```
  i Power: no battery, so a power cut stops the machine at once (a battery or a small UPS would carry it through a short one)
```

Its probe shows the other answers, with stand-ins for the power supply that
only a test host accepts. Workstation:

```sh
node test/host/host.mjs push test/host/power-fixtures.sh /root/
```

```sh
node test/host/host.mjs exec -- sh /root/power-fixtures.sh allvibe
```

```
mains:
  | ✓ Power: on mains; the battery is at 80%, charging, ready to carry the machine through a power cut (declared by the test host)
…
battery:
  | ! Power: ON BATTERY, at 60%, about 1 hour and 40 minutes left. The apps keep running; plug the machine in (declared by the test host)
…
low:
  | ✗ Power: ON BATTERY, and it is low: at 12%, about 20 minutes left. The machine will switch itself off soon; plug it in now (declared by the test host)
…
12 of 12 as they must be
```

**Real laptop:** `doctor` says `Power: on mains; the battery is at …%, …, ready
to carry the machine through a power cut`. Unplug the charger and run it again:
`Power: ON BATTERY, at …%, …. The apps keep running; plug the machine in`. Plug
it back in.

## 28. What the agent did, and its conversations

Every tool call the agent makes is logged, one line each, outside its reach:
the file it read or wrote, or the first line of the command it ran, and whether
it failed; never a file's contents, and anything that looks like a key is
withheld (D60). Its conversations are kept on the machine too, in no backup;
its login is not.

**With your own account (step 23) or a real key**, start the agent, open its
session, sign in if asked, ask it for something small, for example "List the
files in this project, and tell me what server.js does", and leave with
`/exit`. Host:

```sh
allvibe agent start moods --sign-in account     # or without --sign-in, with a real key
```

```sh
allvibe agent shell moods
```

**Without either**, a probe runs real Claude Code sessions in the agent
against a stand-in for the model, which asks for four tool calls each time,
and checks the log and the conversations. Workstation:

```sh
node test/host/host.mjs exec -- allvibe agent start moods
```

```sh
node test/host/host.mjs push test/host/stub-api.mjs /root/
```

```sh
node test/host/host.mjs push test/host/agent-activity.sh /root/
```

```sh
node test/host/host.mjs exec -- sh /root/agent-activity.sh allvibe moods /root/weather-prod /root/weather-dev /root/anthropic-key
```

One line per call, the written file's path without its content, the fake key
withheld, the failed call marked; a line from dev's app refused; the log out of
the agent's reach, and still written when the agent turns hooks off in the
settings it can write; a transcript for each session, with no stand-in login,
key or vault value in it. It ends `29 of 29 as they must be`.

Either way, see what it did. Host:

```sh
allvibe agent activity moods
```

```
What the agent of moods did, the last 13 of 13 tool calls (UTC; ! = it failed):
  <time>    Bash       ls /workspace
  <time>    Write      /workspace/stub-note.txt
  <time>    Bash       (held something that looks like a key or a password: not logged)
  <time>  ! Bash       ls /no-such-directory
…
```

Stop the agent. The login goes with it; the log and the conversations stay:

```sh
allvibe agent stop moods
```

```
ok   1/1 the agent, its egress gate and its activity logger
       removed allvibe-moods-agent, allvibe-moods-agent-egress, allvibe-moods-agent-activity, network allvibe-moods-agent-egress
```

```sh
allvibe agent transcripts moods
```

```
The conversations of the agent of moods, oldest first, kept in /var/lib/allvibe/projects/moods/agent/transcripts (only on this machine, not in backups):
  <time> UTC     136 kB  <session>.jsonl
…
To delete them all: allvibe agent transcripts moods --delete
```

They are only on this machine, readable only by the service user, and in no
backup. To delete the conversations:

```sh
allvibe agent transcripts moods --delete
```

```
Deleted 3 conversations of the agent of moods. Its activity log is kept.
```

(While the agent runs, that is refused: it may be writing one.) `allvibe
project remove` deletes both the conversations and the log, and says so first.

## 29. The control panel: the first visit

The control panel is where everything here is meant to be done from a browser
(D63, D64). It runs on the machine in a container of its own that reaches
nothing but the engine, which does the work with the same code as the commands
above (D62), and it answers only on the home network. This step and the next
two need only steps 1, 2, 5 and 6; step 31 also needs your Claude account.

The install printed the panel's address and a setup code, last (step 2):

```
The control panel: http://allvibe.local/
  (from a device that cannot find .local names: http://<address>/)
Its setup code, for your first visit: <four groups of four>
It works once. It is shown here, on the machine, and nowhere else.
```

If you no longer have it, host: `allvibe panel setup-code` makes a new one,
which replaces it. Open the panel in your browser:

- **Test host:** http://localhost:8120/ (the port the `panel` line of
  `node test/host/host.mjs status` names; 8120 on a workstation where the
  first ports were free). Your workstation cannot hear the test host's
  multicast DNS, so this is the machine's address, the fallback.
- **Real machine:** http://allvibe.local/, from a computer or phone on the
  same network; or, from a device that does not find it, the address it
  printed.

It opens on **Set up your control panel**. Type the setup code, then a password
of twelve characters or more, twice, and press **Set up and sign in**. You are
signed in, on **Your apps**, with a line at the top about the nightly checks (on
a fresh host, "The nightly checks have not run yet.") and each app with what it
needs next. **Machine health**, in the side bar (on a phone, under **Menu**),
lists the same checks as `allvibe doctor`, in plain words; **Run the checks
again** runs them now.

Press **Sign out**, at the bottom of the side bar. The panel shows **Sign in**.
Type a wrong password and press Enter:

```
That is not the password.
```

Five wrong tries in a row pause signing in for 30 seconds, then longer. Type
the right one: you are back on Your apps. A forgotten password, host: `allvibe
panel reset`: a new setup code, and everyone signed out.

## 30. The control panel: the guided path, one thing at a time, and back

The same as steps 24 and 25, from the browser, one next action at a time. The
plan and its change are written by hand again, as the agent would. A new project, on a name made free
first, as in step 7: this step needs a hello that nobody has used. Host:

```sh
allvibe project remove hello --delete-everything
```

```sh
allvibe project list
```

hello is not in the list. Make it:

```sh
allvibe project create hello
```

A new heading for it:

```sh
runuser -u allvibe -- sed -i 's|<h1>Guestbook <span|<h1>Hello, how are you? <span|' /var/lib/allvibe/projects/hello/repo/server.js
```

The plan is a file in this repository. Workstation:

```sh
node test/host/host.mjs push docs/walkthrough-files/say-hello-2.json /root/
```

Host, the plan into the working copy:

```sh
install -o allvibe -g allvibe -m 644 /root/say-hello-2.json /var/lib/allvibe/projects/hello/repo/plan.json
```

Commit it, and deploy dev on that commit:

```sh
allvibe dev commit hello "Say hello"
```

```sh
allvibe dev deploy hello
```

In the panel, **Your apps** now has **hello**, `v1 is live`, "Say hello. Step 1
is ready for you to try.", and a pink **Try step 1**. Pink is the next action,
and there is only ever one on the screen (D68). Press it.

**The guided path.** At the top of hello's page: **Plan**, ticked, then **Try: 1
of 2**, **Live** and **Done**; one sentence; and one pink button, the next
action, always in that place:

```
Try step 1 in the test copy: Open the test copy: the heading says Hello, how are you?
```

with **Step 1 works**, pink, and **Something is wrong** beside it. On the left
is the plan, `0 of 2 tried`, and under it **Your AI** (step 31). On the right,
**Preview** shows the test copy itself, under a line that says **Test copy**,
with the heading "Hello, how are you?", and above it what the step asks:

```
Step 1, to try: Open the test copy: the heading says Hello, how are you?
```

Open **Live** first: `v2: say hello`, "2 steps left to try before v2 can go
live.", and no way to put it live. Back in **Preview**, press **Something is
wrong**, write a line, and **Save the report**: "Saved with the app. Tell your
AI in its own session to read it." Host, to see it where the AI will read it:

```sh
cat /var/lib/allvibe/projects/hello/reports/*-something-is-wrong.txt
```

Press **Step 1 works**: step 1 is ticked, `1 of 2 tried`, and the next action
is **Try step 2**, "Step 2 is ready: writing still works." Press it.

**What you type in the test copy stays.** In the frame, type your name into the
guestbook's form, and do not sign yet. Open **Live**, then **Preview** again:
your name is still in the form (friction log 5). The frame starts again only
when the test copy itself does. Now sign the guestbook in the frame: your entry
is listed, as step 2 asks. Press **Step 2 works**. The panel moves on to **Live**
by itself:

```
Every step is tried. Next: put v2 live.
```

and the next action is **Put v2 live**.

**A step you have not tried.** Do not press it yet. The page looks for changes
every fifteen seconds, except while a dialog is open, so open **More**, then
**Backups**, and leave it open. The builder now adds a step. Workstation:

```sh
node test/host/host.mjs push docs/walkthrough-files/say-hello-3.json /root/
```

Host, the button's new words:

```sh
runuser -u allvibe -- sed -i 's|>Sign the guestbook</button>|>Say hello</button>|' /var/lib/allvibe/projects/hello/repo/server.js
```

The plan with its third step:

```sh
install -o allvibe -g allvibe -m 644 /root/say-hello-3.json /var/lib/allvibe/projects/hello/repo/plan.json
```

Commit, and deploy dev on that commit:

```sh
allvibe dev commit hello "A friendlier button"
```

```sh
allvibe dev deploy hello
```

Close the dialog (Escape) and press **Put v2 live**, which the page still shows:

```
v2 is not live
Nothing changed. It stopped at "every step of the plan is tried by you": the
plan "Say hello" has steps you have not tried: step 3, "A friendlier button"
```

with what would have to be true, and where to go on from here. The six safety
checks below it stop at the first, **Tried by you**. The next action at the top
is **OK**. Press it: "Step 3 is ready: a friendlier button." Press **Try step
3**, look at the button in the frame, and press **Step 3 works**. The next
action is **Put v2 live** again.

**A backup that cannot be taken.** Take the backup disk away. **Test host**,
host (on the test host, the engine has its own view of the disks, so it starts
again to see the change):

```sh
umount /mnt/allvibe-backup
```

```sh
systemctl restart allvibe-engine
```

**Real machine**: unmount or unplug the USB disk. In the panel, press **Put v2
live**:

```
v2 is not live
Nothing changed. It stopped at "the backup target is off this machine and
writable": /mnt/allvibe-backup is on this machine's own root filesystem, which
is not off the machine
```

The checks show **Tried by you** done and **Backup taken** stopped. **Every
check, as the machine ran it** opens the steps themselves, as `allvibe release`
prints them. Press **OK**. Bring the disk back as in step 16 (**test host**,
workstation: `node test/host/host.mjs restart`; **real machine**: plug it in
and `reboot`), give the apps half a minute, reload the panel and sign in again
(a restart signs everyone out).

**Put it live, one thing at a time.** Open **hello** again and press **Put v2
live**. The six checks fill in as the machine runs them: **Tried by you**,
**Backup taken**, **Backup restored and checked**, **v2 started**, **v2
answers**, **Live**. While they do, take a backup of hello from the machine.
Host:

```sh
allvibe backup hello
```

```
A release of hello is already running, started from the panel just now. Wait for it to end, then try again.
```

It changed nothing: the panel and the commands take the same lock, one per app,
and whoever comes second is told so (D72). In less than a minute:

```
v2 is live.
Nothing lost. The version before it is kept below, so you can go back any time.
```

At the top, the guided path is at **Done**: "v2 is live. Everyone on your home
network uses it now.", with three choices: **Open the app**, pink, **Start
something new**, and **Something feels wrong? Go back to v1**. Press **Open the
app**: the live app, in a tab of its own, "Hello, how are you?", and the button
says Say hello. Write an entry there. Back in the panel, **Earlier versions** has
v2, **Live now**, and v1 with **Go back to v1**. **More**, **Backups**: the
backup the release took first, `Before a release`.

**Go back.** Press **Something feels wrong? Go back to v1**. The dialog says
your data stays, and that a fresh backup is taken and checked first; press **Go
back to v1**. Six checks again, from **It can go back** to **v1 answers**, then:

```
Back on v1.
Your data is as it was. The backup taken first is kept with the others.
```

Reload the live app: "Guestbook" again, and the entry you wrote on v2 is still
there. Host, the same from the machine's side: `allvibe project status hello`
says prod runs v1, with 1 entry.

**Machine health**, **Run the checks again**: hello's backups are fine, with
the restore check that going back ran: `hello: last backup less than an hour
ago; last restore check <time> UTC passed, in going back (1 entry)`. A release
and going back each restore-check the backup they take, and Machine health
counts it (D73; friction log 4).

Everything the panel did, it did through the engine, with the same steps as the
commands: `ls /var/lib/allvibe/runs/` lists the release and the rollback.

## 31. Your AI in the panel: a new app, and your own sign-in

This step ends with what only you can do: signing in to your own Claude
account, in Claude Code's own terminal, in the panel (D69, D77). The panel
carries your keys in and Claude Code's screen out, never types into it, and
keeps nothing of what passes (D48). You need what step 23 needs: a Claude plan
that includes Claude Code, and about fifteen minutes.

A new app, made in the panel, on a name made free first, as in step 7. Host:

```sh
allvibe project remove notes --delete-everything
```

```sh
allvibe project list
```

notes is not in the list. In the panel, on **Your apps**, press **Make a new
app**. It says what it will be: a small guestbook, with a test copy and a live
app of its own. Type `notes` as its name and press **Make it**. Its steps show
as they run, and in about a minute the panel opens **notes**, at **Plan**:

```
Start your AI, and tell it what you want to build. It works in the test copy, never the live app.
```

The next action is **Start your AI**. On the left, under the plan, **Your AI**
asks how it signs in: **Sign in with your Claude account** ("In the terminal,
when it starts.") or **Use the key in the vault**, which stays off while notes
has no key there. Keep **Sign in with your Claude account** and press **Start
your AI**: "Starting your AI. The first time takes a minute or two." (the first
start on a machine builds the agent's image). Then Claude Code's own terminal
opens under the plan, and above it:

```
Claude Code. It signs in with your Claude account.
```

Every key goes to Claude Code, Tab and Escape too; to leave its terminal with
the keyboard, press Ctrl + ]. In the terminal, as in step 23:

1. Its welcome and **its text style**: press Enter for the one it marks.
2. **Select login method**. From here on, the steps are yours alone: choose
   **1. Claude account with subscription**.
3. It shows a long web address and **Paste code here if prompted**. Click the
   address: it opens in a tab of its own (the panel opens only `https`
   addresses). Sign in there as you always do, and allow access. Copy the code
   the page then shows, paste it into the terminal (Ctrl+V) and press Enter.
4. `Login successful`: press Enter. Its security notes: Enter. Then it asks
   whether you trust `/workspace`, notes's working copy. **Its default is "No,
   exit"**: press the down arrow to **Yes, I trust this folder**, then Enter.
5. Its prompt, with `⏵⏵ auto mode on` under it (D47). The next action at the
   top is now **Go to your AI**, which puts the keyboard in the terminal.

**A first small change.** Type in Claude Code's prompt:

```
Change the page heading to "Our notes". Follow AGENTS.md.
```

It writes a plan, commits it, builds the step, commits it, and stops for you to
try it (AGENTS.md, D36, D56). The panel sees each commit: the next action
becomes **Update the test copy** ("Your AI has changed the app since the test
copy started."). Press it: the test copy starts again on what the AI committed,
the plan shows on the left, and the guided path goes on as in step 30: **Try
step 1** (the heading in the frame says "Our notes"), **Step 1 works**, **Put v2
live**, and **v2 is live**. If the AI is still building when you look, the path
says so ("Your AI is building step 1"); press **Update the test copy** again
when it has committed.

**Stopping.** Press **Stop your AI**, under the plan. The dialog says what
stays, and that stopping is not signing out: to end your sign-in at Anthropic
too, type `/logout` in Claude Code first. Then press **Stop your AI** in the
dialog: its terminal goes, and the choice of how it signs in comes back.

**Tell what happened**, in your own words: whether you could sign in in the
panel's terminal, whether the change was planned, made and committed, what the
test copy and the live app showed, and anything that got in your way. That is
recorded in STATE.md as tried by you, exactly as you say it, and what got in
your way goes in the friction log (D70).

## 32. Clean up

**Test host**, workstation:

```sh
node test/host/host.mjs remove
```

The container, its volumes and its image are gone. Delete `.local/recovery-key.txt`
too; it only opened this test host's backups. **On a real machine**, keep the
recovery key in your password manager, and delete the file from your
workstation; and on the machine, delete the stand-in keys in `/root`
(`weather-dev`, `weather-prod`, `anthropic-key`) and the probes' `.out` files,
and the scratch, ideas, hello and notes projects: `allvibe project remove
scratch --delete-everything`, `allvibe project remove ideas
--delete-everything`, `allvibe project remove hello --delete-everything` and
`allvibe project remove notes --delete-everything`.
