# Client Insights Briefing Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the client `/client/:id` Insights tab from a 9-section data dashboard into a weekly AI-curated editorial briefing (action queue + 3-5 hand-curated story cards), and collapse the 10-tab nav to 4 (Insights / Inbox / Plans / Explore drawer). Premium and Growth tiers get the full briefing; Free tier gets the action queue plus an upgrade CTA backed by `MonthlyDigest`.

**Architecture:** A weekly Monday 14:00 UTC cron reads candidates from existing analytics_insights / recommendations / audit-delta stores, calls `callAI()` with `buildSystemPrompt()` (Anthropic Sonnet for editorial prose) to pick 3-5 stories + write narrative, persists to a new `briefing_drafts` table mirroring approval-batch UX patterns, surfaces in admin review queue, and publishes to a tier-gated client endpoint. Feature flag `client-briefing-v2` gates all client-visible changes; phases ship as separate PRs per CLAUDE.md.

**Tech Stack:** SQLite (better-sqlite3) + new `briefing_drafts` table (migration 077), Express routes via Zod `validate()`, React Query hooks, `useWorkspaceEvents` for real-time invalidation, `<TierGate required="growth">` for UI gating, `callAI({ provider: 'anthropic' })` + `buildSystemPrompt()` for prose generation, nodemailer SMTP for the optional Phase 4 email convergence.

**Pre-plan audit:** `docs/superpowers/audits/2026-04-28-client-insights-briefing-refactor-audit.md` (8 spec corrections applied below; 5 user decisions resolved).

---

## Pre-requisites

- [ ] Spec committed: `docs/superpowers/specs/2026-04-28-client-insights-briefing-refactor-design.md`
- [ ] Pre-plan audit complete: `docs/superpowers/audits/2026-04-28-client-insights-briefing-refactor-audit.md`
- [ ] Working in worktree (current: `bold-rosalind-5a33fc`)
- [ ] Latest `staging` pulled and rebased

## Spec corrections applied (from audit)

1. **Candidate pool excludes `weCalledIt`** — wins come exclusively from `analytics_insights` where `severity === 'positive'`. Decision: predictions belong in admin tooling, not on the client home.
2. **Intelligence cache TTL is 5 min** (not 6h). No pre-warm needed; freshness check uses 5-min implicit guarantee.
3. **Narrative endpoint** (`server/routes/public-analytics.ts:124`) calls `buildClientInsights`, not `generateMonthlyDigest`. Phase 4 retargets correctly.
4. **No `scrubClientIntelligence` function** — visibility is per-formatter in `server/routes/client-intelligence.ts`. `BriefingSummary` has no admin-only fields → flows automatically.
5. **Competitive signals** read from `analytics_insights` rows where `insightType === 'competitor_alert'` (already upserted by `intelligence-crons.ts`), not from `competitor_alerts` directly.
6. **Deep linking is path-based** — `clientPath(wsId, page)` + optional `?tab=` for sub-tab.
7. **Anomaly-detection voice inconsistency** is out of scope (flagged separately).
8. **`ClientTab` union missing `'content-plan'` / `'schema-review'`** — pre-existing tech debt, NAV continues to use `as ClientTab` casts in Phase 3.

## User decisions

- AI: `provider: 'anthropic'`, `model: 'claude-sonnet-4-20250514'`.
- `outcome-ai-injection=false`: soft-degrade learnings *context* injection (no impact on candidate pool, since `weCalledIt` is dropped).
- Free tier: refactor `MonthlyDigest` → extract `MonthlyDigestContent` (un-gated body) so both Free path and gated path import it cleanly.
- Admin review surface: new `<BriefingReviewQueue>` block on `WorkspaceHome.tsx` next to `<PendingApprovals>`.
- "Already ran this week" persistence: new `last_briefing_run_week_of TEXT` column on `workspaces` (durable across restarts).

---

# Phase 1 (PR 1) — Generation Pipeline (dark-launched)

Backend pipeline + admin review UI. No client-visible changes. Feature flag `client-briefing-v2` defaults `false`.

## Task Dependencies

```
Pre-batch (sequential, MUST commit before any parallel work):
  T1.0  Migration 077-briefing-drafts.sql + workspace columns
  T1.1  shared/types/briefing.ts
  T1.2  shared/types/feature-flags.ts add 'client-briefing-v2'
  T1.3  server/activity-log.ts add 4 new activity types
  T1.4  server/ws-events.ts add BRIEFING_GENERATED, BRIEFING_PUBLISHED
  T1.5  shared/types/workspace.ts + server/workspaces.ts column mappers
  T1.6  src/lib/queryKeys.ts add admin/client briefing keys

Sequential after pre-batch:
  T1.7  server/briefing-store.ts (full DB layer, Zod schema, mappers)
  T1.8  server/briefing-prompt.ts (instructions + AI response schema)

Parallel batch A (depends on T1.7, T1.8):
  T1.9  server/briefing-candidates.ts          [agent owns: briefing-candidates.ts]
  T1.10 server/email.ts + email-templates.ts   [agent owns: notifyClientBriefingReady additions]
  T1.11 server/routes/briefing.ts              [agent owns: routes/briefing.ts]

Sequential shared-file (after batch A):
  T1.12 server/routes/public-portal.ts add GET /api/public/briefing/:wsId
  T1.13 server/app.ts register routes/briefing.ts

Sequential cron + bridge (after T1.13):
  T1.14 server/briefing-cron.ts + server/startup.ts integration
  T1.15 server/scheduled-audits.ts add briefing-candidate-refresh bridge

Parallel batch B (frontend admin review, after T1.13):
  T1.16 src/api/briefing.ts                                 [agent owns]
  T1.17 src/hooks/admin/useBriefingDrafts.ts                [agent owns]
  T1.18 src/components/admin/BriefingReviewQueue.tsx        [agent owns]

Sequential after batch B:
  T1.19 src/components/WorkspaceHome.tsx wire BriefingReviewQueue + WS handler
  T1.20 Tests + docs + verification
```

---

### T1.0 — Migration: `briefing_drafts` table + workspace columns (Model: haiku)

**Files:**
- Create: `server/db/migrations/077-briefing-drafts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 077-briefing-drafts.sql
-- Weekly client briefing drafts (admin review + publish lifecycle)

CREATE TABLE briefing_drafts (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  week_of         TEXT NOT NULL,           -- YYYY-MM-DD (Monday of week, UTC)
  status          TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'approved' | 'published' | 'skipped'
  stories         TEXT NOT NULL DEFAULT '[]',     -- JSON array: BriefingStory[]
  source_metadata TEXT,                    -- JSON: candidate count, model, generation_ms (admin-only telemetry)
  admin_note      TEXT,
  auto_published  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  published_at    INTEGER,
  UNIQUE(workspace_id, week_of)
);
CREATE INDEX briefing_drafts_workspace_week ON briefing_drafts(workspace_id, week_of);
CREATE INDEX briefing_drafts_status ON briefing_drafts(workspace_id, status);

-- Per-workspace briefing toggles (column-on-workspaces convention)
ALTER TABLE workspaces ADD COLUMN auto_publish_briefings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN auto_publish_after_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE workspaces ADD COLUMN last_briefing_run_week_of TEXT;
```

- [ ] **Step 2: Verify migration applies**

Run: `npm run dev:server` (auto-applies pending migrations on startup) then in a separate shell:
```bash
sqlite3 data/dashboard.db ".schema briefing_drafts"
sqlite3 data/dashboard.db ".schema workspaces" | grep -E 'auto_publish|last_briefing'
```
Expected: table exists with all columns; workspaces shows the 3 new columns.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/077-briefing-drafts.sql
git commit -m "feat(briefing): migration 077 — briefing_drafts table + workspace toggles"
```

---

### T1.1 — Shared types: `briefing.ts` (Model: haiku)

**Files:**
- Create: `shared/types/briefing.ts`

- [ ] **Step 1: Write the types**

```ts
// shared/types/briefing.ts

export type BriefingCategory = 'win' | 'risk' | 'opportunity' | 'competitive' | 'period_change';

export type BriefingDraftStatus = 'draft' | 'approved' | 'published' | 'skipped';

/** Constrained subset of ClientTab — only Explore-drawer destinations are valid drill-in targets. */
export type ExplorePage =
  | 'performance'
  | 'health'
  | 'strategy'
  | 'content-plan'
  | 'schema-review'
  | 'roi'
  | 'brand';

export interface BriefingMetric {
  /** Already-formatted value, e.g. "+12%", "2", "8.6K" */
  value: string;
  /** Short label, e.g. "traffic", "on page 1", "search volume" */
  label: string;
}

export interface BriefingDrillIn {
  page: ExplorePage;
  tab?: string;
  queryParams?: Record<string, string>;
}

export interface BriefingSourceRef {
  type: 'analytics_insight' | 'recommendation' | 'audit_delta';
  id: string;
}

export interface BriefingStory {
  /** Stable identifier within the briefing (uuid) */
  id: string;
  category: BriefingCategory;
  /** Exactly one story per briefing has isHeadline=true */
  isHeadline: boolean;
  /** 5-12 words */
  headline: string;
  /** 1-3 sentences of editorial prose */
  narrative: string;
  /** 0-2 supporting metrics */
  metrics: BriefingMetric[];
  drillIn: BriefingDrillIn;
  /** Traceability — which source records produced this story */
  sourceRefs: BriefingSourceRef[];
}

export interface BriefingDraft {
  id: string;
  workspaceId: string;
  weekOf: string;             // YYYY-MM-DD (Monday, UTC)
  status: BriefingDraftStatus;
  stories: BriefingStory[];
  sourceMetadata: BriefingSourceMetadata | null;
  adminNote: string | null;
  autoPublished: boolean;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

/** Admin-only telemetry, never serialized to client */
export interface BriefingSourceMetadata {
  candidateCount: number;
  model: string;
  provider: 'anthropic' | 'openai';
  generationMs: number;
  preflightDeferralCount?: number;
}

/** Client-visible summary embedded in ClientSignalsSlice */
export interface BriefingSummary {
  weekOf: string;
  publishedAt: number | null;
  storyCount: number;
  hasHero: boolean;
}

/** Wire shape returned from /api/public/briefing/:wsId */
export interface PublishedBriefingResponse {
  weekOf: string;
  publishedAt: number;
  stories: BriefingStory[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add shared/types/briefing.ts
git commit -m "feat(briefing): shared types — BriefingStory, BriefingDraft, BriefingSummary, ExplorePage"
```

---

### T1.2 — Feature flag: `client-briefing-v2` (Model: haiku)

**Files:**
- Modify: `shared/types/feature-flags.ts`

- [ ] **Step 1: Add flag to FEATURE_FLAGS object**

In `shared/types/feature-flags.ts`, append a new entry under "Platform Intelligence Enhancements":

```ts
  // Client Insights Briefing (4-phase feature)
  'client-briefing-v2': false,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors. `FeatureFlagKey` union now includes the new key.

- [ ] **Step 3: Commit**

```bash
git add shared/types/feature-flags.ts
git commit -m "feat(briefing): add client-briefing-v2 feature flag (default false)"
```

---

### T1.3 — Activity log types: 4 new briefing types (Model: haiku)

**Files:**
- Modify: `server/activity-log.ts` (the `ActivityType` union, lines 18-110)

- [ ] **Step 1: Add 4 activity types to the union**

Find the `ActivityType` union in `server/activity-log.ts`. Append the following 4 string-literal types alongside existing entries (preserve grouping/ordering convention):

```ts
  | 'briefing_generated'
  | 'briefing_published'
  | 'briefing_skipped'
  | 'briefing_auto_published'
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/activity-log.ts
git commit -m "feat(briefing): add briefing_* activity log types"
```

---

### T1.4 — WS events: `BRIEFING_GENERATED` + `BRIEFING_PUBLISHED` (Model: haiku)

**Files:**
- Modify: `server/ws-events.ts`

- [ ] **Step 1: Add two events to WS_EVENTS**

Add to the `WS_EVENTS` object (after `COPY_*` block):

```ts
  // Client Briefing (weekly editorial)
  BRIEFING_GENERATED: 'briefing:generated',
  BRIEFING_PUBLISHED: 'briefing:published',
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors. `WsEventName` union expands automatically.

- [ ] **Step 3: Commit**

```bash
git add server/ws-events.ts
git commit -m "feat(briefing): WS events briefing:generated, briefing:published"
```

---

### T1.5 — Workspace type + DB column mapping (Model: haiku)

**Files:**
- Modify: `shared/types/workspace.ts`
- Modify: `server/workspaces.ts` (rowToWorkspace + updateWorkspace columnMap)

- [ ] **Step 1: Add fields to `Workspace` type**

In `shared/types/workspace.ts`, add:

```ts
  /** Auto-publish briefings without admin review after N hours */
  autoPublishBriefings?: boolean;
  /** Hours after generation before auto-publish (default 24) */
  autoPublishAfterHours?: number;
  /** ISO-week marker (YYYY-MM-DD) of last briefing run, prevents duplicate runs */
  lastBriefingRunWeekOf?: string | null;
```

- [ ] **Step 2: Wire row → object mapper**

In `server/workspaces.ts`, in the `rowToWorkspace` (or `mapRow`) function, add:

```ts
  if (row.auto_publish_briefings !== null) ws.autoPublishBriefings = !!row.auto_publish_briefings;
  if (row.auto_publish_after_hours !== null) ws.autoPublishAfterHours = row.auto_publish_after_hours as number;
  if (row.last_briefing_run_week_of !== null) ws.lastBriefingRunWeekOf = row.last_briefing_run_week_of as string | null;
```

- [ ] **Step 3: Wire object → row in `updateWorkspace` columnMap**

In the same file, in the `columnMap` of `updateWorkspace`, add:

```ts
  autoPublishBriefings: 'auto_publish_briefings',
  autoPublishAfterHours: 'auto_publish_after_hours',
  lastBriefingRunWeekOf: 'last_briefing_run_week_of',
```

For boolean serialization, ensure `autoPublishBriefings` follows the `analytics_client_view` pattern (undefined → null, boolean → 0/1).

- [ ] **Step 4: Typecheck + smoke**

```bash
npm run typecheck
npx vitest run tests/unit/workspaces.test.ts 2>/dev/null || true
```
Expected: typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add shared/types/workspace.ts server/workspaces.ts
git commit -m "feat(briefing): workspace columns — auto_publish_briefings, last_briefing_run_week_of"
```

---

### T1.6 — Query keys (Model: haiku)

**Files:**
- Modify: `src/lib/queryKeys.ts`

- [ ] **Step 1: Add admin + client briefing keys**

In the `admin` block:

```ts
  briefingDrafts: (workspaceId: string) => ['admin-briefing-drafts', workspaceId] as const,
  briefingDraft:  (workspaceId: string, draftId: string) => ['admin-briefing-draft', workspaceId, draftId] as const,
```

In the `client` block:

```ts
  briefing: (workspaceId: string) => ['client-briefing', workspaceId] as const,
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/queryKeys.ts
git commit -m "feat(briefing): query keys for admin drafts + client briefing"
```

---

### T1.7 — `briefing-store.ts` — DB layer + Zod schema + mappers (Model: sonnet)

**Files:**
- Create: `server/briefing-store.ts`
- Test: `tests/unit/briefing-store.test.ts`

This is the foundation other tasks depend on. Get the contracts right.

- [ ] **Step 1: Write the failing test for round-trip + healing**

Create `tests/unit/briefing-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../server/db';
import {
  upsertBriefingDraft,
  getBriefingByWeek,
  getLatestPublishedBriefing,
  listBriefingDrafts,
  markPublished,
  markSkipped,
} from '../../server/briefing-store';
import type { BriefingStory } from '../../shared/types/briefing';

const wsId = 'ws-test-briefing-store';

function makeStory(overrides: Partial<BriefingStory> = {}): BriefingStory {
  return {
    id: 'st-1',
    category: 'win',
    isHeadline: true,
    headline: 'Traffic is up',
    narrative: 'Three new posts drove +12% in traffic this week.',
    metrics: [{ value: '+12%', label: 'traffic' }],
    drillIn: { page: 'performance' },
    sourceRefs: [{ type: 'analytics_insight', id: 'ins-1' }],
    ...overrides,
  };
}

describe('briefing-store', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(wsId);
  });

  it('round-trips a draft with stories array', () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-04-27',
      stories: [makeStory(), makeStory({ id: 'st-2', isHeadline: false, category: 'risk' })],
      sourceMetadata: { candidateCount: 8, model: 'claude-sonnet-4', provider: 'anthropic', generationMs: 4200 },
    });
    expect(draft.id).toBeTruthy();
    expect(draft.stories).toHaveLength(2);
    expect(draft.stories[0].headline).toBe('Traffic is up');
    expect(draft.status).toBe('draft');

    const fetched = getBriefingByWeek(wsId, '2026-04-27');
    expect(fetched?.id).toBe(draft.id);
    expect(fetched?.stories).toHaveLength(2);
  });

  it('upsert is idempotent on (workspace_id, week_of)', () => {
    upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-27', stories: [makeStory()], sourceMetadata: null });
    upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-27', stories: [makeStory({ id: 'st-9' })], sourceMetadata: null });
    const list = listBriefingDrafts(wsId);
    expect(list.filter(d => d.weekOf === '2026-04-27')).toHaveLength(1);
    expect(list[0].stories[0].id).toBe('st-9');
  });

  it('heals malformed JSON stories to empty array (no throw)', () => {
    const inserted = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-20', stories: [makeStory()], sourceMetadata: null });
    db.prepare('UPDATE briefing_drafts SET stories = ? WHERE id = ?').run('not json at all', inserted.id);
    const fetched = getBriefingByWeek(wsId, '2026-04-20');
    expect(fetched?.stories).toEqual([]);
  });

  it('markPublished sets status, publishedAt, and autoPublished flag', () => {
    const d = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-13', stories: [makeStory()], sourceMetadata: null });
    const updated = markPublished(d.id, { autoPublished: true });
    expect(updated?.status).toBe('published');
    expect(updated?.autoPublished).toBe(true);
    expect(updated?.publishedAt).toBeGreaterThan(0);
  });

  it('getLatestPublishedBriefing returns most recent published row', () => {
    const a = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-13', stories: [makeStory()], sourceMetadata: null });
    const b = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-20', stories: [makeStory()], sourceMetadata: null });
    markPublished(a.id, { autoPublished: false });
    markPublished(b.id, { autoPublished: false });
    const latest = getLatestPublishedBriefing(wsId);
    expect(latest?.weekOf).toBe('2026-04-20');
  });

  it('markSkipped transitions to skipped and preserves stories', () => {
    const d = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-06', stories: [makeStory()], sourceMetadata: null });
    const skipped = markSkipped(d.id, 'No material activity this week');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.adminNote).toBe('No material activity this week');
    expect(skipped?.stories).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/briefing-store.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/briefing-store.ts`**

```ts
// server/briefing-store.ts
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import type {
  BriefingDraft,
  BriefingStory,
  BriefingSourceMetadata,
  BriefingDraftStatus,
} from '../shared/types/briefing.js';

const log = createLogger('briefing-store');

// Zod schemas — used for parsing on read AND for validating AI output (re-exported)
const briefingMetricSchema = z.object({
  value: z.string().min(1).max(20),
  label: z.string().min(1).max(40),
});

export const briefingStorySchema: z.ZodType<BriefingStory> = z.object({
  id: z.string().min(1),
  category: z.enum(['win', 'risk', 'opportunity', 'competitive', 'period_change']),
  isHeadline: z.boolean(),
  headline: z.string().min(1).max(120),
  narrative: z.string().min(1).max(800),
  metrics: z.array(briefingMetricSchema).max(2),
  drillIn: z.object({
    page: z.enum(['performance', 'health', 'strategy', 'content-plan', 'schema-review', 'roi', 'brand']),
    tab: z.string().optional(),
    queryParams: z.record(z.string()).optional(),
  }),
  sourceRefs: z.array(z.object({
    type: z.enum(['analytics_insight', 'recommendation', 'audit_delta']),
    id: z.string().min(1),
  })),
});

const sourceMetadataSchema: z.ZodType<BriefingSourceMetadata> = z.object({
  candidateCount: z.number().int().nonnegative(),
  model: z.string().min(1),
  provider: z.enum(['anthropic', 'openai']),
  generationMs: z.number().int().nonnegative(),
  preflightDeferralCount: z.number().int().nonnegative().optional(),
});

interface BriefingRow {
  id: string;
  workspace_id: string;
  week_of: string;
  status: BriefingDraftStatus;
  stories: string;
  source_metadata: string | null;
  admin_note: string | null;
  auto_published: number;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

const briefingStmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO briefing_drafts (id, workspace_id, week_of, status, stories, source_metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, week_of) DO UPDATE SET
      stories = excluded.stories,
      source_metadata = excluded.source_metadata,
      status = CASE WHEN briefing_drafts.status = 'published' THEN briefing_drafts.status ELSE excluded.status END,
      updated_at = excluded.updated_at
    RETURNING *
  `),
  getByWeek: db.prepare('SELECT * FROM briefing_drafts WHERE workspace_id = ? AND week_of = ?'),
  getById: db.prepare('SELECT * FROM briefing_drafts WHERE id = ?'),
  list: db.prepare('SELECT * FROM briefing_drafts WHERE workspace_id = ? ORDER BY week_of DESC LIMIT ?'),
  latestPublished: db.prepare(`
    SELECT * FROM briefing_drafts
    WHERE workspace_id = ? AND status = 'published'
    ORDER BY published_at DESC LIMIT 1
  `),
  setStories: db.prepare('UPDATE briefing_drafts SET stories = ?, updated_at = ? WHERE id = ? RETURNING *'),
  setStatus: db.prepare('UPDATE briefing_drafts SET status = ?, updated_at = ?, published_at = ?, auto_published = ?, admin_note = COALESCE(?, admin_note) WHERE id = ? RETURNING *'),
  setNote: db.prepare('UPDATE briefing_drafts SET admin_note = ?, updated_at = ? WHERE id = ? RETURNING *'),
}));

function rowToDraft(row: BriefingRow): BriefingDraft {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    weekOf: row.week_of,
    status: row.status,
    stories: parseJsonSafeArray(row.stories, briefingStorySchema, `briefing_drafts:stories(${row.id})`),
    sourceMetadata: row.source_metadata
      ? parseJsonSafe(row.source_metadata, sourceMetadataSchema, null, `briefing_drafts:source_metadata(${row.id})`)
      : null,
    adminNote: row.admin_note,
    autoPublished: !!row.auto_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

export interface UpsertBriefingDraftInput {
  workspaceId: string;
  weekOf: string;
  stories: BriefingStory[];
  sourceMetadata: BriefingSourceMetadata | null;
}

export function upsertBriefingDraft(input: UpsertBriefingDraftInput): BriefingDraft {
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = briefingStmts().insert.get(
    id, input.workspaceId, input.weekOf, 'draft',
    JSON.stringify(input.stories),
    input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : null,
    now, now
  ) as BriefingRow;
  return rowToDraft(row);
}

export function getBriefingByWeek(workspaceId: string, weekOf: string): BriefingDraft | null {
  const row = briefingStmts().getByWeek.get(workspaceId, weekOf) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function getBriefingById(id: string): BriefingDraft | null {
  const row = briefingStmts().getById.get(id) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function listBriefingDrafts(workspaceId: string, limit = 12): BriefingDraft[] {
  const rows = briefingStmts().list.all(workspaceId, limit) as BriefingRow[];
  return rows.map(rowToDraft);
}

export function getLatestPublishedBriefing(workspaceId: string): BriefingDraft | null {
  const row = briefingStmts().latestPublished.get(workspaceId) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function updateBriefingStories(id: string, stories: BriefingStory[]): BriefingDraft | null {
  const row = briefingStmts().setStories.get(JSON.stringify(stories), Date.now(), id) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export interface MarkPublishedOptions {
  autoPublished: boolean;
  adminNote?: string;
}

export function markPublished(id: string, opts: MarkPublishedOptions): BriefingDraft | null {
  const now = Date.now();
  const row = briefingStmts().setStatus.get(
    'published', now, now, opts.autoPublished ? 1 : 0, opts.adminNote ?? null, id
  ) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function markApproved(id: string, adminNote?: string): BriefingDraft | null {
  const now = Date.now();
  const row = briefingStmts().setStatus.get('approved', now, null, 0, adminNote ?? null, id) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function markSkipped(id: string, adminNote: string): BriefingDraft | null {
  const now = Date.now();
  const row = briefingStmts().setStatus.get('skipped', now, null, 0, adminNote, id) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function setBriefingAdminNote(id: string, adminNote: string | null): BriefingDraft | null {
  const row = briefingStmts().setNote.get(adminNote, Date.now(), id) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/briefing-store.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/briefing-store.ts tests/unit/briefing-store.test.ts
git commit -m "feat(briefing): briefing-store.ts — DB layer, Zod schemas, mappers, tests"
```

---

### T1.8 — `briefing-prompt.ts` — instructions + AI response schema (Model: opus)

**Files:**
- Create: `server/briefing-prompt.ts`
- Test: `tests/unit/briefing-prompt.test.ts`

The single source of truth for the briefing prompt. Voice DNA is layered in by `buildSystemPrompt` upstream — these are the briefing-specific instructions only.

- [ ] **Step 1: Write the failing schema test**

Create `tests/unit/briefing-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { briefingAIResponseSchema, buildBriefingInstructions } from '../../server/briefing-prompt';

describe('briefing-prompt', () => {
  it('builds non-empty instructions string', () => {
    const out = buildBriefingInstructions({ workspaceName: 'Acme', weekLabel: 'Week of April 27' });
    expect(out).toContain('weekly client briefing');
    expect(out).toContain('exactly one');
    expect(out).toContain('headline');
    expect(out).toContain('Acme');
  });

  it('schema accepts a valid AI response', () => {
    const valid = {
      stories: [
        {
          id: 's1',
          category: 'win',
          isHeadline: true,
          headline: 'Commercial vehicle bet pays off',
          narrative: 'Three posts drove +12% traffic.',
          metrics: [{ value: '+12%', label: 'traffic' }],
          drillIn: { page: 'performance' },
          sourceRefs: [{ type: 'analytics_insight', id: 'i1' }],
        },
      ],
    };
    const r = briefingAIResponseSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('schema rejects missing headline', () => {
    const bad = { stories: [{ id: 's1', category: 'win', isHeadline: true, narrative: 'x', metrics: [], drillIn: { page: 'performance' }, sourceRefs: [] }] };
    expect(briefingAIResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('schema rejects more than 5 stories', () => {
    const bad = {
      stories: Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`, category: 'win', isHeadline: i === 0, headline: 'h', narrative: 'n',
        metrics: [], drillIn: { page: 'performance' }, sourceRefs: [],
      })),
    };
    expect(briefingAIResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('schema rejects zero headlines or multiple headlines', () => {
    const noHero = { stories: [{ id:'s1', category:'win', isHeadline:false, headline:'h', narrative:'n', metrics:[], drillIn:{page:'performance'}, sourceRefs:[] }] };
    const twoHero = { stories: [
      { id:'s1', category:'win', isHeadline:true, headline:'h', narrative:'n', metrics:[], drillIn:{page:'performance'}, sourceRefs:[] },
      { id:'s2', category:'win', isHeadline:true, headline:'h', narrative:'n', metrics:[], drillIn:{page:'performance'}, sourceRefs:[] },
    ] };
    expect(briefingAIResponseSchema.safeParse(noHero).success).toBe(false);
    expect(briefingAIResponseSchema.safeParse(twoHero).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/briefing-prompt.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/briefing-prompt.ts`**

```ts
// server/briefing-prompt.ts
import { z } from 'zod';
import { briefingStorySchema } from './briefing-store.js';

export interface BriefingInstructionsInput {
  workspaceName: string;
  weekLabel: string;          // e.g. "Week of April 27"
  candidateBlock: string;     // already-formatted candidate list (from briefing-candidates.ts)
  learningsContext?: string;  // optional outcome-ai-injection block
}

/**
 * Returns the briefing-specific instructions (Layer 3).
 * Voice DNA + guardrails (Layer 2) are injected upstream by buildSystemPrompt().
 */
export function buildBriefingInstructions(input: Pick<BriefingInstructionsInput, 'workspaceName' | 'weekLabel'>): string;
export function buildBriefingInstructions(input: BriefingInstructionsInput): string;
export function buildBriefingInstructions(input: Partial<BriefingInstructionsInput>): string {
  const wsName = input.workspaceName ?? 'this client';
  const week = input.weekLabel ?? 'this week';
  return [
    `You are writing the weekly client briefing for ${wsName} (${week}).`,
    `The audience is a busy non-technical business owner who spends 5 minutes or less reading.`,
    `Goal: pick 3-5 stories from the candidate pool below and write a tight editorial briefing.`,
    ``,
    `RULES`,
    `- Pick 3-5 stories total.`,
    `- Tag exactly ONE story as the headline (isHeadline: true). All others isHeadline: false.`,
    `- Headlines are 5-12 words, plain English, no jargon, no SEO acronyms.`,
    `- Narratives are 1-3 sentences of editorial prose, plain English, outcome-oriented.`,
    `- Each story may include 0-2 supporting metrics as inline badges (e.g. "+12%" / "traffic"). Use only metrics that reinforce the narrative.`,
    `- Categories must be one of: win, risk, opportunity, competitive, period_change.`,
    `- Each story carries a drillIn.page that points to where the data lives in the dashboard.`,
    `- Each story carries sourceRefs[] citing the candidate IDs you used.`,
    `- If nothing material happened this week, write a short "check-in" story about what's currently working — do not return zero stories.`,
    ``,
    `OUTPUT FORMAT`,
    `Return JSON only — no Markdown, no commentary, no code fences. Shape:`,
    `{`,
    `  "stories": [`,
    `    {`,
    `      "id": "s1",`,
    `      "category": "win|risk|opportunity|competitive|period_change",`,
    `      "isHeadline": true,`,
    `      "headline": "string",`,
    `      "narrative": "string",`,
    `      "metrics": [{ "value": "+12%", "label": "traffic" }],`,
    `      "drillIn": { "page": "performance|health|strategy|content-plan|schema-review|roi|brand", "tab": "...", "queryParams": { ... } },`,
    `      "sourceRefs": [{ "type": "analytics_insight|recommendation|audit_delta", "id": "..." }]`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    input.candidateBlock ? `CANDIDATE POOL\n${input.candidateBlock}` : '',
    input.learningsContext ? `\nWORKSPACE LEARNINGS CONTEXT\n${input.learningsContext}` : '',
  ].filter(Boolean).join('\n');
}

/** Validates raw AI response. Enforces "exactly one headline" and 3-5 stories at parse time. */
export const briefingAIResponseSchema = z.object({
  stories: z.array(briefingStorySchema).min(3).max(5),
}).refine(
  (val) => val.stories.filter((s) => s.isHeadline).length === 1,
  { message: 'exactly one story must have isHeadline=true' },
);

export type BriefingAIResponse = z.infer<typeof briefingAIResponseSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/briefing-prompt.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/briefing-prompt.ts tests/unit/briefing-prompt.test.ts
git commit -m "feat(briefing): briefing-prompt.ts — instructions + AI response Zod schema"
```

---

### T1.9 — `briefing-candidates.ts` — collectors + materiality scoring (Model: sonnet)

**Owns:** `server/briefing-candidates.ts`, `tests/unit/briefing-candidates.test.ts`
**May read but not modify:** `analytics-insights-store.ts`, `recommendations.ts`, `scheduled-audits.ts`, `workspace-intelligence.ts`

**Files:**
- Create: `server/briefing-candidates.ts`
- Test: `tests/unit/briefing-candidates.test.ts`

Five collectors + a scorer. **No `weCalledIt` source** (per user decision). Wins come from `analytics_insights` where `severity === 'positive'` or category indicates a win.

- [ ] **Step 1: Write the failing test for materiality ordering**

Create `tests/unit/briefing-candidates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreCandidates, type Candidate } from '../../server/briefing-candidates';

function c(over: Partial<Candidate>): Candidate {
  return {
    id: 'c1',
    category: 'win',
    impact: 50,
    referenceId: 'r1',
    referenceType: 'analytics_insight',
    occurredAt: Date.now() - 86400_000,
    title: 't', description: 'd',
    drillIn: { page: 'performance' },
    metrics: [],
    ...over,
  };
}

describe('briefing-candidates scoring', () => {
  it('risks outrank wins of equal impact and recency', () => {
    const win = c({ category: 'win', id: 'w' });
    const risk = c({ category: 'risk', id: 'r' });
    const ranked = scoreCandidates([win, risk]);
    expect(ranked[0].id).toBe('r');
  });

  it('recency decays older candidates', () => {
    const fresh = c({ id: 'fresh', occurredAt: Date.now() });
    const old = c({ id: 'old', occurredAt: Date.now() - 30 * 86400_000 });
    const ranked = scoreCandidates([fresh, old]);
    expect(ranked[0].id).toBe('fresh');
  });

  it('higher impact wins among same-category candidates', () => {
    const a = c({ id: 'a', impact: 30 });
    const b = c({ id: 'b', impact: 80 });
    const ranked = scoreCandidates([a, b]);
    expect(ranked[0].id).toBe('b');
  });

  it('handles empty input', () => {
    expect(scoreCandidates([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/briefing-candidates.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/briefing-candidates.ts`**

```ts
// server/briefing-candidates.ts
import { getInsights } from './analytics-insights-store.js';
import { loadRecommendations } from './recommendations.js';
import { getSchedule } from './scheduled-audits.js';
import { createLogger } from './logger.js';
import type { BriefingCategory, BriefingMetric, ExplorePage, BriefingDrillIn, BriefingSourceRef } from '../shared/types/briefing.js';

const log = createLogger('briefing-candidates');

const MAX_AGE_DAYS: Record<BriefingCategory, number> = {
  win: 8,
  risk: 14,
  opportunity: 14,
  competitive: 8,
  period_change: 8,
};

const HALF_LIFE_DAYS: Record<BriefingCategory, number> = {
  win: 7,
  risk: 10,
  opportunity: 10,
  competitive: 7,
  period_change: 7,
};

const ACTIONABILITY: Record<BriefingCategory, number> = {
  risk: 1.5,
  opportunity: 1.2,
  win: 1.0,
  period_change: 0.9,
  competitive: 0.85,
};

export interface Candidate {
  id: string;
  category: BriefingCategory;
  /** 0-100 */
  impact: number;
  /** Source record id for traceability */
  referenceId: string;
  referenceType: BriefingSourceRef['type'];
  /** ms epoch — basis for recency decay */
  occurredAt: number;
  title: string;
  description: string;
  drillIn: BriefingDrillIn;
  metrics: BriefingMetric[];
}

export interface ScoredCandidate extends Candidate {
  score: number;
}

const DEFAULT_DRILL: Record<BriefingCategory, ExplorePage> = {
  win: 'performance',
  risk: 'health',
  opportunity: 'strategy',
  competitive: 'strategy',
  period_change: 'performance',
};

function ageDays(ms: number): number {
  return Math.max(0, (Date.now() - ms) / 86400_000);
}

function decay(category: BriefingCategory, ageD: number): number {
  return Math.exp(-ageD / HALF_LIFE_DAYS[category]);
}

export function scoreCandidates(cs: Candidate[]): ScoredCandidate[] {
  return cs
    .map((c) => ({
      ...c,
      score: c.impact * decay(c.category, ageDays(c.occurredAt)) * ACTIONABILITY[c.category],
    }))
    .sort((a, b) => b.score - a.score);
}

export function topNByMateriality(cs: Candidate[], n = 10): ScoredCandidate[] {
  return scoreCandidates(cs).slice(0, n);
}

// --- Collectors --------------------------------------------------------------

export function collectInsightCandidates(workspaceId: string): Candidate[] {
  const all = getInsights(workspaceId);
  const cutoff = Date.now() - MAX_AGE_DAYS.risk * 86400_000; // widest cutoff; per-category filter below
  const out: Candidate[] = [];
  for (const i of all) {
    if (i.resolutionStatus === 'resolved') continue;
    const occurredAt = new Date(i.computedAt).getTime();
    if (Number.isNaN(occurredAt) || occurredAt < cutoff) continue;

    let category: BriefingCategory;
    if (i.severity === 'positive') category = 'win';
    else if (i.insightType === 'competitor_alert' || i.insightType === 'competitor_gap') category = 'competitive';
    else if (i.insightType === 'content_decay' || i.insightType === 'cannibalization' || i.insightType === 'audit_finding' || i.insightType === 'site_health' || i.insightType === 'page_health') category = 'risk';
    else if (i.insightType === 'ranking_opportunity' || i.insightType === 'ctr_opportunity' || i.insightType === 'serp_opportunity' || i.insightType === 'keyword_cluster' || i.insightType === 'emerging_keyword') category = 'opportunity';
    else if (i.insightType === 'ranking_mover' || i.insightType === 'anomaly_digest' || i.insightType === 'freshness_alert') category = 'period_change';
    else continue; // skip admin-only types like strategy_alignment

    if (ageDays(occurredAt) > MAX_AGE_DAYS[category]) continue;

    out.push({
      id: `ins-${i.id}`,
      category,
      impact: typeof i.impactScore === 'number' ? i.impactScore : 40,
      referenceId: i.id,
      referenceType: 'analytics_insight',
      occurredAt,
      title: i.pageTitle ?? i.insightType,
      description: typeof i.data === 'object' && i.data && 'summary' in i.data ? String((i.data as { summary?: unknown }).summary ?? '') : '',
      drillIn: { page: DEFAULT_DRILL[category] },
      metrics: [],
    });
  }
  return out;
}

export function collectRecommendationCandidates(workspaceId: string): Candidate[] {
  const set = loadRecommendations(workspaceId);
  if (!set?.recommendations) return [];
  const out: Candidate[] = [];
  for (const r of set.recommendations) {
    if (r.status !== 'pending') continue;
    const occurredAt = new Date(r.updatedAt ?? r.createdAt).getTime();
    if (Number.isNaN(occurredAt)) continue;

    const category: BriefingCategory = r.priority === 'fix_now' ? 'risk' : 'opportunity';
    if (ageDays(occurredAt) > MAX_AGE_DAYS[category]) continue;

    out.push({
      id: `rec-${r.id}`,
      category,
      impact: typeof r.impactScore === 'number' ? r.impactScore : (r.impact === 'high' ? 70 : r.impact === 'medium' ? 50 : 30),
      referenceId: r.id,
      referenceType: 'recommendation',
      occurredAt,
      title: r.title,
      description: r.description ?? '',
      drillIn: { page: category === 'risk' ? 'health' : 'strategy' },
      metrics: [],
    });
  }
  return out;
}

export function collectAuditDeltaCandidates(workspaceId: string): Candidate[] {
  const sched = getSchedule(workspaceId);
  if (!sched?.lastRunAt || sched.lastScore == null) return [];
  const occurredAt = new Date(sched.lastRunAt).getTime();
  if (Number.isNaN(occurredAt)) return [];
  if (ageDays(occurredAt) > MAX_AGE_DAYS.period_change) return [];
  // Audit delta — single candidate when score changed materially. The actual delta vs. prior week
  // is computed from any history table you maintain; for Phase 1, score itself is the candidate.
  return [{
    id: `audit-${workspaceId}-${sched.lastRunAt}`,
    category: 'period_change',
    impact: Math.min(100, Math.max(20, sched.lastScore)),
    referenceId: workspaceId,
    referenceType: 'audit_delta',
    occurredAt,
    title: `Site health audit completed`,
    description: `Latest audit score: ${sched.lastScore}/100`,
    drillIn: { page: 'health' },
    metrics: [{ value: `${sched.lastScore}`, label: 'site health' }],
  }];
}

export function collectAllCandidates(workspaceId: string): Candidate[] {
  try {
    return [
      ...collectInsightCandidates(workspaceId),
      ...collectRecommendationCandidates(workspaceId),
      ...collectAuditDeltaCandidates(workspaceId),
    ];
  } catch (err) {
    log.error({ err, workspaceId }, 'collectAllCandidates failed; returning partial');
    return [];
  }
}

/** Render a numbered candidate block for the AI prompt. */
export function formatCandidateBlock(scored: ScoredCandidate[]): string {
  return scored.map((c, idx) => (
    `${idx + 1}. [${c.category}] (${c.referenceType}:${c.referenceId}) impact=${c.impact} age=${ageDays(c.occurredAt).toFixed(1)}d score=${c.score.toFixed(1)}\n` +
    `   ${c.title}${c.description ? '\n   ' + c.description : ''}`
  )).join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/briefing-candidates.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/briefing-candidates.ts tests/unit/briefing-candidates.test.ts
git commit -m "feat(briefing): briefing-candidates.ts — collectors + materiality scoring"
```

---

### T1.10 — `notifyClientBriefingReady` email helper (Model: haiku)

**Owns:** `server/email.ts` (additions only — append the new helper at the bottom of the helpers block; do not touch other helpers), `server/email-templates.ts` (append `renderBriefingReadyEmail`).

**Files:**
- Modify: `server/email.ts` (append helper after `notifyClientPostReady`)
- Modify: `server/email-templates.ts` (add render function)

- [ ] **Step 1: Add helper signature and queueEmail call to `server/email.ts`**

After the existing `notifyClientPostReady` function:

```ts
export function notifyClientBriefingReady(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId: string;
  weekOf: string;        // YYYY-MM-DD
  storyCount: number;
  heroHeadline: string;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) {
    log.debug({ workspaceId: opts.workspaceId }, 'notifyClientBriefingReady: email not configured, skipping');
    return;
  }
  queueEmail(makeEvent({
    type: 'client_briefing_ready',
    to: opts.clientEmail,
    payload: opts,
  }));
}
```

- [ ] **Step 2: Add render function to `server/email-templates.ts`**

```ts
export function renderBriefingReadyEmail(opts: {
  workspaceName: string;
  weekOf: string;
  storyCount: number;
  heroHeadline: string;
  dashboardUrl?: string;
}): { subject: string; html: string; text: string } {
  const subject = `Your ${opts.workspaceName} briefing is ready — ${opts.weekOf}`;
  const url = opts.dashboardUrl ?? '#';
  const html = `<!doctype html><html><body style="font-family:sans-serif;max-width:560px;margin:auto;color:#18181b">
    <h2 style="font-size:18px;margin:0 0 12px">This week's briefing</h2>
    <p style="color:#52525b;margin:0 0 16px">${opts.heroHeadline}</p>
    <p style="margin:0 0 24px">${opts.storyCount} ${opts.storyCount === 1 ? 'story' : 'stories'} this week.</p>
    <p><a href="${url}" style="background:#0d9488;color:white;padding:10px 16px;border-radius:6px;text-decoration:none">Read the briefing</a></p>
  </body></html>`;
  const text = `${opts.heroHeadline}\n\n${opts.storyCount} stories this week. Read at ${url}`;
  return { subject, html, text };
}
```

- [ ] **Step 3: Wire `client_briefing_ready` type into the email-queue dispatcher**

In whatever file routes queue events to renderers (typically `server/email-queue.ts` or inside `server/email.ts`'s `processQueue` switch), add a case mapping `'client_briefing_ready'` → `renderBriefingReadyEmail(payload)`. Keep this minimal — it's one switch arm.

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add server/email.ts server/email-templates.ts server/email-queue.ts 2>/dev/null || git add server/email.ts server/email-templates.ts
git commit -m "feat(briefing): notifyClientBriefingReady + renderBriefingReadyEmail (Phase 4 wires it up)"
```

---

### T1.11 — Admin briefing routes (Model: sonnet)

**Owns:** `server/routes/briefing.ts`
**May read but not modify:** `server/briefing-store.ts`, `server/middleware/validate.ts`, `server/middleware/requireWorkspaceAccess.ts`, `server/broadcast.ts`, `server/activity-log.ts`, `server/ws-events.ts`

**Files:**
- Create: `server/routes/briefing.ts`
- Test: `tests/integration/briefing-routes.test.ts` (port 13320)

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/briefing-routes.test.ts` mirroring `tests/integration/approvals-routes.test.ts`. Cover:
- GET `/api/briefing/:wsId/drafts` returns list
- PATCH `/api/briefing/:wsId/drafts/:id/stories` updates stories with Zod-validated body
- POST `/api/briefing/:wsId/drafts/:id/approve` transitions to approved
- POST `/api/briefing/:wsId/drafts/:id/publish` transitions to published, broadcasts `briefing:published`, logs activity
- POST `/api/briefing/:wsId/drafts/:id/skip` requires admin note, transitions to skipped
- POST `/api/briefing/:wsId/generate-now` (admin manual trigger — implementation deferred to T1.14, route stub returns 202 here)

Use `createTestContext(13320)` and `seedWorkspace()`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/integration/briefing-routes.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `server/routes/briefing.ts`**

```ts
// server/routes/briefing.ts
import { Router } from 'express';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess.js';
import {
  listBriefingDrafts,
  getBriefingById,
  updateBriefingStories,
  markApproved,
  markPublished,
  markSkipped,
  setBriefingAdminNote,
} from '../briefing-store.js';
import { briefingStorySchema } from '../briefing-store.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:briefing');
const router = Router();

// Literal sub-paths registered BEFORE param routes (per CLAUDE.md route-ordering rule)

// GET /api/briefing/:workspaceId/drafts — admin list
router.get(
  '/api/briefing/:workspaceId/drafts',
  requireWorkspaceAccess(':workspaceId'),
  (req, res) => {
    const drafts = listBriefingDrafts(req.params.workspaceId, 12);
    res.json({ drafts });
  },
);

// PATCH /api/briefing/:workspaceId/drafts/:draftId/stories — replace stories array
const patchStoriesSchema = z.object({
  body: z.object({
    stories: z.array(briefingStorySchema).min(1).max(5)
      .refine((arr) => arr.filter(s => s.isHeadline).length === 1, 'exactly one story must have isHeadline=true'),
  }),
});
router.patch(
  '/api/briefing/:workspaceId/drafts/:draftId/stories',
  requireWorkspaceAccess(':workspaceId'),
  validate(patchStoriesSchema),
  (req, res) => {
    const draft = getBriefingById(req.params.draftId);
    if (!draft || draft.workspaceId !== req.params.workspaceId) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    if (draft.status === 'published') return res.status(409).json({ error: 'Cannot edit published briefing' });
    const updated = updateBriefingStories(draft.id, req.body.stories);
    if (!updated) return res.status(500).json({ error: 'Update failed' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_GENERATED, { briefingId: updated.id, action: 'edited' });
    res.json({ draft: updated });
  },
);

// POST /api/briefing/:workspaceId/drafts/:draftId/approve
const approveSchema = z.object({ body: z.object({ adminNote: z.string().max(500).optional() }) });
router.post(
  '/api/briefing/:workspaceId/drafts/:draftId/approve',
  requireWorkspaceAccess(':workspaceId'),
  validate(approveSchema),
  (req, res) => {
    const draft = getBriefingById(req.params.draftId);
    if (!draft || draft.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status !== 'draft') return res.status(409).json({ error: `Cannot approve draft in status ${draft.status}` });
    const updated = markApproved(draft.id, req.body.adminNote);
    if (!updated) return res.status(500).json({ error: 'Approve failed' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_GENERATED, { briefingId: updated.id, action: 'approved' });
    res.json({ draft: updated });
  },
);

// POST /api/briefing/:workspaceId/drafts/:draftId/publish
const publishSchema = z.object({ body: z.object({ adminNote: z.string().max(500).optional() }).optional() });
router.post(
  '/api/briefing/:workspaceId/drafts/:draftId/publish',
  requireWorkspaceAccess(':workspaceId'),
  validate(publishSchema),
  (req, res) => {
    const draft = getBriefingById(req.params.draftId);
    if (!draft || draft.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status === 'published') return res.status(409).json({ error: 'Already published' });
    if (draft.status === 'skipped') return res.status(409).json({ error: 'Cannot publish a skipped briefing' });
    if (draft.stories.length < 3) return res.status(409).json({ error: 'Briefing needs at least 3 stories' });

    const updated = markPublished(draft.id, { autoPublished: false, adminNote: req.body?.adminNote });
    if (!updated) return res.status(500).json({ error: 'Publish failed' });

    addActivity(
      req.params.workspaceId,
      'briefing_published',
      `Briefing published — ${updated.weekOf}`,
      `${updated.stories.length} stories`,
      { briefingId: updated.id, weekOf: updated.weekOf, autoPublished: false },
    );
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_PUBLISHED, { briefingId: updated.id, weekOf: updated.weekOf });
    res.json({ draft: updated });
  },
);

// POST /api/briefing/:workspaceId/drafts/:draftId/skip — requires note
const skipSchema = z.object({ body: z.object({ adminNote: z.string().min(1).max(500) }) });
router.post(
  '/api/briefing/:workspaceId/drafts/:draftId/skip',
  requireWorkspaceAccess(':workspaceId'),
  validate(skipSchema),
  (req, res) => {
    const draft = getBriefingById(req.params.draftId);
    if (!draft || draft.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status === 'published') return res.status(409).json({ error: 'Cannot skip published briefing' });
    const updated = markSkipped(draft.id, req.body.adminNote);
    if (!updated) return res.status(500).json({ error: 'Skip failed' });
    addActivity(req.params.workspaceId, 'briefing_skipped', `Briefing skipped — ${updated.weekOf}`, req.body.adminNote, { briefingId: updated.id });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_GENERATED, { briefingId: updated.id, action: 'skipped' });
    res.json({ draft: updated });
  },
);

// POST /api/briefing/:workspaceId/generate-now — admin manual trigger (implemented in T1.14)
router.post(
  '/api/briefing/:workspaceId/generate-now',
  requireWorkspaceAccess(':workspaceId'),
  async (req, res) => {
    // Imports lazily to avoid circular dep with cron module
    const { runBriefingForWorkspace } = await import('../briefing-cron.js');
    runBriefingForWorkspace(req.params.workspaceId, { manual: true })
      .then(() => log.info({ workspaceId: req.params.workspaceId }, 'manual briefing run complete'))
      .catch((err) => log.error({ err, workspaceId: req.params.workspaceId }, 'manual briefing run failed'));
    res.status(202).json({ accepted: true });
  },
);

export default router;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/integration/briefing-routes.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/briefing.ts tests/integration/briefing-routes.test.ts
git commit -m "feat(briefing): admin routes — list, edit, approve, publish, skip, generate-now"
```

---

### T1.12 — Public portal: GET `/api/public/briefing/:wsId` (Model: sonnet)

**Owns:** new handler block in `server/routes/public-portal.ts` only. **Sequential file** — do not run in parallel with other public-portal edits.

**Files:**
- Modify: `server/routes/public-portal.ts` (add new handler)
- Test: `tests/integration/briefing-public.test.ts` (port 13321)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/briefing-public.test.ts` covering:
- Free-tier returns 402
- Paid-tier with no published briefing returns `{ briefing: null }`
- Paid-tier with published briefing returns `{ briefing: { weekOf, publishedAt, stories } }`
- Password-protected workspace returns 401 without password header
- Returns plain `BriefingStory[]` shape — no `sourceMetadata`, no `adminNote`

- [ ] **Step 2: Add the handler in `server/routes/public-portal.ts`**

Find a logical insertion point (next to similar public reads) and add:

```ts
import { getLatestPublishedBriefing } from '../briefing-store.js';
// ... existing imports ...

// GET /api/public/briefing/:workspaceId — client-facing latest published briefing
// Tier-gated: free → 402; paid → briefing or null.
router.get('/api/public/briefing/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal disabled' });
  // existing password check pattern (mirror nearby handlers)
  if (ws.clientPortalPassword && req.headers['x-portal-password'] !== ws.clientPortalPassword) {
    return res.status(401).json({ error: 'Password required' });
  }
  const tier = ws.tier ?? 'free';
  if (tier === 'free') return res.status(402).json({ error: 'Briefing requires paid tier' });

  const latest = getLatestPublishedBriefing(ws.id);
  if (!latest) return res.json({ briefing: null });

  // Strip admin-only fields explicitly
  res.json({
    briefing: {
      weekOf: latest.weekOf,
      publishedAt: latest.publishedAt,
      stories: latest.stories,
    },
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
npx vitest run tests/integration/briefing-public.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routes/public-portal.ts tests/integration/briefing-public.test.ts
git commit -m "feat(briefing): GET /api/public/briefing/:wsId — tier-gated public read"
```

---

### T1.13 — Register `routes/briefing.ts` in `app.ts` (Model: haiku)

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Import + use the router**

In `server/app.ts`, near other route imports:

```ts
import briefingRoutes from './routes/briefing.js';
```

In the route registration block (sequence-aware: this needs to be after admin auth middleware but before catchalls):

```ts
app.use(briefingRoutes);
```

- [ ] **Step 2: Smoke + commit**

```bash
npm run dev:server &
sleep 3
curl -s http://localhost:3000/api/briefing/dummy-ws/drafts -H 'x-auth-token: dev'
kill %1 2>/dev/null
```
Expected: a 401 or 200 (not 404). 404 means not registered.

```bash
git add server/app.ts
git commit -m "feat(briefing): register routes/briefing.ts in app.ts"
```

---

### T1.14 — Briefing cron + per-workspace runner (Model: opus)

**Files:**
- Create: `server/briefing-cron.ts`
- Modify: `server/startup.ts` (one import + one call)
- Test: `tests/integration/briefing-cron.test.ts` (port 13322)

This is the orchestration heart. Includes pre-flight freshness check, candidate collection, AI dispatch, persistence, and broadcast.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/briefing-cron.test.ts`. Cover:
- `runBriefingForWorkspace(wsId)` mocks `callAI` to return a valid response, asserts a draft is persisted with status `'draft'`, broadcast `'briefing:generated'` fires, activity logged.
- Stale audit data → defers (does NOT generate).
- After 3 deferrals (`preflightDeferralCount >= 3`), generates anyway with admin note "pending data".
- `outcome-ai-injection=false` → generation still runs, but learnings context block is empty in the prompt.
- Returns early if `lastBriefingRunWeekOf` matches current week (no duplicate).

Use `tests/mocks/anthropic.ts` for the AI mock.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/integration/briefing-cron.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `server/briefing-cron.ts`**

```ts
// server/briefing-cron.ts
import { listWorkspaces, getWorkspace, updateWorkspace } from './workspaces.js';
import { getSchedule } from './scheduled-audits.js';
import { db } from './db.js';
import { callAI } from './ai.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { isFeatureEnabled } from './feature-flags.js';
import { collectAllCandidates, formatCandidateBlock, topNByMateriality } from './briefing-candidates.js';
import { upsertBriefingDraft, getBriefingByWeek, markPublished } from './briefing-store.js';
import { briefingAIResponseSchema, buildBriefingInstructions } from './briefing-prompt.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { notifyClientBriefingReady } from './email.js';
import { createLogger } from './logger.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from './workspace-intelligence.js';

const log = createLogger('briefing-cron');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;          // poll every hour
const TARGET_DAY = 1;                              // Monday
const TARGET_HOUR_UTC = 14;                        // 14:00 UTC
const FRESHNESS_AUDIT_DAYS = 8;
const FRESHNESS_COMPETITOR_DAYS = 8;
const MAX_DEFERRALS = 3;

function currentWeekOfUTC(d = new Date()): string {
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7; // Monday=0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

function isPastTargetThisWeek(now = new Date()): boolean {
  // True if it is Monday >= 14:00 UTC, or any later day this week.
  const day = now.getUTCDay();
  if (day === 1 && now.getUTCHours() < TARGET_HOUR_UTC) return false;
  if (day === 0) return false; // Sunday is "next week"; current ISO week ends Sunday
  return true;
}

function isAuditFresh(workspaceId: string): boolean {
  const sched = getSchedule(workspaceId);
  if (!sched?.lastRunAt) return false;
  return (Date.now() - new Date(sched.lastRunAt).getTime()) < FRESHNESS_AUDIT_DAYS * 86400_000;
}

function isCompetitorFresh(workspaceId: string): boolean {
  // Read the competitor_snapshots table directly — small query, infrequent.
  try {
    const row = db.prepare('SELECT MAX(created_at) AS m FROM competitor_snapshots WHERE workspace_id = ?').get(workspaceId) as { m: number | null } | undefined;
    if (!row?.m) return true; // no competitive monitoring → not a blocker
    return (Date.now() - row.m) < FRESHNESS_COMPETITOR_DAYS * 86400_000;
  } catch {
    return true;
  }
}

interface RunOptions {
  manual?: boolean;
  /** Override "now" for testing */
  nowMs?: number;
}

export async function runBriefingForWorkspace(workspaceId: string, opts: RunOptions = {}): Promise<{ status: 'generated' | 'deferred' | 'skipped' | 'duplicate'; weekOf: string; reason?: string }> {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { status: 'skipped', weekOf: '', reason: 'workspace not found' };
  const tier = ws.tier ?? 'free';
  if (tier === 'free') return { status: 'skipped', weekOf: '', reason: 'free tier' };

  const weekOf = currentWeekOfUTC(opts.nowMs ? new Date(opts.nowMs) : new Date());

  // Duplicate guard
  if (ws.lastBriefingRunWeekOf === weekOf && !opts.manual) {
    return { status: 'duplicate', weekOf };
  }

  // Pre-flight freshness check
  const existing = getBriefingByWeek(workspaceId, weekOf);
  const deferrals = existing?.sourceMetadata?.preflightDeferralCount ?? 0;
  const auditOk = isAuditFresh(workspaceId);
  const compOk = isCompetitorFresh(workspaceId);
  if ((!auditOk || !compOk) && deferrals < MAX_DEFERRALS && !opts.manual) {
    // Note the deferral — write a placeholder source_metadata to track count
    upsertBriefingDraft({
      workspaceId, weekOf, stories: existing?.stories ?? [],
      sourceMetadata: {
        candidateCount: 0, model: 'n/a', provider: 'anthropic', generationMs: 0,
        preflightDeferralCount: deferrals + 1,
      },
    });
    log.info({ workspaceId, weekOf, deferrals: deferrals + 1, auditOk, compOk }, 'briefing pre-flight defer');
    return { status: 'deferred', weekOf, reason: !auditOk ? 'stale audit' : 'stale competitor data' };
  }

  // Collect candidates
  const candidates = collectAllCandidates(workspaceId);
  if (candidates.length === 0 && !opts.manual) {
    log.info({ workspaceId, weekOf }, 'briefing skipped — no candidates');
    return { status: 'skipped', weekOf, reason: 'no candidates' };
  }
  const top = topNByMateriality(candidates, 10);

  // Build the prompt — voice DNA injected by buildSystemPrompt; learnings context if flag enabled
  let learningsContext: string | undefined;
  if (isFeatureEnabled('outcome-ai-injection')) {
    try {
      const learnings = getWorkspaceLearnings(workspaceId);
      if (learnings) learningsContext = formatLearningsForPrompt(learnings, 'all') || undefined;
    } catch (err) {
      log.debug({ err, workspaceId }, 'learnings injection failed; soft-degrading');
    }
  }
  const candidateBlock = formatCandidateBlock(top);
  const instructions = buildBriefingInstructions({
    workspaceName: ws.name,
    weekLabel: `Week of ${weekOf}`,
    candidateBlock,
    learningsContext,
  });
  const system = buildSystemPrompt(workspaceId, instructions);

  // Dispatch
  const t0 = Date.now();
  const provider: 'anthropic' = 'anthropic';
  const model = 'claude-sonnet-4-20250514';
  const result = await callAI({
    provider, model, system,
    messages: [{ role: 'user', content: 'Generate the briefing JSON now.' }],
    feature: 'client-briefing',
    workspaceId,
    maxTokens: 2000,
    temperature: 0.5,
  });
  const generationMs = Date.now() - t0;

  // Parse + validate
  let parsed;
  try {
    parsed = briefingAIResponseSchema.parse(JSON.parse(result.text));
  } catch (err) {
    log.error({ err, workspaceId, weekOf, raw: result.text.slice(0, 400) }, 'briefing AI response invalid');
    return { status: 'skipped', weekOf, reason: 'AI response invalid' };
  }

  // Persist
  const draft = upsertBriefingDraft({
    workspaceId, weekOf,
    stories: parsed.stories,
    sourceMetadata: {
      candidateCount: top.length, model, provider, generationMs,
      preflightDeferralCount: deferrals,
    },
  });
  updateWorkspace(workspaceId, { lastBriefingRunWeekOf: weekOf });
  addActivity(workspaceId, 'briefing_generated', `Briefing draft generated — ${weekOf}`, `${parsed.stories.length} stories`, { briefingId: draft.id });
  broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEFING_GENERATED, { briefingId: draft.id, weekOf, action: 'generated' });

  // Auto-publish branch (Phase 1 wiring; off by default per workspace setting)
  if (ws.autoPublishBriefings && (ws.autoPublishAfterHours ?? 24) === 0) {
    const published = markPublished(draft.id, { autoPublished: true });
    if (published) {
      addActivity(workspaceId, 'briefing_auto_published', `Briefing auto-published — ${weekOf}`, undefined, { briefingId: published.id });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEFING_PUBLISHED, { briefingId: published.id, weekOf });
      // Phase 4 wires the email
      if (ws.clientEmail) {
        notifyClientBriefingReady({
          clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId,
          weekOf, storyCount: published.stories.length,
          heroHeadline: published.stories.find(s => s.isHeadline)?.headline ?? '',
        });
      }
    }
  }

  return { status: 'generated', weekOf };
}

let lastTickRunWeek: Record<string, string> = {}; // in-memory throttle within process

async function tick(now = new Date()): Promise<void> {
  if (!isPastTargetThisWeek(now)) return;
  const weekOf = currentWeekOfUTC(now);
  const all = listWorkspaces();
  for (const ws of all) {
    if (lastTickRunWeek[ws.id] === weekOf) continue;
    if ((ws.tier ?? 'free') === 'free') continue;
    if (!isFeatureEnabled('client-briefing-v2', ws.id)) continue; // per-workspace flag check
    try {
      const r = await runBriefingForWorkspace(ws.id);
      lastTickRunWeek[ws.id] = weekOf;
      log.info({ workspaceId: ws.id, ...r }, 'briefing tick');
    } catch (err) {
      log.error({ err, workspaceId: ws.id }, 'briefing tick error');
    }
  }
}

export function startBriefingCron(): void {
  setTimeout(() => { tick().catch((err) => log.error({ err }, 'first briefing tick failed')); }, 60_000);
  setInterval(() => { tick().catch((err) => log.error({ err }, 'briefing tick failed')); }, CHECK_INTERVAL_MS);
  log.info('briefing cron started');
}
```

- [ ] **Step 4: Wire startup**

In `server/startup.ts`, add:

```ts
import { startBriefingCron } from './briefing-cron.js';
// ... within the start function, alongside other cron starts:
startBriefingCron();
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/integration/briefing-cron.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/briefing-cron.ts server/startup.ts tests/integration/briefing-cron.test.ts
git commit -m "feat(briefing): cron — Mon 14:00 UTC, pre-flight, AI dispatch, persistence, broadcast"
```

---

### T1.15 — Audit-completion bridge: `briefing-candidate-refresh` (Model: sonnet)

**Files:**
- Modify: `server/scheduled-audits.ts` (add fourth bridge-fire near existing 3)
- Modify: `shared/types/feature-flags.ts` (add `bridge-briefing-candidate-refresh`)

- [ ] **Step 1: Add the bridge feature flag**

In `shared/types/feature-flags.ts`, in the bridges block:

```ts
  'bridge-briefing-candidate-refresh': false, // audit complete → mark briefing candidates fresh
```

- [ ] **Step 2: Add the bridge in `server/scheduled-audits.ts`**

Near the existing three bridge fires (lines 146/182/235 per audit), add:

```ts
fireBridge('bridge-briefing-candidate-refresh', ws.id, async () => {
  // No-op refresh marker — the briefing cron's pre-flight reads getSchedule().lastRunAt directly.
  // This bridge exists for symmetry + future event-driven candidate-pool invalidation hooks.
  return { modified: 0 };
});
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add server/scheduled-audits.ts shared/types/feature-flags.ts
git commit -m "feat(briefing): bridge briefing-candidate-refresh on audit completion"
```

---

### T1.16 — `src/api/briefing.ts` — typed client wrappers (Model: haiku)

**Owns:** `src/api/briefing.ts`

**Files:**
- Create: `src/api/briefing.ts`

- [ ] **Step 1: Implement typed wrappers**

```ts
// src/api/briefing.ts
import { get, post, patch } from './client';
import type { BriefingDraft, BriefingStory, PublishedBriefingResponse } from '../../shared/types/briefing';

export const briefingApi = {
  // Admin
  listDrafts: (workspaceId: string) =>
    get<{ drafts: BriefingDraft[] }>(`/api/briefing/${workspaceId}/drafts`).then(r => r.drafts),

  updateStories: (workspaceId: string, draftId: string, stories: BriefingStory[]) =>
    patch<{ draft: BriefingDraft }>(`/api/briefing/${workspaceId}/drafts/${draftId}/stories`, { stories })
      .then(r => r.draft),

  approve: (workspaceId: string, draftId: string, adminNote?: string) =>
    post<{ draft: BriefingDraft }>(`/api/briefing/${workspaceId}/drafts/${draftId}/approve`, { adminNote })
      .then(r => r.draft),

  publish: (workspaceId: string, draftId: string, adminNote?: string) =>
    post<{ draft: BriefingDraft }>(`/api/briefing/${workspaceId}/drafts/${draftId}/publish`, { adminNote })
      .then(r => r.draft),

  skip: (workspaceId: string, draftId: string, adminNote: string) =>
    post<{ draft: BriefingDraft }>(`/api/briefing/${workspaceId}/drafts/${draftId}/skip`, { adminNote })
      .then(r => r.draft),

  generateNow: (workspaceId: string) =>
    post<{ accepted: true }>(`/api/briefing/${workspaceId}/generate-now`, {}),

  // Client (read-only, public endpoint)
  getPublished: (workspaceId: string) =>
    get<{ briefing: PublishedBriefingResponse | null }>(`/api/public/briefing/${workspaceId}`).then(r => r.briefing),
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/api/briefing.ts
git commit -m "feat(briefing): src/api/briefing.ts — typed admin + client wrappers"
```

---

### T1.17 — Admin React Query hooks (Model: haiku)

**Owns:** `src/hooks/admin/useBriefingDrafts.ts`

**Files:**
- Create: `src/hooks/admin/useBriefingDrafts.ts`

- [ ] **Step 1: Implement hooks**

```ts
// src/hooks/admin/useBriefingDrafts.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { briefingApi } from '../../api/briefing';
import { queryKeys } from '../../lib/queryKeys';
import type { BriefingStory } from '../../../shared/types/briefing';

export function useBriefingDrafts(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.briefingDrafts(workspaceId),
    queryFn: () => briefingApi.listDrafts(workspaceId),
    enabled: !!workspaceId,
  });
}

export function usePublishBriefing(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote?: string }) =>
      briefingApi.publish(workspaceId, draftId, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}

export function useEditBriefingStories(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, stories }: { draftId: string; stories: BriefingStory[] }) =>
      briefingApi.updateStories(workspaceId, draftId, stories),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}

export function useSkipBriefing(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote: string }) =>
      briefingApi.skip(workspaceId, draftId, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}

export function useGenerateBriefingNow(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => briefingApi.generateNow(workspaceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/hooks/admin/useBriefingDrafts.ts
git commit -m "feat(briefing): admin React Query hooks for drafts list + mutations"
```

---

### T1.18 — `<BriefingReviewQueue />` admin component (Model: sonnet)

**Owns:** `src/components/admin/BriefingReviewQueue.tsx`
**May read:** `src/components/PendingApprovals.tsx` (UX pattern reference)

**Files:**
- Create: `src/components/admin/BriefingReviewQueue.tsx`

- [ ] **Step 1: Implement the component**

Mirror `PendingApprovals.tsx` UX (status badges, expand/collapse, action buttons). Key requirements:

- Section card with title "Weekly Briefings" + count
- For each draft (most recent first): row with weekOf, status badge, story count, expand/collapse
- Expanded view shows the stories (headline + narrative + category), with inline edit capability for headline/narrative/order (Phase 1 acceptable: read-only display + "Approve" + "Publish" + "Skip" + "Regenerate" buttons; full editing UX deferred to a follow-up)
- Status badge colors: `draft` → teal, `approved` → emerald, `published` → emerald, `skipped` → zinc
- Empty state: "No briefings yet — Mondays at 14:00 UTC"
- "Generate Now" button at the top (calls `useGenerateBriefingNow`)
- Status-conditional buttons: draft → [Approve, Publish, Skip]; approved → [Publish, Skip]; published → [view-only]; skipped → [view-only]

```tsx
// src/components/admin/BriefingReviewQueue.tsx
import { useState } from 'react';
import { useBriefingDrafts, usePublishBriefing, useSkipBriefing, useGenerateBriefingNow } from '../../hooks/admin/useBriefingDrafts';
import { SectionCard, Badge, EmptyState, LoadingState, ConfirmDialog } from '../ui';
import { Sparkles, ChevronDown, ChevronRight, Send, X, RefreshCw } from 'lucide-react';
import type { BriefingDraftStatus } from '../../../shared/types/briefing';

function statusColor(s: BriefingDraftStatus): 'teal' | 'emerald' | 'zinc' {
  if (s === 'draft') return 'teal';
  if (s === 'approved' || s === 'published') return 'emerald';
  return 'zinc';
}

export function BriefingReviewQueue({ workspaceId }: { workspaceId: string }) {
  const { data: drafts = [], isLoading } = useBriefingDrafts(workspaceId);
  const publishM = usePublishBriefing(workspaceId);
  const skipM = useSkipBriefing(workspaceId);
  const genM = useGenerateBriefingNow(workspaceId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [skipping, setSkipping] = useState<string | null>(null);
  const [skipNote, setSkipNote] = useState('');

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (isLoading) return <LoadingState message="Loading briefings..." />;

  return (
    <SectionCard
      title="Weekly Briefings"
      icon={Sparkles}
      action={
        <button
          onClick={() => genM.mutate()}
          disabled={genM.isPending}
          className="text-xs px-3 py-1.5 rounded-md bg-teal-600/10 text-teal-400 hover:bg-teal-600/20 border border-teal-600/30 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Generate now
        </button>
      }
    >
      {drafts.length === 0 ? (
        <EmptyState message="No briefings yet — runs Mondays at 14:00 UTC" />
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => (
            <div key={d.id} className="border border-zinc-800 rounded-md">
              <button
                onClick={() => toggle(d.id)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-900/50"
              >
                <div className="flex items-center gap-3">
                  {expanded.has(d.id) ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                  <span className="text-sm text-zinc-200">{d.weekOf}</span>
                  <Badge color={statusColor(d.status)}>{d.status}</Badge>
                  <span className="text-xs text-zinc-500">{d.stories.length} stories</span>
                </div>
                <span className="text-xs text-zinc-600">{new Date(d.updatedAt).toLocaleString()}</span>
              </button>
              {expanded.has(d.id) && (
                <div className="border-t border-zinc-800 p-3 space-y-3">
                  {d.stories.map((s, i) => (
                    <div key={s.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge color={s.isHeadline ? 'teal' : 'zinc'}>{s.category}</Badge>
                        {s.isHeadline && <span className="text-[10px] uppercase tracking-wide text-teal-400">Headline</span>}
                      </div>
                      <div className="text-sm text-zinc-100">{s.headline}</div>
                      <div className="text-xs text-zinc-400">{s.narrative}</div>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-2 border-t border-zinc-800/50">
                    {d.status !== 'published' && d.status !== 'skipped' && (
                      <button
                        onClick={() => publishM.mutate({ draftId: d.id })}
                        disabled={publishM.isPending}
                        className="text-xs px-3 py-1.5 rounded-md bg-teal-600/15 text-teal-400 hover:bg-teal-600/25 border border-teal-600/30 inline-flex items-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" /> Publish
                      </button>
                    )}
                    {d.status !== 'published' && d.status !== 'skipped' && (
                      <button
                        onClick={() => { setSkipping(d.id); setSkipNote(''); }}
                        className="text-xs px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 inline-flex items-center gap-1.5"
                      >
                        <X className="w-3.5 h-3.5" /> Skip
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={skipping !== null}
        title="Skip this briefing?"
        body={
          <div className="space-y-2">
            <p className="text-sm text-zinc-300">Skipped briefings are not published to the client. Note your reason:</p>
            <input
              value={skipNote}
              onChange={(e) => setSkipNote(e.target.value)}
              className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
              placeholder="e.g. quiet week, low confidence stories"
            />
          </div>
        }
        confirmLabel="Skip"
        confirmDisabled={!skipNote.trim()}
        onConfirm={() => {
          if (skipping && skipNote.trim()) {
            skipM.mutate({ draftId: skipping, adminNote: skipNote.trim() });
            setSkipping(null);
          }
        }}
        onCancel={() => setSkipping(null)}
      />
    </SectionCard>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/components/admin/BriefingReviewQueue.tsx
git commit -m "feat(briefing): admin BriefingReviewQueue component"
```

---

### T1.19 — Wire `<BriefingReviewQueue />` into `WorkspaceHome.tsx` + WS handler (Model: sonnet)

**Files:**
- Modify: `src/components/WorkspaceHome.tsx`

- [ ] **Step 1: Import + render alongside `<PendingApprovals>`**

Add import and place the component near the existing PendingApprovals block. Order it AFTER PendingApprovals (briefings are weekly, less time-sensitive).

- [ ] **Step 2: Add WS handler**

In the `useWorkspaceEvents` (or admin equivalent — check the file for the pattern; if WorkspaceHome uses `useGlobalAdminEvents` for global fanout, add a per-workspace `useWorkspaceEvents` for these two events specifically):

```ts
useWorkspaceEvents(workspaceId, {
  'briefing:generated': () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  'briefing:published': () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
});
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/components/WorkspaceHome.tsx
git commit -m "feat(briefing): wire BriefingReviewQueue + WS handler in WorkspaceHome"
```

---

### T1.20 — Phase 1 verification + docs (Model: sonnet)

- [ ] **Step 1: Add WS-pair contract test**

Create `tests/contract/briefing-ws-handler.test.ts` (port not needed — type/interface assertions only):

```ts
import { describe, it, expect } from 'vitest';
import { WS_EVENTS } from '../../server/ws-events';

describe('briefing WS event contracts', () => {
  it('exports BRIEFING_GENERATED and BRIEFING_PUBLISHED', () => {
    expect(WS_EVENTS.BRIEFING_GENERATED).toBe('briefing:generated');
    expect(WS_EVENTS.BRIEFING_PUBLISHED).toBe('briefing:published');
  });
});
```

(The end-to-end pair test happens in `tests/integration/briefing-routes.test.ts` and `briefing-cron.test.ts` already.)

- [ ] **Step 2: Update FEATURE_AUDIT.md**

Add an entry:

```markdown
### Weekly Briefing — Generation Pipeline (dark-launched)
Status: Phase 1 shipped (PR #N)
Where: server/briefing-{store,prompt,candidates,cron}.ts, server/routes/briefing.ts, src/components/admin/BriefingReviewQueue.tsx
Schedule: Monday 14:00 UTC, hourly poll, per-workspace pre-flight freshness check
Model: claude-sonnet-4-20250514 via callAI (provider: anthropic)
Activity types: briefing_generated, briefing_published, briefing_skipped, briefing_auto_published
WS events: briefing:generated, briefing:published
Feature flag: client-briefing-v2 (default off)
```

- [ ] **Step 3: Update `data/roadmap.json`**

Add a sprint entry for "Client Insights Briefing Refactor" with phase 1 → done. Run `npx tsx scripts/sort-roadmap.ts`.

- [ ] **Step 4: Create `docs/rules/briefing-pipeline.md`**

Reference doc covering: candidate-pool contracts (5 categories, scoring), prompt schema (Zod-validated AI response, single-headline rule), pre-flight (audit + competitor freshness, max 3 deferrals), persistence (UNIQUE on workspace_id+week_of), broadcast pattern, voice DNA injection (single Layer 2 via buildSystemPrompt), tier gating (free → 402 on public endpoint, free skipped from cron).

- [ ] **Step 5: Run all quality gates**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```
Expected: all pass.

- [ ] **Step 6: Invoke scaled-code-review skill**

Per CLAUDE.md, parallel-agent work requires `scaled-code-review` before merging.

- [ ] **Step 7: Commit + open PR to `staging`**

```bash
git add FEATURE_AUDIT.md data/roadmap.json docs/rules/briefing-pipeline.md tests/contract/briefing-ws-handler.test.ts
git commit -m "docs(briefing): Phase 1 acceptance — FEATURE_AUDIT, roadmap, rule reference"
gh pr create --base staging --title "feat(briefing): Phase 1 — generation pipeline (dark-launched)"
```

---

# Phase 2 (PR 2) — Client Insights Page Rendering (flag-gated)

Renders the briefing on the client's Insights tab when `client-briefing-v2` is enabled. Free tier sees an upgrade CTA + repurposed `MonthlyDigest`.

## Task Dependencies (Phase 2)

```
Sequential pre-batch:
  T2.0 ClientSignalsSlice add latestBriefing field
  T2.1 assembleClientSignals reads briefing
  T2.2 MonthlyDigest refactor → extract MonthlyDigestContent
  T2.3 src/api/briefing.ts already has getPublished (T1.16)
  T2.4 src/hooks/client/useClientBriefing.ts

Parallel batch:
  T2.5 ActionQueueStrip       [agent owns]
  T2.6 HeroStoryCard          [agent owns]
  T2.7 SecondaryStoryRow      [agent owns]
  T2.8 FreeTierUpgradeCTA     [agent owns]

Sequential after batch:
  T2.9  InsightsBriefingPage (composes all 4 + flag gate + free-tier branch)
  T2.10 OverviewTab.tsx flag-conditional swap
  T2.11 ClientChatWidget accepts quickQuestions prop
  T2.12 ClientDashboard adds 'briefing:published' useWorkspaceEvents handler
  T2.13 Tests + docs
```

### T2.0 — Add `latestBriefing` to `ClientSignalsSlice` (Model: haiku)

- Modify `shared/types/intelligence.ts`: add `latestBriefing: BriefingSummary | null` to `ClientSignalsSlice`. Import `BriefingSummary` from `./briefing.js`.
- Typecheck. Commit.

### T2.1 — Extend `assembleClientSignals` (Model: sonnet)

- Modify `server/workspace-intelligence.ts` (around line 1086+).
- Add a prepared statement to `briefing-store.ts` (or import `getLatestPublishedBriefing`) and read it.
- Build `BriefingSummary` and include in returned slice; null if none.
- Test: `tests/integration/intelligence-briefing-slice.test.ts` (port 13323) — assert slice includes `latestBriefing` after publish, null before.

### T2.2 — Refactor `MonthlyDigest` (Model: sonnet)

- Extract the body of `<MonthlyDigest>` into `<MonthlyDigestContent>` (un-gated, accepts `digest` data + presentational props).
- Keep `<MonthlyDigest>` as the gated wrapper that calls `useMonthlyDigest` and renders `<TierGate required="growth"><MonthlyDigestContent ... /></TierGate>`.
- Add `<MonthlyDigestContent>` export so the Free-tier branch can render it un-gated.

### T2.3 — (no work, T1.16 already shipped `briefingApi.getPublished`)

### T2.4 — `useClientBriefing` hook (Model: haiku)

```ts
// src/hooks/client/useClientBriefing.ts
import { useQuery } from '@tanstack/react-query';
import { briefingApi } from '../../api/briefing';
import { queryKeys } from '../../lib/queryKeys';

export function useClientBriefing(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.briefing(workspaceId),
    queryFn: () => briefingApi.getPublished(workspaceId),
    enabled: enabled && !!workspaceId,
  });
}
```

### T2.5 — `<ActionQueueStrip />` (Model: sonnet)

**Owns:** `src/components/client/Briefing/ActionQueueStrip.tsx`

- Amber action strip rendering 5 chip types (pending approvals, brief reviews, post reviews, team replies, content-plan reviews).
- Each chip: `[<count> <noun>]` with deep-link to relevant Inbox sub-section via `clientPath(wsId, 'inbox') + '?tab=' + section`.
- Reads counts from existing client data (PendingApprovals count, etc.) — pass via props from `InsightsBriefingPage`.
- Visual: amber-500/15 background, border-amber-500/30, text-amber-300.

### T2.6 — `<HeroStoryCard />` (Model: sonnet)

**Owns:** `src/components/client/Briefing/HeroStoryCard.tsx`

- Renders the single hero story: large card with category icon (top-right), bold headline, narrative paragraph, 0-2 inline metric badges, "See the data →" link to `drillIn` destination.
- Color: teal accent border-left, larger typography (`t-h2` for headline, `t-body` for narrative, `t-stat-sm` for metrics).
- Drill-in renderer: `clientPath(wsId, drillIn.page, betaMode) + '?tab=' + (drillIn.tab ?? '') + (queryParams ? '&' + new URLSearchParams(queryParams) : '')` (only include `?tab=` if present).

### T2.7 — `<SecondaryStoryRow />` (Model: sonnet)

**Owns:** `src/components/client/Briefing/SecondaryStoryRow.tsx`

- Single divider-row story: category icon (left), headline + tiny narrative (middle, two lines max), drill-in arrow (right).
- No card chrome. Border-bottom-zinc-800. Hover: bg-zinc-900/50.
- Category icons: win=star, risk=alert-triangle, opportunity=lightbulb, competitive=search, period_change=trending-up.

### T2.8 — `<FreeTierUpgradeCTA />` (Model: haiku)

**Owns:** `src/components/client/Briefing/FreeTierUpgradeCTA.tsx`

- Teal CTA card: "Unlock your weekly briefing" headline, two-line value prop, "Upgrade to Growth" button linking to `clientPath(wsId, 'plans')`.

### T2.9 — `<InsightsBriefingPage />` composer (Model: sonnet)

**Files:** `src/components/client/Briefing/InsightsBriefingPage.tsx`

```tsx
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { useClientBriefing } from '../../../hooks/client/useClientBriefing';
import { ActionQueueStrip } from './ActionQueueStrip';
import { HeroStoryCard } from './HeroStoryCard';
import { SecondaryStoryRow } from './SecondaryStoryRow';
import { FreeTierUpgradeCTA } from './FreeTierUpgradeCTA';
import { MonthlyDigestContent } from '../MonthlyDigest';
import { LoadingState, EmptyState } from '../../ui';
import type { Tier } from '../../ui';

export function InsightsBriefingPage(props: {
  workspaceId: string;
  effectiveTier: Tier;
  betaMode: boolean;
  actionCounts: { approvals: number; briefs: number; posts: number; replies: number; contentPlan: number };
  // ... pass through what ActionQueueStrip needs ...
}) {
  const isFree = props.effectiveTier === 'free';
  const { data: briefing, isLoading } = useClientBriefing(props.workspaceId, !isFree);

  return (
    <div className="space-y-6">
      <ActionQueueStrip workspaceId={props.workspaceId} betaMode={props.betaMode} counts={props.actionCounts} />
      {isFree ? (
        <>
          <FreeTierUpgradeCTA workspaceId={props.workspaceId} betaMode={props.betaMode} />
          <MonthlyDigestContent workspaceId={props.workspaceId} />
        </>
      ) : isLoading ? (
        <LoadingState message="Loading this week's briefing..." />
      ) : !briefing || briefing.stories.length === 0 ? (
        <EmptyState message="Your first briefing will arrive Monday." />
      ) : (
        <>
          {briefing.stories.filter(s => s.isHeadline).map(s => (
            <HeroStoryCard key={s.id} story={s} workspaceId={props.workspaceId} betaMode={props.betaMode} />
          ))}
          <div className="border-t border-zinc-800 pt-4">
            <h3 className="t-label text-zinc-500 mb-3">Also this week</h3>
            <div className="space-y-0">
              {briefing.stories.filter(s => !s.isHeadline).map(s => (
                <SecondaryStoryRow key={s.id} story={s} workspaceId={props.workspaceId} betaMode={props.betaMode} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

### T2.10 — `OverviewTab.tsx` flag-conditional swap (Model: sonnet)

- Read flag: `const briefingV2Enabled = useFeatureFlag('client-briefing-v2');`
- Conditional render: `if (briefingV2Enabled) return <InsightsBriefingPage ... />; else return <existing OverviewTab body>;`

### T2.11 — `ClientChatWidget` accepts `quickQuestions` prop (Model: haiku)

- Add `quickQuestions?: string[]` prop. When provided, render as buttons inside the collapsed chat widget header.
- Keep backward compatibility: existing OverviewTab sidebar buttons still work until OverviewTab is retired (Phase 4).

### T2.12 — `ClientDashboard` WS handler (Model: haiku)

- Add to existing `useWorkspaceEvents` block (lines 180-198):

```ts
'briefing:published': () => refetchClient('briefing', `/api/public/briefing/${workspaceId}`),
```

### T2.13 — Phase 2 tests + docs (Model: sonnet)

- Contract test: deep-link renderer produces correct path for each `ExplorePage` value.
- Integration test: `useClientBriefing` returns null for free tier (server returns 402 → handle gracefully).
- Update `BRAND_DESIGN_LANGUAGE.md` with the magazine layout + amber strip rules.
- Update `data/features.json` (briefing is client-impactful, sales-relevant).
- Run quality gates. Open PR to `staging`.

---

# Phase 3 (PR 3) — Navigation Simplification (flag-gated)

Collapses the 10-tab nav to 4 (Insights, Inbox, Plans, Explore drawer). All routes preserved — only `NAV` array + drawer rendering changes.

### T3.0 — `<ExploreDrawer />` (Model: sonnet)

**Files:** `src/components/client/ExploreDrawer.tsx`

- Drawer panel listing 7 destinations with icons (Performance, Site Health, SEO Strategy, Content Plan, Schema, ROI, Brand).
- Hover or click reveal; click-outside-closes; Esc-closes.
- Each link respects existing tier/data conditions (e.g., Strategy locked for free, ROI requires `strategyData`, Content Plan requires `contentPlanSummary.totalCells > 0`).
- Click navigates via `clientNavigate(clientPath(wsId, page, betaMode))`.

### T3.1 — `ClientDashboard.tsx` NAV reduction (Model: sonnet)

- Read flag: `const briefingV2Enabled = useFeatureFlag('client-briefing-v2');`
- When flag ON: render only `[Insights, Inbox, Plans, Explore ▾]`. Inbox conditional on `isPaid`. Plans conditional on `!betaMode && !isExternalBilling`. Explore drawer always visible (its inner items respect existing conditions).
- When flag OFF: render existing 10-tab NAV.

### T3.2 — Tests for drawer keyboard nav + flag-off fallback (Model: sonnet)

- Playwright (or vitest + jsdom) test for drawer Esc-closes, click-outside-closes, focus management.
- Test that flag-off renders the existing 10-tab NAV unchanged.

### T3.3 — Quality gates + PR (Model: haiku)

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```
Open PR to `staging`.

---

# Phase 4 (PR 4) — Email + Narrative Endpoint Convergence (post-soak)

After ≥2 weekly briefings have been generated and reviewed on staging, plus visual verification on real workspaces.

### T4.0 — `monthly-report.ts` weekly-mode swap (Model: sonnet)

- In the weekly-frequency branch, when `tier !== 'free'` AND a published briefing exists for the current week, replace the metrics email body with `notifyClientBriefingReady()` (the helper added in T1.10) including a hero headline and the dashboard URL.
- Free-tier and monthly-frequency continue with the existing metrics email.
- Test: `tests/integration/monthly-report-briefing.test.ts` (port 13324).

### T4.1 — `/api/public/insights/:wsId/narrative` retarget (Model: sonnet)

- Modify `server/routes/public-analytics.ts:124` (the `/narrative` handler).
- For paid-tier workspaces with a published briefing this week: return `{ briefing: BriefingSummary, stories: BriefingStory[] }` (or just summary if response shape concerns).
- Free tier continues with `buildClientInsights(wsId)`.
- Test: `tests/integration/narrative-endpoint-paid.test.ts`.

### T4.2 — Flip flag default (Model: haiku)

- `shared/types/feature-flags.ts`: `'client-briefing-v2': true`.

### T4.3 — Retire legacy components per spec §7 (Model: sonnet)

- Delete: `HealthScoreCard` (from Insights — keep the file for reuse on Site Health page if shared), the StatCard 5-card row block in `OverviewTab` (extract if reused elsewhere), action-needed banner JSX, primary CTA banner, `IntelligenceSummaryCard` import from OverviewTab, `PredictionShowcaseCard` import from OverviewTab, `InsightsDigest` import from OverviewTab.
- Audit each component: if used elsewhere, just remove the OverviewTab import; if exclusive to OverviewTab, delete file + tests.
- `OverviewTab` becomes a thin wrapper around `InsightsBriefingPage` (or is itself retired and `InsightsBriefingPage` becomes the registered Insights tab).

### T4.4 — Cleanup PR scheduling (Model: haiku)

- Use the project's `/schedule` skill: schedule a one-time agent +14 days to:
  1. Remove the `client-briefing-v2` flag from `shared/types/feature-flags.ts` and all callsites.
  2. Confirm no production code paths depend on the flag.
  3. Open a cleanup PR.
- Update `FEATURE_AUDIT.md` Phase 4 entry. Update `BRAND_DESIGN_LANGUAGE.md` if any final visual tweaks landed.
- Run quality gates. Open PR to `staging`.

---

## Cross-Phase Contracts

### Phase 1 → Phase 2 (what Phase 2 imports)

- **DB tables** (read-only from Phase 2): `briefing_drafts`
- **Functions exported by `server/briefing-store.ts`** (Phase 2 reads):
  - `getLatestPublishedBriefing(workspaceId): BriefingDraft | null`
- **Functions exported by `server/email.ts`** (Phase 4 only, but registered in Phase 1):
  - `notifyClientBriefingReady({ … })`
- **Shared types** (Phase 2 + 3 + 4 import):
  - `BriefingStory`, `BriefingDraft`, `BriefingSummary`, `BriefingCategory`, `ExplorePage`, `PublishedBriefingResponse` from `shared/types/briefing.ts`
- **HTTP routes available**:
  - `GET /api/public/briefing/:wsId` (client)
  - `GET /api/briefing/:wsId/drafts` (admin) and the mutation routes
- **WS events**:
  - `WS_EVENTS.BRIEFING_GENERATED`, `WS_EVENTS.BRIEFING_PUBLISHED`
- **API client**:
  - `briefingApi.getPublished(wsId)`, `briefingApi.listDrafts(wsId)`, mutations

### Phase 2 → Phase 3 (what Phase 3 imports)

- **Components** Phase 3 may import:
  - `<InsightsBriefingPage>` — Phase 3 NAV reduction does not touch this; it stays mounted as the Insights tab body.
- **No new types needed.**

### Phase 3 → Phase 4 (what Phase 4 imports)

- **Components retired by Phase 4** are listed in §7 of the spec. Phase 3 does NOT delete them.
- **Phase 4 deletions** must verify no other callers exist.

---

## Systemic Improvements

### Shared utilities created

- `server/briefing-store.ts` — DB layer + Zod schemas (foundation for all briefing reads/writes).
- `server/briefing-prompt.ts` — single source of truth for briefing instructions + AI response validation.
- `server/briefing-candidates.ts` — five-source candidate collector + materiality scorer.
- `server/briefing-cron.ts` — orchestration with pre-flight, AI dispatch, persistence, broadcast.
- `src/api/briefing.ts` — typed HTTP wrappers.
- `src/hooks/admin/useBriefingDrafts.ts` + `src/hooks/client/useClientBriefing.ts` — React Query hooks.
- `src/components/client/Briefing/MonthlyDigestContent` (extracted) — reusable un-gated digest body.

### pr-check rules to add (Phase 1 commits, Phase 2-4 may extend)

1. `briefing_drafts.stories` JSON parse must use `parseJsonSafeArray` — pattern-based.
2. Briefing routes must have `requireWorkspaceAccess(:workspaceId)` middleware (mechanizes the auth rule for this resource).

(Both deferred to a follow-up if Phase 1 ships clean. Author per `docs/rules/pr-check-rule-authoring.md`.)

### Tests created (per phase)

| Phase | Test | Type | Port |
|---|---|---|---|
| 1 | briefing-store round-trip + healing | unit | n/a |
| 1 | briefing-prompt schema rejects bad payloads | unit | n/a |
| 1 | briefing-candidates scoring properties | unit | n/a |
| 1 | admin routes (list/edit/approve/publish/skip/generate-now) | integration | 13320 |
| 1 | public endpoint (tier gate, password) | integration | 13321 |
| 1 | cron run + pre-flight defer + soft-degrade | integration | 13322 |
| 1 | WS event constants | contract | n/a |
| 2 | intelligence slice includes `latestBriefing` | integration | 13323 |
| 2 | drillIn renderer path correctness | contract | n/a |
| 3 | drawer keyboard nav + flag-off fallback | component (vitest+jsdom) | n/a |
| 4 | monthly-report swaps to briefing email | integration | 13324 |
| 4 | narrative endpoint paid-tier returns briefing | integration | 13325 |

### Documentation updates

| Phase | File | Update |
|---|---|---|
| 1 | `FEATURE_AUDIT.md` | Add briefing pipeline entry |
| 1 | `data/roadmap.json` | Sprint entry, Phase 1 → done |
| 1 | `docs/rules/briefing-pipeline.md` | New feature reference doc |
| 1 | `docs/rules/automated-rules.md` | Regenerate if pr-check rules added |
| 2 | `BRAND_DESIGN_LANGUAGE.md` | Add magazine layout + amber strip section |
| 2 | `data/features.json` | Add Briefing entry (sales-relevant) |
| 2 | `FEATURE_AUDIT.md` | Phase 2 entry |
| 2 | `data/roadmap.json` | Phase 2 → done |
| 3 | `FEATURE_AUDIT.md` | Phase 3 nav simplification entry |
| 3 | `BRAND_DESIGN_LANGUAGE.md` | Add Explore drawer pattern |
| 4 | `FEATURE_AUDIT.md` | Phase 4 convergence entry; retire legacy entries |
| 4 | `MONETIZATION.md` | Note Free-tier limitation (action queue + MonthlyDigest only) |

---

## Verification Strategy

### Per-PR quality gates (every phase)

```bash
npm run typecheck                    # zero errors
npx vite build                       # production build succeeds
npx vitest run                       # full suite green
npx tsx scripts/pr-check.ts          # zero violations
grep -r "violet\|indigo" src/components/  # zero matches
```

### Phase 1-specific verification

```bash
# Migration applied
sqlite3 data/dashboard.db ".schema briefing_drafts"
sqlite3 data/dashboard.db "SELECT name FROM pragma_table_info('workspaces') WHERE name LIKE 'auto_publish%' OR name='last_briefing_run_week_of'"

# Manual cron run (paid workspace required)
curl -X POST http://localhost:3000/api/briefing/<wsId>/generate-now -H 'x-auth-token: <token>'

# Verify draft in admin UI
open http://localhost:5173/ws/<wsId>

# Verify public endpoint (paid)
curl http://localhost:3000/api/public/briefing/<paid-wsId>
# Expected: { "briefing": {...} } if published, { "briefing": null } if not

# Verify free tier returns 402
curl http://localhost:3000/api/public/briefing/<free-wsId>
# Expected: 402 Payment Required
```

### Phase 2-specific verification

- Toggle `client-briefing-v2` ON for one workspace via env var: `VITE_FEATURE_CLIENT_BRIEFING_V2=true npm run dev`
- Visual check: Insights tab renders ActionQueueStrip + Hero + Secondary rows
- Free-tier workspace: visual check shows upgrade CTA + MonthlyDigest below
- Click drill-in on each story → lands on correct Explore page

### Phase 3-specific verification

- Flag ON: only Insights / Inbox / Plans / Explore visible at top
- Click Explore → drawer opens with 7 items
- Esc closes drawer; click outside closes drawer
- Flag OFF: existing 10-tab NAV renders identically

### Phase 4-specific verification

- Trigger weekly-frequency send for a paid workspace (env var override `MONTHLY_REPORT_FORCE_TICK=1` or wait for next 6h tick).
- Inspect outbound email: subject "Your … briefing is ready", body matches template, link works.
- `/api/public/insights/<paid-wsId>/narrative` returns briefing summary, not `buildClientInsights` output.
- Flag default flipped → existing flag-off paths no longer reachable.

### Final cross-phase verification (after all PRs merged)

- A returning client opens `/client/<paid-wsId>` and reads the entire page in <60 seconds (acceptance signal §spec).
- ≤7 distinct UI elements visible (action strip + hero + ≤5 rows + week label).
- Same client revisiting after 6 days sees a different briefing (proves freshness).
- Zero tabs visible at top level beyond Insights / Inbox / Plans / Explore.
- Admin review of a weekly briefing takes ≤5 minutes per workspace.

---

## Open Risks (monitor across all phases)

1. **Empty-week handling** — if `collectAllCandidates` returns < 3 items, the AI cannot satisfy the schema's `min(3)`. Mitigation in T1.14: if `top.length < 3`, soften prompt to "write a check-in" and lower schema floor in a temporary branch (or always include a "what's working" candidate from `analytics_insights` positive-severity rows). Verify on first quiet test workspace.
2. **Voice-uncalibrated workspaces** — `buildSystemPrompt` no-ops voice DNA when `status !== 'calibrated'`. Briefing prose will use generic editorial voice. Acceptable for Phase 1; document in `briefing-pipeline.md`.
3. **Cost** — one Anthropic Sonnet call per paid workspace per week. At 50 workspaces × ~3K input tokens × $3/MT input ≈ $0.45/week. Negligible. Monitor via `feature: 'client-briefing'` AI usage tag.
4. **Public endpoint password header** — confirm the existing public-portal password convention header name during T1.12 (likely `x-portal-password`); align with sibling endpoints.
5. **`audit_snapshots` history for W/W audit deltas** — T1.9's `collectAuditDeltaCandidates` uses only `lastScore` from `getSchedule`; there's no prior-week comparison. Phase 1 ships this limitation; Phase 2 may add a small `audit_history` query if real briefings need W/W deltas.

---

## Self-Review

- [x] Spec coverage: every section of the spec maps to a task (§1 Layout → T2.5–T2.9; §2 Candidates → T1.9; §3 Pipeline → T1.14, T1.15; §4 Data model → T1.0, T1.1; §5 Intelligence → T2.0, T2.1; §6 Navigation → T3.x; §7 Component fate → T4.3; §8 Rollout → all phases; §9 Verification tasks → resolved in audit + applied above).
- [x] No placeholders — all code blocks complete, all commands explicit.
- [x] Type consistency — `BriefingStory`, `BriefingDraft`, `BriefingSummary`, `ExplorePage`, `BriefingCategory` defined once in `shared/types/briefing.ts` and imported consistently. `briefingStorySchema` exported from `briefing-store.ts` and reused in `briefing-prompt.ts` and `routes/briefing.ts`.
- [x] Cross-phase contracts documented above.
- [x] Verification strategy includes specific commands, not "manual verification."
- [x] Per-phase PR boundary respected.
