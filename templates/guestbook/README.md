# Guestbook

A small web app to build on: one page, one form, one database table.

- `server.js` is the whole app: the page, the form, and `/healthz`, which the
  suite calls to check that the app is up and can read its data.
- `migrations/` changes the database. Add a new numbered file for every change;
  never edit one that has already run.
- `Dockerfile` is how the app is built.

This copy is the **dev** version. Change it, look at it, and when it works,
release it to **prod**, where the real guestbook lives. Nothing done here can
touch prod's data.
