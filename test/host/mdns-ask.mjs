// Asks the home network, by multicast DNS, for a .local name's IPv4 address,
// as a phone or a laptop does, with nothing but a socket: no Avahi, no
// resolver of the machine's. For the test host's stand-in device (run inside
// its network namespace), to see that the panel's name reaches another
// device (D74). Prints each address answered, or "no answer", and exits 1
// without one.
//
//   node mdns-ask.mjs allvibe.local
import dgram from "node:dgram";

const name = process.argv[2];
if (!name || !name.endsWith(".local")) {
  process.stderr.write("usage: node mdns-ask.mjs <name>.local\n");
  process.exit(2);
}

function query(qname) {
  const labels = qname.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, "ascii")]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // one question
  return Buffer.concat([header, ...labels, Buffer.from([0]), Buffer.from([0, 1, 0, 1])]); // A, IN
}

/** A name at an offset, following compression pointers; and where it ends. */
function readName(msg, at) {
  const parts = [];
  let end = null;
  for (let hops = 0; hops < 20; hops += 1) {
    const len = msg[at];
    if (len === 0) return { name: parts.join("."), end: end ?? at + 1 };
    if ((len & 0xc0) === 0xc0) {
      end ??= at + 2;
      at = ((len & 0x3f) << 8) | msg[at + 1];
      continue;
    }
    parts.push(msg.toString("ascii", at + 1, at + 1 + len));
    at += 1 + len;
  }
  return { name: parts.join("."), end: end ?? at };
}

function answers(msg) {
  const found = [];
  const questions = msg.readUInt16BE(4);
  const records = msg.readUInt16BE(6) + msg.readUInt16BE(8) + msg.readUInt16BE(10);
  let at = 12;
  for (let i = 0; i < questions; i += 1) at = readName(msg, at).end + 4;
  for (let i = 0; i < records && at < msg.length; i += 1) {
    const { name: rname, end } = readName(msg, at);
    const type = msg.readUInt16BE(end);
    const length = msg.readUInt16BE(end + 8);
    const data = end + 10;
    if (type === 1 && length === 4 && rname.toLowerCase() === name.toLowerCase()) found.push([...msg.subarray(data, data + 4)].join("."));
    at = data + length;
  }
  return found;
}

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
const seen = new Set();
socket.on("message", (msg) => {
  try {
    for (const address of answers(msg)) seen.add(address);
  } catch {
    /* not a reply we can read */
  }
});
socket.bind(0, () => {
  socket.send(query(name), 5353, "224.0.0.251");
  setTimeout(() => {
    socket.close();
    if (seen.size) console.log([...seen].join(" "));
    else console.log("no answer");
    process.exitCode = seen.size ? 0 : 1;
  }, 3000);
});
