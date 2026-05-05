import type * as AnalyticsInsightsStore from './analytics-insights-store.js';
import { fireBridge } from './bridge-infrastructure.js';
import { applySuppressionsToAudit, toAuditFindingPageId } from './helpers.js';
import { createLogger } from './logger.js';
import type { SeoAuditResult } from './seo-audit.js';
import { updatePageState, type Workspace } from './workspaces.js';

const log = createLogger('webflow-seo-audit-bridges');

export function handleOnDemandSeoAuditResult(workspace: Workspace, audit: SeoAuditResult): void {
  for (const page of audit.pages) {
    if (page.issues.length > 0) {
      updatePageState(workspace.id, page.pageId, {
        status: 'issue-detected',
        source: 'audit',
        slug: page.slug,
        auditIssues: page.issues.map((i: { check: string }) => i.check),
        updatedBy: 'system',
      });
    }
  }

  const effectiveAudit = workspace.auditSuppressions?.length
    ? applySuppressionsToAudit(audit, workspace.auditSuppressions)
    : audit;

  // Resolve stale audit insights when an on-demand audit shows that a page or
  // site has recovered. This mirrors the scheduled-audit auto-resolve bridge.
  fireBridge('bridge-audit-auto-resolve', workspace.id, async () => {
    const { getInsights: fetchAll, resolveInsight: resolve }: typeof AnalyticsInsightsStore = await import('./analytics-insights-store.js'); // dynamic-import-ok
    const autoResolvableSources = new Set(['bridge-audit-page-health', 'bridge-audit-site-health']);
    const allInsights = fetchAll(workspace.id);
    const auditFindings = allInsights.filter(
      i => i.insightType === 'audit_finding'
        && i.resolutionStatus !== 'resolved'
        && i.bridgeSource != null
        && autoResolvableSources.has(i.bridgeSource),
    );
    if (auditFindings.length === 0) return { modified: 0 };

    const pagesWithIssues = new Set<string>();
    for (const page of effectiveAudit.pages) {
      if (page.issues?.some((i: { severity: string }) => i.severity === 'error' || i.severity === 'warning')) {
        pagesWithIssues.add(toAuditFindingPageId(page));
      }
    }

    let resolved = 0;
    for (const insight of auditFindings) {
      const data = (insight.data ?? {}) as Record<string, unknown>;
      if (data.scope === 'page' && insight.pageId && !pagesWithIssues.has(insight.pageId)) {
        resolve(insight.id, workspace.id, 'resolved', 'Auto-resolved: page passed audit with no critical/warning issues', 'bridge-audit-auto-resolve');
        resolved++;
      } else if (data.scope === 'site' && !insight.pageId && effectiveAudit.siteScore >= 70) {
        resolve(insight.id, workspace.id, 'resolved', `Auto-resolved: site health score improved to ${effectiveAudit.siteScore}/100`, 'bridge-audit-auto-resolve');
        resolved++;
      }
    }
    if (resolved > 0) {
      log.info({ workspaceId: workspace.id, resolved }, 'Auto-resolved audit_finding insights for clean pages/site (on-demand audit)');
    }
    return { modified: resolved };
  });

  // Bridge on-demand audit findings into page-scoped audit_finding insights.
  fireBridge('bridge-audit-page-health', workspace.id, async () => {
    const { upsertInsight: upsert, getInsight }: typeof AnalyticsInsightsStore = await import('./analytics-insights-store.js'); // dynamic-import-ok

    const criticalPages = effectiveAudit.pages
      .filter((p: { issues?: Array<{ severity: string }> }) => p.issues?.some(i => i.severity === 'error' || i.severity === 'warning'));

    let modified = 0;
    for (const page of criticalPages.slice(0, 20)) {
      const pageIssues = page.issues?.filter((i: { severity: string }) => i.severity === 'error' || i.severity === 'warning') ?? [];
      if (pageIssues.length === 0) continue;

      const isCritical = pageIssues.some((i: { severity: string }) => i.severity === 'error');
      const baseScore = isCritical ? 80 : 50;

      // Base-score setter pattern: this bridge owns the raw audit-derived base score.
      // Carry forward score adjustments written by other bridges while rebasing the
      // underlying audit score on each run.
      const existing = getInsight(workspace.id, toAuditFindingPageId(page), 'audit_finding');
      if (existing && existing.resolutionStatus !== 'resolved' &&
          existing.data?.issueCount === pageIssues.length &&
          existing.data?.issueMessages === pageIssues.map((i: { message: string }) => i.message).join('; ')) {
        continue;
      }
      const prevAdj = existing?.data?._scoreAdjustments as Record<string, number> | undefined;
      const totalDelta = prevAdj
        ? Object.values(prevAdj).reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0)
        : 0;

      upsert({
        workspaceId: workspace.id,
        insightType: 'audit_finding',
        pageId: toAuditFindingPageId(page),
        pageTitle: page.page,
        severity: isCritical ? 'critical' : 'warning',
        data: {
          scope: 'page',
          issueCount: pageIssues.length,
          issueMessages: pageIssues.map((i: { message: string }) => i.message).join('; '),
          source: 'bridge_12_audit_page_health',
          ...(prevAdj ? { _originalBaseScore: baseScore, _scoreAdjustments: prevAdj } : {}),
        },
        impactScore: prevAdj ? Math.max(0, Math.min(100, baseScore + totalDelta)) : baseScore,
        bridgeSource: 'bridge-audit-page-health',
      });
      modified++;
    }

    return { modified };
  });

  // Bridge aggregate audit health into a site-level audit_finding insight.
  fireBridge('bridge-audit-site-health', workspace.id, async () => {
    const { upsertInsight: upsert }: typeof AnalyticsInsightsStore = await import('./analytics-insights-store.js'); // dynamic-import-ok
    const totalIssues = effectiveAudit.errors + effectiveAudit.warnings;
    const score = effectiveAudit.siteScore;
    if (totalIssues > 0 && score < 70) {
      upsert({
        workspaceId: workspace.id,
        insightType: 'audit_finding',
        pageId: null,
        severity: score < 50 ? 'critical' : 'warning',
        data: {
          scope: 'site',
          issueCount: totalIssues,
          issueMessages: `Audit found ${totalIssues} total issues across the site. Overall health score: ${score}/100.`,
          siteScore: score,
          source: 'bridge_15_audit_site_health',
        },
        impactScore: Math.max(0, 100 - score),
        bridgeSource: 'bridge-audit-site-health',
      });
      return { modified: 1 };
    }
    return { modified: 0 };
  });
}
