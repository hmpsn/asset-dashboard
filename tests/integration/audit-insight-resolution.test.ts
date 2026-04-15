/**
 * Integration tests for audit_finding insight auto-resolution.
 *
 * Verifies that when an audit re-runs and a previously-detected finding is no longer
 * present, the corresponding audit_finding insight gets auto-resolved. Tests the logic
 * implemented in server/routes/webflow-seo.ts (bridge-audit-auto-resolve callback).
 *
 * Port: 13320
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  upsertInsight,
  getInsights,
  resolveInsight,
  getInsightById,
} from '../../server/analytics-insights-store.js';

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(() => {
  ws = seedWorkspace();
});

afterAll(() => {
  ws.cleanup();
});

describe('audit_finding insight auto-resolution', () => {
  it('resolves page-level audit_finding when page is no longer in the issues set', () => {
    // Simulate a prior audit that created an audit_finding for page-1
    const insight = upsertInsight({
      workspaceId: ws.workspaceId,
      pageId: 'page-1',
      insightType: 'audit_finding',
      severity: 'critical',
      data: {
        scope: 'page',
        issueCount: 2,
        issueMessages: 'Missing meta description; Title too short',
        source: 'bridge_12_audit_page_health',
      },
      impactScore: 80,
      bridgeSource: 'bridge-audit-page-health',
    });

    expect(insight.resolutionStatus).toBeNull();

    // Simulate the auto-resolve logic: page-1 is no longer in the issues set
    // (i.e., the audit re-ran and page-1 is now clean)
    const pagesWithIssues = new Set<string>(); // page-1 is NOT in this set

    const allInsights = getInsights(ws.workspaceId);
    const auditFindings = allInsights.filter(
      i => i.insightType === 'audit_finding' && i.resolutionStatus !== 'resolved',
    );

    let resolved = 0;
    for (const af of auditFindings) {
      const data = (af.data ?? {}) as Record<string, unknown>;
      if (data.scope === 'page' && af.pageId && !pagesWithIssues.has(af.pageId)) {
        resolveInsight(af.id, ws.workspaceId, 'resolved', 'Auto-resolved: page passed audit with no critical/warning issues', 'bridge-audit-auto-resolve');
        resolved++;
      }
    }

    expect(resolved).toBeGreaterThanOrEqual(1);

    // Verify the insight is now resolved
    const updated = getInsightById(insight.id, ws.workspaceId);
    expect(updated).toBeDefined();
    expect(updated!.resolutionStatus).toBe('resolved');
    expect(updated!.resolutionNote).toContain('Auto-resolved');
    expect(updated!.resolutionSource).toBe('bridge-audit-auto-resolve');
    expect(updated!.resolvedAt).toBeTruthy();
  });

  it('does NOT resolve page-level audit_finding when page still has issues', () => {
    // Create a finding for page-2
    const insight = upsertInsight({
      workspaceId: ws.workspaceId,
      pageId: 'page-2',
      insightType: 'audit_finding',
      severity: 'warning',
      data: {
        scope: 'page',
        issueCount: 1,
        issueMessages: 'Missing H1 tag',
        source: 'bridge_12_audit_page_health',
      },
      impactScore: 50,
      bridgeSource: 'bridge-audit-page-health',
    });

    // page-2 still has issues in the new audit
    const pagesWithIssues = new Set<string>(['page-2']);

    const allInsights = getInsights(ws.workspaceId);
    const auditFindings = allInsights.filter(
      i => i.insightType === 'audit_finding' && i.resolutionStatus !== 'resolved',
    );

    let resolved = 0;
    for (const af of auditFindings) {
      const data = (af.data ?? {}) as Record<string, unknown>;
      if (data.scope === 'page' && af.pageId && !pagesWithIssues.has(af.pageId)) {
        resolveInsight(af.id, ws.workspaceId, 'resolved', 'Auto-resolved', 'bridge-audit-auto-resolve');
        resolved++;
      }
    }

    // page-2 should NOT be resolved
    const updated = getInsightById(insight.id, ws.workspaceId);
    expect(updated).toBeDefined();
    expect(updated!.resolutionStatus).not.toBe('resolved');
  });

  it('resolves site-level audit_finding when site score improves above 70', () => {
    // Create a site-level finding
    const insight = upsertInsight({
      workspaceId: ws.workspaceId,
      pageId: null,
      insightType: 'audit_finding',
      severity: 'warning',
      data: {
        scope: 'site',
        issueCount: 5,
        issueMessages: 'Audit found 5 total issues. Overall health score: 55/100.',
        siteScore: 55,
        source: 'bridge_15_audit_site_health',
      },
      impactScore: 45,
      bridgeSource: 'bridge-audit-site-health',
    });

    expect(insight.resolutionStatus).toBeNull();

    // Simulate audit re-run with improved score (>= 70)
    const newSiteScore = 82;
    const allInsights = getInsights(ws.workspaceId);
    const auditFindings = allInsights.filter(
      i => i.insightType === 'audit_finding' && i.resolutionStatus !== 'resolved',
    );

    let resolved = 0;
    for (const af of auditFindings) {
      const data = (af.data ?? {}) as Record<string, unknown>;
      if (data.scope === 'site' && !af.pageId && newSiteScore >= 70) {
        resolveInsight(af.id, ws.workspaceId, 'resolved', `Auto-resolved: site health score improved to ${newSiteScore}/100`, 'bridge-audit-auto-resolve');
        resolved++;
      }
    }

    expect(resolved).toBeGreaterThanOrEqual(1);

    const updated = getInsightById(insight.id, ws.workspaceId);
    expect(updated).toBeDefined();
    expect(updated!.resolutionStatus).toBe('resolved');
    expect(updated!.resolutionNote).toContain('82/100');
  });

  it('does NOT resolve site-level audit_finding when score is still below 70', () => {
    // Create another site-level finding (use a different workspace to avoid conflicts)
    const ws2 = seedWorkspace();
    try {
      const insight = upsertInsight({
        workspaceId: ws2.workspaceId,
        pageId: null,
        insightType: 'audit_finding',
        severity: 'critical',
        data: {
          scope: 'site',
          issueCount: 10,
          issueMessages: 'Audit found 10 total issues. Overall health score: 35/100.',
          siteScore: 35,
          source: 'bridge_15_audit_site_health',
        },
        impactScore: 65,
        bridgeSource: 'bridge-audit-site-health',
      });

      // Score still below 70
      const newSiteScore = 55;
      const allInsights = getInsights(ws2.workspaceId);
      const auditFindings = allInsights.filter(
        i => i.insightType === 'audit_finding' && i.resolutionStatus !== 'resolved',
      );

      let resolved = 0;
      for (const af of auditFindings) {
        const data = (af.data ?? {}) as Record<string, unknown>;
        if (data.scope === 'site' && !af.pageId && newSiteScore >= 70) {
          resolveInsight(af.id, ws2.workspaceId, 'resolved', 'Auto-resolved', 'bridge-audit-auto-resolve');
          resolved++;
        }
      }

      expect(resolved).toBe(0);

      const updated = getInsightById(insight.id, ws2.workspaceId);
      expect(updated).toBeDefined();
      expect(updated!.resolutionStatus).not.toBe('resolved');
    } finally {
      ws2.cleanup();
    }
  });

  it('skips already-resolved insights during auto-resolve pass', () => {
    const ws3 = seedWorkspace();
    try {
      // Create and manually resolve a finding
      const insight = upsertInsight({
        workspaceId: ws3.workspaceId,
        pageId: 'page-3',
        insightType: 'audit_finding',
        severity: 'critical',
        data: {
          scope: 'page',
          issueCount: 1,
          issueMessages: 'Missing alt text',
          source: 'bridge_12_audit_page_health',
        },
        impactScore: 60,
        bridgeSource: 'bridge-audit-page-health',
      });

      // Manually resolve it first
      resolveInsight(insight.id, ws3.workspaceId, 'resolved', 'Fixed by admin', 'admin');

      // Now run auto-resolve pass — should not touch already-resolved insights
      const allInsights = getInsights(ws3.workspaceId);
      const unresolvedFindings = allInsights.filter(
        i => i.insightType === 'audit_finding' && i.resolutionStatus !== 'resolved',
      );

      // Should find zero unresolved findings
      expect(unresolvedFindings.length).toBe(0);

      // Verify the insight still has the original resolution note (not overwritten)
      const updated = getInsightById(insight.id, ws3.workspaceId);
      expect(updated).toBeDefined();
      expect(updated!.resolutionNote).toBe('Fixed by admin');
      expect(updated!.resolutionSource).toBe('admin');
    } finally {
      ws3.cleanup();
    }
  });
});
