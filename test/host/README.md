# The test host

A disposable Debian 13 machine for developing and testing the suite (D14),
created on this workstation's Docker in about twenty seconds and thrown away as
easily. Later, the same commands talk to a real Debian 13 machine over SSH.

Needs Node 22 and Docker. Run everything from the repository root.

**From Git Bash on Windows, set `MSYS_NO_PATHCONV=1` first.** Git Bash rewrites
arguments that look like Unix paths, so `exec -- bash /root/x.sh` would reach
the test host as `C:/Program Files/Git/root/x.sh`. PowerShell does not do this.

## Commands

| Command | What it does |
|---|---|
| `node test/host/host.mjs create` | A fresh test host. Fails if one exists. |
| `node test/host/host.mjs reset` | Throws the test host away and creates a fresh one, backup target included. `--keep-backup-target` keeps the backup volume, to test restoring onto a new machine. |
| `node test/host/host.mjs restart` | Restarts the container: the stand-in for a reboot. |
| `node test/host/host.mjs exec -- <command>` | Runs a command as root on the test host. Standard input is passed through, so `… exec -- cmd < file` works. |
| `node test/host/host.mjs shell` | A root shell on the test host. |
| `node test/host/host.mjs push <local> <remote-dir>` | Copies a file or directory onto the test host. |
| `node test/host/host.mjs exec --stdin-file <file> -- <command>` | The same, with a local file as the command's standard input, byte for byte, from any shell. |
| `node test/host/host.mjs pull <remote-file> <local-file>` | Copies a file off the test host, byte for byte, never through the screen. |
| `node test/host/host.mjs override list` / `set <key>=<value>` / `unset <key>` | The test overrides (below). |
| `node test/host/host.mjs status` | What exists, the port mapping, systemd's state, the overrides. |
| `node test/host/host.mjs remove` | Removes the container, its volumes and its image. Nothing is left. |
| `node test/host/host.mjs resources snapshot <file>` / `compare <file>` | Every container, image, volume and network on this workstation's Docker, as ids, and what was added or removed since the snapshot. |

## Probes

Scripts that run **on the host**, as root, and print verdicts, counts and error
codes, never a secret. Push one with `node test/host/host.mjs push
test/host/<script> /root/`, then run it with `node test/host/host.mjs exec --
sh /root/<script> allvibe <project> …`.

| Script | What it proves |
|---|---|
| `rule1-isolation.sh <command> <project>` | From inside dev's app, prod cannot be reached (rule 1, D18). |
| `vault-check.sh <command> <project> <dev value file> <prod value file> [<agent value file>]` | Each key's value appears nowhere it must not, and dev never holds prod's (D37). |
| `key-check.sh <command> <project>` | A fake key, made at random, is stopped by the key check, from `dev commit` and from plain git; a clean commit passes; a missing scanner stops the commit (D38). |
| `agent-isolation.sh <command> <project> <prod value file> <dev value file> [<agent value file>] [<device address> <port>]` | From inside the agent and its egress gate: prod, the machine's own ports, the router, a device on the home network, link-local and the machine's secrets refused; dev and the model's API answering; its commits key-checked (D39, D41). Counts what is not as it must be, and exits 1 if anything is. |
| `app-isolation.sh <command> <project> [<device address> <port>]` | From inside dev's and prod's apps and databases: the machine's own ports, the router, a device on the home network and link-local refused; the public internet reached; each app reading its database; the doors answering the machine and the device (D41). The targets are tried from the machine first, where they must answer. Counts, and exits 1 if anything is wrong. |
| `lan-fixtures.sh` | **Test host only.** Stand-ins for what a real machine has around it: an SSH server, a service on port 9999, and another device on the home network (a network namespace at 10.99.0.2, port 8080). Each is a unit, so it comes back after a restart. |

## What it is

- **A privileged Debian 13 container with systemd as init**, made from the
  official `debian:trixie` image pinned by digest, with only systemd, dbus,
  iproute2, procps and kmod added: the minimum that boots like a machine. No
  Docker, no curl, no CA certificates; `install.sh` has to fetch everything
  itself, as it will on a fresh installation.
- **Three volumes**: Docker's data and containerd's image store (Docker inside
  Docker cannot keep them on the container's overlay root), and a third that
  stands in for the **off-machine backup target**, mounted at
  `/mnt/allvibe-backup`.
- **Ports 8100–8119** of the test host, where the suite's proxy listens,
  published on this workstation's **loopback only**, at the same numbers when
  they are free (the harness checks, and picks another block if not). So a
  project the suite serves at `http://<host>:8101` on a real machine is at
  `http://localhost:8101` here.

## Keeping the workstation clean

Everything the harness creates carries the label `allvibe.test-harness=1`, and
it removes only resources with that label. It never prunes anything.

- **No build cache.** The image is not made with `docker build`: a labelled
  container runs the setup on the pinned base and is committed as a labelled
  image, and if the harness pulled the base image it removes that reference
  again. The image is named after a hash of its recipe and reused until the
  recipe changes.
- **No networks.** The test host uses Docker's default bridge.
- **Proof.** `resources snapshot` before and `resources compare` after list what
  was added and removed, by label. Resources that are not the harness's are
  counted and never named: they belong to other projects.

## The test overrides

A container cannot measure some of the things the suite checks (D14): it reads
the Docker VM's memory, its root filesystem is an overlay with no disk of its
own, and all its volumes sit on one virtual disk. So `create` **declares** the
hardware this test host stands for, in `/etc/allvibe/test-overrides`:

| Override | Set by `create` | Means |
|---|---|---|
| `memory-mb` | `16384` | The memory the checks read, instead of `/proc/meminfo`. |
| `system-disk` | `ssd` | The system disk's type, instead of asking the kernel. |
| `external-backup-mount` | `/mnt/allvibe-backup` | This one mount counts as a separate physical disk. Nothing else does. |

To see a warning, change the declaration:

```sh
node test/host/host.mjs override set memory-mb=4096
node test/host/host.mjs override set system-disk=rotational
```

**These cannot take effect on a real machine.** The suite honours the file only
when `/.dockerenv` exists **and** systemd reports a Docker container in
`/run/systemd/container`. Whenever it honours one, `install.sh` and `allvibe
doctor` say so. (`systemd-detect-virt` is not used: on Docker Desktop it answers
`wsl`, because the kernel is WSL2's.)

## What it cannot stand in for

Listed in [STATE.md](../../STATE.md), "To verify on real hardware": the system
disk's type, a separate filesystem being a separate physical disk, memory,
reachability from another machine on the LAN, and a real reboot. A container
restart keeps the filesystem, as a reboot does, but the kernel does not restart.

## On a real Debian 13 machine

Set `ALLVIBE_TEST_HOST=user@host` in the environment, or in `local.env` (see
`local.example.env`; never commit it). Then `exec`, `shell`, `push` and `status`
talk to that machine over SSH, key-based, with `BatchMode=yes` and `sudo -n`,
so a missing key or a sudo that wants a password fails instead of asking. The
user needs root, or sudo without a password. `create`, `reset`, `restart`,
`remove` and `override` refuse: a real machine is made fresh by reinstalling
Debian, and it has no test overrides.
