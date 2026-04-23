# SEO AI Advisor — Phase 1: Insight Narration

## Overview

This plan adds an AI interpretation layer that sits between the insight computation engine and the client-facing insight cards. When `computeAndPersistInsights` finishes a cycle, a fire-and-forget async step calls `enrichInsightsWithAI(workspaceId)`, which generates a 2–4 sentence, workspace-specific narrative for each client-relevant insight and persists it as `ai_narrative` on the insight row. Clients on the Premium tier see an expandable "AI Analysis" section in each insight card; the existing rule-based `narrative` field remains for all tiers.

This is purely additive — no existing data shapes are broken, no compute cycle is blocked. Cost is ~$0.002 per workspace per compute cycle (GPT-4.1-mini, ~10 insights × ~150 in / 80 out tokens).

**What this is NOT:** Brief generation from emerging keywords and strategic freshness prioritization require `emerging_keyword` / `freshness_alert` insights from the Tier 2 plan, which haven't shipped yet. Those are documented at the bottom as Phase 2.

---

## Pre-requisites

- [ ] No spec (plan is the spec — advisory session produced the design)
- [ ] No pre-plan audit required (new feature, new files)
- [ ] Shared contracts committed as Task 0 before any parallel work

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Narration storage | `ai_narrative TEXT NULL` column on `analytics_insights` | 1:1 with insight, no join, backwards-compatible |
| Narrative clearing | `ON CONFLICT DO UPDATE SET ai_narrative = CASE WHEN excluded.data != analytics_insights.data THEN NULL ELSE ai_narrative END` | Re-narrates only when insight data actually changes, not every cycle |
| Enrichment timing | Fire-and-forget after `computeAndPersistInsights` | Insights visible immediately; narration arrives seconds later via broadcast |
| Cost gating | Premium tier only — server-side: `enrichInsightsWithAI` returns early if `ws.tier !== 'premium'` | Simpler than threading `tier` through `InsightsDigest`; non-Premium workspaces never receive `aiNarrative` so no frontend gate needed |
| AI model | GPT-4.1-mini (OpenAI) | Short factual narrations, not prose — cost efficiency wins over creativity |
| Provider call | `callAI({ provider: 'openai', ... })` from `server/ai.ts` | Unified dispatcher, workspaceId attribution |
| Insights to narrate | Top 20 by `impact_score` that pass `isClientRelevant()` and have null `ai_narrative` | Matches what `buildClientInsights` displays (top 15), +5 buffer |
| WS event | New `INSIGHT_AI_ENRICHED = 'insight:ai_enriched'` | Distinct from `INSIGHT_BRIDGE_UPDATED`; triggers targeted cache invalidation |

---

## Task Dependencies

```
Task 0 (haiku) — Pre-commit contracts
  ├─→ Task 1 (opus)  — AI enrichment engine (parallel)
  └─→ Task 2 (sonnet) — Frontend rendering  (parallel)

Task 1 → Task 3 (sonnet) — Compute hook + admin route (sequential, imports seo-advisor.ts)

[Task 2 + Task 3 done] → Task 4 (sonnet) — Verification + docs
```

Tasks 1 and 2 are parallel — Task 2 only needs the shared types from Task 0, not the `seo-advisor.ts` implementation from Task 1.

---

## Task 0 — Pre-Commit Contracts (Model: haiku)

**Owns:**
- `server/db/migrations/071-ai-narrative-column.sql` ← create
- `shared/types/analytics.ts` — add `aiNarrative` field to `AnalyticsInsight`
- `shared/types/narrative.ts` — add `aiNarrative` field to `ClientInsight`
- `server/analytics-insights-store.ts` — add `InsightRow.ai_narrative`, update `rowToInsight()`, update upsert SQL, add `updateInsightNarrative()` export
- `server/ws-events.ts` — add `INSIGHT_AI_ENRICHED`
- `src/lib/wsEvents.ts` — mirror `INSIGHT_AI_ENRICHED`

**Must not touch:** any other file

---

### Step 1 — Migration SQL

Create `server/db/migrations/071-ai-narrative-column.sql`:

```sql
ALTER TABLE analytics_insights ADD COLUMN ai_narrative TEXT;
```

That's the complete migration. The column is nullable; existing rows get NULL. No index needed — we query by `workspace_id` and filter in application code.

---

### Step 2 — `AnalyticsInsight` type addition

In `shared/types/analytics.ts`, locate the `AnalyticsInsight<T>` interface (line ~209). Add after the `bridgeSource` field:

```typescript
/** AI-generated workspace-specific narrative. Null when not yet enriched or on non-Premium tiers. */
aiNarrative?: string | null;
```

---

### Step 3 — `ClientInsight` type addition

In `shared/types/narrative.ts`, locate the `ClientInsight` interface (line ~4). Add after `impactScore`:

```typescript
/** AI-generated workspace-specific narrative. Present only for Premium workspaces. */
aiNarrative?: string;
```

---

### Step 4 — Store additions in `analytics-insights-store.ts`

**4a — Add `ai_narrative` to `InsightRow` interface** (after `bridge_source`):

```typescript
ai_narrative: string | null;
```

**4b — Update the upsert prepared statement.** The upsert SQL is in `stmts()` (lines 34–62). Make two changes:

- Add `ai_narrative` to the INSERT column list and VALUES list (after `bridge_source`): `@ai_narrative`
- In the `DO UPDATE SET` block, replace the `bridge_source` line with:

```sql
bridge_source      = excluded.bridge_source,
ai_narrative       = CASE WHEN excluded.data != analytics_insights.data THEN NULL ELSE analytics_insights.ai_narrative END
```

This clears the narrative only when the insight data actually changes.

- In `stmts().upsert.run({...})` call inside `upsertInsight()` (line ~179), add: `ai_narrative: null` — always pass null on upsert; the CASE expression in SQL preserves the existing value when data is unchanged.

**4c — Update `rowToInsight()`** (line ~99). Add after `bridgeSource`:

```typescript
aiNarrative: row.ai_narrative ?? undefined,
```

**4d — Add `updateNarrative` to the `stmts()` cache** inside the `createStmtCache` block (after `deleteById`):

```typescript
updateNarrative: db.prepare(
  `UPDATE analytics_insights SET ai_narrative = ? WHERE id = ? AND workspace_id = ?`,
),
```

**4e — Add new `updateInsightNarrative` export** after `cloneInsightParams`:

```typescript
/** Update the AI-generated narrative for a single insight. Workspace-scoped for safety. */
export function updateInsightNarrative(id: string, workspaceId: string, narrative: string): void {
  stmts().updateNarrative.run(narrative, id, workspaceId);
}
```

Note: Uses `stmts()` cache (not bare `db.prepare()`) to match the codebase's prepared statement pattern and avoid re-parsing on every call.

---

### Step 5 — WS event additions

In `server/ws-events.ts`, add to the `WS_EVENTS` object (after `STRATEGY_UPDATED`):

```typescript
// AI SEO Advisor
INSIGHT_AI_ENRICHED: 'insight:ai_enriched',
```

Mirror in `src/lib/wsEvents.ts`, same location relative to the object (after `STRATEGY_UPDATED`):

```typescript
// AI SEO Advisor
INSIGHT_AI_ENRICHED: 'insight:ai_enriched',
```

---

### Step 6 — Commit contracts

Commit all Task 0 changes in a single commit with message: `feat(seo-advisor): pre-commit contracts — aiNarrative type, migration 071, WS event`

---

## Task 1 — AI Enrichment Engine (Model: opus)

Requires Task 0 committed.

**Owns:** `server/seo-advisor.ts` ← create new file

**Must not touch:** any other file

---

### Overview

`seo-advisor.ts` exports one function: `enrichInsightsWithAI(workspaceId: string): Promise<number>`. It:

1. Loads all insights for the workspace (`getInsights`)
2. Filters to client-relevant, unenriched candidates
3. For each, assembles a targeted prompt with workspace context
4. Calls `callAI` with GPT-4.1-mini
5. Calls `updateInsightNarrative` to persist the result
6. Broadcasts `INSIGHT_AI_ENRICHED` once at the end
7. Returns count of insights enriched

---

### Full implementation

```typescript
// server/seo-advisor.ts
import { createLogger } from './logger.js';
import { getInsights, updateInsightNarrative } from './analytics-insights-store.js';
import { callAI } from './ai.js';
import { broadcastToWorkspace } from './broadcast.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import type { AnalyticsInsight, InsightType } from '../shared/types/analytics.js';

const log = createLogger('seo-advisor');

// Insight types the client sees (mirrors isClientRelevant in insight-narrative.ts)
const NARRATABLE_TYPES = new Set<InsightType>([
  'page_health',
  'ranking_opportunity',
  'content_decay',
  'ranking_mover',
  'ctr_opportunity',
  'serp_opportunity',
  'conversion_attribution',
  'competitor_gap',
]);

const MAX_INSIGHTS_PER_CYCLE = 20;

/**
 * Enrich insights with AI-generated workspace-specific narratives.
 * Fire-and-forget safe — never throws; logs and returns 0 on error.
 * Returns the count of insights enriched in this cycle.
 */
export async function enrichInsightsWithAI(workspaceId: string): Promise<number> {
  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return 0;

    // AI narration is Premium-only — non-Premium workspaces never receive aiNarrative
    if (ws.tier !== 'premium') return 0;

    // Build business context once for the whole batch
    const industry = ws.intelligenceProfile?.industry ?? '';
    const goals = (ws.businessPriorities ?? []).slice(0, 3).join('; ');
    const brandVoice = ws.brandVoice ? `Brand voice: ${ws.brandVoice.slice(0, 300)}` : '';
    const knowledgeExcerpt = ws.knowledgeBase ? ws.knowledgeBase.slice(0, 500) : '';

    const systemPrompt = [
      `You are writing personalized SEO insight summaries for a client dashboard.`,
      industry && `Client industry: ${industry}.`,
      goals && `Client goals: ${goals}.`,
      brandVoice,
      knowledgeExcerpt && `Business context: ${knowledgeExcerpt}`,
      ``,
      `Rules:`,
      `- Write 2–4 sentences maximum.`,
      `- Use first-person plural: "we detected", "we're working on", "we recommend".`,
      `- Tone: clear, confident, action-oriented. No jargon.`,
      `- Plain prose only. No markdown, no bullet points, no asterisks.`,
      `- Focus on the business impact and what it means for the client, not technical SEO terms.`,
      `- Never mention internal tool names or data sources.`,
    ].filter(Boolean).join('\n');

    const allInsights = getInsights(workspaceId);

    const candidates = allInsights
      .filter(i => NARRATABLE_TYPES.has(i.insightType))
      .filter(i => (i.impactScore ?? 0) >= 20)
      .filter(i => !i.aiNarrative)              // skip already-enriched
      .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
      .slice(0, MAX_INSIGHTS_PER_CYCLE);

    if (candidates.length === 0) return 0;

    let enriched = 0;
    for (const insight of candidates) {
      try {
        const narrative = await narrateInsight(insight, systemPrompt, workspaceId);
        if (narrative) {
          updateInsightNarrative(insight.id, workspaceId, narrative);
          enriched++;
        }
      } catch (err) {
        log.warn({ err, insightId: insight.id, insightType: insight.insightType }, 'seo-advisor: narration failed for insight');
      }
    }

    if (enriched > 0) {
      broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_AI_ENRICHED, { count: enriched });
    }

    log.info({ workspaceId, enriched, candidates: candidates.length }, 'seo-advisor: enrichment cycle complete');
    return enriched;
  } catch (err) {
    log.warn({ err, workspaceId }, 'seo-advisor: enrichment cycle failed');
    return 0;
  }
}

async function narrateInsight(
  insight: AnalyticsInsight,
  systemPrompt: string,
  workspaceId: string,
): Promise<string | null> {
  const data = insight.data as Record<string, unknown>;
  const page = insight.pageTitle ?? 'your website';
  const keyword = insight.strategyKeyword ? ` (target keyword: "${insight.strategyKeyword}")` : '';

  // Build a concise data summary — keep under 400 tokens
  const dataSummary = buildDataSummary(insight.insightType, data);

  const userMessage = [
    `Insight type: ${insight.insightType}`,
    `Page: ${page}${keyword}`,
    dataSummary,
    ``,
    `Write a 2–4 sentence narrative for the client dashboard about this insight.`,
  ].filter(Boolean).join('\n');

  const result = await callAI({
    provider: 'openai',
    model: 'gpt-4.1-mini',
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 120,
    temperature: 0.4,
    feature: 'seo-advisor-narration',
    workspaceId,
  });

  const text = result.text.trim();
  return text.length > 20 ? text : null;
}

function buildDataSummary(insightType: InsightType, data: Record<string, unknown>): string {
  switch (insightType) {
    case 'ranking_mover': {
      const prev = data.previousPosition as number;
      const curr = data.currentPosition as number;
      const direction = curr < prev ? 'improved' : 'declined';
      return `Ranking ${direction} from position ${prev} to ${curr}.${data.currentClicks != null ? ` Current monthly clicks: ${data.currentClicks}.` : ''}`;
    }
    case 'content_decay':
      return `Traffic declined by ${Math.abs(Number(data.deltaPercent) || 0).toFixed(0)}% compared to the previous period.`;
    case 'ranking_opportunity':
      return `Currently ranking around position ${data.position ?? 'unknown'}. Impressions: ${data.impressions ?? 0}. Close to page 1.`;
    case 'ctr_opportunity': {
      // actualCtr and expectedCtr are ALREADY percentages (e.g. 6.3 = 6.3%) — do NOT multiply by 100
      const ctr = (Number(data.actualCtr) || 0).toFixed(1);
      const expected = (Number(data.expectedCtr) || 0).toFixed(1);
      return `Current CTR: ${ctr}%. Expected for this position: ${expected}%. Estimated click gap: ${data.estimatedClickGap ?? 0} clicks/month.`;
    }
    case 'page_health':
      return `Health score: ${data.score ?? 'unknown'}/100. Trend: ${data.trend ?? 'unknown'}.`;
    case 'serp_opportunity':
      // schemaStatus is the relevant field — SerpOpportunityData has no featureType field
      return `Schema status: ${data.schemaStatus ?? 'unknown'}. Page receives ${data.impressions ?? 0} impressions but could capture structured result features.`;
    case 'conversion_attribution':
      // conversionRate is ALREADY a percentage (e.g. 4.0 = 4%) — do NOT multiply by 100
      return `Organic conversions: ${data.conversions ?? 0}. Conversion rate: ${(Number(data.conversionRate) || 0).toFixed(2)}%.`;
    case 'competitor_gap':
      return `Competitor ranks #${data.competitorPosition ?? '?'} for "${data.keyword ?? 'unknown'}" (${data.competitorDomain ?? 'competitor'}). We do not rank for this term.`;
    default:
      return '';
  }
}
```

---

## Task 2 — Frontend Rendering (Model: sonnet)

Parallel with Task 1. Requires Task 0 committed.

**Owns:**
- `server/insight-narrative.ts` — pass `aiNarrative` through `toClientInsight()`
- `src/hooks/useWsInvalidation.ts` — add `INSIGHT_AI_ENRICHED` handler
- `src/components/client/InsightsDigest.tsx` — add expandable AI section

**Must not touch:** `server/seo-advisor.ts`, `server/analytics-intelligence.ts`, anything in `shared/types/` (Task 0 already owns those), any other server route

---

### Step 1 — Pass `aiNarrative` through `toClientInsight`

In `server/insight-narrative.ts`, `toClientInsight()` (line ~28) currently returns an object built from `narrativeMap[insight.insightType]()`. After the existing return statement, add `aiNarrative` to the returned `ClientInsight`:

```typescript
function toClientInsight(insight: AnalyticsInsight): ClientInsight {
  const title = insight.pageTitle ?? 'your website';
  const data = insight.data as Record<string, unknown>;

  const narrativeMap: Partial<Record<InsightType, () => { headline: string; narrative: string; impact?: string }>> = {
    // ... existing cases unchanged ...
  };

  const fn = narrativeMap[insight.insightType];
  if (!fn) return null as unknown as ClientInsight;

  const { headline, narrative, impact } = fn();
  return {
    id: insight.id,
    type: insight.insightType,
    severity: insight.severity,
    domain: insight.domain ?? 'cross',
    headline,
    narrative,
    impact,
    actionTaken: insight.pipelineStatus === 'brief_exists' ? 'Content brief created — your strategist is on it' : undefined,
    impactScore: insight.impactScore ?? 0,
    aiNarrative: insight.aiNarrative ?? undefined,   // ← add this line
  };
}
```

Find the existing return statement in `toClientInsight` and add `aiNarrative: insight.aiNarrative ?? undefined` to it. Do not restructure the function — just add the field to the existing return.

---

### Step 2 — WS invalidation handler

In `src/hooks/useWsInvalidation.ts`, import `WS_EVENTS` already at top. Add a handler for the new event alongside the existing `INSIGHT_RESOLVED` and `INSIGHT_BRIDGE_UPDATED` handlers:

```typescript
[WS_EVENTS.INSIGHT_AI_ENRICHED]: () => {
  if (!workspaceId) return;
  qc.invalidateQueries({ queryKey: queryKeys.client.clientInsights(workspaceId) });
},
```

`INSIGHT_AI_ENRICHED` should also exist in `src/lib/wsEvents.ts` (added in Task 0). Import it if the import statement doesn't already include it — check the existing `WS_EVENTS` import at the top of `useWsInvalidation.ts` and add the constant there.

---

### Step 3 — `InsightsDigest.tsx` expandable AI section

**Context — how `InsightsDigest` works (READ THIS BEFORE EDITING):**

`InsightsDigest.tsx` uses a local `DigestInsight` interface (not `ClientInsight` directly). Server insights flow through `mapServerInsights(serverData?.insights ?? [])` which converts `ClientInsight[]` → `DigestInsight[]`. The render loop maps over `visible: DigestInsight[]`. This means `aiNarrative` must be threaded through THREE places: `DigestInsight`, `mapServerInsights()`, and the render loop.

Additionally, the outer insight card is a `<button>` element. Nesting a `<button>` inside it is invalid HTML. The AI section must be a sibling element rendered OUTSIDE the card button, not inside it.

No `TierGate` is needed — Premium gating is enforced server-side (see Task 1). Non-Premium workspaces never have `aiNarrative` populated, so the section simply never appears for them.

**3a — Add `aiNarrative` to `DigestInsight` interface** (line ~22):

```typescript
interface DigestInsight {
  id: string;
  icon: LucideIcon;
  color: string;
  headline: string;
  body: string;
  detail?: string[];
  action?: { label: string; tab: ClientTab };
  priority: number;
  sentiment: 'positive' | 'neutral' | 'negative' | 'opportunity';
  aiNarrative?: string;   // ← add this field
}
```

**3b — Pass `aiNarrative` through `mapServerInsights()`** (line ~421):

In the returned object from `insights.map(i => ({ ... }))`, add:

```typescript
aiNarrative: i.aiNarrative,
```

**3c — Add `AiNarrativeSection` component** near the top of the file (before the main `InsightsDigest` export, after the existing helper functions):

```tsx
function AiNarrativeSection({ narrative }: { narrative: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 px-5 pb-4">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 transition-colors"
      >
        <span className="font-medium">AI Analysis</span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
          {narrative}
        </p>
      )}
    </div>
  );
}
```

**3d — Update the render loop** to wrap the card `<button>` and the AI section in a single `<div>`:

Currently the render loop returns a bare `<button key={insight.id} ...>`. Wrap it so the AI section can be a sibling:

```tsx
{visible.map(insight => {
  const c = COLORS[insight.color] || COLORS.teal;
  const Icon = insight.icon;
  return (
    <div key={insight.id}>
      <button
        onClick={() => insight.action && navigate(clientPath(props.workspaceId, insight.action.tab, betaMode))}
        className="w-full bg-zinc-900 border border-zinc-800 p-5 text-left hover:border-zinc-700 transition-colors cursor-pointer group"
        style={{ borderRadius: '10px 24px 10px 24px' }}
      >
        {/* existing card content — unchanged */}
      </button>
      {insight.aiNarrative && <AiNarrativeSection narrative={insight.aiNarrative} />}
    </div>
  );
})}
```

Move the `key` prop from the `<button>` to the wrapping `<div>`. Keep all existing card content inside the `<button>` unchanged.

**Check existing imports first:** `grep -n '^import' src/components/client/InsightsDigest.tsx`

Add `ChevronDown` to the lucide-react import line if not already present. `useState` is already imported (line 1). Do NOT import `TierGate` — it is not needed.

---

## Task 3 — Compute Hook + Admin Route (Model: sonnet)

Sequential after Task 1 (imports `enrichInsightsWithAI` from `seo-advisor.ts`).

**Owns:**
- `server/analytics-intelligence.ts` — fire-and-forget hook in `getOrComputeInsights()`
- `server/routes/insights.ts` — new `POST /api/insights/:workspaceId/enrich-ai` admin endpoint

**Must not touch:** `server/seo-advisor.ts` (Task 1 owns it), any frontend file

---

### Step 1 — Hook in `getOrComputeInsights`

In `server/analytics-intelligence.ts`, add to imports at the top of the file:

```typescript
import { enrichInsightsWithAI } from './seo-advisor.js';
```

**Check existing imports first:** `grep -n '^import' server/analytics-intelligence.ts` to verify the import doesn't already exist.

Locate `getOrComputeInsights` (line ~833). After the `await computeAndPersistInsights(workspaceId)` call (line ~856), add the fire-and-forget trigger:

```typescript
// Non-blocking AI enrichment — narratives arrive via INSIGHT_AI_ENRICHED broadcast
void enrichInsightsWithAI(workspaceId).catch(err =>
  log.warn({ err, workspaceId }, 'analytics-intelligence: AI enrichment failed'),
);
```

The `void` operator suppresses the floating-promise lint warning. The `.catch()` ensures the failure is logged without crashing the compute cycle.

---

### Step 2 — Admin trigger endpoint

In `server/routes/insights.ts`, add a new route (after existing routes):

```typescript
// POST /api/insights/:workspaceId/enrich-ai — admin trigger for AI enrichment
router.post('/:workspaceId/enrich-ai', async (req, res) => {
  const { workspaceId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const enriched = await enrichInsightsWithAI(workspaceId);
    res.json({ enriched });
  } catch (err) {
    log.error({ err }, 'Failed to enrich insights with AI');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

Add `import { enrichInsightsWithAI } from '../seo-advisor.js';` at the top with existing imports. Add `import { getWorkspace } from '../workspaces.js';` if not already present.

**Check existing imports first:** `grep -n '^import' server/routes/insights.ts`.

---

## Task 4 — Verification + Docs (Model: sonnet)

Sequential after Tasks 2 and 3.

**Owns:** nothing new — verification only, then doc updates

**Must not touch:** any implementation file

---

### Step 1 — Quality gates

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
grep -r 'purple-' src/components/client/InsightsDigest.tsx   # must return empty
```

### Step 2 — Smoke test enrichment

With both dev server and frontend running:

1. Open any workspace with existing insights
2. Call `POST /api/insights/:workspaceId/enrich-ai` via curl or admin panel
3. Verify `ai_narrative` column is populated in SQLite
4. Verify `INSIGHT_AI_ENRICHED` event fires (check server logs)
5. Verify frontend insight cards update (React Query cache invalidation)
6. Verify Premium insight card shows "AI Analysis" expand section
7. Verify non-Premium insight card does NOT show the section

```bash
curl -X POST http://localhost:3001/api/insights/YOUR_WORKSPACE_ID/enrich-ai \
  -H "x-auth-token: YOUR_ADMIN_TOKEN"
# Expected: { "enriched": N }
```

### Step 3 — Doc updates

- `FEATURE_AUDIT.md` — add entry for "AI SEO Advisor (Phase 1: Insight Narration)"
- `data/roadmap.json` — mark item done if it was on the roadmap; if not, no change needed
- `BRAND_DESIGN_LANGUAGE.md` — no color changes (teal used for AI Analysis button, consistent with action color law)
- `data/features.json` — add entry: "AI-powered insight narratives (Premium)" — this is client-impactful

---

## Task Dependencies (summary)

```
Task 0 (haiku) — Contracts
  ├─→ Task 1 (opus)   — seo-advisor.ts          [parallel]
  └─→ Task 2 (sonnet) — Frontend rendering       [parallel]

Task 1 → Task 3 (sonnet) — Compute hook + admin route

[Tasks 2 + 3] → Task 4 (sonnet) — Verification + docs
```

---

## File Ownership

| File | Task |
|---|---|
| `server/db/migrations/071-ai-narrative-column.sql` | 0 (create) |
| `shared/types/analytics.ts` | 0 (modify) |
| `shared/types/narrative.ts` | 0 (modify) |
| `server/analytics-insights-store.ts` | 0 (modify) |
| `server/ws-events.ts` | 0 (modify) |
| `src/lib/wsEvents.ts` | 0 (modify) |
| `server/seo-advisor.ts` | 1 (create) |
| `server/insight-narrative.ts` | 2 (modify) |
| `src/hooks/useWsInvalidation.ts` | 2 (modify) |
| `src/components/client/InsightsDigest.tsx` | 2 (modify) |
| `server/analytics-intelligence.ts` | 3 (modify) |
| `server/routes/insights.ts` | 3 (modify) |

---

## Systemic Improvements

**New pr-check rule to add (post-ship):**
- Rule: `seo-advisor-import` — if `enrichInsightsWithAI` is called anywhere without a `.catch()`, fail. Prevents silent swallowed errors in fire-and-forget paths.

**Test coverage additions:**
- Integration test: `POST /api/insights/:workspaceId/enrich-ai` returns `{ enriched: N }` (port 13342)
- Integration test: mock `callAI` to return a narrative, verify `ai_narrative` is stored in DB (port 13343)
- Integration test: `GET /api/public/insights/:workspaceId/narrative` includes `aiNarrative` field when `ai_narrative` populated (port 13344)
- Unit test: `buildDataSummary` coverage for each insight type (vitest, no port)

**Shared utility opportunity:**
- `buildDataSummary()` in `seo-advisor.ts` is similar in spirit to the narrative map in `insight-narrative.ts`. If they diverge further, consider extracting a shared `insightDataSummary(type, data)` utility. Not worth the abstraction now — wait for a third caller.

---

## Verification Strategy

| Check | Command / Method |
|---|---|
| Types compile | `npm run typecheck` — zero errors |
| Build passes | `npx vite build` — no errors |
| Tests pass | `npx vitest run` — full suite |
| pr-check clean | `npx tsx scripts/pr-check.ts` |
| No purple in InsightsDigest | `grep -r 'purple-' src/components/client/InsightsDigest.tsx` |
| AI enrichment works end-to-end | curl POST + SQLite inspection + browser card update |
| WS broadcast fires | Check server logs for `seo-advisor: enrichment cycle complete` + `INSIGHT_AI_ENRICHED` |
| Premium gate works | Compare Premium vs non-Premium workspace card rendering |

---

## Phase 2 (Future — post Tier 2)

After `emerging_keyword`, `freshness_alert`, and `competitor_alert` insights are built (Tier 2 plan):

1. **Brief CTA** — Admin "Create Content Brief" button on `emerging_keyword` and `ranking_opportunity` insight cards. Calls `POST /api/insights/:workspaceId/generate-brief` with `insightId`. Route reads insight data, calls `createContentRequest()`, updates `insight.pipelineStatus = 'brief_exists'`. Client sees `actionTaken: "Content brief created"`.

2. **Strategic freshness prioritization** — `freshness_alert` insights re-ranked by AI using `businessPriorities` context. Instead of ordering by `analysisGeneratedAt` age, order by AI-computed strategic relevance score. Stored as `impactScore` on the `freshness_alert` insight.

3. **Narration for new insight types** — Add `emerging_keyword`, `freshness_alert`, `competitor_alert` to `NARRATABLE_TYPES` and add cases to `buildDataSummary()`.

These can ship as a single Phase 2 plan after Tier 2 is merged.

---

## Migration Numbering Reference

| Migration | File | Status |
|---|---|---|
| 066 | `066-content-briefs-status.sql` | Merged (current latest) |
| 067–068 | Brand Engine (reserved) | Pending |
| 069–070 | Tier 2 competitor monitoring | Pending |
| **071** | **`071-ai-narrative-column.sql`** | **This plan** |

## Port Reference

| Port | Test file |
|---|---|
| 13319 | (highest existing) |
| 13342 | `tests/integration/seo-advisor.test.ts` (enrich endpoint) |
| 13343 | `tests/integration/seo-advisor-store.test.ts` (DB persistence) |
| 13344 | `tests/integration/seo-advisor-narrative.test.ts` (public API) |
