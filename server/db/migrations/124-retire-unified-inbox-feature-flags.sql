DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'new-inbox-ia',
  'unified-deliverables-approval-family',
  'unified-deliverables-broken-family',
  'unified-deliverables-rest',
  'unified-inbox'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'new-inbox-ia',
  'unified-deliverables-approval-family',
  'unified-deliverables-broken-family',
  'unified-deliverables-rest',
  'unified-inbox'
);
