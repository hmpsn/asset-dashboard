-- The Issue (Client) P1a — drop the retired Webflow form-webhook signing secret.
-- Outcome capture switched from an HMAC webhook receiver to polling the Webflow Forms Data API
-- (owner directive), so the per-workspace signing secret is no longer used by any code path.
-- The other two P1a columns (webflow_form_sources, conversion_tracking_confirmed_at) stay — they
-- are source-agnostic (form selection + the provenance-flip marker) and still drive capture.
-- DROP COLUMN is supported by the bundled SQLite (3.35+); migration 149 always ran first, so the
-- column exists when this runs. Each migration is applied exactly once (tracked in _migrations).
ALTER TABLE workspaces DROP COLUMN webflow_form_webhook_secret;
