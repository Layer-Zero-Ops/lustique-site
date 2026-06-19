-- Wave C Phase 1: Dashboard-support tables
-- notifications: Worker writes; admin reads via Realtime + polling.
-- message_templates: editable email copy; Worker reads at send time with in-code fallback.

-- 1. notification_type enum
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'booking_requested', 'deposit_paid', 'payment_failed',
    'balance_paid', 'invoice_rejected', 'invoice_expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Notifications — persistent; Realtime channel broadcasts new rows to the dashboard.
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient   text NOT NULL DEFAULT 'admin',
  type        notification_type NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text NOT NULL,
  booking_id  uuid REFERENCES bookings(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON notifications (recipient, created_at DESC)
  WHERE read_at IS NULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- v1: anon-read policy (rows carry only first name + relative link; dashboard behind ADMIN_SECRET)
-- Phase 1 upgrade: swap to `auth.uid() IS NOT NULL AND role='admin'` check — zero client change.
CREATE POLICY notifications_anon_admin_read ON notifications
  FOR SELECT USING (recipient = 'admin');

-- Enable Realtime for the notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- 3. Message templates — editable email copy; fallback to in-code defaults if row missing/disabled.
CREATE TABLE IF NOT EXISTS message_templates (
  key             text PRIMARY KEY,
  name            text NOT NULL,
  subject         text NOT NULL,
  body_html       text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  send_offset_days int,
  updated_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_templates_admin_read ON message_templates
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Seed with current hard-coded copy (behaviour unchanged day one; editable from dashboard).
INSERT INTO message_templates (key, name, subject, body_html, enabled, send_offset_days) VALUES
  ('full_pay_checkin',   'Full-pay check-in',        'See you soon — Lustique Co.',
   '<p>Hi {{bride_name}},</p><p>Your wedding day is just two weeks away — we are so excited to celebrate with you. Here are a few reminders to prepare...</p><p>Warmly,<br/>The Lustique Team</p>',
   true, 14),
  ('invoice_sent',       'Invoice sent to bride',     'Your Lustique quote — {{reference}}',
   '<p>Hi {{bride_name}},</p><p>Thank you for your interest in Lustique Co. Please find your personalised quote below.</p>',
   true, null),
  ('accept_receipt',     'Bride accepted quote',      'You are on our calendar — Lustique Co.',
   '<p>Hi {{bride_name}},</p><p>Wonderful — your quote has been accepted and your deposit payment is being processed.</p>',
   true, null),
  ('reject_ack',         'Bride rejected quote',      'Thank you — Lustique Co.',
   '<p>Hi {{bride_name}},</p><p>Thank you for letting us know. We completely understand, and wish you all the best for your special day.</p>',
   true, null),
  ('nudge_1',            'Quote nudge (day 3)',        'Following up — your Lustique quote',
   '<p>Hi {{bride_name}},</p><p>Just a gentle reminder that your personalised quote is waiting. Reply to this email with any questions.</p>',
   true, null),
  ('nudge_2',            'Quote nudge (day 7)',        'Last chance — your Lustique quote expires soon',
   '<p>Hi {{bride_name}},</p><p>Your quote expires in a few days. We would love to have you — please accept before it closes.</p>',
   true, null),
  ('invoice_closing',    'Invoice closing (expired)',  'Closing your file — Lustique Co.',
   '<p>Hi {{bride_name}},</p><p>As we have not heard back, we are closing your quote. We wish you a beautiful wedding day — feel free to reach out if circumstances change.</p>',
   true, null),
  ('balance_reminder',   'Balance due reminder',      'Balance due — Lustique Co.',
   '<p>Hi {{bride_name}},</p><p>A friendly reminder that your balance payment is due. Please use the link in your original invoice email, or contact us to arrange EFT.</p>',
   true, null)
ON CONFLICT (key) DO NOTHING;
