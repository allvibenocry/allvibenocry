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
| `node test/host/host.mjs restart [--hard]` | Restarts the container: the stand-in for a reboot; `--hard` kills every process at once and starts it again, the nearest to a power cut. Then says what the root cgroup gives its children (it fails loudly if not what a machine gives), and, with the suite installed, waits for everything to come back within 120 seconds of the start and says what came back, or what did not, with Docker's reason, and exits 1 (D80, `comeback.mjs`). |
| `node test/host/host.mjs exec -- <command>` | Runs a command as root on the test host. Standard input is passed through, so `… exec -- cmd < file` works. |
| `node test/host/host.mjs shell` | A root shell on the test host. |
| `node test/host/host.mjs push <local> <remote-dir>` | Copies a file or directory onto the test host. |
| `node test/host/host.mjs exec --stdin-file <file> -- <command>` | The same, with a local file as the command's standard input, byte for byte, from any shell. |
| `node test/host/host.mjs pull <remote-file> <local-file>` | Copies a file off the test host, byte for byte, never through the screen. |
| `node test/host/host.mjs override list` / `set <key>=<value>` / `unset <key>` | The test overrides (below). |
| `node test/host/host.mjs status` | What exists, the port mapping, systemd's state, the overrides. |
| `node test/host/host.mjs remove` | Removes the container, its volumes and its image. Nothing is left. |
| `node test/host/fresh-host.mjs [<bundle dir>] [--keep]` | Walkthrough steps 1, 2, 5 and 6 in one go: a fresh test host, the bundle installed, the backup disk and the recovery key; `--keep` installs over the host that is there. Another bundle (an older commit's) makes a negative control. Never prints the setup code or the recovery key. |
| `node test/host/walkthrough-blocks.mjs` | The walkthrough's shape: one command per block, no heredoc, and every project made on a name removed first. |
| `node test/host/walkthrough-panel.mjs` | Walkthrough steps 29 to 31 run exactly as written, on a fresh test host: every block of those steps taken from `docs/walkthrough.md` in its order, each command run where the text says and each quoted output compared with what the machine or the page shows (in headless Edge, at the fallback address the text gives for the test host); a block it does not expect where it comes stops it. It stops where the owner's own sign-in begins, at "Select login method" in the panel's terminal, then stops the AI as the step's last paragraph says. |
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
| `agent-isolation.sh <command> <project> <prod value file> <dev value file> [<agent value file>] [<device address> <port>]` | From inside the agent, its egress gate and its activity logger: prod, the machine's own ports, the router, a device on the home network, link-local and the machine's secrets refused; dev, the logger and (through the gate only) the model's API answering; the agent's mounts only its working copy, its conversations and its key; its commits key-checked (D39, D41, D60). Counts what is not as it must be, and exits 1 if anything is. |
| `agent-leftovers.sh <command> <project>` | A stand-in login and typed text, never on the machine's disk while the agent runs, nowhere after `agent stop`, and never in the kept transcripts or activity log, which stay (D46, D60). Run after `agent-activity.sh`. Stops the agent. |
| `agent-activity.sh <command> <project> <prod value file> <dev value file> [<agent value file>]` | A real Claude Code session in the agent, against `stub-api.mjs`: one log line per tool call, paths and commands but never contents, a fake key withheld, lines from anything but the agent refused, the log out of the agent's reach, the transcript kept, and neither a stand-in login nor the vault's values in them (D60). Either way of signing in. |
| `stub-api.mjs` | **Tests only.** A stand-in for the model's API with a fixed script of four tool calls, so a real session runs without a model, a key or an account. `agent-activity.sh` starts it on dev's network for one session and removes it. With `STEPS_FILE`, it plays those tool calls instead and writes each result to `RESULTS_FILE`. |
| `engine-probe.mjs <command>` | The engine the control panel calls (D62), with a project of its own: only its socket, for the service user and the panel's group, and no network port; unknown operations and malformed arguments refused; every operation once; untried steps refused exactly as the CLI refuses them, word for word; and no answer holding a secret value. Puts the panel's sign-in file back, and removes its project. |
| `panel-probe.mjs <command> <project>` | The control panel (D63, D64), through its door as a browser would: every page and operation needs a session; the setup code works once and only on an unclaimed panel; wrong tries are paused; cross-site requests refused, no CORS; private sources only (the fixture device, then a public address from a namespace of its own), its own host names only, and not from the project's containers or the agent; its container with only the engine's socket, read-only, and nothing from rule 12. Needs `lan-fixtures.sh`. Puts the sign-in file back and restarts the panel. |
| `deny-probe.mjs <settings.json> [--control] [--pwsh <dir>] [--cases <file>]` | Claude Code's deny rules (D61), with the pinned Claude Code against `stub-api.mjs`: in a throwaway container with a scratch repository, every rule refuses a harmless command and the controls run; `--control` runs the same without the settings file, where everything must run; `--pwsh` mounts a PowerShell and turns on Claude Code's PowerShell tool. Needs the agent's image (start an agent once). |
| `plan-gate.sh <command> <project>` | A release with an untried step, no plan, or a spent plan is refused before anything changes; marking every step tried lets it through; `--outside-plan` needs a reason, which the record keeps (D56). |
| `rollback-backup.sh <command> <project>` | Going back takes a fresh backup and restore-checks it before prod changes, keeps it with the releases, and stops with prod untouched when the check fails (D57). |
| `doctor-nightly.sh <command>` | The nightly doctor's result is written after the scheduled backup, 14 kept, and read back with `doctor --last` (D58). |
| `power-fixtures.sh <command>` | Mains, battery and low battery, from stand-in power supply files, in doctor and the nightly result (D59). |
| `app-isolation.sh <command> <project> [<device address> <port>]` | From inside dev's and prod's apps and databases: the machine's own ports, the router, a device on the home network and link-local refused; the public internet reached; each app reading its database; the doors answering the machine and the device (D41). The targets are tried from the machine first, where they must answer. Counts, and exits 1 if anything is wrong. |
| `ops-probe.mjs <command>` | The engine's next operations (D82), with a project of its own: service keys set, listed and removed, the value reaching the live app and found in no answer, job, journal or folder of the suite's (the search seen finding a marker put there on purpose); going back with the data, what it loses in the CLI's words, the fresh backup restore-checked before prod's data is replaced, and the data then the backup's, counted; work outside a plan, the reason kept, and refused past an untried step; removing an app, stopped at the backup target with the disk unplugged and nothing removed, then removed with its last backup kept where it says. Every refusal of each, and each refused as busy while the app's lock is held from the command line. Needs `panel-fixture.mjs` in `/root`. |
| `no-allow.sh <command> <project>` | A new project carries no local allow of any kind (D81): every file of its working copy and of every commit, no Claude Code local settings file, no `.claude/` at all, and nothing that allows a tool, widens what Claude Code may do or skips its questions; the files and the commits it read are counted, as verdicts of their own. |
| `lan-fixtures.sh` | **Test host only.** Stand-ins for what a real machine has around it: an SSH server, a service on port 9999, and another device on the home network (a network namespace at 10.99.0.2, port 8080). Each is a unit, so it comes back after a restart. |
| `mdns-ask.mjs <name>.local` | Asks the home network for a `.local` name by multicast DNS, with nothing but a socket, as a phone would; run inside the stand-in device's namespace (`ip netns exec lan-device node mdns-ask.mjs allvibe.local`). |
| `http-ask.mjs <address> <port> <host> [path] [cookie]` | One request with a Host header (and a Cookie header) of one's choosing: the status and the start of the body. |
| `mdns-try.sh`, `port80-try.sh` | What D74 was decided on, kept to be run again: Avahi publishing and resolving the panel's name as the service user; and whether the proxy's image binds port 80 as its user, with a capability added (its effective capabilities stay none), and the lowest port any user may bind on the test host (0, where a real machine has 1024). |
| `engine-probe.mjs` (again) | Since D76 also: the engine's protocol (an HTTP request, a line over 16 kB, a line that never ends, each refused), and each new operation for real: an app made, and the agent started with a stand-in key and stopped, each confirmed. |
| `lock-probe.mjs <command>` | One lock per app (D72): a release from the engine and one from the command line at once, both ways round, the second refused in plain words and one release made; a stale lock cleared; the nightly backup waiting for going back to end; and doctor counting the restore check a release and going back made (D73). With a project of its own, left behind for a look. |
| `panel-fixture.mjs <action>` | **Test host only.** What the browser checks need done on the host, as the builder or the machine would: a plan's steps built and deployed to the test copy (`plan`), the backup disk unplugged and back (`unplug`, `plug`, in the engine's view too, since the test host's mounts do not reach a service's own), a setup code (`setup-code`), the newest report (`report`), a broken copy of the panel in the real one's place and the real one back (`break`, `mend`); the stand-in for the model's API on an app's dev network, playing a plan of one step written and committed, and the working copy's local settings pointing Claude Code at it (`stub <app>`, `stub-stop <app>`; D77); for the checks of the seventh brief (D78), an app made unless it is there (`app`), the apps a run made removed (`remove`), a stand-in key for an app's AI (`agent-key`), an app's lock held by a process of the service user's from "the command line" and let go (`hold-lock`, `free-lock`); and, for the eighth brief's (D83), an entry written in the live app (`entry`), a change committed without a plan (`unplanned`), and the SHA-256 of what an app reads for a service key, never its value (`secret-hash`). The browser scripts below push and call it. |
| `engine-probe.mjs` (D77) | Also: asked how a release goes every quarter second, as the panel asks, the engine's slowest answer (under a second: the job's command runs on a thread of its own). |

## In a real browser

Scripts that run **on this workstation**, from the product repository, against
the panel on the test host through the forwarded ports: a headless Edge (or
Chrome, or `BROWSER`) driven over the DevTools protocol by `cdp.mjs`, with real
mouse and keyboard input. They keep every console error and request the page
made. They sign in with a fresh setup code and a password made up for the run,
kept in memory and never printed. Run them on a fresh test host. The Preview
frames the test copy at its own port on the host the browser used, so they
need the ports forwarded at the same numbers (`status` says).

| Script | What it shows |
|---|---|
| `names-probe.mjs` | The panel and the apps on different host names (D74), in the browser and on the host: the name announced and heard by another device, port 80 by the name and the address, no other name; the panel's cookie never received by the test copy or the live app, by the name (never sent) or by the address (sent, and taken out by the apps' doors), as the app itself says; the framed test copy, from its own scripts, unable to navigate the top window, open a window or act on the panel, and the control, a frame without the sandbox, taking its window over; every other Origin refused. |
| `terminal-probe.mjs` | The agent's terminal through the panel (D76), in two real browsers: attaching without a session, from another site or port or with no Origin, with a wrong token, and from the test copy's own page by the fallback address, each refused, with its control; Claude Code's first start gone through as a person does; a marker typed into its prompt and shown; a second browser taking over; the idle time; and the marker found nowhere on the host. Uses a stand-in key: never an account. |
| `guided-probe.mjs [--configs desktop,phone]` | The guided path (D75), at a desktop's width and a phone's, each with a project of its own: from "Try step 1" to "v2 is live" pressing only the next-action button; one pink thing on the screen at every stage; the panel moving on by itself; the ending's three choices; the tabs still working; "Start something new" back at Plan. |
| `chat-probe.mjs [--configs desktop,phone]` | The chat in the panel (D69, D77), each width with an app of its own: an app made in the panel, opening in Plan with "Start your AI" and the two ways to sign in; its AI started from the panel with a stand-in key; Claude Code's terminal under the plan, its first start gone through by keys; a prompt typed, and Claude Code answering the stand-in for the model (`panel-fixture.mjs stub`) by writing and committing a plan; the panel seeing the commit, then the step in the checklist and in the guided path; no console error, no other origin. Run it on a fresh test host: the first start then builds the agent's image. Never an account. |
| `panel-fixes.mjs [--url …]` | The seventh brief's fixes (D73): text typed into the Preview frame kept across switching tabs, a step marked tried and the periodic look for changes, and the frame reloaded by a new test copy and by "Restart the test copy"; nothing green before the nightly checks have run, "Step 1 works" not green, a stopped live app red. Needs a host whose nightly backup has not run. |
| `restart-probe.mjs [--only <way,...>]` | Everything back after the machine stops and starts, in any order (D80), from this workstation: the panel set up and an app made and backed up, then nine ways, each checked within 120 seconds: a restart; a restart with a shell entering the test host as it starts; with the machine's address 25 seconds late; with Docker's first start failing; Docker restarted, stopped and started, and killed; a hard stop, and a hard stop with the address late. Each: doctor all green, the suite's units active, every suite container running and healthy, the panel answering by its name and at the address, and, in headless Edge, signed out after the machine stopped (a restart of Docker alone keeps the panel and its sessions), still set up, and the same password signing in by the name and at the address. Its fixtures are in `harness/`, put in place for one way and taken away after it. |
| `panel-checks.mjs <folder> [--broken <variants>\|none] [--configs <names>\|none]` | Every check, first seen failing on a deliberately broken copy of the panel (at least one per check), then passing on the real one, at 1280 and 390 px wide, light and dark: signing in and out; the guided path from "Try step 1" to "v2 is live", one pink thing at a time, with the mouse and the keyboard; the Preview frame keeping what is typed in it; every refusal, the app's lock held from the command line among them; a new app made in the panel; its AI started with a stand-in key and stopped; its terminal's keyboard (Ctrl + ] leaves it) and its refusals from the browser (a wrong token; the test copy's own page); since D83, service keys under More (the value never in the page again, the live app reading it, a Remove confirmed; the dialog opening on Close with a key listed), going back with the data (set apart, never pink, what is lost with its counts, the name typed, the entries after), work outside a plan (only where a release is refused for want of one, the reason kept, the version the engine released), and removing an app in its settings (the name typed, where its last backup is); the apps it made removed; no console errors, no request to another origin but the Preview frame's, nothing wider than the screen, the side's lights each a dot; the keyboard in every dialog and tab list. Replaces the sixth brief's `panel-journey.mjs`, whose every flow it has. |

## What it is

- **A privileged Debian 13 container with systemd as init**, made from the
  official `debian:trixie` image pinned by digest, with only systemd, dbus,
  iproute2, procps and kmod added: the minimum that boots like a machine. No
  Docker, no curl, no CA certificates; `install.sh` has to fetch everything
  itself, as it will on a fresh installation.
- **One unit of the harness's own**, `test-host-cgroups.service`
  (`harness/cgroups.sh`, D80): before containerd and Docker start, whatever
  entered the test host's root cgroup while it booted (a shell kept open on
  the container, or the harness's own look at systemd) is moved into
  `init.scope`, and the controllers a machine's root always gives its
  children are turned on. Without it, one `docker exec` at the wrong second
  left no container with a limit able to start (the eighth brief, item 1). It
  says what it moved; never part of the suite.
- **`harness/`** also holds the restart probe's fixtures, which are put in
  place only for the way that needs them: the machine's address taken away
  before Docker starts and given back 25 seconds later (`late-address.sh`,
  `late-address.service`, `address-back.service`), and Docker failing its
  first start at a boot (`docker-fails-once.conf`).
- **Three volumes**: Docker's data and containerd's image store (Docker inside
  Docker cannot keep them on the container's overlay root), and a third that
  stands in for the **off-machine backup target**, mounted at
  `/mnt/allvibe-backup`.
- **Ports 8099–8119** of the test host, where the suite's proxy listens,
  published on this workstation's **loopback only**, at the same numbers when
  they are free (the harness checks, and picks another block if not). So a
  project the suite serves at `http://<host>:8101` on a real machine is at
  `http://localhost:8101` here. **Its port 80**, where the panel's door
  listens (D74), goes to the port just after the block, 8120 when the block
  is 8099 to 8119; `status` names it. The harness declares `apps-host=localhost`,
  so the panel links to the apps where this workstation reaches them.

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
