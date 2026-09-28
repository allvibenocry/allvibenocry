# Walkthrough: from a fresh host to a release, a rollback, the vault and the agent

This takes you from a fresh Debian 13 host through everything the first three
briefs built. Steps 1 to 16 are the first brief's: installing, a project with
dev and prod, backups and restore checks, a release, a broken release that
rolls itself back, and a manual rollback. Steps 17 to 20 and 22 are the second
brief's: rolling back across a change to the database that only adds, and one
that breaks; the key vault; the key check before every commit; and the coding
agent in its container. Step 21 is the third's: every project container kept off
the machine's own ports and the home network. Step 23 is the fourth's: the agent
signed in to your own Claude account, which only you can do. It takes about an
hour.

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

You should see thirteen steps, `[1/13] This machine` to `[13/13] How the host
is`, each with `changed:` lines, then `allvibe doctor` with only `✓` lines (and
one `i` line saying the test overrides are active, on the test host), `All
green.`, and last:

```
Installed All vibe no cry 0.1.0+<commit>: 35 change(s).
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
ok   5/5 the app's own health check passes against the copy
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
allvibe release guestbook --dry-run --outside-plan "the heading, changed by hand"
```

The change was made by hand, not as the steps of a plan the agent keeps, so a
release needs your reason for putting it live outside any plan, and its record
keeps it (D56; step 25 shows a plan). Every step says `ok`; the ones that would
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
says it is agreed, on a line of its own. Host:

```sh
printf -- '-- One entry per name.\n-- breaking: one entry per name, which older entries may not meet\nalter table entries add constraint entries_name_unique unique (name);\n' | runuser -u allvibe -- tee /var/lib/allvibe/projects/guestbook/repo/migrations/002_unique_names.sql
allvibe dev deploy guestbook
allvibe dev commit guestbook "One entry per name"
allvibe dev deploy guestbook
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

Do not confirm. The ordinary rollback goes back to the code only:

```sh
allvibe rollback guestbook
```

```
ok   3/5 prod's data
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
allvibe release guestbook --outside-plan "a release with the backup disk gone, on purpose"
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
allvibe doctor
```

`active`, and `doctor` shows the proxy, the firewall, the backup target and the
project again
(give the apps half a minute to become healthy after a restart).

## 17. A change to the database that only adds, and back past it

The second brief's steps use a second project, `moods`, so that they start
from a clean prod. Every release now records the database's schema, and a
rollback asks the database which changes the older version does not know
(D35). Host:

```sh
allvibe project create moods
for n in Ada Bo; do curl -s -o /dev/null -d "name=$n&message=hello" http://127.0.0.1:8102/entries; done
```

(`moods` is the second project, so its prod is port 8102 and its dev 8103.
**Test host:** http://localhost:8102/ in your browser; **real machine:** the
address `project create` printed.)

Now a change that only adds: a new column for how the writer felt, and the
code that fills it in.

```sh
R=/var/lib/allvibe/projects/moods/repo
printf -- '-- How the writer felt.\nalter table entries add column mood text;\n' | runuser -u allvibe -- tee $R/migrations/002_add_mood.sql
runuser -u allvibe -- sed -i "s|insert into entries (name, message) values (\$1, \$2)|insert into entries (name, message, mood) values (\$1, \$2, 'happy')|" $R/server.js
allvibe dev deploy moods
allvibe dev commit moods "Remember the mood"
allvibe dev deploy moods
allvibe release moods --outside-plan "remember the mood, by hand"
```

The release's second step reads the new migration:

```
ok   3/16 the migrations since v1 only add, or are marked breaking
       migrations/002_add_mood.sql: only adds
```

and it ends `moods v2 is live.` Sign it once more on v2, then go back to v1:

```sh
curl -s -o /dev/null -d "name=Cy&message=on v2" http://127.0.0.1:8102/entries
allvibe rollback moods
```

```
ok   2/5 prod's database is one v1 can run on
       one migration since v1, and it only adds, so v1 runs on it unchanged:
       migrations/002_add_mood.sql (from v2): only adds
…
ok   5/5 prod answers its smoke check
       prod answers on v1: {"ok":true,"entries":3,"environment":"prod","version":"v1"}

moods is back on v1, with all its data.
```

v1 was written before the column existed, and runs on the database after it:
all three entries are there, and Cy's mood is still in the database.

## 18. A change that breaks, and why it needs your word

Renaming a column is a breaking change: the version before it still reads
the old name. Host:

```sh
printf -- '-- The writer is the author.\nalter table entries rename column name to author;\n' | runuser -u allvibe -- tee $R/migrations/003_name_to_author.sql
runuser -u allvibe -- sed -i -e 's|insert into entries (name, message, mood)|insert into entries (author, message, mood)|' -e 's|select name, message, created_at from entries|select author as name, message, created_at from entries|' $R/server.js
allvibe dev deploy moods
allvibe dev commit moods "The writer is the author"
allvibe dev deploy moods
allvibe release moods --outside-plan "the writer is the author, by hand"
```

Dev takes it. The release refuses at its second step, before anything
changes:

```
FAIL 3/16 the migrations since v1 only add, or are marked breaking
       migrations/003_name_to_author.sql is a breaking change: "alter table entries rename column name to author": it changes the table in a way older code may not expect (rename column name).
       The version before it could not run on the database after it, so going back would mean losing data.
       If that is agreed, say so in the file, on a line of its own: -- breaking: <what it changes>
```

`allvibe project status moods` shows prod still on v1: no backup, no image, no
tag. Agree to it, in the file, and release:

```sh
printf -- '-- The writer is the author.\n-- breaking: renames name to author, and versions before it still read name\nalter table entries rename column name to author;\n' | runuser -u allvibe -- tee $R/migrations/003_name_to_author.sql
allvibe dev commit moods "Agree that renaming the writer is breaking"
allvibe dev deploy moods
allvibe release moods --outside-plan "the writer is the author, marked breaking"
curl -s -o /dev/null -d "name=Di&message=on v3" http://127.0.0.1:8102/entries
```

The release says the migration is `breaking, and marked so`, and v3 goes
live. Now try to go back by code alone:

```sh
allvibe rollback moods
```

```
FAIL 2/5 prod's database is one v1 can run on
       v1 was not written for the database as it is now. Since v1, this migration has changed it in a way v1 cannot run on:
         migrations/003_name_to_author.sql (from v3): it is marked breaking: renames name to author, and versions before it still read name
       Going back to v1's code alone would run it on data it does not understand, so this rollback stops here and nothing is changed.
```

Nothing changed: prod still answers on v3. Going back means putting the data
back too, which says first what it loses:

```sh
allvibe rollback moods --restore-data
allvibe rollback moods --restore-data --confirm-data-loss
```

The first says prod's data goes back to just before v3 (`prod has 4 entries
now; the backup has 3`) and changes nothing; the second takes a backup of
prod as it is, restores the one from before v3, and ends `moods is back on
v1, with its data as it was before v3.` Di's entry is gone from prod, and is
in the backup taken first.

## 19. The key vault

Apps get keys, such as an API key for a weather service, from the vault: set
from a file, never typed into a command, encrypted on disk, and handed to the
app as a file (D37). Make two stand-in keys, one for dev and one for prod, in
files only root can read. Host:

```sh
umask 077; head -c 24 /dev/urandom | base64 > /root/weather-dev; head -c 24 /dev/urandom | base64 > /root/weather-prod; umask 022
allvibe key set moods dev WEATHER_API_KEY < /root/weather-dev | tee /root/key-set-dev.out
allvibe key set moods prod WEATHER_API_KEY < /root/weather-prod | tee /root/key-set-prod.out
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
node test/host/host.mjs exec -- sh /root/vault-check.sh allvibe moods /root/weather-dev /root/weather-prod
```

Every count is `0` (command outputs and run records, the journal, `docker
inspect`, container logs, every process's arguments and environment, the
repository and its history, the vault's files, the backup disk), except the
copy in memory, which the app reads, at `1`. From inside dev's app: `holds
dev's value: 1`, `holds prod's value: 0`. The vault goes into every backup, and
the restore check proves it comes back. Host:

```sh
allvibe backup moods
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
allvibe project status moods
```

`active`: the unit put every key back before Docker started the apps, and both
of moods' apps are `running, healthy`.

## 20. The key check before every commit

Every commit in a project is checked for anything that looks like a key, and
stopped if it finds one, whether you commit or the agent does (D38). A script
makes a fake key at random, so no key is ever written into these instructions,
plants it, and commits it both ways. Workstation:

```sh
node test/host/host.mjs push test/host/key-check.sh /root/
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
node test/host/host.mjs exec -- sh /root/lan-fixtures.sh
```

**Real machine:** it has SSH already. For the device, add the address of a real
one on your home network and a port it answers on (a printer, say) to the probe
below, after `moods`.

Now probe it. Workstation:

```sh
node test/host/host.mjs push test/host/app-isolation.sh /root/
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
Host:

```sh
umask 077; head -c 24 /dev/urandom | base64 > /root/anthropic-key; umask 022   # only without a real key
allvibe key set moods agent ANTHROPIC_API_KEY < /root/anthropic-key
allvibe agent start moods
```

The first start builds the agent's image, about a minute. It ends:

```
ok   7/7 Claude Code answers in it
       claude --version: 2.1.283 (Claude Code)
       open it: allvibe agent shell moods
```

Now probe it from inside. Workstation:

```sh
node test/host/host.mjs push test/host/agent-isolation.sh /root/
node test/host/host.mjs exec -- sh /root/agent-isolation.sh allvibe moods /root/weather-prod /root/weather-dev /root/anthropic-key
```

From inside the agent: prod refused by name and by address; the machine's own
ports, prod's door among them, the router, the device and link-local refused;
the Docker socket, both backup keys, the backup disk and prod's keys absent;
`api.anthropic.com` answering through the egress gate, and every other host
refused by it; dev's app, dev's database and the gate answering; and a fake key
committed from inside the agent stopped by the key check. From inside the gate:
the machine, the router, the device and link-local refused, and the API
answering. The agent's settings say auto mode, and its home is in memory, with
no mount or volume. It ends `75 of 75 as they must be`, and the gate's log lists every
connection it refused.

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

## 23. Signing in with your own Claude account

This one only you can do: the agent signs in to **your own** Claude account,
through Claude Code's own sign-in, and nobody else touches it (D46). The suite
gives Claude Code no key, keeps the login in the agent's memory only, lets it
reach `api.anthropic.com`, `claude.ai` and `platform.claude.com` and nothing
new, and never runs Claude Code for you (D48). You need a Claude plan that
includes Claude Code (Pro, Max, Team or Enterprise), a browser, and about
fifteen minutes.

A scratch project, so nothing else is touched, and the agent in it. Host:

```sh
allvibe project create scratch
allvibe agent start scratch --sign-in account
```

`project create` ends with the scratch project's two addresses; note **dev**'s.
The agent's start ends:

```
ok   2/7 it signs in with your own Claude account
       no API key, and nothing from the key vault: you sign in yourself, through Claude Code's own sign-in, in its shell.
       the login stays in the agent's memory only, and is gone when the agent stops (D46)
…
ok   5/7 its only way out: api.anthropic.com, claude.ai, platform.claude.com, over HTTPS
…
ok   7/7 Claude Code is in it
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
allvibe agent start scratch --sign-in account
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

## 24. Clean up

**Test host**, workstation:

```sh
node test/host/host.mjs remove
```

The container, its volumes and its image are gone. Delete `.local/recovery-key.txt`
too; it only opened this test host's backups. **On a real machine**, keep the
recovery key in your password manager, and delete the file from your
workstation; and on the machine, delete the stand-in keys in `/root`
(`weather-dev`, `weather-prod`, `anthropic-key`) and the probes' `.out` files,
and the scratch project: `allvibe project remove scratch --delete-everything`.
