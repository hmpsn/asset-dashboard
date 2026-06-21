/**
 * The Issue (Client) P1b — Lane A shared-type contract presence + compile test.
 *
 * Types-first guard: asserts SetupReadinessState, OnePagerExportPayload, and NamedLeadView are
 * importable from shared/types/the-issue.ts with the canonical field shapes B/C/D depend on, and
 * that OnePagerExportPayload.exportProfile is assignment-compatible with the non-null subset of
 * ResolvedSegmentProfile['exportProfile'] (so the segment resolver can feed the export directly).
 *
 * D7: NamedLeadView is the ONLY shape that carries lead PII (leadName/leadEmail). OnePagerExportPayload
 * carries NO PII of its own — leads attach only on the authed surface (optional `leads` field).
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  SetupReadinessState,
  OnePagerExportPayload,
  NamedLeadView,
} from '../../shared/types/the-issue.js';
import type { ResolvedSegmentProfile } from '../../shared/types/workspace.js';

describe('P1b Lane A — shared-type contracts', () => {
  it('SetupReadinessState carries the PII-free gate rollup', () => {
    const r: SetupReadinessState = {
      ga4Connected: true,
      valueSet: true,
      basisOfValue: 'agency_estimate',
      outcomeValueLabel: 'USD 800 / new patient · Agency estimate',
      segmentConfirmed: true,
      segmentLabel: 'b2b saas',
      eventsPinned: true,
      eventsTyped: true,
      webflowConnected: true,
      conversionTrackingConfirmedAt: '2026-06-20T00:00:00.000Z',
      lastLeadAt: '2026-06-19T00:00:00.000Z',
      povDrafted: true,
      resolvedProvenance: 'measured_action',
      openGapCount: 0,
    };
    expect(r.openGapCount).toBe(0);
    expect(r.resolvedProvenance).toBe('measured_action');
    expect(r.segmentLabel).toBe('b2b saas');
    // PII-free: no lead identity keys exist on the type (segment/value labels are config, not PII).
    expect(JSON.stringify(r)).not.toContain('leadName');
    expect(JSON.stringify(r)).not.toContain('@');
  });

  it('OnePagerExportPayload exportProfile aligns with the non-null segment exportProfile subset', () => {
    // Assignment-compat: a non-null ResolvedSegmentProfile.exportProfile must satisfy the payload field.
    const segProfile: NonNullable<ResolvedSegmentProfile['exportProfile']> = 'board_one_pager';
    const payload: OnePagerExportPayload = {
      exportProfile: segProfile,
      workspaceName: 'Acme',
      outcomeNoun: 'qualified leads',
      verdictSentence: '14 qualified leads ≈ $11,200 in value',
      estimatedValue: 11200,
      monthlyRetainer: 1500,
      adSpendEquivalent: 420,
      valueVsRetainerRatio: 7.46,
      outcomeCount: 14,
      outcomeUnitLabel: 'qualified lead',
      outcomeCountSinceStart: 9,
      baselineCapturedAt: '2026-01-01T00:00:00.000Z',
      outcomeTypeBreakdown: [],
      topMoves: [{ title: 'Fix decaying page', estimatedGain: '+15%' }],
      methodologyLine: 'Counts are estimated from GA4 key events.',
      provenance: 'estimate_ga4',
      generatedAt: '2026-06-20T00:00:00.000Z',
    };
    expectTypeOf(payload.exportProfile).toEqualTypeOf<
      'sms_recap' | 'board_one_pager' | 'partner_summary' | 'owner_portfolio'
    >();
    // Payload carries no PII unless leads are attached on the authed surface.
    expect(JSON.stringify(payload)).not.toContain('@');
    expect(payload.leads).toBeUndefined();
  });

  it('NamedLeadView is the single PII-carrying lead shape (admin + client-own reads)', () => {
    const lead: NamedLeadView = {
      id: 'lead-1',
      formName: 'Contact',
      leadName: 'Jane Doe',
      leadEmail: 'jane@example.com',
      outcomeType: 'form_fill',
      submittedAt: '2026-06-19T00:00:00.000Z',
    };
    expect(lead.leadEmail).toBe('jane@example.com');
    // The payload type can attach NamedLeadView[] (authed surface only).
    const withLeads: OnePagerExportPayload['leads'] = [lead];
    expect(withLeads?.[0].leadName).toBe('Jane Doe');
  });
});
