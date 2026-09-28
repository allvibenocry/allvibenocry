#!/bin/sh
# The agent container's start (D39, D46, D47). Its home is in memory, so this
# writes Claude Code's user settings afresh each time, and they say three
# things:
#
#   - the permission mode, set here and never left to Claude Code's default:
#     auto, its documented mode that checks each tool call before it runs
#     (D47). It is set in the user settings because Claude Code takes auto
#     only from there, never from a project's own settings;
#   - claude.ai connectors off: with an account, they would reach the
#     person's other connected services, which the agent never does (D46);
#   - with a key only, where the key comes from: the key vault's file, through
#     the apiKeyHelper setting Claude Code documents for exactly this, so the
#     key is never an environment variable. With an account there is no key
#     and no helper: the person signs in through Claude Code's own flow.
#
# Nothing else about Claude Code is changed, and every one of its own ways of
# signing in stays.
set -eu
mkdir -p "$HOME/.claude"
helper=""
if [ "${AGENT_SIGN_IN:-key}" = key ] && [ -r /run/secrets/ANTHROPIC_API_KEY ]; then
  helper='  "apiKeyHelper": "cat /run/secrets/ANTHROPIC_API_KEY",
'
fi
printf '{\n%s  "permissions": { "defaultMode": "auto" },\n  "disableClaudeAiConnectors": true\n}\n' "$helper" > "$HOME/.claude/settings.json"
# Its conversations, kept after it stops (D60): Claude Code writes a session's
# transcript under ~/.claude/projects/<the working directory>, which for
# /workspace is -workspace; that one directory is a link to the one narrow
# mount made for it. Everything else in its home, its login included, stays in
# memory.
if [ -d /agent-transcripts ]; then
  mkdir -p "$HOME/.claude/projects"
  ln -sfn /agent-transcripts "$HOME/.claude/projects/-workspace"
fi
exec "$@"
