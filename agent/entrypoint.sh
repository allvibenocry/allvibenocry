#!/bin/sh
# The agent container's start (D39). Its home is in memory, so this writes
# Claude Code's user settings afresh each time: its API key comes from the key
# vault's file, through the apiKeyHelper setting Claude Code documents for
# exactly this, so the key is never an environment variable. Nothing else about
# Claude Code is changed, and every one of its own ways of signing in stays.
set -eu
mkdir -p "$HOME/.claude"
if [ -r /run/secrets/ANTHROPIC_API_KEY ]; then
  printf '{\n  "apiKeyHelper": "cat /run/secrets/ANTHROPIC_API_KEY"\n}\n' > "$HOME/.claude/settings.json"
fi
exec "$@"
