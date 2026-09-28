#!/bin/sh
# The agent's activity log and its kept conversations (D60), probed on the
# host, as root, with the agent running, in either way of signing in.
#
#   sh agent-activity.sh <command> <project> <file: prod's key value> <file: dev's key value> [<file: the agent's key value>]
#
# A real Claude Code session runs in the agent against the stand-in for the
# model's API (stub-api.mjs, on dev's network, for this test only), which asks
# for four tool calls: a listing, a file written with a content marker, a
# command holding a fake key, and a command that fails. With an account there
# is no login to use, so this test session alone gets a stand-in key, never
# anyone's. Before it, a stand-in login is put where Claude Code keeps one.
# Then: one line per call in the log, with the path or the command and how it
# went, never the file's content, and the fake key withheld; a line from
# another container refused; a line the agent writes itself with a fake key,
# withheld; the log out of the agent's reach, and the lines still written
# when the agent turns hooks off in the settings it can write; the sessions'
# transcripts kept on the machine, and not deleted while the agent runs; and
# the stand-in login
# and key and the vault's values in neither. All markers are random and kept
# in memory (/dev/shm). The last line counts what is not as it must be.
set -u
C=${1:?usage: agent-activity.sh <command> <project> <prod value file> <dev value file> [agent value file]}
P=${2:?project}
PROD_VALUE=${3:?prod value file}
DEV_VALUE=${4:?dev value file}
AGENT_VALUE=${5:-}
A=$C-$P-agent
L=$C-$P-agent-activity
S=$C-$P-dev-stubapi
DATA=/var/lib/$C/projects/$P/agent
LOG=$DATA/log/activity.jsonl
TR=$DATA/transcripts
IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
total=0
wrong=0

verdict() { # $1 label, $2 what was seen, $3 what it must be
  total=$((total + 1))
  if [ "$2" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-60s %-24s %s\n' "$1" "$2" "$v_ok"
}
marker() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
lines() { if [ -f "$LOG" ]; then wc -l < "$LOG" | tr -d ' '; else echo 0; fi; }
# Files under the kept data holding any of the patterns in $1.
found() { grep -rlsF -f "$1" "$DATA" 2>/dev/null | wc -l | tr -d ' '; }

[ "$(docker inspect -f '{{.State.Running}}' "$A" 2>/dev/null)" = true ] || { echo "the agent of $P is not running: $C agent start $P first"; exit 2; }
MODE=$(docker inspect -f "{{index .Config.Labels \"$C.sign-in\"}}" "$A")
[ "$MODE" = account ] || MODE=key
mem=$(mktemp -d /dev/shm/agent-activity.XXXXXX)
chmod 700 "$mem"
trap 'rm -rf "$mem"; docker rm -f "$S" >/dev/null 2>&1' EXIT
marker > "$mem/login"
marker > "$mem/content"
printf '%s-%s-%s%s' sk-ant api03 "$(head -c 300 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 93)" AA > "$mem/fakekey"
printf 'CONTENT_MARKER=%s\nFAKE_KEY=%s\n' "$(cat "$mem/content")" "$(cat "$mem/fakekey")" > "$mem/stub.env"
printf '%s-%s-%s%s' sk-ant api03 "$(head -c 300 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 93)" AA > "$mem/standin"
printf 'ANTHROPIC_API_KEY=%s\n' "$(cat "$mem/standin")" > "$mem/session.env"
{ cat "$mem/login"; echo; cat "$mem/standin"; echo; } > "$mem/never"
# One value per line and no empty line: grep -f matches everything with one.
for f in "$PROD_VALUE" "$DEV_VALUE" ${AGENT_VALUE:+"$AGENT_VALUE"}; do cat "$f"; echo; done | grep -v '^$' > "$mem/values"
verdict "the vault's values to look for" "$(wc -l < "$mem/values" | tr -d ' ')" "$(($# - 2))"

echo "a session in the agent ($MODE), against the stand-in for the model's API:"
{ printf '{"claudeAiOauth":{"accessToken":"'; cat "$mem/login"; printf '"}}'; } | docker exec -i "$A" sh -c 'umask 077; cat > "$HOME/.claude/.credentials.json"'
before_lines=$(lines)
before_tr=$(find "$TR" -maxdepth 1 -name '*.jsonl' | wc -l | tr -d ' ')
mkdir -p /var/tmp/stub-api && cp /root/stub-api.mjs /var/tmp/stub-api/ && chmod -R a+rX /var/tmp/stub-api
docker rm -f "$S" >/dev/null 2>&1
docker run -d --name "$S" --label "$C.test=stub-api" --network "$C-$P-dev-internal" --read-only --cap-drop ALL \
  --env-file "$mem/stub.env" -v /var/tmp/stub-api/stub-api.mjs:/stub.mjs:ro "$IMAGE" node /stub.mjs >/dev/null
sleep 2
np=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$A" | sed -n 's/^NO_PROXY=//p')
extra=""
[ "$MODE" = account ] && extra="--env-file $mem/session.env"
session() { # the scripted session, its output in $out
  # shellcheck disable=SC2086 # $extra is one option and its file, or nothing
  out=$(timeout 180 docker exec $extra -e ANTHROPIC_BASE_URL="http://$S:8080" -e NO_PROXY="$np,$S" -e no_proxy="$np,$S" -w /workspace "$A" \
    claude -p "Do the scripted steps." --permission-mode acceptEdits --allowedTools Bash Write --output-format text 2>&1)
  sleep 3
}
session
verdict "the session ran to its end" "$(printf '%s\n' "$out" | grep -c 'the stub session is over')" "1"

echo "the activity log:"
verdict "one line per tool call" "$(($(lines) - before_lines))" "4"
tail -n 4 "$LOG" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>d.trim().split('\n').forEach(l=>{const e=JSON.parse(l);console.log(e.tool+'|'+e.target+'|'+e.outcome)}))" > "$mem/new"
sed 's/^/  | /' "$mem/new"
verdict "the listing" "$(sed -n 1p "$mem/new")" "Bash|ls /workspace|ok"
verdict "the file written: its path, not its content" "$(sed -n 2p "$mem/new")" "Write|/workspace/stub-note.txt|ok"
verdict "the command with a fake key: withheld" "$(sed -n 3p "$mem/new" | grep -c 'looks like a key or a password: not logged')" "1"
verdict "the command that failed" "$(sed -n 4p "$mem/new")" "Bash|ls /no-such-directory|failed"
verdict "the file's content marker in the log" "$(grep -cF -f "$mem/content" "$LOG")" "0"
verdict "the fake key in the log" "$(grep -cF -f "$mem/fakekey" "$LOG")" "0"
before_lines=$(lines)
code=$(docker exec "$C-$P-dev-app" node -e "fetch('http://$L:3129/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'Bash',target:'from dev',outcome:'ok'})}).then(r=>console.log(r.status)).catch(e=>console.log(e.cause?.code??e.name))")
verdict "a line sent by dev's app: refused" "$code" "403"
docker exec -i "$A" sh -c "node -e \"let k='';process.stdin.on('data',c=>k+=c).on('end',()=>fetch(process.env.AGENT_ACTIVITY_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'Bash',target:'curl -H x-api-key:'+k.trim()+' example',outcome:'ok'})}).then(r=>console.log(r.status)))\"" < "$mem/fakekey" > "$mem/code"
sleep 2
verdict "a line the agent sends with a fake key: taken" "$(cat "$mem/code")" "204"
verdict "and withheld" "$(tail -n 1 "$LOG" | grep -c 'not logged')" "1"
verdict "one line more, and none from dev" "$(($(lines) - before_lines))" "1"
verdict "the log, inside the agent" "$(docker exec "$A" sh -c '[ -e /log ] || [ -e /log/activity.jsonl ] && echo present || echo absent')" "absent"
verdict "the hooks' managed settings, writable by the agent" "$(docker exec "$A" sh -c '[ -w /etc/claude-code/managed-settings.json ] || [ -w /etc/claude-code ] && echo writable || echo read-only')" "read-only"
echo "the agent turning its hooks off, in the settings it can write (its own, its project's):"
docker exec "$A" sh -c '[ ! -e /workspace/.claude ]' || { echo "the working copy has a .claude directory: this check needs it absent"; exit 2; }
docker exec "$A" sh -c 'cp "$HOME/.claude/settings.json" "$HOME/.claude/settings.json.saved"'
# First, the control: a hook of its own in its own settings, seen running, so
# that the settings are known to be read before turning hooks off in them.
own_hook() { # $1 true or false: disableAllHooks
  docker exec "$A" node -e "const fs=require('fs'),f=process.env.HOME+'/.claude/settings.json',s=JSON.parse(fs.readFileSync(f+'.saved'));s.hooks={PostToolUse:[{matcher:'*',hooks:[{type:'command',command:'touch \"\$HOME/.own-hook-ran\"'}]}]};s.disableAllHooks=$1;fs.writeFileSync(f,JSON.stringify(s))"
  docker exec "$A" sh -c 'rm -f "$HOME/.own-hook-ran"'
}
own_ran() { docker exec "$A" sh -c '[ -e "$HOME/.own-hook-ran" ] && echo ran || echo "did not run"'; }
own_hook false
session
verdict "the control: a hook in its own settings" "$(own_ran)" "ran"
own_hook true
docker exec "$A" sh -c 'mkdir /workspace/.claude && for f in settings.json settings.local.json; do printf "{\"disableAllHooks\": true}" > "/workspace/.claude/$f"; done'
verdict "hooks turned off in its own and its project's settings" "$(docker exec "$A" sh -c 'grep -l "\"disableAllHooks\": *true" "$HOME/.claude/settings.json" /workspace/.claude/settings.json /workspace/.claude/settings.local.json | wc -l')" "3"
before_lines=$(lines)
session
verdict "the session ran to its end" "$(printf '%s\n' "$out" | grep -c 'the stub session is over')" "1"
verdict "its own hook: turned off" "$(own_ran)" "did not run"
verdict "the log's hook: one line per tool call, all the same" "$(($(lines) - before_lines))" "4"
docker exec "$A" sh -c 'mv "$HOME/.claude/settings.json.saved" "$HOME/.claude/settings.json"; rm -rf /workspace/.claude /workspace/stub-note.txt "$HOME/.own-hook-ran"'
verdict "the agent's mounts that are not its working copy" "$(docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$A" | tr ' ' '\n' | grep -v -e '^/workspace$' -e '^$' | sort | tr '\n' ' ' | sed 's/ $//')" "$([ "$MODE" = key ] && echo "/agent-transcripts /run/secrets/ANTHROPIC_API_KEY" || echo "/agent-transcripts")"

echo "its conversations:"
verdict "a transcript kept for each of the three sessions" "$(($(find "$TR" -maxdepth 1 -name '*.jsonl' | wc -l | tr -d ' ') - before_tr))" "3"
verdict "it holds the session" "$(grep -lF 'the stub session is over' "$TR"/*.jsonl | wc -l | tr -d ' ' | sed 's/^[1-9][0-9]*$/yes/')" "yes"
verdict "the directory: the service user's alone" "$(stat -c '%U %a' "$TR")" "$C 700"
verdict "in the agent's home, a link to that one mount" "$(docker exec "$A" sh -c 'readlink "$HOME/.claude/projects/-workspace"')" "/agent-transcripts"
verdict "the stand-in login or key, in the log or transcripts" "$(found "$mem/never")" "0"
verdict "the vault's values, in the log or the transcripts" "$(found "$mem/values")" "0"
n=$(find "$TR" -maxdepth 1 -name '*.jsonl' | wc -l | tr -d ' ')
"$C" agent transcripts "$P" --delete > /dev/null 2>&1
verdict "deleting them while the agent runs: refused" "$?, $(find "$TR" -maxdepth 1 -name '*.jsonl' | wc -l | tr -d ' ') of $n kept" "1, $n of $n kept"
verdict "the stand-in login, still in the agent's memory" "$(docker exec "$A" sh -c 'cat "$HOME/.claude/.credentials.json"' | grep -cF -f "$mem/login")" "1"
docker exec "$A" rm -f /workspace/stub-note.txt
echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
