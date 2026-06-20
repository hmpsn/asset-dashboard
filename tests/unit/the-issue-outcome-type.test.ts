import { describe, it, expect } from 'vitest';
import type { IssueOutcomeCount, OutcomeType, OutcomeTypeBreakdown } from '../../shared/types/the-issue.js';

describe('event-typed outcome breakdown (P1a)', () => {
  it('OutcomeType admits the website-native high-intent action types', () => {
    const types: OutcomeType[] = ['form_fill', 'call', 'booking', 'email', 'directions', 'chat', 'other'];
    expect(types).toContain('form_fill');
    expect(types).toContain('call');
  });
  it('each unit carries an optional outcomeType discriminator + a byType rollup', () => {
    const breakdown: OutcomeTypeBreakdown = {
      outcomeType: 'form_fill', label: 'Form fills', current: 23, baseline: 9, priorPeriod: 18,
    };
    const c: IssueOutcomeCount = {
      units: [{ label: 'Form fills', current: 23, baseline: 9, priorPeriod: 18, eventName: 'form_submit', outcomeType: 'form_fill' }],
      byType: [breakdown],
      provenance: 'measured_action',
      namedRecordsAvailable: true,
    };
    expect(c.units[0].outcomeType).toBe('form_fill');
    expect(c.byType[0].current).toBe(23);
  });
});
