-- 108-workspace-authority.sql
-- Per-workspace referring-domains authority signal for the Opportunity Value
-- re-architecture (PR5 · Spine C). Persists the REAL backlink-derived authority
-- (referring domains → backlinkProfileToAuthorityStrength), replacing the
-- organic-keyword-count proxy on the OV scoring path ONLY.
-- Zero client-facing effect — feeds the (flag-off, dark) OV authorityStrength.

CREATE TABLE IF NOT EXISTS workspace_authority (
  workspace_id TEXT PRIMARY KEY,
  referring_domains INTEGER NOT NULL DEFAULT 0,
  authority_strength INTEGER NOT NULL DEFAULT 0,  -- 0/20/50/80 bucket from referring domains
  captured_at TEXT NOT NULL
);
