# Client Insights Redesign — Master Plan
**Date:** 2026-04-29
**Spec:** `docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md` (read first)
**Phasing:** Five PRs (2.5a / 2.5b / 2.5c / 2.5d / 2.5e). Reuse-first. The optional AI-polish sub-flag `client-briefing-v2-ai-polish` lands in 2.5e (no other new flags); `client-briefing-v2` continues to gate the rest of the feature.
**Total scope:** ~3,300 LOC additive across 2.5a/b/c, then ~−1,000 LOC in 2.5d cleanup, then ~+400 LOC in 2.5e Premium polish.

This is one master plan covering all five PRs. Each PR section below is independently shippable with its own task graph, file list, and verification gates.

**Phase reorder note (2026-04-29 → revised 2026-04-30):** the original plan placed the AI hero-punch + weekly-opener inside 2.5c. We reordered them out into a new **Phase 2.5e** (cleaner mental separation: 2.5c is anchors + outcome stories, 2.5e is editorial polish). The original reorder put 2.5e AFTER **2.5d** so the AI passes would land on a `briefing-prompt.ts` already cleaned of dead full-narrative code. **Re-revised 2026-04-30:** user opted to ship 2.5e BEFORE 2.5d to keep momentum — 2.5e is purely additive (new exports alongside the unused `buildBriefingInstructions`/`briefingAIResponseSchema`), 2.5d cleanup runs on its own ≥4-week soak clock and will preserve the 2.5e helpers when it deletes the dead path. **2.5d is housekeeping** — only opens after 2.5a/b/c/e have soaked for ≥4 weeks with no rollback or incident.

---

## Pre-requisites (one-time, before PR 2.5a)

These are setup steps that don't belong to any specific PR but must be true before plan execution.

- [x] Phase 2 (PR #375) merged to staging
- [x] PR #377 (deep-link redirect fix) merged to staging
- [x] Spec reviewed and committed (`docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md`)
- [ ] All three PRs target `staging` branch first per CLAUDE.md "phase-per-PR" rule
- [ ] Each PR uses an isolated git worktree (`/Users/joshuahampson/CascadeProjects/asset-dashboard` is the main repo)
- [ ] Each PR auto-merges only after CI green + Devin Review pass
- [ ] User-approved smoke test on staging required between each PR before starting next

---

## Audit corrections applied to plan

The pre-plan audit caught five issues. Plan tasks below reflect the corrections:

1. **`server/story-generators.ts` extraction is REJECTED.** Build new templates in `server/briefing-templates/` directory using typed `analytics_insights` payloads directly. InsightsDigest's generators are React-coupled and not extractable cleanly. (Spec §3 corrected.)
2. **`summarizeInsightsForClient` exists** at `server/routes/client-intelligence.ts:36`. Confirmed.
3. **`milestone_attribution` is a NEW InsightType** — added to `shared/types/analytics.ts` `InsightType` union as part of 2.5c.
4. **`client-briefing-v2-ai-polish` flag is NEW** — added to `shared/types/feature-flags.ts` as part of 2.5c.
5. **Free-tier briefing access** is gated client-side via `useClientBriefing(workspaceId, !isFree)` AND server-side via `/api/public/briefing/:wsId` returning 402 for free tier (Phase 1 already shipped this).

---

# Phase 2.5a · Server-side template rebuild

**Validates:** "Data-rooted templates feel better than AI prose."
**Frontend changes:** ZERO. Same magazine layout (Phase 2). Different content.
**LOC budget:** ~1,050 (≤1,200 hard cap)
**Soak interval after merge:** 1 week before starting 2.5b. Toggle on for hmpsn studio + Swish; sample 5 published briefings; confirm voice with user.

## Task Dependencies (2.5a)

```
Sequential:
  T2.5a.0  Add banned-hedges pr-check rule
  T2.5a.1  Define BriefingStory.dataReceipt extension (type-only)

Parallel batch 1 (after T0/T1):
  T2.5a.2  briefing-templates/ranking-mover.ts
  T2.5a.3  briefing-templates/ranking-opportunity.ts
  T2.5a.4  briefing-templates/anomaly-digest.ts
  T2.5a.5  briefing-templates/ctr-opportunity.ts
  T2.5a.6  briefing-templates/freshness-alert.ts
  T2.5a.7  briefing-templates/cannibalization.ts
  T2.5a.8  briefing-templates/content-decay.ts (simplified)
  T2.5a.9  briefing-templates/audit-finding.ts (simplified)
  T2.5a.10 briefing-templates/competitor-alert.ts (Watch List only)
  T2.5a.11 briefing-templates/page-health.ts (simplified, Watch List only)
  T2.5a.12 briefing-templates/content-gap.ts

Sequential after parallel batch:
  T2.5a.13 briefing-templates/index.ts — central dispatcher
  T2.5a.14 briefing-candidates.ts — add collectContentGapCandidates()
  T2.5a.15 briefing-cron.ts — replace AI step with template projection
  T2.5a.16 briefing-prompt.ts — keep AI as opt-in helper, default off
  T2.5a.17 Tests + golden fixtures
  T2.5a.18 FEATURE_AUDIT.md entry + open PR
```

## Tasks

### T2.5a.0 — Banned-hedges pr-check rule (Model: haiku)

**Files:** `scripts/pr-check.ts`

Add a new pr-check rule "Banned hedge words in briefing templates":
- Scope: `server/briefing-templates/**/*.ts`
- Forbidden patterns: `\b(potentially|could|may|appears to|suggests|might|seems)\b`
- Exception: hatch with `// hedge-ok` inline if a hedge is genuinely required (e.g., quoting source data)
- Test: ensure rule doesn't false-positive on `recommendations.ts` or other unrelated files

### T2.5a.1 — Extend BriefingStory type (Model: haiku)

**Files:** `shared/types/briefing.ts`

Add optional field:
```ts
export interface BriefingStory {
  // ... existing fields ...
  /**
   * Optional citation line rendered below metric badges in the
   * <HeroStoryCard>. Plain prose, references data sources + comparisons.
   * When present, the hero card renders it. When absent, no receipt line.
   */
  dataReceipt?: string;
}
```

Verify no existing tests break.

### T2.5a.2 through T2.5a.12 — Per-type template modules (Model: sonnet, parallel)

**Owns one file each** (exclusive ownership per agent for parallel dispatch):
- `server/briefing-templates/ranking-mover.ts`
- `server/briefing-templates/ranking-opportunity.ts`
- `server/briefing-templates/anomaly-digest.ts`
- `server/briefing-templates/ctr-opportunity.ts`
- `server/briefing-templates/freshness-alert.ts`
- `server/briefing-templates/cannibalization.ts`
- `server/briefing-templates/content-decay.ts`
- `server/briefing-templates/audit-finding.ts`
- `server/briefing-templates/competitor-alert.ts`
- `server/briefing-templates/page-health.ts`
- `server/briefing-templates/content-gap.ts`

**Each module exports:**
```ts
import type { AnalyticsInsight, InsightDataMap } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

export function buildStoryFromInsight(
  insight: AnalyticsInsight,
  context: { workspaceId: string; tier: 'free' | 'growth' | 'premium' },
): BriefingStory | null;
```

**Each template MUST:**
- Cite ≥1 number from typed `data` payload in the narrative
- Render 0–2 metric badges from typed payload
- Set `dataReceipt` when at least one source citation can be made
- Set `category` (the spec's `BriefingCategory` enum)
- Set `drillIn` to the relevant ExplorePage
- Return `null` if the insight lacks fields the template requires (degrade gracefully)
- NOT use any banned hedge word (enforced by pr-check rule from T2.5a.0)

**Sample template structure (ranking-mover.ts):**
```ts
export function buildStoryFromInsight(insight, context) {
  const data = insight.data as RankingMoverData;
  if (data.positionChange >= 0) return null; // only positive movers eligible
  if (!data.pageUrl || !data.query) return null; // require core fields

  const clicksDelta = (data.currentClicks ?? 0) - (data.previousClicks ?? 0);
  const headline = `${insight.pageTitle ?? 'Your page'} just cracked the top ${Math.ceil(data.currentPosition / 5) * 5}.`;

  const narrative = `${data.pageUrl} for "${data.query}" rose from ` +
    `#${data.previousPosition} to #${data.currentPosition} over the last 14 days. ` +
    `Clicks for the page jumped from ${data.previousClicks} to ${data.currentClicks} ` +
    `in the same window.`;

  const dataReceipt = `Source: GSC last-28-day vs prior-28-day window. ` +
    `Verified across 7 daily samples since ${formatDate(insight.computedAt - 14 * DAY_MS)}.`;

  return {
    id: `story-${insight.id}`,
    category: 'win',
    isHeadline: true, // promoted by materiality scoring elsewhere
    headline,
    narrative,
    metrics: [
      { value: `#${data.previousPosition} → #${data.currentPosition}`, label: 'position' },
      { value: `${clicksDelta >= 0 ? '+' : ''}${clicksDelta} clicks`, label: '2-week Δ' },
    ],
    dataReceipt,
    drillIn: { page: 'performance', queryParams: { page: data.pageUrl } },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
  };
}
```

**For `content-gap.ts`:** input is NOT an `AnalyticsInsight` — it's a `ContentGap` from `keywordStrategy.contentGaps[]`. Use a different signature:
```ts
export function buildStoryFromContentGap(
  gap: ContentGap,
  context: { workspaceId: string; tier: '...'; avgCPC?: number },
): BriefingStory | null;
```

The `dataReceipt` for gaps must include:
- SEMrush volume + KD framing (use `kdFraming(difficulty)` if available)
- Workspace's actual GSC impressions for the term
- `competitorProof` (if present)
- $/mo equivalent footnote: `≈ $${Math.round(gap.volume * 0.103 * (context.avgCPC ?? 0))}/mo ad-spend equivalent at rank #3`

**For each parallel agent, the prompt template:**

> You are owning ONE template file at `server/briefing-templates/<type>.ts`. Build a deterministic mapper from `<TypeName>Data` (typed payload from `shared/types/analytics.ts`) to `BriefingStory`. Banned hedge words: `potentially, could, may, appears to, suggests, might, seems`. Required: cite ≥1 number from the payload in the narrative. See spec §5 for voice rules and `server/briefing-templates/ranking-mover.ts` (already shipped) for the canonical pattern.

### T2.5a.13 — Template dispatcher (Model: sonnet)

**Files:** `server/briefing-templates/index.ts` (NEW)

```ts
import type { AnalyticsInsight, InsightType } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { ContentGap } from '../../shared/types/workspace.js';

import { buildStoryFromInsight as rankingMover } from './ranking-mover.js';
// ... import every template ...

const INSIGHT_DISPATCHERS: Record<InsightType, (i, ctx) => BriefingStory | null> = {
  ranking_mover: rankingMover,
  ranking_opportunity: rankingOpp,
  // ...
  // unmapped types: return null
};

export function buildStoryFromInsight(
  insight: AnalyticsInsight,
  context: { workspaceId: string; tier: '...' },
): BriefingStory | null {
  const dispatcher = INSIGHT_DISPATCHERS[insight.insightType];
  if (!dispatcher) return null;
  return dispatcher(insight, context);
}

export { buildStoryFromContentGap } from './content-gap.js';
```

Tests: ensure every value in `InsightType` union has a registered dispatcher OR is explicitly skipped (`null` return).

### T2.5a.14 — Content gap collector (Model: sonnet)

**Files:** `server/briefing-candidates.ts` (modified)

Add new collector function:
```ts
import { computeOpportunityScore } from './routes/keyword-strategy.js';

export function collectContentGapCandidates(workspaceId: string): Candidate[] {
  const ws = getWorkspace(workspaceId);
  if (!ws?.keywordStrategy?.contentGaps) return [];

  return ws.keywordStrategy.contentGaps.map((gap) => {
    const score = gap.opportunityScore ?? computeOpportunityScore(gap);
    return {
      type: 'content_gap',
      sourceRef: { type: 'recommendation', id: `gap-${gap.targetKeyword}` },
      categoryHint: 'opportunity',
      impactScore: score,
      sortKey: score,
      data: gap,
    };
  });
}

// Add to collectAllCandidates() the line:
// content_gap: collectContentGapCandidates(workspaceId),
```

Verify materiality scoring (`scoreCandidate` or equivalent) treats content_gap candidates correctly. If actionability multiplier doesn't have an entry for `content_gap`, add one (recommend 1.0, between win=1.0 and risk=1.5).

### T2.5a.15 — Replace AI step in cron (Model: sonnet)

**Files:** `server/briefing-cron.ts` (modified)

Find the call to `briefingAIResponseSchema.parse(JSON.parse(stripCodeFences(result.text).trim()))` (currently around line 285). Replace the entire AI-call-and-parse block with deterministic template projection:

```ts
import { buildStoryFromInsight, buildStoryFromContentGap } from './briefing-templates/index.js';

// Replace the existing callAI + parse logic with:
const stories: BriefingStory[] = [];
for (const candidate of selectedCandidates) {
  let story: BriefingStory | null = null;
  if (candidate.type === 'content_gap') {
    story = buildStoryFromContentGap(candidate.data as ContentGap, {
      workspaceId, tier, avgCPC: roiData?.avgCPC,
    });
  } else if (candidate.sourceRef.type === 'analytics_insight') {
    const insight = await getInsightById(candidate.sourceRef.id);
    if (insight) story = buildStoryFromInsight(insight, { workspaceId, tier });
  }
  if (story) stories.push(story);
}

// Promote highest-impact win/risk/opportunity to isHeadline=true if missing
const hero = pickHeroStory(stories); // first story with eligible category by score
if (hero) hero.isHeadline = true;
```

**Critical: KEEP the optional AI path behind a flag** (default off). The existing `briefingAIResponseSchema` and prompt builder can remain in `briefing-prompt.ts` for Phase 2.5c's AI hero punch + weekly opener. Don't delete them.

### T2.5a.16 — Briefing-prompt.ts adjustments (Model: haiku)

**Files:** `server/briefing-prompt.ts` (modified)

The existing system-prompt builder + `briefingAIResponseSchema` stay on disk (referenced by 2.5c's hero-punch). They're no longer invoked by the cron's main path after T2.5a.15's swap. **No new feature flag** — the `client-briefing-v2` flag continues to gate the entire feature. Dead-but-on-disk code is cleaned up in Phase 2.5d (see below).

Add a TODO comment at the top of `briefing-prompt.ts`:
```ts
// TODO(phase-2.5d): the full-narrative AI path is replaced by deterministic
// templates in server/briefing-templates/. Only `punchHeroHeadline` and
// `writeWeeklyOpener` (added in 2.5c) remain in active use. Remove the
// narrative system prompt + briefingAIResponseSchema in 2.5d cleanup.
```

### T2.5a.17 — Tests (Model: sonnet)

**Files:**
- `tests/unit/briefing-templates/<type>.test.ts` × 11 (one per template)
- `tests/integration/briefing-content-gap-collector.test.ts`
- `tests/integration/briefing-cron-deterministic.test.ts`

**Per-template golden test:**
```ts
describe('briefing template: ranking_mover', () => {
  it('renders a complete story for a populated insight', () => {
    const story = buildStoryFromInsight(fixtureRankingMover, ctx);
    expect(story).not.toBeNull();
    expect(story?.headline).toMatch(/cracked the top/);
    expect(story?.narrative).toMatch(/\d+/); // cites a number
    expect(story?.narrative).not.toMatch(/potentially|could|may|appears/);
    expect(story?.dataReceipt).toBeTruthy();
    expect(story?.metrics).toHaveLength(2);
    expect(story?.drillIn.page).toBe('performance');
  });

  it('returns null when required fields are missing', () => {
    const story = buildStoryFromInsight({ ...fixtureRankingMover, data: {} }, ctx);
    expect(story).toBeNull();
  });
});
```

**Cron integration test:** verify `runBriefingForWorkspace()` with `client-briefing-v2-ai-narrative=false` produces stories without calling `callAI`.

### T2.5a.18 — Docs + PR (Model: haiku)

- Update `FEATURE_AUDIT.md` with new entry #322 (Client Insights Redesign 2.5a)
- Update `docs/rules/automated-rules.md` if banned-hedges rule was added
- Verify `npm run typecheck`, `npx tsx scripts/pr-check.ts`, `npx vitest run` all pass
- Open PR to `staging` titled: `feat(briefing-v2): Phase 2.5a — server-side template rebuild`

## Quality Gates (2.5a)

- [ ] Typecheck zero errors
- [ ] pr-check zero errors (warnings on unrelated files OK)
- [ ] All briefing tests pass (existing 91 + new ~30 = ~120 expected)
- [ ] No frontend files modified (audit-only confirmation)
- [ ] FEATURE_AUDIT.md updated
- [ ] Banned-hedges pr-check rule active and verified

## Acceptance signals (2.5a)

After merge + 1-week soak with flag on for hmpsn studio + Swish:

- [ ] Sample 5 published briefings; confirm zero hedge words in narratives
- [ ] At least 2 of those 5 briefings include a `content_gap` story (lead OR secondary)
- [ ] User reports voice feels "data-rooted, not AI-paraphrased"
- [ ] No briefings rendered as completely empty (deterministic dispatcher selected at least one story per published draft)

---

# Phase 2.5b · New layout sections

**Validates:** "The new visual rhythm reads better than Phase 2's magazine."
**LOC budget:** ~1,200 (≤1,400 hard cap)
**Soak after merge:** 1 week before starting 2.5c (or skipping it).

## Task Dependencies (2.5b)

```
Sequential pre-batch:
  T2.5b.0 Server: briefing-summary.ts (issue summary line generator)
  T2.5b.1 Server: extend BriefingDraft response with issueSummary, pulse data,
                  data spread, recommendations
  T2.5b.2 Wire data through useClientBriefing hook

Parallel batch (after T0-T2):
  T2.5b.3 PulseStrip.tsx
  T2.5b.4 DataSpread.tsx
  T2.5b.5 RecommendedForYou.tsx (port admin ContentGaps)
  T2.5b.6 IssueSummaryLine.tsx
  T2.5b.7 DateLine.tsx
  T2.5b.8 ActionQueueStrip stale-item escalation

Sequential after batch:
  T2.5b.9  Update HeroStoryCard to render dataReceipt
  T2.5b.10 Update InsightsBriefingPage composer to mount new sections
  T2.5b.11 Free tier rendering verification
  T2.5b.12 Tests + docs + PR
```

## Tasks

### T2.5b.0 — Server: issue summary generator (Model: sonnet)

**Files:** `server/briefing-summary.ts` (NEW)

```ts
import type { BriefingStory } from '../shared/types/briefing.js';
import type { Candidate } from './briefing-candidates.js';

export function generateIssueSummary(
  stories: BriefingStory[],
  recommendationCount: number,
): string {
  const heroCategory = stories.find((s) => s.isHeadline)?.category;
  const riskCount = stories.filter((s) => s.category === 'risk' && !s.isHeadline).length;
  const winCount = stories.filter((s) => s.category === 'win' && !s.isHeadline).length;

  const leadPhrase = LEAD_PHRASES[heroCategory ?? 'win'] ?? 'A look at this week';
  // Templates: "A win at the top", "A risk to address first", "Predictions landing", etc.

  const clauses = [leadPhrase];
  if (riskCount > 0) clauses.push(`${riskCount} ${riskCount === 1 ? 'risk' : 'risks'} to watch`);
  if (recommendationCount > 0) clauses.push(`${recommendationCount} ${recommendationCount === 1 ? 'opportunity' : 'opportunities'} to consider`);

  return clauses.join(', ') + '.';
}
```

Add to `briefing-cron.ts` after stories are built; persist `issueSummary` field on the draft.

### T2.5b.1 — Server: extend draft response shape (Model: sonnet)

**Files:** `server/briefing-store.ts`, `shared/types/briefing.ts`

Extend `BriefingDraft`:
```ts
export interface BriefingDraft {
  // ... existing fields ...
  issueSummary?: string;
  pulseData?: { siteHealth: number | null; visitors: number | null; clicks: number | null; impressions: number | null; avgPosition: number | null; deltas: { ... } };
  dataSpread?: { wins: SpreadItem[]; risks: SpreadItem[] };
  recommendations?: ContentGap[]; // populated for "Recommended for You"
}
```

`SpreadItem` is a small shape: `{ icon: 'up' | 'down' | 'warning'; headline: string; detail: string }`. Wins/risks NOT stories — they're brief one-liners summarizing the secondary signals.

### T2.5b.2 — Hook update (Model: haiku)

**Files:** `src/hooks/client/useClientBriefing.ts`

No code change required if the API client `briefingApi.getPublished` already returns whatever the server sends (it does — no field allowlist on JSON response). Verify and document.

### T2.5b.3 — `<PulseStrip>` (Model: sonnet)

**Files:** `src/components/client/Briefing/PulseStrip.tsx` (NEW)

```tsx
import { StatCard, MetricRing, Icon } from '../../ui';
import { Shield, Users, MousePointerClick, Eye, Target } from 'lucide-react';

interface PulseStripProps {
  pulseData: BriefingDraft['pulseData'];
}

export function PulseStrip({ pulseData }: PulseStripProps) {
  if (!pulseData) return null;
  // Render 4 cells: Site Health (with MetricRing), Visitors, Clicks/Impr, Avg Position
  // Use existing StatCard + MetricRing primitives
}
```

Mobile: stack vertically below 640px. Desktop: 4-col grid.

### T2.5b.4 — `<DataSpread>` (Model: sonnet)

**Files:** `src/components/client/Briefing/DataSpread.tsx` (NEW)

2-column wins/risks. Cap 3 each. Each item: icon + headline + detail line. Click → drill-in destination if available.

```tsx
interface DataSpreadProps {
  wins: SpreadItem[];
  risks: SpreadItem[];
}

export function DataSpread({ wins, risks }: DataSpreadProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Column label="WINS" items={wins.slice(0, 3)} icon={<TrendingUp />} />
      <Column label="RISKS" items={risks.slice(0, 3)} icon={<TrendingDown />} />
    </div>
  );
}
```

### T2.5b.5 — `<RecommendedForYou>` (Model: sonnet)

**Files:** `src/components/client/Briefing/RecommendedForYou.tsx` (NEW — port from admin)

**Port from `src/components/strategy/ContentGaps.tsx`:**
- Same row layout (topic + opportunity score + intent + priority + volume + KD + impressions + competitor proof)
- Different CTA: instead of `<Draft Brief>` / `<Generate Brief>` (admin nav targets), use `<Generate Brief →>` that opens the existing client pricing modal flow (pricingModal pattern from StrategyTab)
- Sort by `opportunityScore` (server-computed or fallback)
- Cap 3 inline + "Show more →" expand
- Client-tier-aware: Premium shows "Generate Brief (included)"; Growth shows "Generate Brief"; Free shows ghosted rows + "Upgrade to Growth"

**Use `fmtNum` from `src/utils/formatNumbers.ts`** (NOT the local re-implementation in admin's ContentGaps.tsx — fix during port).

### T2.5b.6 — `<IssueSummaryLine>` (Model: haiku)

**Files:** `src/components/client/Briefing/IssueSummaryLine.tsx` (NEW)

```tsx
interface IssueSummaryLineProps {
  text: string;
}
export function IssueSummaryLine({ text }: IssueSummaryLineProps) {
  return (
    <p className="t-body text-[var(--brand-text-muted)] leading-relaxed mt-3 mb-4">
      {text}
    </p>
  );
}
```

Server populates `text` deterministically (T2.5b.0).

### T2.5b.7 — `<DateLine>` (Model: haiku)

**Files:** `src/components/client/Briefing/DateLine.tsx` (NEW)

```tsx
interface DateLineProps {
  weekOf: string; // 'YYYY-MM-DD'
  issueNumber: number;
}
export function DateLine({ weekOf, issueNumber }: DateLineProps) {
  // Renders: "WEEK OF APR 28, 2026          ISSUE 17"
  // small caps, hairline rule below
}
```

Issue number computed server-side (`weekOf` index since first published briefing for the workspace + 1).

### T2.5b.8 — Action strip stale escalation (Model: sonnet)

**Files:** `src/components/client/Briefing/ActionQueueStrip.tsx` (modified)

Use `createdAt` timestamps already on items (audit confirmed available). When any pending item has `Date.now() - createdAt > 7 * DAY_MS`, add an urgent indicator: `2 SEO changes need review · 1 urgent — 14 days pending`. Style: brighter amber, small clock icon.

Pass `staleness` data through props (or derive from existing counts data — verify in plan-write).

### T2.5b.9 — `<HeroStoryCard>` dataReceipt rendering (Model: haiku)

**Files:** `src/components/client/Briefing/HeroStoryCard.tsx` (modified)

Add data receipt section between the metric badges and the drill-in link:

```tsx
{story.dataReceipt && (
  <div className="border-t border-[var(--brand-border)]/30 pt-3 mt-2">
    <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed font-mono">
      ─ {story.dataReceipt}
    </p>
  </div>
)}
```

Field is optional; existing stories without receipts still render correctly.

### T2.5b.10 — `<InsightsBriefingPage>` composer (Model: sonnet)

**Files:** `src/components/client/Briefing/InsightsBriefingPage.tsx` (modified)

Mount new sections in correct order: DateLine → IssueSummaryLine → ActionQueueStrip → PulseStrip → HeroStoryCard → DataSpread → RecommendedForYou → SecondaryStoryRow list (Watch List) → Footer.

For Free tier: show DateLine + ActionQueueStrip + FreeTierUpgradeCTA + MonthlyDigestContent (unchanged from Phase 2 today).

### T2.5b.11 — Free tier verification (Model: haiku)

Verify Free tier rendering:
- DateLine still renders
- ActionQueueStrip still renders if items exist
- IssueSummaryLine renders OR a teaser version ("A win and 2 risks this week — upgrade to read")
- No PulseStrip, DataSpread, HeroStoryCard, RecommendedForYou, Watch List visible
- FreeTierUpgradeCTA + MonthlyDigestContent render

Add integration test for free tier render.

### T2.5b.12 — Tests + docs + PR (Model: sonnet)

- Component tests for PulseStrip, DataSpread, RecommendedForYou, IssueSummaryLine, DateLine
- Integration test for full briefing render with new layout
- FEATURE_AUDIT.md update
- BRAND_DESIGN_LANGUAGE.md update with new layout entries
- PR title: `feat(briefing-v2): Phase 2.5b — new layout sections`

## Quality Gates (2.5b)

- [ ] Typecheck + pr-check + vitest pass
- [ ] No regressions in 2.5a templates
- [ ] All Free/Growth/Premium tier renders verified
- [ ] BRAND_DESIGN_LANGUAGE.md updated

---

# Phase 2.5c · Anchors + Premium polish (OPTIONAL)

**Validates:** Editorial polish.
**LOC budget:** ~1,400 (≤1,600 hard cap)
**Optional:** If 2.5a + 2.5b feel done at the soak intervals, skip or defer indefinitely. The anchors are valuable; AI passes are tier polish.

## Task Dependencies (2.5c)

```
Sequential foundation:
  T2.5c.0 Migration: workspace_metrics_snapshots table
  T2.5c.1 server/workspace-metrics-snapshots.ts module
  T2.5c.2 Cron piggyback to write snapshots weekly
  T2.5c.3 Add milestone_attribution InsightType + flag

Parallel batch:
  T2.5c.4 server/briefing-anchors.ts (best-since computations)
  T2.5c.5 weCalledIt template (briefing-templates/we-called-it.ts)
  T2.5c.6 milestone_attribution template
  T2.5c.7 Wire weCalledIt through latestBriefing slice path

Sequential after batch:
  T2.5c.8  Update existing templates to use anchors
  T2.5c.9  Add client-briefing-v2-ai-polish flag
  T2.5c.10 Optional AI hero-punch (Premium-gated, fail-soft)
  T2.5c.11 Optional AI weekly-opener (Premium-gated, fail-soft)
  T2.5c.12 Tests + docs + PR
```

## Tasks

### T2.5c.0 — Migration (Model: haiku)

**Files:** `server/db/migrations/079-workspace-metrics-snapshots.sql` (NEW)

```sql
CREATE TABLE workspace_metrics_snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id          TEXT NOT NULL,
  snapshot_date         TEXT NOT NULL,           -- YYYY-MM-DD
  total_clicks          INTEGER,
  total_impressions     INTEGER,
  avg_position          REAL,
  audit_score           INTEGER,
  organic_traffic_value REAL,
  computed_at           INTEGER NOT NULL,
  UNIQUE(workspace_id, snapshot_date)
);
CREATE INDEX wms_workspace_date ON workspace_metrics_snapshots(workspace_id, snapshot_date);
```

Verify migration number 079 is next available (audit confirmed 078 is current highest).

### T2.5c.1 — Snapshots module (Model: sonnet)

**Files:** `server/workspace-metrics-snapshots.ts` (NEW)

Read/write helpers:
- `recordSnapshot(workspaceId, metrics)` — upserts per `(workspace_id, snapshot_date)` unique constraint
- `getSnapshots(workspaceId, days)` — returns latest N days
- `getBestValueSinceDate(workspaceId, metricName, sinceDate)` — for "best since X" anchors
- `pruneOld(workspaceId, retentionDays = 90)` — for retention enforcement

### T2.5c.2 — Weekly cron piggyback (Model: sonnet)

**Files:** `server/briefing-cron.ts` (modified) OR `server/intelligence-crons.ts` (modified)

Add a single call to `recordSnapshot()` at the end of the weekly briefing run, capturing the metrics that drove the briefing's pulse data. Don't add a new cron — piggyback on the existing weekly tick.

### T2.5c.3 — milestone_attribution InsightType (Model: haiku)

**Files:** `shared/types/analytics.ts` (modified)

Add to `InsightType` union: `'milestone_attribution'`. Add typed `MilestoneAttributionData`:
```ts
export interface MilestoneAttributionData {
  briefId: string;
  briefTitle: string;
  pageUrl: string;
  thresholdCrossed: 'first_clicks' | 'fifty_clicks' | 'hundred_clicks';
  currentClicks: number;
  daysSinceDelivery: number;
  trafficValue: number;
}
```

Add to `InsightDataMap`. Add Zod schema in `server/schemas/`. Add the type to the four lockstep places per CLAUDE.md "New insight type registration" rule.

**No new feature flag** — `client-briefing-v2` continues to gate the entire feature. AI passes are gated on tier === 'premium' alone. Simpler operationally.

### T2.5c.4 — `briefing-anchors.ts` (Model: sonnet)

**Files:** `server/briefing-anchors.ts` (NEW)

```ts
export function findBestWeekSince(
  workspaceId: string,
  metricName: 'clicks' | 'impressions' | 'avg_position' | 'audit_score' | 'organic_traffic_value',
  current: number,
): { sinceDate: string; phrase: string } | null;
```

Returns a phrase like "best week since Mar 17" when current value beats all snapshots since that date. Returns `null` when not anchor-worthy (e.g., not the highest in the window, or insufficient history).

### T2.5c.5 — weCalledIt template (Model: sonnet)

**Files:** `server/briefing-templates/we-called-it.ts` (NEW)

Reads `tracked_actions` + `action_outcomes`. Triggered when an action's most recent outcome score is `strong_win` AND the win is recent (last 14 days). Builds a story with:
- Original prediction text
- Predicted date
- Days-to-deliver
- Current outcome metric

The collector to surface weCalledIt as candidates lives in `briefing-candidates.ts` — add `collectWeCalledItCandidates(workspaceId)`.

### T2.5c.6 — milestone_attribution template (Model: sonnet)

**Files:** `server/briefing-templates/milestone-attribution.ts` (NEW)

Triggered when a delivered brief's tracked traffic value crosses a threshold. Use `roi.contentItems[]` to detect crossings; baseline from `tracked_actions.baseline_snapshot`.

### T2.5c.7 — weCalledIt through latestBriefing slice (Model: sonnet)

Per spec recommendation: **don't extend `summarizeInsightsForClient` allowlist**. Instead, surface weCalledIt entries via the existing `latestBriefing` slice on `ClientSignalsSlice` (Phase 2 already added the field).

The slice carries `BriefingSummary` today (just metadata). Extend it to optionally include the most recent weCalledIt prediction for client AI awareness — OR keep the slice metadata-only and surface weCalledIt only as a story in the briefing draft (which already passes through public-portal serialization).

Plan-write decides which path is cleaner.

### T2.5c.8 — Anchor wiring (Model: sonnet)

Update existing templates (from 2.5a) to optionally append anchor text to `dataReceipt` when an anchor is available:

```ts
const anchor = findBestWeekSince(workspaceId, 'clicks', currentClicks);
if (anchor) {
  dataReceipt += ` Best week since ${anchor.sinceDate}.`;
}
```

### T2.5c.9 — AI polish flag (Model: haiku)

**Files:** `shared/types/feature-flags.ts` (already done in T2.5c.3)

### T2.5c.10 — AI hero-punch (Model: sonnet)

**Files:** `server/briefing-prompt.ts` (modified)

Add a function `punchHeroHeadline(deterministicHeadline, insight)` that calls `callAI()` with a tight prompt: "Rewrite this headline to be 5-12 words, more memorable, NO hedge words. Return only the rewritten headline."

Gate on `tier === 'premium'` alone. Fail-soft: catch all errors, return original deterministic headline.

### T2.5c.11 — AI weekly opener (Model: sonnet)

**Files:** `server/briefing-prompt.ts` (modified)

Add `writeWeeklyOpener(stories, briefingContext)` that returns a one-line "letter from the editor" string above the issue summary. Gate on `tier === 'premium'` alone. Fail-soft: omit.

Render in `<InsightsBriefingPage>` only when present in the draft response.

### T2.5c.12 — Tests + docs + PR (Model: sonnet)

- Tests for snapshot table read/write
- Tests for anchor formatter (with fixture historical data)
- Tests for AI fail-soft (mock `callAI` to throw; verify deterministic fallback)
- Tests for milestone_attribution + weCalledIt templates
- FEATURE_AUDIT.md update
- PR title: `feat(briefing-v2): Phase 2.5c — anchors + premium polish`

## Quality Gates (2.5c)

- [ ] Typecheck + pr-check + vitest pass
- [ ] AI fail-soft verified by tests
- [ ] No regressions in 2.5a/2.5b
- [ ] FEATURE_AUDIT.md + BRAND_DESIGN_LANGUAGE.md updated
- [ ] CLAUDE.md "New insight type registration" rule satisfied (4 lockstep changes for milestone_attribution)

---

# Phase 2.5d · Cleanup — remove dead Phase 1/2 code

**Validates:** Codebase has one canonical path (deterministic templates), not two.
**LOC budget:** ~−800 to −1,200 (NET DELETIONS)
**Soak after merge:** None — this is housekeeping after the redesign has soaked.
**Trigger condition:** Run only after 2.5a + 2.5b + 2.5c have been live on staging + production for ≥4 weeks with no rollback or incident. If we ever want the AI narrative path back, this PR is the breaker — so we don't open it until we're certain.

## What gets removed

### Code that is no longer invoked but still on disk

1. **Full-narrative AI path in `server/briefing-prompt.ts`**
   - The system-prompt builder for the multi-story narrative generation
   - The `briefingAIResponseSchema` Zod schema (was for parsing AI's full briefing JSON)
   - The instructions block that asked the AI to pick + write 3-5 stories
   - **Phase reorder note (revised):** the original plan kept `punchHeroHeadline` + `writeWeeklyOpener` in 2.5c. The first reorder moved them to a new **Phase 2.5e** that ran AFTER 2.5d. The user then opted to ship 2.5e FIRST (PR #387, merged 2026-04-30 timeframe) so the helpers landed alongside the dead path. **2.5d MUST PRESERVE the 2.5e helpers** — only delete the multi-story narrative generation logic + `briefingAIResponseSchema` Zod schema + `buildBriefingInstructions`. Keep `punchHeroHeadline` + `writeWeeklyOpener` + their shared helpers (`HEDGE_WORDS_RE`, `BANNED_WORDS_TEXT`, `unquote`, `hasPairedQuotes`, `sanitizeForPrompt`, `countWords`).

2. **`stripCodeFences` call in `briefing-cron.ts`**
   - Was needed because Sonnet wrapped JSON in `\`\`\`json` fences
   - Templates produce typed objects directly; no parsing required
   - The helper itself stays in `server/helpers.ts` (5+ other consumers)

3. **`tests/integration/briefing-cron.test.ts` — AI mock paths**
   - The `'returns "skipped" when AI response is invalid JSON'` test — no longer reachable
   - The `'strips Markdown ```json fences'` test — no longer reachable
   - The Zod-validation-failure test — no longer reachable
   - Keep tests for: tier gating, duplicate-week guard, manual bypass, deterministic template projection (added in 2.5a)

4. **Scaffolding for the AI candidate-pool prompt**
   - `formatCandidateBlock` helper if no longer used by remaining AI passes (audit before deleting)
   - `topNByMateriality` if shape changes — keep if still used by candidate selection

### Code that may be removable depending on usage

5. **`<MonthlyDigest>` (gated wrapper)** if Free tier renders something else (audit and decide):
   - Currently used by 2.5b's free-tier rendering as `<MonthlyDigestContent>`
   - The full `<MonthlyDigest>` (with `<TierGate>`) is only rendered by `<OverviewTab>` when the briefing flag is OFF — which is also being deprecated
   - If the legacy OverviewTab is also being retired in 2.5d, drop `<MonthlyDigest>` and `<MonthlyDigestContent>` together
   - **Decision:** keep `<MonthlyDigestContent>` for Free tier (still used). Drop `<MonthlyDigest>` only if `<OverviewTab>` is retired in this PR.

6. **`<OverviewTab>` legacy body** — if `client-briefing-v2` flag is now globally on (env-var default = true), the legacy 9-section body is dead code. This is the same conversation as Phase 4 of the original briefing spec ("Email + briefing convergence"). Audit at 2.5d-write whether the flag has been globally flipped.

7. **`<HealthScoreCard>`, `<IntelligenceSummaryCard>`, `<PredictionShowcaseCard>`** — only rendered by legacy `<OverviewTab>`. Drop if `<OverviewTab>` is retired.

## Tasks

### T2.5d.0 — Audit pass (Model: sonnet)

Before any deletion, run a grep audit:
- For each file/function/component listed above, find every reference in the codebase
- Confirm reference is dead OR identify alternate uses
- Document findings in the PR description

### T2.5d.1 — Remove AI narrative path (Model: sonnet)

**Files modified:**
- `server/briefing-prompt.ts` — remove ONLY the multi-story narrative generation logic: the `buildBriefingInstructions()` builder and the `briefingAIResponseSchema` Zod schema (+ its `BriefingAIResponse` type alias). PRESERVE `punchHeroHeadline` + `writeWeeklyOpener` + their shared module-level helpers (regex / banned-words list / quote-handling functions / countWords / sanitizeForPrompt). Phase 2.5e shipped these helpers in the same file alongside the dead code; 2.5d's job is the surgical removal of the dead path only.
- `server/briefing-cron.ts` — remove the `stripCodeFences` call + the JSON.parse step + the Zod validation against `briefingAIResponseSchema`

### T2.5d.2 — Test cleanup (Model: haiku)

**Files modified:**
- `tests/integration/briefing-cron.test.ts` — remove tests for AI invalid-JSON path, code-fence stripping, Zod schema failure on full briefing
- Verify remaining tests still pass

### T2.5d.3 — Optional: retire `<OverviewTab>` legacy body (Model: sonnet)

**ONLY if** the `client-briefing-v2` flag is globally on (env-var = true):
- Remove the legacy 9-section render path (lines 117+ of `OverviewTab.tsx`)
- The flag-conditional swap at lines 100-115 becomes the only render path; rename component to reflect new role
- Drop `<HealthScoreCard>`, `<IntelligenceSummaryCard>`, `<PredictionShowcaseCard>` if no other consumers
- Drop `<MonthlyDigest>` (gated wrapper) if no other consumers; keep `<MonthlyDigestContent>` for Free tier

If the flag is still per-workspace opt-in, defer this task. Don't break workspaces still on the legacy view.

### T2.5d.4 — Drop unused feature flag (Model: haiku, OPTIONAL)

If `client-briefing-v2` is now the default-on flag and we're confident: remove the flag entirely (replace conditional with always-on path). Per CLAUDE.md "phase-per-PR" rule, this might warrant its own PR — decide at plan-write.

### T2.5d.5 — Tests + docs + PR (Model: haiku)

- All existing briefing tests must pass (~120 tests post-2.5a)
- Verify `npm run typecheck` zero errors
- Verify `npx tsx scripts/pr-check.ts` zero errors
- FEATURE_AUDIT.md update marking the legacy components retired
- PR title: `chore(briefing-v2): Phase 2.5d — cleanup AI narrative path + retire legacy components`

## Quality Gates (2.5d)

- [ ] Net deletion (this PR should remove more lines than it adds)
- [ ] Zero functional regressions
- [ ] Every removed component grepped + verified unreferenced
- [ ] Decision on `client-briefing-v2` flag retirement documented
- [ ] BRAND_DESIGN_LANGUAGE.md cleaned of references to retired components

---

# Phase 2.5e · AI polish (Premium-only, fail-soft)

**Validates:** AI hero-headline punch + weekly opener add editorial flair on top of the deterministic templates.
**LOC budget:** ~400 (≤500 hard cap)
**Soak after merge:** None — opt-in flag-gated; rollback is the flag flip.

**Phase reorder rationale (revised 2026-04-30):** original plan put these inside 2.5c. First reorder moved them to 2.5e AFTER 2.5d. User then opted to ship 2.5e BEFORE 2.5d to keep momentum — the helpers land alongside the dead path; 2.5d's cleanup pass will surgically preserve the 2.5e helpers. Status: **shipped in PR #387 (~2026-04-30)**.

## Task Dependencies (2.5e)

```
Sequential:
  T2.5e.0 Add client-briefing-v2-ai-polish flag (default off)
  T2.5e.1 server/briefing-prompt.ts: punchHeroHeadline()
  T2.5e.2 server/briefing-prompt.ts: writeWeeklyOpener()
  T2.5e.3 Wire both into briefing-cron.ts post-template projection
  T2.5e.4 Extend PublishedBriefingResponse with weeklyOpener?: string
  T2.5e.5 <InsightsBriefingPage>: render weeklyOpener above DateLine
  T2.5e.6 Tests + docs + PR
```

## Tasks

### T2.5e.0 — Feature flag (Model: haiku)

**Files:** `shared/types/feature-flags.ts`

Add `'client-briefing-v2-ai-polish': false`. Both AI passes gate on this flag AND on `tier === 'premium'`. Either gate failing → fall back to deterministic-only output. Flag-flip is the rollback for both passes.

### T2.5e.1 — punchHeroHeadline (Model: sonnet)

**Files:** `server/briefing-prompt.ts` (additive — alongside the dead full-narrative path that 2.5d will surgically remove later)

**As shipped (PR #387):**

```ts
export async function punchHeroHeadline(
  deterministicHeadline: string,
  insightHint: string | null, // pre-stringified hint, not typed AnalyticsInsight
  workspaceId: string,         // for callAI cost attribution
): Promise<string>
```

The original plan's signature accepted a typed `AnalyticsInsight | { headline; data }` as the second arg. Shipped impl uses a pre-built string hint instead — avoids threading `AnalyticsInsight` through the cron's story loop (cron has the typed insight; converting to a hint at the call site keeps `briefing-prompt.ts` data-shape agnostic). The `workspaceId` third parameter feeds `callAI`'s cost-attribution path. Calls `callAI({ provider: 'anthropic', system: <rules>, messages: [{ role: 'user', content: <data> }] })` with rules in the **system field** (codebase idiom — see `server/copy-generation.ts`, `server/content-posts-ai.ts`).

**Fail-soft contract:**
- Catch every error (timeout, rate-limit, malformed response, hedge-word violation, word-count violation) → return the original deterministic headline
- Log at `debug` level, never `error` (this is opt-in polish, not a critical path)
- No retry — one shot, accept-or-fall-back

### T2.5e.2 — writeWeeklyOpener (Model: sonnet)

**Files:** `server/briefing-prompt.ts`

```ts
export async function writeWeeklyOpener(
  stories: BriefingStory[],
  briefingContext: { workspaceName: string; weekOf: string },
): Promise<string | null>
```

Returns a one-line "letter from the editor" string. Same fail-soft contract: any error → null (caller skips the section, doesn't crash).

Prompt rules: no hedges; cite a number from at least one story; ≤25 words; period-terminated; no quotation marks.

### T2.5e.3 — Cron wiring (Model: sonnet)

**As shipped (PR #387):** the AI block runs **BEFORE** `upsertBriefingDraft`, not after. Original plan suggested running it after persist + re-persisting via `updateBriefingStories`. The shipped flow avoids the second DB write by mutating `stories[heroIdx].headline` IN PLACE pre-upsert, so the persisted draft already carries the polished headline. The opener persists in `sourceMetadata.aiPolish.weeklyOpener` (no schema change — packs into the existing JSON column).

```ts
let aiPolishPayload: NonNullable<BriefingSourceMetadata['aiPolish']> | undefined;
const aiPolishEnabled = isFeatureEnabled('client-briefing-v2-ai-polish') && ws.tier === 'premium';
if (aiPolishEnabled && stories.length > 0) {
  const aiStart = Date.now();
  const heroIdx = stories.findIndex((s) => s.isHeadline);
  const hero = heroIdx >= 0 ? stories[heroIdx] : null;
  const originalHeroHeadline = hero?.headline;
  let weeklyOpener: string | null = null;
  let headlineWasPunched = false;
  try {
    if (hero) {
      const insightHint = hero.metrics.length > 0
        ? `${hero.category}: ${hero.metrics.map(m => `${m.value} ${m.label}`).join(', ')}`
        : null;
      const punched = await punchHeroHeadline(hero.headline, insightHint, workspaceId);
      if (punched && punched !== hero.headline) {
        stories[heroIdx].headline = punched;
        headlineWasPunched = true;
      }
    }
    // ORDER-DEPENDENT: writeWeeklyOpener sees the polished headline
    // when present. Don't parallelise via Promise.all.
    weeklyOpener = await writeWeeklyOpener(stories, { workspaceName: ws.name, weekOf, workspaceId });
  } catch (err) { /* fail-soft, log at debug */ }
  // Skip the payload entirely when both AI calls fully fell back —
  // {aiMs: N}-only blob is noisy telemetry with no actionable signal.
  if (weeklyOpener || headlineWasPunched) {
    aiPolishPayload = { ...(weeklyOpener && {weeklyOpener}), ...(headlineWasPunched && originalHeroHeadline && {originalHeroHeadline}), aiMs: Date.now() - aiStart };
  }
}
// then upsertBriefingDraft({ ..., sourceMetadata: { ..., ...(aiPolishPayload && {aiPolish: aiPolishPayload}) } })
```

Both AI calls are awaited but failure is silent. The cron's outer try/catch around the AI block is a backup so a malformed module never fails the briefing run.

### T2.5e.4 — Wire opener through PublishedBriefingResponse (Model: haiku)

`shared/types/briefing.ts` — extend `PublishedBriefingResponse`:

```ts
export interface PublishedBriefingResponse {
  // … existing fields …
  /** Premium-only AI-generated one-line "letter from the editor". Optional. */
  weeklyOpener?: string;
}
```

`server/routes/public-portal.ts` — read the persisted opener (column or source_metadata) and include in the response.

### T2.5e.5 — Frontend render (Model: haiku)

`src/components/client/Briefing/InsightsBriefingPage.tsx`:
- Import a new tiny `<WeeklyOpener>` component (or inline render)
- Render only when `briefing.weeklyOpener` is present
- Position: ABOVE `<DateLine>`, italic-styled body text, `t-body italic text-[var(--brand-text-muted)]`
- No-op when the field is missing (free + growth tiers, or when the AI failed)

### T2.5e.6 — Tests + docs + PR (Model: sonnet)

- Unit tests for `punchHeroHeadline` — mock `callAI` returning hedge-laced response → expect deterministic fallback
- Unit tests for `writeWeeklyOpener` — mock `callAI` returning empty string → expect null
- Integration test: feature flag OFF → no AI calls made, no `weeklyOpener` field in response
- Integration test: feature flag ON + tier=premium → `callAI` called, `weeklyOpener` persisted
- Component test: `<InsightsBriefingPage>` renders opener when present, omits when absent
- FEATURE_AUDIT.md update entry (#325 likely)
- BRAND_DESIGN_LANGUAGE.md addendum for the WeeklyOpener typography
- PR title: `feat(briefing-v2): Phase 2.5e — Premium AI polish (hero punch + opener)`

## Quality Gates (2.5e)

- [ ] Typecheck + pr-check + vitest pass
- [ ] AI fail-soft verified by 4+ tests (one per failure mode: hedge-word violation, word-count violation, timeout, rate-limit)
- [ ] Flag OFF → zero AI calls (verified by mock spy assertion)
- [ ] No regressions in 2.5a/2.5b/2.5c golden tests
- [ ] BRAND_DESIGN_LANGUAGE.md updated for WeeklyOpener treatment

---

## Cross-phase verification (run before each PR open)

These checks apply to every PR in this plan:

- [ ] `pwd` and `git branch --show-current` confirm correct worktree + branch
- [ ] `npm run typecheck` zero errors
- [ ] `npx tsx scripts/pr-check.ts` zero errors
- [ ] `npx vitest run` full suite passes
- [ ] No file in `src/components/admin/` modified (this is a client-portal redesign)
- [ ] No migrations modified except 2.5c.0
- [ ] No new database tables except 2.5c.0
- [ ] Spec doc `docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md` consulted before any new file is created

---

## Final acceptance (after all 3 PRs)

- [ ] `client-briefing-v2` flag on for ≥3 paid workspaces for ≥2 weeks
- [ ] User confirms voice quality on sample briefings
- [ ] No reports of empty/broken briefings
- [ ] Free-tier rendering verified clean
- [ ] Mobile rendering verified on a real phone (or DevTools mobile emulation)
- [ ] At least one workspace has shipped a briefing containing a content_gap story that resulted in a brief request

When all of the above are met, this plan is closed and we move on to Phase 3 (navigation simplification, separate plan).

---

**End of plan.** Each phase ships independently. Each can be paused, restarted, or deferred without breaking subsequent phases. Soak intervals between phases are deliberate — voice + layout decisions need real-world validation before stacking the next layer.
