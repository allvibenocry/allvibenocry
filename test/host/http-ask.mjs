// One HTTP request with a Host header of one's choosing, as a browser that
// typed that name would send it, and optionally a Cookie header; prints the
// status and the start of the body, or why there was no answer. For the
// probes of the panel's door and the apps' doors (D74), on the test host,
// from the machine or from the stand-in device's network namespace.
//
//   node http-ask.mjs <address> <port> <host header> [path] [cookie header]
import http from "node:http";

const [address, port, host, path = "/", cookie] = process.argv.slice(2);
const headers = { Host: host, ...(cookie ? { Cookie: cookie } : {}) };
const request = http.request({ host: address, port: Number(port), path, method: "GET", headers, setHost: false, timeout: 5000 }, (response) => {
  let body = "";
  response.on("data", (c) => (body += c));
  response.on("end", () => console.log(`${response.statusCode} ${body.replace(/\s+/g, " ").slice(0, 200)}`.trim()));
});
request.on("timeout", () => request.destroy(new Error("TIMEOUT")));
request.on("error", (error) => console.log(error.code ?? error.message));
request.end();
