-- Retire legacy keywordStrategy.semrushMode compatibility alias.
-- 1) Backfill seoDataMode from semrushMode when missing.
-- 2) Remove semrushMode from persisted keyword_strategy blobs.
UPDATE workspaces
SET keyword_strategy = json_remove(
  CASE
    WHEN json_type(keyword_strategy, '$.seoDataMode') IS NULL
      THEN json_set(keyword_strategy, '$.seoDataMode', json_extract(keyword_strategy, '$.semrushMode'))
    ELSE keyword_strategy
  END,
  '$.semrushMode'
)
WHERE keyword_strategy IS NOT NULL
  AND json_valid(keyword_strategy)
  AND json_type(keyword_strategy, '$.semrushMode') IS NOT NULL;
