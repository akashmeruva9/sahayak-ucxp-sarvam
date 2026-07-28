-- Sahayak / UCXP — dashboard users
--
-- Run this once in the Supabase SQL editor. It extends the schema in
-- `db/schema.sql` on `main`; it does not replace it.
--
-- This table is a **mirror, not a source of truth**. The dashboard's own SQLite
-- holds the authoritative record, so a Supabase outage costs a stale row here
-- and never a failed sign-in. Anything that reads this should treat it as
-- "who we have seen", not "who is allowed in" — permission is decided by
-- UCXP_ADMIN_EMAILS at request time, deliberately, so revoking someone takes
-- effect on their next click rather than whenever their session expires.

create table if not exists public.ucxp_dashboard_users (
    email         text primary key,
    name          text,
    picture       text,
    -- A snapshot of admin status at their last sign-in. Informational only —
    -- see the note above about where permission actually lives.
    is_admin      boolean     not null default false,
    first_seen    timestamptz,
    last_seen     timestamptz,
    sign_in_count integer     not null default 1,
    updated_at    timestamptz not null default now()
);

create index if not exists idx_ucxp_dashboard_users_last_seen
    on public.ucxp_dashboard_users (last_seen desc);

comment on table public.ucxp_dashboard_users is
    'People who have signed into the merchant dashboard. Mirror of the dashboard''s own users table; written with the service role only.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Unlike ucxp_manifests, this is not a published artifact — it is a list of
-- real people's email addresses. No select policy is created, so with RLS on,
-- anon and authenticated clients see nothing. The service role bypasses RLS,
-- which is how the dashboard writes and reads it.
alter table public.ucxp_dashboard_users enable row level security;
