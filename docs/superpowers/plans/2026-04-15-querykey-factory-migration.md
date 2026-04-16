# QueryKey Factory Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all inline React Query key literals across the frontend, routing every cache key through the centralized `queryKeys.*` factory in [src/lib/queryKeys.ts](src/lib/queryKeys.ts). Fix one confirmed stale-cache bug (diagnostic completion → insight feed) and fold scattered WebSocket invalidation handlers into the centralized [src/hooks/useWsInvalidation.ts](src/hooks/useWsInvalidation.ts).

**Architecture:** The `queryKeys.*` factory returns `as const` tuples so prefix-based invalidation works reliably. Every query and mutation in the app must reference factory entries rather than bare string arrays; inline literals drift from the factory and cause silent cache misses where `invalidateQueries` fails to match. The mechanized pr-check rule (`Inline React Query string key`) enforces this going forward.

**Tech Stack:** React Query v5 (`@tanstack/react-query`), TypeScript strict, Vitest for cache-behavior tests.

---

## Pre-requisites

- [x] Pre-plan audit complete — performed inline during plan authoring (see "Current State" below). 7 files already migrated; 14 remain; `useGA4Base.ts` hit is JSDoc-only.
- [x] Spec source: user message (2026-04-15) — captured verbatim in phase structure
- [ ] Branch: work in `claude/objective-napier` worktree (current), branch off `main`

---

## Parallelization Strategy

This is a **6-PR sequential-phase plan** per the CLAUDE.md "Phase-per-PR" rule — each phase merges to `staging` before the next opens. **Phases cannot run in parallel** because:

1. All 6 phases modify [src/lib/queryKeys.ts](src/lib/queryKeys.ts) (append-only, would cause merge friction)
2. Phases 1, 2, 3 all modify [src/hooks/useWsInvalidation.ts](src/hooks/useWsInvalidation.ts) (same file, sequential)
3. Staging-before-main rule forces sequential verification

**However, tasks WITHIN each phase can parallelize** once the factory entries and contract test are committed. The "parallel-safe" batches below dispatch N subagents concurrently per the multi-agent coordination rules.

### Model assignments

Per the table in [docs/PLAN_WRITING_GUIDE.md:73](docs/PLAN_WRITING_GUIDE.md):

| Task type | Model | Why |
|-----------|-------|-----|
| Factory entry additions (Tasks 1.1, 2.1, 3.1, 4.1, 5.1, 6.1) | **haiku** | Pure transcription — exact string literals from spec |
| Contract tests (Tasks 1.2, 2.4, 3.5, 4.1 step 2, 5.1 step 2) | **haiku** | Mechanical equality checks against frozen strings |
| Single-file component migrations (Tasks 4.2–4.5, 5.2, 6.3) | **haiku** | Find-and-replace with factory calls, no judgment |
| Multi-concern hook migrations (Tasks 1.3, 2.2, 3.3) | **sonnet** | Touches imports + queries + mutations + staleTime tiers — needs local judgment |
| WS fold-in (Tasks 1.4, 2.3, 3.2) | **sonnet** | Cross-file coordination — handlers must match the factory keys the queries register under |
| Bug-fix verification (Task 2.6) | **sonnet** | Manual browser verification + screenshot documentation |
| Call-site removal (Tasks 1.5, 2.5) | **haiku** | Mechanical — delete import + call line |
| AnomalyAlerts local-handler deletion (Task 6.2) | **sonnet** | Must verify centralized hook already covers the event before deleting |
| Final verification + commit (Tasks 1.6, 2.7, 3.6, 4.6, 5.3, 6.4) | **sonnet** | Reviews diff, composes commit, catches regressions |

**Reviewer model for both stages:** `opus` — never downgrade reviewers per the guide.

---

## Current State (verified 2026-04-15)

Some migration work has already landed. **Do not re-migrate these files** — they are already on the factory:

- `src/hooks/useFeatureFlag.ts` — uses `queryKeys.shared.featureFlags()`
- `src/components/FeatureFlagSettings.tsx` — uses `queryKeys.admin.featureFlags()`
- `src/components/SeoEditor.tsx` — uses `queryKeys.admin.seoEditor()` / `keywordStrategy()` / `seoSuggestions()` / `auditAll()`
- `src/components/PageIntelligence.tsx` — uses `queryKeys.admin.keywordStrategy()`
- `src/components/WorkspaceHome.tsx` — uses `queryKeys.admin.workspaceHome()`
- `src/components/AssetBrowser.tsx`
- `src/components/KeywordStrategy.tsx`

`queryKeys.shared.featureFlags()` and `queryKeys.admin.featureFlags()` are already defined — **do not re-add**.

`queryKeys.admin.anomalyAlerts()` is also already defined (line 57). The `useWsInvalidation` hook already handles `ANOMALIES_UPDATE` (line 64). This simplifies Phase 6's AnomalyAlerts migration — its local WS handler can be deleted outright.

**`src/hooks/shared/useGA4Base.ts`** grep hits for `queryKey: ['` are inside a JSDoc comment block on line 7. The pr-check rule already skips comments (`/^\s*(\/\/|\*)/`), so **no change is needed** in that file. The dynamic `mk(metric)` builder is correct and mirrors `queryKeys.admin.ga4()` / `queryKeys.client.ga4()`.

**Remaining scope:** 77 inline literals across 14 files, structured into 6 phases below. Each phase is a separate PR per the CLAUDE.md "Phase-per-PR" rule.

---

## File Structure

**Modified in every phase:**
- [src/lib/queryKeys.ts](src/lib/queryKeys.ts) — factory entries added per phase
- [src/hooks/useWsInvalidation.ts](src/hooks/useWsInvalidation.ts) — WS handlers folded in (phases 1, 2, 3)

**Modified per phase:**

| Phase | Files | Inline keys |
|-------|-------|-------------|
| 1 | `src/hooks/admin/useCopyPipeline.ts`, `src/components/brand/BlueprintDetail.tsx` | 31 |
| 2 | `src/hooks/admin/useDiagnostics.ts`, `src/components/insights/InsightFeed.tsx`, `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx` | 10 |
| 3 | `src/components/PendingApprovals.tsx`, `src/components/FeatureLibrary.tsx` | 6 |
| 4 | `src/components/brand/VoiceTab.tsx`, `src/components/brand/IdentityTab.tsx`, `src/components/brand/DiscoveryTab.tsx`, `src/components/brand/CopyIntelligenceManager.tsx` | 17 |
| 5 | `src/components/client/ClientCopyReview.tsx` | 8 |
| 6 | `src/components/AnomalyAlerts.tsx`, `src/components/ContentBriefs.tsx`, `src/components/ContentManager.tsx`, `src/components/PostEditor.tsx`, `src/components/PageRewriteChat.tsx` | 10 |

No file is owned by more than one phase for component migrations. `queryKeys.ts` and `useWsInvalidation.ts` are shared across phases but each phase only appends/modifies its own section.

---

## Task Dependency Graph

### Phase 1 (Copy Pipeline) — 6 tasks

```
Task 1.1 (add factory entries — haiku)
    ↓
Task 1.2 (contract test — haiku)
    ↓
    ├─∥─ Task 1.3 (migrate useCopyPipeline.ts — sonnet)
    └─∥─ Task 1.4 (fold WS events into useWsInvalidation — sonnet)
    ↓ (both must complete; 1.3 deletes the hook 1.5 references)
Task 1.5 (remove useCopyPipelineEvents call site in BlueprintDetail — haiku)
    ↓
Task 1.6 (full suite + commit — sonnet)
```

**Parallel-safe batch:** {1.3, 1.4} after 1.2. Different files, no shared imports edited.

### Phase 2 (Diagnostics) — 7 tasks

```
Task 2.1 (add factory entries — haiku)
    ↓
    ├─∥─ Task 2.2 (migrate useDiagnostics.ts — sonnet)
    ├─∥─ Task 2.3 (fold WS events + bug fix into useWsInvalidation — sonnet)
    └─∥─ Task 2.4 (add regression test — haiku)
    ↓ (2.2 deletes useDiagnosticEvents; 2.5 removes its call sites)
Task 2.5 (remove call sites in InsightFeed + DiagnosticReportPage — haiku)
    ↓
Task 2.6 (manual bug verification in browser — sonnet)
    ↓
Task 2.7 (full suite + commit — sonnet)
```

**Parallel-safe batch:** {2.2, 2.3, 2.4} after 2.1. Three separate files.

### Phase 3 (Approvals + FeatureLibrary) — 6 tasks

```
Task 3.1 (add factory entries — haiku)
    ↓
Task 3.2 (extend useWsInvalidation — sonnet)
    ↓
    ├─∥─ Task 3.3 (migrate PendingApprovals.tsx — sonnet)
    └─∥─ Task 3.4 (migrate FeatureLibrary.tsx — haiku)
    ↓
    ├─∥─ Task 3.5 (contract test — haiku)
    └─∥─ Task 3.6 (verification + commit — sonnet)  [3.6 depends on all prior]
```

**Parallel-safe batch:** {3.3, 3.4} after 3.2. Different files. 3.5 can overlap with these three.

Task 3.2 must run BEFORE 3.3 because 3.3 deletes the local WS handler and relies on the centralized one already covering it — otherwise admin approvals briefly stop invalidating between 3.3 landing and 3.2 landing.

### Phase 4 (Brand Engine tabs) — 6 tasks

```
Task 4.1 (add factory entries + contract test — haiku)
    ↓
    ├─∥─ Task 4.2 (VoiceTab.tsx — haiku)
    ├─∥─ Task 4.3 (IdentityTab.tsx — haiku)
    ├─∥─ Task 4.4 (DiscoveryTab.tsx — haiku)
    └─∥─ Task 4.5 (CopyIntelligenceManager.tsx — haiku)
    ↓
Task 4.6 (full suite + commit — sonnet)
```

**Parallel-safe batch:** {4.2, 4.3, 4.4, 4.5} — four disjoint files, factory pre-committed. This is the largest parallelism opportunity in the plan. Dispatch 4 haiku subagents concurrently.

### Phase 5 (ClientCopyReview) — 3 tasks

```
Task 5.1 (add factory entries + contract test — haiku)
    ↓
Task 5.2 (migrate ClientCopyReview.tsx — haiku)
    ↓
Task 5.3 (full suite + commit — sonnet)
```

No intra-phase parallelism — single file modification.

### Phase 6 (remaining components) — 4 tasks

```
Task 6.1 (add rewritePages factory entry — haiku)
    ↓
    ├─∥─ Task 6.2 (AnomalyAlerts.tsx — sonnet; deletes local WS handler)
    └─∥─ Task 6.3 (ContentBriefs, ContentManager, PostEditor, PageRewriteChat — haiku for each)
    ↓
Task 6.4 (final verification + commit — sonnet)
```

**Parallel-safe batch:** {6.2, 6.3a, 6.3b, 6.3c, 6.3d} — 5 disjoint component files after 6.1. Dispatch 5 subagents: 1 sonnet (AnomalyAlerts) + 4 haiku (the single-touch files).

---

## File Ownership — per parallel batch

### Phase 1, parallel batch {1.3, 1.4}

**Task 1.3 (sonnet) owns:**
- `src/hooks/admin/useCopyPipeline.ts`

**Task 1.3 may READ but must NOT modify:**
- `src/lib/queryKeys.ts` (Task 1.1, already committed)
- `src/lib/wsEvents.ts`
- `src/lib/queryClient.ts`
- `src/hooks/useWsInvalidation.ts` (owned by Task 1.4)

**Task 1.4 (sonnet) owns:**
- `src/hooks/useWsInvalidation.ts`

**Task 1.4 may READ but must NOT modify:**
- `src/lib/queryKeys.ts` (Task 1.1, already committed)
- `src/hooks/admin/useCopyPipeline.ts` (owned by Task 1.3)

### Phase 2, parallel batch {2.2, 2.3, 2.4}

**Task 2.2 (sonnet) owns:** `src/hooks/admin/useDiagnostics.ts`
**Task 2.3 (sonnet) owns:** `src/hooks/useWsInvalidation.ts`
**Task 2.4 (haiku) owns:** `tests/contract/diagnostic-invalidates-insight-feed.test.ts` (create)

All three tasks must NOT touch:
- `src/lib/queryKeys.ts` (Task 2.1, already committed)
- Each other's owned files
- `src/components/insights/InsightFeed.tsx` (Task 2.5, sequential)
- `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx` (Task 2.5, sequential)

### Phase 3, parallel batch {3.3, 3.4}

**Task 3.3 (sonnet) owns:** `src/components/PendingApprovals.tsx`
**Task 3.4 (haiku) owns:** `src/components/FeatureLibrary.tsx`

Both must NOT touch:
- `src/lib/queryKeys.ts` (Task 3.1, committed)
- `src/hooks/useWsInvalidation.ts` (Task 3.2, committed)
- Each other's file

### Phase 4, parallel batch {4.2, 4.3, 4.4, 4.5}

Four haiku subagents, each owns exactly one file:

| Task | Owns |
|------|------|
| 4.2 | `src/components/brand/VoiceTab.tsx` |
| 4.3 | `src/components/brand/IdentityTab.tsx` |
| 4.4 | `src/components/brand/DiscoveryTab.tsx` |
| 4.5 | `src/components/brand/CopyIntelligenceManager.tsx` |

All four must NOT touch `src/lib/queryKeys.ts` (Task 4.1, committed) or each other's files.

### Phase 6, parallel batch {6.2, 6.3a, 6.3b, 6.3c, 6.3d}

Five subagents, each owns exactly one file:

| Task | Model | Owns |
|------|-------|------|
| 6.2 | sonnet | `src/components/AnomalyAlerts.tsx` |
| 6.3a | haiku | `src/components/ContentBriefs.tsx` |
| 6.3b | haiku | `src/components/ContentManager.tsx` |
| 6.3c | haiku | `src/components/PostEditor.tsx` |
| 6.3d | haiku | `src/components/PageRewriteChat.tsx` |

All must NOT touch `src/lib/queryKeys.ts` (Task 6.1, committed) or each other's files.

---

## Systemic Improvements

**Shared utilities to extract:** None — this plan consolidates INTO an existing shared utility (`queryKeys.ts` and `useWsInvalidation.ts`). No new helpers are justified; three similar lines of factory-call code are preferable to a premature abstraction (per CLAUDE.md).

**pr-check rules to add:** None. The existing rule `Inline React Query string key (use queryKeys.*)` at [scripts/pr-check.ts:2944](scripts/pr-check.ts:2944) already enforces this class. After Phase 6, the rule moves from "aspirational" (many violations) to "enforcing" (zero violations). Consider tightening the rule post-migration to also forbid the factory being called from non-hook files — but that's a follow-up, not part of this plan.

**New tests required (already listed per phase):**
- `tests/contract/copy-pipeline-querykeys.test.ts` (Phase 1)
- `tests/contract/diagnostic-invalidates-insight-feed.test.ts` (Phase 2 — includes bug-fix regression guard)
- `tests/contract/approvals-features-querykeys.test.ts` (Phase 3)
- `tests/contract/brand-engine-querykeys.test.ts` (Phase 4)
- `tests/contract/client-copy-querykeys.test.ts` (Phase 5)

Contract tests are lightweight (2–4 assertions each) but pin factory prefixes so a future rename doesn't silently break invalidation chains.

**Coverage gaps discovered during audit:** `useGA4Base.ts` builds keys dynamically via `mk(metric)`. It works correctly but bypasses the factory. A follow-up task (not in this plan) could refactor it to delegate to `queryKeys.admin.ga4()` / `queryKeys.client.ga4()` directly.

---

## Verification Strategy (per phase)

Each phase has a "full suite + commit" task with these specific commands:

```bash
npm run typecheck                          # zero errors (tsc -b project-aware)
npx vite build                             # production build succeeds
npx vitest run                             # full suite green (not just new tests)
npx tsx scripts/pr-check.ts                # zero violations, specifically the
                                           # "Inline React Query string key" rule
```

**Phase-specific verification:**

| Phase | Additional verification |
|-------|------------------------|
| 1 | `grep -rn "useCopyPipelineEvents" src/ tests/` → zero matches |
| 2 | **Manual browser test (Task 2.6):** run a diagnostic, confirm insight feed refreshes without reload. Document in PR description. |
| 3 | **Manual smoke:** approve a batch from client side, confirm admin `PendingApprovals` updates via WS |
| 4 | `grep -rn "queryKey: \['admin-\(voice\|brand-identity\|discovery\)" src/` → zero matches |
| 5 | `grep -rn "queryKey: \['client-copy-" src/` → zero matches |
| 6 (final) | `grep -rn "queryKey: \['" src/` → zero matches repo-wide; pr-check rule reports zero `Inline React Query string key` violations |

**Cache-behavior regression check (run at end of every phase):** open admin dashboard, trigger each WS event the phase touches (via real actions or manual server trigger), confirm React Query devtools shows the correct cache entries invalidating. If a handler fires but the corresponding query doesn't re-run, the factory key and handler key don't match — stop and investigate.

---

# Phase 1 — Copy Pipeline (31 inline literals)

**PR title:** `refactor(copy-pipeline): route query keys through factory + fold WS events into useWsInvalidation`

## Task 1.1: Add copy pipeline factory entries (Model: haiku)

**Files:**
- Modify: [src/lib/queryKeys.ts:76](src/lib/queryKeys.ts:76)

- [ ] **Step 1: Add "Copy Pipeline" block after the "Brand Engine — Page Strategy" block**

Insert after line 75 (the `blueprintVersions` entry), before the `// CMS` section (line 77):

```typescript
    // Copy Pipeline
    copySections: (wsId: string, entryId: string) => ['admin-copy-sections', wsId, entryId] as const,
    copySectionsAll: (wsId: string) => ['admin-copy-sections', wsId] as const,
    copyStatus: (wsId: string, entryId: string) => ['admin-copy-status', wsId, entryId] as const,
    copyStatusAll: (wsId: string) => ['admin-copy-status', wsId] as const,
    copyMetadata: (wsId: string, entryId: string) => ['admin-copy-metadata', wsId, entryId] as const,
    copyMetadataAll: (wsId: string) => ['admin-copy-metadata', wsId] as const,
    copyIntelligence: (wsId: string) => ['admin-copy-intelligence', wsId] as const,
    copyPromotable: (wsId: string) => ['admin-copy-promotable', wsId] as const,
    copyBatch: (wsId: string, batchId: string) => ['admin-copy-batch', wsId, batchId] as const,
    copyBatchAll: (wsId: string) => ['admin-copy-batch', wsId] as const,
```

Rationale for `*All` variants: mutations and WS handlers use `[prefix, wsId]` for prefix-match invalidation, while queries use the full key including `entryId` / `batchId`. The `*All` variant keeps call sites free of inline arrays.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: PASS (no new errors; the entries are additive).

## Task 1.2: Add cache-behavior contract test (Model: haiku)

**Files:**
- Create: `tests/contract/copy-pipeline-querykeys.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('copy pipeline query key factory', () => {
  it('prefix-All variants are a strict prefix of the full variant', () => {
    const ws = 'ws-1';
    const entry = 'entry-1';
    const batch = 'batch-1';
    expect(queryKeys.admin.copySections(ws, entry).slice(0, 2))
      .toEqual(queryKeys.admin.copySectionsAll(ws));
    expect(queryKeys.admin.copyStatus(ws, entry).slice(0, 2))
      .toEqual(queryKeys.admin.copyStatusAll(ws));
    expect(queryKeys.admin.copyMetadata(ws, entry).slice(0, 2))
      .toEqual(queryKeys.admin.copyMetadataAll(ws));
    expect(queryKeys.admin.copyBatch(ws, batch).slice(0, 2))
      .toEqual(queryKeys.admin.copyBatchAll(ws));
  });

  it('key strings match the legacy inline literals they replace', () => {
    const ws = 'ws-1';
    expect(queryKeys.admin.copySectionsAll(ws)[0]).toBe('admin-copy-sections');
    expect(queryKeys.admin.copyStatusAll(ws)[0]).toBe('admin-copy-status');
    expect(queryKeys.admin.copyMetadataAll(ws)[0]).toBe('admin-copy-metadata');
    expect(queryKeys.admin.copyIntelligence(ws)[0]).toBe('admin-copy-intelligence');
    expect(queryKeys.admin.copyPromotable(ws)[0]).toBe('admin-copy-promotable');
    expect(queryKeys.admin.copyBatchAll(ws)[0]).toBe('admin-copy-batch');
  });
});
```

- [ ] **Step 2: Run the test to confirm it passes**

```bash
npx vitest run tests/contract/copy-pipeline-querykeys.test.ts
```
Expected: PASS, 2 tests.

The test guards against someone later changing a factory string (e.g. renaming `'admin-copy-sections'`), which would silently break mutation invalidations whose cached entries used the old prefix.

## Task 1.3: Migrate queries in useCopyPipeline.ts (Model: sonnet)

**Files:**
- Modify: [src/hooks/admin/useCopyPipeline.ts](src/hooks/admin/useCopyPipeline.ts)

- [ ] **Step 1: Add factory and WS_EVENTS imports at top of file**

Replace line 1–14 (current imports). After the existing imports, add:

```typescript
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
```

Per the CLAUDE.md Imports rule, keep these with the existing import block at the top of the file.

- [ ] **Step 2: Replace the 6 query keys**

Lines 20, 28, 36, 44, 52, 60 — replace the `queryKey` values:

```typescript
// Line 20 (useCopySections):
queryKey: queryKeys.admin.copySections(wsId, entryId),

// Line 28 (useCopyStatus):
queryKey: queryKeys.admin.copyStatus(wsId, entryId),

// Line 36 (useCopyMetadata):
queryKey: queryKeys.admin.copyMetadata(wsId, entryId),

// Line 44 (useCopyIntelligence):
queryKey: queryKeys.admin.copyIntelligence(wsId),

// Line 52 (usePromotablePatterns):
queryKey: queryKeys.admin.copyPromotable(wsId),

// Line 60 (useBatchJob):
queryKey: queryKeys.admin.copyBatch(wsId, batchId!),
```

- [ ] **Step 3: Replace mutation invalidation keys**

Lines 75–77 (useGenerateCopy):
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySections(wsId, entryId) });
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyStatus(wsId, entryId) });
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyMetadata(wsId, entryId) });
```

Lines 90–91 (useRegenerateCopySection):
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySections(wsId, entryId) });
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyStatus(wsId, entryId) });
```

Lines 104–105 (useUpdateSectionStatus — only wsId, so use `*All`):
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(wsId) });
```

Line 118 (useUpdateSectionText):
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
```

Line 131 (useAddSuggestion):
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
```

Line 144 (useStartBatch):
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyBatchAll(wsId) });
```

Lines 166–167 (useTogglePattern):
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(wsId) });
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(wsId) });
```

Lines 180–181 (useDeletePattern): same as useTogglePattern above.

Lines 193–194 (useExtractPatterns): same as useTogglePattern above.

- [ ] **Step 4: Add explicit staleTime to each query**

Import `STALE_TIMES` by extending the existing import block. Find the import for `useQuery` (line 1) and add a new line below it:

```typescript
import { STALE_TIMES } from '../../lib/queryClient';
```

Then add `staleTime:` to each `useQuery` call:

```typescript
// useCopySections (line 18):
return useQuery({
  queryKey: queryKeys.admin.copySections(wsId, entryId),
  queryFn: () => copyReview.getSections(wsId, entryId),
  enabled: !!(wsId && entryId),
  staleTime: STALE_TIMES.NORMAL,
});

// useCopyStatus:
staleTime: STALE_TIMES.NORMAL,

// useCopyMetadata:
staleTime: STALE_TIMES.NORMAL,

// useCopyIntelligence (patterns change rarely):
staleTime: STALE_TIMES.STABLE,

// usePromotablePatterns (patterns change rarely):
staleTime: STALE_TIMES.STABLE,

// useBatchJob:
staleTime: STALE_TIMES.NORMAL,
```

- [ ] **Step 5: Delete `useCopyPipelineEvents` entirely (lines 199–224)**

Delete the whole block starting at the `// ═══ WEBSOCKET INVALIDATION ═══` comment through the closing `}` of `useCopyPipelineEvents`. This hook moves to `useWsInvalidation` (Task 1.4).

Also remove the now-unused import of `useWorkspaceEvents` from line 9. TypeScript will flag it if you forget.

- [ ] **Step 6: Run typecheck + vitest on the file**

```bash
npm run typecheck
npx vitest run --reporter=verbose src/hooks/admin/useCopyPipeline.ts
```
Expected: PASS. If any test references `useCopyPipelineEvents`, it will fail — fix those in Task 1.5.

## Task 1.4: Fold copy pipeline WS events into useWsInvalidation (Model: sonnet)

**Files:**
- Modify: [src/hooks/useWsInvalidation.ts:153](src/hooks/useWsInvalidation.ts:153)

- [ ] **Step 1: Add the 5 copy pipeline event handlers**

After the `MEETING_BRIEF_GENERATED` handler (line 150–153), before the closing `});` of `useWorkspaceEvents`, add:

```typescript
    [WS_EVENTS.COPY_SECTION_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(workspaceId) });
    },
    [WS_EVENTS.COPY_METADATA_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyMetadataAll(workspaceId) });
    },
    [WS_EVENTS.COPY_BATCH_PROGRESS]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyBatchAll(workspaceId) });
    },
    [WS_EVENTS.COPY_BATCH_COMPLETE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyBatchAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(workspaceId) });
    },
    [WS_EVENTS.COPY_INTELLIGENCE_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(workspaceId) });
    },
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: PASS.

## Task 1.5: Remove useCopyPipelineEvents call site in BlueprintDetail.tsx (Model: haiku)

**Files:**
- Modify: [src/components/brand/BlueprintDetail.tsx:30](src/components/brand/BlueprintDetail.tsx:30), [src/components/brand/BlueprintDetail.tsx:384](src/components/brand/BlueprintDetail.tsx:384)

- [ ] **Step 1: Remove import and call**

Line 30: change
```typescript
import { useCopyStatus, useCopyPipelineEvents, useGenerateCopy } from '../../hooks/admin/useCopyPipeline';
```
to
```typescript
import { useCopyStatus, useGenerateCopy } from '../../hooks/admin/useCopyPipeline';
```

Line 384: delete the entire `useCopyPipelineEvents(workspaceId);` line.

The centralized `useWsInvalidation` (mounted at the dashboard root) now covers these events — the local hook was redundant once Task 1.4 landed.

- [ ] **Step 2: Grep to confirm no other call sites**

```bash
grep -rn "useCopyPipelineEvents" src/ tests/
```
Expected: zero matches.

## Task 1.6: Run full test suite + pr-check (Model: sonnet)

- [ ] **Step 1: Run full suite**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```
Expected: all green. The `Inline React Query string key` rule should report 0 violations in the Phase 1 files (check the rule output specifically mentions no `useCopyPipeline.ts` entries).

- [ ] **Step 2: Commit Phase 1**

```bash
git add src/lib/queryKeys.ts src/hooks/admin/useCopyPipeline.ts src/hooks/useWsInvalidation.ts src/components/brand/BlueprintDetail.tsx tests/contract/copy-pipeline-querykeys.test.ts
git commit -m "$(cat <<'EOF'
refactor(copy-pipeline): route query keys through factory

Adds copy pipeline entries to queryKeys factory (queries + *All prefix
variants for invalidation), migrates useCopyPipeline.ts off 31 inline
literals, folds the 5 copy pipeline WS events into useWsInvalidation,
and removes the now-redundant useCopyPipelineEvents hook and its
BlueprintDetail call site.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Open PR to staging and wait for CI green before Phase 2**

Per CLAUDE.md Phase-per-PR rule — do not start Phase 2 until Phase 1 is merged to staging.

---

# Phase 2 — Diagnostics (10 inline literals + 1 live bug fix)

**PR title:** `fix(diagnostics): route keys through factory + repair dead insight-feed invalidation`

## Task 2.1: Add diagnostics factory entries (Model: haiku)

**Files:**
- Modify: [src/lib/queryKeys.ts](src/lib/queryKeys.ts)

- [ ] **Step 1: Add "Diagnostics" block after the copy pipeline block from Phase 1**

```typescript
    // Diagnostics
    diagnostics: (wsId: string) => ['admin-diagnostics', wsId] as const,
    diagnosticDetail: (wsId: string, reportId: string) => ['admin-diagnostics', wsId, reportId] as const,
    diagnosticForInsight: (wsId: string, insightId: string) => ['admin-diagnostic-for-insight', wsId, insightId] as const,
    diagnosticForInsightAll: (wsId: string) => ['admin-diagnostic-for-insight', wsId] as const,
```

Note: `diagnosticDetail` intentionally shares the `['admin-diagnostics', wsId]` prefix with `diagnostics` so invalidating the list also clears individual detail entries.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

## Task 2.2: Migrate useDiagnostics.ts + bug fix (Model: sonnet)

**Files:**
- Modify: [src/hooks/admin/useDiagnostics.ts](src/hooks/admin/useDiagnostics.ts)

- [ ] **Step 1: Replace imports (lines 1–4)**

Final import block at the top of the file:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { diagnostics } from '../../api/index.js';
import { queryKeys } from '../../lib/queryKeys';
```

Remove the `useWorkspaceEvents` and `WS_EVENTS` imports — they become unused when `useDiagnosticEvents` is deleted in Task 2.4.

- [ ] **Step 2: Delete the local DIAGNOSTICS_KEYS object**

Remove lines 6–10 entirely.

- [ ] **Step 3: Replace all usages**

```typescript
// Line 14 (useDiagnosticsList):
queryKey: queryKeys.admin.diagnostics(workspaceId),

// Line 23 (useDiagnosticReport):
queryKey: queryKeys.admin.diagnosticDetail(workspaceId, reportId),

// Line 36 (useDiagnosticForInsight):
queryKey: queryKeys.admin.diagnosticForInsight(workspaceId, insightId),

// Line 48 (useRunDiagnostic onSuccess):
qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(workspaceId) });

// Line 50:
qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(workspaceId) });
```

- [ ] **Step 4: Delete `useDiagnosticEvents` (lines 55–73)**

Delete the entire function and its JSDoc comment. WS handling moves to `useWsInvalidation` in Task 2.3.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```
Expected: PASS. Callers of `useDiagnosticEvents` will break; Task 2.5 fixes them.

## Task 2.3: Fold diagnostic WS events into useWsInvalidation (INCLUDES BUG FIX) (Model: sonnet)

**Files:**
- Modify: [src/hooks/useWsInvalidation.ts](src/hooks/useWsInvalidation.ts)

- [ ] **Step 1: Add the 2 diagnostic event handlers**

After the Phase 1 copy events you added, before the closing `});`:

```typescript
    [WS_EVENTS.DIAGNOSTIC_COMPLETE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(workspaceId) });
      // BUG FIX: prior code invalidated ['admin-insights', workspaceId] which matches no
      // registered query. The real insight feed key is queryKeys.admin.insightFeed(),
      // so diagnostic completion now correctly refreshes the feed.
      qc.invalidateQueries({ queryKey: queryKeys.admin.insightFeed(workspaceId) });
    },
    [WS_EVENTS.DIAGNOSTIC_FAILED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(workspaceId) });
    },
```

The inline comment documents the bug fix — the previous `['admin-insights', wsId]` inside the deleted `useDiagnosticEvents` was dead code: no query in the app registers under that prefix. The feed uses `['admin-insight-feed', wsId]` (see [src/lib/queryKeys.ts:62](src/lib/queryKeys.ts:62)).

## Task 2.4: Add bug-fix regression test (Model: haiku)

**Files:**
- Create: `tests/contract/diagnostic-invalidates-insight-feed.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

/**
 * Regression guard for the diagnostic:complete → insight feed invalidation bug.
 *
 * The dead `['admin-insights', wsId]` key silently missed the real feed cache
 * entry, so users saw stale insights after a diagnostic finished. This test
 * pins the correct factory prefix so any future rename stays wired correctly.
 */
describe('diagnostic completion invalidates the insight feed', () => {
  it('queryKeys.admin.insightFeed prefix is what the WS handler invalidates', () => {
    const ws = 'ws-1';
    expect(queryKeys.admin.insightFeed(ws)).toEqual(['admin-insight-feed', ws]);
  });

  it('diagnosticForInsightAll is a strict prefix of diagnosticForInsight', () => {
    const ws = 'ws-1';
    const insight = 'insight-1';
    expect(queryKeys.admin.diagnosticForInsight(ws, insight).slice(0, 2))
      .toEqual(queryKeys.admin.diagnosticForInsightAll(ws));
  });

  it('diagnostics list prefix is shared by diagnosticDetail so invalidating list clears details', () => {
    const ws = 'ws-1';
    const report = 'rpt-1';
    expect(queryKeys.admin.diagnosticDetail(ws, report).slice(0, 2))
      .toEqual(queryKeys.admin.diagnostics(ws));
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run tests/contract/diagnostic-invalidates-insight-feed.test.ts
```
Expected: PASS, 3 tests.

## Task 2.5: Remove useDiagnosticEvents call sites (Model: haiku)

**Files:**
- Modify: [src/components/insights/InsightFeed.tsx:7](src/components/insights/InsightFeed.tsx:7), [src/components/insights/InsightFeed.tsx:31](src/components/insights/InsightFeed.tsx:31)
- Modify: [src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:12](src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:12), [src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:175](src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx:175)

- [ ] **Step 1: In InsightFeed.tsx, remove the import and call**

Line 7: remove `useDiagnosticEvents` from the import. If it's the only import on that line, delete the whole line.

Line 31: delete `useDiagnosticEvents(workspaceId ?? '');`.

- [ ] **Step 2: In DiagnosticReportPage.tsx, remove the import and call**

Line 12: change
```typescript
import { useDiagnosticReport, useDiagnosticsList, useDiagnosticEvents } from '../../../hooks/admin/useDiagnostics.js';
```
to
```typescript
import { useDiagnosticReport, useDiagnosticsList } from '../../../hooks/admin/useDiagnostics.js';
```

Line 175: delete `useDiagnosticEvents(workspaceId);`.

- [ ] **Step 3: Grep to confirm no other call sites**

```bash
grep -rn "useDiagnosticEvents" src/ tests/
```
Expected: zero matches.

## Task 2.6: Manual bug verification (Model: sonnet)

- [ ] **Step 1: Start dev servers**

```bash
npm run dev:all
```

- [ ] **Step 2: Trigger a diagnostic and watch the feed**

1. Open the admin dashboard for a test workspace
2. Navigate to an insight, click "Run Diagnostic"
3. Wait for the WS `diagnostic:complete` event
4. **Expected:** insight feed updates automatically (no manual refresh required). Before the bug fix this did not happen — the feed stayed stale.

Document the result in the PR description.

## Task 2.7: Full suite + commit (Model: sonnet)

- [ ] **Step 1: Run checks**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

- [ ] **Step 2: Commit + open PR**

```bash
git add src/lib/queryKeys.ts src/hooks/admin/useDiagnostics.ts src/hooks/useWsInvalidation.ts src/components/insights/InsightFeed.tsx src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx tests/contract/diagnostic-invalidates-insight-feed.test.ts
git commit -m "$(cat <<'EOF'
fix(diagnostics): repair dead insight-feed invalidation + factory migration

diagnostic:complete previously invalidated ['admin-insights', wsId] which
matches no registered query — the insight feed stayed stale after a
diagnostic finished. Migrates useDiagnostics off a local DIAGNOSTICS_KEYS
object onto the centralized factory, folds diagnostic WS events into
useWsInvalidation with the correct insightFeed key, and adds a contract
test pinning the factory prefix.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

Wait for staging CI green before starting Phase 3.

---

# Phase 3 — PendingApprovals + FeatureLibrary (6 inline literals)

**PR title:** `refactor(approvals): move PendingApprovals onto useWsInvalidation + FeatureLibrary factory migration`

## Task 3.1: Add factory entries (Model: haiku)

**Files:**
- Modify: [src/lib/queryKeys.ts](src/lib/queryKeys.ts)

- [ ] **Step 1: Add admin.approvals entry**

In the `admin:` section, near the other content-related entries (after `requests` line 34):

```typescript
    approvals: (wsId: string) => ['admin-approvals', wsId] as const,
```

- [ ] **Step 2: Add shared.features entry**

In the `shared:` section (existing, around line 141), after `pageEditStates`:

```typescript
    features: () => ['features'] as const,
```

Note: `shared.featureFlags()` already exists — do not re-add.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

## Task 3.2: Extend useWsInvalidation for admin approvals (Model: sonnet)

**Files:**
- Modify: [src/hooks/useWsInvalidation.ts:21-30](src/hooks/useWsInvalidation.ts:21)

- [ ] **Step 1: Add `admin.approvals` to both handlers**

Replace lines 21–30 (APPROVAL_UPDATE and APPROVAL_APPLIED handlers):

```typescript
    [WS_EVENTS.APPROVAL_UPDATE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.approvals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.approvals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.APPROVAL_APPLIED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.approvals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.approvals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
```

## Task 3.3: Migrate PendingApprovals.tsx (Model: sonnet)

**Files:**
- Modify: [src/components/PendingApprovals.tsx](src/components/PendingApprovals.tsx)

- [ ] **Step 1: Update imports**

At the top of the file (lines 1–10), the final import block should be:

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, ChevronDown, Bell, Check } from 'lucide-react';
import { approvals } from '../api/misc';
import { queryKeys } from '../lib/queryKeys';
import type { ApprovalBatch } from '../../shared/types/approvals';
```

Remove `useWorkspaceEvents` import — the local WS handler is going away (centralized hook now handles it).

- [ ] **Step 2: Delete the local useWorkspaceEvents block (lines 31–35)**

Remove the entire block:
```typescript
// DELETE THIS:
useWorkspaceEvents(workspaceId, {
  'approval:update': () => queryClient.invalidateQueries({ queryKey: ['admin-approvals', workspaceId] }),
  'approval:applied': () => queryClient.invalidateQueries({ queryKey: ['admin-approvals', workspaceId] }),
});
```

Rationale: `useWsInvalidation` (mounted at the dashboard root) now fires these invalidations globally — the local subscription is redundant after Task 3.2.

- [ ] **Step 3: Migrate the query key (line 38)**

```typescript
queryKey: [...queryKeys.admin.approvals(workspaceId), refreshKey],
```

The `...` spread is needed because `refreshKey` is an external trigger not part of the factory. This spread form is allowed by pr-check (the rule skips `[...queryKeys.*]` patterns — see [scripts/pr-check.ts:2981](scripts/pr-check.ts:2981)).

- [ ] **Step 4: Migrate the mutation invalidation (line 54)**

```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.approvals(workspaceId) });
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

## Task 3.4: Migrate FeatureLibrary.tsx (Model: haiku)

**Files:**
- Modify: [src/components/FeatureLibrary.tsx:59](src/components/FeatureLibrary.tsx:59)

- [ ] **Step 1: Read current imports**

Look at the top of [src/components/FeatureLibrary.tsx](src/components/FeatureLibrary.tsx) — the existing imports.

- [ ] **Step 2: Add factory import**

Add to the existing import block:
```typescript
import { queryKeys } from '../lib/queryKeys';
```

- [ ] **Step 3: Replace the query key (line 59)**

```typescript
queryKey: queryKeys.shared.features(),
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

## Task 3.5: Add contract test (Model: haiku)

**Files:**
- Create: `tests/contract/approvals-features-querykeys.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('Phase 3 factory entries', () => {
  it('admin.approvals matches legacy inline literal', () => {
    expect(queryKeys.admin.approvals('ws-1')).toEqual(['admin-approvals', 'ws-1']);
  });

  it('shared.features matches legacy inline literal', () => {
    expect(queryKeys.shared.features()).toEqual(['features']);
  });
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run tests/contract/approvals-features-querykeys.test.ts
```
Expected: PASS.

## Task 3.6: Verification + commit (Model: sonnet)

- [ ] **Step 1: Full suite**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

- [ ] **Step 2: Manual smoke test**

```bash
npm run dev:all
```
1. Open admin panel, navigate to a workspace with a tool that uses `PendingApprovals` (SeoEditor or similar)
2. Approve or reject a batch from the client side (use a second browser / incognito)
3. Confirm the admin `PendingApprovals` list updates without refresh — the centralized `useWsInvalidation` should drive this now

- [ ] **Step 3: Commit + PR**

```bash
git add src/lib/queryKeys.ts src/hooks/useWsInvalidation.ts src/components/PendingApprovals.tsx src/components/FeatureLibrary.tsx tests/contract/approvals-features-querykeys.test.ts
git commit -m "$(cat <<'EOF'
refactor(approvals): centralize PendingApprovals WS handling + FeatureLibrary migration

Adds admin.approvals and shared.features factory entries. Migrates
PendingApprovals off a local useWorkspaceEvents subscription — the
centralized useWsInvalidation now drives admin approval cache busts
in addition to the existing client-side invalidation. FeatureLibrary
moves off ['features'] onto the factory.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

# Phase 4 — Brand Engine tabs (17 inline literals)

**PR title:** `refactor(brand-engine): route VoiceTab / IdentityTab / DiscoveryTab / CopyIntelligenceManager keys through factory`

## Task 4.1: Add brand engine factory entries (Model: haiku)

**Files:**
- Modify: [src/lib/queryKeys.ts](src/lib/queryKeys.ts)

- [ ] **Step 1: Extend the "Brand Engine — Brandscripts" block (line 68–70)**

After the existing `brandscripts` / `brandscriptTemplates` entries, add:

```typescript
    // Brand Engine — Voice & Identity
    voiceProfile: (wsId: string) => ['admin-voice-profile', wsId] as const,
    brandIdentity: (wsId: string) => ['admin-brand-identity', wsId] as const,

    // Brand Engine — Discovery
    discoverySources: (wsId: string) => ['admin-discovery-sources', wsId] as const,
    discoveryExtractions: (wsId: string, sourceId: string) => ['admin-discovery-extractions', wsId, sourceId] as const,
    discoveryExtractionsAll: (wsId: string) => ['admin-discovery-extractions', wsId] as const,
```

Note: `copyIntelligence` and `copyPromotable` already exist from Phase 1 — `CopyIntelligenceManager.tsx` reuses them.

- [ ] **Step 2: Typecheck + contract test**

Add to `tests/contract/brand-engine-querykeys.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('brand engine factory entries', () => {
  it('voiceProfile key matches legacy literal', () => {
    expect(queryKeys.admin.voiceProfile('ws-1')).toEqual(['admin-voice-profile', 'ws-1']);
  });
  it('brandIdentity key matches legacy literal', () => {
    expect(queryKeys.admin.brandIdentity('ws-1')).toEqual(['admin-brand-identity', 'ws-1']);
  });
  it('discoveryExtractionsAll is a prefix of discoveryExtractions', () => {
    expect(queryKeys.admin.discoveryExtractions('ws-1', 'src-1').slice(0, 2))
      .toEqual(queryKeys.admin.discoveryExtractionsAll('ws-1'));
  });
  it('discoverySources matches legacy literal', () => {
    expect(queryKeys.admin.discoverySources('ws-1')).toEqual(['admin-discovery-sources', 'ws-1']);
  });
});
```

```bash
npm run typecheck && npx vitest run tests/contract/brand-engine-querykeys.test.ts
```
Expected: PASS.

## Task 4.2: Migrate VoiceTab.tsx (Model: haiku)

**Files:**
- Modify: [src/components/brand/VoiceTab.tsx:993, 999, 1004](src/components/brand/VoiceTab.tsx:993)

- [ ] **Step 1: Add factory import to existing import block**

```typescript
import { queryKeys } from '../../lib/queryKeys';
```

- [ ] **Step 2: Replace all 3 occurrences**

```typescript
// Line 993 (useQuery):
queryKey: queryKeys.admin.voiceProfile(workspaceId),

// Line 999 (mutation onSuccess):
queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) });

// Line 1004:
queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) });
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

## Task 4.3: Migrate IdentityTab.tsx (Model: haiku)

**Files:**
- Modify: [src/components/brand/IdentityTab.tsx:271, 277, 282, 355](src/components/brand/IdentityTab.tsx:271)

- [ ] **Step 1: Add factory import**

```typescript
import { queryKeys } from '../../lib/queryKeys';
```

- [ ] **Step 2: Replace all 4 occurrences** with `queryKeys.admin.brandIdentity(workspaceId)`.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

## Task 4.4: Migrate DiscoveryTab.tsx (Model: haiku)

**Files:**
- Modify: [src/components/brand/DiscoveryTab.tsx](src/components/brand/DiscoveryTab.tsx)

- [ ] **Step 1: Add factory import**

```typescript
import { queryKeys } from '../../lib/queryKeys';
```

- [ ] **Step 2: Replace all 7 occurrences**

```typescript
// Line 197 (useQuery keyed per source):
queryKey: queryKeys.admin.discoveryExtractions(workspaceId, source.id),

// Line 205 (mutation — only wsId, use All):
queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoveryExtractionsAll(workspaceId) });

// Line 677:
queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoverySources(workspaceId) });

// Line 678:
queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoveryExtractionsAll(workspaceId) });

// Line 791 (useQuery — no sourceId):
queryKey: queryKeys.admin.discoverySources(workspaceId),

// Lines 798–799:
queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoverySources(workspaceId) });
queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoveryExtractionsAll(workspaceId) });
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

## Task 4.5: Migrate CopyIntelligenceManager.tsx (Model: haiku)

**Files:**
- Modify: [src/components/brand/CopyIntelligenceManager.tsx:128-129](src/components/brand/CopyIntelligenceManager.tsx:128)

- [ ] **Step 1: Add factory import**

```typescript
import { queryKeys } from '../../lib/queryKeys';
```

- [ ] **Step 2: Replace the 2 invalidations**

```typescript
// Line 128:
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(workspaceId) });
// Line 129:
queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(workspaceId) });
```

These reuse the Phase 1 factory entries.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

## Task 4.6: Full suite + commit (Model: sonnet)

- [ ] **Step 1: Run**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/queryKeys.ts src/components/brand/VoiceTab.tsx src/components/brand/IdentityTab.tsx src/components/brand/DiscoveryTab.tsx src/components/brand/CopyIntelligenceManager.tsx tests/contract/brand-engine-querykeys.test.ts
git commit -m "$(cat <<'EOF'
refactor(brand-engine): route Voice/Identity/Discovery/CopyIntelligence keys through factory

Adds voiceProfile, brandIdentity, discoverySources, and
discoveryExtractions(+All) factory entries; migrates 17 inline
literals across the four brand engine components.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

# Phase 5 — ClientCopyReview (8 inline literals, client-side)

**PR title:** `refactor(client-copy-review): route query keys through factory`

## Task 5.1: Add client copy factory entries (Model: haiku)

**Files:**
- Modify: [src/lib/queryKeys.ts](src/lib/queryKeys.ts)

- [ ] **Step 1: Add entries under the `client:` section**

After the existing `intelligence` entry in `client:` (around line 137):

```typescript
    // Client Copy Review
    copyEntries: (wsId: string) => ['client-copy-entries', wsId] as const,
    copySections: (wsId: string, entryId: string) => ['client-copy-sections', wsId, entryId] as const,
    copySectionsAll: (wsId: string) => ['client-copy-sections', wsId] as const,
```

- [ ] **Step 2: Add contract test**

`tests/contract/client-copy-querykeys.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('client copy factory entries', () => {
  it('keys match legacy literals', () => {
    expect(queryKeys.client.copyEntries('ws-1')).toEqual(['client-copy-entries', 'ws-1']);
    expect(queryKeys.client.copySections('ws-1', 'entry-1')).toEqual(['client-copy-sections', 'ws-1', 'entry-1']);
    expect(queryKeys.client.copySectionsAll('ws-1')).toEqual(['client-copy-sections', 'ws-1']);
  });
  it('copySectionsAll is a prefix of copySections', () => {
    expect(queryKeys.client.copySections('ws-1', 'entry-1').slice(0, 2))
      .toEqual(queryKeys.client.copySectionsAll('ws-1'));
  });
});
```

```bash
npx vitest run tests/contract/client-copy-querykeys.test.ts
```

## Task 5.2: Migrate ClientCopyReview.tsx (Model: haiku)

**Files:**
- Modify: [src/components/client/ClientCopyReview.tsx](src/components/client/ClientCopyReview.tsx)

- [ ] **Step 1: Add factory import**

```typescript
import { queryKeys } from '../../lib/queryKeys';
```

- [ ] **Step 2: Replace all 8 occurrences**

```typescript
// Line 135:
queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntries(workspaceId) });
// Line 136 (only wsId in the original — use *All):
queryClient.invalidateQueries({ queryKey: queryKeys.client.copySectionsAll(workspaceId) });

// Line 149 (useQuery):
queryKey: queryKeys.client.copyEntries(workspaceId),

// Line 333 (useQuery with entryId):
queryKey: queryKeys.client.copySections(workspaceId, entryId),

// Lines 347–348:
queryClient.invalidateQueries({ queryKey: queryKeys.client.copySections(workspaceId, entryId) });
queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntries(workspaceId) });

// Lines 364–365: same as 347–348.
```

**Important — re-read lines 135–136 before editing.** If the original uses `['client-copy-sections', workspaceId]` (2 elements, no entryId), use `copySectionsAll`. If it passes `entryId`, use `copySections`. Verify by running:

```bash
grep -n "client-copy-sections" src/components/client/ClientCopyReview.tsx
```

Expected output lists the keys with their exact shape — match each literal to the correct factory variant.

- [ ] **Step 3: Typecheck + test**

```bash
npm run typecheck && npx vitest run
```

## Task 5.3: Full suite + commit (Model: sonnet)

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
git add src/lib/queryKeys.ts src/components/client/ClientCopyReview.tsx tests/contract/client-copy-querykeys.test.ts
git commit -m "$(cat <<'EOF'
refactor(client-copy-review): route query keys through factory

Adds client.copyEntries, client.copySections(+All) entries; migrates
8 inline literals in ClientCopyReview onto the factory.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

# Phase 6 — Remaining low-touch components (10 inline literals)

**PR title:** `refactor(query-keys): migrate final components onto factory + delete redundant AnomalyAlerts WS handler`

## Task 6.1: Add final factory entry (Model: haiku)

**Files:**
- Modify: [src/lib/queryKeys.ts](src/lib/queryKeys.ts)

- [ ] **Step 1: Add `rewritePages` under admin**

Near the SEO entries (around line 55, after `seoSuggestions`):

```typescript
    rewritePages: (wsId: string) => ['admin-rewrite-pages', wsId] as const,
```

All other keys in Phase 6 already have factory entries:
- `anomaly-alerts` → `queryKeys.admin.anomalyAlerts` (line 57)
- `admin-posts` → `queryKeys.admin.posts` (line 35)
- `admin-post` → `queryKeys.admin.post` (line 36)
- `admin-post-versions` → `queryKeys.admin.postVersions` (line 37)
- `admin-requests` → `queryKeys.admin.requests` (line 34)

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

## Task 6.2: Migrate AnomalyAlerts.tsx (DELETE local WS handler) (Model: sonnet)

**Files:**
- Modify: [src/components/AnomalyAlerts.tsx](src/components/AnomalyAlerts.tsx)

- [ ] **Step 1: Update imports**

Final import block:
```typescript
import { useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, X, Check, RefreshCw, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useAnomalyAlerts } from '../hooks/admin';
import { post } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
```

Remove `useWorkspaceEvents` — the centralized `useWsInvalidation` already handles `ANOMALIES_UPDATE` (see [src/hooks/useWsInvalidation.ts:64](src/hooks/useWsInvalidation.ts:64)).

- [ ] **Step 2: Delete the local useWorkspaceEvents block (lines 66–70)**

Remove entirely:
```typescript
// DELETE THIS:
useWorkspaceEvents(workspaceId, {
  'anomalies:update': () => {
    queryClient.invalidateQueries({ queryKey: ['anomaly-alerts', workspaceId] });
  },
});
```

- [ ] **Step 3: Replace the 3 remaining invalidations (lines 75, 82, 87)**

```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(workspaceId) });
```

All three lines become the same call.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

## Task 6.3: Migrate remaining single-touch files (Model: haiku)

**Files:**
- Modify: [src/components/ContentBriefs.tsx](src/components/ContentBriefs.tsx)
- Modify: [src/components/ContentManager.tsx](src/components/ContentManager.tsx)
- Modify: [src/components/PostEditor.tsx](src/components/PostEditor.tsx)
- Modify: [src/components/PageRewriteChat.tsx](src/components/PageRewriteChat.tsx)

- [ ] **Step 1: ContentBriefs.tsx — add factory import, replace 2 keys**

```typescript
import { queryKeys } from '../lib/queryKeys';
```

```typescript
// Line 294:
queryClient.invalidateQueries({ queryKey: queryKeys.admin.requests(workspaceId) });
// Line 432:
onDelete={() => { queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) }); setActivePostId(null); }}
```

- [ ] **Step 2: ContentManager.tsx — add factory import, replace 1 key**

```typescript
import { queryKeys } from '../lib/queryKeys';
```

```typescript
// Line 58:
const invalidatePosts = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
```

- [ ] **Step 3: PostEditor.tsx — add factory import, replace 2 keys**

```typescript
import { queryKeys } from '../lib/queryKeys';
```

```typescript
// Line 111:
const invalidatePost = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.post(workspaceId, postId) });
// Line 112:
const invalidateVersions = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.postVersions(workspaceId, postId) });
```

- [ ] **Step 4: PageRewriteChat.tsx — add factory import, replace 1 key**

```typescript
import { queryKeys } from '../lib/queryKeys';
```

```typescript
// Line 93:
queryKey: queryKeys.admin.rewritePages(workspaceId),
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

## Task 6.4: Final verification — zero inline literals remain (Model: sonnet)

- [ ] **Step 1: Grep for survivors**

```bash
grep -rn "queryKey: \['" src/
```
Expected: zero matches. (Any match that remains is either a JSDoc comment or must be explicitly suppressed with `// querykey-ok`.)

- [ ] **Step 2: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```
Expected: zero violations for rule `Inline React Query string key (use queryKeys.*)`.

- [ ] **Step 3: Run full suite**

```bash
npm run typecheck && npx vite build && npx vitest run
```
Expected: all PASS. No cache-behavior regressions.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev:all
```

Exercise the migrated flows in the browser:
- Copy pipeline: generate copy for an entry, confirm WS events update the UI
- Diagnostics: run one, confirm insight feed refreshes (Phase 2 bug fix)
- Admin approvals: client approves → admin view updates
- Brand voice / identity / discovery: save changes, confirm UI refreshes
- Content briefs / posts: create/edit, confirm list refreshes
- Anomaly alerts: trigger a scan, confirm list updates via WS

Document results in the PR description (screenshots or text confirmation).

- [ ] **Step 5: Commit + PR**

```bash
git add src/lib/queryKeys.ts src/components/AnomalyAlerts.tsx src/components/ContentBriefs.tsx src/components/ContentManager.tsx src/components/PostEditor.tsx src/components/PageRewriteChat.tsx
git commit -m "$(cat <<'EOF'
refactor(query-keys): final factory migration + centralize AnomalyAlerts WS

Migrates the last 10 inline literals (AnomalyAlerts, ContentBriefs,
ContentManager, PostEditor, PageRewriteChat) onto the centralized
queryKeys.* factory. Deletes the redundant local useWorkspaceEvents
handler in AnomalyAlerts — useWsInvalidation already handles
ANOMALIES_UPDATE. Adds admin.rewritePages factory entry.

Closes the query-key migration: pr-check rule 'Inline React Query
string key' now reports zero violations repo-wide.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Final acceptance criteria (post-Phase 6)

- [ ] `grep -rn "queryKey: \['" src/` returns zero hits (or only JSDoc / `// querykey-ok` suppressions)
- [ ] `npx tsx scripts/pr-check.ts` — `Inline React Query string key` rule reports 0 violations
- [ ] `npm run typecheck && npx vite build && npx vitest run` — all green
- [ ] Diagnostic completion manually verified to refresh insight feed without a page reload (Phase 2 bug fix)
- [ ] All four contract test files exist under `tests/contract/` and pass
- [ ] `useCopyPipelineEvents` and `useDiagnosticEvents` are deleted; no call sites remain
- [ ] `useWsInvalidation` now handles: copy section/metadata/batch/intelligence events, diagnostic complete/failed events, and admin approval invalidation

## Follow-up considerations (out of scope for this plan)

- `useGA4Base.ts` builds keys dynamically via `mk(metric)`. Consider a future refactor to delegate to `queryKeys.admin.ga4(wsId, metric, days)` / `queryKeys.client.ga4(...)` directly — but only if the shape stays compatible. The current pattern works correctly; no change needed now.
- Several phase-level `*All` prefix helpers (`copyStatusAll`, `copySectionsAll`, etc.) are now duplicated between admin and client namespaces. If more cross-namespace sharing emerges, consider a helper `prefixOf(key)` rather than hand-maintaining pairs.
