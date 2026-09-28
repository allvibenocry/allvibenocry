# {{PROJECT}}: decisions

Every decision about this app, with the reason for it, newest last. Add to it;
never rewrite what is already here, so that the reason that was true at the
time stays readable.

## D1. Start from the guestbook

*{{DATE}}*

The app starts as a guestbook: one page, one form, one table in the database,
and a health check at `/healthz`.

**Why.** It is the smallest app that has everything a real one needs: a page,
a form, stored data, and a way to check that it works. Everything else is built
on it, one step at a time.
