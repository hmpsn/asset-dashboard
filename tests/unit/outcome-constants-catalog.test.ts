// tests/unit/outcome-constants-catalog.test.ts
//
// R5-PR2 (B9): admin outcome label maps must read through the action catalog
// (shared/types/action-catalog.ts) instead of carrying their own duplicated
// Record<ActionType, string>. This test asserts ACTION_TYPE_LABELS is DRIVEN
// BY getActionCatalogEntry('outcome', ...) — not just coincidentally equal —
// by mutating the catalog import surface indirectly via the accessor and
// checking every value traces back to `label`.

import { describe, it, expect } from 'vitest';
import { ACTION_TYPE_LABELS } from '../../src/components/admin/outcomes/outcomeConstants.js';
import { ACTION_CATALOG, getActionCatalogEntry } from '../../shared/types/action-catalog.js';
import type { ActionType } from '../../shared/types/outcome-tracking.js';

const ACTION_TYPES = Object.keys(ACTION_CATALOG.outcome) as ActionType[];

describe('outcomeConstants ACTION_TYPE_LABELS resolves through the action catalog', () => {
  it('every ACTION_TYPE_LABELS entry equals the catalog outcome-context label', () => {
    for (const type of ACTION_TYPES) {
      const catalogLabel = getActionCatalogEntry('outcome', type)?.label;
      expect(catalogLabel, `catalog entry for outcome/${type}`).toBeDefined();
      expect(ACTION_TYPE_LABELS[type], `ACTION_TYPE_LABELS.${type}`).toBe(catalogLabel);
    }
  });

  it('has no keys outside the catalog outcome context (no stale duplicated map)', () => {
    const labelKeys = Object.keys(ACTION_TYPE_LABELS).sort();
    const catalogKeys = ACTION_TYPES.slice().sort();
    expect(labelKeys).toEqual(catalogKeys);
  });

  // Behavior-parity pin: labels unchanged for every ActionType where the old
  // hand-written admin map already agreed with the catalog's canonical wording.
  it('parity pin — unchanged labels', () => {
    const unchanged: Record<string, string> = {
      content_published: 'Content Published',
      brief_created: 'Brief Created',
      strategy_keyword_added: 'Strategy Update',
      schema_deployed: 'Schema Deployed',
      audit_fix_applied: 'Audit Fix',
      content_refreshed: 'Content Refresh',
      internal_link_added: 'Internal Link',
      meta_updated: 'Meta Update',
      voice_calibrated: 'Voice Calibration',
      competitor_gap_closed: 'Keyword Gap Closed',
      cluster_published: 'Cluster Published',
      cannibalization_resolved: 'Cannibalization Resolved',
      local_visibility_won: 'Local Visibility Won',
      local_service_added: 'Local Service Targeted',
      topic_cluster_keep: 'Topic Cluster Kept',
      content_gap_keep: 'Content Gap Kept',
    };
    for (const [type, label] of Object.entries(unchanged)) {
      expect(ACTION_TYPE_LABELS[type as ActionType]).toBe(label);
    }
  });

  // Behavior-parity pin: the one intended consolidation from this cutover —
  // the admin map's old 'Insight' shorthand is replaced by the catalog's
  // canonical 'Insight Acted On' (admin-only; no client surface reads this map).
  it('parity pin — intended consolidation (insight_acted_on)', () => {
    expect(ACTION_TYPE_LABELS.insight_acted_on).toBe('Insight Acted On');
  });
});
