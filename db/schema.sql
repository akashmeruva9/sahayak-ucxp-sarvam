-- Sahayak / UCXP — Supabase schema
--
-- Run this once in the Supabase SQL editor. Three concerns, deliberately
-- separate:
--
--   ucxp_manifests   written by the enterprise dashboard, read by the runtime
--   conversations    a chat session (app, web or WhatsApp)
--   messages         the turns inside one conversation
--
-- The runtime reads manifests over PostgREST and falls back to the local
-- manifests/*.json when this table is unreachable, so a DB outage degrades the
-- demo rather than ending it.

-- ---------------------------------------------------------------------------
-- 1. Manifests — the dashboard publishes here on Activate
-- ---------------------------------------------------------------------------
create table if not exists public.ucxp_manifests (
    business_id  text primary key,
    -- The full published manifest, exactly as the dashboard assembles it.
    -- Stored whole so the runtime's normalizer sees the same document a judge
    -- would read at GET /manifests/{id}.
    manifest     jsonb       not null,
    -- 'active' is the only status the runtime loads. Drafts stay invisible.
    status       text        not null default 'draft',
    version      integer     not null default 1,
    name         text,
    category     text,
    updated_at   timestamptz not null default now()
);

create index if not exists idx_ucxp_manifests_status on public.ucxp_manifests (status);

comment on table public.ucxp_manifests is
    'Published UCXP manifests. Writer: enterprise dashboard. Reader: UCXP runtime.';

-- ---------------------------------------------------------------------------
-- 2. Conversations + messages — written by the runtime
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
    id           text primary key,          -- the runtime's conversation_id
    user_id      uuid references auth.users (id) on delete set null,
    -- WhatsApp has no auth user; it is identified by the sender's number.
    channel      text        not null default 'app',   -- app | web | whatsapp
    external_id  text,                                  -- e.g. whatsapp:+9198…
    business_id  text,
    language     text        not null default 'en-IN',
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists idx_conversations_user on public.conversations (user_id);
create index if not exists idx_conversations_external on public.conversations (external_id);
create index if not exists idx_conversations_updated on public.conversations (updated_at desc);

create table if not exists public.messages (
    id              bigserial primary key,
    conversation_id text        not null references public.conversations (id) on delete cascade,
    role            text        not null,               -- user | assistant
    text            text        not null default '',
    -- The receipt card, when the turn completed a job. Null otherwise.
    receipt         jsonb,
    capability      text,
    latency_ms      numeric,
    created_at      timestamptz not null default now()
);

create index if not exists idx_messages_conversation on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
-- Manifests are public read: they are a published protocol document, and the
-- app's directory screen shows them to signed-out users. Writes are restricted
-- to the service role, which only the dashboard holds.
alter table public.ucxp_manifests enable row level security;

drop policy if exists "manifests are publicly readable" on public.ucxp_manifests;
create policy "manifests are publicly readable"
    on public.ucxp_manifests for select
    using (true);

-- A user sees only their own conversations. The runtime writes with the
-- service role, which bypasses RLS — these policies protect direct client
-- access, which is how the app reads history.
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations"
    on public.conversations for select
    using (auth.uid() = user_id);

drop policy if exists "own messages" on public.messages;
create policy "own messages"
    on public.messages for select
    using (
        exists (
            select 1 from public.conversations c
            where c.id = messages.conversation_id
              and c.user_id = auth.uid()
        )
    );
