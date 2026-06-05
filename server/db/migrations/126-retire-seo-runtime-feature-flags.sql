DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'local-seo-visibility',
  'schema-ai-element-classifier',
  'seo-generation-quality'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'local-seo-visibility',
  'schema-ai-element-classifier',
  'seo-generation-quality'
);
