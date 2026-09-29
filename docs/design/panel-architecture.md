# The control panel: architecture and threat model

*2026-09-29. The sixth brief, item 6. Decided before any of the panel's code
(D62, D63, D64). What the panel looks like is in
[control-panel.md](control-panel.md); this is how it is built, who can reach
it, and what it can reach.*

## In one picture

```
 browser on the home network
        |  http://<the machine's home-network address>/        (port 80)
        v
 +------------------------------------------------------------------+
 | the machine                                                      |
 |                                                                  |
 |  proxy (nginx, the one front door, D12)                          |
 |    answers on the home-network address only, to private          |
 |    source addresses only; everything else is refused             |
 |        |                                                         |
 |        v  http, over the panel's internal network                |
 |  panel container (Node.js 24, pinned, D40)                       |
 |    no route out; read-only; no capabilities; not root;           |
 |    one mount: the engine's socket                                |
 |        |                                                         |
 |        v  JSON over a Unix socket                                |
 |  engine (a host service, as the service user)                    |
 |    an allow-list of operations that mirror the CLI, calling      |
 |    the CLI's own code; never a shell, never a secret value       |
 |        |                                                         |
 |        v                                                         |
 |  Docker, the projects, backups, the proxy's files, as today      |
 +------------------------------------------------------------------+
```

Rule 5 holds: **the CLI is the engine the panel calls**. The panel draws
screens and asks the engine; it never reimplements an operation, and the engine
runs the CLI's own code for each one.

## The engine (D62)

**What it is.** A small host service, `allvibe-engine.service`, run by systemd
as the service user (`allvibe`), on the same Node.js as the CLI (Debian's, D15,
D32), from the same installed version (`/opt/allvibe/current`). It starts after
Docker and restarts on failure.

**Where it listens.** Only on a Unix socket, `/var/lib/allvibe/engine/engine.sock`.
It opens no network port at all. The folder is the service user's, with the
group `allvibe-panel`, mode 0750; the socket is 0660. So only the service user
and the panel's user (the group's one member besides it) can connect; any other
user of the machine is refused by the file system. The folder is on disk, not
in `/run`, so that it survives the engine's restarts and the machine's reboots,
and the panel's mount of it never goes stale.

**Why Node.js 20 is right here** (D40 ruled it out for the panel): the engine
listens on no network, and parses only what the panel sends it, over a socket
nobody else can open. That is the CLI's situation, which D32 accepts, not a web
server's. What any browser sends is parsed by the panel, on Node.js 24.

**The protocol.** HTTP/1.1 over the socket, JSON in and out:

- `POST /v1/<operation>` with a JSON body of arguments, at most 16 kB.
- An answer is `{ "ok": true, "result": ... }` or `{ "ok": false, "error":
  { "code", "message", ... } }`, where `code` is one of `unknown_operation`,
  `bad_arguments`, `not_found`, `busy`, `refused`, `failed` and `message` is in
  plain words, the CLI's own where there is one.
- A long operation answers at once with `{ "job": "<id>" }`; `job.get` then
  gives its steps so far, each with its number, name, state (running, ok,
  failed) and the lines the CLI prints for it, until it ends with the
  operation's result. **The steps are the CLI's own** (`runSteps`), so the panel
  shows exactly what `allvibe release` prints, and stops where it stops (rule 7).
- One long operation at a time: another is refused with `busy`, naming the
  one that runs.

**The operations**, the whole allow-list of the first version. Each has its
arguments validated before anything runs; anything else is `unknown_operation`.

| Operation | Arguments | What it does, as the CLI | Kind |
|---|---|---|---|
| `machine.status` | none | `allvibe doctor`: every check, its status and its words | read |
| `machine.lastNight` | none | `allvibe doctor --last`: what the nightly check found (D58) | read |
| `apps.list` | none | every project: its live version, prod's and the test copy's health, its plan's progress, and the next thing to do | read |
| `app.get` | `app` | one project: the same, its versions (from its releases), and the addresses of its test copy and its live app | read |
| `app.plan` | `app` | `allvibe plan`: the plan the test copy runs, each step tried, ready to try, or still being built | read |
| `app.backups` | `app` | `allvibe backups`: its backups, with their kind and version | read |
| `app.markTried` | `app`, `step` | `allvibe plan tried`: the person tried this step in the test copy | change |
| `app.report` | `app`, `text` | "Something is wrong": the person's words saved as a plain text file in the project's folder, outside its working copy, for now | change |
| `app.startTestCopy` | `app` | `allvibe dev deploy`: the test copy built from the working copy and started | long |
| `app.putLive` | `app` | `allvibe release`: every step of it, the second that every step is tried (D56) | long |
| `app.goBack` | `app` | `allvibe rollback`: the code only, behind a fresh backup (D57) | long |
| `job.get` | `job` | a long operation's steps so far, and its result | read |
| `auth.status` | none | whether the panel has been claimed, and how long sign-in is paused | panel |
| `auth.claim` | `setupCode`, `password` | the first visit: the one-time code, and the password the person chooses | panel |
| `auth.check` | `password` | signing in | panel |

Arguments: `app` is a project's name (the CLI's rule for names) and must
exist; `step` is a whole number from 1 to 50; `text` is 1 to 4,000 characters,
with no control characters but line breaks and tabs; `password` is 12 to 200
characters; `setupCode` is the code's own shape; `job` is a job's id.

**What the engine never offers**, in this version: a shell or any free-form
command; any key's value, the recovery key, or anything from the key vault;
`--restore-data` (going back with the data, which loses data and needs its own
confirmation, rule 8); `--outside-plan`; creating or removing a project;
starting the agent. Each is a decision for a later slice, with its own words
and confirmations.

**Secrets.** No operation returns a secret value. The CLI's step lines are
written never to hold one (rule 4); the engine adds nothing to them. The
password and the setup code go in, and only "right" or "wrong" comes out.

## The panel's container (D63)

- **Image**: built on the machine from the official Node.js 24 image pinned by
  digest (the same one the suite already pins, `node:24.21.0-alpine@sha256:…`),
  with the panel's own files copied in, and never pulled, like the agent's
  (D39). No dependencies from npm: Node's standard library only.
- **Runs as** the panel's own user, `allvibe-panel`, not root, with every
  capability dropped, `no-new-privileges`, a read-only root file system, a small
  `/tmp` in memory, and limits on memory and processes.
- **One mount**: the engine's socket folder, read-only
  (`/var/lib/allvibe/engine`, which holds nothing but the socket). Nothing else
  of the machine: not the Docker socket, not the host's network, not privileged
  mode, not the host key, the recovery key, the backup target, the key vault or
  any project's files (rule 12).
- **Its network**: one Docker network of its own, created `--internal`: the
  container has no route out of it. Seen on the test host with a scratch
  container on such a network: the machine reached it, and from inside it the
  internet timed out and the machine's own home-network address was
  unreachable. So the panel cannot reach the internet, the home network, the
  projects or the agent, whatever its code does. It has a fixed address on that
  network, which the proxy is given.
- **State**: none on disk. Its sessions are in its memory; the password's hash,
  the setup code's hash and the count of failed attempts are the engine's, in
  `/var/lib/allvibe/panel/auth.json`, readable only by the service user.

## Where it answers (D63)

- **The proxy is the door**: the same nginx that fronts every project (D12)
  gets one more server, generated and checked with `nginx -t` like the others.
- **Only on the machine's home-network address**, the address of its route to
  the internet, as `install.sh` and `doctor` already find it, **on port 80**, so
  that the address alone, with no port, opens it (and `allvibe.local` later,
  Planned). The engine writes the door at every start, so a new address after a
  reboot is picked up; `doctor` says which address the panel answers on.
- **Only to private source addresses**: nginx allows 10.0.0.0/8, 172.16.0.0/12,
  192.168.0.0/16 and the machine itself, and refuses the rest. The machine has
  no public address on a home network, so this is a second fence, not the
  first; rule 3 holds because nothing forwards the internet to it.
- **Only by its own names**: a request whose `Host` is not the machine's
  address (or, later, `allvibe.local`) is refused, so a web page that points a
  name of its own at the machine's address (DNS rebinding) reaches nothing.
- **Never to a project container or the agent**: D41's firewall already refuses
  every project container, the agent and its gate the machine's own ports,
  which include this one, and every private address, which includes the panel's
  network. To be proved on the test host, from inside a dev app, a prod app and
  the agent, by the machine's address, by each network's gateway, and by the
  panel's own address.
- **IPv4 only**, as the proxy (D41, D49).

## Signing in (D64)

**Required even at home.** Anyone on the home network can reach the panel's
address, and the panel can put a version live or go back.

1. **The first visit needs a one-time setup code** that `install.sh` shows at
   its end, on the machine itself: 16 characters from an alphabet without look-
   alike letters (80 bits), in four groups. Only its hash is kept. So another
   device on the network cannot claim the panel first: it would need the code on
   the machine's screen. The code works once, and only while nobody has claimed
   the panel; `allvibe panel setup-code`, on the machine, makes a new one while
   it is unclaimed, and refuses once it is claimed.
2. **Then a password the person chooses**, 12 characters or more. It is kept as
   an scrypt hash with a salt of its own. There is one password: the owner's
   (invitations and more people are Planned, D34).
3. **A session cookie**, `HttpOnly`, `SameSite=Strict`, `Path=/`, holding a
   random 256-bit id and nothing else; the session lives in the panel's memory,
   ends after 12 hours without use or 7 days at most, and "Sign out" ends it. A
   restart of the panel signs everyone out.
4. **Cross-site requests are refused**: besides `SameSite=Strict`, every request
   that changes something must be JSON, must carry the session's own token in a
   header of its own (`X-Allvibe-Token`), which only the panel's pages can read,
   and must come from the panel's own origin (`Origin`, `Sec-Fetch-Site`). The
   panel answers no cross-origin request (no CORS).
5. **Attempts are limited**, by the engine, for the setup code and the password
   alike: after 5 wrong ones in a row, a pause of 30 seconds, doubling with each
   further wrong one up to 15 minutes; a right one resets it. The count is
   kept on disk, so a restart does not reset it.
6. **Forgotten password**: `allvibe panel reset`, on the machine (so by whoever
   has the machine), makes the panel unclaimed again, shows a new setup code,
   and signs everyone out.

**The limit, recorded**: the panel is plain HTTP on the home network, so the
password and the session's cookie could be read by someone on the same network
who captures its traffic. **Planned**, in the roadmap: TLS on the home network,
passkeys, and MFA (with sign-in and invitations, D54).

## What the panel never does

- **Reach the internet on its own**: its network has no route out (above).
- **Load anything from another origin** for itself: its pages, scripts, styles,
  fonts and images are its own, and its Content-Security-Policy says so
  (`default-src 'none'`, then `'self'` for each kind it uses, `frame-ancestors
  'none'`, `form-action 'self'`, `base-uri 'none'`). **The one exception**, named
  below as an open question: the Preview shows the real test copy, which is the
  person's own app at its own address on the same machine, in a frame the
  policy allows for exactly those addresses.
- **Show a secret value**: the engine returns none.
- **Run anything the engine does not offer**: it has no other way to act.
- **Set any cookie but its session's**, or keep anything about the visitor
  beyond the session.
- **Log requests**: the proxy keeps no access log (D11); the panel logs nothing
  about requests; the engine records each operation it runs, as the CLI does
  (`allvibe runs`).

## Threats, and what answers them

| Threat | What answers it |
|---|---|
| Someone on the internet | Nothing forwards the internet to the machine (rule 3); the proxy also refuses non-private sources. |
| Another device on the home network claims the panel first | The setup code, shown only on the machine. |
| Another device guesses the password | The attempt limits; a password of 12 characters or more. |
| Someone on the home network reads the traffic | **Not answered yet**: plain HTTP. TLS on the home network is Planned. |
| A web page the person visits acts on the panel (cross-site request forgery) | `SameSite=Strict`, the token header, the `Origin` check, JSON only, no CORS. |
| A web page rebinds its own name to the machine (DNS rebinding) | The `Host` check. |
| A project's app, or the agent, reaches the panel | D41's firewall; to be proved. |
| A flaw in the panel's code | The container: no route out, no capabilities, not root, read-only, one mount; and the engine, which offers only its list, validates every argument, and never returns a secret. |
| A flaw in the engine | It runs as the service user, as the CLI does today, and parses only what the panel sends. The panel is its only client. |
| Two operations at once | One long operation at a time in the engine; the CLI beside it is not locked out (D28), an open question. |

## Open questions

For the owner and the architect; none blocks the first slice.

1. **The Preview frame** loads the test copy from its own address, another
   origin than the panel's, allowed for exactly those addresses. The other way,
   the panel passing the test copy through its own origin, would give the panel
   a way into the projects' networks, which it has none of now. Is the frame
   acceptable?
2. **Reaching the panel from outside the house**, over a VPN to the home network
   (for example one that gives addresses in 100.64.0.0/10): refused today, as
   not private. A decision for later.
3. **Plain HTTP at home** (above): TLS, passkeys and MFA are Planned; until then
   the password travels in the clear on the home network.
4. **Sessions in memory**: a restart of the panel signs everyone out. Acceptable
   for one owner?
5. **The CLI and the panel at the same time**: the engine runs one long
   operation at a time, but the CLI can still run another beside it (D28).
6. **The engine on Node.js 20** (above): accepted by the reasoning of D32 and D40,
   for the architect to confirm.
7. **Port 80**: if another service on the machine already uses it, install
   stops and says so. Should the panel then take another port, or ask?
8. **What comes next into the engine's list**, each with its confirmations:
   going back with the data (`--restore-data`), creating and removing a
   project, keys, the agent, and work outside a plan.
9. **More than one person**: one password today; invitations, with MFA, are
   Planned (D54).
