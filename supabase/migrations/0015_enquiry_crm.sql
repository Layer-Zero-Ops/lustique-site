-- 0015: CRM fields on enquiries + enquiry_received notification type

-- Extend the notification_type enum so Workers can ring the bell on new enquiries
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'enquiry_received';

-- CRM lifecycle fields on enquiries
ALTER TABLE enquiries
  ADD COLUMN status       text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  ADD COLUMN notes        text,
  ADD COLUMN contacted_at timestamptz;

CREATE INDEX enquiries_status_idx ON enquiries (status, created_at DESC);
