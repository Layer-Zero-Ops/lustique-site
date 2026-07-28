-- Phase 8 — Aria business-assistant chat + capability gating.
-- Threaded conversation between Zandeline and Aria, plus a pending-actions queue
-- so med/high-risk actions require explicit approval before they execute.

create table if not exists aria_threads (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists aria_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references aria_threads (id) on delete cascade,
  role        text not null check (role in ('user', 'aria', 'system')),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists aria_messages_thread_idx on aria_messages (thread_id, created_at);

-- Pending actions Aria wants to take that need Zandeline's approval (med/high risk).
create table if not exists aria_pending_actions (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references aria_threads (id) on delete cascade,
  capability   text not null,
  summary     text not null,
  payload     jsonb not null default '{}'::jsonb,
  risk        text not null check (risk in ('low', 'med', 'high')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'done')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index if not exists aria_pending_thread_idx on aria_pending_actions (thread_id, status);

-- Keep agent_bridge referenced for the Telegram side; ensure it exists.
create table if not exists agent_bridge (
  id          uuid primary key default gen_random_uuid(),
  direction   text not null,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
