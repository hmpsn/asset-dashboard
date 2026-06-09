import type { PromptVerbosity, SiteHealthSlice } from '../../shared/types/intelligence.js';
import { pct } from './formatter-shared.js';

export function formatSiteHealthSection(
  health: SiteHealthSlice,
  verbosity: PromptVerbosity,
): string {
  const lines: string[] = ['## Site Health'];

  lines.push(`Audit score: ${health.auditScore ?? 'n/a'}${health.auditScoreDelta != null ? ` (${health.auditScoreDelta >= 0 ? '+' : ''}${health.auditScoreDelta})` : ''}`);
  if (health.anomalyCount != null && health.anomalyCount > 0) {
    lines.push(`Critical issues: ${health.anomalyCount} anomalies`);
  }

  if (verbosity !== 'compact') {
    if (health.performanceSummary?.score != null) {
      lines.push(`Performance: ${health.performanceSummary.score}/100`);
    }
    lines.push(`Links: ${health.deadLinks} dead, ${health.redirectChains} redirect chains, ${health.orphanPages} orphan pages`);
    if (health.anomalyTypes && health.anomalyTypes.length > 0) {
      lines.push(`Anomaly types: ${health.anomalyTypes.join(', ')}`);
    }
    if (health.aeoReadiness) {
      lines.push(
        `AEO readiness: ${health.aeoReadiness.pagesChecked} pages checked, ${pct(health.aeoReadiness.passingRate)} passing`
      );
    }
    if (health.weeklyMetricsTrend) {
      const t = health.weeklyMetricsTrend;
      const w = t.latestWeek;
      const parts: string[] = [];
      if (w.totalClicks != null) parts.push(`${w.totalClicks} clicks`);
      if (w.auditScore != null) parts.push(`audit ${w.auditScore}`);
      if (w.organicTrafficValue != null) parts.push(`$${Math.round(w.organicTrafficValue)} traffic value`);
      if (parts.length > 0) {
        lines.push(`Latest week (${w.snapshotDate}): ${parts.join(', ')} — based on ${t.snapshotCount} snapshot${t.snapshotCount === 1 ? '' : 's'}`);
      }
    }
  }

  if (verbosity === 'detailed') {
    if (health.recentDiagnostics && health.recentDiagnostics.length > 0) {
      const diagLines = health.recentDiagnostics.map(d => {
        const pages = d.affectedPages.length > 0 ? ` on ${d.affectedPages.join(', ')}` : '';
        const causes = d.rootCauseTitles && d.rootCauseTitles.length > 0
          ? ` → ${d.rootCauseTitles.join('; ')}`
          : '';
        return `  ${d.anomalyType} [${d.status}]${pages}${causes}`;
      });
      lines.push(`Recent diagnostics:\n${diagLines.join('\n')}`);
    }
    if (health.schemaErrors > 0) lines.push(`Schema errors: ${health.schemaErrors}`);
    if (health.seoChangeVelocity != null) lines.push(`SEO change velocity: ${health.seoChangeVelocity} changes (30d)`);
    if (health.cwvPassRate.mobile != null) lines.push(`CWV pass rate: mobile ${pct(health.cwvPassRate.mobile)}, desktop ${health.cwvPassRate.desktop != null ? pct(health.cwvPassRate.desktop) : 'n/a'}`);
    if (health.schemaValidation) {
      lines.push(`Schema validation: ${health.schemaValidation.valid} valid, ${health.schemaValidation.warnings} warnings, ${health.schemaValidation.errors} errors`);
    }
    if (health.performanceSummary) {
      const perfParts: string[] = [];
      if (health.performanceSummary.avgLcp != null) perfParts.push(`LCP: ${(health.performanceSummary.avgLcp / 1000).toFixed(1)}s`);
      const interactionMs = health.performanceSummary.avgInp ?? health.performanceSummary.avgFid;
      if (interactionMs != null) perfParts.push(`INP: ${Math.round(interactionMs)}ms`);
      if (health.performanceSummary.avgCls != null) perfParts.push(`CLS: ${health.performanceSummary.avgCls.toFixed(2)}`);
      if (perfParts.length > 0) lines.push(`Core Web Vitals: ${perfParts.join(', ')}`);
    }
    if (health.redirectDetails && health.redirectDetails.length > 0) {
      lines.push('Redirect chain details:');
      for (const rd of health.redirectDetails.slice(0, 5)) {
        lines.push(`  - ${rd.url} → ${rd.target} (${rd.chainDepth} hops, status ${rd.status})`);
      }
    }
  }

  return lines.join('\n');
}
