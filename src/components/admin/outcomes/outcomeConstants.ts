// src/components/admin/outcomes/outcomeConstants.ts
// Shared display constants for outcome components

import type { ActionType } from '../../../../shared/types/outcome-tracking';

/** Format ISO date to "Mar 29, 2026" */
export function formatOutcomeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format a 0-1 decimal as a percentage string, e.g. 0.73 → "73%" */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

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
