import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface GuardSignal {
  entity: string;
  file: string;
  transitionToken: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GUARD_SIGNALS: GuardSignal[] = [
  { entity: 'approval_item', file: 'server/approvals.ts', transitionToken: 'APPROVAL_ITEM_TRANSITIONS' },
  { entity: 'content_request', file: 'server/content-requests.ts', transitionToken: 'CONTENT_REQUEST_TRANSITIONS' },
  { entity: 'post', file: 'server/content-posts-db.ts', transitionToken: 'POST_STATUS_TRANSITIONS' },
  { entity: 'work_order', file: 'server/work-orders.ts', transitionToken: 'WORK_ORDER_TRANSITIONS' },
  { entity: 'content_subscription', file: 'server/content-subscriptions.ts', transitionToken: 'CONTENT_SUB_TRANSITIONS' },
  { entity: 'client_action', file: 'server/client-actions.ts', transitionToken: 'CLIENT_ACTION_TRANSITIONS' },
  { entity: 'briefing_draft', file: 'server/briefing-store.ts', transitionToken: 'BRIEFING_DRAFT_TRANSITIONS' },
  { entity: 'background_job', file: 'server/jobs.ts', transitionToken: 'BACKGROUND_JOB_TRANSITIONS' },
  { entity: 'recommendation', file: 'server/domains/recommendations/status-service.ts', transitionToken: 'RECOMMENDATION_TRANSITIONS' },
  { entity: 'keyword', file: 'server/domains/keyword-command-center/action-service.ts', transitionToken: 'TRACKED_KEYWORD_TRANSITIONS' },
  // G2: newly wired machines
  { entity: 'request', file: 'server/requests.ts', transitionToken: 'REQUEST_TRANSITIONS' },
  { entity: 'matrix_cell', file: 'server/content-matrices.ts', transitionToken: 'MATRIX_CELL_TRANSITIONS' },
  // R3-PR2: folded parallel validators + newly guarded lifecycle write paths.
  { entity: 'copy_section', file: 'server/copy-review.ts', transitionToken: 'COPY_SECTION_TRANSITIONS' },
  { entity: 'voice_profile', file: 'server/voice-calibration.ts', transitionToken: 'VOICE_PROFILE_TRANSITIONS' },
  { entity: 'insight_resolution', file: 'server/analytics-insights-store.ts', transitionToken: 'INSIGHT_RESOLUTION_TRANSITIONS' },
  { entity: 'discovery_extraction', file: 'server/discovery-ingestion.ts', transitionToken: 'EXTRACTION_TRANSITIONS' },
  { entity: 'suggested_brief', file: 'server/suggested-briefs-store.ts', transitionToken: 'SUGGESTED_BRIEF_TRANSITIONS' },
  { entity: 'client_signal', file: 'server/client-signals-store.ts', transitionToken: 'CLIENT_SIGNAL_TRANSITIONS' },
  { entity: 'blueprint', file: 'server/page-strategy.ts', transitionToken: 'BLUEPRINT_TRANSITIONS' },
  { entity: 'brand_deliverable', file: 'server/brand-identity.ts', transitionToken: 'BRAND_DELIVERABLE_TRANSITIONS' },
  { entity: 'client_location', file: 'server/client-locations.ts', transitionToken: 'CLIENT_LOCATION_TRANSITIONS' },
  { entity: 'tracked_keyword_reconcile', file: 'server/rank-tracking-reconciliation.ts', transitionToken: 'TRACKED_KEYWORD_TRANSITIONS' },
  // seo_suggestion uses a per-row bulk guard (legalSuggestionIdsForTarget) rather than a
  // direct validateTransition() call, so it is pinned by its transition token + guard
  // helper name below instead of the standard validateTransition( signal.
];

// seo_suggestions guards a BULK write (WHERE id IN) by reading each row's status and
// filtering to legal transitions — it references SEO_SUGGESTION_TRANSITIONS but not the
// per-row validateTransition() call, so it is verified separately.
const BULK_GUARD_SIGNALS: Array<{ entity: string; file: string; transitionToken: string; guardHelper: string }> = [
  { entity: 'seo_suggestion', file: 'server/seo-suggestions.ts', transitionToken: 'SEO_SUGGESTION_TRANSITIONS', guardHelper: 'legalSuggestionIdsForTarget' },
];

function readSource(file: string): string {
  const absolutePath = path.resolve(ROOT, file);
  expect(existsSync(absolutePath), `${file} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8');
}

describe('state machine guard coverage contracts', () => {
  it('keeps validateTransition guard calls wired for each critical status entity', () => {
    for (const signal of GUARD_SIGNALS) {
      const source = readSource(signal.file);
      expect(
        source.includes('validateTransition(') && source.includes(signal.transitionToken),
        `${signal.entity} should be guarded by validateTransition + ${signal.transitionToken}`,
      ).toBe(true);
    }
  });

  it('keeps bulk-write guards wired via their transition token + per-row guard helper', () => {
    for (const signal of BULK_GUARD_SIGNALS) {
      const source = readSource(signal.file);
      expect(
        source.includes(signal.transitionToken) && source.includes(signal.guardHelper),
        `${signal.entity} should be guarded by ${signal.guardHelper} + ${signal.transitionToken}`,
      ).toBe(true);
    }
  });

  it('coverage rises to at least 22 guarded entities (12 pre-R3-PR2 + folds/new)', () => {
    expect(GUARD_SIGNALS.length + BULK_GUARD_SIGNALS.length).toBeGreaterThanOrEqual(22);
  });
});
