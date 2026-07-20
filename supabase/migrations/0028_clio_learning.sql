-- 0028: Clio learning playbook (persistent memory + cross-client compounding).
-- After a proposal resolves (won/lost), the verdict + measured effect land here so the
-- agent doesn't re-learn the same lesson every run, and so patterns can compound
-- across clients (the reusable template playbook). See ROADMAP-self-optimizing.md.

create table if not exists clio_learning (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  proposal_id   uuid references clio_proposals(id) on delete set null,
  area          text not null,
  lesson        text not null,   -- the durable takeaway
  verdict       text not null check (verdict in ('won','lost','inconclusive')),
  effect        text,             -- measured delta (e.g. "Trial→booking +1.8pp")
  confidence    int not null default 1 check (confidence between 1 and 5),
  scope         text not null default 'client'
                  check (scope in ('client','studio')),  -- 'studio' = anonymized, cross-client
  tags          text[],           -- e.g. {'seasonal','pricing-psych','referral'}
  source_client text default 'lustique'
);

create index if not exists clio_learning_area_idx on clio_learning (area);
create index if not exists clio_learning_scope_idx on clio_learning (scope);
create index if not exists clio_learning_created_idx on clio_learning (created_at desc);

-- Safe-change allowlist: declares which config docs/keys the agent MAY touch and
-- which it NEVER may (explicit rail; enforced in agent logic, mirrored here as truth).
create table if not exists clio_safe_change (
  id             uuid primary key default gen_random_uuid(),
  doc            text not null,   -- config doc/row name
  key            text not null,   -- field/key within it
  allowed        boolean not null default false,
  reason         text,
  unique (doc, key)
);

-- Seed the forbidden set (the rail). These can never be proposed.
insert into clio_safe_change (doc, key, allowed, reason) values
  ('code',           '*',            false, 'Application code is never agent-edited (deploy-gated).'),
  ('booking',        'bride_pii',   false, 'Bride PII is out of scope for optimization.'),
  ('booking',        'invoice_live', false, 'Live invoices must not be mutated by experiments.'),
  ('config',         'safe_change',  false, 'The rail itself is immutable by the agent.')
on conflict (doc, key) do nothing;

-- Admin (service role) read/write; never queried client-side.
