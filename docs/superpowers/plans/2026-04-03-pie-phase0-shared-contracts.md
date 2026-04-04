# Platform Intelligence Enhancements — Phase 0: Shared Contracts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commit all shared TypeScript interfaces, feature flags, and DB migrations that Phase 1–3 group plans depend on — nothing else ships in this PR.

**Architecture:** Contracts-only PR. No business logic, no UI, no route changes. All types land in `shared/types/`, migrations in `server/db/migrations/`. Parallel Group 1/2/3 agents cannot start until this is merged to staging and green.

**Tech Stack:** TypeScript 5, SQLite (better-sqlite3 migrations), Vitest

**Dependency:** This plan must be merged and green on staging before any of the three Group plans begin.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `shared/types/client-signals.ts` | `ClientSignal` interface + type unions |
| Create | `shared/types/keywords.ts` | `METRICS_SOURCE` const + `MetricsSource` type |
| Modify | `shared/types/content.ts` | Add `StrategyCardContext` + `PageTypeBriefConfig` |
| Modify | `shared/types/workspace.ts` | Add `siteIntelligenceClientView` + `businessPriorities` to `Workspace` |
| Modify | `src/routes.ts` | Add `'brand'` to `ClientTab` union |
| Modify | `shared/types/feature-flags.ts` | Add 3 new feature flags |
| Create | `server/db/migrations/046-client-signals.sql` | `client_signals` table |
| Create | `server/db/migrations/047-business-priorities.sql` | `businessPriorities` column on `workspaces` |
| Create | `tests/unit/metrics-source-enum.test.ts` | Verify METRICS_SOURCE const values |

---

### Task 1: Create `shared/types/client-signals.ts`

**Files:**
- Create: `shared/types/client-signals.ts`

- [ ] **Step 1: Create the file**

```typescript
// shared/types/client-signals.ts

export type ClientSignalType = 'content_interest' | 'service_interest';
export type ClientSignalStatus = 'new' | 'reviewed' | 'actioned';

export interface ClientSignalMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

/** A recorded client intent signal — created when a client taps a Service Interest CTA. */
export interface ClientSignal {
  id: string;
  workspaceId: string;
  /** content_interest: asked about blogs/writing. service_interest: asked about pricing/next steps. */
  type: ClientSignalType;
  /** Last 10 messages from the chat session at the moment of the tap. */
  chatContext: ClientSignalMessage[];
  status: ClientSignalStatus;
  createdAt: string;
}
```

- [ ] **Step 2: Export from barrel**

Open `shared/types/index.ts`. Add to the exports:

```typescript
export * from './client-signals.js';
```

- [ ] **Step 3: Verify compile**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add shared/types/client-signals.ts shared/types/index.ts
git commit -m "feat(types): add ClientSignal interface and type unions"
```

---

### Task 2: Create `shared/types/keywords.ts`

**Files:**
- Create: `shared/types/keywords.ts`
- Test: `tests/unit/metrics-source-enum.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/metrics-source-enum.test.ts
import { describe, it, expect } from 'vitest';
import { METRICS_SOURCE } from '../../shared/types/keywords.js';

describe('METRICS_SOURCE', () => {
  it('EXACT equals exact', () => {
    expect(METRICS_SOURCE.EXACT).toBe('exact');
  });

  it('PARTIAL_MATCH equals partial_match', () => {
    expect(METRICS_SOURCE.PARTIAL_MATCH).toBe('partial_match');
  });

  it('BULK_LOOKUP equals bulk_lookup', () => {
    expect(METRICS_SOURCE.BULK_LOOKUP).toBe('bulk_lookup');
  });

  it('AI_ESTIMATE equals ai_estimate', () => {
    expect(METRICS_SOURCE.AI_ESTIMATE).toBe('ai_estimate');
  });

  it('is frozen (as const)', () => {
    expect(Object.isFrozen(METRICS_SOURCE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/metrics-source-enum.test.ts
```

Expected: `Cannot find module '../../shared/types/keywords.js'`

- [ ] **Step 3: Create the file**

```typescript
// shared/types/keywords.ts

/**
 * Canonical source values for keyword metrics.
 * Use these constants — never raw string literals.
 *
 * pr-check enforces: no bare 'bulk_lookup' or 'ai_estimate' strings outside this file.
 */
export const METRICS_SOURCE = {
  /** Exact keyword match from SEMRush bulk lookup. */
  EXACT: 'exact',
  /** Partial/fuzzy match from SEMRush. */
  PARTIAL_MATCH: 'partial_match',
  /** SEMRush bulk domain organic data lookup. */
  BULK_LOOKUP: 'bulk_lookup',
  /** AI-estimated metrics (no SEMRush data available). */
  AI_ESTIMATE: 'ai_estimate',
} as const;

export type MetricsSource = typeof METRICS_SOURCE[keyof typeof METRICS_SOURCE];
```

- [ ] **Step 4: Export from barrel**

Open `shared/types/index.ts`. Add:

```typescript
export * from './keywords.js';
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx vitest run tests/unit/metrics-source-enum.test.ts
```

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add shared/types/keywords.ts shared/types/index.ts tests/unit/metrics-source-enum.test.ts
git commit -m "feat(types): add METRICS_SOURCE const and MetricsSource type"
```

---

### Task 3: Extend `shared/types/content.ts` — brief planning types

**Files:**
- Modify: `shared/types/content.ts` (append to end of file)

- [ ] **Step 1: Read the current end of content.ts to find the right insertion point**

```bash
tail -20 shared/types/content.ts
```

- [ ] **Step 2: Append the new interfaces**

Add to the **end** of `shared/types/content.ts`:

```typescript
// ── Brief generation planning types ─────────────────────────────

/** Journey stage derived from search intent for page-type prompt tuning. */
export type BriefJourneyStage = 'awareness' | 'consideration' | 'decision';

/** Page types supported by the brief generation engine. */
export type BriefPageType =
  | 'blog'
  | 'landing'
  | 'service'
  | 'location'
  | 'pillar'
  | 'product'
  | 'resource';

/**
 * Strategy card metadata threaded from a content request into generateBrief().
 * Captures all context visible on a recommendation card so the brief
 * reflects strategic reasoning, not just the keyword.
 */
export interface StrategyCardContext {
  rationale?: string;
  volume?: number;
  difficulty?: number;
  trendDirection?: 'rising' | 'declining' | 'stable';
  /** e.g. ['featured_snippet', 'people_also_ask'] */
  serpFeatures?: string[];
  competitorProof?: string;
  impressions?: number;
  /** Search intent from the strategy gap (informational / commercial / transactional). */
  intent?: string;
  /** Priority from the strategy gap (high / medium / low). */
  priority?: string;
  /** Journey stage derived from intent — set by the route layer, not the client. */
  journeyStage?: BriefJourneyStage;
}

/**
 * Tone + structure configuration per page type.
 * PAGE_TYPE_CONFIGS in server/content-brief.ts maps BriefPageType → PageTypeBriefConfig.
 */
export interface PageTypeBriefConfig {
  /** Prose description of the recommended tone (injected into prompt). */
  tone: string;
  /** Recommended outline structure summary (injected into prompt). */
  structure: string;
  /** Schema.org types recommended for this page type, e.g. ['Article', 'BreadcrumbList']. */
  schemaTypes: string[];
  /** Target word count for this page type. */
  wordCountTarget: number;
  /** Word count range string shown in prompt, e.g. "1400–2200". */
  wordCountRange: string;
  /** Average words per section (used in per-section wordCount prompt values). */
  avgSectionWords: number;
  /** Recommended number of H2 sections, e.g. "6–8". */
  sectionRange: string;
  /** Full content style guidance injected into the prompt. */
  contentStyle: string;
}
```

- [ ] **Step 3: Verify compile**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add shared/types/content.ts
git commit -m "feat(types): add StrategyCardContext and PageTypeBriefConfig"
```

---

### Task 4: Extend `shared/types/workspace.ts` — new toggle + priorities

**Files:**
- Modify: `shared/types/workspace.ts`

- [ ] **Step 1: Locate the feature toggles block**

```bash
grep -n "clientPortalEnabled\|seoClientView\|analyticsClientView" shared/types/workspace.ts
```

Expected: lines around 175-177 showing the three existing toggles.

- [ ] **Step 2: Add the new toggle field**

In the `Workspace` interface, after `analyticsClientView`, add:

```typescript
  /** When false, the Site Intelligence module is hidden from this workspace's client dashboard. Default true. */
  siteIntelligenceClientView?: boolean | null;
```

- [ ] **Step 3: Locate the businessProfile block and add businessPriorities**

```bash
grep -n "businessProfile\|intelligenceProfile" shared/types/workspace.ts | head -10
```

In the `Workspace` interface, after the `businessProfile` field block, add:

```typescript
  /** Admin-editable client business goals, e.g. ['Grow new patient appointments by 25% in Q3']. */
  businessPriorities?: string[];
```

- [ ] **Step 4: Verify compile**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add shared/types/workspace.ts
git commit -m "feat(types): add siteIntelligenceClientView toggle and businessPriorities to Workspace"
```

---

### Task 5: Add `'brand'` to `ClientTab` in `src/routes.ts`

**Files:**
- Modify: `src/routes.ts` line 23

- [ ] **Step 1: Confirm current ClientTab definition**

```bash
grep -n "ClientTab" src/routes.ts
```

Expected output:
```
23: export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi';
```

- [ ] **Step 2: Add `'brand'` to the union**

Replace the `ClientTab` line:

```typescript
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi' | 'brand';
```

- [ ] **Step 3: Verify compile**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors. (No existing code references `'brand'` as a ClientTab yet — this is purely additive.)

- [ ] **Step 4: Commit**

```bash
git add src/routes.ts
git commit -m "feat(routes): add 'brand' to ClientTab type"
```

---

### Task 6: Add new feature flags

**Files:**
- Modify: `shared/types/feature-flags.ts`

- [ ] **Step 1: Locate the end of the FEATURE_FLAGS object**

```bash
grep -n "bridge-client-signal\|} as const" shared/types/feature-flags.ts
```

Expected: `bridge-client-signal` on the last flag line, followed by `} as const`.

- [ ] **Step 2: Add the three new flags before `} as const`**

In `shared/types/feature-flags.ts`, add after `'bridge-client-signal': false,`:

```typescript
  // Platform Intelligence Enhancements
  'smart-placeholders': false,       // System-wide smart placeholder hook (admin chips + prefill, client ghost text)
  'client-brand-section': false,     // Brand tab in client portal (business profile + brand positioning)
  'seo-editor-unified': false,       // Merged static+CMS SEO editor with collection filtering
```

- [ ] **Step 3: Verify compile**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors. `FeatureFlagKey` auto-expands to include the new flags via `keyof typeof`.

- [ ] **Step 4: Commit**

```bash
git add shared/types/feature-flags.ts
git commit -m "feat(flags): add smart-placeholders, client-brand-section, seo-editor-unified flags"
```

---

### Task 7: Migration 046 — `client_signals` table

**Files:**
- Create: `server/db/migrations/046-client-signals.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Store client CTA taps with surrounding chat context.
-- Created when a client taps a Service Interest CTA in the chat panel.
-- chatContext is JSON: ClientSignalMessage[] (last 10 messages at time of tap).

CREATE TABLE IF NOT EXISTS client_signals (
  id          TEXT NOT NULL PRIMARY KEY,
  workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('content_interest', 'service_interest')),
  chatContext TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'actioned')),
  createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_signals_workspace ON client_signals(workspaceId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_client_signals_status    ON client_signals(status);
```

- [ ] **Step 2: Verify migration applies cleanly**

Migrations run automatically via the `globalSetup` in the test suite. Run the full suite to confirm:

```bash
npx vitest run
```

Expected: all tests pass (migration applied; no schema conflicts).

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/046-client-signals.sql
git commit -m "feat(db): add client_signals table (migration 046)"
```

---

### Task 8: Migration 047 — `businessPriorities` column

**Files:**
- Create: `server/db/migrations/047-business-priorities.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add client-editable business priorities JSON column to workspaces.
-- Stores an array of goal strings, e.g. ["Grow patient appointments by 25% in Q3"].

ALTER TABLE workspaces ADD COLUMN businessPriorities TEXT;
```

- [ ] **Step 2: Verify migration applies**

```bash
npx vitest run
```

Expected: full suite passes.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/047-business-priorities.sql
git commit -m "feat(db): add businessPriorities column to workspaces (migration 047)"
```

---

### Task 9: Final verification + PR

- [ ] **Step 1: Full compile check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 2: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass. Note total test count — compare on next run.

- [ ] **Step 3: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feature/pie-phase0-contracts
```

Open PR: **"feat: PIE Phase 0 — shared contracts, feature flags, DB migrations"**

Merge target: `staging`

**Do not merge until CI is green.** Group 1/2/3 plans cannot start until this PR is merged to staging.
