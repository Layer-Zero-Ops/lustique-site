-- Phase 9 — real inbox (mailbox-agnostic). P2 scaffolding.
-- A single `messages` table is the system of record for Zandeline's email, fed by a
-- swappable fetcher (Spacemail now; Gmail API later during Workspace→Spacemail overlap).
-- POPIA: store snippet + headers + deep-link only; full body is referenceable, not copied
-- beyond 30 days (enforced by the tidy worker).

create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'spacemail',   -- 'spacemail' | 'gmail'
  external_id   text not null,                         -- IMAP UID or Gmail message id
  thread_id     text,
  from_name     text,
  from_email    text not null,
  to_email      text,
  subject       text,
  snippet       text,                                  -- short preview (POPIA: not full body)
  received_at   timestamptz not null,
  is_read       boolean not null default false,
  is_archived   boolean not null default false,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists messages_received_idx on messages (received_at desc);
create index if not exists messages_unread_idx on messages (is_read, is_archived, deleted_at);

-- Link a message to a booking/enquiry when Aria matches it (for the unified timeline).
alter table messages add column if not exists linked_booking_id uuid;
alter table messages add column if not exists linked_enquiry_id uuid;
