#!/bin/sh
# The agent container and its egress gate (D39, D41, rules 1 and 12), probed
# from inside them, on the host.
#
#   sh agent-isolation.sh <command> <project> <file: prod's key value> <file: dev's key value> [<file: the agent's key value>] [<device address> <device port>]
#
# From inside the agent: prod refused by name and by address; this machine's own
# ports (SSH, one other service, the proxy's doors, the apps' loopback ports),
# the router, another device on the home network and a link-local address
# refused or unreachable; the Docker socket, both backup keys, the backup target
# and prod's keys absent; the internet only through the gate, and only to the
# model's API. From inside the gate: the same machine's ports, router, device
# and link-local address refused, and the model's API reached. What must keep
# working: the agent reaches its dev app, its dev database and the gate. Values
# are compared by hash and never printed. Every line ends with the verdict; the
# last line counts the ones that are not as they must be.
set -u
C=${1:?usage: agent-isolation.sh <command> <project> <prod value file> <dev value file> [agent value file] [device address] [device port]}
P=${2:?project}
PROD_VALUE=${3:?prod value file}
DEV_VALUE=${4:?dev value file}
AGENT_VALUE=${5:-}
DEVICE=${6:-10.99.0.2}
DEVICE_PORT=${7:-8080}
OTHER_PORT=${OTHER_PORT:-9999}
A=$C-$P-agent
G=$C-$P-agent-egress
API=api.anthropic.com
prod_db_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$C-$P-prod-db" | awk '{print $1}')
prod_app_ips=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$C-$P-prod-app")
lan=$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
router=$(ip -4 route show default | awk '{print $3; exit}')
prod_port=$(sed -n 's/.*listen 0\.0\.0\.0:\([0-9]*\);.*/\1/p' "/var/lib/$C/proxy/conf.d/$P-prod.conf")
app_port=$((prod_port + 10000))
total=0
wrong=0

# sh has no local variables: the v_ names are this function's alone.
verdict() { # $1 label, $2 what was seen, $3 "blocked" or "reached"
  total=$((total + 1))
  case "$2" in CONNECTED*|HTTP*|RESOLVED*|"the gate says 200"*|present|made*|[1-9]*) v_seen=reached ;; *) v_seen=blocked ;; esac
  if [ "$v_seen" = "$3" ]; then v_ok="as it must be"; else v_ok="WRONG"; wrong=$((wrong + 1)); fi
  printf '  %-52s %-34s %s\n' "$1" "$2" "$v_ok"
}
in_c() { docker exec "$1" node -e "$2"; }
tcp() { in_c "$1" "const s=require('net').connect({host:'$2',port:$3,timeout:3000});s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('timeout',()=>{console.log('timed out');s.destroy()});s.on('error',e=>console.log(e.code))"; }
http() { in_c "$1" "fetch('http://$2:$3$4',{signal:AbortSignal.timeout(4000)}).then(r=>console.log('HTTP',r.status)).catch(e=>console.log(e.cause?.code??e.name))"; }
resolve() { in_c "$1" "require('dns').lookup('$2',(e,a)=>console.log(e?e.code:'RESOLVED'))"; }
gate() { in_c "$A" "const r=require('http').request({host:'$G',port:3128,method:'CONNECT',path:'$1:$2',timeout:5000});r.on('connect',(res,s)=>{console.log('the gate says',res.statusCode);s.destroy()});r.on('timeout',()=>{console.log('timed out');r.destroy()});r.on('error',e=>console.log(e.code));r.end()"; }
file() { docker exec "$A" sh -c "[ -e '$1' ] && echo present || echo absent"; }
# Each of its networks' gateway, the machine's own address on that network (an internal one has one too).
gateways() { for n in $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$1"); do docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' "$n"; done; }
value_hash() { printf '%s' "$(cat "$1")" | sha256sum | cut -c1-64; }
api_over_tls() { in_c "$1" "const t=require('tls').connect({host:'$API',port:443,servername:'$API',timeout:8000},()=>t.write('GET / HTTP/1.1\r\nHost: $API\r\nConnection: close\r\n\r\n'));let b='';t.on('data',d=>b+=d);t.on('end',()=>console.log(b.split('\r\n')[0]));t.on('timeout',()=>{console.log('timed out');t.destroy()});t.on('error',e=>console.log(e.code))"; }

echo "Claude Code in $A: $(docker exec "$A" claude --version)"

echo "from inside the agent, $A:"
verdict "resolve $C-$P-prod-app" "$(resolve "$A" "$C-$P-prod-app")" blocked
verdict "resolve $C-$P-prod-db" "$(resolve "$A" "$C-$P-prod-db")" blocked
verdict "prod's database by address, 5432" "$(tcp "$A" "$prod_db_ip" 5432)" blocked
for ip in $prod_app_ips; do verdict "prod's app by address $ip, 3000" "$(tcp "$A" "$ip" 3000)" blocked; done
verdict "this machine's SSH, by its address" "$(tcp "$A" "$lan" 22)" blocked
verdict "this machine's other service, by its address" "$(tcp "$A" "$lan" "$OTHER_PORT")" blocked
for gw in $(gateways "$A"); do
  verdict "this machine's SSH, by the gateway $gw" "$(tcp "$A" "$gw" 22)" blocked
  verdict "this machine's other service, by the gateway" "$(tcp "$A" "$gw" "$OTHER_PORT")" blocked
  verdict "prod's door, by the gateway, $prod_port" "$(http "$A" "$gw" "$prod_port" /healthz)" blocked
  verdict "prod's app on loopback, by the gateway, $app_port" "$(tcp "$A" "$gw" "$app_port")" blocked
done
verdict "the router, $router:80" "$(tcp "$A" "$router" 80)" blocked
verdict "a device on the home network, $DEVICE:$DEVICE_PORT" "$(tcp "$A" "$DEVICE" "$DEVICE_PORT")" blocked
verdict "link-local, 169.254.169.254:80" "$(tcp "$A" 169.254.169.254 80)" blocked
verdict "through the gate: this machine, $prod_port" "$(gate "$lan" "$prod_port")" blocked
verdict "through the gate: this machine, 443" "$(gate "$lan" 443)" blocked
verdict "through the gate: the router, 443" "$(gate "$router" 443)" blocked
verdict "through the gate: the device, 443" "$(gate "$DEVICE" 443)" blocked
verdict "$API directly, by name" "$(resolve "$A" "$API")" blocked
verdict "another internet host, through the gate" "$(gate example.com 443)" blocked
verdict "$API, through the gate" "$(gate "$API" 443)" reached
for f in /var/run/docker.sock /run/docker.sock "/etc/$C" "/etc/$C/backup-host.key" "/etc/$C/recovery-key-UNCONFIRMED.txt" "/mnt/$C-backup" "/var/lib/$C" "/run/$C"; do
  verdict "$f" "$(file "$f")" blocked
done
# The whole shape of an age private key: the scanner's binary holds the prefix, as its rule.
verdict "files holding an age private key" "$(docker exec "$A" sh -c 'grep -rlsE "AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}" / --exclude-dir=proc --exclude-dir=sys 2>/dev/null | wc -l')" blocked
hashes=$(docker exec "$A" sh -c 'for f in /run/secrets/*; do sha256sum "$f"; done' | cut -c1-64)
verdict "a secret holding prod's value" "$(echo "$hashes" | grep -c "$(value_hash "$PROD_VALUE")")" blocked
verdict "a secret holding dev's value" "$(echo "$hashes" | grep -c "$(value_hash "$DEV_VALUE")")" blocked
if [ -n "$AGENT_VALUE" ]; then
  verdict "its own key, in its secrets" "$(echo "$hashes" | grep -c "$(value_hash "$AGENT_VALUE")")" reached
  verdict "its key's value in docker inspect" "$(docker inspect "$A" | grep -c -F -f "$AGENT_VALUE" || true)" blocked
fi
verdict "its dev app, $C-$P-dev-app:3000" "$(http "$A" "$C-$P-dev-app" 3000 /healthz)" reached
verdict "its dev database, $C-$P-dev-db:5432" "$(tcp "$A" "$C-$P-dev-db" 5432)" reached
verdict "the gate, $G:3128" "$(tcp "$A" "$G" 3128)" reached

echo "from inside the egress gate, $G:"
verdict "this machine's SSH, by its address" "$(tcp "$G" "$lan" 22)" blocked
verdict "this machine's other service, by its address" "$(tcp "$G" "$lan" "$OTHER_PORT")" blocked
for gw in $(gateways "$G"); do
  verdict "this machine's SSH, by the gateway $gw" "$(tcp "$G" "$gw" 22)" blocked
  verdict "prod's door, by the gateway, $prod_port" "$(tcp "$G" "$gw" "$prod_port")" blocked
done
verdict "the router, $router:80" "$(tcp "$G" "$router" 80)" blocked
verdict "a device on the home network, $DEVICE:$DEVICE_PORT" "$(tcp "$G" "$DEVICE" "$DEVICE_PORT")" blocked
verdict "link-local, 169.254.169.254:80" "$(tcp "$G" 169.254.169.254 80)" blocked
verdict "$API, its one way out, over TLS" "$(api_over_tls "$G")" reached

echo "what docker inspect says of the agent:"
docker inspect -f '  user {{.Config.User}}; privileged {{.HostConfig.Privileged}}; read-only root {{.HostConfig.ReadonlyRootfs}}; capabilities dropped {{.HostConfig.CapDrop}}; memory {{.HostConfig.Memory}}; pids {{.HostConfig.PidsLimit}}' "$A"
echo "  networks: $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$A")"
echo "  mounts:   $(docker inspect -f '{{range .Mounts}}{{.Source}}->{{.Destination}}({{if .RW}}rw{{else}}ro{{end}}) {{end}}' "$A")"

echo "its commits go through the key check (D38), made inside it with git:"
KEY=$(mktemp)   # a fake key, made at random in an Anthropic key's shape, assembled so this file never has it
printf '%s-%s-%s%s' sk-ant api03 "$(head -c 300 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 93)" AA > "$KEY"
chmod 644 "$KEY"
printf 'export const aiKey = "%s";\n' "$(cat "$KEY")" | docker exec -i "$A" sh -c 'cat > /workspace/agent-config.js'
docker exec "$A" git -C /workspace add agent-config.js
docker exec "$A" git -C /workspace commit -q -m "Add the AI key" 2>&1 | sed 's/^/  | /'
verdict "a commit with a fake key" "$(docker exec "$A" git -C /workspace log -1 --format=%s | grep -q 'Add the AI key' && echo made || echo stopped)" blocked
docker exec "$A" git -C /workspace reset -q
docker exec "$A" rm -f /workspace/agent-config.js
docker exec "$A" git -C /workspace prune --expire=now
verdict "the fake key in any commit or object" "$(runuser -u "$C" -- git -C "/var/lib/$C/projects/$P/repo" cat-file --batch-all-objects --batch | grep -a -c -F -f "$KEY" || true)" blocked
rm -f "$KEY"
printf 'export const greeting = "Hello from the agent, %s";\n' "$(date -u +%FT%TZ)" | docker exec -i "$A" sh -c 'cat > /workspace/agent-config.js'
docker exec "$A" git -C /workspace add agent-config.js
verdict "a clean commit" "$(docker exec "$A" git -C /workspace commit -q -m "A greeting, from the agent" && echo "made, by $(docker exec "$A" git -C /workspace log -1 --format='%an')")" reached

echo "the egress gate's log:"
docker logs "$G" 2>&1 | sed 's/^[^ ]* /  /'
echo "$((total - wrong)) of $total as they must be"
[ "$wrong" -eq 0 ]
