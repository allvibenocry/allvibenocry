# The coding agent's image (D39): the official, unmodified Claude Code, at the
# version package-lock.json pins with integrity hashes, on Node 24 and Debian 13,
# with git for its commits and the key check's scanner (D38). Built on the host
# by the suite, for the service user's uid, and never pulled from anywhere.
#
# Every base is pinned by index digest (D27).
FROM ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS scanner

FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Claude Code, exactly as its lock file says: npm checks every package's
# integrity hash. Its install script links the native binary for this machine.
WORKDIR /opt/claude-code
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force \
 && ln -s /opt/claude-code/node_modules/.bin/claude /usr/local/bin/claude

COPY --from=scanner /usr/bin/gitleaks /usr/local/bin/gitleaks
COPY entrypoint.sh /usr/local/bin/agent-entrypoint

# The user the agent runs as is the service user's uid on the host, so that
# what it writes in the working copy belongs to the same owner as everything
# else there.
ARG AGENT_UID=1001
ARG AGENT_GID=1001
RUN (getent group "$AGENT_GID" >/dev/null || groupadd -g "$AGENT_GID" agent) \
 && (getent passwd "$AGENT_UID" >/dev/null || useradd -u "$AGENT_UID" -g "$AGENT_GID" -d /home/agent -M -s /bin/bash agent) \
 && chmod 755 /usr/local/bin/agent-entrypoint

# The pinned version stays the version: no updates from inside. Telemetry and
# error reports are off, so the only traffic is to the model's API.
ENV HOME=/home/agent DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/agent-entrypoint"]
CMD ["sleep", "infinity"]
