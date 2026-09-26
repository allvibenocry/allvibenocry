// A guestbook: one page, one form, one table. The starting point of a project
// (D19). Plain Node.js and one dependency, the Postgres driver, so there is as
// little as possible to understand before changing it.
//
// Routes:
//   GET  /         the guestbook
//   POST /entries  write an entry, then back to /
//   GET  /healthz  {"ok":true,"entries":N,...}: the smoke check the suite runs
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const ENVIRONMENT = process.env.APP_ENV ?? "dev";
const VERSION = process.env.APP_VERSION ?? "dev";

// ---------------------------------------------------------------- settings
// The database password arrives as a file, never as a variable or an
// argument, so it does not show up in `docker inspect` or in a log. Without
// it the app refuses to start rather than half-working.
function setting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Refusing to start: ${name} is not set.`);
    process.exit(1);
  }
  return value;
}
const passwordFile = setting("DATABASE_PASSWORD_FILE");
let password;
try {
  password = readFileSync(passwordFile, "utf8").trim();
} catch {
  console.error(`Refusing to start: cannot read the database password file ${passwordFile}.`);
  process.exit(1);
}

const pool = new pg.Pool({
  host: setting("DATABASE_HOST"),
  user: setting("DATABASE_USER"),
  database: setting("DATABASE_NAME"),
  password,
  max: 5,
});

// -------------------------------------------------------------- migrations
// Every file in migrations/, in name order, applied once and recorded. A
// migration that has run is never edited: add a new one.
async function migrate() {
  await pool.query(
    "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await pool.query("select version from schema_migrations")).rows.map((r) => r.version));
  const files = readdirSync(path.join(HERE, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(path.join(HERE, "migrations", file), "utf8"));
      await client.query("insert into schema_migrations (version) values ($1)", [file]);
      await client.query("commit");
      console.log(`migration applied: ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

// ------------------------------------------------------------------- pages
const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page(entries) {
  const list = entries.length
    ? entries
        .map(
          (e) =>
            `<li><strong>${escape(e.name)}</strong> <time>${escape(e.created_at.toISOString().slice(0, 16).replace("T", " "))}</time><p>${escape(e.message)}</p></li>`,
        )
        .join("\n")
    : "<li class=\"empty\">No entries yet. Be the first.</li>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guestbook (${escape(ENVIRONMENT)})</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  .env { display: inline-block; padding: 0.1rem 0.6rem; border-radius: 1rem; font-size: 0.9rem; font-weight: 600;
         background: ${ENVIRONMENT === "prod" ? "#1b7a3d" : "#b35c00"}; color: white; vertical-align: middle; }
  form { display: grid; gap: 0.5rem; margin: 1.5rem 0; }
  input, textarea, button { font: inherit; padding: 0.5rem; }
  ul { list-style: none; padding: 0; }
  li { border-top: 1px solid #ddd; padding: 0.75rem 0; }
  li p { margin: 0.25rem 0 0; white-space: pre-wrap; }
  time { color: #666; font-size: 0.85rem; margin-left: 0.5rem; }
  footer { color: #666; font-size: 0.85rem; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Guestbook <span class="env">${escape(ENVIRONMENT)}</span></h1>
<form method="post" action="/entries">
  <input name="name" placeholder="Your name" maxlength="80" required>
  <textarea name="message" placeholder="Say something" maxlength="1000" rows="3" required></textarea>
  <button type="submit">Sign the guestbook</button>
</form>
<ul>
${list}
</ul>
<footer>${entries.length} ${entries.length === 1 ? "entry" : "entries"} · version ${escape(VERSION)}</footer>
</body>
</html>`;
}

function readBody(request, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error("too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

// ------------------------------------------------------------------ server
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");

    if (request.method === "GET" && url.pathname === "/healthz") {
      const { rows } = await pool.query("select count(*)::int as entries from entries");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, entries: rows[0].entries, environment: ENVIRONMENT, version: VERSION }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      const { rows } = await pool.query("select name, message, created_at from entries order by created_at desc limit 200");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page(rows));
      return;
    }

    if (request.method === "POST" && url.pathname === "/entries") {
      const form = new URLSearchParams(await readBody(request));
      const name = (form.get("name") ?? "").trim().slice(0, 80);
      const message = (form.get("message") ?? "").trim().slice(0, 1000);
      if (name && message) await pool.query("insert into entries (name, message) values ($1, $2)", [name, message]);
      response.writeHead(303, { Location: "/" });
      response.end();
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found\n");
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("Something went wrong\n");
  }
});

await migrate();
server.listen(PORT, "0.0.0.0", () => console.log(`guestbook (${ENVIRONMENT}, ${VERSION}) listening on ${PORT}`));

// Stop cleanly when Docker asks.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => pool.end().then(() => process.exit(0))));
}
