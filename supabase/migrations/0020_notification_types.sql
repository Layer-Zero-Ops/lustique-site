-- TASK-E: add notification_type enum values for new bell triggers
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'balance_due';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contact_added';
