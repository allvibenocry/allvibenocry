#!/bin/sh
# Rule 1 (D18), probed from inside a project's dev app container, on the host.
#
#   sh rule1-isolation.sh <command> <project>     e.g. sh rule1-isolation.sh allvibe guestbook
#
# Every probe of prod must fail; dev's own front door must answer. Secrets are
# compared by hash and never printed.
set -u
C=${1:?usage: rule1-isolation.sh <command> <project>}
P=${2:?usage: rule1-isolation.sh <command> <project>}
DEVAPP=$C-$P-dev-app
prod_db_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $C-$P-prod-db | awk '{print $1}')
prod_app_ips=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $C-$P-prod-app)
gw=$(docker network inspect $C-$P-dev-edge -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
lan=$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')

probe() { # a TCP connection from inside dev's app, 3 s timeout
  docker exec "$DEVAPP" node -e "
    const s = require('net').connect({host: '$1', port: $2, timeout: 3000});
    s.on('connect', () => { console.log('CONNECTED'); s.destroy(); });
    s.on('timeout', () => { console.log('timed out'); s.destroy(); });
    s.on('error', (e) => console.log(e.code));"
}
http() { # an HTTP request from inside dev's app
  docker exec "$DEVAPP" node -e "
    fetch('http://$1:$2/healthz', {signal: AbortSignal.timeout(4000)})
      .then(r => console.log('HTTP', r.status)).catch(e => console.log(e.cause?.code ?? e.name));"
}

echo "from $DEVAPP:"
printf '  resolve %s-%s-prod-db by name:       ' "$C" "$P"; docker exec "$DEVAPP" node -e "require('dns').lookup('$C-$P-prod-db', (e, a) => console.log(e ? e.code : 'RESOLVED ' + a))"
printf '  resolve %s-%s-prod-app by name:      ' "$C" "$P"; docker exec "$DEVAPP" node -e "require('dns').lookup('$C-$P-prod-app', (e, a) => console.log(e ? e.code : 'RESOLVED ' + a))"
printf '  prod database by address, port 5432:      '; probe "$prod_db_ip" 5432
for ip in $prod_app_ips; do printf '  prod app by address %-15s port 3000: ' "$ip"; probe "$ip" 3000; done
printf '  prod app via the host (%s) port 18100: ' "$gw"; probe "$gw" 18100
printf '  prod front door via the host, port 8100:  '; http "$gw" 8100
printf '  prod front door via the LAN address:      '; http "$lan" 8100
printf '  dev front door (its own), port 8101:      '; http "$gw" 8101

echo "secrets and volumes (compared, never printed):"
d=$(docker exec "$DEVAPP" sha256sum /run/secrets/db_password | cut -c1-64)
p=$(docker exec $C-$P-prod-app sha256sum /run/secrets/db_password | cut -c1-64)
[ "$d" != "$p" ] && echo "  dev's database password differs from prod's" || echo "  SAME PASSWORD"
echo "  volumes mounted in dev's containers: $(docker inspect -f '{{range .Mounts}}{{.Name}}{{.Source}} {{end}}' $C-$P-dev-app $C-$P-dev-db | tr '\n' ' ')"
echo "  networks of dev's app:  $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $DEVAPP)"
echo "  networks of prod's app: $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $C-$P-prod-app)"
