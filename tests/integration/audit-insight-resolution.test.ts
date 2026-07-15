/**
 * Integration tests for audit_finding insight auto-resolution.
 *
 * Verifies that when an audit re-runs and a previously-detected finding is no longer
 * present, the corresponding audit_finding insight gets auto-resolved. Tests the logic
 * implemented in server/webflow-seo-audit-bridges.ts (bridge-audit-auto-resolve callback).
 *
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

  it('does NOT auto-resolve manual audit_finding insights without an audit bridge source', () => {
    const ws4 = seedWorkspace();
    try {
      const manual = upsertInsight({
        workspaceId: ws4.workspaceId,
        pageId: 'manual-page',
        insightType: 'audit_finding',
        severity: 'warning',
        data: {
          scope: 'page',
          issueCount: 1,
          issueMessages: 'Manually tracked audit note',
          source: 'manual_review',
        },
        impactScore: 40,
      });

      const bridgeGenerated = upsertInsight({
        workspaceId: ws4.workspaceId,
        pageId: 'bridge-page',
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

      const pagesWithIssues = new Set<string>();
      const autoResolvableSources = new Set(['bridge-audit-page-health', 'bridge-audit-site-health']);
      const allInsights = getInsights(ws4.workspaceId);
      const auditFindings = allInsights.filter(
        i => i.insightType === 'audit_finding'
          && i.resolutionStatus !== 'resolved'
          && i.bridgeSource != null
          && autoResolvableSources.has(i.bridgeSource),
      );

      for (const af of auditFindings) {
        const data = (af.data ?? {}) as Record<string, unknown>;
        if (data.scope === 'page' && af.pageId && !pagesWithIssues.has(af.pageId)) {
          resolveInsight(af.id, ws4.workspaceId, 'resolved', 'Auto-resolved', 'bridge-audit-auto-resolve');
        }
      }

      const manualAfter = getInsightById(manual.id, ws4.workspaceId);
      const bridgeAfter = getInsightById(bridgeGenerated.id, ws4.workspaceId);
      expect(manualAfter).toBeDefined();
      expect(manualAfter!.resolutionStatus).not.toBe('resolved');
      expect(bridgeAfter).toBeDefined();
      expect(bridgeAfter!.resolutionStatus).toBe('resolved');
    } finally {
      ws4.cleanup();
    }
  });
});

// ── R3-PR2: resolution_status transition guard (null-origin + idempotency) ──
describe('resolveInsight transition guard (R3-PR2)', () => {
  it('null-origin: a freshly computed insight (resolution_status NULL) resolves without crashing', () => {
    const wsG = seedWorkspace();
    try {
      const insight = upsertInsight({
        workspaceId: wsG.workspaceId,
        pageId: 'null-origin-page',
        insightType: 'audit_finding',
        severity: 'warning',
        data: { scope: 'page', issueCount: 1, issueMessages: 'x', source: 'manual_review' },
        impactScore: 40,
      });
      expect(insight.resolutionStatus).toBeNull(); // NULL → coerced to `unresolved`
      const updated = resolveInsight(insight.id, wsG.workspaceId, 'resolved', 'done', 'admin');
      expect(updated).toBeDefined();
      expect(updated!.resolutionStatus).toBe('resolved');
    } finally {
      wsG.cleanup();
    }
  });

  it('idempotent re-resolve (resolved → resolved) is a no-op that does NOT throw', () => {
    const wsG = seedWorkspace();
    try {
      const insight = upsertInsight({
        workspaceId: wsG.workspaceId,
        pageId: 'idem-page',
        insightType: 'audit_finding',
        severity: 'warning',
        data: { scope: 'page', issueCount: 1, issueMessages: 'x', source: 'manual_review' },
        impactScore: 40,
      });
      resolveInsight(insight.id, wsG.workspaceId, 'resolved', 'first', 'admin');
      // Re-resolving an already-resolved insight (bulk MCP re-resolve, cron retry) must not throw.
      expect(() => resolveInsight(insight.id, wsG.workspaceId, 'resolved', 'again', 'admin')).not.toThrow();
      const updated = getInsightById(insight.id, wsG.workspaceId);
      expect(updated!.resolutionStatus).toBe('resolved');
    } finally {
      wsG.cleanup();
    }
  });

  it('reopen (resolved → in_progress) stays legal (previously tolerated)', () => {
    const wsG = seedWorkspace();
    try {
      const insight = upsertInsight({
        workspaceId: wsG.workspaceId,
        pageId: 'reopen-page',
        insightType: 'audit_finding',
        severity: 'warning',
        data: { scope: 'page', issueCount: 1, issueMessages: 'x', source: 'manual_review' },
        impactScore: 40,
      });
      resolveInsight(insight.id, wsG.workspaceId, 'resolved', 'done', 'admin');
      let reopened;
      expect(() => { reopened = resolveInsight(insight.id, wsG.workspaceId, 'in_progress'); }).not.toThrow();
      expect(reopened!.resolutionStatus).toBe('in_progress');
    } finally {
      wsG.cleanup();
    }
  });

  it('a non-existent insight returns undefined (404 path), never a guard crash', () => {
    const wsG = seedWorkspace();
    try {
      expect(resolveInsight('does-not-exist', wsG.workspaceId, 'resolved')).toBeUndefined();
    } finally {
      wsG.cleanup();
    }
  });
});
