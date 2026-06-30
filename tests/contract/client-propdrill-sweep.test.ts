import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf-8'); // readFile-ok - source contract guards client prop-drilling simplification boundaries.
}

describe('client prop-drilling sweep contract', () => {
  it('keeps client routes on the shared toast provider instead of local dashboard toast state', () => {
    const app = readSource('src/App.tsx');
    const dashboard = readSource('src/components/ClientDashboard.tsx');

    expect(app).toMatch(/function ClientRouteShell[\s\S]*<ToastProvider durationMs=\{5000\} placement="bottom-center" mode="single" variant="client">[\s\S]*<ClientRoutes betaMode=\{betaMode\}/);
    expect(dashboard).toContain("import { useToast } from './Toast';");
    expect(dashboard).not.toContain("from '../hooks/useToast'");
    expect(dashboard).not.toContain('clearToast');
    expect(dashboard).not.toContain('Toast notification');
  });

  it('passes GA4 analytics to client tabs as a single hook result object', () => {
    const dashboard = readSource('src/components/ClientDashboard.tsx');
    const overview = readSource('src/components/client/OverviewTab.tsx');
    const performance = readSource('src/components/client/PerformanceTab.tsx');

    expect(dashboard).toContain('ga4Data={ga4Data}');
    expect(dashboard).not.toContain('ga4Overview={ga4Overview}');
    expect(dashboard).not.toContain('ga4Trend={ga4Trend}');
    expect(dashboard).not.toContain('ga4DataUpdatedAt={ga4DataUpdatedAt}');
    expect(overview).toContain('ga4Data?: ClientGA4Data');
    expect(performance).toContain('ga4Data: ClientGA4Data');
  });

  it('keeps content pricing in client pricing context instead of dashboard tab props', () => {
    const dashboard = readSource('src/components/ClientDashboard.tsx');
    const pricingContext = readSource('src/components/client/ClientPricingContext.tsx');
    const strategy = readSource('src/components/client/StrategyTab.tsx');
    const inbox = readSource('src/components/client/InboxTab.tsx');
    const plans = readSource('src/components/client/PlansTab.tsx');
    const content = readSource('src/components/client/ContentTab.tsx');

    expect(dashboard).toContain('<ClientPricingProvider value={pricingContextValue}>');
    expect(dashboard).not.toMatch(/\b(?:StrategyTab|InboxTab|PlansTab)\b[^>]*(?:briefPrice|fullPostPrice|fmtPrice|pricingConfirming)=/);
    expect(pricingContext).toContain('useClientPricing');
    expect(pricingContext).toContain("throw new Error('useClientPricing must be used within ClientPricingProvider')");
    expect(strategy).not.toContain('briefPrice: number | null');
    expect(inbox).not.toContain('briefPrice: number | null');
    expect(plans).not.toContain('briefPrice: number | null');
    expect(content).not.toContain('briefPrice: number | null');
  });

  it('uses shared score-color helpers for score-like coverage displays', () => {
    const siteArchitecture = readSource('src/components/SiteArchitecture.tsx');
    const topicClusters = readSource('src/components/strategy/TopicClusters.tsx');

    // scoreColor must be imported from ./ui/constants (may be grouped with other
    // constants imports, e.g. CHART_SERIES_COLORS — match by membership, not exact string).
    expect(siteArchitecture).toMatch(/import \{[^}]*\bscoreColor\b[^}]*\} from '\.\/ui\/constants';/);
    expect(siteArchitecture).toContain('iconColor={scoreColor(coverage.coveragePct)}');
    expect(topicClusters).toContain('scoreColorClass');
    expect(topicClusters).toContain('scoreBgClass');
    expect(topicClusters).toContain('scoreBgBarClass');
    expect(topicClusters).not.toMatch(/coveragePercent\s*>=\s*(?:70|40)/);
  });
});
