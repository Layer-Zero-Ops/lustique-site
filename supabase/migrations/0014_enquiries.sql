-- 0014: enquiries table — persist every /api/enquiry submission so no lead is lost
-- even if Brevo delivery fails. Zandeline can see raw leads in Supabase Dashboard.

create table enquiries (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text        not null,
  email       text        not null,
  phone       text        not null,
  occasion    text,
  event_date  text,
  town        text,
  estimate    text,
  message     text,
  details     jsonb,
  -- source IP (CF header — for spam review, never displayed to Zandeline)
  ip          text
);

-- RLS: service role writes (Worker); admin can read
alter table enquiries enable row level security;

create policy "admin read enquiries"
  on enquiries for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );
