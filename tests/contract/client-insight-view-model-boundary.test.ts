import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('client insight view-model boundary', () => {
  it('keeps client-intelligence route as an HTTP adapter over the view model', () => {
    const routeSrc = readFileSync('server/routes/client-intelligence.ts', 'utf-8'); // readFile-ok — source boundary contract for client insight projection ownership.

    expect(routeSrc).toContain("from '../client-insight-view-model.js'");
    expect(routeSrc).toContain('clientIntelligenceSlicesForTier(tier)');
    expect(routeSrc).toContain('buildClientIntelligenceView(intel, tier)');
    expect(routeSrc).not.toContain('function summarizeInsightsForClient');
    expect(routeSrc).not.toContain('function formatPipelineForClient');
    expect(routeSrc).not.toContain('ADMIN_ONLY_INSIGHT_TYPES');
    expect(routeSrc).not.toContain('insightsSummary:');
    expect(routeSrc).not.toContain('learningHighlights:');
    expect(routeSrc).not.toContain('keywordFeedbackSummary:');
    expect(routeSrc).not.toContain('siteHealthSummary:');
    expect(routeSrc).not.toContain('contentDecayAlerts:');
    expect(routeSrc).not.toContain('countsByTypeBySeverity');
  });

  it('documents public-boundary scrub and tier gating in the view model owner', () => {
    const viewModelSrc = readFileSync('server/client-insight-view-model.ts', 'utf-8'); // readFile-ok — source boundary contract for client-safe projection.

    expect(viewModelSrc).toContain('ADMIN_ONLY_INSIGHT_TYPES');
    expect(viewModelSrc).toContain("tier !== 'free'");
    expect(viewModelSrc).toContain("tier === 'premium'");
    expect(viewModelSrc).toContain('countsByTypeBySeverity');
    expect(viewModelSrc).not.toContain("from './monthly-digest.js'");
    expect(viewModelSrc).not.toContain("from './briefing-client-projection.js'");
    expect(viewModelSrc).not.toContain("from './analytics-insights-store.js'");
    expect(viewModelSrc).not.toContain("from './signal-story-registry.js'");
  });

  it('keeps public insight routes on the client view-model boundary', () => {
    const publicAnalyticsSrc = readFileSync('server/routes/public-analytics.ts', 'utf-8'); // readFile-ok — source boundary contract for client projection route ownership.

    expect(publicAnalyticsSrc).toContain("from '../client-insight-narrative-view-model.js'");
    expect(publicAnalyticsSrc).toContain("from '../client-insight-digest-view-model.js'");
    expect(publicAnalyticsSrc).toContain('buildClientNarrativeInsightsView(ws.id)');
    expect(publicAnalyticsSrc).toContain('buildClientMonthlyDigestView(ws)');
    expect(publicAnalyticsSrc).not.toContain("from '../insight-narrative.js'");
    expect(publicAnalyticsSrc).not.toContain("from '../monthly-digest.js'");
  });

  it('keeps briefing public projections behind the client view-model boundary', () => {
    const publicPortalSrc = readFileSync('server/routes/public-portal.ts', 'utf-8'); // readFile-ok — source boundary contract for public briefing projection.
    const briefingRouteSrc = readFileSync('server/routes/briefing.ts', 'utf-8'); // readFile-ok — source boundary contract for admin preview projection.

    for (const src of [publicPortalSrc, briefingRouteSrc]) {
      expect(src).toContain("from '../client-insight-briefing-view-model.js'");
      expect(src).toContain('buildClientBriefingView(ws.id)');
      expect(src).not.toContain("from '../briefing-client-projection.js'");
      expect(src).not.toContain('buildBriefingClientView(ws.id)');
    }
  });

  it('keeps the old narrative module as a compatibility re-export only', () => {
    const narrativeSrc = readFileSync('server/insight-narrative.ts', 'utf-8'); // readFile-ok — source boundary contract for compatibility shim.

    expect(narrativeSrc).toContain('buildClientNarrativeInsightsView as buildClientInsights');
    expect(narrativeSrc).toContain("from './client-insight-narrative-view-model.js'");
    expect(narrativeSrc).not.toContain('getInsights(');
    expect(narrativeSrc).not.toContain('buildClientInsightStory(');
  });
});
