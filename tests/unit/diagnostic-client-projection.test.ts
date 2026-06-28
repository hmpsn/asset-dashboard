import { describe, expect, it } from 'vitest';
import { projectClientDiagnosticReport } from '../../server/diagnostic-client-projection.js';
import type { DiagnosticReport } from '../../shared/types/diagnostics.js';

function report(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    id: 'diag-1',
    workspaceId: 'ws-1',
    insightId: 'insight-1',
    anomalyType: 'traffic_drop',
    affectedPages: ['/pricing'],
    status: 'completed',
    diagnosticContext: {} as DiagnosticReport['diagnosticContext'],
    rootCauses: [
      { rank: 2, title: 'Internal links declined', confidence: 'medium', explanation: 'Admin detail', evidence: ['secret evidence'] },
      { rank: 1, title: 'Ranking loss', confidence: 'high', explanation: 'Admin detail', evidence: ['raw query evidence'] },
    ],
    remediationActions: [
      { priority: 'P1', title: 'Refresh page copy', description: 'Admin detail', effort: 'medium', impact: 'high', owner: 'content', pageUrls: ['/pricing'] },
    ],
    adminReport: 'Admin-only markdown with raw analysis',
    clientSummary: 'Traffic dropped because the pricing page lost visibility.',
    errorMessage: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

describe('diagnostic client projection', () => {
  it('returns only client-safe fields for completed reports', () => {
    const projected = projectClientDiagnosticReport(report());

    expect(projected).toMatchObject({
      id: 'diag-1',
      insightId: 'insight-1',
      anomalyType: 'traffic_drop',
      affectedPages: ['/pricing'],
      clientSummary: 'Traffic dropped because the pricing page lost visibility.',
      rootCauses: [
        { rank: 1, title: 'Ranking loss', confidence: 'high' },
        { rank: 2, title: 'Internal links declined', confidence: 'medium' },
      ],
      remediationActions: [{ priority: 'P1', title: 'Refresh page copy' }],
      completedAt: '2026-06-01T01:00:00.000Z',
    });
    expect(projected).not.toHaveProperty('adminReport');
    expect(projected).not.toHaveProperty('diagnosticContext');
    expect(projected).not.toHaveProperty('errorMessage');
    expect(projected?.rootCauses[0]).not.toHaveProperty('evidence');
    expect(projected?.rootCauses[0]).not.toHaveProperty('explanation');
  });

  it('does not project incomplete, failed, or empty-summary reports', () => {
    expect(projectClientDiagnosticReport(report({ status: 'running', completedAt: null }))).toBeNull();
    expect(projectClientDiagnosticReport(report({ status: 'failed', errorMessage: 'Provider failed' }))).toBeNull();
    expect(projectClientDiagnosticReport(report({ clientSummary: '   ' }))).toBeNull();
  });

  it('falls back for provider or internal wording in projected titles', () => {
    const projected = projectClientDiagnosticReport(report({
      rootCauses: [
        { rank: 1, title: 'DataForSEO backlink source unavailable', confidence: 'high', explanation: 'Admin detail', evidence: ['secret evidence'] },
        { rank: 2, title: 'GSC probe failed for landing page', confidence: 'medium', explanation: 'Admin detail', evidence: ['raw query evidence'] },
      ],
      remediationActions: [
        { priority: 'P1', title: 'Retry provider API crawl', description: 'Admin detail', effort: 'medium', impact: 'high', owner: 'seo' },
      ],
    }));

    expect(projected?.rootCauses).toEqual([
      { rank: 1, title: 'Visibility signal changed', confidence: 'high' },
      { rank: 2, title: 'Visibility signal changed', confidence: 'medium' },
    ]);
    expect(projected?.remediationActions).toEqual([
      { priority: 'P1', title: 'Review the affected page' },
    ]);
  });
});
