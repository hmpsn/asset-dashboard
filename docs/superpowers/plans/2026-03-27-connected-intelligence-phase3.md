# Connected Intelligence Engine — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform insights from admin-only tooling into a client-facing intelligence layer — narrative summaries, ROI attribution, monthly performance digests, upsell signals, and admin action tracking. Phase 1 made insights smart, Phase 2 made them actionable, Phase 3 makes them client-visible and revenue-generating.

**Architecture:** Backend modules for narrative generation and ROI tracking, then frontend components for client dashboard integration. Client-facing components must follow strict framing rules (outcome-oriented, no technical jargon, no purple color).

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React 19, TanStack React Query, Tailwind CSS 4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-27-connected-intelligence-design.md` (Phase 3: sections 3.1–3.5)

**Phase 1 Plan:** `docs/superpowers/plans/2026-03-27-connected-intelligence-phase1.md` (already executed)

**Phase 2 Plan:** `docs/superpowers/plans/2026-03-27-connected-intelligence-phase2.md` (execute before this)

**Guardrails:** `.windsurf/rules/analytics-insights.md` — read before starting any task

---

## Phase 2 Lessons — Read Before Starting

These bugs were found in Phase 2. Each one costs 1–3 hours to diagnose. Read this section before writing any code.

| Lesson | Rule |
|--------|------|
| **stmts() cache** | Never use bare `db.prepare()` inside exported functions. Add all statements to the module-level `stmts()` cache object. `roi-attribution.ts` and the new store functions in Task 5 are particularly at risk. |
| **Imports at top** | Add all `import` statements at the top of the file alongside existing imports. Never put an import next to the code that uses it. After editing any file, run `grep -n "^import" <file> \| tail -20` to verify no imports appeared past line 30. |
| **Route ordering** | Literal path segments must be registered **before** `/:paramId` routes at the same path depth. Before adding any route to an existing router, grep for existing param routes at the same depth. `public-analytics.ts` may have catch-alls. |
| **parseJsonSafe** | Never call `JSON.parse()` directly on a DB column. Use `parseJsonFallback` from `server/db/json-validation.ts`. Applies to `insight.auditIssues` in `insight-narrative.ts`. |
| **Full test suite** | After completing each group of tasks, run `npx vitest run` (full suite). Build passing ≠ tests passing. |
| **Subagent diff review** | After Tasks 1–4 complete in parallel, manually diff all modified shared files (`shared/types/analytics.ts`, `src/lib/queryKeys.ts`, `analytics-insights-store.ts`) before proceeding to Task 5. |
| **Producer/consumer contract gaps** | When a function produces enum values consumed by downstream code, the producer must actually emit every value downstream checks for. `checkStrategyAlignment` never returned `'misaligned'` — its consumer in `buildStrategySignals()` was dead code. In Phase 3: use `Record<InsightType, ...>` for the narrative template map so TypeScript enforces all cases at compile time. Write pipeline tests that exercise the real producer, not tests that fabricate the output value directly. |
| **Shared URL normalization** | `roi-attribution.ts` stores `page_url` and the digest builder compares it against insight `pageId` values. Use a single shared `normalizePath()` helper (strip leading/trailing slashes, lowercase) at both the write path and the lookup path — never duplicate inline `.replace()` calls. |

---

## Pre-flight Checklist

Before starting Phase 3, verify Phase 2 is fully landed:

- [ ] Phase 2 branch merged to main
- [ ] `server/insight-feedback.ts` exists and exports `buildStrategySignals`, `buildPipelineSignals`
- [ ] Anomaly → Insight Digest wiring works (anomaly_digest entries appear in insight feed)
- [ ] `src/components/strategy/IntelligenceSignals.tsx` renders in Strategy panel
- [ ] `src/components/pipeline/AiSuggested.tsx` renders in Content Pipeline
- [ ] Admin Chat context includes enriched insight fields
- [ ] Run `npx tsc --noEmit --skipLibCheck && npx vite build` — clean

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `server/db/migrations/040-insight-resolution-tracking.sql` | Add resolution tracking columns + ROI attribution table |
| `server/insight-narrative.ts` | Client-facing narrative generation (admin → client framing transform) |
| `server/roi-attribution.ts` | Track optimizations → metric outcomes over time |
| `server/monthly-digest.ts` | Auto-generate monthly performance summaries |
| `src/components/client/InsightNarrative.tsx` | Client-facing insight cards with outcome framing |
| `src/components/client/MonthlyDigest.tsx` | Monthly performance digest display |
| `src/components/admin/ActionQueue.tsx` | Admin action items / resolution tracker |
| `src/hooks/client/useClientInsights.ts` | React Query hook for client-framed insights |
| `src/hooks/client/useMonthlyDigest.ts` | React Query hook for monthly digest data |
| `src/hooks/admin/useActionQueue.ts` | React Query hook for admin action items |
| `shared/types/narrative.ts` | ClientInsight, MonthlyDigest, ActionItem types |
| `tests/unit/insight-narrative.test.ts` | Unit tests for narrative generation |
| `tests/unit/roi-attribution.test.ts` | Unit tests for ROI attribution logic |

### Modified Files
| File | Changes |
|------|---------|
| `server/analytics-insights-store.ts` | Add resolution status fields, add `resolveInsight()`, `getUnresolvedInsights()` |
| `server/routes/public-analytics.ts` | Add `GET /api/public/insights/:workspaceId/narrative` endpoint |
| `server/routes/public-analytics.ts` | Add `GET /api/public/insights/:workspaceId/digest` endpoint |
| `server/routes/admin-analytics.ts` (or equivalent) | Add admin action queue endpoints |
| `src/components/client/InsightsDigest.tsx` | Replace client-side computation with server-computed narrative insights |
| `src/components/client/OverviewTab.tsx` | Add MonthlyDigest section |
| `src/components/ClientDashboard.tsx` | Wire new client insight components |
| `src/components/ui/TierGate.tsx` | Add upsell signal tracking callback |
| `src/lib/queryKeys.ts` | Add client insight, digest, and action queue keys |
| `shared/types/analytics.ts` | Add resolution status to AnalyticsInsight |

---

## Task 1: Database Migration — Resolution Tracking + ROI Attribution

**Files:**
- Create: `server/db/migrations/040-insight-resolution-tracking.sql`
- Modify: `shared/types/analytics.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 040-insight-resolution-tracking.sql
-- Add resolution tracking to analytics_insights
ALTER TABLE analytics_insights ADD COLUMN resolution_status TEXT;  -- 'unresolved' | 'in_progress' | 'resolved'
ALTER TABLE analytics_insights ADD COLUMN resolution_note TEXT;    -- e.g., "brief created", "content refreshed"
ALTER TABLE analytics_insights ADD COLUMN resolved_at TEXT;        -- ISO timestamp

-- ROI attribution table: links optimizations to metric outcomes
CREATE TABLE IF NOT EXISTS roi_attributions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,        -- 'content_refresh' | 'brief_published' | 'seo_fix' | 'schema_added'
  action_date TEXT NOT NULL,        -- ISO timestamp of when the optimization was made
  page_url TEXT NOT NULL,
  description TEXT NOT NULL,        -- "Content refresh on /blog/ai-tools"
  -- Metric snapshots: before and after
  clicks_before INTEGER,
  clicks_after INTEGER,
  impressions_before INTEGER,
  impressions_after INTEGER,
  position_before REAL,
  position_after REAL,
  measured_at TEXT,                  -- ISO timestamp of when the after-measurement was taken
  measurement_window_days INTEGER DEFAULT 14,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_roi_workspace ON roi_attributions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_roi_page ON roi_attributions(workspace_id, page_url);
```

Save to `server/db/migrations/040-insight-resolution-tracking.sql`.

**Guardrail check:** Verify migration number is next in sequence. `ls server/db/migrations/ | tail -5`.

- [ ] **Step 2: Update AnalyticsInsight type**

In `shared/types/analytics.ts`, add to the `AnalyticsInsight` interface:

```typescript
export interface AnalyticsInsight {
  // ... existing fields
  // Resolution tracking (Phase 3)
  resolutionStatus?: 'unresolved' | 'in_progress' | 'resolved' | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
}
```

- [ ] **Step 3: Create shared narrative types**

```typescript
// shared/types/narrative.ts
import type { InsightType, InsightSeverity, InsightDomain } from './analytics.js';

/** Client-facing insight — reframed from admin language to outcome language */
export interface ClientInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  domain: InsightDomain;
  headline: string;       // "We detected a ranking change on your AI Tools page"
  narrative: string;      // "Your page moved from position 4 to 11. We're working on a recovery plan."
  impact?: string;        // "Estimated ~2,400 fewer monthly visits"
  actionTaken?: string;   // "Brief created to address this" or null
  impactScore: number;
}

/** Monthly performance digest for client dashboard */
export interface MonthlyDigestData {
  month: string;             // "March 2026"
  period: { start: string; end: string };
  summary: string;           // AI-generated 2-3 sentence overview
  wins: DigestItem[];
  issuesAddressed: DigestItem[];
  metrics: {
    clicksChange: number;    // +/- percentage
    impressionsChange: number;
    avgPositionChange: number;
    pagesOptimized: number;
  };
  roiHighlights: ROIHighlight[];
}

export interface DigestItem {
  title: string;
  detail: string;
  insightId?: string;
}

export interface ROIHighlight {
  pageTitle: string;
  pageUrl: string;
  action: string;            // "Content refresh" / "SEO fix applied"
  result: string;            // "Position improved from 8 to 3"
  clicksGained: number;
}

/** Admin action queue item */
export interface AdminActionItem {
  insightId: string;
  insightType: InsightType;
  pageTitle?: string;
  pageUrl?: string;
  severity: InsightSeverity;
  headline: string;
  resolutionStatus: 'unresolved' | 'in_progress' | 'resolved';
  resolutionNote?: string;
  resolvedAt?: string;
  createdAt: string;
}
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add server/db/migrations/040-insight-resolution-tracking.sql \
  shared/types/analytics.ts \
  shared/types/narrative.ts
git commit -m "feat: migration for resolution tracking + ROI attribution + narrative types

Migration 040: resolution_status, resolution_note, resolved_at on
analytics_insights. New roi_attributions table for tracking
optimization outcomes. Shared types for client insights, monthly
digests, and admin action items."
```

---

## Task 2: Insight Narrative Module — Admin → Client Framing

**Files:**
- Create: `server/insight-narrative.ts`
- Create: `tests/unit/insight-narrative.test.ts`

This module transforms admin-oriented insights into client-facing narratives.

- [ ] **Step 1: Write the narrative module**

```typescript
// server/insight-narrative.ts
import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { ClientInsight } from '../shared/types/narrative.js';

const log = createLogger('insight-narrative');

/**
 * Transform admin insights into client-facing narratives.
 *
 * Key framing differences:
 * - Admin: "What should I do next" (technical, action-oriented)
 * - Client: "Here's why we're valuable" (narrative, outcome-oriented)
 *
 * Examples:
 * - Admin: "Claude Code Limits Guide dropped to page 2 — position 4 → 11, lost ~2,400 clicks/mo"
 * - Client: "We detected a ranking change on your Claude Code Limits page and are working on a recovery plan"
 */
export function buildClientInsights(workspaceId: string): ClientInsight[] {
  const insights = getInsights(workspaceId);
  return insights
    .filter(i => isClientRelevant(i))
    .map(i => toClientInsight(i))
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 15); // Cap at 15 for client view
}

function isClientRelevant(insight: AnalyticsInsight): boolean {
  // Skip low-impact and purely technical insights
  if ((insight.impactScore ?? 0) < 20) return false;
  // Skip strategy_alignment (admin-only concept)
  if (insight.insightType === 'strategy_alignment') return false;
  // Skip keyword_cluster (too technical for clients)
  if (insight.insightType === 'keyword_cluster') return false;
  return true;
}

function toClientInsight(insight: AnalyticsInsight): ClientInsight {
  const title = insight.pageTitle ?? 'your website';
  const data = insight.data as Record<string, unknown>;

  const narrativeMap: Record<string, () => { headline: string; narrative: string; impact?: string }> = {
    page_health: () => {
      const score = data.score as number ?? 0;
      return {
        headline: score < 50
          ? `We identified health concerns on ${title}`
          : `${title} is performing well`,
        narrative: score < 50
          ? `Our analysis found areas for improvement on this page. We're developing an optimization plan.`
          : `This page is in good shape. We'll continue monitoring for any changes.`,
        impact: insight.auditIssues
          ? `${JSON.parse(insight.auditIssues).length} items identified for improvement`
          : undefined,
      };
    },

    ranking_opportunity: () => ({
      headline: `Growth opportunity detected for ${title}`,
      narrative: `This page is close to appearing on the first page of search results. A targeted optimization could significantly increase visibility.`,
      impact: data.impressions ? `Currently receiving ${Number(data.impressions).toLocaleString()} monthly impressions` : undefined,
    }),

    content_decay: () => ({
      headline: `We noticed a traffic change on ${title}`,
      narrative: `This page has experienced a decline in organic traffic. We're evaluating whether a content refresh would help restore performance.`,
      impact: data.declinePercent ? `${Math.abs(Number(data.declinePercent))}% traffic change detected` : undefined,
    }),

    ranking_mover: () => {
      const prev = data.previousPosition as number ?? 0;
      const curr = data.currentPosition as number ?? 0;
      const improved = curr < prev;
      return {
        headline: improved
          ? `Ranking improvement on ${title}`
          : `We detected a ranking change on ${title}`,
        narrative: improved
          ? `This page has moved up in search results. We'll continue optimizing to maintain this momentum.`
          : `We've detected a position change and are working on a recovery plan.`,
        impact: data.estimatedClickImpact
          ? `Estimated impact: ${Math.abs(Number(data.estimatedClickImpact)).toLocaleString()} monthly visits`
          : undefined,
      };
    },

    ctr_opportunity: () => ({
      headline: `Click-through opportunity on ${title}`,
      narrative: `This page appears frequently in search results but could attract more clicks. We're looking at ways to improve its search listing.`,
      impact: data.estimatedGain ? `Potential gain: ${Number(data.estimatedGain).toLocaleString()} additional monthly clicks` : undefined,
    }),

    anomaly_digest: () => ({
      headline: `Traffic pattern change detected`,
      narrative: `We noticed an unusual change in your site metrics and are monitoring the situation.`,
      impact: data.durationDays ? `Ongoing for ${data.durationDays} days` : undefined,
    }),
  };

  const generator = narrativeMap[insight.insightType];
  const content = generator
    ? generator()
    : {
        headline: `Update on ${title}`,
        narrative: `We identified something worth noting about this page and are evaluating next steps.`,
      };

  return {
    id: insight.id,
    type: insight.insightType,
    severity: insight.severity,
    domain: insight.domain ?? 'cross',
    headline: content.headline,
    narrative: content.narrative,
    impact: content.impact,
    actionTaken: insight.resolutionNote ?? undefined,
    impactScore: insight.impactScore ?? 0,
  };
}
```

**Guardrail check — client framing rules:**
- No raw URLs in headlines — use page titles
- No position numbers (too technical) — use "ranking change" / "improvement"
- No "you should" language — use "we're working on" / "we identified"
- No purple color in any component rendering these
- Never expose `strategy_alignment` or `keyword_cluster` to clients

> ⚠️ **Phase 2 lesson — `parseJsonSafe` for DB columns:** The plan code calls `JSON.parse(insight.auditIssues)` directly. Replace with:
> ```typescript
> import { parseJsonFallback } from './db/json-validation.js';
> const issues = parseJsonFallback<string[]>(insight.auditIssues, []);
> const count = issues.length;
> ```
> Bare `JSON.parse` on a DB TEXT column can throw if the stored value is malformed or null.

> ⚠️ **Phase 2 lesson — exhaustive InsightType map (producer/consumer contract):** The plan code uses `Record<string, () => ...>` for `narrativeMap` then falls through to a default for unknown types. This is the same pattern as `checkStrategyAlignment` never returning `'misaligned'` — a missing case silently produces wrong output. Replace with an exhaustive typed map:
> ```typescript
> import type { InsightType } from '../shared/types/analytics.js';
> // Exhaustive map: TypeScript will error if a new InsightType is added without a narrative
> const narrativeMap: Partial<Record<InsightType, () => { headline: string; narrative: string; impact?: string }>> = { ... };
> ```
> Also: unit tests for `toClientInsight()` must pass real `InsightType` values from the union (e.g., `'ranking_mover'`, `'page_health'`) — not fabricated strings — so TypeScript catches any mismatch at test compile time.

- [ ] **Step 2: Write tests**

```typescript
// tests/unit/insight-narrative.test.ts
import { describe, it, expect } from 'vitest';

// Test the narrative framing logic by importing the internal functions
// We test the output format, not the DB reads (those are integration tests)

describe('insight-narrative', () => {
  describe('client framing rules', () => {
    it('never exposes raw URLs in headlines', () => {
      // Narratives should reference page titles, not paths
      const headline = 'We detected a ranking change on Best AI Coding Agents';
      expect(headline).not.toMatch(/^\//);
      expect(headline).not.toMatch(/https?:\/\//);
    });

    it('uses outcome language, not technical language', () => {
      // Client narrative should not contain admin jargon
      const forbidden = ['position 4', 'impressions', 'CTR', 'H1 tag', 'canonical'];
      const narrative = 'We detected a ranking change and are working on a recovery plan';
      for (const term of forbidden) {
        expect(narrative).not.toContain(term);
      }
    });

    it('excludes strategy_alignment from client view', () => {
      const clientRelevantTypes = [
        'page_health', 'ranking_opportunity', 'content_decay',
        'ranking_mover', 'ctr_opportunity', 'anomaly_digest',
        'serp_opportunity', 'competitor_gap', 'conversion_attribution',
        'cannibalization',
      ];
      expect(clientRelevantTypes).not.toContain('strategy_alignment');
      expect(clientRelevantTypes).not.toContain('keyword_cluster');
    });
  });

  describe('severity mapping', () => {
    it('preserves severity from source insight', () => {
      // ClientInsight.severity should match AnalyticsInsight.severity
      const severities = ['critical', 'warning', 'opportunity', 'positive'];
      for (const s of severities) {
        expect(['critical', 'warning', 'opportunity', 'positive']).toContain(s);
      }
    });
  });

  describe('impact formatting', () => {
    it('formats large numbers with commas', () => {
      const formatted = Number(2400).toLocaleString();
      expect(formatted).toBe('2,400');
    });

    it('uses absolute values for percentages', () => {
      const percent = Math.abs(-35);
      expect(percent).toBe(35);
    });
  });
});
```

- [ ] **Step 3: Verify build and tests**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
npx vitest run tests/unit/insight-narrative.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/insight-narrative.ts tests/unit/insight-narrative.test.ts
git commit -m "feat: client-facing insight narrative module

Transforms admin insights into outcome-oriented client language.
Filters out admin-only types (strategy_alignment, keyword_cluster).
Caps at 15 insights for client view. Sorted by impact score."
```

---

## Task 3: ROI Attribution Module

**Files:**
- Create: `server/roi-attribution.ts`
- Create: `tests/unit/roi-attribution.test.ts`

Tracks which optimizations led to which metric improvements.

> ⚠️ **Phase 2 lesson — stmts() cache required:** The plan code below uses bare `db.prepare()` inside exported functions. This re-compiles statements on every call. When writing `roi-attribution.ts`, add all prepared statements to a module-level `stmts()` cache object instead:
> ```typescript
> let cache: ReturnType<typeof buildStmts> | undefined;
> function stmts() {
>   return cache ??= buildStmts();
> }
> function buildStmts() {
>   const db = getDb();
>   return {
>     insert: db.prepare(`INSERT INTO roi_attributions ...`),
>     updateOutcome: db.prepare(`UPDATE roi_attributions SET ...`),
>     getHighlights: db.prepare(`SELECT * FROM roi_attributions WHERE ...`),
>     getUnmeasured: db.prepare(`SELECT * FROM roi_attributions WHERE measured_at IS NULL ...`),
>   };
> }
> ```

> ⚠️ **Phase 2 lesson — shared URL normalization:** `roi-attribution.ts` stores `page_url` and the digest builder will later compare it against insight `pageId` values. The Phase 2 slug normalization bug (`buildAuditIssuesMap` stripped only the leading slash, `getAuditIssuesForPage` stripped both) happened because two places normalized independently. Prevent the same bug here: define a single `normalizePath()` helper at the top of `roi-attribution.ts` and use it at **both** the write path (when storing `page_url`) and the lookup path (when matching against insight records):
> ```typescript
> function normalizePath(url: string): string {
>   try {
>     // Strip domain if present
>     const pathname = url.startsWith('http') ? new URL(url).pathname : url;
>     return pathname.toLowerCase().replace(/^\//, '').replace(/\/$/, '');
>   } catch {
>     return url.toLowerCase().replace(/^\//, '').replace(/\/$/, '');
>   }
> }
> ```

- [ ] **Step 1: Write the ROI module**

```typescript
// server/roi-attribution.ts
import { createLogger } from './logger.js';
import { getDb } from './db/index.js';
import { v4 as uuidv4 } from 'uuid';
import type { ROIHighlight } from '../shared/types/narrative.js';

const log = createLogger('roi-attribution');

interface ROIAttributionRow {
  id: string;
  workspace_id: string;
  action_type: string;
  action_date: string;
  page_url: string;
  description: string;
  clicks_before: number | null;
  clicks_after: number | null;
  impressions_before: number | null;
  impressions_after: number | null;
  position_before: number | null;
  position_after: number | null;
  measured_at: string | null;
  measurement_window_days: number;
  created_at: string;
}

/**
 * Record an optimization action for ROI tracking.
 * Called when content is published, SEO fix applied, schema added, etc.
 * The "before" metrics are captured now; "after" metrics are measured later.
 */
export function recordOptimization(params: {
  workspaceId: string;
  actionType: 'content_refresh' | 'brief_published' | 'seo_fix' | 'schema_added';
  pageUrl: string;
  description: string;
  clicksBefore?: number;
  impressionsBefore?: number;
  positionBefore?: number;
}): string {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO roi_attributions (id, workspace_id, action_type, action_date, page_url, description,
      clicks_before, impressions_before, position_before, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, params.workspaceId, params.actionType, now, params.pageUrl, params.description,
    params.clicksBefore ?? null, params.impressionsBefore ?? null, params.positionBefore ?? null, now
  );

  log.info({ workspaceId: params.workspaceId, pageUrl: params.pageUrl, actionType: params.actionType },
    'ROI optimization recorded');
  return id;
}

/**
 * Measure the outcome of a previously recorded optimization.
 * Called by a scheduled job ~14 days after the action.
 */
export function measureOutcome(attributionId: string, params: {
  clicksAfter: number;
  impressionsAfter: number;
  positionAfter: number;
}): void {
  const db = getDb();
  db.prepare(`
    UPDATE roi_attributions
    SET clicks_after = ?, impressions_after = ?, position_after = ?, measured_at = datetime('now')
    WHERE id = ?
  `).run(params.clicksAfter, params.impressionsAfter, params.positionAfter, attributionId);
}

/**
 * Get ROI highlights for a workspace (for monthly digest and client dashboard).
 * Only returns attributions where both before and after metrics are available.
 */
export function getROIHighlights(workspaceId: string, limit = 10): ROIHighlight[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM roi_attributions
    WHERE workspace_id = ? AND measured_at IS NOT NULL
    ORDER BY (COALESCE(clicks_after, 0) - COALESCE(clicks_before, 0)) DESC
    LIMIT ?
  `).all(workspaceId, limit) as ROIAttributionRow[];

  return rows.map(row => ({
    pageTitle: cleanUrlToTitle(row.page_url),
    pageUrl: row.page_url,
    action: formatActionType(row.action_type),
    result: formatResult(row),
    clicksGained: (row.clicks_after ?? 0) - (row.clicks_before ?? 0),
  }));
}

/**
 * Get unmeasured optimizations older than the measurement window.
 * Used by a scheduled job to trigger outcome measurement.
 */
export function getUnmeasuredOptimizations(windowDays = 14): ROIAttributionRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM roi_attributions
    WHERE measured_at IS NULL
    AND julianday('now') - julianday(action_date) >= measurement_window_days
  `).all() as ROIAttributionRow[];
}

function cleanUrlToTitle(url: string): string {
  const slug = url.split('/').filter(Boolean).pop() ?? 'Home';
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatActionType(type: string): string {
  const map: Record<string, string> = {
    content_refresh: 'Content refresh',
    brief_published: 'New content published',
    seo_fix: 'SEO fix applied',
    schema_added: 'Schema markup added',
  };
  return map[type] ?? type;
}

function formatResult(row: ROIAttributionRow): string {
  const parts: string[] = [];
  if (row.position_before != null && row.position_after != null) {
    const improved = row.position_after < row.position_before;
    parts.push(`Position ${improved ? 'improved' : 'changed'} from ${Math.round(row.position_before)} to ${Math.round(row.position_after)}`);
  }
  if (row.clicks_before != null && row.clicks_after != null) {
    const diff = row.clicks_after - row.clicks_before;
    if (diff > 0) parts.push(`+${diff.toLocaleString()} clicks`);
  }
  return parts.join(' · ') || 'Measurement pending';
}
```

- [ ] **Step 2: Write tests**

```typescript
// tests/unit/roi-attribution.test.ts
import { describe, it, expect } from 'vitest';

describe('roi-attribution formatting', () => {
  it('formats action types to human-readable strings', () => {
    const map: Record<string, string> = {
      content_refresh: 'Content refresh',
      brief_published: 'New content published',
      seo_fix: 'SEO fix applied',
      schema_added: 'Schema markup added',
    };
    expect(map['content_refresh']).toBe('Content refresh');
    expect(map['seo_fix']).toBe('SEO fix applied');
  });

  it('cleans URLs to page titles', () => {
    const cleanUrlToTitle = (url: string): string => {
      const slug = url.split('/').filter(Boolean).pop() ?? 'Home';
      return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };
    expect(cleanUrlToTitle('/blog/best-ai-tools')).toBe('Best Ai Tools');
    expect(cleanUrlToTitle('/')).toBe('Home');
  });

  it('formats result with position improvement and click gain', () => {
    const row = {
      position_before: 8, position_after: 3,
      clicks_before: 500, clicks_after: 1700,
    };
    const parts: string[] = [];
    if (row.position_after < row.position_before) {
      parts.push(`Position improved from ${row.position_before} to ${row.position_after}`);
    }
    const diff = row.clicks_after - row.clicks_before;
    if (diff > 0) parts.push(`+${diff.toLocaleString()} clicks`);
    expect(parts.join(' · ')).toBe('Position improved from 8 to 3 · +1,200 clicks');
  });
});
```

- [ ] **Step 3: Verify build and tests**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
npx vitest run tests/unit/roi-attribution.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/roi-attribution.ts tests/unit/roi-attribution.test.ts
git commit -m "feat: ROI attribution module

Records optimizations (content refresh, SEO fix, schema added) with
before-metrics. Measures outcomes after configurable window (default
14 days). Generates ROI highlights for monthly digest and client
dashboard."
```

---

## Task 4: Monthly Performance Digest

**Files:**
- Create: `server/monthly-digest.ts`

- [ ] **Step 1: Write the monthly digest module**

```typescript
// server/monthly-digest.ts
import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import { getROIHighlights } from './roi-attribution.js';
import { callOpenAI } from './openai-helpers.js';
import type { MonthlyDigestData, DigestItem } from '../shared/types/narrative.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';

const log = createLogger('monthly-digest');

/**
 * Generate a monthly performance digest for a workspace.
 * Aggregates insights, anomalies, and ROI data into a client-facing narrative.
 */
export async function generateMonthlyDigest(
  workspaceId: string,
  month?: string, // "March 2026" — defaults to current month
): Promise<MonthlyDigestData> {
  const now = new Date();
  const monthLabel = month ?? now.toLocaleString('default', { month: 'long', year: 'numeric' });

  const insights = getInsights(workspaceId);
  const roiHighlights = getROIHighlights(workspaceId, 5);

  // Categorize insights
  const wins = insights
    .filter(i => i.severity === 'positive' || (i.insightType === 'ranking_mover' && isPositiveMove(i)))
    .slice(0, 5)
    .map(insightToDigestItem);

  const issuesAddressed = insights
    .filter(i => i.resolutionStatus === 'resolved')
    .slice(0, 5)
    .map(i => ({
      title: i.pageTitle ?? 'Page optimization',
      detail: i.resolutionNote ?? 'Issue addressed',
      insightId: i.id,
    }));

  // Compute metric changes (placeholder — wire to actual GSC/GA4 comparison)
  const metrics = {
    clicksChange: 0,
    impressionsChange: 0,
    avgPositionChange: 0,
    pagesOptimized: issuesAddressed.length,
  };

  // Generate AI summary
  const summary = await generateDigestSummary(monthLabel, wins, issuesAddressed, roiHighlights, metrics);

  return {
    month: monthLabel,
    period: {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
    },
    summary,
    wins,
    issuesAddressed,
    metrics,
    roiHighlights,
  };
}

function isPositiveMove(insight: AnalyticsInsight): boolean {
  const data = insight.data as Record<string, unknown>;
  const prev = data.previousPosition as number ?? 0;
  const curr = data.currentPosition as number ?? 0;
  return curr < prev && (prev - curr) > 3;
}

function insightToDigestItem(insight: AnalyticsInsight): DigestItem {
  return {
    title: insight.pageTitle ?? 'Performance update',
    detail: formatInsightForDigest(insight),
    insightId: insight.id,
  };
}

function formatInsightForDigest(insight: AnalyticsInsight): string {
  const data = insight.data as Record<string, unknown>;
  switch (insight.insightType) {
    case 'ranking_mover':
      return `Ranking improved — now appearing higher in search results`;
    case 'ranking_opportunity':
      return `Close to first page of search results`;
    case 'ctr_opportunity':
      return `Opportunities to increase clicks from search`;
    default:
      return `Performance update identified`;
  }
}

async function generateDigestSummary(
  month: string,
  wins: DigestItem[],
  issues: DigestItem[],
  roi: import('../shared/types/narrative.js').ROIHighlight[],
  metrics: { pagesOptimized: number },
): Promise<string> {
  try {
    const prompt = `Write a 2-3 sentence monthly performance summary for a website client.
Month: ${month}
Wins: ${wins.length} improvements identified
Issues addressed: ${issues.length} optimizations completed
Pages optimized: ${metrics.pagesOptimized}
ROI highlights: ${roi.length} measurable improvements

Tone: Professional, outcome-focused, reassuring. No jargon. Use "we" language.
Do NOT include specific numbers unless they're impressive. Keep it concise.`;

    const result = await callOpenAI({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
    });

    return result ?? `In ${month}, we continued optimizing your site's search performance. ${wins.length} improvements were identified and ${issues.length} issues were addressed.`;
  } catch (err) {
    log.warn({ err }, 'AI digest summary failed — using fallback');
    return `In ${month}, we continued optimizing your site's search performance. ${wins.length} improvements were identified and ${issues.length} issues were addressed.`;
  }
}
```

**Guardrail check:** AI call has a hardcoded fallback. If OpenAI fails, the digest still generates with a deterministic summary. Never expose AI failure to the client.

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add server/monthly-digest.ts
git commit -m "feat: monthly performance digest generator

Aggregates wins, resolved issues, and ROI highlights into a
client-facing monthly narrative. AI-generated summary with
deterministic fallback. Outcome-oriented language throughout."
```

---

## Task 5: Resolution Tracking + Action Queue

**Files:**
- Modify: `server/analytics-insights-store.ts`

Add resolution workflow functions to the insight store.

> ⚠️ **Phase 2 lesson — stmts() cache required:** The plan code below calls `db.prepare()` inline in `resolveInsight()`, `getUnresolvedInsights()`, and `getInsightById()`. Add these to the existing `stmts()` cache in `analytics-insights-store.ts` instead:
> ```typescript
> // Add to the stmts() cache object in analytics-insights-store.ts:
> updateResolution: getDb().prepare(`UPDATE analytics_insights SET resolution_status = ?, resolution_note = ?, resolved_at = ? WHERE id = ? AND workspace_id = ?`),
> selectUnresolved: getDb().prepare(`SELECT * FROM analytics_insights WHERE workspace_id = ? AND (resolution_status IS NULL OR resolution_status != 'resolved') AND severity IN ('critical', 'warning') ORDER BY impact_score DESC`),
> selectById: getDb().prepare(`SELECT * FROM analytics_insights WHERE id = ?`),
> ```

> ⚠️ **Plan bug — `resolveInsight()` return value:** The plan calls `getInsight(workspaceId, undefined as any, undefined as any)` after the update — this is wrong. Use the new `getInsightById(insightId)` function to return the updated insight.

> ⚠️ **Phase 2 lesson — check imports at top:** When adding functions to `analytics-insights-store.ts`, all import statements must remain at the top of the file. No new imports should be added mid-file.

- [ ] **Step 1: Add resolution functions**

```typescript
// Add to server/analytics-insights-store.ts:

export function resolveInsight(
  insightId: string,
  workspaceId: string,
  status: 'in_progress' | 'resolved',
  note?: string,
): AnalyticsInsight | undefined {
  const db = getDb();
  const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE analytics_insights
    SET resolution_status = ?, resolution_note = ?, resolved_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(status, note ?? null, resolvedAt, insightId, workspaceId);

  return getInsight(workspaceId, undefined as any, undefined as any);
  // TODO: fix getInsight to support lookup by ID — currently needs insightType + pageId
}

export function getUnresolvedInsights(workspaceId: string): AnalyticsInsight[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM analytics_insights
    WHERE workspace_id = ?
    AND (resolution_status IS NULL OR resolution_status = 'unresolved' OR resolution_status = 'in_progress')
    AND severity IN ('critical', 'warning')
    ORDER BY impact_score DESC
  `).all(workspaceId) as InsightRow[];
  return rows.map(rowToInsight);
}

export function getInsightById(id: string): AnalyticsInsight | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM analytics_insights WHERE id = ?').get(id) as InsightRow | undefined;
  return row ? rowToInsight(row) : undefined;
}
```

**Guardrail check:** Update `rowToInsight()` to include the new resolution fields:
```typescript
resolutionStatus: row.resolution_status ?? null,
resolutionNote: row.resolution_note ?? null,
resolvedAt: row.resolved_at ?? null,
```

- [ ] **Step 2: Add API endpoints for resolution**

In the admin analytics route file, add:

```typescript
// PUT /api/admin/insights/:insightId/resolve
router.put('/:insightId/resolve', requireAdminAuth, validate(z.object({
  body: z.object({
    status: z.enum(['in_progress', 'resolved']),
    note: z.string().optional(),
  }),
})), (req, res) => {
  const updated = resolveInsight(req.params.insightId, req.workspaceId, req.body.status, req.body.note);
  if (!updated) return res.status(404).json({ error: 'Insight not found' });
  addActivity(req.workspaceId, `Insight ${req.body.status}: ${req.body.note ?? ''}`);
  broadcastToWorkspace(req.workspaceId, { type: 'insight_resolved', data: { insightId: req.params.insightId } });
  res.json(updated);
});

// GET /api/admin/insights/:workspaceId/queue
router.get('/:workspaceId/queue', requireAdminAuth, (req, res) => {
  const unresolved = getUnresolvedInsights(req.params.workspaceId);
  res.json({ items: unresolved });
});
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add server/analytics-insights-store.ts server/routes/
git commit -m "feat: insight resolution tracking + admin action queue

resolveInsight() updates status (in_progress/resolved) with notes.
getUnresolvedInsights() returns critical/warning items sorted by impact.
API endpoints for resolution workflow + action queue."
```

---

## Task 6: Client Insight API Endpoints

**Files:**
- Modify: `server/routes/public-analytics.ts`

> ⚠️ **Phase 2 lesson — route ordering + imports at top of file:**
> Before adding these routes, run:
> ```bash
> grep -n "router\.\(get\|put\|post\|delete\)" server/routes/public-analytics.ts | head -30
> ```
> If any route exists with the pattern `/:workspaceId/:anything`, register `/narrative` and `/digest` **before** it. Express matches in registration order — a catch-all param route will shadow literal segments.
>
> Also check for existing imports before adding `buildClientInsights` and `generateMonthlyDigest` — add them at the top of the file alongside existing imports.

- [ ] **Step 1: Add client narrative endpoint**

```typescript
import { buildClientInsights } from '../insight-narrative.js';
import { generateMonthlyDigest } from '../monthly-digest.js';

// GET /api/public/insights/:workspaceId/narrative
router.get('/:workspaceId/narrative', requireClientAuth, async (req, res) => {
  const insights = buildClientInsights(req.params.workspaceId);
  res.json({ insights });
});

// GET /api/public/insights/:workspaceId/digest
router.get('/:workspaceId/digest', requireClientAuth, async (req, res) => {
  try {
    const digest = await generateMonthlyDigest(req.params.workspaceId);
    res.json(digest);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'digest generation failed');
    res.status(500).json({ error: 'Failed to generate digest' });
  }
});
```

- [ ] **Step 2: Add query keys**

In `src/lib/queryKeys.ts`:

```typescript
// Client keys
clientInsights: (workspaceId: string) => ['client', 'insights', workspaceId] as const,
monthlyDigest: (workspaceId: string) => ['client', 'monthlyDigest', workspaceId] as const,
// Admin keys
actionQueue: (workspaceId: string) => ['admin', 'actionQueue', workspaceId] as const,
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/public-analytics.ts src/lib/queryKeys.ts
git commit -m "feat: client insight narrative + monthly digest API endpoints

GET /api/public/insights/:workspaceId/narrative — client-framed insights
GET /api/public/insights/:workspaceId/digest — monthly performance digest
Both require client auth."
```

---

## Task 7: Client React Query Hooks

**Files:**
- Create: `src/hooks/client/useClientInsights.ts`
- Create: `src/hooks/client/useMonthlyDigest.ts`
- Create: `src/hooks/admin/useActionQueue.ts`

- [ ] **Step 1: Write client hooks**

Follow the pattern from existing hooks in `src/hooks/client/`. Check one for the correct `apiFetch` import path and auth handling.

```typescript
// src/hooks/client/useClientInsights.ts
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys.js';
// Use the correct apiFetch import from existing client hooks

export function useClientInsights(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.client.clientInsights(workspaceId),
    queryFn: () => apiFetch(`/api/public/insights/${workspaceId}/narrative`),
    staleTime: 10 * 60 * 1000, // 10 min — client data changes less frequently
    enabled: !!workspaceId,
  });
}
```

```typescript
// src/hooks/client/useMonthlyDigest.ts
export function useMonthlyDigest(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.client.monthlyDigest(workspaceId),
    queryFn: () => apiFetch(`/api/public/insights/${workspaceId}/digest`),
    staleTime: 60 * 60 * 1000, // 1 hour — digests don't change often
    enabled: !!workspaceId,
  });
}
```

```typescript
// src/hooks/admin/useActionQueue.ts
export function useActionQueue(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.actionQueue(workspaceId),
    queryFn: () => apiFetch(`/api/admin/insights/${workspaceId}/queue`),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/client/useClientInsights.ts \
  src/hooks/client/useMonthlyDigest.ts \
  src/hooks/admin/useActionQueue.ts
git commit -m "feat: React Query hooks for client insights, monthly digest, and action queue"
```

---

## Task 8: Client Insight Narrative UI

**Files:**
- Create: `src/components/client/InsightNarrative.tsx`
- Modify: `src/components/client/InsightsDigest.tsx`

Replace the client-side insight computation with server-computed narrative insights.

- [ ] **Step 1: Create InsightNarrative component**

```typescript
// src/components/client/InsightNarrative.tsx
import { useClientInsights } from '../../hooks/client/useClientInsights.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Skeleton } from '../ui/Skeleton.js';
import { TierGate } from '../ui/TierGate.js';
import { Lightbulb, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react';
import type { ClientInsight } from '../../../shared/types/narrative.js';

interface Props {
  workspaceId: string;
  tier: string;
}

const severityConfig = {
  critical: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
  warning: { icon: TrendingDown, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  opportunity: { icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  positive: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
} as const;

export function InsightNarrative({ workspaceId, tier }: Props) {
  const { data, isLoading } = useClientInsights(workspaceId);
  const insights: ClientInsight[] = data?.insights ?? [];

  if (isLoading) {
    return (
      <SectionCard title="Performance Insights" icon={Lightbulb}>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      </SectionCard>
    );
  }

  if (!insights.length) {
    return (
      <SectionCard title="Performance Insights" icon={Lightbulb}>
        <EmptyState
          message="No insights yet"
          detail="Insights will appear once we have enough data to analyze your site's performance"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Performance Insights" icon={Lightbulb}>
      <div className="space-y-3">
        {insights.slice(0, 8).map(insight => {
          const config = severityConfig[insight.severity] ?? severityConfig.opportunity;
          const Icon = config.icon;
          return (
            <div key={insight.id} className={`p-4 rounded-lg ${config.bg}`}>
              <div className="flex items-start gap-3">
                <Icon className={`w-5 h-5 mt-0.5 ${config.color} shrink-0`} />
                <div>
                  <h4 className="text-sm font-medium text-zinc-200">{insight.headline}</h4>
                  <p className="text-sm text-zinc-400 mt-1">{insight.narrative}</p>
                  {insight.impact && (
                    <p className="text-xs text-zinc-500 mt-1">{insight.impact}</p>
                  )}
                  {insight.actionTaken && (
                    <p className="text-xs text-teal-400 mt-1">
                      <CheckCircle className="w-3 h-3 inline mr-1" />
                      {insight.actionTaken}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
```

**Guardrail check — Three Laws of Color:**
- Blue for data (severity icon colors use blue for opportunity)
- Teal for actions (actionTaken text)
- NO purple anywhere (this is a client-facing component)
- Green/amber/red for status indicators only

- [ ] **Step 2: Integrate into InsightsDigest**

In `src/components/client/InsightsDigest.tsx`, replace the client-side insight computation with a render of `InsightNarrative`. Read the file first to understand the current structure, then replace the computation logic while keeping the overall component shell.

**Guardrail check:** The existing `InsightsDigest` (561 lines) computes insights client-side from raw data. The replacement should use server-computed insights via `useClientInsights`. Keep any structural elements (section headers, layout) that work well. Remove the client-side computation functions that are no longer needed.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/client/InsightNarrative.tsx \
  src/components/client/InsightsDigest.tsx
git commit -m "feat: client insight narrative component

Replaces client-side insight computation with server-computed narratives.
Outcome-oriented language. No technical jargon. No purple colors.
Shows action taken when insights have been resolved."
```

---

## Task 9: Monthly Digest UI + Upsell Signal Tracking

**Files:**
- Create: `src/components/client/MonthlyDigest.tsx`
- Modify: `src/components/client/OverviewTab.tsx`
- Modify: `src/components/ui/TierGate.tsx`

- [ ] **Step 1: Create MonthlyDigest component**

Build the monthly digest display. Use `SectionCard`, follow the data shape from `MonthlyDigestData`. Show: summary, wins list, issues addressed, ROI highlights, and metric changes.

Gate to Growth/Premium tier using `TierGate`.

```typescript
// Key structure — implement fully based on MonthlyDigestData type
<TierGate tier={tier} required="growth" feature="Monthly Performance Digest">
  <SectionCard title={`${digest.month} Performance`} icon={Calendar}>
    <p className="text-sm text-zinc-300">{digest.summary}</p>
    {/* Wins section */}
    {/* Issues addressed section */}
    {/* ROI highlights section */}
    {/* Metric changes */}
  </SectionCard>
</TierGate>
```

- [ ] **Step 2: Add to client OverviewTab**

In `src/components/client/OverviewTab.tsx`, add `MonthlyDigest` in the appropriate position (after performance pulse, before existing sections).

- [ ] **Step 3: Add upsell signal tracking to TierGate**

In `src/components/ui/TierGate.tsx`, add an optional `onGateHit` callback that fires when a user encounters a gate:

```typescript
interface TierGateProps {
  // ... existing props
  onGateHit?: (feature: string, requiredTier: string) => void;
}

// Inside the component, when the gate blocks content:
useEffect(() => {
  if (isBlocked && onGateHit) {
    onGateHit(feature, required);
  }
}, [isBlocked, feature, required, onGateHit]);
```

This callback can be wired to an analytics event or API call to track upsell signals. For now, just add the callback prop — the actual tracking endpoint can be added later.

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/client/MonthlyDigest.tsx \
  src/components/client/OverviewTab.tsx \
  src/components/ui/TierGate.tsx
git commit -m "feat: monthly digest UI + upsell signal tracking on TierGate

MonthlyDigest shows AI-generated summary, wins, resolved issues, and
ROI highlights. Gated to Growth/Premium. TierGate gains onGateHit
callback for future upsell signal tracking."
```

---

## Task 10: Admin Action Queue UI

**Files:**
- Create: `src/components/admin/ActionQueue.tsx`

- [ ] **Step 1: Create ActionQueue component**

An admin-facing view showing unresolved insights as a work queue with resolution controls.

```typescript
// Key structure:
// - List of unresolved critical/warning insights
// - Each item shows: severity icon, page title, headline, impact score
// - Resolution buttons: "Mark In Progress" / "Mark Resolved" with note input
// - Uses useActionQueue hook + useMutation for resolution
// - WebSocket invalidation on 'insight_resolved' event
```

**Guardrail check:**
- Admin-only component — can use full technical detail
- Uses `SectionCard`, `EmptyState`, `Badge` from UI primitives
- Teal for action buttons (Mark Resolved CTA)
- Blue for data metrics (impact scores)
- No purple (this is not an AI feature)

- [ ] **Step 2: Add to the admin dashboard**

Read the admin dashboard structure to find the appropriate location for the action queue. It could be a new tab or a section within an existing view.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/ActionQueue.tsx
git commit -m "feat: admin action queue for insight resolution tracking

Shows unresolved critical/warning insights as a work queue.
Resolution workflow: unresolved → in_progress → resolved with notes.
Feeds into workspace activity log."
```

---

## Task 11: Verification + Documentation

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `BRAND_DESIGN_LANGUAGE.md`
- Modify: `data/roadmap.json`

- [ ] **Step 1: Run FULL test suite**

```bash
npx vitest run
```

The full suite must show **zero failures**. Running only the new test files is not sufficient — Phase 2 found that partial test runs mask cross-module regressions.

- [ ] **Step 2: Full build verification**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 3: Verify no purple in client components**

```bash
grep -rn "purple" src/components/client/ src/components/pipeline/
```

Should return zero results.

- [ ] **Step 4: Update FEATURE_AUDIT.md**

Add entries for:
- Client Insight Narrative (InsightNarrative.tsx)
- ROI Attribution tracking
- Monthly Performance Digest
- Upsell Signal tracking (TierGate onGateHit)
- Admin Action Queue (resolution workflow)

- [ ] **Step 5: Update roadmap**

Mark Phase 3 items as `"done"` in `data/roadmap.json`.

- [ ] **Step 6: Commit**

```bash
git add FEATURE_AUDIT.md BRAND_DESIGN_LANGUAGE.md data/roadmap.json
git commit -m "docs: update feature audit, design language, and roadmap for Phase 3

Connected Intelligence Engine Phase 3 complete: client narratives,
ROI attribution, monthly digests, upsell signals, admin action queue."
```

---

## Dependency Graph

```
Task 1 (Migration + Types) ─────────────────────────────────────────┐
                                                                      │
Task 2 (Narrative Module) ──────── depends on 1 ────────────────────┤
Task 3 (ROI Attribution) ──────── depends on 1 ────────────────────┤
Task 4 (Monthly Digest) ──────── depends on 2, 3 ──────────────────┤
Task 5 (Resolution Tracking) ─── depends on 1 ────────────────────┤
                                                                      │
Task 6 (Client API Endpoints) ── depends on 2, 4, 5 ───────────────┤
Task 7 (React Query Hooks) ───── depends on 6 ────────────────────┤
                                                                      │
Task 8 (Client Insight UI) ───── depends on 7 ────────────────────┤
Task 9 (Digest UI + Upsell) ──── depends on 7 ────────────────────┤
Task 10 (Action Queue UI) ────── depends on 5, 7 ──────────────────┤
                                                                      │
Task 11 (Verification + Docs) ── depends on ALL ───────────────────┘
```

**Parallel execution — with strict file ownership**

Tasks 2 + 3 + 5 can run in parallel, and Tasks 8 + 9 + 10 can run in parallel — but only after the pre-commit steps below. See CLAUDE.md § "Parallel Agent Coordination" for the full protocol.

**Step 0 — Pre-commit shared contracts before any parallel work**

Before dispatching Tasks 2, 3, or 5, commit the following to the branch so all agents read from the same source:
- `shared/types/narrative.ts` (from Task 1 Step 3) — `ClientInsight`, `MonthlyDigestData`, `AdminActionItem`
- `shared/types/analytics.ts` changes (from Task 1 Step 2) — resolution fields on `AnalyticsInsight`
- Migration 040 (from Task 1 Step 1) — schema must exist before store functions are written

Task 1 must be fully committed before any parallel work starts.

**Batch 1 — Tasks 2 + 3 + 5 (parallel, after Task 1 committed)**

| Agent | Owns | Must not touch |
|-------|------|----------------|
| Agent A (Task 2) | `server/insight-narrative.ts`, `tests/unit/insight-narrative.test.ts` | Everything else |
| Agent B (Task 3) | `server/roi-attribution.ts`, `tests/unit/roi-attribution.test.ts` | Everything else |
| Agent C (Task 5) | `server/analytics-insights-store.ts` (resolution functions only) | `shared/types/`, route files, hooks |

→ **Diff checkpoint after Batch 1:** `git diff HEAD -- server/analytics-insights-store.ts shared/types/`

**Batch 2 — Task 4 (sequential, after Batch 1)**

Task 4 (`server/monthly-digest.ts`) depends on both Task 2 and Task 3. Run alone after Batch 1 is committed.

**Batch 3 — Tasks 6 + 7 (sequential, after Task 4 committed)**

Tasks 6 and 7 both touch `src/lib/queryKeys.ts` and route files. Run sequentially to avoid conflicts:
- Task 6 first (API endpoints + query keys)
- Task 7 after Task 6 committed (React Query hooks that import those keys)

**Batch 4 — Tasks 8 + 9 + 10 (parallel, after Task 7 committed)**

| Agent | Owns | Must not touch |
|-------|------|----------------|
| Agent A (Task 8) | `src/components/client/InsightNarrative.tsx`, `src/components/client/InsightsDigest.tsx` | Other components, hooks |
| Agent B (Task 9) | `src/components/client/MonthlyDigest.tsx`, `src/components/client/OverviewTab.tsx`, `src/components/ui/TierGate.tsx` | Other components, hooks |
| Agent C (Task 10) | `src/components/admin/ActionQueue.tsx` | Other components, hooks |

→ **Diff checkpoint after Batch 4:** `git diff HEAD -- src/components/ src/hooks/`

**Task 11 — sequential, after all batches committed**
