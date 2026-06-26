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
  });
});
