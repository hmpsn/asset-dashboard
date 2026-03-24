-- Track outbound emails for throttling / anti-spam
CREATE TABLE IF NOT EXISTS email_sends (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient  TEXT    NOT NULL,
  category   TEXT    NOT NULL,  -- status, audit, action, alert, transactional, report
  email_type TEXT    NOT NULL,  -- original EmailEventType
  workspace_id TEXT  NOT NULL DEFAULT '',
  event_count  INTEGER NOT NULL DEFAULT 1,
  sent_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_email_sends_recipient_cat ON email_sends(recipient, category, sent_at);
CREATE INDEX idx_email_sends_recipient_day ON email_sends(recipient, sent_at);
