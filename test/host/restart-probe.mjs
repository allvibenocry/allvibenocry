#!/usr/bin/env node
/**
 * The suite after a restart (D80; the eighth brief, item 2), on a fresh test
 * host with the suite installed (`fresh-host.mjs`), from this workstation.
 *
 * Sets the panel up with a password made up for the run (kept in memory,
 * never printed), makes an app and backs it up, so that doctor is all green,
 * then, for each way the machine can stop and start, checks within the stated
 * time (`comeback.mjs`, 120 seconds) that everything came back by itself:
 * doctor all green; the engine, the panel's name, the firewall, the key
 * vault's unit, Docker and both timers active; the proxy, the panel, its door
 * and the app's four containers running and healthy; the panel answering on
 * its name and at the address; and, in a real browser (headless Edge), the
 * panel signed out after the machine stopped (its sessions live in memory,
 * D64), still set up, and the same password signing in, by its name and by the
 * address, with the app on the home screen.
 *
 * The ways, and the orders in which things then start:
 *
 *   restart              a reboot (`host.mjs restart`);
 *   restart-shell        a reboot with a shell entering the test host the
 *                        moment it starts, as the owner's workstation did
 *                        (the eighth brief, item 1);
 *   restart-late-address a reboot where the machine's address comes 25
 *                        seconds after Docker starts (a slow home router);
 *   restart-docker-fails a reboot where Docker's first start fails and systemd
 *                        starts it again;
 *   docker-restart       `systemctl restart docker`;
 *   docker-stop-start    Docker stopped, then started again;
 *   docker-killed        Docker's daemon killed, and systemd starting it again;
 *   hard                 every process killed at once (`restart --hard`), the
 *                        nearest to a power cut the harness has;
 *   hard-late-address    the same, with the address late.
 *
 *   node test/host/restart-probe.mjs [--only <way,way>]
 *
 * Prints a verdict per check ("ok" or "WRONG") and exits 1 if any is WRONG.
 * The fixtures (test/host/harness/) are put in place for one way and taken
 * away after it. The app it made is left, for a look.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { launch, openPage } from "./cdp.mjs";
import { COMEBACK_SECONDS, look, startedAt, waitForSuite } from "./comeback.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = readFileSync(path.join(ROOT, "brand.conf"), "utf8").match(/^COMMAND_NAME="?([^"\n]*)"?/m)[1];
const NAME = `${C}-test-host`;
const APP = "restart8";
const WAYS = ["restart", "restart-shell", "restart-late-address", "restart-docker-fails", "docker-restart", "docker-stop-start", "docker-killed", "hard", "hard-late-address"];
const onlyAt = process.argv.indexOf("--only");
const ways = onlyAt > 0 ? process.argv[onlyAt + 1].split(",") : WAYS;
for (const w of ways) if (!WAYS.includes(w)) throw new Error(`no way called ${w}: ${WAYS.join(", ")}`);

let wrong = 0;
let total = 0;
function verdict(what, got, want) {
  total += 1;
  const ok = typeof want === "function" ? want(got) : got === want;
  if (!ok) wrong += 1;
  console.log(`${ok ? "ok   " : "WRONG"} ${what}: ${typeof got === "string" ? got : JSON.stringify(got)}${ok ? "" : `   (wanted ${typeof want === "function" ? "otherwise" : JSON.stringify(want)})`}`);
  return ok;
}
function harness(...args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "test", "host", "host.mjs"), ...args], { encoding: "utf8", cwd: ROOT, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function harnessAsync(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "test", "host", "host.mjs"), ...args], { cwd: ROOT, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ status: code ?? 1, out }));
  });
}
const onHost = (...args) => harness("exec", "--", ...args);
const sh = (script) => onHost("sh", "-c", script);
const docker = (args) => spawnSync("docker", args, { encoding: "utf8" });

/* ---------------------------------------------------- the fixtures -- */

/** Test-host-only units and drop-ins, from test/host/harness/, in place for one way. */
function fixture(name, on) {
  if (name === "late-address") {
    if (on) {
      harness("push", "test/host/harness/late-address.sh", "/usr/local/lib/test-host/");
      harness("push", "test/host/harness/late-address.service", "/etc/systemd/system/");
      harness("push", "test/host/harness/address-back.service", "/etc/systemd/system/");
      sh("cd /etc/systemd/system && mv late-address.service test-host-late-address.service && mv address-back.service test-host-address-back.service && systemctl daemon-reload && systemctl enable --quiet test-host-late-address.service test-host-address-back.service");
    } else {
      sh("systemctl disable --quiet test-host-late-address.service test-host-address-back.service; rm -f /etc/systemd/system/test-host-late-address.service /etc/systemd/system/test-host-address-back.service /usr/local/lib/test-host/late-address.sh; systemctl daemon-reload");
    }
  } else if (name === "docker-fails") {
    if (on) {
      sh("mkdir -p /etc/systemd/system/docker.service.d");
      harness("push", "test/host/harness/docker-fails-once.conf", "/etc/systemd/system/docker.service.d/");
      sh("mv /etc/systemd/system/docker.service.d/docker-fails-once.conf /etc/systemd/system/docker.service.d/test-host-fails-once.conf && systemctl daemon-reload");
    } else {
      sh("rm -f /etc/systemd/system/docker.service.d/test-host-fails-once.conf; rmdir /etc/systemd/system/docker.service.d 2>/dev/null; systemctl daemon-reload");
    }
  }
}

/** The owner's trigger: an exec made and started through Docker's API the moment Docker says the test host started. */
function shellAtStart() {
  const PIPE = process.platform === "win32" ? "\\\\.\\pipe\\docker_engine" : "/var/run/docker.sock";
  const api = (method, p, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({ socketPath: PIPE, path: p, method, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  const state = { entered: null };
  const filters = encodeURIComponent(JSON.stringify({ container: [NAME], event: ["start"] }));
  const events = http.request({ socketPath: PIPE, path: `/events?filters=${filters}`, method: "GET" }, (res) => {
    res.on("data", async () => {
      if (state.entered) return;
      state.entered = "pending";
      for (let i = 0; i < 200; i += 1) {
        const made = await api("POST", `/containers/${NAME}/exec`, { Cmd: ["sleep", "600"] });
        if (made.status === 201) {
          const started = await api("POST", `/exec/${JSON.parse(made.body).Id}/start`, { Detach: true });
          if (started.status === 200) {
            state.entered = new Date().toISOString();
            return;
          }
        }
      }
    });
  });
  events.on("error", () => {});
  events.end();
  return { state, stop: () => events.destroy() };
}

/* -------------------------------------------------------- the ways -- */

/** Does the way; returns when its clock starts (the machine's start, or the command). */
async function doWay(way) {
  if (way.startsWith("restart")) {
    if (way === "restart-late-address") fixture("late-address", true);
    if (way === "restart-docker-fails") fixture("docker-fails", true);
    const racer = way === "restart-shell" ? shellAtStart() : null;
    // Not spawnSync: the racer answers Docker's start event while the restart runs.
    const r = racer ? await harnessAsync("restart") : harness("restart");
    racer?.stop();
    if (racer) verdict("a shell entered the test host as it started", racer.state.entered ?? "never", (s) => /^\d{4}-/.test(s));
    console.log(`      ${r.out.trim().split("\n").join("\n      ")}`);
    return startedAt(NAME);
  }
  if (way.startsWith("hard")) {
    if (way === "hard-late-address") fixture("late-address", true);
    const r = harness("restart", "--hard");
    console.log(`      ${r.out.trim().split("\n").join("\n      ")}`);
    return startedAt(NAME);
  }
  const at = Date.now();
  if (way === "docker-restart") verdict("systemctl restart docker", sh("systemctl restart docker").status, 0);
  if (way === "docker-stop-start") {
    verdict("systemctl stop docker.socket docker", sh("systemctl stop docker.socket docker").status, 0);
    await sleep(5000);
    verdict("systemctl start docker", sh("systemctl start docker").status, 0);
  }
  if (way === "docker-killed") verdict("Docker's daemon killed", sh("systemctl kill --signal=SIGKILL docker.service").status, 0);
  return at;
}

const panelPort = Number(docker(["inspect", "-f", `{{index .Config.Labels "${C}.test-harness.port-base"}}`, NAME]).stdout.trim()) + 21;
const password = `restart ${randomBytes(12).toString("base64url")}`;
const browser = await launch();

async function signInAt(origin) {
  const page = await openPage(browser.port, { width: 1280, height: 860, scheme: "light" });
  try {
    await page.goto(`${origin}/sign-in`);
    await page.waitFor(`!!document.querySelector("#password") || !!document.querySelector("#main .head")`, { what: "the sign-in page", timeout: 20000 });
    // Still signed in here (a restart of Docker alone keeps the panel, and its sessions): signed out first, so that signing in is what is tried.
    if (await page.eval(`!document.querySelector("#password")`)) {
      await page.click("#sign-out");
      await page.waitFor(`location.pathname === "/sign-in" && !!document.querySelector("#password")`, { what: "the sign-in page, signed out", timeout: 20000 });
    }
    await page.click("#password");
    await page.type(password);
    await page.key("Enter");
    await page.waitFor(`location.pathname === "/" && !!document.querySelector("#main .head")`, { what: "Your apps", timeout: 20000 });
    await page.waitFor(`document.querySelector("#main").innerText.includes(${JSON.stringify(APP)})`, { what: `the app ${APP}`, timeout: 20000 }).catch(() => {});
    return `${flat(await page.text("#main h1"))} ${flat(await page.text("#main"))}`;
  } finally {
    await page.close();
  }
}
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

try {
  /* ------------------------------------------------------ set up -- */
  console.log(`the test host's panel at http://${C}.local:${panelPort}/ (mapped to this workstation) and http://localhost:${panelPort}/`);
  harness("push", "test/host/panel-fixture.mjs", "/root/");
  const code = onHost("node", "/root/panel-fixture.mjs", "setup-code").out.trim();
  if (!/^[A-Z0-9-]{16,19}$/.test(code)) throw new Error("no setup code from the test host");
  const setup = await openPage(browser.port, { width: 1280, height: 860, scheme: "light" });
  await setup.goto(`http://${C}.local:${panelPort}/`);
  await setup.waitFor(`!!document.querySelector("#code")`, { what: "the setup page", timeout: 30000 });
  await setup.click("#code");
  await setup.type(code);
  await setup.click("#password");
  await setup.type(password);
  await setup.click("#again");
  await setup.type(password);
  await setup.click("#setup-form button[type=submit]");
  await setup.waitFor(`location.pathname === "/" && !!document.querySelector(".status-row")`, { what: "Your apps" });
  verdict("the panel set up, with a password", flat(await setup.text("#main h1")), "Your apps");
  onHost(C, "project", "remove", APP, "--delete-everything");
  verdict(`an app, ${APP}`, onHost(C, "project", "create", APP).status, 0);
  verdict(`its first backup, so that doctor is all green`, onHost(C, "backup", APP).status, 0);
  verdict(`and its restore check`, onHost(C, "restore-check", APP).status, 0);
  // The key vault's unit runs at boot (D37): before the first restart it has not run yet.
  const before = await waitForSuite(NAME, panelPort, { since: Date.now(), notYet: [`${C}-keys.service`] });
  verdict("before anything: everything as it should be", before.ok ? before.back.join("; ") : before.notBack.join("; "), () => before.ok);

  for (const way of ways) {
    console.log(`\n== ${way}`);
    // Each way starts from a machine where everything runs: a way that left it
    // broken (on the control) is followed by a plain restart, said as such.
    const start = await look(NAME, panelPort, { notYet: [`${C}-keys.service`] });
    if (!start.ok) {
      console.log(`      before ${way}, not everything runs (${start.notBack.join("; ")}): a plain restart first`);
      fixture("late-address", false);
      fixture("docker-fails", false);
      harness("restart");
    }
    try {
      await oneWay(way);
    } catch (error) {
      verdict(`${way}: the probe could go on`, error instanceof Error ? error.message : String(error), () => false);
    }
  }
} finally {
  for (const f of ["late-address", "docker-fails"]) fixture(f, false);
  await browser.close();
}
console.log(`\n${total - wrong} of ${total} as they should be${wrong ? `; ${wrong} WRONG` : ""}`);
process.exit(wrong ? 1 : 0);

async function oneWay(way) {
  {
    const page = await openPage(browser.port, { width: 1280, height: 860, scheme: "light" });
    await page.goto(`http://${C}.local:${panelPort}/`);
    await page.waitFor(`location.pathname === "/sign-in" || !!document.querySelector("#main .head")`, { what: "the panel", timeout: 20000 });
    if (await page.eval(`location.pathname === "/sign-in"`)) {
      await page.click("#password");
      await page.type(password);
      await page.key("Enter");
      await page.waitFor(`location.pathname === "/" && !!document.querySelector("#main .head")`, { what: "Your apps", timeout: 20000 });
    }
    const panelBefore = docker(["exec", NAME, "docker", "inspect", "-f", "{{.State.StartedAt}}", `${C}-panel`]).stdout.trim();

    // A restart of Docker is not a boot: the key vault's boot unit (D37) runs only at a boot.
    const keysRan = sh(`systemctl is-active ${C}-keys.service`).out.trim() === "active";
    const since = await doWay(way);
    const back = await waitForSuite(NAME, panelPort, { since, notYet: way.startsWith("docker") && !keysRan ? [`${C}-keys.service`] : [] });
    verdict(`${way}: everything back within ${COMEBACK_SECONDS} s`, back.ok ? `in ${back.seconds} s: ${back.back.join("; ")}` : `not in ${back.seconds} s: ${back.notBack.join("; ")}`, () => back.ok);
    if (way.includes("late-address")) fixture("late-address", false);
    if (way.includes("docker-fails")) fixture("docker-fails", false);
    if (!back.ok) {
      console.log(`      the engine said: ${sh(`journalctl -b -u ${C}-engine --no-pager -o cat --since '-4min' | grep -E 'keeper|door|listens' | tail -8`).out.trim().split("\n").join("\n      ")}`);
      await page.close();
      return;
    }

    // Signed out after the machine stopped (sessions live in the panel's memory, D64);
    // a restart of Docker alone leaves the panel's container running (live restore).
    const panelAfter = docker(["exec", NAME, "docker", "inspect", "-f", "{{.State.StartedAt}}", `${C}-panel`]).stdout.trim();
    await page.goto(`http://${C}.local:${panelPort}/`);
    await page.waitFor(`location.pathname === "/sign-in" || !!document.querySelector("#main .head")`, { what: "the panel", timeout: 20000 });
    const signedOut = await page.eval(`location.pathname === "/sign-in"`);
    if (way.startsWith("docker")) {
      verdict(`${way}: the panel's container kept running, and so did the session`, `${panelBefore === panelAfter ? "kept running" : "started again"}, ${signedOut ? "signed out" : "signed in"}`, (s) => s === "kept running, signed in" || s === "started again, signed out");
    } else {
      verdict(`${way}: signed out, since the panel started again`, signedOut ? "signed out" : "still signed in", "signed out");
    }
    verdict(`${way}: still set up (the sign-in page, not the setup page)`, flat(await page.eval(`document.querySelector("h1")?.textContent ?? ""`)), (s) => signedOut ? !/set up/i.test(s) : true);
    await page.close();
    const home = (s) => (s.startsWith("failed:") ? s : `${/Your apps/.test(s) ? "Your apps" : "not Your apps"}, ${s.includes(APP) ? `with ${APP}` : `without ${APP}`}`);
    const byName = home(await signInAt(`http://${C}.local:${panelPort}`).catch((e) => `failed: ${e.message}`));
    verdict(`${way}: the same password signs in, by its name, and the app is there`, byName, `Your apps, with ${APP}`);
    const byAddress = home(await signInAt(`http://localhost:${panelPort}`).catch((e) => `failed: ${e.message}`));
    verdict(`${way}: and at the address`, byAddress, `Your apps, with ${APP}`);
  }
}
