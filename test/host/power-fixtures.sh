#!/bin/sh
# Mains and battery (D59), through doctor, on the test host, as root. The test
# host has no battery, so this lays out stand-ins for the kernel's
# /sys/class/power_supply and points the test host's override at each in turn
# (honoured only in a container, D14), then puts the override back as it was.
#
#   sh power-fixtures.sh <command>
#
# Mains, on battery, low battery and no battery must each give doctor's right
# words and status; and without the override doctor reads the kernel's own,
# which on the test host has no battery. The last line counts what is not as
# it must be.
set -u
C=${1:?usage: power-fixtures.sh <command>}
OVERRIDES=/etc/$C/test-overrides
F=/var/tmp/power-fixtures
total=0
wrong=0
[ -f /.dockerenv ] || { echo "this probe is for the test host only"; exit 2; }

verdict() { # $1 label, $2 what was seen, $3 what it must be
  total=$((total + 1))
  if [ "$2" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-34s %-12s %s\n' "$1" "$2" "$v_ok"
}
supply() { # $1 case, $2 supply, then file=value pairs
  d="$F/$1/$2"; shift 2; mkdir -p "$d"
  for pair in "$@"; do printf '%s\n' "${pair#*=}" > "$d/${pair%%=*}"; done
}
point() { # $1 case, or nothing to take the override away
  sed -i '/^power-supply-dir=/d' "$OVERRIDES"
  [ -n "${1:-}" ] && echo "power-supply-dir=$F/$1" >> "$OVERRIDES"
}
# doctor's line about power, and its status as JSON says it.
line() { "$C" doctor | grep 'Power:' | sed 's/^ *//'; }
status() { "$C" doctor --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).checks.find(c=>c.id==='power').status))"; }

rm -rf "$F"; mkdir -p "$F/none"
supply mains AC type=Mains online=1
supply mains BAT0 type=Battery status=Charging capacity=80 energy_now=30000000 power_now=15000000
supply battery AC type=Mains online=0
supply battery BAT0 type=Battery status=Discharging capacity=60 energy_now=30000000 power_now=18000000
supply low AC type=Mains online=0
supply low BAT0 type=Battery status=Discharging capacity=12 charge_now=500000 current_now=1500000
supply desktop AC type=Mains online=1
chmod -R a+rX "$F"
before=$(grep '^power-supply-dir=' "$OVERRIDES" || true)

for case in mains battery low desktop none; do
  point "$case"
  echo "$case:"
  echo "  | $(line)"
  case "$case" in
    mains) want=ok; words="Power: on mains; the battery is at 80%, charging" ;;
    battery) want=warn; words="Power: ON BATTERY, at 60%, about 1 hour and 40 minutes left" ;;
    low) want=problem; words="Power: ON BATTERY, and it is low: at 12%, about 20 minutes left" ;;
    *) want=info; words="Power: no battery, so a power cut stops the machine at once" ;;
  esac
  verdict "its status" "$(status)" "$want"
  verdict "its words" "$(line | grep -c -F "$words")" "1"
done

echo "without the override, the kernel's own:"
point
echo "  | $(line)"
verdict "no stand-in named" "$(line | grep -c 'declared by the test host')" "0"
verdict "its status" "$(status)" "info"
[ -n "$before" ] && echo "$before" >> "$OVERRIDES"
rm -rf "$F"
echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
