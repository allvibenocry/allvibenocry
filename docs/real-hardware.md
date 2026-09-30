# Real hardware: from a blank laptop to a working suite

This takes your first real machine, an old laptop with an SSD and a USB disk
for its backups, from blank to a working suite: Debian 13, the suite, the
backup disk, the recovery key, the control panel and a first app. It is
[walkthrough.md](walkthrough.md) for a real machine, and does what the
walkthrough says a real machine does. It ends with a checklist: every item of
"To verify on real hardware" in [STATE.md](../STATE.md), with how to check it
and what you should see. Sections 1 to 12 take an afternoon; the checklist a
few days, since some checks wait for a night or a flat battery.

## How to read this guide

**One command per block**, and **the line just above each block says where it
runs**:

- **On the workstation (PowerShell):** your Windows computer, in PowerShell,
  in your clone of this repository. Its prompt starts with `PS`.
- **On the laptop, at its own keyboard:** typed on the laptop itself.
- **On the laptop, in a root shell:** a shell on the laptop as root, opened
  from the workstation (section 4). Its prompt starts with `root@` and ends
  with `#`. You leave it with `exit`.

A block with no such line above it is what you should see, not something to
type. Words in angle brackets, such as `<laptop address>`, are yours to fill
in, without the brackets.

Never put a password or a key in a command, and never paste one into a chat
(rule 4 in [CLAUDE.md](../CLAUDE.md)). A password goes only into the Debian
installer, the laptop's login, the prompts of `ssh` and `sudo` in section 4
(once each), and the control panel's own page.

## 1. What you need

- **The laptop**: 64-bit Intel or AMD (x86-64, the only kind version 1
  supports), ideally with 8 GB of memory or more and an SSD; install.sh warns
  about less, and goes on. And its charger.
- **A USB stick** of 1 GB or more, for the Debian installer. It is erased.
- **A USB disk** for the backups. It is erased.
- **A network cable** to your router, if you can: steadier than Wi-Fi for a
  machine that runs day and night.
- **Another device on the home network**: a phone, or another computer.
- **The workstation**: Windows with PowerShell, Node 22 and git, and your clone
  of this repository.

## 2. A Debian 13 USB stick

From https://www.debian.org/distrib/netinst download the **amd64** small
installation image, `debian-13.<x.y>-amd64-netinst.iso`, into Downloads, and
from the same folder on Debian's server the file `SHA512SUMS` beside it. Check
that the image is the one Debian published:

**On the workstation (PowerShell):**
```powershell
(Get-FileHash -Algorithm SHA512 "$HOME\Downloads\<file name>").Hash -eq ((Select-String -SimpleMatch -Path "$HOME\Downloads\SHA512SUMS" -Pattern "  <file name>").Line -split ' ')[0]
```

`True`. `False` means a damaged download: download it again.

Write it with **Rufus** (rufus.ie, free): the stick under Device, the image
under Boot selection, Start. When Rufus asks how to write the image, choose
**Write in DD Image mode**, which copies it exactly as Debian made it. **This
erases everything on the stick.**

## 3. Installing Debian: the choices, and why

**Unplug the USB backup disk**, so the installer cannot offer it as the disk to
install on. Plug in the network cable and the stick, start the laptop, open its
boot menu (a key at start, often F12, F9 or Esc) and choose the stick. Then
**Install** (Graphical install asks the same).

- **Language, location, keyboard**: yours. The location sets the time zone,
  which the nightly backup's 03:30 follows.
- **Host name**: anything, for example `homeserver`: the control panel is
  found as `allvibe.local` whatever it is. **Domain name**: empty.
- **Root password: leave it empty**, both times. Debian then locks the root
  account and gives the user you make next `sudo`, which is how everything
  below becomes root.
- **The user**: your name, a short lowercase user name, and a strong password
  used nowhere else.
- **Partitioning**: **Guided - use entire disk**; the laptop's **internal SSD**
  (by name and size: the installer's own stick is listed too); **All files in
  one partition**; **Finish partitioning and write changes to disk**; Yes. The
  whole SSD in one partition, because Docker's images, the apps and their
  databases all live under `/var`. Not encrypted: the laptop must start by
  itself after a power cut, with nobody to type a passphrase; disk encryption
  at install is planned, not built ([roadmap](roadmap.md)).
- **Package manager**: a mirror in your country (`deb.debian.org` is fine), no
  proxy.
- **Software selection**: **untick** "Debian desktop environment" and every
  desktop under it; **tick** "SSH server" and "standard system utilities". No
  desktop: it is a server, nobody sits at it, and a desktop is more to update
  and takes memory the apps need. SSH, so you run every command from the
  workstation.
- **GRUB**: yes, on the internal SSD if it asks where.

At the end, take the stick out and let it restart.

## 4. After the first boot: address, SSH, sudo and the harness

Log in on the laptop, and find its address:

**On the laptop, at its own keyboard:**
```sh
ip -4 addr
```

Look for `inet` under the network card, not under `lo`:

```text
2: enp0s31f6: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...
    inet 192.0.2.23/24 brd 192.0.2.255 scope global dynamic enp0s31f6
```

Here `192.0.2.23`; yours differs. This guide calls it `<laptop address>`. Log
out with `exit`: from here on you work from the workstation.

**Keep the address the same.** In your home router's settings, find the list of
devices it has given an address to, and make a reservation (a "static lease")
for the laptop at the address it has now. The router then always gives it that
address, so the panel, your bookmarks and these commands keep finding it.

**A key for SSH.** If your Windows home folder has `.ssh\id_ed25519.pub`
already, skip this block:

**On the workstation (PowerShell):**
```powershell
ssh-keygen -t ed25519
```

Enter for the file it offers. The suite's SSH runs with `BatchMode=yes`, which
never asks for anything, so a key with a passphrase works only while Windows'
ssh-agent holds it, which this guide does not cover. Without one (Enter twice)
the key is as safe as your Windows account.

Put its public half on the laptop. `ssh` asks for the laptop user's password
this once (and, the first time, whether to trust the laptop: `yes`):

**On the workstation (PowerShell):**
```powershell
Get-Content $HOME\.ssh\id_ed25519.pub | ssh <your user name>@<laptop address> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**sudo without a password.** The harness runs `sudo -n`, which fails rather
than ask: "the user needs root, or sudo without a password"
([local.example.env](../local.example.env)). Open a root shell the one way that
asks for your password, at `sudo`'s prompt:

**On the workstation (PowerShell):**
```powershell
ssh -t <your user name>@<laptop address> sudo -i
```

**On the laptop, in a root shell:**
```sh
echo '<your user name> ALL=(ALL) NOPASSWD: ALL' | install -m 440 /dev/stdin /etc/sudoers.d/90-nopasswd
```

**On the laptop, in a root shell:**
```sh
visudo -c
```

Every file `parsed OK`. If not, a broken rule would lock you out of `sudo`: in
this same shell run `rm /etc/sudoers.d/90-nopasswd` and write it again. Then
leave with `exit`. Whoever has your key now has root on the laptop: keep it on
your workstation. Check the way the harness connects:

**On the workstation (PowerShell):**
```powershell
ssh -o BatchMode=yes <your user name>@<laptop address> sudo -n hostname
```

It prints the laptop's host name, and asks nothing.

**The harness.** The walkthrough's `node test/host/host.mjs` reaches a real
machine once `local.env` names it:

**On the workstation (PowerShell):**
```powershell
Copy-Item local.example.env local.env
```

**On the workstation (PowerShell):**
```powershell
notepad local.env
```

Make its last line `ALLVIBE_TEST_HOST=<your user name>@<laptop address>`, and
save.
`local.env` is gitignored: never commit it (rule 10). While it names the
laptop, every `node test/host/host.mjs` command goes to the laptop, not to the
test host container; empty the line to use the test host again.

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs status
```

```text
test host: a real machine over SSH (ALLVIBE_TEST_HOST is set)
Debian GNU/Linux 13 (trixie)
running
```

From now on, **a root shell on the laptop** is this, and asks for nothing:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs shell
```

## 5. A laptop as a server

**Closing the lid must not put it to sleep.** systemd-logind decides what the
lid does: a file of its own tells it to ignore the lid on battery, on mains and
in a dock.

**On the laptop, in a root shell:**
```sh
printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n' | install -D -m 644 /dev/stdin /etc/systemd/logind.conf.d/lid.conf
```

**On the laptop, in a root shell:**
```sh
systemctl restart systemd-logind
```

Close the lid, wait a minute, and ask:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs status
```

Still `running`.

**Power on when the mains comes back.** The battery carries the laptop through
a short power cut; a longer one empties it, and the laptop stays off when the
power returns unless its firmware switches it on. In the firmware's setup (a
key at start, often F1, F2 or Del), look for a setting such as "AC recovery",
"power on with AC attach" or "after power loss: power on", and turn it on if it
is there. The suite's `doctor` says whether the laptop runs on mains or on
battery, and how long the battery would last (D59).

## 6. The backup disk

Plug the USB backup disk in, and find it:

**On the laptop, in a root shell:**
```sh
lsblk -o NAME,SIZE,TYPE,TRAN,MOUNTPOINTS
```

```text
NAME          SIZE TYPE TRAN MOUNTPOINTS
sda           1.8T disk usb
nvme0n1     238.5G disk nvme
├─nvme0n1p1   976M part      /boot/efi
├─nvme0n1p2 236.5G part      /
└─nvme0n1p3   977M part      [SWAP]
```

The backup disk has `usb` under TRAN, its own size, and nothing mounted: here
`sda`, which this guide calls `<the disk>`. The disk with `/` is the system
disk: never that one. (An internal SATA disk is also `sd` something: go by
`usb` and the size.)

The next two commands **erase everything on `<the disk>`**. Read its name once
more. Its old partition table and signatures first:

**On the laptop, in a root shell:**
```sh
wipefs -a /dev/<the disk>
```

Then one ext4 filesystem over the whole disk (if it asks `Proceed anyway?`,
answer `y`):

**On the laptop, in a root shell:**
```sh
mkfs.ext4 -L allvibe-backup /dev/<the disk>
```

Its UUID names the filesystem whatever the disk is called next time:

**On the laptop, in a root shell:**
```sh
blkid -s UUID -o value /dev/<the disk>
```

**On the laptop, in a root shell:**
```sh
mkdir -p /mnt/allvibe-backup
```

One line added to `/etc/fstab`: by the UUID, and with `nofail`, so the laptop
still starts without the disk. `tee -a` adds; without `-a` it would replace
the whole file.

**On the laptop, in a root shell:**
```sh
echo 'UUID=<the UUID> /mnt/allvibe-backup ext4 defaults,nofail 0 2' | tee -a /etc/fstab
```

**On the laptop, in a root shell:**
```sh
systemctl daemon-reload
```

**On the laptop, in a root shell:**
```sh
mount /mnt/allvibe-backup
```

It prints nothing. The suite is told about it in section 8, once install.sh has
made its service user.

## 7. The suite onto the laptop, and install.sh

As the walkthrough's steps 1 and 2 for a real machine: the bundle made on the
workstation, pushed by the harness, and install.sh run as root.

**On the workstation (PowerShell):**
```powershell
npm ci
```

**On the workstation (PowerShell):**
```powershell
npm run bundle
```

`bundle: bundle/allvibe-0.1.0 (0.1.0+<commit>)`.

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs push bundle/allvibe-0.1.0 /root/
```

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs exec -- bash /root/allvibe-0.1.0/install.sh
```

Sixteen steps, `[1/16] This machine` to `[16/16] How the host is`, over a few
minutes: Docker Engine comes from Docker's own repository, and the control
panel's image is built on the laptop. Step 2 says `memory: <n> GB` and `system
disk: SSD`, or warns in plain words about less than 8 GB or a spinning disk.
Step 4 says `changed: Docker's signing key, fingerprint checked`. Then `allvibe
doctor`, only `✓` lines (none of the test host's `i` lines), `All green.`, and
last:

```text
Installed All vibe no cry 0.1.0+<commit>: <n> change(s).

The control panel: http://allvibe.local/
  (from a device that cannot find .local names: http://<address>/)
Its setup code, for your first visit: <four groups of four>
It works once. It is shown here, on the machine, and nowhere else.
```

**Keep the setup code for section 11**, on paper or in this window, nowhere
else. And **never forward a port on your router to the laptop**: the control
panel answers only on the home network, never the internet (rule 3).

## 8. The backup disk, for the suite

As the walkthrough's step 5, at the USB disk's mount point, which must belong
to the service user:

**On the laptop, in a root shell:**
```sh
chown allvibe:allvibe /mnt/allvibe-backup
```

**On the laptop, in a root shell:**
```sh
allvibe backup-target set /mnt/allvibe-backup
```

```text
ok   1/2 the backup target is off this machine and writable
       /mnt/allvibe-backup is on disk sda, separate from this machine's system and data; <size> free
ok   2/2 saved as this machine's backup target
```

Keep this output: it is the first part of check 4.

## 9. The recovery key

As the walkthrough's step 6. Every backup is encrypted to a key that stays on
the laptop and to a **recovery key** that only you will have. Without it the
backups cannot be read on any other machine, so the suite refuses every release
until you have shown it your copy (D13). Take your copy off the laptop, into a
file this repository ignores:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs pull /etc/allvibe/recovery-key-UNCONFIRMED.txt .local/recovery-key.txt
```

`pulled    … (not shown)`. Put the file's contents into your password manager
(as an attached file, if it takes one), or print it. Keep it away from the
laptop and the backup disk, so one fire or one thief cannot take all three;
never in a chat or an email. Then show it back:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs exec --stdin-file .local/recovery-key.txt -- allvibe recovery-key confirm
```

```text
ok   1/1 your copy is this machine's recovery key
       it matches the public half every backup is encrypted to; confirmed <today>
       /etc/allvibe/recovery-key-UNCONFIRMED.txt is deleted: your copy is now the only one
```

Delete the file from the workstation:

**On the workstation (PowerShell):**
```powershell
Remove-Item .local\recovery-key.txt
```

## 10. The first doctor

**On the laptop, in a root shell:**
```sh
allvibe doctor
```

All green:

```text
All vibe no cry on this machine

  ✓ Debian GNU/Linux 13 (trixie) on x86-64
  ✓ Memory: <n> GB
  ✓ System disk: SSD
  ✓ Power: on mains; the battery is at <n>%, charging, ready to carry the machine through a power cut
  ✓ Docker Engine <version> with Compose <version>
  …
  ✓ Firewall: project containers cannot reach this machine's own ports or the home network (checked <n> minutes ago)
  …
  ✓ The panel's name: allvibe.local is announced on the home network, for <laptop address>
  ✓ Daily backup and restore test: scheduled, next <time>; no run yet
  ✓ Backup target /mnt/allvibe-backup: /mnt/allvibe-backup is on disk sda, separate from this machine's system and data; <size> free
  ✓ The backup key for restore tests is in place
  ✓ Recovery key: confirmed <today>

All green.
```

Only a real machine can show these lines as they are:

- **Memory**, from the laptop's own memory: under about 7 GB (an 8 GB laptop
  shows about 7.6) it is `!`, "8 GB or more is recommended".
- **System disk**, asked of the kernel for the disk under `/`: `SSD`, or `!`
  for a spinning disk.
- **Power**, from the laptop's battery and charger: `, full` in place of `,
  charging` when full, and neither when it reports neither.
- **Backup target**, the USB disk, found by the kernel to be a separate
  physical disk (D22).
- **The panel's name** may say `!` "is not found yet" for a minute after a
  start; if it stays, the address works (D74).

## 11. The control panel, from another device

As the walkthrough's step 29 for a real machine. On your phone or another
computer on the home network, open **http://allvibe.local/**; a device that
does not find it uses **http://<laptop address>/**. Without the setup code,
make a new one, which replaces it:

**On the laptop, in a root shell:**
```sh
allvibe panel setup-code
```

It opens on **Set up your control panel**. Type the setup code, then a password
of twelve characters or more, twice, and press **Set up and sign in**. You are
on **Your apps**, with "The nightly checks have not run yet." at the top.
**Machine health**, in the side bar (on a phone, under **Menu**), lists
`doctor`'s checks in plain words. The panel runs on plain HTTP at home for now;
TLS at home is planned ([roadmap](roadmap.md)). A forgotten password: `allvibe
panel reset` in a root shell gives a new setup code, and signs everyone out.

## 12. A first app

As the walkthrough's step 31, up to your own sign-in. On **Your apps**, press
**Make a new app**, type a name (2 to 30 lowercase letters, digits and dashes,
starting with a letter), for example `notes`, and press **Make it**. In about
a minute it opens at **Plan**:

```text
Start your AI, and tell it what you want to build. It works in the test copy, never the live app.
```

Keep **Sign in with your Claude account**, and press **Start your AI**:
"Starting your AI. The first time takes a minute or two." That first start
builds the agent's image on the laptop: note how long it takes (check 10).
Claude Code's terminal opens under the plan, under "Claude Code. It signs in
with your Claude account." Press Enter for its text style. At **Select login
method** your own sign-in begins, which is yours alone: go on from point 2 of
the walkthrough's step 31. To leave it for later, press **Stop your AI**, under
the plan and again in the dialog.

## 13. The checklist: to verify on real hardware

Every item of STATE.md's "To verify on real hardware", in its order. Write
down what you saw for each, in your own words: STATE.md records that as tried
by you (rule 6). "Your first app" is the app from section 12, whose live app is
on port 8100.

### Before the checks: a project of their own

The probes change what they test, so they get a project, `checks`, on a name
made free first (on a fresh laptop: `there is no project called checks`, which
is fine):

**On the laptop, in a root shell:**
```sh
allvibe project remove checks --delete-everything
```

**On the laptop, in a root shell:**
```sh
allvibe project create checks
```

It ends `checks is ready:` with its two addresses. Two stand-in keys, for dev
and for prod, as the walkthrough's step 19 makes them:

**On the laptop, in a root shell:**
```sh
head -c 24 /dev/urandom | base64 | install -m 600 /dev/stdin /root/weather-dev
```

**On the laptop, in a root shell:**
```sh
head -c 24 /dev/urandom | base64 | install -m 600 /dev/stdin /root/weather-prod
```

**On the laptop, in a root shell:**
```sh
allvibe key set checks dev WEATHER_API_KEY < /root/weather-dev
```

**On the laptop, in a root shell:**
```sh
allvibe key set checks prod WEATHER_API_KEY < /root/weather-prod
```

Each ends with the app started again with its key.

### 1. install.sh on real hardware

Section 7 was the installation from Docker's repository, with the fingerprint
line and `Installed All vibe no cry …`. What is left is **live restore across a
Docker upgrade**, once Debian's `apt` has one. Note how long each container has
been up:

**On the laptop, in a root shell:**
```sh
docker ps --format '{{.Names}}  {{.Status}}'
```

**On the laptop, in a root shell:**
```sh
apt-get update
```

**On the laptop, in a root shell:**
```sh
apt-get upgrade
```

If its list has neither `docker-ce` nor `containerd.io`, answer `n` and come
back another week. If it has, answer `Y`, then:

**On the laptop, in a root shell:**
```sh
docker ps --format '{{.Names}}  {{.Status}}'
```

Every container still `Up` for as long as before, plus the upgrade's minutes;
none `Up` a few seconds, none `Restarting`.

### 2. Memory

**On the laptop, in a root shell:**
```sh
allvibe doctor | grep Memory
```

With 8 GB installed: `✓ Memory: 7.6 GB` or near it, no warning. With more, `✓`
and its size, and the "8 GB is not warned" half waits for an 8 GB machine.
**The 4 GB half**, on this laptop: `reboot` in a root shell; at the GRUB menu
press `e`, add ` mem=4G` at the end of the line that starts with `linux`, and
press Ctrl+X. That start alone sees 4 GB. Open a root shell again:

**On the laptop, in a root shell:**
```sh
allvibe doctor | grep Memory
```

`! Memory: 3.<n> GB. 8 GB or more is recommended: with less, running several
apps may be slow`. Then `reboot` in a root shell, to start with all of it.

### 3. The system disk's type

**On the laptop, in a root shell:**
```sh
allvibe doctor | grep 'System disk'
```

`✓ System disk: SSD`, found from the disk under `/`. The spinning-disk half
waits for a machine with one, where install.sh's step 2 and `doctor` must warn.

### 4. A separate filesystem on a separate physical disk

**A USB disk accepted**: section 8's output, and now:

**On the laptop, in a root shell:**
```sh
allvibe backup-target show
```

`/mnt/allvibe-backup`, then `✓ /mnt/allvibe-backup is on disk sda, separate
from this machine's system and data; <size> free`.

**A second partition on the system disk refused.** A laptop that starts in UEFI
mode has one: the small start-up partition at `/boot/efi`.

**On the laptop, in a root shell:**
```sh
findmnt /boot/efi
```

A partition of the system disk, `vfat`. (Nothing: the laptop starts the older
way and has no second partition; write "not tried".) Offer it; the check
refuses before it writes anything, and the target stays the USB disk:

**On the laptop, in a root shell:**
```sh
allvibe backup-target set /boot/efi
```

```text
FAIL 1/2 the backup target is off this machine and writable
       /boot/efi is on disk nvme0n1, the same physical disk as this machine's system or data
…
stopped at step 1/2. Nothing after it was attempted.
```

**The disk unplugged, and the next backup failing.** Not during the night's
backup: pull the USB disk's cable, without unmounting it first.

**On the laptop, in a root shell:**
```sh
findmnt /mnt/allvibe-backup
```

Nothing, if the mount went with the disk; write down what it shows.

**On the laptop, in a root shell:**
```sh
allvibe backup checks
```

```text
FAIL 1/4 the backup target is off this machine and writable
       /mnt/allvibe-backup is on this machine's own root filesystem, which is not off the machine
```

Plug the disk back in:

**On the laptop, in a root shell:**
```sh
mount /mnt/allvibe-backup
```

**On the laptop, in a root shell:**
```sh
allvibe backup checks
```

It ends with the file it wrote on the backup disk.

**A NAS share accepted as off the machine**, if you have a NAS that offers NFS.
(An SMB share needs its password in a file on the laptop, not documented yet:
write "SMB not tried".)

**On the laptop, in a root shell:**
```sh
apt-get install -y nfs-common
```

**On the laptop, in a root shell:**
```sh
mkdir -p /mnt/nas-test
```

**On the laptop, in a root shell:**
```sh
mount -t nfs <NAS address>:<export path> /mnt/nas-test
```

**On the laptop, in a root shell:**
```sh
allvibe backup-target set /mnt/nas-test
```

`ok   1/2 …` with `/mnt/nas-test is a nfs4 share (<NAS address>:<export
path>): off the machine` (or `nfs`). If it says instead `is not writable by
allvibe`, the share passed the off-the-machine test, which comes first, and the
NAS must let the laptop write for a full pass. **Either way, the USB disk goes
back as the target**, and the share is unmounted:

**On the laptop, in a root shell:**
```sh
allvibe backup-target set /mnt/allvibe-backup
```

**On the laptop, in a root shell:**
```sh
umount /mnt/nas-test
```

### 5. A real reboot

**On the laptop, in a root shell:**
```sh
reboot
```

Wait two minutes, open a new root shell, and give the apps half a minute:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs shell
```

**On the laptop, in a root shell:**
```sh
allvibe doctor
```

`All green.`, with `Reverse proxy: running and healthy`, `Apps: no container
that Docker could not start`, the firewall, the key vault, the panel answering,
`Daily backup and restore test: scheduled` (its timer active) and the backup
target on the USB disk, which `/etc/fstab` mounted at start.

**On the laptop, in a root shell:**
```sh
allvibe project status checks
```

checks' prod and dev both `running, healthy`: an app with keys came back. Were
the keys and the firewall in place before Docker started?

**On the laptop, in a root shell:**
```sh
systemctl show -p Id -p ActiveEnterTimestampMonotonic -p InactiveExitTimestampMonotonic allvibe-keys.service allvibe-firewall.service docker.service
```

One group of lines per unit. `ActiveEnterTimestampMonotonic` of
`allvibe-keys.service` and of `allvibe-firewall.service` are both smaller than
`InactiveExitTimestampMonotonic` of `docker.service`: both were done before
Docker began to start, so no container ran without the firewall. In the panel,
sign in again: a restart signs everyone out.

**A missed night's run happens after the start** (`Persistent=true`). One
evening, before 03:30:

**On the laptop, in a root shell:**
```sh
poweroff
```

The next morning, after 04:30, switch it on, wait half an hour (the run keeps
its random delay of up to 30 minutes), and open a root shell:

**On the laptop, in a root shell:**
```sh
allvibe runs
```

A `scheduled-backup` line, `ok`, started within half an hour of switching it
on. `runs` gives its times in UTC.

### 6. The daily run at 03:30

Leave the laptop on overnight, the backup disk plugged in (the lid may be
closed). The next morning:

**On the laptop, in a root shell:**
```sh
allvibe runs
```

`scheduled-backup`, `ok`, started between 03:30 and 04:00 by the laptop's clock
(shown in UTC).

**On the laptop, in a root shell:**
```sh
allvibe doctor --last
```

`All vibe no cry on this machine, as the nightly check found it at <time>
UTC`, the checks, and `All green.`

### 7. Reachability from another machine on the LAN

**On the laptop, in a root shell:**
```sh
allvibe project list
```

Your first app's line ends `prod http://<laptop address>:8100/  dev
http://<laptop address>:8101/`. Open both on your phone and on another
computer: prod with its green **prod** badge, dev with its orange **dev** badge
(or what your AI has made of them).

**On the laptop, in a root shell:**
```sh
ss -ltn6
```

No line with `:80` or with a port from 8099 up: nothing of the suite listens on
IPv6. A line for port 22 is Debian's SSH server, not the suite.

### 8. The firewall on a real network card and a real home network

You need a device on the home network that answers on a port: a network
printer's web page (port 80) is best, the router's web page will do. Its
address is `<device address>`, the port `<device port>`. First, who answers the
laptop's name lookups:

**On the laptop, in a root shell:**
```sh
cat /etc/resolv.conf
```

Usually `nameserver <your router's address>`, the case this check is about;
write down what it says. Then the probe of checks' apps and databases, as the
walkthrough's step 21 runs it:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs push test/host/app-isolation.sh /root/
```

The probe also tries "this machine's other service", on port 9999, which only
the test host has. On the laptop, the control panel's door on port 80 is such a
service, so the command names it:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs exec -- env OTHER_PORT=80 sh /root/app-isolation.sh allvibe checks <device address> <device port>
```

The targets from the laptop itself first, where each must answer, then from
inside the four containers, where each must be refused. Every line ends `as it
must be`, none `WRONG`, and the last is `<n> of <n> as they must be`, both
numbers the same (59 on the test host; here two fewer, which need the test
host's stand-in device). Each app's `the public internet, https://example.com
HTTP 200` also shows that names resolve inside the apps through that resolver.

**The agent**, with a stand-in key, as the walkthrough's step 22 does without a
real one:

**On the laptop, in a root shell:**
```sh
head -c 24 /dev/urandom | base64 | install -m 600 /dev/stdin /root/anthropic-key
```

**On the laptop, in a root shell:**
```sh
allvibe key set checks agent ANTHROPIC_API_KEY < /root/anthropic-key
```

**On the laptop, in a root shell:**
```sh
allvibe agent start checks
```

It ends `ok   8/8 Claude Code answers in it`.

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs push test/host/agent-isolation.sh /root/
```

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs exec -- env OTHER_PORT=80 sh /root/agent-isolation.sh allvibe checks /root/weather-prod /root/weather-dev /root/anthropic-key <device address> <device port>
```

Every line `as it must be`, and `<n> of <n> as they must be` (89 on the test
host). This probe does not try the device from the laptop first: the app probe
above did, so use the same device.

**On the laptop, in a root shell:**
```sh
allvibe agent stop checks
```

Last, open your first app's prod on your phone again: the doors still answer.

### 9. Prod's door refusing containers on a real Docker

Prod's door takes its deny list from Docker when a project is made. Your first
app's (its name in place of the placeholder):

**On the laptop, in a root shell:**
```sh
grep deny /var/lib/allvibe/proxy/conf.d/<your first app>-prod.conf
```

**On the laptop, in a root shell:**
```sh
docker network inspect bridge --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
```

The subnet it prints, Docker's default bridge on this laptop, is one of the
`deny` lines, beside Docker's address pool. Then rule 1 from inside dev. The
probe looks at ports 8100 and 8101, so it takes your first app:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs push test/host/rule1-isolation.sh /root/
```

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs exec -- sh /root/rule1-isolation.sh allvibe <your first app>
```

Both names not found (`ENOTFOUND` or `EAI_AGAIN`); every address and door
refused or unreachable (`timed out`, `ECONNREFUSED`, `ENETUNREACH` and the
like), dev's own door too, since the firewall stops every container at the
laptop's doors: no `RESOLVED`, `CONNECTED` or `HTTP`. And `dev's database
password differs from prod's`, never `SAME PASSWORD`.

### 10. The agent's image on the laptop

**On the laptop, in a root shell:**
```sh
docker image ls --filter label=allvibe.role=agent-image
```

One image, made at the first start of an AI (section 12, or check 8's `agent
start`, which then said `built on this machine, from the versions its lock file
pins`). Write down how long that first start took; on the workstation it was
about a minute.

### 11. Mains and battery on a real laptop

**On the laptop, in a root shell:**
```sh
allvibe doctor | grep Power
```

Run it three times. **On mains**: `✓ Power: on mains; the battery is at <n>%,
…, ready to carry the machine through a power cut`. **Charger pulled**, a
minute later: `! Power: ON BATTERY, at <n>%, about <time> left. The apps keep
running; plug the machine in` (without the time left if the laptop does not
report enough). **Near empty**, at 20% or less: `✗ Power: ON BATTERY, and it
is low: at <n>%, …. The machine will switch itself off soon; plug it in now`.
Plug it in at once. Then what the battery reports:

**On the laptop, in a root shell:**
```sh
ls /sys/class/power_supply/*/
```

Under the battery's directory (often `BAT0`, the one with `capacity` in it),
write down which of `energy_now`, `charge_now` and `time_to_empty_now` are
there, or none.

### 12. Signing in over SSH

The root shell is itself over SSH, as for any laptop at home.

**On the laptop, in a root shell:**
```sh
allvibe agent start checks --sign-in account
```

**On the laptop, in a root shell:**
```sh
allvibe agent shell checks
```

As the walkthrough's step 23: Enter for the text style; **1. Claude account
with subscription**; a long web address, maybe over several lines. Press `c` to
copy it if your terminal allows, or select all of it with the mouse, and open
it in your browser. Sign in, allow access, copy the code the page shows, paste
it into the SSH window, Enter. `Login successful`, Enter; security notes,
Enter; at whether you trust `/workspace`, the down arrow to **Yes, I trust this
folder** (its default, "No, exit", leaves Claude Code). Write down whether the
copy and the paste worked, and how. To end the sign-in at Anthropic too, type
`/logout`; then `/exit`.

**On the laptop, in a root shell:**
```sh
allvibe agent stop checks
```

### 13. The harness over SSH

You have used all of it on the laptop: `status` and `shell` (section 4), `push`
and `exec` (section 7), `pull` and `exec --stdin-file` (section 9). Write down
whether each did what the text said. And what only the test host allows is
refused:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs override list
```

`host: ALLVIBE_TEST_HOST is set, so the test host is a real machine, and this
harness does not set overrides on one. Reinstall Debian 13 on it for a fresh
host.`

### 14. The control panel from another device on the home network

**Names and devices.** On an iPhone, an Android phone and a computer, open
http://allvibe.local/ and http://<laptop address>/. Write down which devices
find the name, and which need the address.

**Another host name refused**, asked as a browser would ask:

**On the workstation (PowerShell):**
```powershell
node test/host/http-ask.mjs <laptop address> 80 example.com /sign-in
```

`421`. The control, with the panel's own name:

**On the workstation (PowerShell):**
```powershell
node test/host/http-ask.mjs <laptop address> 80 allvibe.local /sign-in
```

`200` (or `303`).

**A public source address refused.** A network of its own on the laptop, with
the public address 198.51.100.2, as the panel's probe does on the test host:

**On the laptop, in a root shell:**
```sh
sh -c 'ip netns add probe-public && ip link add pub0 type veth peer name eth0 netns probe-public && ip addr add 198.51.100.1/24 dev pub0 && ip link set pub0 up && ip -n probe-public addr add 198.51.100.2/24 dev eth0 && ip -n probe-public link set eth0 up && ip -n probe-public link set lo up && ip -n probe-public route add default via 198.51.100.1'
```

**On the laptop, in a root shell:**
```sh
ip netns exec probe-public curl -s -o /dev/null -w '%{http_code}\n' http://<laptop address>/sign-in
```

`403`: the door answered, and refused. (`000` would mean the request never
arrived: look at what the first command printed.) Then the network goes:

**On the laptop, in a root shell:**
```sh
sh -c 'ip netns del probe-public; ip link del pub0 2>/dev/null; true'
```

**Port 80, bound by Docker**, where a port below 1024 needs a privilege:

**On the laptop, in a root shell:**
```sh
sysctl net.ipv4.ip_unprivileged_port_start
```

`net.ipv4.ip_unprivileged_port_start = 1024` (the test host said 0).

**On the laptop, in a root shell:**
```sh
ss -ltnp 'sport = :80'
```

A line for `<laptop address>:80`, held by `docker-proxy`, Docker's helper. If
there is none and the panel still opens on port 80, Docker forwards it by its
firewall rules alone: write that down.

**The Preview frame.** In the panel, by its name and then by the address, on
the phone and the computer, open your first app: **Preview** shows the test
copy under **Test copy**, and **In a tab of its own** opens
http://<laptop address>:8101/.

### 15. An unplugged backup disk, as the engine sees it

It needs a version ready to go live: on checks, a new heading and a plan of two
steps, as the walkthrough's step 30 makes them.

**On the laptop, in a root shell:**
```sh
runuser -u allvibe -- sed -i 's|<h1>Guestbook <span|<h1>Hello, how are you? <span|' /var/lib/allvibe/projects/checks/repo/server.js
```

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs push docs/walkthrough-files/say-hello-2.json /root/
```

**On the laptop, in a root shell:**
```sh
install -o allvibe -g allvibe -m 644 /root/say-hello-2.json /var/lib/allvibe/projects/checks/repo/plan.json
```

**On the laptop, in a root shell:**
```sh
allvibe dev commit checks "Say hello"
```

**On the laptop, in a root shell:**
```sh
allvibe dev deploy checks
```

In the panel, open **checks**: **Try step 1**, look at the heading in the
frame, **Step 1 works**; **Try step 2**, sign the guestbook in the frame,
**Step 2 works**. The next action is **Put v2 live**. Pull the USB disk's
cable, without unmounting it, and press **Put v2 live**:

```text
v2 is not live
Nothing changed. It stopped at "the backup target is off this machine and
writable": /mnt/allvibe-backup is on this machine's own root filesystem, which
is not off the machine
```

Press **OK**. Plug the disk back in:

**On the laptop, in a root shell:**
```sh
mount /mnt/allvibe-backup
```

Press **Put v2 live** again: the six checks fill in, and `v2 is live.` If it
stops at the backup again, `reboot` in a root shell, sign in to the panel
again, and press it once more. Write down which it took.

### 16. Everything back after a restart, a hard stop and a late address

The engine brings back whatever Docker could not start at a start, and waits
for the laptop's address before it opens the panel's door on it (D80). Three
ways, each ending with the same look. First **a reboot**:

**On the laptop, in a root shell:**
```sh
reboot
```

Two minutes later, open a new root shell:

**On the workstation (PowerShell):**
```powershell
node test/host/host.mjs shell
```

**On the laptop, in a root shell:**
```sh
allvibe doctor
```

`All green.`, with `Apps: no container that Docker could not start` and
`Control panel: http://<laptop address>/ answers, on the home network only; set up`. On your phone, the panel at
http://allvibe.local/ and at http://<laptop address>/: the sign-in page, not
the setup page, and your password signs you in; your first app is there.

**A hard stop**, the nearest to a power cut a laptop with a battery has
(pulling the charger does nothing until the battery is empty): hold the power
button until the laptop is off, then press it again to start it. Two minutes
later, the same `allvibe doctor` and the same look from your phone.

**A late address**, as when the home router answers slowly at a start: pull
the network cable, then:

**On the laptop, at its own keyboard:**
```sh
sudo reboot
```

A minute after it has started, plug the cable back in. Within two minutes of
that, the same look from your phone. Then, what the engine did meanwhile:

**On the laptop, in a root shell:**
```sh
journalctl -b -u allvibe-engine --no-pager -o cat | grep keeper
```

`keeper: the panel: this machine has no address on the home network yet, so
the door cannot be published on it (tried again every 5 seconds)`, then `keeper: the panel's door, written
again: ...` and `keeper: no longer: ...`, once the cable was in. (With Wi-Fi
instead of a cable, the same happens when the laptop joins the network late.)

### Afterwards

The stand-in keys are not needed any more; the checks project can stay, for
the next time.

**On the laptop, in a root shell:**
```sh
rm /root/weather-dev /root/weather-prod /root/anthropic-key
```

**Tell what happened**, check by check, in your own words: STATE.md records it
as tried on real hardware (rule 6), and what got in your way goes in the
[friction log](friction-log.md).
