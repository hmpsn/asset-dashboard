/**
 * The Issue (Client) P1b — Lane A export-data assembler (A3).
 *
 * assembleOnePagerExport builds the forwardable one-pager DATA payload from computeROI().outcomeVerdict
 * + the segment exportProfile + curated top-moves. Print-from-browser HTML is rendered separately
 * (renderOnePagerHTML); this assembler produces structured data ONLY.
 *
 * D7: the payload carries NO PII. `leads` is left undefined here — the route attaches NamedLeadView[]
 * on the authed surface only.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { saveFormSubmission } from '../../server/form-submissions.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { assembleOnePagerExport } from '../../server/the-issue-export.js';

const cleanups: Array<() => void> = [];
const flaggedWorkspaces: string[] = [];

function seedRoiCpcData(wsId: string): void {
  upsertPageKeywordsBatch(wsId, [{
    pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
    secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
  }]);
}

afterAll(() => {
  for (const id of flaggedWorkspaces) setWorkspaceFlagOverride('the-issue-client-spine', id, null);
  while (cleanups.length) cleanups.pop()!();
});

describe('assembleOnePagerExport', () => {
  it('returns null when the spine flag is OFF (no outcomeVerdict)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    seedRoiCpcData(s.workspaceId);
    updateWorkspace(s.workspaceId, { outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 } });
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'form_submit', conversions: 14, users: 200, rate: 7 }] });
    setWorkspaceFlagOverride('the-issue-client-spine', s.workspaceId, false);
    flaggedWorkspaces.push(s.workspaceId);
    expect(assembleOnePagerExport(s.workspaceId)).toBeNull();
  });

  it('returns null for a non-existent workspace', () => {
    expect(assembleOnePagerExport('does-not-exist')).toBeNull();
  });

  it('hydrated → estimatedValue, ratio, segment exportProfile, capped top moves, methodology', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    seedRoiCpcData(s.workspaceId);
    updateWorkspace(s.workspaceId, {
      name: 'Acme Dental',
      outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
      eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
      segmentConfig: { segment: 'b2b_saas' },
    });
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'form_submit', conversions: 14, users: 200, rate: 7 }] });
    setWorkspaceFlagOverride('the-issue-client-spine', s.workspaceId, true);
    flaggedWorkspaces.push(s.workspaceId);

    const p = assembleOnePagerExport(s.workspaceId)!;
    expect(p).not.toBeNull();
    expect(p.workspaceName).toBe('Acme Dental');
    expect(p.estimatedValue).toBe(14 * 800);
    expect(p.outcomeCount).toBe(14);
    expect(p.monthlyRetainer).toBe(1500);
    expect(p.valueVsRetainerRatio).toBeCloseTo((14 * 800) / 1500, 4);
    // b2b_saas → board_one_pager
    expect(p.exportProfile).toBe('board_one_pager');
    expect(p.outcomeNoun.length).toBeGreaterThan(0);
    expect(p.topMoves.length).toBeLessThanOrEqual(3);
    expect(typeof p.methodologyLine).toBe('string');
    expect(p.methodologyLine.length).toBeGreaterThan(0);
    expect(p.verdictSentence.length).toBeGreaterThan(0);
    expect(p.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // Gate D: estimate_ga4 (no measured/reconciled data) → BANDED estimatedValueLabel + a verdict
    // sentence carrying the banded value with NO ≈ hedge and NO exact count × rate dollar ($11,200).
    expect(p.provenance).toBe('estimate_ga4');
    expect(p.estimatedValueLabel).toMatch(/^~\$/);
    expect(p.estimatedValueLabel).toBe('~$11,000');
    expect(p.verdictSentence).toContain('~$11,000');
    expect(p.verdictSentence).not.toContain('≈');
    expect(p.verdictSentence).not.toContain('$11,200');
  });

  it('no monthlyRetainer → valueVsRetainerRatio is null', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    seedRoiCpcData(s.workspaceId);
    updateWorkspace(s.workspaceId, { outcomeValue: { valuePerOutcome: 500, unitLabel: 'lead', currency: 'USD', basis: 'client_provided' } });
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: new Date().toISOString(), totalConversions: 6, totalUsers: 100, byEvent: [{ eventName: 'form_submit', conversions: 6, users: 100, rate: 6 }] });
    setWorkspaceFlagOverride('the-issue-client-spine', s.workspaceId, true);
    flaggedWorkspaces.push(s.workspaceId);
    const p = assembleOnePagerExport(s.workspaceId)!;
    expect(p.monthlyRetainer).toBeNull();
    expect(p.valueVsRetainerRatio).toBeNull();
  });

  it('carries NO PII even when named leads exist (D7)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    seedRoiCpcData(s.workspaceId);
    updateWorkspace(s.workspaceId, { outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 } });
    saveGa4Snapshot({ workspaceId: s.workspaceId, capturedAt: new Date().toISOString(), totalConversions: 14, totalUsers: 200, byEvent: [{ eventName: 'form_submit', conversions: 14, users: 200, rate: 7 }] });
    const now = '2026-06-19T12:00:00.000Z';
    saveFormSubmission({
      workspaceId: s.workspaceId, formId: 'f1', submissionId: 'sub-x', formName: 'Contact',
      leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'secret',
      eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
    });
    setWorkspaceFlagOverride('the-issue-client-spine', s.workspaceId, true);
    flaggedWorkspaces.push(s.workspaceId);
    const p = assembleOnePagerExport(s.workspaceId)!;
    expect(p.leads).toBeUndefined();
    const json = JSON.stringify(p);
    expect(json).not.toContain('@');
    expect(json).not.toContain('Jane Doe');
    expect(json).not.toContain('secret');
  });
});
