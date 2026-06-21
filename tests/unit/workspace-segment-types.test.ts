import { describe, it, expect } from 'vitest';
import type { Workspace, ClientSegment, SegmentConfig, ResolvedSegmentProfile } from '../../shared/types/workspace.js';

describe('segment + outcomeValue workspace contracts', () => {
  it('ClientSegment admits the five spec segments', () => {
    const segs: ClientSegment[] = ['local_smb', 'b2b_saas', 'board_vc', 'professional_services', 'multi_location'];
    expect(segs).toHaveLength(5);
  });
  it('outcomeValue carries valuePerOutcome + basis precedence enum', () => {
    const ov: NonNullable<Workspace['outcomeValue']> = {
      valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500,
    };
    expect(ov.basis).toBe('agency_estimate');
  });
  it('ResolvedSegmentProfile pre-resolves boolean inserts + altitude', () => {
    const p: ResolvedSegmentProfile = {
      segment: 'local_smb', outcomeNounSingular: 'new patient', outcomeNounPlural: 'new patients',
      moneyFrameAltitude: 'production_vs_retainer', showCompetitorAuthority: false,
      showPortfolioRollup: false, showLocalMapAndReviews: true, exportProfile: 'sms_recap',
    };
    expect(p.showLocalMapAndReviews).toBe(true);
  });
  it('SegmentConfig.segment is the stored admin override', () => {
    const sc: SegmentConfig = { segment: 'b2b_saas', outcomeNounSingular: 'qualified lead' };
    expect(sc.segment).toBe('b2b_saas');
  });
});
