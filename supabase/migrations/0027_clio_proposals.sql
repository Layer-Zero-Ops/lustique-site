-- 0027: Clio self-optimization proposals (human-in-the-loop rail).
-- The agent LEARNS from data, PROPOSES a config change with a why, and only
-- EXECUTES after the owner approves (Telegram). Every proposal targets a CONFIG
-- doc/row the agent can also REVERT — never code or live bride content.
-- See docs/ROADMAP-self-optimizing.md.

create table if not exists clio_proposals (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- 'proposed' (awaiting approval) | 'approved' | 'rejected' | 'applied' | 'reverted' | 'lost'
  status        text not null default 'proposed'
                  check (status in ('proposed','approved','rejected','applied','reverted','lost')),
  area          text not null,   -- e.g. 'pricing' | 'hero' | 'automation' | 'seo' | 'offer'
  hypotheis    text not null,   -- what we believe will happen
  expected_effect text not null, -- measurable outcome + how we'll measure it
  rollback      text not null,   -- exact revert step (config doc/key to restore)
  cohort_key    text,             -- identifies the before/after measurement window
  target_doc   text not null,   -- config doc/row the change lands on
  target_key    text not null,   -- the specific field/key within it
  proposed_value jsonb,           -- the new value (nullable: some bets are "observe only")
  current_value  jsonb,           -- captured at proposal time, for clean revert
  rationale     jsonb,             -- supporting data (e.g. conversion rates, source mix)
  applied_at    timestamptz,
  resolved_at   timestamptz,
  verdict_note  text
);

create index if not exists clio_proposals_status_idx on clio_proposals (status);
create index if not exists clio_proposals_created_idx on clio_proposals (created_at desc);

-- Admin (service role) read/write; never queried client-side.
