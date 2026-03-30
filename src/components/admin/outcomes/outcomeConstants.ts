// src/components/admin/outcomes/outcomeConstants.ts
// Shared display constants for outcome components

import type { ActionType } from '../../../../shared/types/outcome-tracking';

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  insight_acted_on: 'Insight',
  content_published: 'Content Published',
  brief_created: 'Brief Created',
  strategy_keyword_added: 'Strategy Update',
  schema_deployed: 'Schema Deployed',
  audit_fix_applied: 'Audit Fix',
  content_refreshed: 'Content Refresh',
  internal_link_added: 'Internal Link',
  meta_updated: 'Meta Update',
  voice_calibrated: 'Voice Calibration',
};
