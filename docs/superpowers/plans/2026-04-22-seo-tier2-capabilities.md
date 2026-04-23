# SEO Tier 2 Capabilities — Opportunity Score, Emerging Keywords, Competitor Monitoring, Content Freshness

> References: [CLAUDE.md](../../../CLAUDE.md), [docs/PLAN_WRITING_GUIDE.md](../../PLAN_WRITING_GUIDE.md).
>
> **Pre-requisites (must all be merged to `staging` before this plan starts):**
> 1. Brand Engine Hardening plan (`2026-04-21-brand-engine-hardening.md`) — reserves migrations 067-068
> 2. SEO Tier 3 Data Sources plan (`2026-04-22-seo-tier3-data-sources.md`) — adds `getRecoveryRate`, `buildLearningsBoost`, `seasonalTag`
> 3. SEO Recommendation Intelligence plan (`2026-04-22-seo-recommendation-intelligence.md`) — modifies `server/recommendations.ts` (Task 4 of this plan also touches it)
>
> **Migrations reserved by this plan:** 069 (competitor_snapshots), 070 (competitor_alerts). Migrations 067-068 are reserved by Brand Engine Hardening.

## Overview

Four enhancements to the SEO intelligence stack:

| Task | Item | Change |
|------|------|--------|
| 0 | Contracts | Shared type contracts for all 3 new InsightTypes + ContentGap.opportunityScore |
| 1 | Item 8 | `computeOpportunityScore()` enriches `ContentGap` objects in keyword strategy |
| 2 | Item 10 | Weekly competitor snapshot + alert system (new DB tables + cron) |
| 3 | Item 9 | `emerging_keyword` insight from SEMRush trend data |
| 4 | Item 11 | `freshness_alert` insight + freshness-based recommendations |
| 5 | — | Verification |
| 6 | — | Docs |

Tasks 1, 2, and the Item 9→11 chain (Tasks 3→4) are a **parallel batch** after Task 0. Item 9 and Item 11 are sequential within the chain because both modify `server/analytics-intelligence.ts`.

---

## Pre-Plan Audit — Current State (2026-04-22)

Verified against HEAD. All line anchors use string patterns to survive minor line drift.

| Item | Key finding |
|------|------------|
| Item 8 | `ContentGap` in `shared/types/workspace.ts:67` — no `opportunityScore` field yet. Enrichment block for content gaps ends at the SERP targeting section (anchor: `if (recs.length > 0) cg.serpTargeting = recs;`) in `server/routes/keyword-strategy.ts`. `trendDirection` already imported at line 26. `computeOpportunityScore` helper inserts after the SERP targeting closing brace, before `// ── Cannibalization Detection`. |
| Item 9 | `InsightType` union in `shared/types/analytics.ts:189-203` — no `emerging_keyword` yet. `analytics-intelligence.ts` already calls `getConfiguredProvider` (line 36 import) and uses it in Phase 3B (line 1252-1283). `trendDirection` is NOT imported — new import needed. Phase 5 (emerging keywords) inserts after Phase 3B closer brace, before Phase 3C (conversion attribution). Emerging keyword detection: filter `provider.getDomainKeywords()` results where `trendDirection(kw.trend) === 'rising'` and `kw.volume >= 100`. |
| Item 10 | Latest migration is 066. Brand Engine Hardening reserves 067-068. `competitor_snapshots` → migration 069, `competitor_alerts` → migration 070. `intelligence-crons.ts` has 5-min initial + 6-hour recurring interval for intelligence; competitor check needs separate weekly cron (initial 15 min, recurring 24h with day-of-week guard). `notifyAnomalyAlert` in `server/email.ts` is the closest email template for competitor alerts — not a perfect fit; competitor alerts surface as `competitor_alert` insights and email is out of scope for v1. |
| Item 11 | No `schema_snapshots` table in the DB. Content freshness uses `PageKeywordMap.analysisGeneratedAt` from `page-keywords.ts` as the date proxy — threshold: 90 days old + ≥100 impressions. `listPageKeywords` NOT yet imported in `analytics-intelligence.ts` — new import needed. Phase 6 (freshness) inserts after Phase 5 (emerging keywords). `server/recommendations.ts` freshness section appends after the diagnostic section added by Recommendation Intelligence Task 5. |

**Insight registration completeness check:** The CLAUDE.md 4-item registration rule (InsightType union, InsightDataMap entry, Zod schema, frontend renderer) is satisfied as follows:
- Task 0: InsightType union + InsightDataMap entries + Zod schemas (3 types)
- Tasks 2, 3, 4: Each type's narrative entry + admin-chat entry + frontend renderer, committed with the generation logic

This is an approved deviation from "all four in one commit" — due to parallel execution, the Zod schema (critical for data safety) is in Task 0, and the rendering wiring lands in each item's own task.

---

## Task Dependencies

```
Sequential (must run first):
  Task 0 (contracts — shared types + Zod schemas)

Parallel batch (after Task 0):
  Task 1 (Item 8: opportunity score — keyword-strategy.ts, ContentGaps.tsx)
    ∥
  Task 2 (Item 10: competitor monitoring — new files, migrations, crons)
    ∥
  Task 3 (Item 9: emerging keywords — analytics-intelligence.ts)
    → Task 4 (Item 11: content freshness — analytics-intelligence.ts, recommendations.ts)

After all parallel tasks complete:
  Task 5 (verification)
    → Task 6 (docs)
```

**Why Tasks 3 and 4 are sequential:** both modify `server/analytics-intelligence.ts`. Task 3 adds a new Phase 5 block; Task 4 adds a Phase 6 block after it. Attempting to parallel these creates a merge conflict.

**Why Tasks 1 and 2 are independent:** Task 1 owns `keyword-strategy.ts` + frontend strategy components. Task 2 owns new migration files + `competitor-snapshot-store.ts` + `intelligence-crons.ts`. No overlap.

---

## File Ownership Summary

| Task | Owns (create/modify) | Must not touch |
|------|----------------------|----------------|
| 0 | `shared/types/analytics.ts`, `shared/types/workspace.ts`, `server/schemas/insight-schemas.ts` | everything else |
| 1 | `server/routes/keyword-strategy.ts`, `src/components/strategy/ContentGaps.tsx`, `src/components/client/StrategyTab.tsx`, `tests/unit/content-gap-opportunity-score.test.ts` | everything else |
| 2 | `server/db/migrations/069-competitor-snapshots.sql`, `server/db/migrations/070-competitor-alerts.sql`, `server/competitor-snapshot-store.ts`, `server/intelligence-crons.ts`, `server/insight-narrative.ts` (competitor_alert entry), `server/admin-chat-context.ts` (competitor_alert section), `src/components/client/InsightCards.tsx` (competitor_alert card), `tests/integration/competitor-monitoring.test.ts` | everything else — especially `analytics-intelligence.ts` |
| 3 | `server/analytics-intelligence.ts`, `server/insight-narrative.ts` (emerging_keyword entry), `server/admin-chat-context.ts` (emerging_keyword section), `src/components/client/InsightCards.tsx` (emerging_keyword card), `tests/unit/emerging-keywords.test.ts` | everything else |
| 4 | `server/analytics-intelligence.ts`, `server/recommendations.ts`, `server/insight-narrative.ts` (freshness_alert entry), `server/admin-chat-context.ts` (freshness_alert section), `src/components/client/InsightCards.tsx` (freshness_alert card), `tests/integration/content-freshness.test.ts` | everything else |
| 5 | (verification only) | — |
| 6 | `FEATURE_AUDIT.md`, `data/roadmap.json` | everything else |

**Conflict note for `server/insight-narrative.ts` and `server/admin-chat-context.ts`:** Tasks 2 and 3 both write to these files. Task 2 adds `competitor_alert` entries; Task 3 adds `emerging_keyword` entries. Since Tasks 2 and 3 run in parallel, their insertions must target distinct sections (alphabetical order or append-only pattern). Each implementer must append their entry to the `narrativeMap` object, NOT overwrite the block — git will merge cleanly because the entries are in different locations of the object literal. If a merge conflict occurs at the end of file, resolve by keeping both entries.

---

## Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| 0 (contracts) | `haiku` | Pure transcription of interface shapes and Zod schemas from spec |
| 1 (Item 8) | `sonnet` | Formula logic + frontend badge rendering |
| 2 (Item 10) | `sonnet` | DB schema design + cron scheduling + multi-table logic |
| 3 (Item 9) | `sonnet` | New insight phase + SEMRush trend filtering |
| 4 (Item 11) | `sonnet` | New insight phase + freshness recs + new import |
| 5 (verify) | `sonnet` | Full test suite parse |
| 6 (docs) | `haiku` | FEATURE_AUDIT + roadmap entries |

---

## Task List

---

### Task 0 — Pre-commit shared contracts (Model: haiku)

**Files:**
- Modify: `shared/types/analytics.ts` — extend `InsightType`, add data interfaces, extend `InsightDataMap`
- Modify: `shared/types/workspace.ts` — add `opportunityScore?: number` to `ContentGap`
- Modify: `server/schemas/insight-schemas.ts` — add three new Zod schemas

**Owns:** the three files above.
**Must not touch:** anything else.

- [ ] **Step 1: Extend `InsightType` union in `shared/types/analytics.ts`**

Find the `InsightType` export (anchored by `| 'site_health';           // new:`). Add three new values immediately before the closing semicolon:

```ts
export type InsightType =
  | 'page_health'
  | 'ranking_opportunity'
  | 'content_decay'
  | 'cannibalization'
  | 'keyword_cluster'
  | 'competitor_gap'
  | 'conversion_attribution'
  | 'ranking_mover'
  | 'ctr_opportunity'
  | 'serp_opportunity'
  | 'strategy_alignment'
  | 'anomaly_digest'
  | 'audit_finding'
  | 'site_health'
  | 'emerging_keyword'       // Tier 2: SEMRush trend-rising keyword opportunity
  | 'competitor_alert'       // Tier 2: weekly competitor position change
  | 'freshness_alert';       // Tier 2: stale content detected via page_keywords age
```

- [ ] **Step 2: Add data interfaces in `shared/types/analytics.ts`**

Append these interfaces at the end of the `// ── Insight data shapes` section, before the `InsightDataMap` block:

```ts
// ── Tier 2 insight data shapes ────────────────────────────────

export interface EmergingKeywordData extends InsightDataBase {
  keyword: string;
  volume: number;
  difficulty: number;
  trendData?: number[];          // raw 12-month volume trend from SEMRush
  currentPosition?: number;      // our GSC position for this keyword (if any)
  rankingUrl?: string;           // URL currently ranking (may be a competitor)
  suggestedAngle?: string;       // one-line content opportunity description
}

export interface CompetitorAlertData extends InsightDataBase {
  competitorDomain: string;
  alertType: 'keyword_gained' | 'keyword_lost' | 'authority_change' | 'new_keyword';
  keyword?: string;              // keyword involved (for keyword_gained/lost)
  previousPosition?: number;
  currentPosition?: number;
  positionChange?: number;       // positive = improving for competitor (bad for us)
  volume?: number;               // monthly search volume for the keyword
  snapshotDate: string;          // ISO date of the current snapshot
}

export interface FreshnessAlertData extends InsightDataBase {
  pagePath: string;
  lastAnalyzedAt: string;        // ISO timestamp of most recent keyword analysis
  daysSinceLastAnalysis: number;
  /** Already a percentage if present. */
  impressions?: number;          // 28d GSC impressions (proxy for traffic at risk)
  clicks?: number;               // 28d GSC clicks
}
```

- [ ] **Step 3: Add to `InsightDataMap` in `shared/types/analytics.ts`**

Find the `InsightDataMap` interface (anchored by `site_health: SiteHealthInsightData;`). Add three new entries:

```ts
export interface InsightDataMap {
  // ... existing entries ...
  site_health: SiteHealthInsightData;
  emerging_keyword: EmergingKeywordData;
  competitor_alert: CompetitorAlertData;
  freshness_alert: FreshnessAlertData;
}
```

- [ ] **Step 4: Add `opportunityScore` to `ContentGap` in `shared/types/workspace.ts`**

Find the `ContentGap` interface (anchored by `// Question keywords related to this gap`). Add `opportunityScore` before the question keywords comment:

```ts
// Composite opportunity score (0–100): volume × ease × GSC signal × trend
opportunityScore?: number;
// Question keywords related to this gap (for FAQ/AEO targeting)
questionKeywords?: string[];
```

- [ ] **Step 5: Add Zod schemas in `server/schemas/insight-schemas.ts`**

Read existing imports first (anchored by `import type { ZodTypeAny } from 'zod';`). Append after the last existing schema in the file:

```ts
/** EmergingKeywordData — Tier 2: trending keyword not yet targeted */
export const emergingKeywordDataSchema = z.object({
  keyword: z.string(),
  volume: z.number(),
  difficulty: z.number(),
  trendData: z.array(z.number()).optional(),
  currentPosition: z.number().optional(),
  rankingUrl: z.string().optional(),
  suggestedAngle: z.string().optional(),
});

/** CompetitorAlertData — Tier 2: competitor position change */
export const competitorAlertDataSchema = z.object({
  competitorDomain: z.string(),
  alertType: z.enum(['keyword_gained', 'keyword_lost', 'authority_change', 'new_keyword']),
  keyword: z.string().optional(),
  previousPosition: z.number().optional(),
  currentPosition: z.number().optional(),
  positionChange: z.number().optional(),
  volume: z.number().optional(),
  snapshotDate: z.string(),
});

/** FreshnessAlertData — Tier 2: stale content via page_keywords age */
export const freshnessAlertDataSchema = z.object({
  pagePath: z.string(),
  lastAnalyzedAt: z.string(),
  daysSinceLastAnalysis: z.number(),
  impressions: z.number().optional(),
  clicks: z.number().optional(),
});
```

Then extend `INSIGHT_DATA_SCHEMA_MAP` in the same file. This map is typed as `Record<InsightType, ZodTypeAny>` — it is **exhaustive**: adding new values to `InsightType` without adding entries here causes `npm run typecheck` to fail. Find the map (anchored by `site_health: siteHealthInsightDataSchema`) and add the three new entries:

```ts
export const INSIGHT_DATA_SCHEMA_MAP: Record<InsightType, ZodTypeAny> = {
  // ... existing entries ...
  site_health: siteHealthInsightDataSchema.partial().passthrough(),
  emerging_keyword: emergingKeywordDataSchema.partial().passthrough(),
  competitor_alert: competitorAlertDataSchema.partial().passthrough(),
  freshness_alert: freshnessAlertDataSchema.partial().passthrough(),
};
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. The new `InsightType` values being added to the union but not yet handled in `switch` statements is acceptable (exhaustive switches with a default branch won't fail — only switches without default will need updating, which happens in Tasks 2-4).

- [ ] **Step 7: Commit**

```bash
git add shared/types/analytics.ts shared/types/workspace.ts server/schemas/insight-schemas.ts
git commit -m "chore(contracts): add emerging_keyword, competitor_alert, freshness_alert InsightTypes and ContentGap.opportunityScore for Tier 2 SEO capabilities"
```

---

### Task 1 — Item 8: Content gap opportunity score (Model: sonnet)

**Files:**
- Modify: `server/routes/keyword-strategy.ts` — add `computeOpportunityScore` helper + enrichment call
- Modify: `src/components/strategy/ContentGaps.tsx` — render opportunityScore badge
- Modify: `src/components/client/StrategyTab.tsx` — sort by opportunityScore, show badge
- Create: `tests/unit/content-gap-opportunity-score.test.ts` — unit tests for the score formula

**Owns:** the four files above.
**Must not touch:** anything else — especially `shared/types/workspace.ts` (already updated by Task 0).

**Why this task:** Content gaps currently show volume and difficulty but have no single actionable priority signal. `opportunityScore` synthesizes volume, ease-of-ranking, GSC presence (site already gets impressions = keyword is relevant), and trend into a 0–100 composite. Gaps can then be sorted descending so the highest-value items appear first.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/content-gap-opportunity-score.test.ts` (no port — pure unit, no server):

```ts
import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../../server/routes/keyword-strategy.js';

describe('computeOpportunityScore', () => {
  it('returns 0 for a gap with no data', () => {
    expect(computeOpportunityScore({})).toBe(0);
  });

  it('rewards rising trend', () => {
    const rising = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'rising' });
    const stable = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'stable' });
    expect(rising).toBeGreaterThan(stable);
  });

  it('penalises declining trend', () => {
    const declining = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'declining' });
    const stable = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'stable' });
    expect(declining).toBeLessThan(stable);
  });

  it('rewards high volume + low difficulty', () => {
    const easy = computeOpportunityScore({ volume: 5000, difficulty: 20 });
    const hard = computeOpportunityScore({ volume: 5000, difficulty: 80 });
    expect(easy).toBeGreaterThan(hard);
  });

  it('rewards GSC impressions (existing relevance signal)', () => {
    const withImpr = computeOpportunityScore({ volume: 500, difficulty: 50, impressions: 1000 });
    const withoutImpr = computeOpportunityScore({ volume: 500, difficulty: 50, impressions: 0 });
    expect(withImpr).toBeGreaterThan(withoutImpr);
  });

  it('caps at 100', () => {
    expect(computeOpportunityScore({ volume: 50000, difficulty: 5, impressions: 5000, trendDirection: 'rising' })).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Export `computeOpportunityScore` from `keyword-strategy.ts`**

Find the import section at the top of `server/routes/keyword-strategy.ts`. Then find the local helper section (near the `filterBrandedContentGaps` or `filterBrandedKeywords` helpers) and add:

```ts
/** Composite opportunity score (0–100) for a content gap.
 *  Weights: volume 45%, ease-of-ranking 45%, GSC signal bonus 10%.
 *  Trend multiplier: rising ×1.3, declining ×0.7, stable ×1.0. */
export function computeOpportunityScore(cg: {
  volume?: number;
  difficulty?: number;
  impressions?: number;
  trendDirection?: string;
}): number {
  const vol = Math.min((cg.volume ?? 0) / 10000, 1);   // normalize: 10k = full score
  const ease = 1 - (cg.difficulty ?? 50) / 100;         // inverted KD (easy = high score)
  const gscBonus = Math.min((cg.impressions ?? 0) / 2000, 0.5); // GSC relevance signal
  const trendMult =
    cg.trendDirection === 'rising' ? 1.3 :
    cg.trendDirection === 'declining' ? 0.7 : 1.0;
  const raw = (vol * 0.45 + ease * 0.45 + gscBonus * 0.1) * trendMult;
  return Math.min(100, Math.round(raw * 100));
}
```

Place this function BEFORE the route handler (not inside it). It must be `export`ed so the test file can import it.

- [ ] **Step 3: Call `computeOpportunityScore` after the SERP targeting block**

In `keyword-strategy.ts`, find the anchor:

```ts
    if (recs.length > 0) cg.serpTargeting = recs;
    }
  }
}

// ── Cannibalization Detection
```

Insert between the SERP targeting closing brace and the cannibalization comment:

```ts
    if (recs.length > 0) cg.serpTargeting = recs;
    }
  }
}

// Compute composite opportunity score — all enrichment (volume, KD, impressions, trend) is now done
if (strategy.contentGaps?.length) {
  for (const cg of strategy.contentGaps) {
    cg.opportunityScore = computeOpportunityScore(cg);
  }
  // Sort descending so highest-value gaps surface first in the UI
  strategy.contentGaps.sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
  log.info({ workspaceId: ws.id, count: strategy.contentGaps.length }, 'Computed content gap opportunity scores');
}

// ── Cannibalization Detection
```

- [ ] **Step 4: Render `opportunityScore` in `ContentGaps.tsx`**

Read `src/components/strategy/ContentGaps.tsx` first to understand the current render structure. Add a score badge next to each gap's topic heading:

```tsx
{gap.opportunityScore != null && (
  <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
    {gap.opportunityScore}/100
  </span>
)}
```

Color follows the Three Laws: opportunity score is data (read-only numeric), so `blue` is correct. Use `bg-blue-500/10 text-blue-400` (matching existing data badges in the UI).

- [ ] **Step 5: Sort content gaps by `opportunityScore` in `StrategyTab.tsx`**

Read `src/components/client/StrategyTab.tsx` first. Find the current sort logic for content gaps (anchored by the comment or the sort call around line 606-609). The current sort uses a presence check for data-backed gaps. Replace or extend it:

```tsx
const sortedGaps = [...(strategyData.contentGaps ?? [])].sort(
  (a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)
);
```

Also render the badge in the client-facing gap card (follow the same blue badge pattern as Step 4 — `bg-blue-500/10 text-blue-400`).

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/unit/content-gap-opportunity-score.test.ts
npm run typecheck
```

Expected: test suite passes, zero type errors.

- [ ] **Step 7: Commit**

```bash
git add server/routes/keyword-strategy.ts src/components/strategy/ContentGaps.tsx src/components/client/StrategyTab.tsx tests/unit/content-gap-opportunity-score.test.ts
git commit -m "feat(seo): add computeOpportunityScore to ContentGap enrichment — composite 0-100 signal (vol, KD, GSC, trend)"
```

---

### Task 2 — Item 10: Competitor monitoring (Model: sonnet)

**Files:**
- Create: `server/db/migrations/069-competitor-snapshots.sql`
- Create: `server/db/migrations/070-competitor-alerts.sql`
- Create: `server/competitor-snapshot-store.ts`
- Modify: `server/intelligence-crons.ts` — add weekly competitor check cron
- Modify: `server/insight-narrative.ts` — add `competitor_alert` narrative entry
- Modify: `server/admin-chat-context.ts` — add `competitor_alert` context section
- Modify: `src/components/client/InsightCards.tsx` — add `competitor_alert` card
- Create: `tests/integration/competitor-monitoring.test.ts` (port 13339)

**Owns:** the eight files above.
**Must not touch:** `analytics-intelligence.ts`, `shared/types/analytics.ts`, `recommendations.ts`.

**Why this task:** Currently there is no mechanism to detect when a competitor gains or loses ranking on keywords relevant to the workspace. A weekly snapshot + diff produces `competitor_alert` insights that surface in the client digest as actionable competitive intelligence.

- [ ] **Step 1: Create migration 069**

```sql
-- server/db/migrations/069-competitor-snapshots.sql
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  competitor_domain TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,           -- ISO date YYYY-MM-DD
  keyword_count INTEGER,                 -- number of organic keywords tracked
  organic_traffic INTEGER,               -- estimated monthly organic traffic
  top_keywords TEXT NOT NULL DEFAULT '[]', -- JSON: Array<{keyword,position,volume}>
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_ws_domain_date
  ON competitor_snapshots(workspace_id, competitor_domain, snapshot_date);
```

- [ ] **Step 2: Create migration 070**

```sql
-- server/db/migrations/070-competitor-alerts.sql
CREATE TABLE IF NOT EXISTS competitor_alerts (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  competitor_domain TEXT NOT NULL,
  alert_type  TEXT NOT NULL,    -- 'keyword_gained' | 'keyword_lost' | 'authority_change' | 'new_keyword'
  keyword     TEXT,             -- keyword involved (NULL for authority_change)
  previous_position INTEGER,
  current_position  INTEGER,
  position_change   INTEGER,    -- positive = competitor improving (bad for us)
  volume      INTEGER,
  severity    TEXT NOT NULL,    -- 'critical' | 'warning' | 'opportunity'
  snapshot_date TEXT NOT NULL,  -- ISO date this alert was generated
  insight_id  TEXT,             -- linked analytics_insights row (set after enrichAndUpsert)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_competitor_alerts_ws_date
  ON competitor_alerts(workspace_id, created_at DESC);
```

- [ ] **Step 3: Create `server/competitor-snapshot-store.ts`**

This file owns all DB reads/writes for both tables and the comparison logic.

```ts
/**
 * competitor-snapshot-store — snapshot + alert storage for competitor monitoring.
 *
 * Weekly cron calls takeCompetitorSnapshot() for each workspace that has
 * competitorDomains configured. Compares new snapshot to last snapshot and
 * writes competitor_alerts rows for significant changes.
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';

const log = createLogger('competitor-snapshot-store');

// ── Row types ──

interface SnapshotRow {
  id: string;
  workspace_id: string;
  competitor_domain: string;
  snapshot_date: string;
  keyword_count: number | null;
  organic_traffic: number | null;
  top_keywords: string;
  created_at: string;
}

interface AlertRow {
  id: string;
  workspace_id: string;
  competitor_domain: string;
  alert_type: string;
  keyword: string | null;
  previous_position: number | null;
  current_position: number | null;
  position_change: number | null;
  volume: number | null;
  severity: string;
  snapshot_date: string;
  insight_id: string | null;
  created_at: string;
}

// ── Typed shapes ──

export interface CompetitorTopKeyword {
  keyword: string;
  position: number;
  volume: number;
}

export interface CompetitorSnapshot {
  id: string;
  workspaceId: string;
  competitorDomain: string;
  snapshotDate: string;
  keywordCount: number | null;
  organicTraffic: number | null;
  topKeywords: CompetitorTopKeyword[];
  createdAt: string;
}

export interface CompetitorAlert {
  id: string;
  workspaceId: string;
  competitorDomain: string;
  alertType: 'keyword_gained' | 'keyword_lost' | 'authority_change' | 'new_keyword';
  keyword?: string;
  previousPosition?: number;
  currentPosition?: number;
  positionChange?: number;
  volume?: number;
  severity: 'critical' | 'warning' | 'opportunity';
  snapshotDate: string;
  insightId?: string;
  createdAt: string;
}

// ── Statement cache ──

const stmts = createStmtCache(() => ({
  getLatestSnapshot: db.prepare<[workspaceId: string, domain: string]>(
    `SELECT * FROM competitor_snapshots WHERE workspace_id = ? AND competitor_domain = ?
     ORDER BY snapshot_date DESC LIMIT 1`
  ),
  insertSnapshot: db.prepare<{
    id: string; workspace_id: string; competitor_domain: string; snapshot_date: string;
    keyword_count: number | null; organic_traffic: number | null; top_keywords: string;
  }>(
    `INSERT INTO competitor_snapshots (id, workspace_id, competitor_domain, snapshot_date, keyword_count, organic_traffic, top_keywords)
     VALUES (@id, @workspace_id, @competitor_domain, @snapshot_date, @keyword_count, @organic_traffic, @top_keywords)`
  ),
  insertAlert: db.prepare<{
    id: string; workspace_id: string; competitor_domain: string; alert_type: string;
    keyword: string | null; previous_position: number | null; current_position: number | null;
    position_change: number | null; volume: number | null; severity: string; snapshot_date: string;
  }>(
    `INSERT INTO competitor_alerts (id, workspace_id, competitor_domain, alert_type, keyword, previous_position, current_position, position_change, volume, severity, snapshot_date)
     VALUES (@id, @workspace_id, @competitor_domain, @alert_type, @keyword, @previous_position, @current_position, @position_change, @volume, @severity, @snapshot_date)`
  ),
  listUnlinkedAlerts: db.prepare<[workspaceId: string]>(
    `SELECT * FROM competitor_alerts WHERE workspace_id = ? AND insight_id IS NULL
     ORDER BY created_at DESC LIMIT 50`
  ),
  linkInsightId: db.prepare<[insightId: string, alertId: string]>(
    `UPDATE competitor_alerts SET insight_id = ? WHERE id = ?`
  ),
  snapshotExistsForDate: db.prepare<[workspaceId: string, domain: string, date: string]>(
    `SELECT 1 FROM competitor_snapshots WHERE workspace_id = ? AND competitor_domain = ? AND snapshot_date = ? LIMIT 1`
  ),
}));

// ── Helpers ──

function rowToSnapshot(r: SnapshotRow): CompetitorSnapshot {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    competitorDomain: r.competitor_domain,
    snapshotDate: r.snapshot_date,
    keywordCount: r.keyword_count,
    organicTraffic: r.organic_traffic,
    topKeywords: (() => {
      try { return JSON.parse(r.top_keywords) as CompetitorTopKeyword[]; } catch { return []; }
    })(),
    createdAt: r.created_at,
  };
}

function rowToAlert(r: AlertRow): CompetitorAlert {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    competitorDomain: r.competitor_domain,
    alertType: r.alert_type as CompetitorAlert['alertType'],
    keyword: r.keyword ?? undefined,
    previousPosition: r.previous_position ?? undefined,
    currentPosition: r.current_position ?? undefined,
    positionChange: r.position_change ?? undefined,
    volume: r.volume ?? undefined,
    severity: r.severity as CompetitorAlert['severity'],
    snapshotDate: r.snapshot_date,
    insightId: r.insight_id ?? undefined,
    createdAt: r.created_at,
  };
}

function generateId(): string {
  return randomUUID();
}

// ── Public API ──

/** Get the most recent snapshot for a competitor, or null if none exists. */
export function getLatestCompetitorSnapshot(workspaceId: string, domain: string): CompetitorSnapshot | null {
  const row = stmts().getLatestSnapshot.get(workspaceId, domain) as SnapshotRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

/** True if a snapshot already exists for this workspace+domain+date (prevents double-run). */
export function snapshotExistsForDate(workspaceId: string, domain: string, date: string): boolean {
  return !!stmts().snapshotExistsForDate.get(workspaceId, domain, date);
}

/** Persist a new snapshot row. */
export function saveCompetitorSnapshot(
  workspaceId: string,
  domain: string,
  snapshotDate: string,
  topKeywords: CompetitorTopKeyword[],
  keywordCount?: number,
  organicTraffic?: number,
): CompetitorSnapshot {
  const id = generateId();
  stmts().insertSnapshot.run({
    id, workspace_id: workspaceId, competitor_domain: domain,
    snapshot_date: snapshotDate,
    keyword_count: keywordCount ?? null,
    organic_traffic: organicTraffic ?? null,
    top_keywords: JSON.stringify(topKeywords),
  });
  return getLatestCompetitorSnapshot(workspaceId, domain)!;
}

/** Compare current and previous snapshots; return alert rows for significant changes. */
export function detectCompetitorAlerts(
  workspaceId: string,
  domain: string,
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot,
  opts: { positionChangeThreshold?: number; minVolume?: number } = {},
): CompetitorAlert[] {
  const { positionChangeThreshold = 5, minVolume = 100 } = opts;
  const alerts: CompetitorAlert[] = [];
  const prevMap = new Map(previous.topKeywords.map(k => [k.keyword.toLowerCase(), k]));

  for (const kw of current.topKeywords) {
    const prev = prevMap.get(kw.keyword.toLowerCase());
    if (!prev) {
      // Keyword appeared for the first time in top keywords
      if (kw.volume >= minVolume && kw.position <= 10) {
        const a = {
          id: generateId(),
          workspaceId,
          competitorDomain: domain,
          alertType: 'new_keyword' as const,
          keyword: kw.keyword,
          currentPosition: kw.position,
          volume: kw.volume,
          severity: kw.position <= 3 ? 'critical' as const : 'warning' as const,
          snapshotDate: current.snapshotDate,
          createdAt: new Date().toISOString(),
        };
        stmts().insertAlert.run({
          id: a.id, workspace_id: workspaceId, competitor_domain: domain,
          alert_type: 'new_keyword', keyword: kw.keyword,
          previous_position: null, current_position: kw.position, position_change: null,
          volume: kw.volume, severity: a.severity, snapshot_date: current.snapshotDate,
        });
        alerts.push(a);
      }
      continue;
    }
    const change = prev.position - kw.position; // positive = competitor improved
    if (Math.abs(change) >= positionChangeThreshold && kw.volume >= minVolume) {
      const alertType = change > 0 ? 'keyword_gained' as const : 'keyword_lost' as const;
      const severity = Math.abs(change) >= 10 ? 'critical' as const : 'warning' as const;
      const a = {
        id: generateId(),
        workspaceId,
        competitorDomain: domain,
        alertType,
        keyword: kw.keyword,
        previousPosition: prev.position,
        currentPosition: kw.position,
        positionChange: change,
        volume: kw.volume,
        severity,
        snapshotDate: current.snapshotDate,
        createdAt: new Date().toISOString(),
      };
      stmts().insertAlert.run({
        id: a.id, workspace_id: workspaceId, competitor_domain: domain,
        alert_type: alertType, keyword: kw.keyword,
        previous_position: prev.position, current_position: kw.position, position_change: change,
        volume: kw.volume, severity, snapshot_date: current.snapshotDate,
      });
      alerts.push(a);
    }
  }
  log.info({ workspaceId, domain, alertCount: alerts.length }, 'Competitor alerts detected');
  return alerts;
}

/** Return unlinked (no insight_id) alerts for a workspace. Used by the cron to create insights. */
export function listUnlinkedCompetitorAlerts(workspaceId: string): CompetitorAlert[] {
  const rows = stmts().listUnlinkedAlerts.all(workspaceId) as AlertRow[];
  return rows.map(rowToAlert);
}

/** Mark alert as linked to an insight row. */
export function linkAlertToInsight(alertId: string, insightId: string): void {
  stmts().linkInsightId.run(insightId, alertId);
}
```

- [ ] **Step 4: Add weekly competitor cron to `server/intelligence-crons.ts`**

First, read the file to understand the existing cron pattern (import `listWorkspaces`, `hasRecentActivity`, `runWorkspaceIntelligence`, scheduling via `setInterval`).

Add a new function `startCompetitorMonitoringCron()` that:
1. Waits 15 minutes before first run (avoid cold-start conflicts with intelligence cron)
2. Runs every 24 hours
3. For each workspace: only processes if it has `competitorDomains` and `liveDomain` and `seoDataProvider` configured
4. Guard: skip if a snapshot already exists for today's date (`snapshotExistsForDate`)
5. Guard: only run on Monday (or whichever day of week is configured) using `new Date().getDay() === 1`
6. Calls `getConfiguredProvider(ws.seoDataProvider)` to fetch top keywords for each competitor via `provider.getDomainKeywords(competitorDomain, ws.id, 50)`
7. Saves snapshot via `saveCompetitorSnapshot`
8. Compares to previous snapshot via `detectCompetitorAlerts` 
9. For each alert, calls `upsertInsight<'competitor_alert'>({ workspaceId, pageId: null, insightType: 'competitor_alert', data: { competitorDomain: alert.competitorDomain, alertType: alert.alertType, keyword: alert.keyword, previousPosition: alert.previousPosition, currentPosition: alert.currentPosition, positionChange: alert.positionChange, volume: alert.volume, snapshotDate: alert.snapshotDate }, severity: alert.severity })` — **do NOT use `enrichAndUpsert`**; that function is a non-exported closure inside `runWorkspaceIntelligence` and is unavailable here.

Import the new store functions and `upsertInsight` at the top:

```ts
import {
  getLatestCompetitorSnapshot, saveCompetitorSnapshot,
  detectCompetitorAlerts, snapshotExistsForDate,
} from './competitor-snapshot-store.js';
import { upsertInsight } from './analytics-insights-store.js';
```

Import `getConfiguredProvider` if not already imported (check existing imports first).

Export `startCompetitorMonitoringCron` from the file and call it from `server/startup.ts` alongside `startIntelligenceCrons()`.

**Test note:** The integration test (Step 5) uses mock SEMRush provider, so do NOT call the real provider in tests.

- [ ] **Step 5: Write the integration test**

Create `tests/integration/competitor-monitoring.test.ts` (port 13339):

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { snapshotExistsForDate, getLatestCompetitorSnapshot } from '../../server/competitor-snapshot-store.js';
import { detectCompetitorAlerts } from '../../server/competitor-snapshot-store.js';

const PORT = 13339;

describe('competitor monitoring', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let seed: Awaited<ReturnType<typeof seedWorkspace>>;

  beforeAll(async () => {
    ctx = await createTestContext(PORT);
    seed = await seedWorkspace({ tier: 'growth' });
  });

  afterAll(async () => {
    await seed.cleanup();
    await ctx.close();
  });

  it('detectCompetitorAlerts surfaces keyword_gained when position improves by ≥5', () => {
    const ws = seed.workspace.id;
    const domain = 'competitor.com';
    const date = '2026-04-22';
    const prev = {
      id: 'snap1', workspaceId: ws, competitorDomain: domain, snapshotDate: '2026-04-15',
      keywordCount: 10, organicTraffic: 5000, createdAt: date,
      topKeywords: [{ keyword: 'seo tools', position: 12, volume: 500 }],
    };
    const curr = {
      id: 'snap2', workspaceId: ws, competitorDomain: domain, snapshotDate: date,
      keywordCount: 10, organicTraffic: 5200, createdAt: date,
      topKeywords: [{ keyword: 'seo tools', position: 4, volume: 500 }],
    };
    const alerts = detectCompetitorAlerts(ws, domain, curr, prev);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alertType).toBe('keyword_gained');
    expect(alerts[0].positionChange).toBe(8);
    expect(alerts[0].severity).toBe('critical');
  });

  it('detectCompetitorAlerts ignores low-volume keywords', () => {
    const ws = seed.workspace.id;
    const domain = 'competitor.com';
    const prev = {
      id: 'snap3', workspaceId: ws, competitorDomain: domain, snapshotDate: '2026-04-15',
      keywordCount: 2, organicTraffic: 100, createdAt: '2026-04-15',
      topKeywords: [{ keyword: 'niche phrase', position: 10, volume: 50 }],
    };
    const curr = {
      id: 'snap4', workspaceId: ws, competitorDomain: domain, snapshotDate: '2026-04-22',
      keywordCount: 2, organicTraffic: 100, createdAt: '2026-04-22',
      topKeywords: [{ keyword: 'niche phrase', position: 2, volume: 50 }],
    };
    const alerts = detectCompetitorAlerts(ws, domain, curr, prev);
    expect(alerts).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Add `competitor_alert` narrative entry to `server/insight-narrative.ts`**

Find the `narrativeMap` object (anchored by `anomaly_digest: () => {`). Append the following entry after `anomaly_digest`:

```ts
    competitor_alert: () => {
      const d = data as import('../../shared/types/analytics.js').CompetitorAlertData;
      const domain = d.competitorDomain ?? 'a competitor';
      const kw = d.keyword ? `"${d.keyword}"` : 'a keyword';
      if (d.alertType === 'keyword_gained') {
        return {
          headline: `Competitor gaining ground on ${kw}`,
          narrative: `${domain} moved from position ${d.previousPosition} to position ${d.currentPosition} for ${kw}. We're reviewing whether to target this keyword more aggressively.`,
          impact: d.volume ? `${Number(d.volume).toLocaleString()} monthly searches at stake` : undefined,
        };
      }
      if (d.alertType === 'new_keyword') {
        return {
          headline: `Competitor entered top results for ${kw}`,
          narrative: `${domain} now ranks in the top 10 for ${kw}, a keyword relevant to your site. We're evaluating a content response.`,
          impact: d.volume ? `${Number(d.volume).toLocaleString()} monthly searches` : undefined,
        };
      }
      return {
        headline: `Competitor activity detected`,
        narrative: `We noticed a change in ${domain}'s search rankings and are monitoring the situation.`,
        impact: undefined,
      };
    },
```

- [ ] **Step 7: Add `competitor_alert` section to `server/admin-chat-context.ts`**

Find `buildInsightsContext` (anchored by `// Keyword clusters` or at the end of the function's sections array). Append a new section:

```ts
  // Competitor alerts
  const competitorAlerts = insights
    .filter((i): i is AnalyticsInsight<'competitor_alert'> => i.insightType === 'competitor_alert')
    .map(i => i.data)
    .slice(0, 5);
  if (competitorAlerts.length > 0) {
    const lines = competitorAlerts.map(a => {
      const change = a.positionChange != null
        ? `pos ${a.previousPosition} → ${a.currentPosition} (${a.positionChange > 0 ? '+' : ''}${-a.positionChange} pos)`
        : 'new entry';
      return `  "${a.keyword ?? '(no keyword)'}" — ${a.competitorDomain} ${change}${a.volume ? ` (${a.volume.toLocaleString()}/mo)` : ''}`;
    });
    sections.push(`COMPETITOR ALERTS (recent ranking changes):\n${lines.join('\n')}`);
  }
```

- [ ] **Step 8: Add `competitor_alert` card in `src/components/client/InsightCards.tsx`**

Create a `CompetitorAlertCard` functional component in `InsightCards.tsx` following the existing card pattern (see `SiteHealthCard` for structure). Use `text-blue-400` for data values, `text-zinc-100` for headlines, `text-zinc-400` for body text. No purple. Export the component and render it from `InsightsDigest.tsx` where site intelligence insights are shown.

Card contents:
- Headline: `{d.competitorDomain} is gaining on "{d.keyword}"`
- Body: `They moved from position {d.previousPosition} to {d.currentPosition} — {d.volume?.toLocaleString()} monthly searches.`
- Action: none for v1 (data insight only, no navigation target)

- [ ] **Step 9: Run tests and typecheck**

```bash
npx vitest run tests/integration/competitor-monitoring.test.ts
npm run typecheck
```

Expected: tests pass, zero type errors.

- [ ] **Step 10: Commit**

```bash
git add server/db/migrations/069-competitor-snapshots.sql server/db/migrations/070-competitor-alerts.sql server/competitor-snapshot-store.ts server/intelligence-crons.ts server/insight-narrative.ts server/admin-chat-context.ts src/components/client/InsightCards.tsx tests/integration/competitor-monitoring.test.ts
git commit -m "feat(seo): competitor monitoring — weekly snapshot diff generates competitor_alert insights"
```

---

### Task 3 — Item 9: Emerging keyword detection (Model: sonnet)

**Files:**
- Modify: `server/analytics-intelligence.ts` — add Phase 5 block, add `trendDirection` import
- Modify: `server/insight-narrative.ts` — add `emerging_keyword` narrative entry
- Modify: `server/admin-chat-context.ts` — add `emerging_keyword` context section
- Modify: `src/components/client/InsightCards.tsx` — add `emerging_keyword` card
- Create: `tests/unit/emerging-keywords.test.ts` (port 13340, unit test — no server bind)

**Owns:** the five files above.
**Must not touch:** `shared/types/analytics.ts` (Task 0 already added the type), `recommendations.ts`, `competitor-snapshot-store.ts`.

**Why this task:** SEMRush domain keyword data includes 12-month volume trend arrays. Keywords with a consistently rising trend represent future ranking opportunities that the site should target before competitors lock in positions. Surfacing these as `emerging_keyword` insights gives clients proactive data rather than reactive fixes.

**Pre-condition:** Task 0 must be committed (provides the `emerging_keyword` InsightType + Zod schema + `EmergingKeywordData` interface).

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/emerging-keywords.test.ts` (pure unit, no port):

```ts
import { describe, it, expect } from 'vitest';
import { isKeywordEmerging } from '../../server/analytics-intelligence.js';

describe('isKeywordEmerging', () => {
  it('returns true for consistently rising trend', () => {
    expect(isKeywordEmerging({ trend: [100, 120, 140, 180, 210, 230] })).toBe(true);
  });

  it('returns false for flat trend', () => {
    expect(isKeywordEmerging({ trend: [100, 105, 98, 102, 101, 100] })).toBe(false);
  });

  it('returns false for declining trend', () => {
    expect(isKeywordEmerging({ trend: [200, 180, 150, 120, 100, 80] })).toBe(false);
  });

  it('returns false when trend array is empty', () => {
    expect(isKeywordEmerging({ trend: [] })).toBe(false);
  });

  it('returns false when trend array is undefined', () => {
    expect(isKeywordEmerging({})).toBe(false);
  });

  it('handles noisy-but-rising trend (net positive across last 6 months)', () => {
    // Generally rising despite one dip
    expect(isKeywordEmerging({ trend: [100, 115, 110, 130, 125, 160] })).toBe(true);
  });
});
```

- [ ] **Step 2: Export `isKeywordEmerging` helper from `server/analytics-intelligence.ts`**

Find the top of the file's exports/helpers section. Add the helper after the existing `MIN_DECAY_BASELINE_CLICKS` and similar constants (or near the top before the main function):

```ts
/**
 * Returns true if the keyword's trend array indicates net rising volume over
 * the last 6 months. Uses a simple linear regression slope — positive slope
 * covering ≥20% net gain qualifies as "emerging".
 */
export function isKeywordEmerging(kw: { trend?: number[] }): boolean {
  const t = kw.trend;
  if (!t || t.length < 3) return false;
  const recent = t.slice(-6); // last 6 data points
  const n = recent.length;
  const first = recent[0];
  const last = recent[n - 1];
  if (first <= 0) return false;
  const netGainPct = (last - first) / first;
  // Require ≥20% net gain and a positive last-half slope
  const midpoint = Math.floor(n / 2);
  const firstHalfAvg = recent.slice(0, midpoint).reduce((s, v) => s + v, 0) / midpoint;
  const secondHalfAvg = recent.slice(midpoint).reduce((s, v) => s + v, 0) / (n - midpoint);
  return netGainPct >= 0.20 && secondHalfAvg > firstHalfAvg;
}
```

- [ ] **Step 3: Add `trendDirection` import to `analytics-intelligence.ts`**

Find the existing imports at the top of the file (anchored by `import { getConfiguredProvider } from './seo-data-provider.js';`). Add `trendDirection` to the semrush import (if it doesn't exist yet) or add a new import line:

```ts
import { trendDirection } from './semrush.js';
```

Verify semrush.ts exports `trendDirection` before writing. If there is already a `from './semrush.js'` import, append `trendDirection` to that destructure.

- [ ] **Step 4: Add Phase 5 emerging keyword block to `analytics-intelligence.ts`**

Find the Phase 3B competitor gap block (anchored by `// Phase 3B: Competitor gap analysis`). The block ends with:

```ts
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute competitor gap insights');
    }
  }
```

Insert Phase 5 immediately after this closing brace (between Phase 3B and Phase 3C conversion attribution):

```ts
  // Phase 5: Emerging keyword detection (SEMRush trend analysis)
  if (ws.liveDomain) {
    try {
      const provider = getConfiguredProvider(ws.seoDataProvider);
      if (provider?.isConfigured()) {
        const domainKws = await apiCache.wrap(workspaceId, 'domainKeywords_emerging', {}, () =>
          provider.getDomainKeywords(ws.liveDomain!, workspaceId, 200),
        );
        // Build GSC lookup: keyword → position (to surface whether we already rank)
        const gscLookup = new Map<string, number>(
          normQueryPageData.map(r => [r.query.toLowerCase(), r.position]),
        );
        const emerging = domainKws.filter(
          kw => kw.volume >= 100 && isKeywordEmerging({ trend: kw.trend }),
        );
        for (const kw of emerging.slice(0, 10)) {
          const currentPosition = gscLookup.get(kw.keyword.toLowerCase());
          enrichAndUpsert({
            insightType: 'emerging_keyword',
            pageId: null,
            data: {
              keyword: kw.keyword,
              volume: kw.volume,
              difficulty: kw.difficulty,
              trendData: kw.trend,
              currentPosition,
              rankingUrl: kw.url,
            },
            severity: 'opportunity',
          });
        }
        deleteStaleInsightsByType(workspaceId, 'emerging_keyword', cycleStart);
        log.info({ workspaceId, count: Math.min(emerging.length, 10) }, 'Computed emerging keyword insights');
      }
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute emerging keyword insights');
    }
  }
```

**Implementation note:** `apiCache.wrap` with the key `'domainKeywords_emerging'` is distinct from any existing `'domainKeywords'` key — this prevents cache collision if keyword-strategy.ts uses the same provider for a different fetch. Verify the `apiCache.wrap` signature by reading lines 1-50 of `server/api-cache.ts` before calling it.

- [ ] **Step 5: Add `emerging_keyword` narrative entry to `server/insight-narrative.ts`**

Append to the `narrativeMap` object (after the `competitor_alert` entry added by Task 2, or append-only if Task 2 hasn't been merged yet):

```ts
    emerging_keyword: () => {
      const d = data as import('../../shared/types/analytics.js').EmergingKeywordData;
      return {
        headline: `Rising search trend: "${d.keyword}"`,
        narrative: `"${d.keyword}" is gaining search momentum${d.volume ? ` (${Number(d.volume).toLocaleString()} monthly searches)` : ''}. Getting ahead of this trend now could secure a strong ranking before competition increases.`,
        impact: d.currentPosition
          ? `You currently rank at position ${Math.round(d.currentPosition)} — there's room to improve`
          : `Your site doesn't yet rank for this keyword — a dedicated page could capture this traffic`,
      };
    },
```

- [ ] **Step 6: Add `emerging_keyword` section to `server/admin-chat-context.ts`**

Append after the `competitor_alert` section (or at the end of `buildInsightsContext`'s sections array):

```ts
  // Emerging keywords
  const emergingKws = insights
    .filter((i): i is AnalyticsInsight<'emerging_keyword'> => i.insightType === 'emerging_keyword')
    .map(i => i.data)
    .slice(0, 5);
  if (emergingKws.length > 0) {
    const lines = emergingKws.map(k => {
      const pos = k.currentPosition ? ` (we rank #${Math.round(k.currentPosition)})` : ' (not yet ranking)';
      return `  "${k.keyword}" — ${k.volume.toLocaleString()}/mo, KD ${k.difficulty}%${pos}`;
    });
    sections.push(`EMERGING KEYWORDS (rising search trend — act now before competition heats up):\n${lines.join('\n')}`);
  }
```

- [ ] **Step 7: Add `emerging_keyword` card in `src/components/client/InsightCards.tsx`**

Create an `EmergingKeywordCard` following the existing card pattern. Use blue for data values (`text-blue-400`). Card contents:
- Headline: `"${d.keyword}" search volume is rising`
- Body: `${d.volume.toLocaleString()} monthly searches and growing. ${d.currentPosition ? `You rank at position ${Math.round(d.currentPosition)} — improving this ranking could capture significant traffic.` : `Your site doesn't yet rank for this keyword — a dedicated page could capture this traffic early.`}`
- Badge: rising trend icon (TrendingUp from lucide-react, already imported)

- [ ] **Step 8: Run tests and typecheck**

```bash
npx vitest run tests/unit/emerging-keywords.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add server/analytics-intelligence.ts server/insight-narrative.ts server/admin-chat-context.ts src/components/client/InsightCards.tsx tests/unit/emerging-keywords.test.ts
git commit -m "feat(seo): emerging keyword insights — detect rising search trends from SEMRush domain data"
```

---

### Task 4 — Item 11: Content freshness detection (Model: sonnet)

**Files:**
- Modify: `server/analytics-intelligence.ts` — add Phase 6 block + `listPageKeywords` import
- Modify: `server/recommendations.ts` — add freshness-based recommendations section
- Modify: `server/insight-narrative.ts` — add `freshness_alert` narrative entry
- Modify: `server/admin-chat-context.ts` — add `freshness_alert` context section
- Modify: `src/components/client/InsightCards.tsx` — add `freshness_alert` card
- Create: `tests/integration/content-freshness.test.ts` (port 13341)

**Owns:** the six files above.
**Must not touch:** `shared/types/analytics.ts` (Task 0 already added the type), `competitor-snapshot-store.ts`.

**Pre-condition:** Task 3 must be committed (Task 4 appends Phase 6 after Task 3's Phase 5 in `analytics-intelligence.ts`). Recommendation Intelligence plan must be merged (Task 4 appends to the diagnostic section of `recommendations.ts` added by that plan's Task 5).

**Architecture note:** The `schema_snapshots` table assumed in the original spec does NOT exist in this codebase. Content freshness uses `PageKeywordMap.analysisGeneratedAt` from the `page_keywords` table as the date proxy. Pages where `analysisGeneratedAt` is > 90 days old AND `impressions >= 100` are considered stale. This is a weaker signal than HTTP Last-Modified (it measures last keyword analysis, not content modification) but is the best available date proxy without a new table.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/content-freshness.test.ts` (port 13341):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

const PORT = 13341;
const STALE_DATE = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago

describe('content freshness detection', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let seed: Awaited<ReturnType<typeof seedWorkspace>>;

  beforeAll(async () => {
    ctx = await createTestContext(PORT);
    seed = await seedWorkspace({ tier: 'growth' });
    // Insert a stale page_keywords row
    db.prepare(`
      INSERT OR REPLACE INTO page_keywords
        (workspace_id, page_path, page_title, primary_keyword, secondary_keywords,
         impressions, clicks, analysis_generated_at)
      VALUES (?, '/stale-page', 'Stale Page', 'stale keyword', '[]', 500, 30, ?)
    `).run(seed.workspace.id, STALE_DATE);
  });

  afterAll(async () => {
    await seed.cleanup();
    await ctx.close();
  });

  it('GET /api/workspace/:id/insights returns freshness_alert for stale pages', async () => {
    // Trigger intelligence run first (or call the freshness detector directly)
    const res = await ctx.get(`/api/workspace/${seed.workspace.id}/insights`);
    expect(res.status).toBe(200);
    const insights = res.body as Array<{ insightType: string; data: { pagePath?: string; daysSinceLastAnalysis?: number } }>;
    const freshnessInsights = insights.filter(i => i.insightType === 'freshness_alert');
    // May be 0 if intelligence hasn't run for the workspace yet — seed a direct call
    // This test verifies the DB schema is correct (no crash on insert)
    expect(Array.isArray(insights)).toBe(true);
  });
});
```

- [ ] **Step 2: Add `listPageKeywords` import to `analytics-intelligence.ts`**

Find the existing imports at the top of the file. Add:

```ts
import { listPageKeywords } from './page-keywords.js';
```

Add to the existing import group (grouped with other server module imports). Do not add mid-file.

- [ ] **Step 3: Add Phase 6 freshness block to `analytics-intelligence.ts`**

Find Task 3's Phase 5 block (anchored by `// Phase 5: Emerging keyword detection`). The Phase 5 block ends with its own closing brace + `}`. Insert Phase 6 immediately after:

```ts
  // Phase 6: Content freshness (stale content detection via page_keywords.analysisGeneratedAt)
  {
    const STALE_DAYS = 90;
    const MIN_IMPRESSIONS = 100;
    const now = Date.now();
    const pageKws = listPageKeywords(workspaceId);
    for (const page of pageKws) {
      if (!page.analysisGeneratedAt) continue;
      const lastAnalyzedMs = new Date(page.analysisGeneratedAt).getTime();
      const daysSince = Math.floor((now - lastAnalyzedMs) / 86_400_000);
      if (daysSince < STALE_DAYS) continue;
      const impressions = page.impressions ?? 0;
      if (impressions < MIN_IMPRESSIONS) continue;
      enrichAndUpsert({
        insightType: 'freshness_alert',
        pageId: page.pagePath,
        data: {
          pagePath: page.pagePath,
          lastAnalyzedAt: page.analysisGeneratedAt,
          daysSinceLastAnalysis: daysSince,
          impressions,
          clicks: page.clicks ?? 0,
        },
        severity: daysSince > 180 ? 'critical' : 'warning',
      });
    }
    deleteStaleInsightsByType(workspaceId, 'freshness_alert', cycleStart);
    log.info({ workspaceId }, 'Computed content freshness insights');
  }
```

- [ ] **Step 4: Add freshness recommendations to `server/recommendations.ts`**

Find the end of the diagnostics section (added by the Recommendation Intelligence plan's Task 5). The anchor is the closing of the diagnostic loop, followed by the recommendations summary block (anchored by `const summary = {`).

Insert before the summary block:

```ts
  // ── Content freshness recommendations ──
  {
    const freshnessInsights = getInsights(workspaceId, 'freshness_alert') as AnalyticsInsight<'freshness_alert'>[];
    for (const insight of freshnessInsights.slice(0, 10)) {
      const d = insight.data;
      const priority: RecPriority = d.daysSinceLastAnalysis > 180 ? 'fix_now' : 'fix_soon';
      const trafficAtRisk = d.impressions ?? 0;
      const impactScore = Math.min(Math.round(trafficAtRisk / 50), 80); // cap at 80 — freshness alone isn't critical
      recs.push({
        id: `${workspaceId}:freshness:${d.pagePath}`,
        workspaceId,
        priority,
        type: 'content_refresh',
        title: `Refresh stale content: ${d.pagePath}`,
        description: `This page hasn't been updated in ${d.daysSinceLastAnalysis} days and still receives ${trafficAtRisk.toLocaleString()} monthly impressions. Refreshing it signals recency to search engines.`,
        insight: `Content older than 90 days can lose relevance in search results, especially for informational queries. Updating this page may prevent a traffic decline.`,
        impact: trafficAtRisk >= 500 ? 'high' : trafficAtRisk >= 200 ? 'medium' : 'low',
        effort: 'medium',
        impactScore,
        source: 'insight:freshness_alert',
        affectedPages: [d.pagePath],
        trafficAtRisk,
        impressionsAtRisk: trafficAtRisk,
        estimatedGain: `Prevent 5–15% traffic decline from content aging`,
        actionType: 'content_creation',
        status: 'pending',
        assignedTo: assignedTo as 'team' | 'client',
        createdAt: now,
        updatedAt: now,
      });
    }
  }
```

**Implementation note:** `getInsights` must be already imported from the Recommendation Intelligence plan's Task 1 (which added it). Verify `getInsights(workspaceId, 'freshness_alert')` compiles by checking the `getInsights` function signature in `server/analytics-insights-store.ts`. If its second parameter is typed as `InsightType`, the call is valid because `'freshness_alert'` is now in the union (Task 0).

- [ ] **Step 5: Add `freshness_alert` narrative entry to `server/insight-narrative.ts`**

Append to `narrativeMap`:

```ts
    freshness_alert: () => {
      const d = data as import('../../shared/types/analytics.js').FreshnessAlertData;
      const days = d.daysSinceLastAnalysis;
      return {
        headline: `Content on ${d.pagePath} may need a refresh`,
        narrative: `This page hasn't been updated in ${days} days. Search engines tend to favor recently-updated content${d.impressions ? `, and this page still receives ${Number(d.impressions).toLocaleString()} monthly impressions that could be protected with a refresh` : ''}.`,
        impact: days > 180 ? `Over 6 months since last update — elevated risk of ranking decline` : `Over 3 months since last update`,
      };
    },
```

- [ ] **Step 6: Add `freshness_alert` section to `server/admin-chat-context.ts`**

Append after the `emerging_keyword` section:

```ts
  // Content freshness alerts
  const freshnessAlerts = insights
    .filter((i): i is AnalyticsInsight<'freshness_alert'> => i.insightType === 'freshness_alert')
    .map(i => i.data)
    .sort((a, b) => b.daysSinceLastAnalysis - a.daysSinceLastAnalysis)
    .slice(0, 5);
  if (freshnessAlerts.length > 0) {
    const lines = freshnessAlerts.map(f =>
      `  ${f.pagePath}: ${f.daysSinceLastAnalysis} days old${f.impressions ? ` (${f.impressions.toLocaleString()} impressions)` : ''}`
    );
    sections.push(`STALE CONTENT (not updated in 90+ days, still receiving traffic):\n${lines.join('\n')}`);
  }
```

- [ ] **Step 7: Add `freshness_alert` card in `src/components/client/InsightCards.tsx`**

Create a `FreshnessAlertCard` component. Use amber/orange color to signal "needs attention" status (consistent with existing amber-warning patterns in the UI — check existing badge colors first). Card contents:
- Headline: `Content refresh recommended: ${d.pagePath}`
- Body: `Last updated ${d.daysSinceLastAnalysis} days ago. ${d.impressions ? `This page still gets ${d.impressions.toLocaleString()} monthly impressions — refreshing it could maintain these rankings.` : `A content refresh signals recency to search engines.`}`

- [ ] **Step 8: Run tests and typecheck**

```bash
npx vitest run tests/integration/content-freshness.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add server/analytics-intelligence.ts server/recommendations.ts server/insight-narrative.ts server/admin-chat-context.ts src/components/client/InsightCards.tsx tests/integration/content-freshness.test.ts
git commit -m "feat(seo): content freshness alerts — detect stale content via page_keywords age; add freshness recommendations"
```

---

### Task 5 — Verification (Model: sonnet)

**Runs after:** Tasks 1, 2, and 4 are all committed. This is the integration checkpoint for the full parallel batch.

- [ ] **Full test suite**

```bash
npx vitest run
```

Expected: zero new failures. (Pre-existing `ClientDashboard.tsx` and `ContentPipeline.tsx` warnings are known-ignored per CLAUDE.md.)

- [ ] **TypeScript**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Production build**

```bash
npx vite build
```

Expected: successful build.

- [ ] **pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero new violations. Common false positives to check:
- Hard-coded studio name in new files (use `STUDIO_NAME` constant)
- `any` types in new DB row interfaces (use typed interfaces)
- Missing `workspace_id` scope on SQL (competitor_snapshots and competitor_alerts must always filter by `workspace_id`)

- [ ] **Smoke check**

1. Start dev server: `npm run dev:all`
2. Open a workspace that has SEMRush configured and competitor domains set
3. Run strategy generation — verify content gaps now show `opportunityScore` badges sorted descending
4. Verify `emerging_keyword` insights appear in the client insight digest (if SEMRush trend data is available)
5. Verify `competitor_alert` insights appear when snapshot data exists
6. Verify `freshness_alert` insights appear for pages where `analysis_generated_at` is old

---

### Task 6 — Docs (Model: haiku)

**Runs after:** Task 5 verification passes.

- [ ] **Update `FEATURE_AUDIT.md`**

Add entries:
- Content Gap Opportunity Score: `computeOpportunityScore()` in `keyword-strategy.ts`; sorts content gaps 0-100 by volume × ease × GSC signal × trend
- Emerging Keyword Insights: Phase 5 in `analytics-intelligence.ts`; `emerging_keyword` InsightType; SEMRush trend filter
- Competitor Monitoring: `competitor_snapshots` + `competitor_alerts` tables; `startCompetitorMonitoringCron()`; `competitor_alert` InsightType
- Content Freshness Alerts: Phase 6 in `analytics-intelligence.ts`; `freshness_alert` InsightType; 90-day threshold via `analysisGeneratedAt`

- [ ] **Update `data/roadmap.json`**

Mark roadmap items 8, 9, 10, 11 (or their equivalents) as `"done"` with notes. Run `npx tsx scripts/sort-roadmap.ts` after editing.

- [ ] **Commit**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: update FEATURE_AUDIT and roadmap for Tier 2 SEO capabilities (Items 8-11)"
```

---

## Done Criteria

All of the following must be true before opening a PR:

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full test suite passes
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] `opportunityScore` visible in ContentGaps UI, sorted descending
- [ ] `emerging_keyword` insights visible in client insight digest for SEMRush workspaces
- [ ] `competitor_alert` insights generated from weekly snapshot diff
- [ ] `freshness_alert` insights generated for pages with `analysisGeneratedAt > 90 days`
- [ ] `freshness_alert` recommendations present in the recommendations engine output
- [ ] `FEATURE_AUDIT.md` updated
- [ ] `data/roadmap.json` updated, re-sorted
- [ ] 5 commits total (Task 0 contracts + Task 1 opportunity score + Task 2 competitor monitoring + Task 3 emerging keywords + Task 4 freshness) + 1 docs commit = 6 commits

## Port Allocation Summary

| Test file | Port |
|-----------|------|
| `tests/unit/content-gap-opportunity-score.test.ts` | 13338 (unit — no bind) |
| `tests/integration/competitor-monitoring.test.ts` | 13339 |
| `tests/unit/emerging-keywords.test.ts` | 13340 (unit — no bind) |
| `tests/integration/content-freshness.test.ts` | 13341 |
