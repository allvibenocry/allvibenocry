#!/bin/sh
# The release gate for tried steps (D56), probed on the host, as root, with the
# project's dev and its agent running.
#
#   sh plan-gate.sh <command> <project>
#
# The agent writes a plan of two steps into plan.json and commits it, from
# inside its container, as its AGENTS.md asks. Then: a release with untried
# steps is refused before anything changes; from inside the agent, the ways it
# might mark a step tried all fail (no command, no marks file, a "tried" field
# in plan.json, a tried.json of its own in the working copy); the person marks
# the steps tried, and the release goes through with the plan in its record;
# the same plan cannot be put live twice; and work outside any plan is refused
# without a reason, and recorded with one. The last line counts what is not as
# it must be.
set -u
C=${1:?usage: plan-gate.sh <command> <project>}
P=${2:?project}
A=$C-$P-agent
REPO=/var/lib/$C/projects/$P/repo
PROJECT_JSON=/var/lib/$C/projects/$P/project.json
total=0
wrong=0

verdict() { # $1 label, $2 what was seen, $3 what it must be
  total=$((total + 1))
  if [ "$2" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-62s %-22s %s\n' "$1" "$2" "$v_ok"
}
releases() { node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_JSON','utf8')).releases.length)"; }
tags() { runuser -u "$C" -- git -C "$REPO" tag | wc -l; }
current() { docker inspect -f '{{.Config.Image}}' "$C-$P-prod-app" | sed 's/.*://'; }
backups() { find "$(node -e "console.log(JSON.parse(require('fs').readFileSync('/etc/$C/config.json','utf8')).backupTarget)")/$C/$P" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
in_agent() { docker exec -i "$A" sh -c "$1"; }
agent_commit() { in_agent "cd /workspace && git add -A && git commit -q -m '$1' && echo made" 2>/dev/null || echo "not made"; }
deploy_dev() { "$C" dev deploy "$P" >/dev/null 2>&1 && echo deployed || echo "not deployed"; }
# A release: its exit code and, when refused, the step it stopped at.
release() { # $@ extra arguments
  out=$("$C" release "$P" "$@" 2>&1); code=$?
  stopped=$(printf '%s\n' "$out" | sed -n 's/^FAIL *[0-9]*\/[0-9]* \(.*\)$/\1/p' | head -1)
  echo "$code|$stopped"
}
note() { printf '  | %s\n' "$1"; }

[ "$(docker inspect -f '{{.State.Running}}' "$A" 2>/dev/null)" = true ] || { echo "the agent of $P is not running: $C agent start $P first"; exit 2; }
stamp=$(date -u +%H%M%S)

echo "the agent writes a plan of two steps, from inside its container:"
in_agent "cat > /workspace/plan.json" <<EOF
{
  "title": "A greeting on the page, $stamp",
  "steps": [
    { "id": 1, "title": "A greeting under the heading", "check": "Open the test copy: a greeting is under the heading.", "built": true },
    { "id": 2, "title": "The greeting says the time", "check": "Reload the test copy: the greeting says the time.", "built": true }
  ]
}
EOF
in_agent "printf 'export const greeting = \"Hello, %s\";\n' '$stamp' > /workspace/greeting.js"
verdict "its commit" "$(agent_commit "A greeting, as the plan asks")" "made"
verdict "dev deployed with it" "$(deploy_dev)" "deployed"

echo "a release with both steps untried:"
before_r=$(releases); before_t=$(tags); before_c=$(current); before_b=$(backups)
r=$(release)
verdict "refused" "${r%%|*}" "1"
verdict "at the step" "${r#*|}" "every step of the plan is tried by you"
verdict "releases recorded, as before" "$(releases)" "$before_r"
verdict "tags, as before" "$(tags)" "$before_t"
verdict "prod's version, as before" "$(current)" "$before_c"
verdict "backups of prod, as before" "$(backups)" "$before_b"

echo "from inside the agent, trying to mark a step tried:"
verdict "the $C command" "$(in_agent "command -v $C >/dev/null && echo present || echo absent")" "absent"
verdict "the marks, /var/lib/$C/projects/$P/tried.json" "$(in_agent "[ -e /var/lib/$C/projects/$P/tried.json ] && echo present || echo absent")" "absent"
in_agent "node -e \"const f='/workspace/plan.json';const p=JSON.parse(require('fs').readFileSync(f,'utf8'));p.steps.forEach(s=>s.tried=true);require('fs').writeFileSync(f,JSON.stringify(p,null,2))\""
in_agent "printf '{\"marks\":[{\"step\":1},{\"step\":2}]}\n' > /workspace/tried.json"
verdict "its commit of \"tried\": true, and a tried.json of its own" "$(agent_commit "Mark both steps tried")" "made"
verdict "dev deployed with it" "$(deploy_dev)" "deployed"
r=$(release)
verdict "a release after that: refused" "${r%%|*}" "1"
verdict "at the step" "${r#*|}" "every step of the plan is tried by you"

echo "the person tries the steps in dev, and marks them:"
"$C" plan "$P" 2>&1 | sed 's/^/  | /'
verdict "plan tried 1" "$("$C" plan tried "$P" 1 >/dev/null 2>&1 && echo marked || echo refused)" "marked"
r=$(release)
verdict "a release with step 2 untried: refused" "${r%%|*}" "1"
verdict "plan tried 2" "$("$C" plan tried "$P" 2 >/dev/null 2>&1 && echo marked || echo refused)" "marked"
r=$(release)
verdict "a release with both tried" "${r%%|*}" "0"
verdict "prod's version moved on" "$([ "$(current)" != "$before_c" ] && echo yes || echo no)" "yes"
verdict "the release's record keeps the plan" "$(node -e "const p=JSON.parse(require('fs').readFileSync('$PROJECT_JSON','utf8'));const r=p.releases.at(-1);console.log(r.plan&&r.plan.steps.length===2&&r.plan.title.includes('$stamp')?'kept':'missing')")" "kept"

echo "the same plan, put live again with a change of the agent's own:"
in_agent "printf 'export const greeting = \"Hello again, %s\";\n' '$stamp' > /workspace/greeting.js"
verdict "its commit" "$(agent_commit "Another greeting, outside the plan")" "made"
verdict "dev deployed with it" "$(deploy_dev)" "deployed"
before_r=$(releases); before_c=$(current); before_b=$(backups)
r=$(release)
verdict "a release: refused (the plan was put live already)" "${r%%|*}" "1"
r=$(release --outside-plan)
verdict "--outside-plan without a reason: refused" "${r%%|*}" "2"
r=$(release --outside-plan "  ")
verdict "--outside-plan with a blank reason: refused" "${r%%|*}" "2"
verdict "releases recorded, as before" "$(releases)" "$before_r"
verdict "prod's version, as before" "$(current)" "$before_c"
verdict "backups of prod, as before" "$(backups)" "$before_b"
r=$(release --outside-plan "a second greeting, tried by hand in dev ($stamp)")
verdict "--outside-plan with a reason" "${r%%|*}" "0"
verdict "the release's record keeps the reason" "$(node -e "const p=JSON.parse(require('fs').readFileSync('$PROJECT_JSON','utf8'));console.log(p.releases.at(-1).outsidePlan||'missing')")" "a second greeting, tried by hand in dev ($stamp)"
verdict "and so does the run's record" "$(grep -lF "a second greeting, tried by hand in dev ($stamp)" /var/lib/"$C"/runs/*.json 2>/dev/null | wc -l | tr -d ' ')" "1"
echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
