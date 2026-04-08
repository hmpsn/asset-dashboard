# Meeting Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an on-demand AI-generated meeting brief tab (`/ws/:workspaceId/brief`) that synthesizes WorkspaceIntelligence into a structured, screen-shareable narrative for client calls.

**Architecture:** A new `meeting_briefs` DB table stores one brief per workspace. A server generator calls `buildWorkspaceIntelligence()` to assemble context, prompts GPT-4.1 for the narrative sections, then assembles metric data from intelligence slices directly (no AI). A React tab renders empty/loading/populated states.

**Tech Stack:** Express + TypeScript (server), React 19 + Vite (frontend), SQLite via better-sqlite3, `@tanstack/react-query`, GPT-4.1 via `callOpenAI()`, `buildWorkspaceIntelligence()` from `server/workspace-intelligence.ts`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/db/migrations/048-meeting-briefs.sql` | Create | DB schema |
| `shared/types/meeting-brief.ts` | Create | Shared types |
| `shared/types/index.ts` | Modify | Barrel export |
| `server/ws-events.ts` | Modify | Add `MEETING_BRIEF_GENERATED` constant |
| `server/meeting-brief-store.ts` | Create | DB read/write (get, upsert) |
| `server/meeting-brief-generator.ts` | Create | Context assembly + AI call + metric assembly |
| `server/routes/meeting-brief.ts` | Create | GET + POST endpoints |
| `server/app.ts` | Modify | Import + register router |
| `src/lib/queryKeys.ts` | Modify | Add `meetingBrief` key |
| `src/api/meetingBrief.ts` | Create | Typed fetch wrappers |
| `src/hooks/admin/useAdminMeetingBrief.ts` | Create | `useQuery` + `useMutation` |
| `src/hooks/admin/index.ts` | Modify | Export new hook |
| `src/hooks/useWsInvalidation.ts` | Modify | Handle `MEETING_BRIEF_GENERATED` |
| `src/routes.ts` | Modify | Add `'brief'` to `Page` union |
| `src/components/layout/Sidebar.tsx` | Modify | Add brief nav item |
| `src/components/layout/Breadcrumbs.tsx` | Modify | Add `TAB_LABELS` entry |
| `src/components/CommandPalette.tsx` | Modify | Add to `NAV_ITEMS` |
| `src/components/admin/MeetingBrief/AtAGlanceStrip.tsx` | Create | Metric strip (data-direct, no AI) |
| `src/components/admin/MeetingBrief/BriefSection.tsx` | Create | Reusable section (title + bullet list) |
| `src/components/admin/MeetingBrief/RecommendationsList.tsx` | Create | Action + rationale pairs |
| `src/components/admin/MeetingBrief/BlueprintProgress.tsx` | Create | Conditional blueprint status |
| `src/components/admin/MeetingBrief/BriefHeader.tsx` | Create | Timestamp + regenerate button |
| `src/components/admin/MeetingBrief/MeetingBriefPage.tsx` | Create | Top-level page (all states) |
| `src/App.tsx` | Modify | Lazy import + `renderContent` case |

---

## Dependency Graph + Parallelization

Tasks must execute in these batches. Never start a batch until all previous batch tasks are committed.

```
Batch A (sequential foundation):
  Task 0 (Prompt Assembly Foundation) → Task 1 (DB Migration)

Batch B (parallel, both depend only on Task 1):
  Task 2 — Shared Types
  Task 3 — WS Event Constant

Batch C (parallel, all depend on Task 2):
  Task 4 — Server DB Store          [owns: server/meeting-brief-store.ts]
  Task 7 — Query Keys + API Client  [owns: src/lib/queryKeys.ts, src/api/meetingBrief.ts]
  Task 9 — Route + Nav Wiring       [owns: src/routes.ts, Sidebar, Breadcrumbs, CommandPalette]
  Task 10 — Core Components         [owns: src/components/admin/MeetingBrief/AtAGlanceStrip.tsx, BriefSection.tsx, RecommendationsList.tsx, BlueprintProgress.tsx]

  ▶ CHECKPOINT A — scaled-code-review on Batch C output. Fix Critical/Important before Batch D.

Batch D (parallel):
  Task 5 — Server Generator          [depends on Task 4; owns: server/meeting-brief-generator.ts]
  Task 8 — Hook + WsInvalidation     [depends on Task 7 + Task 3; owns: useAdminMeetingBrief.ts, useWsInvalidation.ts, hooks/admin/index.ts]

Batch E (sequential):
  Task 6 — Server Routes + app.ts    [depends on Task 5]

  ▶ CHECKPOINT B — server smoke test + scaled-code-review on all server files. Fix before Batch F.

Batch F (sequential):
  Task 11 — BriefHeader + MeetingBriefPage  [depends on Task 10 + Task 8]

Batch G (sequential — final wiring):
  Task 12 — App.tsx + Quality Gates  [depends on everything]
```

### Model assignments

| Task | Model | Reason |
|------|-------|--------|
| Task 0 — Prompt Assembly | Sonnet | Shared utility, layered pattern, needs judgment |
| Task 1 — Migration | (none) | Pure SQL |
| Task 2 — Types | Haiku | Mechanical type definitions |
| Task 3 — WS Event | Haiku | One-liner constant additions |
| Task 4 — DB Store | Sonnet | Prepared statement patterns + mapper |
| Task 5 — Generator | **Opus** | AI prompt quality, intelligence assembly logic, hash strategy — requires judgment |
| Task 6 — Routes | Sonnet | Standard route pattern + error handling |
| Task 7 — Query Keys + API | Haiku | Mechanical wiring |
| Task 8 — Hook + WsInvalidation | Haiku | Mechanical wiring |
| Task 9 — Nav Wiring | Haiku | 4 mechanical additions |
| Task 10 — Components | Sonnet | Tailwind + component logic |
| Task 11 — MeetingBriefPage | Sonnet | Multi-state composition |
| Task 12 — App.tsx + QA | Sonnet | Final wiring + quality gates |

---

## Task 0: Prompt Assembly Foundation

> Build once. Every AI feature (Meeting Brief, Brandscript, Copy Pipeline) calls `buildSystemPrompt()` instead of building system prompts inline. This task creates the shared utility before any feature-specific AI work.

**Model:** Sonnet

**Files:**
- Create: `server/prompt-assembly.ts`
- Create: `server/__tests__/prompt-assembly.test.ts`
- Modify: `server/db/migrations/048-meeting-briefs.sql` (add `custom_prompt_notes` column to workspaces)

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/prompt-assembly.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../db/index.js';
import { buildSystemPrompt } from '../prompt-assembly.js';

const TEST_WS = `test-prompt-${Date.now()}`;

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, 'Test', datetime('now'))`
  ).run(TEST_WS);
});

afterAll(() => {
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(TEST_WS);
});

describe('buildSystemPrompt', () => {
  it('returns base instructions when no enrichments exist', () => {
    const result = buildSystemPrompt(TEST_WS, 'Base instructions');
    expect(result).toBe('Base instructions');
  });

  it('appends custom notes when set', () => {
    db.prepare(`UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?`)
      .run('Always use ROI framing', TEST_WS);
    const result = buildSystemPrompt(TEST_WS, 'Base');
    expect(result).toContain('Always use ROI framing');
    db.prepare(`UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?`).run(TEST_WS);
  });

  it('does not include voice layer when voice_profiles table does not exist', () => {
    // Passes trivially in Phase 1 — becomes meaningful after Brandscript Task 5b
    const result = buildSystemPrompt(TEST_WS, 'Base');
    expect(result).not.toContain('Voice profile');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run server/__tests__/prompt-assembly.test.ts
```
Expected: FAIL — `Cannot find module '../prompt-assembly.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/prompt-assembly.ts
/**
 * Layered system prompt assembly for all AI features.
 *
 * Layer 1 — base instructions (always present, feature-specific)
 * Layer 2 — voice DNA translation (no-op until Brandscript Task 5b adds it)
 * Layer 3 — per-workspace custom notes (activates when custom_prompt_notes is non-empty)
 *
 * Each layer activates automatically when its data exists — no code changes needed
 * when Brandscript or custom notes ship.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

// ── Statement cache (canonical pattern — createStmtCache per CLAUDE.md)
const stmts = createStmtCache(() => ({
  getCustomNotes: db.prepare(
    `SELECT custom_prompt_notes FROM workspaces WHERE id = ? LIMIT 1`
  ),
}));

/**
 * Assembles a system prompt by layering workspace-specific context onto base instructions.
 * Safe to call before Brandscript ships — Layer 2 is a no-op until extended in Task 5b.
 */
export function buildSystemPrompt(workspaceId: string, baseInstructions: string): string {
  const parts: string[] = [baseInstructions];

  // ── Layer 2: voice DNA (extended in Brandscript Phase 1 — Task 5b)
  // No-op here. voiceDNAToPromptInstructions() and the voice_profiles lookup
  // are added to this file when the voice_profiles table exists (migration 049).

  // ── Layer 3: per-workspace custom notes
  try {
    const row = stmts().getCustomNotes.get(workspaceId) as
      { custom_prompt_notes: string | null } | undefined;
    if (row?.custom_prompt_notes?.trim()) {
      parts.push(`Additional context for this client:\n${row.custom_prompt_notes.trim()}`);
    }
  } catch {
    // Graceful degradation: column may not exist in test or legacy DBs
  }

  return parts.join('\n\n');
}
```

- [ ] **Step 4: Add `custom_prompt_notes` column to the migration**

In `server/db/migrations/048-meeting-briefs.sql`, add this SQL statement after the `meeting_briefs` table creation:

```sql
-- Layer 3 prompt assembly: per-workspace custom AI framing notes
ALTER TABLE workspaces ADD COLUMN custom_prompt_notes TEXT;
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run server/__tests__/prompt-assembly.test.ts
```
Expected: All 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/prompt-assembly.ts server/__tests__/prompt-assembly.test.ts
git commit -m "feat(prompt-assembly): add layered system prompt assembly foundation"
```

---

## Task 1: DB Migration

**Files:**
- Create: `server/db/migrations/048-meeting-briefs.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Meeting briefs: one row per workspace, upserted on regenerate.
-- JSON columns store AI-generated sections as TEXT arrays.
-- metrics: At-a-Glance data assembled from intelligence slices (not AI).
-- prompt_hash: optional optimization to skip regeneration when data hasn't changed.

CREATE TABLE IF NOT EXISTS meeting_briefs (
  workspace_id       TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  generated_at       TEXT NOT NULL,
  situation_summary  TEXT NOT NULL,
  wins               TEXT NOT NULL DEFAULT '[]',
  attention          TEXT NOT NULL DEFAULT '[]',
  recommendations    TEXT NOT NULL DEFAULT '[]',
  blueprint_progress TEXT,
  prompt_hash        TEXT,
  metrics            TEXT NOT NULL DEFAULT '{}'
);
```

- [ ] **Step 2: Verify migration runs without errors**

```bash
npx tsx server/db/migrate.ts
```

Expected: `Applied migration: 048-meeting-briefs` (or similar success message). No errors.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/048-meeting-briefs.sql
git commit -m "feat(db): add meeting_briefs table (migration 048)"
```

---

## Task 2: Shared Types

**Files:**
- Create: `shared/types/meeting-brief.ts`
- Modify: `shared/types/index.ts`

- [ ] **Step 1: Write the type file**

```typescript
// shared/types/meeting-brief.ts

export interface MeetingBriefRecommendation {
  action: string;
  rationale: string;
}

/** Shape returned by the AI (parsed from JSON response). */
export interface MeetingBriefAIOutput {
  situationSummary: string;
  wins: string[];
  attention: string[];
  recommendations: MeetingBriefRecommendation[];
  /** Null when no Site Blueprint exists for the workspace. */
  blueprintProgress: string | null;
}

/** At-a-Glance metrics assembled server-side from intelligence slices (never AI-generated). */
export interface MeetingBriefMetrics {
  /** @Already a percentage (e.g., 83 for 83%). Do NOT multiply by 100. */
  siteHealthScore: number | null;
  openRankingOpportunities: number;
  contentInPipeline: number;
  /** @Already a percentage (e.g., 72 for 72%). Do NOT multiply by 100. */
  overallWinRate: number | null;
  criticalIssues: number;
}

/** Full brief shape as stored in DB and returned to frontend. */
export interface MeetingBrief {
  workspaceId: string;
  generatedAt: string; // ISO timestamp
  situationSummary: string;
  wins: string[];
  attention: string[];
  recommendations: MeetingBriefRecommendation[];
  /** Null when no Site Blueprint exists. */
  blueprintProgress: string | null;
  /** Assembled from intelligence slices, not AI. */
  metrics: MeetingBriefMetrics;
}
```

- [ ] **Step 2: Add barrel export**

In `shared/types/index.ts`, add at the bottom:

```typescript
export type * from './meeting-brief.ts';
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add shared/types/meeting-brief.ts shared/types/index.ts
git commit -m "feat(types): add MeetingBrief shared types"
```

---

## Task 3: WS Event Constant

**Files:**
- Modify: `server/ws-events.ts`

- [ ] **Step 1: Add event to `WS_EVENTS`**

In `server/ws-events.ts`, add to the `WS_EVENTS` object (after `INSIGHT_BRIDGE_UPDATED`):

```typescript
// Meeting Brief
MEETING_BRIEF_GENERATED: 'meeting-brief:generated',
```

- [ ] **Step 2: Add to frontend copy**

`src/lib/wsEvents.ts` is a **separate copy** (not a re-export). Add the same constant to `WS_EVENTS` in that file:

```typescript
MEETING_BRIEF_GENERATED: 'meeting-brief:generated',
```

- [ ] **Step 3: Commit**

```bash
git add server/ws-events.ts src/lib/wsEvents.ts
git commit -m "feat(ws): add MEETING_BRIEF_GENERATED event constant"
```

---

## Task 4: Server DB Store

**Files:**
- Create: `server/meeting-brief-store.ts`

Tests first — write a failing test, then implement.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/meeting-brief-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getMeetingBrief, upsertMeetingBrief } from '../meeting-brief-store.js';
import type { MeetingBrief } from '../../shared/types/meeting-brief.js';

import db from '../db/index.js';

const WS_ID = 'test-workspace-store';

const SAMPLE_BRIEF: MeetingBrief = {
  workspaceId: WS_ID,
  generatedAt: '2026-04-07T12:00:00.000Z',
  situationSummary: 'Your site is gaining momentum.',
  wins: ['Ranking improved for /services', 'CTR up 12% for "seo agency"'],
  attention: ['Content decay detected on /blog/old-post'],
  recommendations: [{ action: 'Refresh /blog/old-post', rationale: 'Losing 30% of its traffic YoY' }],
  blueprintProgress: null,
  metrics: {
    siteHealthScore: 87,
    openRankingOpportunities: 4,
    contentInPipeline: 3,
    overallWinRate: 72,
    criticalIssues: 2,
  },
};

describe('meeting-brief-store', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM meeting_briefs WHERE workspace_id = ?').run(WS_ID);
  });

  it('returns null when no brief exists', () => {
    expect(getMeetingBrief(WS_ID)).toBeNull();
  });

  it('upserts and retrieves a brief', () => {
    upsertMeetingBrief(SAMPLE_BRIEF);
    const result = getMeetingBrief(WS_ID);
    expect(result).not.toBeNull();
    expect(result!.situationSummary).toBe('Your site is gaining momentum.');
    expect(result!.wins).toHaveLength(2);
    expect(result!.recommendations[0].action).toBe('Refresh /blog/old-post');
    expect(result!.metrics.siteHealthScore).toBe(87);
  });

  it('overwrites existing brief on second upsert', () => {
    upsertMeetingBrief(SAMPLE_BRIEF);
    const updated = { ...SAMPLE_BRIEF, situationSummary: 'Updated summary.' };
    upsertMeetingBrief(updated);
    const result = getMeetingBrief(WS_ID);
    expect(result!.situationSummary).toBe('Updated summary.');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run server/__tests__/meeting-brief-store.test.ts
```

Expected: FAIL — `getMeetingBrief` not found.

- [ ] **Step 3: Implement the store**

Create `server/meeting-brief-store.ts`:

```typescript
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { MeetingBrief, MeetingBriefMetrics, MeetingBriefRecommendation } from '../shared/types/meeting-brief.js';

interface BriefRow {
  workspace_id: string;
  generated_at: string;
  situation_summary: string;
  wins: string;
  attention: string;
  recommendations: string;
  blueprint_progress: string | null;
  prompt_hash: string | null;
  metrics: string;
}

const stmts = createStmtCache(() => ({
  get: db.prepare<[string], BriefRow>(
    `SELECT * FROM meeting_briefs WHERE workspace_id = ?`,
  ),
  upsert: db.prepare(`
    INSERT INTO meeting_briefs
      (workspace_id, generated_at, situation_summary, wins, attention, recommendations, blueprint_progress, prompt_hash, metrics)
    VALUES
      (@workspace_id, @generated_at, @situation_summary, @wins, @attention, @recommendations, @blueprint_progress, @prompt_hash, @metrics)
    ON CONFLICT(workspace_id) DO UPDATE SET
      generated_at       = excluded.generated_at,
      situation_summary  = excluded.situation_summary,
      wins               = excluded.wins,
      attention          = excluded.attention,
      recommendations    = excluded.recommendations,
      blueprint_progress = excluded.blueprint_progress,
      prompt_hash        = excluded.prompt_hash,
      metrics            = excluded.metrics
  `),
}));

function rowToBrief(row: BriefRow): MeetingBrief {
  return {
    workspaceId: row.workspace_id,
    generatedAt: row.generated_at,
    situationSummary: row.situation_summary,
    wins: parseJsonFallback<string[]>(row.wins, []),
    attention: parseJsonFallback<string[]>(row.attention, []),
    recommendations: parseJsonFallback<MeetingBriefRecommendation[]>(row.recommendations, []),
    blueprintProgress: row.blueprint_progress ?? null,
    metrics: parseJsonFallback<MeetingBriefMetrics>(row.metrics, {
      siteHealthScore: null,
      openRankingOpportunities: 0,
      contentInPipeline: 0,
      overallWinRate: null,
      criticalIssues: 0,
    }),
  };
}

export function getMeetingBrief(workspaceId: string): MeetingBrief | null {
  const row = stmts().get.get(workspaceId) as BriefRow | undefined;
  return row ? rowToBrief(row) : null;
}

export function upsertMeetingBrief(brief: MeetingBrief, promptHash?: string): void {
  stmts().upsert.run({
    workspace_id: brief.workspaceId,
    generated_at: brief.generatedAt,
    situation_summary: brief.situationSummary,
    wins: JSON.stringify(brief.wins),
    attention: JSON.stringify(brief.attention),
    recommendations: JSON.stringify(brief.recommendations),
    blueprint_progress: brief.blueprintProgress ?? null,
    prompt_hash: promptHash ?? null,
    metrics: JSON.stringify(brief.metrics),
  });
}

export function getMeetingBriefHash(workspaceId: string): string | null {
  const row = stmts().get.get(workspaceId) as Pick<BriefRow, 'prompt_hash'> | undefined;
  return row?.prompt_hash ?? null;
}
```


- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run server/__tests__/meeting-brief-store.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/meeting-brief-store.ts server/db/migrations/048-meeting-briefs.sql server/__tests__/meeting-brief-store.test.ts
git commit -m "feat(server): add meeting brief DB store with tests"
```

---

## Checkpoint A: Batch C Review

> Four agents just ran in parallel (Tasks 4, 7, 9, 10). Review their combined diff before generator and hook work starts. This is the highest-risk batch — server store, frontend routing, query keys, and four components all changed concurrently.

- [ ] **Step 1: Invoke scaled-code-review**

Use the `superpowers:scaled-code-review` skill. Pass the diff of all files touched in Tasks 4, 7, 9, 10:

```bash
git diff HEAD~4..HEAD -- \
  server/meeting-brief-store.ts \
  src/lib/queryKeys.ts \
  src/api/meetingBrief.ts \
  src/routes.ts \
  src/components/layout/Sidebar.tsx \
  src/components/layout/Breadcrumbs.tsx \
  src/components/CommandPalette.tsx \
  src/components/admin/MeetingBrief/
```

- [ ] **Step 2: Fix all Critical and Important issues before proceeding**

Do not start Task 5 until all Critical and Important findings are resolved.

---

## Task 5: Server Brief Generator

**Files:**
- Modify: `server/openai-helpers.ts` — add `responseFormat` option to `OpenAIChatOptions`
- Create: `server/meeting-brief-generator.ts`

- [ ] **Step 0: Add `responseFormat` to `OpenAIChatOptions`**

The generator uses `responseFormat: { type: 'json_object' }` in its `callOpenAI` calls. This field must exist in `OpenAIChatOptions` before the generator compiles. The Prompt Standardization plan adds it later — add it here first.

Find the `OpenAIChatOptions` interface in `server/openai-helpers.ts` and add the field alongside `temperature` and `maxTokens`:

```typescript
responseFormat?: { type: 'json_object' };
```

Then verify the type-check passes:

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/meeting-brief-generator.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { assembleMeetingBriefMetrics, buildBriefPrompt } from '../meeting-brief-generator.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

// Minimal intelligence fixture — only the fields our code touches
const MOCK_INTELLIGENCE: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'test-ws',
  assembledAt: '2026-04-07T12:00:00Z',
  siteHealth: {
    auditScore: 83,
    auditScoreDelta: 5,
    deadLinks: 2,
    redirectChains: 0,
    schemaErrors: 1,
    orphanPages: 0,
    cwvPassRate: { mobile: null, desktop: null },
  },
  insights: {
    all: [],
    byType: {
      ranking_opportunity: [{ id: '1' } as any, { id: '2' } as any, { id: '3' } as any],
    },
    bySeverity: { critical: 2, warning: 5, opportunity: 8, positive: 3 },
    topByImpact: [],
  },
  contentPipeline: {
    briefs: { total: 4, byStatus: {} },
    posts: { total: 2, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 1, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    coverageGaps: [],
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
  },
  learnings: {
    summary: null,
    confidence: null,
    topActionTypes: [],
    overallWinRate: 0.72,
    recentTrend: null,
    playbooks: [],
  },
};

describe('assembleMeetingBriefMetrics', () => {
  it('extracts metrics from intelligence slices', () => {
    const metrics = assembleMeetingBriefMetrics(MOCK_INTELLIGENCE);
    expect(metrics.siteHealthScore).toBe(83);
    expect(metrics.openRankingOpportunities).toBe(3);
    expect(metrics.contentInPipeline).toBe(6); // 4 briefs + 2 posts
    expect(metrics.overallWinRate).toBe(72); // 0.72 * 100, rounded
    expect(metrics.criticalIssues).toBe(2);
  });

  it('handles missing slices gracefully', () => {
    const sparse: WorkspaceIntelligence = {
      version: 1, workspaceId: 'x', assembledAt: '',
    };
    const metrics = assembleMeetingBriefMetrics(sparse);
    expect(metrics.siteHealthScore).toBeNull();
    expect(metrics.openRankingOpportunities).toBe(0);
    expect(metrics.contentInPipeline).toBe(0);
    expect(metrics.overallWinRate).toBeNull();
    expect(metrics.criticalIssues).toBe(0);
  });
});

describe('buildBriefPrompt', () => {
  it('includes key intelligence signals in the prompt', () => {
    const prompt = buildBriefPrompt(MOCK_INTELLIGENCE);
    expect(prompt).toContain('ranking_opportunity');
    expect(prompt).toContain('critical');
    expect(prompt).toContain('JSON');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run server/__tests__/meeting-brief-generator.test.ts
```

Expected: FAIL — `assembleMeetingBriefMetrics` not found.

- [ ] **Step 3: Implement the generator**

Create `server/meeting-brief-generator.ts`:

```typescript
import { createHash } from 'crypto';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { getMeetingBrief, getMeetingBriefHash, upsertMeetingBrief } from './meeting-brief-store.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { createLogger } from './logger.js';
import type { WorkspaceIntelligence, IntelligenceSlice } from '../shared/types/intelligence.js';
import type { MeetingBrief, MeetingBriefAIOutput, MeetingBriefMetrics } from '../shared/types/meeting-brief.js';

const log = createLogger('meeting-brief-generator');

const BRIEF_SLICES: IntelligenceSlice[] = [
  'seoContext', 'insights', 'learnings', 'siteHealth', 'contentPipeline', 'clientSignals',
];

/** Assembles At-a-Glance metrics directly from intelligence slices — no AI involved. */
export function assembleMeetingBriefMetrics(intel: WorkspaceIntelligence): MeetingBriefMetrics {
  return {
    siteHealthScore: intel.siteHealth?.auditScore ?? null,
    openRankingOpportunities: intel.insights?.byType.ranking_opportunity?.length ?? 0,
    contentInPipeline: (intel.contentPipeline?.briefs.total ?? 0) + (intel.contentPipeline?.posts.total ?? 0),
    overallWinRate: intel.learnings?.overallWinRate != null
      ? Math.round(intel.learnings.overallWinRate * 100)
      : null,
    criticalIssues: intel.insights?.bySeverity.critical ?? 0,
  };
}

/** Builds the prompt context string sent to the AI. */
export function buildBriefPrompt(intel: WorkspaceIntelligence): string {
  const top = intel.insights?.topByImpact?.slice(0, 10) ?? [];
  const wins = intel.learnings?.topWins?.slice(0, 5) ?? [];
  const winRate = intel.learnings?.overallWinRate != null
    ? `${Math.round(intel.learnings.overallWinRate * 100)}%`
    : 'unknown';
  const siteScore = intel.siteHealth?.auditScore ?? 'unknown';
  const scoreDelta = intel.siteHealth?.auditScoreDelta;
  const priorities = intel.clientSignals?.businessPriorities ?? [];
  const pipeline = intel.contentPipeline;
  const strategy = intel.seoContext?.strategy;

  const insightLines = top.map(i =>
    `- [${i.severity.toUpperCase()}] ${i.type}: ${i.pageId ?? 'workspace'} — ${JSON.stringify(i.data).slice(0, 200)}`
  ).join('\n');

  const winsLines = wins.map(w =>
    `- ${w.actionType} on ${w.pageUrl ?? 'workspace'}`
  ).join('\n');

  return `
You are a strategic SEO analyst preparing a client meeting brief. Write in a confident, direct tone — like a trusted advisor, not a report.

SITE CONTEXT:
- Site health score: ${siteScore}${scoreDelta != null ? ` (${scoreDelta > 0 ? '+' : ''}${scoreDelta} from last audit)` : ''}
- Overall win rate: ${winRate}
- Strategy focus: ${strategy?.targetKeywords?.slice(0, 5).join(', ') ?? 'not set'}
- Client priorities: ${priorities.length > 0 ? priorities.join('; ') : 'not specified'}

PIPELINE:
- Briefs in progress: ${pipeline?.briefs.total ?? 0}
- Posts: ${pipeline?.posts.total ?? 0}

TOP INSIGHTS (ordered by impact):
${insightLines || '(no open insights)'}

RECENT WINS:
${winsLines || '(no tracked wins yet)'}

INSTRUCTIONS:
Return a JSON object with exactly these keys:
{
  "situationSummary": "2-3 sentence narrative of the site's current state and momentum",
  "wins": ["3-5 bullets describing concrete recent wins — name pages and metrics"],
  "attention": ["3-5 bullets describing what needs attention — plain language, no jargon"],
  "recommendations": [
    { "action": "concrete next step", "rationale": "one-line reason" }
  ],
  "blueprintProgress": null
}

Rules:
- Never use admin jargon (no 'insight', 'severity', 'impact score', 'bridge')
- Be specific: name pages, queries, percentages
- Wins first — the meeting should feel constructive
- 3-5 items per list maximum
- blueprintProgress is always null in this version (Phase 1)
`.trim();
}

function buildPromptHash(intel: WorkspaceIntelligence): string {
  const relevant = {
    topIds: intel.insights?.topByImpact?.slice(0, 10).map(i => i.id) ?? [],
    siteScore: intel.siteHealth?.auditScore,
    pipeline: intel.contentPipeline?.briefs.total,
    winRate: intel.learnings?.overallWinRate,
  };
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

/**
 * Generates (or returns cached) meeting brief for a workspace.
 * Skips AI call if intelligence data hash matches the stored brief.
 */
export async function generateMeetingBrief(workspaceId: string): Promise<MeetingBrief> {
  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: BRIEF_SLICES });
  const hash = buildPromptHash(intel);
  const cachedHash = getMeetingBriefHash(workspaceId);

  if (hash === cachedHash) {
    log.debug({ workspaceId }, 'Meeting brief data unchanged — returning cached brief');
    const cached = getMeetingBrief(workspaceId);
    if (cached) return cached;
    // Hash exists but brief row is missing — fall through to regenerate
  }

  // buildBriefPrompt(intel) handles insight selection internally (topByImpact.slice(0, 5)).
  // No additional filtering needed here.

  const systemPrompt = buildSystemPrompt(workspaceId, `
You are a strategic analyst preparing a client-facing meeting brief. Your output must be valid JSON matching the MeetingBriefAIOutput interface exactly.

Write for the client — no admin jargon, no internal scoring language. Be specific: name pages, queries, and numbers when the data supports it. Narrative tone, not bullet-point data dumps. Lead with wins before challenges.

Example of a strong situation summary:
"Your site has gained traction in local search this quarter, with 3 service pages now ranking top-5 for location-specific queries. The main opportunity is a content gap around [topic] — competitors capture 40% of that traffic while your pages sit outside the top 20."

Avoid: "Your site health score is 78. You have 12 open insights."
`.trim());

  const prompt = buildBriefPrompt(intel);
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: prompt },
  ];
  const result = await callOpenAI({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    maxTokens: 2000,
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    feature: 'meeting-brief',
    workspaceId,
  });

  let parsed: MeetingBriefAIOutput;
  try {
    parsed = JSON.parse(result.text) as MeetingBriefAIOutput;
  } catch {
    // Retry once with an explicit JSON reminder
    const retryMessages2 = [
      { role: 'system' as const, content: systemPrompt },
      ...messages,
      { role: 'assistant' as const, content: result.text },
      { role: 'user' as const, content: 'Your response was not valid JSON. Return only the JSON object, no explanation.' },
    ];
    const retryResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: retryMessages2,
      maxTokens: 2000,
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
      feature: 'meeting-brief-retry',
      workspaceId,
    });
    parsed = JSON.parse(retryResult.text) as MeetingBriefAIOutput;
  }

  const aiOutput = parsed;

  const metrics = assembleMeetingBriefMetrics(intel);

  const brief: MeetingBrief = {
    workspaceId,
    generatedAt: new Date().toISOString(),
    situationSummary: aiOutput.situationSummary ?? '',
    wins: Array.isArray(aiOutput.wins) ? aiOutput.wins : [],
    attention: Array.isArray(aiOutput.attention) ? aiOutput.attention : [],
    recommendations: Array.isArray(aiOutput.recommendations) ? aiOutput.recommendations : [],
    blueprintProgress: null, // Phase 2 will populate this
    metrics,
  };

  upsertMeetingBrief(brief, hash);
  broadcastToWorkspace(workspaceId, WS_EVENTS.MEETING_BRIEF_GENERATED, {});

  log.info({ workspaceId }, 'Meeting brief generated and stored');
  return brief;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run server/__tests__/meeting-brief-generator.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/meeting-brief-generator.ts server/__tests__/meeting-brief-generator.test.ts
git commit -m "feat(server): add meeting brief generator with intelligence assembly"
```

---

## Task 6: Server Routes + App Registration

**Files:**
- Create: `server/routes/meeting-brief.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Create the route file**

```typescript
// server/routes/meeting-brief.ts
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { getMeetingBrief } from '../meeting-brief-store.js';
import { generateMeetingBrief } from '../meeting-brief-generator.js';
import { createLogger } from '../logger.js';

const log = createLogger('meeting-brief-routes');
const router = Router();

// GET /api/workspaces/:workspaceId/meeting-brief — fetch stored brief (null if none)
router.get(
  '/api/workspaces/:workspaceId/meeting-brief',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    try {
      const brief = getMeetingBrief(req.params.workspaceId);
      res.json({ brief });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to fetch meeting brief');
      res.status(500).json({ error: msg });
    }
  },
);

// POST /api/workspaces/:workspaceId/meeting-brief/generate — generate new brief
// Literal segment 'generate' registered before any deeper param routes (route ordering rule)
router.post(
  '/api/workspaces/:workspaceId/meeting-brief/generate',
  requireWorkspaceAccess('workspaceId'),
  async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const brief = await generateMeetingBrief(workspaceId);
      res.json({ brief });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, workspaceId }, 'Failed to generate meeting brief');
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
```

- [ ] **Step 2: Register router in `server/app.ts`**

In `server/app.ts`, add the import alongside the other route imports (find the block starting with `import featuresRouter`):

```typescript
import meetingBriefRouter from './routes/meeting-brief.js';
```

Then register it alongside the other `app.use()` calls (after `intelligenceRouter`):

```typescript
app.use(meetingBriefRouter);
```

- [ ] **Step 3: Write route integration tests**

Create `server/__tests__/meeting-brief-routes.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import db from '../db/index.js';

// Mock the generator to avoid real AI calls in tests
vi.mock('../meeting-brief-generator.js', () => ({
  generateMeetingBrief: vi.fn().mockResolvedValue({
    workspaceId: 'test-ws-routes',
    generatedAt: '2026-04-07T12:00:00Z',
    situationSummary: 'Test summary.',
    wins: ['Win 1'],
    attention: ['Issue 1'],
    recommendations: [{ action: 'Do something', rationale: 'Because' }],
    blueprintProgress: null,
    metrics: { siteHealthScore: 80, openRankingOpportunities: 3, contentInPipeline: 2, overallWinRate: 65, criticalIssues: 1 },
  }),
}));

const WS_ID = 'test-ws-routes';
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  app = await createApp();
  // Ensure workspace exists for requireWorkspaceAccess
  db.prepare(`INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)`).run(WS_ID, 'Test Workspace');
});

afterAll(() => {
  db.prepare('DELETE FROM meeting_briefs WHERE workspace_id = ?').run(WS_ID);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(WS_ID);
});

describe('GET /api/workspaces/:workspaceId/meeting-brief', () => {
  it('returns null brief when none exists', async () => {
    const res = await request(app)
      .get(`/api/workspaces/${WS_ID}/meeting-brief`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');
    expect(res.status).toBe(200);
    expect(res.body.brief).toBeNull();
  });
});

describe('POST /api/workspaces/:workspaceId/meeting-brief/generate', () => {
  it('generates and returns a brief', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${WS_ID}/meeting-brief/generate`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');
    expect(res.status).toBe(200);
    expect(res.body.brief).not.toBeNull();
    expect(res.body.brief.situationSummary).toBe('Test summary.');
    expect(res.body.brief.wins).toHaveLength(1);
    expect(res.body.brief.metrics.siteHealthScore).toBe(80);
  });

  it('GET returns the brief after generation', async () => {
    const res = await request(app)
      .get(`/api/workspaces/${WS_ID}/meeting-brief`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');
    expect(res.status).toBe(200);
    expect(res.body.brief).not.toBeNull();
  });
});
```

> Note: If `createApp` is not an exported factory function in `server/app.ts`, check how other route tests import the Express app — mirror the same pattern. Look at an existing test file in `server/__tests__/` for the import convention.

- [ ] **Step 4: Run route tests**

```bash
npx vitest run server/__tests__/meeting-brief-routes.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/routes/meeting-brief.ts server/app.ts server/__tests__/meeting-brief-routes.test.ts
git commit -m "feat(server): add meeting brief GET + POST/generate routes with integration tests"
```

---

## Task 7: Query Keys + API Client

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Create: `src/api/meetingBrief.ts`

- [ ] **Step 1: Add query key**

In `src/lib/queryKeys.ts`, inside the `admin` object (after `actionQueue`), add:

```typescript
meetingBrief: (wsId: string) => ['admin-meeting-brief', wsId] as const,
```

- [ ] **Step 2: Create the API client**

```typescript
// src/api/meetingBrief.ts
import { getSafe, post } from './client';
import type { MeetingBrief } from '../../shared/types/meeting-brief.js';

interface BriefResponse {
  brief: MeetingBrief | null;
  unchanged?: boolean;
}

export const meetingBriefApi = {
  get: (workspaceId: string) =>
    getSafe<BriefResponse>(
      `/api/workspaces/${workspaceId}/meeting-brief`,
      { brief: null },
    ),

  generate: (workspaceId: string) =>
    post<BriefResponse>(
      `/api/workspaces/${workspaceId}/meeting-brief/generate`,
      {},
    ),
};
```

> Note: `post` is imported from `./client` — check how the existing `src/api/analytics.ts` imports it to confirm the exact import name. It may be `post` or `postJson`.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queryKeys.ts src/api/meetingBrief.ts
git commit -m "feat(frontend): add meeting brief query key and API client"
```

---

## Task 8: Hook + WsInvalidation + Barrel

**Files:**
- Create: `src/hooks/admin/useAdminMeetingBrief.ts`
- Modify: `src/hooks/admin/index.ts`
- Modify: `src/hooks/useWsInvalidation.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/admin/useAdminMeetingBrief.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { meetingBriefApi } from '../../api/meetingBrief';

export function useAdminMeetingBrief(workspaceId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.admin.meetingBrief(workspaceId),
    queryFn: () => meetingBriefApi.get(workspaceId),
    staleTime: 10 * 60 * 1000, // 10 min — brief changes only on explicit regenerate
    enabled: !!workspaceId,
  });

  const generate = useMutation({
    mutationFn: () => meetingBriefApi.generate(workspaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.meetingBrief(workspaceId) });
    },
  });

  return {
    brief: query.data?.brief ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    generate: generate.mutate,
    isGenerating: generate.isPending,
    generateError: generate.error,
  };
}
```

- [ ] **Step 2: Add barrel export**

In `src/hooks/admin/index.ts`, add at the bottom:

```typescript
export { useAdminMeetingBrief } from './useAdminMeetingBrief';
```

- [ ] **Step 3: Add WS invalidation handler**

In `src/hooks/useWsInvalidation.ts`, inside `useWorkspaceEvents(workspaceId, { ... })`, add a new handler (after `ANNOTATION_BRIDGE_CREATED`):

```typescript
[WS_EVENTS.MEETING_BRIEF_GENERATED]: () => {
  if (!workspaceId) return;
  qc.invalidateQueries({ queryKey: queryKeys.admin.meetingBrief(workspaceId) });
},
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/admin/useAdminMeetingBrief.ts src/hooks/admin/index.ts src/hooks/useWsInvalidation.ts
git commit -m "feat(frontend): add useAdminMeetingBrief hook and WS invalidation"
```

---

## Task 9: Route Type + Navigation Wiring

**Files:**
- Modify: `src/routes.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/Breadcrumbs.tsx`
- Modify: `src/components/CommandPalette.tsx`

All five navigation files must be updated in one commit (route removal checklist rule).

- [ ] **Step 1: Add `'brief'` to `Page` type in `src/routes.ts`**

```typescript
export type Page =
  | 'home'
  | 'brief'          // ← add here
  | 'media'
  // ... rest unchanged
```

- [ ] **Step 2: Add brief to Sidebar nav**

In `src/components/layout/Sidebar.tsx`, in `buildNavGroups()`, find the first group (the one with just `home`) and add `brief`:

```typescript
{ label: '', items: [
  { id: 'home', label: 'Home', icon: LayoutDashboard, desc: 'Workspace overview and quick actions' },
  { id: 'brief', label: 'Meeting Brief', icon: BookOpen, desc: 'AI-generated meeting prep for client calls' },
]},
```

`BookOpen` is already imported in `Sidebar.tsx`.

- [ ] **Step 3: Add to `TAB_LABELS` in `Breadcrumbs.tsx`**

In `src/components/layout/Breadcrumbs.tsx`, add `brief` to `TAB_LABELS`:

```typescript
const TAB_LABELS: Record<string, string> = {
  brief: 'Meeting Brief',
  home: 'Home',
  // ... rest unchanged
```

- [ ] **Step 4: Add to `NAV_ITEMS` in `CommandPalette.tsx`**

In `src/components/CommandPalette.tsx`:

First add `BookOpen` to the lucide-react import line (find the existing `import { ... } from 'lucide-react'`):

```typescript
import { ..., BookOpen } from 'lucide-react';
```

Then add to `NAV_ITEMS` array (after `home`):

```typescript
{ id: 'brief', label: 'Meeting Brief', icon: BookOpen, group: '' },
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes.ts src/components/layout/Sidebar.tsx src/components/layout/Breadcrumbs.tsx src/components/CommandPalette.tsx
git commit -m "feat(nav): add Meeting Brief tab to routes, sidebar, breadcrumbs, command palette"
```

---

## Task 10: Core Display Components

**Files:**
- Create: `src/components/admin/MeetingBrief/AtAGlanceStrip.tsx`
- Create: `src/components/admin/MeetingBrief/BriefSection.tsx`
- Create: `src/components/admin/MeetingBrief/RecommendationsList.tsx`
- Create: `src/components/admin/MeetingBrief/BlueprintProgress.tsx`

- [ ] **Step 1: Create `AtAGlanceStrip.tsx`**

```tsx
// src/components/admin/MeetingBrief/AtAGlanceStrip.tsx
import type { MeetingBriefMetrics } from '../../../../shared/types/meeting-brief.js';

interface Props {
  metrics: MeetingBriefMetrics;
}

interface MetricTileProps {
  label: string;
  value: string | number | null;
  unit?: string;
}

function MetricTile({ label, value, unit }: MetricTileProps) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 border border-zinc-800 rounded-lg bg-zinc-900/50">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="text-xl font-semibold text-blue-400">
        {value != null ? `${value}${unit ?? ''}` : '—'}
      </span>
    </div>
  );
}

export function AtAGlanceStrip({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <MetricTile
        label="Site Health"
        value={metrics.siteHealthScore}
        unit="/100"
      />
      <MetricTile
        label="Ranking Opps"
        value={metrics.openRankingOpportunities}
      />
      <MetricTile
        label="In Pipeline"
        value={metrics.contentInPipeline}
        unit=" pieces"
      />
      <MetricTile
        label="Win Rate"
        value={metrics.overallWinRate}
        unit="%"
      />
      <MetricTile
        label="Critical Issues"
        value={metrics.criticalIssues}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `BriefSection.tsx`**

```tsx
// src/components/admin/MeetingBrief/BriefSection.tsx
interface Props {
  title: string;
  items: string[];
  className?: string;
}

export function BriefSection({ title, items, className = '' }: Props) {
  if (items.length === 0) return null;
  return (
    <div className={`mb-6 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-zinc-200 leading-relaxed">
            <span className="mt-1.5 shrink-0 w-1 h-1 rounded-full bg-teal-400" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create `RecommendationsList.tsx`**

```tsx
// src/components/admin/MeetingBrief/RecommendationsList.tsx
import type { MeetingBriefRecommendation } from '../../../../shared/types/meeting-brief.js';

interface Props {
  items: MeetingBriefRecommendation[];
}

export function RecommendationsList({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Recommendations for This Period
      </h3>
      <div className="space-y-3">
        {items.map((rec, i) => (
          <div key={i} className="flex gap-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <span className="shrink-0 mt-0.5 text-xs font-bold text-teal-400 w-5 text-center">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-100">{rec.action}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{rec.rationale}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `BlueprintProgress.tsx`**

```tsx
// src/components/admin/MeetingBrief/BlueprintProgress.tsx
interface Props {
  progress: string | null;
}

export function BlueprintProgress({ progress }: Props) {
  if (!progress) return null;
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Blueprint Progress
      </h3>
      <p className="text-sm text-zinc-200 leading-relaxed">{progress}</p>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MeetingBrief/
git commit -m "feat(ui): add MeetingBrief core display components"
```

---

## Checkpoint B: Server Complete Review

> All server tasks are done (Tasks 0–6). Before composing the full page component, verify the server layer is solid end-to-end.

- [ ] **Step 1: Run the full server test suite**

```bash
npx vitest run server/__tests__/
```
Expected: All tests pass, including prompt-assembly, meeting-brief-store, and route integration tests.

- [ ] **Step 2: Manual smoke test of both endpoints**

Start the server (`npm run dev:server`) and confirm:
```bash
# Should return null (no brief yet)
curl -H "x-auth-token: $APP_PASSWORD" http://localhost:3000/api/workspaces/YOUR_WS_ID/meeting-brief

# Should generate and return a brief
curl -X POST -H "x-auth-token: $APP_PASSWORD" http://localhost:3000/api/workspaces/YOUR_WS_ID/meeting-brief/generate
```
Expected: GET returns `null`, POST returns a `MeetingBrief` object with all required fields populated.

- [ ] **Step 3: Invoke scaled-code-review on server files**

Use `superpowers:scaled-code-review`. Pass:
```bash
git diff HEAD -- \
  server/prompt-assembly.ts \
  server/meeting-brief-store.ts \
  server/meeting-brief-generator.ts \
  server/routes/meeting-brief.ts
```

- [ ] **Step 4: Fix all Critical and Important issues before proceeding to Task 11**

---

## Task 11: BriefHeader + MeetingBriefPage

**Files:**
- Create: `src/components/admin/MeetingBrief/BriefHeader.tsx`
- Create: `src/components/admin/MeetingBrief/MeetingBriefPage.tsx`

- [ ] **Step 1: Create `BriefHeader.tsx`**

```tsx
// src/components/admin/MeetingBrief/BriefHeader.tsx
import { RefreshCw } from 'lucide-react';

interface Props {
  generatedAt: string;
  onRegenerate: () => void;
  isGenerating: boolean;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export function BriefHeader({ generatedAt, onRegenerate, isGenerating }: Props) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Meeting Brief</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Generated {formatRelativeTime(generatedAt)}
        </p>
      </div>
      <button
        onClick={onRegenerate}
        disabled={isGenerating}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        title="Regenerate brief"
      >
        <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
        {isGenerating ? 'Generating…' : 'Regenerate'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `MeetingBriefPage.tsx`**

```tsx
// src/components/admin/MeetingBrief/MeetingBriefPage.tsx
import { FileText } from 'lucide-react';
import { useAdminMeetingBrief } from '../../../hooks/admin/useAdminMeetingBrief';
import { SectionCard } from '../../ui/SectionCard';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState } from '../../ui/EmptyState';
import { BriefHeader } from './BriefHeader';
import { AtAGlanceStrip } from './AtAGlanceStrip';
import { BriefSection } from './BriefSection';
import { RecommendationsList } from './RecommendationsList';
import { BlueprintProgress } from './BlueprintProgress';

interface Props {
  workspaceId: string;
}

function BriefSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <div className="grid grid-cols-5 gap-3 mt-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-3 w-1/4 mt-6" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

export function MeetingBriefPage({ workspaceId }: Props) {
  const { brief, isLoading, isError, generate, isGenerating } = useAdminMeetingBrief(workspaceId);

  if (isLoading) {
    return (
      <SectionCard>
        <BriefSkeleton />
      </SectionCard>
    );
  }

  if (isError) {
    return (
      <SectionCard>
        <EmptyState
          icon={FileText}
          title="Couldn't load brief"
          description="Something went wrong loading the meeting brief. Try again."
          action={
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Retry
            </button>
          }
        />
      </SectionCard>
    );
  }

  if (!brief) {
    return (
      <SectionCard>
        <EmptyState
          icon={FileText}
          title="No meeting brief yet"
          description="Generate a brief before your next client call. Takes about 10 seconds."
          action={
            <button
              onClick={() => generate()}
              disabled={isGenerating}
              className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Generating…' : 'Generate First Brief'}
            </button>
          }
        />
        {isGenerating && (
          <div className="mt-6">
            <p className="text-xs text-zinc-500 text-center mb-4">Analyzing site performance…</p>
            <BriefSkeleton />
          </div>
        )}
      </SectionCard>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <BriefHeader
        generatedAt={brief.generatedAt}
        onRegenerate={() => generate()}
        isGenerating={isGenerating}
      />

      {isGenerating && (
        <SectionCard className="mb-6">
          <p className="text-xs text-zinc-500 text-center mb-4">Analyzing site performance…</p>
          <BriefSkeleton />
        </SectionCard>
      )}

      {!isGenerating && (
        <SectionCard>
          {/* Situation Summary */}
          <div className="mb-6">
            <p className="text-sm text-zinc-200 leading-relaxed">{brief.situationSummary}</p>
          </div>

          {/* At a Glance */}
          <AtAGlanceStrip metrics={brief.metrics} />

          {/* Wins */}
          <BriefSection title="Wins Since Last Review" items={brief.wins} />

          {/* Attention */}
          <BriefSection title="What Needs Attention" items={brief.attention} />

          {/* Recommendations */}
          <RecommendationsList items={brief.recommendations} />

          {/* Blueprint Progress (conditional) */}
          <BlueprintProgress progress={brief.blueprintProgress} />
        </SectionCard>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write component tests**

Create `src/components/admin/MeetingBrief/__tests__/MeetingBriefPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MeetingBriefPage } from '../MeetingBriefPage';
import type { MeetingBrief } from '../../../../../shared/types/meeting-brief.js';

// Mock the hook to control state in tests
vi.mock('../../../../hooks/admin/useAdminMeetingBrief', () => ({
  useAdminMeetingBrief: vi.fn(),
}));

import { useAdminMeetingBrief } from '../../../../hooks/admin/useAdminMeetingBrief';
const mockHook = vi.mocked(useAdminMeetingBrief);

const SAMPLE_BRIEF: MeetingBrief = {
  workspaceId: 'test-ws',
  generatedAt: new Date().toISOString(),
  situationSummary: 'Your site is gaining momentum.',
  wins: ['Ranking improved for /services'],
  attention: ['Content decay on /blog/old'],
  recommendations: [{ action: 'Refresh /blog/old', rationale: 'Losing traffic' }],
  blueprintProgress: null,
  metrics: { siteHealthScore: 87, openRankingOpportunities: 4, contentInPipeline: 3, overallWinRate: 72, criticalIssues: 2 },
};

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('MeetingBriefPage', () => {
  it('shows empty state when no brief exists', () => {
    mockHook.mockReturnValue({ brief: null, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.getByText(/No meeting brief yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Generate First Brief/i)).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    mockHook.mockReturnValue({ brief: null, isLoading: true, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    const { container } = render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders brief content when brief exists', () => {
    mockHook.mockReturnValue({ brief: SAMPLE_BRIEF, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.getByText('Your site is gaining momentum.')).toBeInTheDocument();
    expect(screen.getByText('Ranking improved for /services')).toBeInTheDocument();
    expect(screen.getByText('Refresh /blog/old')).toBeInTheDocument();
    expect(screen.getByText('87/100')).toBeInTheDocument();
  });

  it('hides blueprint section when blueprintProgress is null', () => {
    mockHook.mockReturnValue({ brief: SAMPLE_BRIEF, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.queryByText(/Blueprint Progress/i)).not.toBeInTheDocument();
  });

  it('shows blueprint section when blueprintProgress is set', () => {
    const briefWithBlueprint = { ...SAMPLE_BRIEF, blueprintProgress: '3 of 8 pages live.' };
    mockHook.mockReturnValue({ brief: briefWithBlueprint, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.getByText(/Blueprint Progress/i)).toBeInTheDocument();
    expect(screen.getByText('3 of 8 pages live.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run component tests**

```bash
npx vitest run src/components/admin/MeetingBrief/__tests__/MeetingBriefPage.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MeetingBrief/BriefHeader.tsx src/components/admin/MeetingBrief/MeetingBriefPage.tsx src/components/admin/MeetingBrief/__tests__/MeetingBriefPage.test.tsx
git commit -m "feat(ui): add BriefHeader and MeetingBriefPage components with component tests"
```

---

## Task 12: Wire into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add lazy import**

In `src/App.tsx`, add a new lazy import alongside the other lazy imports (after `OutcomesOverview`):

```typescript
const MeetingBriefPage = lazyWithRetry(() => import('./components/admin/MeetingBrief/MeetingBriefPage').then(m => ({ default: m.MeetingBriefPage })));
```

- [ ] **Step 2: Add `renderContent` case**

In the `renderContent()` function, add the `brief` case. Place it alongside the workspace-level tabs (after `tab === 'home'`):

```typescript
if (tab === 'brief') return <MeetingBriefPage key={`brief-${selected.id}`} workspaceId={selected.id} />;
```

- [ ] **Step 3: Type-check + build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

Expected: zero type errors, successful build.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (including the 7 new tests from Tasks 4 and 5).

- [ ] **Step 5: PR check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors. Verify no `violet`, `indigo`, or `purple` in any new component.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): wire MeetingBriefPage into admin route renderer"
```

---

### Preview Verification (required before PR)

- [ ] **Step 7: Start dev server and navigate to the brief tab**

```bash
npm run dev:all
```

Navigate to `/ws/<any-workspaceId>/brief`. Verify:
- Empty state renders with "Generate First Brief" button
- Clicking generate shows skeleton + "Analyzing site performance…"
- After generation, all 6 sections render (summary, At a Glance, wins, attention, recommendations; blueprint hidden)
- Regenerate button is visible but understated (not a primary CTA)
- At a Glance numbers are blue (`text-blue-400`)
- No purple anywhere on the page

Take a screenshot of the populated brief state for PR documentation.

- [ ] **Step 8: Cross-check At a Glance numbers**

Compare `siteHealthScore` displayed in the brief against the Site Audit tab for the same workspace. They should match. If they don't, the generator is pulling from a different slice than the audit displays — investigate before opening the PR.

---

### Open PR

- [ ] **Step 9: Open PR to `staging`** (not `main`)

```bash
gh pr create --base staging --title "feat: Meeting Brief — Phase 1 Strategic Intelligence Layer" --body "$(cat <<'EOF'
## Summary
- Adds Meeting Brief tab (/ws/:workspaceId/brief) with AI-generated client meeting prep
- New meeting_briefs table (migration 048), server generator using WorkspaceIntelligence, 6 React components
- Blueprint Progress section ready and wired — currently hidden (null) until Page Strategy Engine ships

## Test plan
- [ ] Server store tests pass (Task 4)
- [ ] Generator unit tests pass (Task 5)  
- [ ] Route integration tests pass (Task 6)
- [ ] Component tests pass (Task 11)
- [ ] Full vitest suite passes
- [ ] tsc + vite build clean
- [ ] pr-check passes
- [ ] Preview screenshot: empty state → generate → populated brief

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do NOT merge to `main` until staging is verified.

---

## Acceptance Criteria Checklist

Before declaring this PR done:

- [ ] `GET /api/workspaces/:workspaceId/meeting-brief` returns `{ brief: null }` when no brief exists
- [ ] `POST /api/workspaces/:workspaceId/meeting-brief/generate` returns a full `MeetingBrief` object in < 15s
- [ ] Regenerating with unchanged data returns `{ brief, unchanged: true }` without calling OpenAI
- [ ] The `brief` tab is visible in the sidebar and navigates to `/ws/:workspaceId/brief`
- [ ] First visit shows `EmptyState` with "Generate First Brief" button
- [ ] Clicking generate shows skeleton with "Analyzing site performance…"
- [ ] After generation, brief renders with all 6 sections (summary, At a Glance, wins, attention, recommendations; blueprint section hidden since null)
- [ ] At a Glance numbers are data-sourced (cross-check `siteHealthScore` against Site Audit tab)
- [ ] Regenerate button is a secondary button style (not a primary CTA)
- [ ] No `purple-`, `violet-`, or `indigo-` classes in any MeetingBrief component
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — success
- [ ] `npx vitest run` — all tests pass
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
