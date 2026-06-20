import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { computeROI } from '../../server/roi.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import db from '../../server/db/index.js';

// computeROI needs at least one tracked page (page_keywords) to return non-null.
function seedPageKeyword(workspaceId: string) {
  db.prepare(
    `INSERT INTO page_keywords (workspace_id, page_path, page_title, primary_keyword, clicks, impressions, cpc, current_position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(workspaceId, '/services', 'Services', 'dentist near me', 100, 2000, 3.5, 4);
}

describe('computeROI outcomeVerdict — measured_action (P1a)', () => {
  let wsId: string;
  let cleanup: () => void;
  beforeAll(() => {
    const s = seedWorkspace();
    wsId = s.workspaceId;
    cleanup = s.cleanup;
    seedPageKeyword(wsId);
    setWorkspaceFlagOverride('the-issue-client-spine', wsId, true);
    setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, true);
    updateWorkspace(wsId, {
      outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
      eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
      conversionTrackingConfirmedAt: new Date().toISOString(),
    });
    saveGa4Snapshot({
      workspaceId: wsId, capturedAt: new Date().toISOString(), totalConversions: 23, totalUsers: 300,
      byEvent: [{ eventName: 'form_submit', conversions: 23, users: 200, rate: 7 }],
    });
  });
  afterAll(() => {
    setWorkspaceFlagOverride('the-issue-client-spine', wsId, null);
    setWorkspaceFlagOverride('the-issue-client-measured-capture', wsId, null);
    db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(wsId);
    cleanup();
  });

  it('selects measured_action when pinned events carry an outcomeType + setup confirmed', () => {
    const roi = computeROI(wsId)!;
    expect(roi.outcomeVerdict?.provenance).toBe('measured_action');
    expect(roi.outcomeVerdict?.outcomeCount).toBe(23);
    // dollar math unchanged: 23 × 800
    expect(roi.outcomeVerdict?.estimatedValue).toBe(23 * 800);
    expect(roi.outcomeVerdict?.outcomeTypeBreakdown?.[0].outcomeType).toBe('form_fill');
    expect(roi.outcomeVerdict?.outcomeTypeBreakdown?.[0].current).toBe(23);
  });
});
