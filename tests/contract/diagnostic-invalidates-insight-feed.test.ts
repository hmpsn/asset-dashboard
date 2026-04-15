import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

/**
 * Regression guard for the diagnostic:complete → insight feed invalidation bug.
 *
 * The dead `['admin-insights', wsId]` key silently missed the real feed cache
 * entry, so users saw stale insights after a diagnostic finished. This test
 * pins the correct factory prefix so any future rename stays wired correctly.
 */
describe('diagnostic completion invalidates the insight feed', () => {
  it('queryKeys.admin.insightFeed prefix is what the WS handler invalidates', () => {
    const ws = 'ws-1';
    expect(queryKeys.admin.insightFeed(ws)).toEqual(['admin-insight-feed', ws]);
  });

  it('diagnosticForInsightAll is a strict prefix of diagnosticForInsight', () => {
    const ws = 'ws-1';
    const insight = 'insight-1';
    expect(queryKeys.admin.diagnosticForInsight(ws, insight).slice(0, 2))
      .toEqual(queryKeys.admin.diagnosticForInsightAll(ws));
  });

  it('diagnostics list prefix is shared by diagnosticDetail so invalidating list clears details', () => {
    const ws = 'ws-1';
    const report = 'rpt-1';
    expect(queryKeys.admin.diagnosticDetail(ws, report).slice(0, 2))
      .toEqual(queryKeys.admin.diagnostics(ws));
  });
});
