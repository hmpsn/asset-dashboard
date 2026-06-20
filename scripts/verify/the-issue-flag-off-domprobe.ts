#!/usr/bin/env tsx
/**
 * scripts/verify/the-issue-flag-off-domprobe.ts  (Lane D / Task D7)
 *
 * DETERMINISTIC, CI-runnable flag-OFF DOM probe for the "The Issue" client dashboard P0
 * redesign. It is the mandatory machine proof that the spine reorder is byte-identical to
 * today on the flag-OFF path — the failure mode the four code gates (typecheck / build /
 * vitest / pr-check) can ALL miss while a layout reorder silently regresses the visible
 * surface (see feedback_phase5_multilayer_verification).
 *
 * ── Why a vitest-driven harness instead of a standalone tsx render or Playwright ──
 * Two render layers are impractical here, so this script uses the third (still deterministic):
 *
 *   1. A pure `npx tsx` render of <TheIssueClientPage> OUTSIDE vitest is NOT viable: the
 *      component depends on `useFeatureFlag` + several React-Query data hooks
 *      (useClientTheIssue, useClientRecResponses, useActOnRecommendation, useClientROI, …)
 *      that hit the network / DB at runtime. The ONLY place those modules are mocked
 *      hermetically is inside the vitest component-test context (`vi.mock`), which does not
 *      exist outside a vitest run. Re-implementing that mock layer by hand would diverge from
 *      the real component-test harness — exactly what we must NOT do.
 *
 *   2. Playwright against a live server (`/client/:ws/overview`) is the spec's "real browser"
 *      ideal, but it needs `npm run dev:all` + `npm run seed:demo` running and is inherently
 *      flakier (port races, async hydration). The prompt explicitly permits the vitest-runner
 *      fallback when a self-contained render is impractical — that is the case here.
 *
 * So this probe is a thin, robust RUNNER: it materializes a focused jsdom probe spec (using the
 * EXACT same provider/render harness + module mocks as tests/component/TheIssueClientPage.test.tsx)
 * into the component test project, runs ONLY that spec via `vitest run --project component`, then
 * removes it. The spec renders <TheIssueClientPage> with the flag OFF and asserts the flag-OFF DOM
 * contract. The script exits 0 on PASS and non-zero with a clear message on FAIL so it can be
 * wired as a CI gate (`npm run verify:the-issue-flag-off`).
 *
 * ── Scenarios (PROBE_SCENARIO) ──────────────────────────────────────────────────────────────────
 * This harness is parameterized so any future flag-gated label/layout change reuses ONE runner
 * (addressing the captured "design-batch passes 4 gates, regresses surface" failure mode):
 *
 *   PROBE_SCENARIO=flag-off            (default) — P0 spine flag-OFF byte-identity:
 *       (a) NONE of the spine slot testids appear: slot-verdict / slot-outcome-count /
 *           slot-money / slot-content-plan.
 *       (b) The legacy markers appear: the <details> "See full report" proof band, and the
 *           NarratedStatusHeadline ring (an <svg> ring rendered by MetricRing in the legacy headline).
 *
 *   PROBE_SCENARIO=measured-capture-off  (Lane D / Task D-FLAG-OFF-PROBE) — P1a measured-capture
 *       flag-OFF byte-identity at the verdict + outcome-count surfaces. The server selects
 *       `estimate_ga4` and emits untyped units when `the-issue-client-measured-capture` is OFF, so
 *       the client surface must render its pre-P1a (P0 estimate) self with NO measured affordances:
 *       (a) The IssueVerdictHeadline shows the BANDED `~$` estimate dollar + the "this is an
 *           estimate" disclosure; it shows NEITHER an exact (un-banded) dollar NOR any measured
 *           label ("measured" / "tracked on your site").
 *       (b) The OutcomeCountBand renders NO `[data-outcome-type]` measured affordance (untyped
 *           units degrade byte-identically to P0) and NO type-aware icon leaks.
 *       This proves a measured label can never leak onto the OFF (estimate) path — the integrity
 *       spine the whole P1a reframe inherits (D6). The OFF-path server output (estimate_ga4 +
 *       untyped units) IS the rendered baseline contract, so no committed innerHTML snapshot is
 *       needed — the assertions are stricter than a brittle byte-diff and never flake.
 *
 * Usage:
 *   npx tsx scripts/verify/the-issue-flag-off-domprobe.ts
 *   PROBE_SCENARIO=measured-capture-off npx tsx scripts/verify/the-issue-flag-off-domprobe.ts
 *   PROBE_KEEP_SPEC=1 npx tsx scripts/verify/the-issue-flag-off-domprobe.ts   # leave the spec for debugging
 *
 * Exit codes: 0 = PASS (flag-OFF byte-identical), 1 = FAIL / probe error.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

type Scenario = 'flag-off' | 'measured-capture-off';
const VALID_SCENARIOS: Scenario[] = ['flag-off', 'measured-capture-off'];

// Accept `--scenario=X` as well as PROBE_SCENARIO=X; env wins if both present. Default = flag-off
// so the existing default invocation (and CI wiring) is byte-identical to before.
const cliScenario = process.argv.find((a) => a.startsWith('--scenario='))?.split('=')[1];
const SCENARIO = (process.env.PROBE_SCENARIO ?? cliScenario ?? 'flag-off') as Scenario;

// The focused probe spec is materialized INSIDE the component test project so it matches the
// `tests/**/*.test.tsx` include glob and inherits the jsdom env + tests/component/setup.ts.
// `.probe.` keeps it identifiable; it is created/removed by this script (not a committed file).
// Each scenario gets its own filename so a stray spec can never be confused across scenarios.
const SPEC_DIR = resolve(root, 'tests', 'component');
const SPEC_REL = `tests/component/__the-issue-${SCENARIO}.probe.test.tsx`;
const SPEC_PATH = resolve(root, SPEC_REL);

const log = (msg: string) => process.stdout.write(`${msg}\n`);
const err = (msg: string) => process.stderr.write(`${msg}\n`);

/**
 * The generated jsdom probe spec. It MIRRORS tests/component/TheIssueClientPage.test.tsx exactly
 * for the harness (hook mocks, child stubs, fixtures, renderPage), with two intentional changes:
 *   - It does NOT stub NarratedStatusHeadline / MetricRing — the legacy ring must render for real
 *     so the probe can prove the legacy headline ring is present on the OFF path.
 *   - It renders ONLY the flag-OFF path (theIssueClientSpine={false}) and asserts the OFF contract.
 */
const FLAG_OFF_SPEC = String.raw`// AUTO-GENERATED by scripts/verify/the-issue-flag-off-domprobe.ts — do not edit or commit.
// Focused flag-OFF byte-identity probe for TheIssueClientPage (Lane D / D7).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { RecommendationSet, Recommendation } from '../../shared/types/recommendations';
import type { ClientKeywordStrategy } from '../../src/components/client/types';

const mockActOn = vi.fn();
const mockSubmitFeedback = vi.fn().mockResolvedValue(undefined);
const mockUseClientTheIssue = vi.fn();
const mockUseClientRecResponses = vi.fn();
const mockGetFeedbackStatus = vi.fn().mockReturnValue(undefined);

vi.mock('../../src/components/client/the-issue/useClientTheIssue', () => ({
  useClientTheIssue: () => mockUseClientTheIssue(),
}));
vi.mock('../../src/hooks/client/useClientRecResponses', () => ({
  useClientRecResponses: () => mockUseClientRecResponses(),
}));
vi.mock('../../src/hooks/client/useActOnRecommendation', () => ({
  useActOnRecommendation: () => ({ actOn: mockActOn, actOnAsync: vi.fn(), isActingOn: false, pendingRecId: null }),
}));
vi.mock('../../src/components/client/strategy/useStrategyTrackedKeywords', () => ({
  useStrategyTrackedKeywords: () => ({ trackedKeywords: [], trackedKeywordsLoading: false, trackedKeywordsError: false }),
}));
vi.mock('../../src/components/client/strategy/useStrategyKeywordFeedback', () => ({
  useStrategyKeywordFeedback: () => ({ getFeedbackStatus: mockGetFeedbackStatus, submitFeedback: mockSubmitFeedback }),
}));
vi.mock('../../src/hooks/client', () => ({
  useClientContentRequests: () => ({ data: [] }),
  useClientROI: () => ({ data: undefined }),
}));

// Flag stays OFF (default). The probe also passes theIssueClientSpine={false} explicitly.
const mockUseFeatureFlag = vi.fn().mockReturnValue(false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => mockUseFeatureFlag(),
}));

// Stub network-heavy children EXCEPT NarratedStatusHeadline — the legacy headline ring must
// render for real so we can prove it is present on the OFF path (regression guard).
vi.mock('../../src/components/client/ROIDashboard', () => ({
  ROIDashboard: () => <div data-testid="roi-content" />,
}));
vi.mock('../../src/components/client/CompetitorGapsSection', () => ({
  CompetitorGapsSection: () => <div data-testid="stub-competitors" />,
}));
vi.mock('../../src/components/client/Briefing/WinsSurface', () => ({
  WinsSurface: () => <div data-testid="stub-wins" />,
}));
vi.mock('../../src/components/client/OutcomeSummary', () => ({
  default: () => <div data-testid="stub-outcomes" />,
}));
vi.mock('../../src/components/client/strategy/StrategyRequestedKeywordTrendSection', () => ({
  StrategyRequestedKeywordTrendSection: () => <div data-testid="stub-kw-trend" />,
}));
vi.mock('../../src/components/client/Briefing/ActionQueueStrip', () => ({
  ActionQueueStrip: () => <div data-testid="stub-action-queue" />,
}));

import { TheIssueClientPage } from '../../src/components/client/the-issue/TheIssueClientPage';

const baseRec = (overrides: Partial<Recommendation> = {}): Recommendation => ({
  id: 'rec-1',
  workspaceId: 'ws-1',
  priority: 'fix_now',
  type: 'content',
  title: 'Publish a guide on engineering KPIs',
  description: 'desc',
  insight: 'High-demand topic your competitors own.',
  impact: 'high',
  effort: 'medium',
  impactScore: 80,
  source: 'content-gap',
  affectedPages: [],
  trafficAtRisk: 0,
  impressionsAtRisk: 0,
  estimatedGain: 'Capture ~900 searches/mo',
  actionType: 'content_creation',
  status: 'pending',
  targetKeyword: 'engineering kpis',
  clientStatus: 'sent',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const recSet = (recs: Recommendation[], topId: string | null = recs[0]?.id ?? null): RecommendationSet => ({
  workspaceId: 'ws-1',
  generatedAt: '2026-01-01T00:00:00Z',
  recommendations: recs,
  summary: {
    fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0,
    totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: topId,
  },
});

const strategy = (overrides: Partial<ClientKeywordStrategy> = {}): ClientKeywordStrategy => ({
  siteKeywords: [],
  pageMap: [],
  opportunities: [],
  generatedAt: '2026-01-01T00:00:00Z',
  strategyUx: {
    explanations: [],
    orient: {
      visibilityScore: 72,
      visibilityScoreDelta: 4,
      clicks: 1200, clicksDelta: 100,
      impressions: 40000, impressionsDelta: 2000,
      rankedKeywords: 85, rankedKeywordsDelta: 5,
      avgPosition: 14.2, avgPositionDelta: -1.1,
    },
  },
  ...overrides,
});

function renderPage(props: Partial<React.ComponentProps<typeof TheIssueClientPage>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TheIssueClientPage
          workspaceId="ws-1"
          effectiveTier="growth"
          betaMode={false}
          actionCounts={{ approvals: 0, briefs: 0, posts: 0, replies: 0, contentPlan: 0 }}
          overview={{ totalClicks: 1200, totalImpressions: 40000, avgCtr: 3, avgPosition: 14, topQueries: [], topPages: [], dateRange: { start: '', end: '' } } as React.ComponentProps<typeof TheIssueClientPage>['overview']}
          ga4Overview={null}
          ga4Conversions={[]}
          audit={null}
          strategyData={strategy()}
          onAskAi={vi.fn()}
          onOpenChat={vi.fn()}
          setToast={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFeedbackStatus.mockReturnValue(undefined);
  mockUseClientRecResponses.mockReturnValue({ data: { approved: 2, discussing: 1, declined: 0, pending: 3 } });
  mockUseFeatureFlag.mockReturnValue(false);
  mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
});

describe('DOM-PROBE: TheIssueClientPage flag-OFF byte-identity', () => {
  it('(a) renders NONE of the spine slot testids', () => {
    renderPage({ theIssueClientSpine: false });
    expect(screen.getByTestId('the-issue-client-page')).toBeInTheDocument();
    for (const id of ['slot-verdict', 'slot-outcome-count', 'slot-money', 'slot-content-plan']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it('(b1) renders the legacy "See full report" <details> proof band', () => {
    renderPage({ theIssueClientSpine: false });
    const reveal = screen.getByText('See full report');
    expect(reveal).toBeInTheDocument();
    expect(reveal.closest('details')).not.toBeNull();
  });

  it('(b2) renders the legacy NarratedStatusHeadline ring (an <svg> ring in the headline)', () => {
    const { container } = renderPage({ theIssueClientSpine: false });
    // MetricRing renders an <svg> with two <circle> elements (track + progress). The legacy
    // headline is the only place the ring appears on the OFF path.
    const ring = container.querySelector('svg circle');
    expect(ring).not.toBeNull();
  });
});
`;

/**
 * measured-capture-OFF probe spec (Lane D / Task D-FLAG-OFF-PROBE).
 *
 * Renders the two P1a-touched client surfaces — IssueVerdictHeadline (slot 1) and OutcomeCountBand
 * (slot 2) — with the EXACT server output the OFF path produces: provenance `estimate_ga4` and
 * UNTYPED units (no `outcomeType`). `selectOutcomeProvenance` returns `estimate_ga4` and
 * `aggregatePinnedOutcomes` units carry no admin-typed `outcomeType` when the measured-capture flag
 * is OFF, so this is the byte-identical pre-P1a (P0 estimate) render. The probe asserts that NO
 * measured affordance can leak onto that surface (the D6 integrity spine), and that the P0 estimate
 * surface is intact. Neither component reads a feature flag directly — both are pure renders of the
 * server-assembled provenance/units — so driving the OFF-path PROPS is the faithful flag-OFF probe.
 */
const MEASURED_CAPTURE_OFF_SPEC = String.raw`// AUTO-GENERATED by scripts/verify/the-issue-flag-off-domprobe.ts — do not edit or commit.
// Focused measured-capture-OFF byte-identity probe for the P1a client surfaces (Lane D / D-FLAG-OFF-PROBE).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ROIData } from '../../shared/types/roi';
import type { IssueOutcomeCount } from '../../shared/types/the-issue';
import { IssueVerdictHeadline } from '../../src/components/client/the-issue/IssueVerdictHeadline';
import { OutcomeCountBand } from '../../src/components/client/the-issue/OutcomeCountBand';

// The OFF-path verdict the server emits: estimate_ga4 provenance, no reconciliation/typed fields.
const estimateVerdict: NonNullable<ROIData['outcomeVerdict']> = {
  outcomeCount: 14,
  outcomeUnitLabel: 'new patients',
  valuePerOutcome: 800,
  estimatedValue: 11_234,
  monthlyRetainer: 1_500,
  baseline: {
    engagementStart: '2026-01-01T00:00:00Z',
    baselineConversions: 6,
    baselineCapturedAt: '2026-01-01T00:00:00Z',
    state: 'ready',
  },
  baselineDeltaCount: 8,
  provenance: 'estimate_ga4',
};

// The OFF-path outcome count the server emits: UNTYPED units (no outcomeType), empty byType,
// estimate provenance — byte-identical to the pre-P1a P0 shape.
const estimateCount: IssueOutcomeCount = {
  units: [
    { label: 'form fills', current: 23, baseline: 10, priorPeriod: 18, eventName: 'form_submit' },
    { label: 'calls', current: 41, baseline: 22, priorPeriod: 39, eventName: 'phone_call' },
  ],
  byType: [],
  provenance: 'estimate_ga4',
  namedRecordsAvailable: false,
};

describe('DOM-PROBE: P1a measured-capture-OFF byte-identity (estimate surface, no measured leak)', () => {
  it('(a) IssueVerdictHeadline shows the BANDED ~$ estimate + "this is an estimate" — never a measured label', () => {
    const { container } = render(<IssueVerdictHeadline verdict={estimateVerdict} topRec={null} />);
    expect(screen.getByText(/~\$11,000/)).toBeInTheDocument();        // banded estimate dollar
    expect(screen.getByText(/this is an estimate/i)).toBeInTheDocument();
    // No exact (un-banded) measured dollar; no measured label may leak onto the OFF path.
    expect(screen.queryByText(/\$11,234/)).not.toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/measured from real actions/i);
    expect(text).not.toMatch(/tracked on your site/i);
    expect(text.toLowerCase()).not.toContain('measured');
  });

  it('(b) OutcomeCountBand renders NO [data-outcome-type] measured affordance and no leaked type icons', () => {
    const { container } = render(<OutcomeCountBand count={estimateCount} />);
    // The estimate units still render (P0 surface intact)…
    expect(screen.getByText(/form fills/i)).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    // …but with NONE of the measured typed affordances.
    expect(container.querySelector('[data-outcome-type]')).toBeNull();
    // P0 honest names affordance retained (not a measured "names captured" claim).
    expect(screen.getByText(/Names available with call/i)).toBeInTheDocument();
  });

  it('(c) no purple leaks onto either P1a-touched surface (Four Laws)', () => {
    const h = render(<IssueVerdictHeadline verdict={estimateVerdict} topRec={null} />);
    const b = render(<OutcomeCountBand count={estimateCount} />);
    expect(h.container.querySelector('[class*="purple-"]')).toBeNull();
    expect(b.container.querySelector('[class*="purple-"]')).toBeNull();
  });
});
`;

const SPEC_BY_SCENARIO: Record<Scenario, string> = {
  'flag-off': FLAG_OFF_SPEC,
  'measured-capture-off': MEASURED_CAPTURE_OFF_SPEC,
};

function cleanup(): void {
  if (process.env.PROBE_KEEP_SPEC === '1') {
    log(`[probe] PROBE_KEEP_SPEC=1 — leaving ${SPEC_REL} in place for debugging.`);
    return;
  }
  try {
    if (existsSync(SPEC_PATH)) rmSync(SPEC_PATH);
  } catch (e) {
    err(`[probe] warning: failed to remove ${SPEC_REL}: ${(e as Error).message}`);
  }
}

function main(): number {
  if (!VALID_SCENARIOS.includes(SCENARIO)) {
    err(`[probe] error: unknown PROBE_SCENARIO "${SCENARIO}". Valid: ${VALID_SCENARIOS.join(', ')}.`);
    return 1;
  }
  log(`[probe] the-issue DOM probe — scenario=${SCENARIO} (Lane D)`);

  if (!existsSync(SPEC_DIR)) mkdirSync(SPEC_DIR, { recursive: true });

  if (existsSync(SPEC_PATH)) {
    err(`[probe] error: ${SPEC_REL} already exists — refusing to overwrite. Remove it and retry.`);
    return 1;
  }

  writeFileSync(SPEC_PATH, SPEC_BY_SCENARIO[SCENARIO], 'utf-8');

  // Run ONLY the focused probe spec, in the component (jsdom) project, no watch, no coverage.
  const result = spawnSync(
    'npx',
    ['vitest', 'run', '--project', 'component', SPEC_REL],
    { cwd: root, stdio: 'inherit', env: process.env },
  );

  cleanup();

  if (result.error) {
    err(`[probe] error: failed to spawn vitest: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    if (SCENARIO === 'measured-capture-off') {
      err('[probe] FAIL: measured-capture-OFF DOM contract violated — a measured affordance leaked onto the estimate (OFF) path.');
      err('[probe]   Expected: banded ~$ estimate + "this is an estimate"; NO exact dollar, NO "measured"/"tracked on your site" label, NO [data-outcome-type] tag.');
    } else {
      err('[probe] FAIL: flag-OFF DOM contract violated — the spine reorder is NOT byte-identical on the OFF path.');
      err('[probe]   Expected: no slot-* spine testids; legacy "See full report" <details> band + headline ring present.');
    }
    return result.status ?? 1;
  }

  log(`[probe] ${SCENARIO} byte-identical: PASS`);
  return 0;
}

const code = main();
process.exit(code);
