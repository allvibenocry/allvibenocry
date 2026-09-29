// The panel and the apps on different host names (D74): the panel's door on
// port 80, the apps' doors without the panel's cookie and never on its name,
// and the Preview frame sandboxed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NAMES } from "../../dist/lib/brand.js";
import { KNOWN_OVERRIDES } from "../../dist/lib/overrides.js";
import { doorRunArgs, PANEL_PORT, panelDoorConf, panelUrls } from "../../dist/lib/panel.js";
import { serverConf } from "../../dist/lib/project.js";
import { APP_COOKIE, cookieMaps, nginxMainConf } from "../../dist/lib/proxy.js";

const project = { name: "guestbook", ports: { prod: 8100, dev: 8101, prodApp: 18100, devApp: 18101 } };

/**
 * The maps, run as nginx would: each map's regular expression (PCRE, in this
 * subset the same as JavaScript's), in turn, on the browser's Cookie header.
 */
function passedOn(header) {
  const maps = [...cookieMaps().matchAll(/"~(.+?)" "(.*?)";/g)].map(([, re, to]) => [new RegExp(re), to]);
  assert.equal(maps.length, 3, "two passes and a last check");
  let value = header;
  for (const [re, to] of maps) {
    const m = re.exec(value);
    if (m) value = to.replace(/\$(pc\d[ab])/g, (_, n) => m.groups?.[n] ?? "");
  }
  return value;
}

test("the panel's cookie is taken out of what an app receives, wherever it is, and nothing else is", () => {
  const c = NAMES.panelCookie;
  assert.equal(passedOn(`${c}=abc`), "");
  assert.equal(passedOn(`own=1; ${c}=abc; theme=dark`), "own=1; theme=dark");
  assert.equal(passedOn(`${c}=abc; own=1`), "own=1");
  assert.match(passedOn(`own=1; ${c}=abc`), /^own=1;? ?$/);
  assert.match(passedOn(`${c}=a; own=1; ${c}=b`), /^own=1;? ?$/, "twice: both taken out");
  assert.equal(passedOn(`${c}=a; ${c}=b; ${c}=c; own=1`), "", "three times: the whole header dropped");
  assert.equal(passedOn("own=1; theme=dark"), "own=1; theme=dark", "an app's own cookies pass as they are");
  assert.equal(passedOn(`x${c}=1; own=2`), `x${c}=1; own=2`, "a cookie whose name only ends the same is the app's");
});

test("the proxy's main configuration holds the maps; every app's door passes the Cookie header through them and refuses the panel's name", () => {
  assert.ok(nginxMainConf().includes(cookieMaps()));
  for (const env of ["prod", "dev"]) {
    const conf = serverConf(project, env, []);
    assert.ok(conf.includes(`proxy_set_header Cookie ${APP_COOKIE};`), env);
    assert.ok(conf.includes(`if ($host = "${NAMES.panelName}") { return 421; }`), env);
  }
});

test("the panel's door: port 80 of the machine's address, published by Docker, from the proxy's image, fenced", () => {
  assert.equal(PANEL_PORT, 80);
  const args = doorRunArgs("192.0.2.10", "/var/lib/x/nginx.conf");
  assert.equal(args[args.indexOf("-p") + 1], "192.0.2.10:80:8080");
  for (const flag of ["--read-only", "--cap-drop"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--cap-drop") + 1], "ALL");
  assert.ok(args.includes("no-new-privileges:true"));
  const all = args.join(" ");
  for (const never of ["--privileged", "--network host", "--network=host", "docker.sock", "--cap-add", "--user 0", "--user=0"]) assert.ok(!all.includes(never), never);
  const conf = panelDoorConf("192.0.2.10", "198.51.100.2");
  assert.match(conf, /listen 8080;/);
  for (const name of [NAMES.panelName, "192.0.2.10", "localhost", "127.0.0.1"]) assert.ok(conf.includes(`if ($host = "${name}") { set $panel_host 1; }`), name);
  assert.match(conf, /if \(\$panel_host = 0\) \{ return 421; \}/);
  assert.match(conf, /deny all;/);
  assert.match(conf, /proxy_pass http:\/\/198\.51\.100\.2:8080;/);
  assert.deepEqual(panelUrls("192.0.2.10"), [`http://${NAMES.panelName}/`, "http://192.0.2.10/"]);
});

test("the test host may declare where the browser reaches the apps; nothing else may", () => {
  assert.ok(KNOWN_OVERRIDES.includes("apps-host"));
});

test("the Preview frame is sandboxed without top navigation or windows, and the page listens to no message from it", () => {
  const shell = readFileSync(new URL("../../panel/static/assets/shell.js", import.meta.url), "utf8");
  const sandbox = /setAttribute\("sandbox", "([^"]*)"\)/.exec(shell)?.[1];
  assert.equal(sandbox, "allow-scripts allow-same-origin allow-forms");
  assert.doesNotMatch(shell, /addEventListener\(\s*["']message["']/);
  // The window's own message handler, which a frame's postMessage reaches; the terminal's WebSocket has one of its own.
  assert.doesNotMatch(shell, /window\.onmessage|(?<![.\w])onmessage\s*=/);
});
