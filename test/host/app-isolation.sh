#!/bin/sh
# The firewall for project containers (D41), probed from inside a project's
# apps and databases, on the host.
#
#   sh app-isolation.sh <command> <project> [<device address> <device port>]
#
# From inside dev's app, prod's app, dev's database and prod's database: this
# machine's own ports (SSH, one other service, the proxy's doors, the apps'
# loopback ports), the router, another device on the home network and a
# link-local address must all be refused or unreachable; the apps must still
# reach the public internet. Then what must keep working: each app reads its own
# database, the machine reaches the apps through the proxy, and a device on the
# home network reaches the proxy's doors. The same targets are tried from the
# machine itself first, where they must answer, so a refusal inside a container
# is the firewall and not an empty address.
#
# The device defaults to the test host's stand-in (lan-fixtures.sh); on a real
# machine, name a real one on the home network. Every line ends with the
# verdict; the last line counts the ones that are not as they must be.
set -u
C=${1:?usage: app-isolation.sh <command> <project> [device address] [device port]}
P=${2:?usage: app-isolation.sh <command> <project> [device address] [device port]}
DEVICE=${3:-10.99.0.2}
DEVICE_PORT=${4:-8080}
OTHER_PORT=${OTHER_PORT:-9999}
lan=$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
router=$(ip -4 route show default | awk '{print $3; exit}')
prod_port=$(sed -n 's/.*listen 0\.0\.0\.0:\([0-9]*\);.*/\1/p' "/var/lib/$C/proxy/conf.d/$P-prod.conf")
dev_port=$(sed -n 's/.*listen 0\.0\.0\.0:\([0-9]*\);.*/\1/p' "/var/lib/$C/proxy/conf.d/$P-dev.conf")
app_port=$((prod_port + 10000))
total=0
wrong=0

# sh has no local variables: the v_ names are this function's alone.
verdict() { # $1 label, $2 what was seen, $3 "blocked" or "reached"
  total=$((total + 1))
  case "$2" in CONNECTED*|HTTP*) v_seen=reached ;; *) v_seen=blocked ;; esac
  if [ "$v_seen" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-52s %-28s %s\n' "$1" "$2" "$v_ok"
}
# A TCP connection or an HTTP request from inside a container: node where there is node, busybox nc where there is not.
tcp() { # container host port
  if docker exec "$1" sh -c 'command -v node' >/dev/null 2>&1; then
    docker exec "$1" node -e "const s=require('net').connect({host:'$2',port:$3,timeout:3000});s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('timeout',()=>{console.log('timed out');s.destroy()});s.on('error',e=>console.log(e.code))"
  else
    # busybox nc: exit 0 once connected, 1 when refused or unreachable (it has no -z).
    if docker exec "$1" sh -c "nc -w 3 $2 $3 </dev/null >/dev/null 2>&1"; then echo CONNECTED; else echo "refused or unreachable"; fi
  fi
}
https() { docker exec "$1" node -e "fetch('$2',{signal:AbortSignal.timeout(8000)}).then(r=>console.log('HTTP',r.status)).catch(e=>console.log(e.cause?.code??e.name))"; }
host_tcp() { node -e "const s=require('net').connect({host:'$1',port:$2,timeout:3000});s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('timeout',()=>{console.log('timed out');s.destroy()});s.on('error',e=>console.log(e.code))"; }

echo "the targets, from the machine itself (each must answer):"
verdict "this machine's SSH, $lan:22" "$(host_tcp "$lan" 22)" reached
verdict "this machine's other service, $lan:$OTHER_PORT" "$(host_tcp "$lan" "$OTHER_PORT")" reached
verdict "a device on the home network, $DEVICE:$DEVICE_PORT" "$(host_tcp "$DEVICE" "$DEVICE_PORT")" reached

for c in "$C-$P-dev-app" "$C-$P-prod-app" "$C-$P-dev-db" "$C-$P-prod-db"; do
  # Each of its networks' gateway, the machine's own address on that network (an internal one has one too).
  gws=$(for n in $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c"); do docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' "$n"; done)
  echo "from inside $c:"
  verdict "this machine's SSH, by its address" "$(tcp "$c" "$lan" 22)" blocked
  verdict "this machine's other service, by its address" "$(tcp "$c" "$lan" "$OTHER_PORT")" blocked
  for gw in $gws; do
    verdict "this machine's SSH, by the gateway $gw" "$(tcp "$c" "$gw" 22)" blocked
    verdict "this machine's other service, by the gateway" "$(tcp "$c" "$gw" "$OTHER_PORT")" blocked
    verdict "prod's door, by the gateway, $prod_port" "$(tcp "$c" "$gw" "$prod_port")" blocked
    verdict "prod's app on loopback, by the gateway, $app_port" "$(tcp "$c" "$gw" "$app_port")" blocked
  done
  verdict "the router, $router:80" "$(tcp "$c" "$router" 80)" blocked
  verdict "the router, $router:53" "$(tcp "$c" "$router" 53)" blocked
  verdict "a device on the home network, $DEVICE:$DEVICE_PORT" "$(tcp "$c" "$DEVICE" "$DEVICE_PORT")" blocked
  verdict "link-local, 169.254.169.254:80" "$(tcp "$c" 169.254.169.254 80)" blocked
  case "$c" in *-app)
    verdict "the public internet, https://example.com" "$(https "$c" https://example.com/)" reached
    verdict "its own database, through its /healthz" "$(docker exec "$c" node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>console.log('HTTP',r.status,(await r.json()).ok?'ok':'NOT ok'))")" reached ;;
  esac
done

echo "what must keep working, from outside the containers:"
verdict "the machine reaches prod through the proxy" "$(curl -s -o /dev/null -w 'HTTP %{http_code}' "http://127.0.0.1:$prod_port/healthz")" reached
verdict "the machine reaches dev through the proxy" "$(curl -s -o /dev/null -w 'HTTP %{http_code}' "http://127.0.0.1:$dev_port/healthz")" reached
if ip netns list 2>/dev/null | grep -q '^lan-device'; then
  for port in "$prod_port" "$dev_port"; do
    verdict "the device on the home network, to the door $port" "$(ip netns exec lan-device node -e "fetch('http://10.99.0.1:$port/healthz',{signal:AbortSignal.timeout(5000)}).then(r=>console.log('HTTP',r.status)).catch(e=>console.log(e.cause?.code??e.name))")" reached
  done
fi

echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
