#!/bin/sh
# The agent container (D39, rules 1 and 12), probed from inside it, on the host.
#
#   sh agent-isolation.sh <command> <project> <file: prod's key value> <file: dev's key value>
#
# Every probe of prod, the host, the home network and the machine's secrets
# must be refused; its own dev app and dev database, and the model's API
# through the egress gate, must answer. Values are compared by hash and never
# printed: every line is a verdict, an error code, a status or a count.
set -u
C=${1:?usage: agent-isolation.sh <command> <project> <prod value file> <dev value file>}
P=${2:?project}
PROD_VALUE=${3:?prod value file}
DEV_VALUE=${4:?dev value file}
A=$C-$P-agent
GATE=$C-$P-agent-egress
API=api.anthropic.com
prod_db_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$C-$P-prod-db" | awk '{print $1}')
prod_app_ips=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$C-$P-prod-app")
gw=$(docker network inspect "$C-$P-dev-internal" -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
lan=$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
router=$(ip -4 route show default | awk '{print $3; exit}')

in_agent() { docker exec "$A" node -e "$1"; }
tcp() { in_agent "const s=require('net').connect({host:'$1',port:$2,timeout:3000});s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('timeout',()=>{console.log('timed out');s.destroy()});s.on('error',e=>console.log(e.code))"; }
http() { in_agent "fetch('http://$1:$2$3',{signal:AbortSignal.timeout(4000)}).then(async r=>console.log('HTTP',r.status,(await r.text()).slice(0,70))).catch(e=>console.log(e.cause?.code??e.name))"; }
resolve() { in_agent "require('dns').lookup('$1',(e,a)=>console.log(e?e.code:'RESOLVED '+a))"; }
gate() { in_agent "const r=require('http').request({host:'$GATE',port:3128,method:'CONNECT',path:'$1:$2',timeout:5000});r.on('connect',(res,s)=>{console.log('the gate says',res.statusCode);s.destroy()});r.on('timeout',()=>{console.log('timed out');r.destroy()});r.on('error',e=>console.log(e.code));r.end()"; }
absent() { docker exec "$A" sh -c "[ -e '$1' ] && echo PRESENT || echo absent"; }
value_hash() { printf '%s' "$(cat "$1")" | sha256sum | cut -c1-64; }

echo "Claude Code in $A: $(docker exec "$A" claude --version)"
echo "prod, by name and by address:"
printf '  resolve %s-%s-prod-app:           ' "$C" "$P"; resolve "$C-$P-prod-app"
printf '  resolve %s-%s-prod-db:            ' "$C" "$P"; resolve "$C-$P-prod-db"
printf '  prod database by address, 5432:        '; tcp "$prod_db_ip" 5432
for ip in $prod_app_ips; do printf '  prod app by address %-15s 3000: ' "$ip"; tcp "$ip" 3000; done
echo "prod's front door, 8100:"
printf '  by the dev network'"'"'s gateway (%s): ' "$gw"; http "$gw" 8100 /healthz
printf '  by the host'"'"'s own address:             '; http "$lan" 8100 /healthz
printf '  through the egress gate, by the host:  '; gate "$lan" 8100
echo "the host's loopback ports (prod's app at 18100):"
printf '  by the gateway, 18100:                 '; tcp "$gw" 18100
printf '  by the gateway, ssh 22:                '; tcp "$gw" 22
printf '  its own loopback, 18100:               '; tcp 127.0.0.1 18100
echo "the machine's own secrets and disks, inside the agent:"
for f in /var/run/docker.sock /run/docker.sock /etc/$C /etc/$C/backup-host.key /etc/$C/recovery-key-UNCONFIRMED.txt /mnt/$C-backup /var/lib/$C /run/$C; do
  printf '  %-45s %s\n' "$f" "$(absent "$f")"
done
# The whole shape of an age private key: the scanner's binary holds the prefix, as its rule.
echo "  age private keys anywhere it can read:   $(docker exec "$A" sh -c 'grep -rlsE "AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}" / --exclude-dir=proc --exclude-dir=sys 2>/dev/null | wc -l')"
echo "  its secrets:                             $(docker exec "$A" ls /run/secrets | tr '\n' ' ')"
seen=$(docker exec "$A" sh -c 'for f in /run/secrets/*; do sha256sum "$f"; done' | cut -c1-64)
echo "  holds prod's value (prod's vault):       $(echo "$seen" | grep -c "$(value_hash "$PROD_VALUE")")"
echo "  holds dev's value:                       $(echo "$seen" | grep -c "$(value_hash "$DEV_VALUE")")"
echo "the home network and private ranges:"
printf '  the host'"'"'s address (%s), ssh 22:  ' "$lan"; tcp "$lan" 22
printf '  the router (%s), 80:            ' "$router"; tcp "$router" 80
printf '  through the gate, the host, 443:       '; gate "$lan" 443
printf '  through the gate, the router, 443:     '; gate "$router" 443
echo "the internet:"
printf '  %s directly, by name:       ' "$API"; resolve "$API"
printf '  another host through the gate:         '; gate example.com 443
printf '  %s through the gate:        ' "$API"
in_agent "const r=require('http').request({host:'$GATE',port:3128,method:'CONNECT',path:'$API:443',timeout:8000});
r.on('connect',(res,sock)=>{ if(res.statusCode!==200){console.log('the gate says',res.statusCode);return sock.destroy()}
  const t=require('tls').connect({socket:sock,servername:'$API'},()=>t.write('GET / HTTP/1.1\r\nHost: $API\r\nConnection: close\r\n\r\n'));
  let b='';t.on('data',d=>b+=d);t.on('end',()=>console.log('the gate says 200; over TLS the API answers', b.split('\r\n')[0]));t.on('error',e=>console.log('TLS',e.code))});
r.on('error',e=>console.log(e.code));r.end()"
echo "its own dev:"
printf '  dev app, %s-%s-dev-app:3000:     ' "$C" "$P"; http "$C-$P-dev-app" 3000 /healthz
printf '  dev database, %s-%s-dev-db:5432:  ' "$C" "$P"; tcp "$C-$P-dev-db" 5432
echo "what docker inspect says of it:"
docker inspect -f '  user {{.Config.User}}; privileged {{.HostConfig.Privileged}}; read-only root {{.HostConfig.ReadonlyRootfs}}; capabilities dropped {{.HostConfig.CapDrop}}; memory {{.HostConfig.Memory}}; pids {{.HostConfig.PidsLimit}}' "$A"
echo "  networks: $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$A")"
echo "  mounts:   $(docker inspect -f '{{range .Mounts}}{{.Source}}->{{.Destination}}({{if .RW}}rw{{else}}ro{{end}}) {{end}}' "$A")"
echo "  the agent's key value in docker inspect: $(docker inspect "$A" | grep -c -F -f /root/value-agent || true)"
echo "its commits go through the key check (D38), made inside it with git:"
KEY=$(mktemp)   # a fake key, made at random in an Anthropic key's shape, assembled so this file never has it
printf '%s-%s-%s%s' sk-ant api03 "$(head -c 300 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 93)" AA > "$KEY"
chmod 644 "$KEY"
printf 'export const aiKey = "%s";\n' "$(cat "$KEY")" | docker exec -i "$A" sh -c 'cat > /workspace/agent-config.js'
docker exec "$A" git -C /workspace add agent-config.js
docker exec "$A" git -C /workspace commit -q -m "Add the AI key" 2>&1 | sed 's/^/  | /'
echo "  exit: the commit was $(docker exec "$A" git -C /workspace log -1 --format=%s | grep -q 'Add the AI key' && echo MADE || echo stopped)"
docker exec "$A" git -C /workspace reset -q
docker exec "$A" rm -f /workspace/agent-config.js
docker exec "$A" git -C /workspace prune --expire=now
echo "  the fake key in any commit or object:    $(runuser -u "$C" -- git -C "/var/lib/$C/projects/$P/repo" cat-file --batch-all-objects --batch | grep -a -c -F -f "$KEY" || true)"
rm -f "$KEY"
printf 'export const greeting = "Hello from the agent";\n' | docker exec -i "$A" sh -c 'cat > /workspace/agent-config.js'
docker exec "$A" git -C /workspace add agent-config.js
docker exec "$A" git -C /workspace commit -q -m "A greeting, from the agent" && echo "  a clean commit: made, by $(docker exec "$A" git -C /workspace log -1 --format='%an')"
echo "the egress gate's log:"
docker logs "$GATE" 2>&1 | sed 's/^[^ ]* /  /'
