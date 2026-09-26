# Vikt's operational tooling: an inventory

All vibe no cry grows out of [Vikt](https://github.com/lundstream/vikt)
(AGPL-3.0), whose release, backup and restore tooling has been through real
releases and real failures. This is every operational mechanism in it, what it
does, which of Vikt's decisions it came from, and whether the suite should
**take** it as it is, **adapt** it, or leave it as **Vikt-specific**.

Read from Vikt's `dev` branch at commit `925837a` (2026-09-26): `infra/` (the
compose files, the Dockerfiles, the nginx scripts, `backup.sh`,
`restore-check.sh`, `backup-decrypt.mjs`), `scripts/release.mjs`,
`scripts/stack.mjs`, `scripts/portainer.mjs`, `scripts/host-scripts.mjs`,
`docs/backup.md`, the Self-hosting and Deploying sections of `README.md`, and the
entries of Vikt's `DECISIONS.md` these cite ("Vikt D103" below means that file's
D103, not ours). No host-specific value from Vikt is copied here (rule 10): where
Vikt names its own paths, containers, subnets or hosts, this says what kind of
thing it is instead.

**The one judgement that shapes most verdicts.** Vikt is one app, built in CI,
pushed to a registry, and deployed by its developer to a server they manage with
Portainer. The suite is many apps, built **on the machine they run on**, by
people who have never opened a terminal. So the registry, the CI release
pipeline, Portainer and `gh` are Vikt-specific; what they *taught* is not, and
most of the lessons below survive the move.

---

## 1. Images and builds

### 1.1 Every image pinned by digest
- **Source:** `infra/api.Dockerfile`, `infra/web.Dockerfile`, all three compose files.
- **Vikt decision:** D138.
- **Does:** every base and service image is referenced as `name:tag@sha256:…`, the
  tag for the reader and the **index** digest for the pull, so a moved or
  withdrawn tag cannot change or break a build.
- **Verdict: Take.** The suite pins Postgres, Node, nginx and its own base images
  the same way, index digests so the pin resolves per architecture.

### 1.2 The image says which build it is
- **Source:** `infra/api.Dockerfile` (`APP_VERSION`, `APP_COMMIT` build arguments).
- **Vikt decision:** D151.
- **Does:** the version and commit are build arguments baked into the image, not
  settings, so a deployment cannot claim to be a version it is not.
- **Verdict: Adapt.** Each prod image the suite builds is labelled with the
  project's release number and git commit, and `allvibe project status` reads
  the labels rather than a record that could drift from what runs.

### 1.3 Migrations from the container's entrypoint
- **Source:** `infra/api-entrypoint.sh`.
- **Vikt decision:** Vikt's CLAUDE.md, "migrations are additive and an applied one
  is never edited".
- **Does:** every start applies any checked-in migration not yet applied, then
  hands off to the server.
- **Verdict: Adapt.** The starter template does the same, so a release that adds a
  table needs no separate step. The suite must know what it means for rollback:
  going back to older code does not undo a migration (see 4.7).

### 1.4 A database client in the app image, matched to the server
- **Source:** `infra/api.Dockerfile` (PostgreSQL 16 client from the PGDG repository).
- **Vikt decision:** Vikt D103 (the app takes its own backups over its database
  connection).
- **Does:** gives the API a `pg_dump` of the server's major version.
- **Verdict: Vikt-specific.** It exists because Vikt's *app* takes backups. The
  suite takes them from outside, through the database's own container (3.1), so
  the client always matches the server and no app image needs one.

### 1.5 Images built in CI and pushed to a registry, on version tags only
- **Source:** Vikt's `.github/workflows/release.yml`.
- **Vikt decision:** D148, D151, D169.
- **Does:** a version tag builds and pushes images tagged with the version, the
  minor, `sha-<commit>` and `latest`; only tags trigger it, never branches.
- **Verdict: Vikt-specific** for projects: a beginner's machine builds its apps
  locally, from the project's own git repository, and has no registry. It may
  come back for the suite's *own* releases later. The lesson that one trigger
  may not start two runs, one failing by construction (D169), is generic.

### 1.6 "Is the package anonymously pullable?"
- **Source:** `release.yml`, `scripts/stack.mjs` (`registryHas`).
- **Vikt decision:** D160.
- **Does:** after pushing, asks the registry with no credential, the way the
  host will, because an authenticated job succeeds whatever the visibility is.
- **Verdict: Vikt-specific** (no registry here). Its lesson, **ask the question
  the real consumer will ask**, is in the mistakes list.

---

## 2. The stack's shape

### 2.1 One front door; the app publishes nothing; the database has no route out
- **Source:** `infra/docker-compose.yml`, `infra/docker-compose.portainer.yml`,
  README "Self-hosting".
- **Vikt decision:** D12.
- **Does:** only nginx publishes a port, and only to the host's loopback; the API
  publishes nothing and is reached over an `edge` network; Postgres sits on an
  `internal: true` network with no route off the host.
- **Verdict: Take**, adapted to many projects. The suite's nginx is the only
  ingress; each environment's app publishes only to the host's loopback, where
  the proxy reaches it; each environment's database is on an internal network of
  its own. That is also most of what rule 1 needs.

### 2.2 Postgres with a named volume, a health check, and `service_healthy`
- **Source:** the compose files.
- **Vikt decision:** D138 (pin), D12 (network).
- **Does:** the database keeps its data in a named volume that survives the
  container, reports readiness with `pg_isready`, and the app waits for it.
- **Verdict: Take.** Per environment, with the volume named after the project
  and the environment, so a dev volume and a prod volume can never be confused.

### 2.3 The app's health check
- **Source:** the compose files (`fetch('http://127.0.0.1:3000/api/health')`).
- **Vikt decision:** part of D12's stack; the health endpoint reports the build (D151).
- **Does:** Docker marks the API healthy only when its own health endpoint answers.
- **Verdict: Take**, and extend: the template's health endpoint also queries the
  database, and the suite's smoke check is that endpoint, so "healthy" means the
  app can read its data.

### 2.4 Required values refuse, they do not default
- **Source:** `${VAR:?message}` throughout the Portainer compose.
- **Vikt decision:** D148 (no `latest` default), D168 (a backup directory is required).
- **Does:** a stack missing a value it needs fails to start and says which.
- **Verdict: Adapt.** The suite generates its compose files, so nobody types the
  values; but the principle holds for generated config too: generate everything
  a stack needs, and refuse to deploy a file that references anything unset.

### 2.5 Every variable the app reads is forwarded, and a test holds it
- **Source:** the Portainer compose's comments; Vikt's stack-variable test.
- **Vikt decision:** D147, D157.
- **Does:** a variable set in the panel but not forwarded by the compose file is
  silently absent in the container; the test fails if one is missing.
- **Verdict: Adapt.** The suite writes both sides, the environment and the
  compose, from one description of the project, so the two cannot disagree; a
  test holds it for the starter template.

### 2.6 A pinned subnet so the proxy can be trusted by address
- **Source:** the compose files (`edge` network), `TRUST_PROXY`.
- **Vikt decision:** D14.
- **Does:** pins the network between nginx and the API so the API trusts
  forwarding headers only from that exact peer.
- **Verdict: Vikt-specific for now.** Nothing is published to the internet in the
  first brief. It becomes relevant when projects are published (a later brief).
  D14's lesson, that proxy trust must check the peer rather than count hops, goes
  with it then.

### 2.7 The development database published on loopback
- **Source:** `infra/docker-compose.dev.yml`.
- **Vikt decision:** D12 (the exception).
- **Does:** publishes Postgres on the workstation's loopback because the API runs
  outside Docker during development.
- **Verdict: Vikt-specific.** A suite project's dev environment runs entirely in
  containers, and its database publishes nothing.

### 2.8 nginx rewrites the page at container start
- **Source:** `infra/nginx/30-app-name.sh`, `31-modes.sh`, `32-site-config.sh`.
- **Vikt decision:** D13, D94, D121, D127, D173.
- **Does:** fills the app name, the deployment modes and the operator's details
  into the built files when nginx starts, so one image serves any installation.
- **Verdict: Vikt-specific** as a mechanism: it configures one particular app.
  Two principles from it are worth keeping for the suite's own features later:
  a mode is configuration, **off by default**, and when off the feature is
  **absent, not disabled** (D94, D127).

### 2.9 nginx's caching and routing rules
- **Source:** `infra/nginx/default.conf`.
- **Vikt decision:** D13, D90, D106.
- **Does:** hashed assets immutable, pages never cached, exact-match locations,
  unknown paths a real 404 rather than a fallback page, proxy headers for the API.
- **Verdict: Adapt.** The suite's proxy forwards to whole apps and does not know
  their files, so it sets only what is safe for any app (forwarding headers, no
  caching of its own) and leaves caching to the app.

---

## 3. Backups and restore

### 3.1 The dump is taken through the database's own container
- **Source:** `infra/backup.sh`.
- **Vikt decision:** D96, D163.
- **Does:** `pg_dump -Fc` runs inside the running Postgres container, so the
  client's version always equals the server's; a client one major version behind
  refuses, and that failure only ever shows during a restore.
- **Verdict: Take.** Custom format too: compressed, and `pg_restore` can read it
  selectively.

### 3.2 `.partial` until complete, then renamed
- **Source:** `infra/backup.sh`.
- **Vikt decision:** D96.
- **Does:** writes to `<name>.partial` and renames only when the dump is complete,
  so an interrupted run never leaves a truncated file that looks like a backup.
- **Verdict: Take**, and strengthen: flush the file to disk before the rename, and
  write the backup's small manifest last, so a backup without a manifest is by
  definition incomplete.

### 3.3 Retention by age, only of what the job made, and release backups kept apart
- **Source:** `infra/backup.sh`.
- **Vikt decision:** D159.
- **Does:** deletes dumps older than N days, `-maxdepth 1` so it never recurses
  into a subdirectory, and keeps a release's rollback dump in `releases/`, outside
  the rotation.
- **Verdict: Take.** By age, not by count, so a week the job did not run does not
  shorten what survives; never delete anything the job did not create; and never
  delete the backup a rollback would need (4.7).

### 3.4 The backup is not encrypted
- **Source:** `infra/backup.sh`, `docs/backup.md`.
- **Vikt decision:** D96, superseded for the app's own backups by D103.
- **Does:** assumes a trusted destination.
- **Verdict: Vikt-specific**, and rejected: the suite's backups leave the machine
  by definition (rule 2), so they are always encrypted (our D13).

### 3.5 The files beside the database are backed up with it
- **Source:** `infra/backup.sh`, `infra/restore-check.sh`, `docs/backup.md`.
- **Vikt decision:** D10, D191.
- **Does:** archives the photo directory beside each dump with the same stamp, and
  the restore check fails when the restored data names a file the archive lacks.
- **Verdict: Vikt-specific in version 1**, since a project's data is Postgres only
  (our D10). The lesson is generic: a backup must hold everything the data points
  at, and the restore check must prove it. When projects can store files, their
  backup covers them in the same run.

### 3.6 The restore check: a scratch copy, compared, and thrown away
- **Source:** `infra/restore-check.sh`.
- **Vikt decision:** D96.
- **Does:** restores a dump into a scratch database with a generated name,
  `--no-owner` so it does not depend on role names, prints row counts and derived
  figures from both the copy and the live database, and drops the copy on exit.
- **Verdict: Adapt.** The suite restores into a scratch **container**, never into
  prod's server, so prod cannot be touched even by a bug; runs the project's own
  smoke check against the restored copy; compares the counts with those recorded
  when the backup was taken; and removes everything it created. `--no-owner`
  stays.

### 3.7 The schedule belongs to something that is always running, and every run is recorded
- **Source:** `docs/backup.md`; Vikt's app-side scheduler.
- **Vikt decision:** D103, D168, D163.
- **Does:** after a documented cron line was never installed, Vikt moved the
  schedule into the app, recorded every run with its result and reason, and
  shows the last and the next.
- **Verdict: Adapt.** The suite's schedule is a systemd timer that `install.sh`
  **enables**, not documents; each run is recorded with its result and, on
  failure, the reason; `allvibe doctor` reports the timer and the last run.

### 3.8 The encrypted backup format
- **Source:** `infra/backup-decrypt.mjs`, `docs/backup.md`.
- **Vikt decision:** D103.
- **Does:** AES-256-GCM with a key derived from `SECRET_KEY`, in a format of
  Vikt's own; the authentication tag is checked before a byte is written out.
- **Verdict: Adapt.** The suite uses `age`, a standard format with a standard tool,
  so a backup can be decrypted on any machine without the suite (our D13). The
  property worth keeping: nothing is restored from a file that has not been
  completely decrypted and authenticated first, so a truncated backup fails
  loudly instead of restoring part of a database.

### 3.9 A standalone decrypt tool
- **Source:** `infra/backup-decrypt.mjs`.
- **Vikt decision:** D103.
- **Does:** decrypts a backup on any machine with Node and the key.
- **Verdict: Adapt.** With `age`, the standalone tool already exists
  (`age --decrypt -i <recovery key>`); the suite documents the command instead
  of shipping its own.

### 3.10 The app checks its own backups
- **Source:** `docs/backup.md`.
- **Vikt decision:** D168.
- **Does:** every thirty days, decrypts the newest backup, restores it into a
  scratch database, compares it with the live one, and shows the result.
- **Verdict: Adapt, more often.** The suite runs its restore check after every
  scheduled backup and before every release (rule 2), not monthly.

### 3.11 Where backups can go, and proving it before the first run
- **Source:** `docs/backup.md`, README "Deploying".
- **Vikt decision:** D133, D168.
- **Does:** a directory (including a share mounted on the host) or an S3 bucket;
  a "test the connection" button writes and deletes an object, naming what is
  wrong; a bind mount's ownership must match the writing process's uid.
- **Verdict: Adapt.** Version 1 supports a mounted directory on a **different
  device** (a USB disk, a NAS mount) and checks it is off the machine's own disk,
  mounted, and writable by the process that will write, before accepting it. S3
  is a later brief.

### 3.12 Network shares are mounted on the host, never spoken to from code
- **Source:** `docs/backup.md`, README.
- **Vikt decision:** D132, D133.
- **Does:** after both Node SMB clients turned out to speak only NTLMv1, which
  current servers refuse, Vikt mounts shares on the host instead.
- **Verdict: Take.** The suite never implements a file-sharing protocol; a NAS
  target is a mount on the host.

### 3.13 A restore is a deliberate act
- **Source:** `infra/backup-decrypt.mjs`, `docs/backup.md` ("a command, not a button").
- **Vikt decision:** D103.
- **Does:** a real restore is typed on the host, after a scratch restore has
  matched, with the current state dumped first.
- **Verdict: Adapt.** Our rule 8: anything that would replace prod's data says what
  would be lost and needs explicit confirmation, and the current state is backed
  up first so even a confirmed mistake is recoverable. In the web UI later that
  is a deliberate flow, not a button beside "run now".

---

## 4. Release and deploy

### 4.1 The runbook is one command that stops at the first bad answer
- **Source:** `scripts/release.mjs`.
- **Vikt decision:** D182, D183.
- **Does:** runs the release steps in order; every step prints its evidence; the
  first failure names the step and what would have to be true, and nothing after
  it runs; tests fail each step in turn.
- **Verdict: Take.** It is our rule 7, and `allvibe release` is built this way.

### 4.2 Backup and restore check before the deploy
- **Source:** `scripts/release.mjs` (steps 4 and 5).
- **Vikt decision:** D182, D96.
- **Does:** takes a fresh backup on the host and restores it into a scratch
  database before anything is deployed.
- **Verdict: Take.** It is our rule 2.

### 4.3 Things are identified exactly, never as "the newest"
- **Source:** `scripts/release.mjs` (CI by full commit sha; the release run by its tag).
- **Vikt decision:** D183.
- **Does:** asks for the CI run of the exact commit being released and the
  workflow run of the exact tag, because "newest" was repeatedly something else.
- **Verdict: Take** as a rule for the suite's own code: a release records and
  compares the exact commit, image and backup it is about.

### 4.4 CI, a fast-forward of `main`, a published release, a news post
- **Source:** `scripts/release.mjs`.
- **Vikt decision:** D182, D169, D194.
- **Does:** the parts of Vikt's release that involve GitHub and the app's own
  news feed.
- **Verdict: Vikt-specific.** A suite project's release is local: its commit, its
  build, its version tag in its own repository.

### 4.5 The release's inputs come from a fenced block in STATE.md
- **Source:** `scripts/release.mjs` (`readReleaseBlock`).
- **Vikt decision:** D193, D194.
- **Does:** reads the release's variables from one fenced `release` block and
  nothing else, after a regular expression over prose read a sentence as an
  instruction.
- **Verdict: Vikt-specific** as a mechanism. The lesson, never let prose and
  executable input be the same text, is in the mistakes list.

### 4.6 Deploying through Portainer's API
- **Source:** `scripts/stack.mjs`, `scripts/portainer.mjs`.
- **Vikt decision:** D164, D174, D158, D156, D147.
- **Does:** plans and then deploys a stack update: reads the stack, checks the
  stack file is the release's, merges variables without dropping any (Portainer
  replaces the environment wholesale), takes secrets only by name, prints names
  never values, checks the images exist, waits for the new version to be
  healthy, and prints the rollback command.
- **Verdict: Vikt-specific** (Portainer). What it does carries over to the suite's
  own deploy, which drives Docker Compose directly: plan before changing; a
  full-replacement update must not drop anything it did not mean to; secrets by
  name, values never printed; wait for *healthy on the new version*, not
  "started"; and always say how to go back.

### 4.7 A pinned version, and a rollback of one line
- **Source:** the Portainer compose (`IMAGE_TAG` with no default).
- **Vikt decision:** D148.
- **Does:** the stack runs an explicit version, never `latest`; going back is
  setting the previous version.
- **Verdict: Take.** Prod always runs an explicit release, and `allvibe rollback`
  redeploys the previous one. What a code rollback cannot undo is a migration;
  rule 8 covers the data side.

### 4.8 Where the image comes from
- **Source:** `scripts/stack.mjs` (`IMAGE_REPO`, `--repo local/`).
- **Vikt decision:** D156, and D120, which D156 cites for building on the
  workstation and loading onto the host (it has no entry of its own in Vikt's
  DECISIONS.md).
- **Does:** switches between a registry and images loaded onto the host.
- **Verdict: Vikt-specific.** The suite always builds on the host.

### 4.9 A dry run that knows what it cannot see yet
- **Source:** `scripts/release.mjs` (`--dry-run`, the expected "image not built yet").
- **Vikt decision:** D194.
- **Does:** runs every check, changes nothing, and does not fail on the one thing
  a dry run cannot have: the images of the version it has not built.
- **Verdict: Adapt.** `allvibe release --dry-run` runs every check and changes
  nothing, and says for each step that is a change what it would do.

### 4.10 Files that reach the host outside an image have a checksum
- **Source:** `scripts/host-scripts.mjs`.
- **Vikt decision:** D163.
- **Does:** compares the host's copies of the backup scripts with the committed
  files by sha256 (the committed blob, never a CRLF working copy), installs them,
  and reports whether the schedule exists without installing it.
- **Verdict: Adapt.** Everything the suite runs on the host is installed by
  `install.sh`, which knows the version it installed, and `allvibe doctor`
  reports it; the repository keeps LF line endings (`.gitattributes`).

---

## 5. Configuration and secrets

### 5.1 No step asks for a password
- **Source:** `scripts/portainer.mjs`, Vikt's CLAUDE.md §7.
- **Vikt decision:** D158.
- **Does:** reads the credential from the environment by name; missing, it names
  the variable and exits 2 (not configured, as opposed to 1, failed); there is no
  prompt, no argument that takes one, and every line of output is redacted.
- **Verdict: Take.** It is our rule 4. Every credential the suite ever needs is
  read the same way, and anything the suite prints passes through redaction.

### 5.2 Secrets never on a command line
- **Source:** `scripts/stack.mjs` (`--set-from-env`, names containing SECRET, PASS,
  KEY or TOKEN refused as arguments).
- **Vikt decision:** D174.
- **Does:** refuses a secret-looking value as an argument and takes it only from
  the environment.
- **Verdict: Take.** The suite generates its secrets itself and hands them to
  containers as files with restricted permissions, so they never pass through a
  command line, an environment dump or `docker inspect`.

### 5.3 The app refuses to start misconfigured
- **Source:** Vikt's `assertProdSecrets` (cited by the compose files).
- **Vikt decision:** D109, D113, D136.
- **Does:** refuses to boot with missing or weak secrets, a half-configured
  feature, or a local address where a public one is needed.
- **Verdict: Adapt** for the starter template: it refuses to start without its
  database secret, which makes a misconfigured stack fail its health check
  instead of half-working.

### 5.4 Settings that change often live in the app, encrypted
- **Source:** the compose file's `SECRET_KEY` notes.
- **Vikt decision:** D102.
- **Does:** keeps mail settings in the database, encrypted with a key from the
  environment.
- **Verdict: Vikt-specific.**

### 5.5 The operator is a setting
- **Source:** `infra/nginx/32-site-config.sh`.
- **Vikt decision:** D121.
- **Does:** the person responsible under the GDPR is whoever deploys, so their
  contact details are configuration, not source.
- **Verdict: Vikt-specific now.** It returns when projects are published to the
  internet (a later brief): a beginner publishing an app becomes its operator.

---

## Summary

| Verdict | Mechanisms |
|---|---|
| **Take** | 1.1 pin by digest · 2.1 one front door, nothing else published · 2.2 Postgres with volume and health check · 2.3 health check (extended) · 3.1 dump through the server's container · 3.2 `.partial` then rename · 3.3 retention by age, only what it made · 3.12 mount shares on the host · 4.1 one command, stop at first failure · 4.2 backup and restore check before deploy · 4.3 exact identity, never "newest" · 4.7 pinned version, one-line rollback · 5.1 no step asks for a password · 5.2 secrets never on a command line |
| **Adapt** | 1.2 build labels · 1.3 migrations at start · 2.4 required values · 2.5 forwarded variables · 2.9 proxy rules · 3.6 restore check in a scratch container · 3.7 timer enabled at install, runs recorded · 3.8 `age` instead of a custom format · 3.9 decrypt with `age` · 3.10 check after every backup · 3.11 off-device, mounted, writable · 3.13 deliberate restore (rule 8) · 4.9 dry run · 4.10 installed version known · 5.3 template refuses misconfiguration |
| **Vikt-specific** | 1.4 client in the app image · 1.5 CI and registry · 1.6 anonymous pull check · 2.6 pinned proxy subnet (until publishing) · 2.7 dev database on loopback · 2.8 nginx rewrites at start · 3.4 unencrypted backups · 3.5 photo archive (until projects store files) · 4.4 GitHub release steps · 4.5 inputs from STATE.md · 4.6 Portainer · 4.8 image source switch · 5.4 settings in the app · 5.5 operator setting (until publishing) |

The lessons that are generic, each with the decision it came from, are in
[CLAUDE.md](../CLAUDE.md#mistakes-we-do-not-repeat).
