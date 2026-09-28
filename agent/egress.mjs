// The agent's only way out (D39): an HTTPS tunnel to its model's API, and to
// nothing else. The agent's container has no route anywhere but its dev
// network; this runs beside it, on that network and on one that reaches the
// internet, and passes on a connection only when:
//
//   - it is a CONNECT, so what passes is TLS between the agent and the API,
//     which this cannot read;
//   - to port 443 of a host on the allow list (ALLOW, comma-separated);
//   - and that host resolves to public addresses only, so a name can never
//     lead to prod, the host, the home network or any private range.
//
// Everything else gets 403 and a line in the log. Only host names are logged.
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";

const PORT = 3128;
const ALLOW = new Set((process.env.ALLOW ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));

/** Private, loopback, link-local, shared, reserved or multicast: anything that is not the public internet. */
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  return true; // the agent's networks have no IPv6, and nothing here needs it
}

const log = (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);

const server = http.createServer((request, response) => {
  log(`refused ${request.method} ${String(request.url).slice(0, 80)}: only HTTPS tunnels to the model's API`);
  response.writeHead(403, { "Content-Type": "text/plain" });
  response.end("Refused: the agent reaches only its model's API, over HTTPS.\n");
});

server.on("connect", async (request, client, head) => {
  const target = String(request.url);
  const [, host = "", port = ""] = target.match(/^(.*):(\d+)$/) ?? [];
  const refuse = (why) => {
    log(`refused CONNECT ${target.slice(0, 80)}: ${why}`);
    client.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nRefused: ${why}\n`);
  };
  client.on("error", () => {});
  if (port !== "443") return refuse("only port 443");
  if (!ALLOW.has(host.toLowerCase())) return refuse(`${host} is not the model's API`);
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, family: 4 });
  } catch {
    return refuse(`${host} does not resolve`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivate(a.address))) return refuse(`${host} resolves to a private address`);
  const upstream = net.connect(443, addresses[0].address, () => {
    log(`allowed CONNECT ${host}:443`);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", (error) => {
    log(`failed CONNECT ${host}:443: ${error.code}`);
    client.destroy();
  });
  client.on("close", () => upstream.destroy());
});

server.listen(PORT, "0.0.0.0", () => log(`the agent's way out: ${[...ALLOW].join(", ")}, port 443, nothing else`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => process.exit(0));
