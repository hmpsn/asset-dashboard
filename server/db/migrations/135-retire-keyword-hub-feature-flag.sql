-- Keyword Hub cutover (Phase C, 2026-06-11): the `keyword-hub` umbrella flag is retired.
-- The Hub is now the only keyword surface (KCC + Rank Tracker deleted, seo-ranks redirected),
-- so the flag — and its production global override (ON since ~2026-06-10) — is removed.
-- The sibling Keyword Hub sub-flags (keyword-universe-full, keyword-value-scoring) survive.
DELETE FROM feature_flag_workspace_overrides
WHERE key = 'keyword-hub';

DELETE FROM feature_flag_overrides
WHERE key = 'keyword-hub';
