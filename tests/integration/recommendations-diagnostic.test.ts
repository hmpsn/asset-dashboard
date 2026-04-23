/**
 * Integration tests for diagnostic remediation → auto-created recommendations.
 * Calls generateRecommendations() in-process with vi.mock to inject
 * a completed diagnostic report, verifying the resulting recommendation shape.
 */

// ── Module-level mocks (hoisted by Vitest) ───────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: (_wsId: string, _type?: string) => [],
}));

vi.mock('../../server/diagnostic-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/diagnostic-store.js')>();
  return {
    ...actual,
    listDiagnosticReports: () => [{
      id: 'report_abc123',
      workspaceId: 'ws_test',
      insightId: null,
      anomalyType: 'traffic_drop',
      affectedPages: ['/services/plumbing'],
      status: 'completed',
      diagnosticContext: {} as import('../../shared/types/diagnostics.js').DiagnosticContext,
      rootCauses: [],
      remediationActions: [
        {
          priority: 'P1' as const,
          title: 'Fix broken internal links',
          description: 'Three pages have broken internal links reducing crawl efficiency.',
          effort: 'low' as const,
          impact: 'high' as const,
          owner: 'dev' as const,
          pageUrls: ['/services/plumbing'],
        },
      ],
      adminReport: '',
      clientSummary: '',
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }],
  };
});

// ── Imports (after mock declarations) ────────────────────────────────────────
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { generateRecommendations } from '../../server/recommendations.js';

describe('generateRecommendations — diagnostic remediation', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const s = seedWorkspace({});
    wsId = s.workspaceId;
    cleanup = s.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('creates a fix_now rec from a completed diagnostic P1 action', async () => {
    const set = await generateRecommendations(wsId);
    const diagRec = set.recommendations.find(r => r.source?.startsWith('diagnostic:'));
    expect(diagRec).toBeDefined();
    expect(diagRec?.priority).toBe('fix_now');
    expect(diagRec?.title).toContain('Diagnostic: Fix broken internal links');
    expect(diagRec?.type).toBe('technical');
  });
});
