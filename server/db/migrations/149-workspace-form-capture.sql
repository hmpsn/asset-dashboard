-- The Issue (Client) P1a: Webflow form-capture config on workspaces.
-- All admin-only / never serialized into any public/client payload (D7).
-- NOTE: comments live on their own lines (the ADD COLUMN migration runner strips only
-- full-line comments before splitting on ';', so inline comments would corrupt the split).
-- webflow_form_webhook_secret: admin-only HMAC signing secret for X-Webflow-Signature.
ALTER TABLE workspaces ADD COLUMN webflow_form_webhook_secret TEXT;
-- webflow_form_sources: JSON array of WebflowFormMapping.
ALTER TABLE workspaces ADD COLUMN webflow_form_sources TEXT;
-- conversion_tracking_confirmed_at: ISO timestamp set by the admin setup flow.
ALTER TABLE workspaces ADD COLUMN conversion_tracking_confirmed_at TEXT;
