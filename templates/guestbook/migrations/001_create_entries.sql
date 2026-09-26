-- The guestbook's one table.
create table entries (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 1 and 80),
  message text not null check (length(message) between 1 and 1000),
  created_at timestamptz not null default now()
);
