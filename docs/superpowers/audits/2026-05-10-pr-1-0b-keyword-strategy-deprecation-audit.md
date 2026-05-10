# PR 1.0b — keyword_strategy Deprecation Pre-Plan Audit

**Date:** 2026-05-10
**Spec:** `docs/superpowers/specs/2026-05-10-pr-1-0b-keyword-strategy-deprecation-design.md`
**Worktree:** `.claude/worktrees/keyword-strategy-deprecation/` (`feat/keyword-strategy-deprecation`)
**Total findings:** 10 files to modify, 1 to create

---

## Findings

### FILE TO CREATE (1)

| File | Purpose |
|------|---------|
| `server/db/migrations/092-archive-keyword-strategy-actions.sql` | Archive pending `keyword_strategy` rows → status='archived' |

Migration SQL:
```sql
UPDATE client_actions
SET status = 'archived', updated_at = datetime('now')
WHERE source_type = 'keyword_strategy' AND status = 'pending';
```
No rows are deleted. `'archived'` is already a valid `ClientActionStatus`. Migration runner tracks in `_migrations` table — one-shot.

---

### FILES TO MODIFY — Shared Types (1)

| File | Lines | Change |
|------|-------|--------|
| `shared/types/client-actions.ts` | 4, 60–74 | Remove `'keyword_strategy'` from `ClientActionSourceType` union (line 4); remove `KeywordStrategyPage` (lines 60–64), `KeywordStrategyQuickWin` (lines 65–68), `KeywordStrategyPayload` (lines 69–74) interfaces |

`KeywordStrategyPayload` is imported ONLY by `ClientActionDetailModal.tsx:19` — safe to remove from shared types in same commit.

---

### FILES TO MODIFY — Server (2)

| File | Lines | Change |
|------|-------|--------|
| `server/client-actions.ts` | 24, 97 | Remove `'keyword_strategy'` from `validSources` array (line 24); replace fallback default on line 97 from `'keyword_strategy'` to `'aeo_change'` (need a valid fallback for any legacy rows that don't match) |
| `server/routes/client-actions.ts` | 22 | Remove `'keyword_strategy'` from `z.enum([...])` in `sourceTypeSchema` |

**Critical note on `server/client-actions.ts:97`:** The current code has:
```typescript
? row.source_type as ClientActionSourceType
: 'keyword_strategy'  // ← fallback for invalid source types
```
After removal, `'keyword_strategy'` rows won't match `validSources`, so they'll fall through to the fallback. Replace fallback with `'aeo_change'` (generic, least wrong). Any legacy rows (pre-migration, with `status != 'pending'`) will safely render as `aeo_change` actions in the unlikely case they're ever fetched.

---

### FILES TO MODIFY — Frontend (2)

| File | Lines | Change |
|------|-------|--------|
| `src/components/KeywordStrategy.tsx` | ~250–280 | Remove `sendStrategyToClient()` function and the button/UI element that calls it. Component itself remains. |
| `src/components/client/ClientActionDetailModal.tsx` | 19, 126, 279–287 | Remove `KeywordStrategyPayload` import (line 19); remove `KeywordStrategyRenderer` inline component (line 126); remove `case 'keyword_strategy':` handler (lines 284–286) |

---

### FILES TO MODIFY — Tests (4)

| File | Lines | Change |
|------|-------|--------|
| `tests/integration/client-actions-routes.test.ts` | 141, 329 | Replace `sourceType: 'keyword_strategy'` with `sourceType: 'aeo_change'` in test fixtures |
| `tests/integration/client-actions-broadcasts.test.ts` | 127, 137 | Replace `sourceType: 'keyword_strategy'` with `sourceType: 'aeo_change'` in test fixtures |
| `tests/contract/intelligence-slice-population.test.ts` | 234 | Replace `sourceType: 'keyword_strategy'` with `sourceType: 'aeo_change'` |
| `tests/unit/row-mapper-completeness.test.ts` | 190 | Remove `'keyword_strategy'` from the source type enum validation list |

Tests that reference `keyword_strategy` as a workspace JSON column (strategy-seed.ts, keyword-strategy-follow-ons.test.ts, etc.) are NOT in scope — they test unrelated logic.

---

## DO NOT TOUCH

These files use `keyword_strategy` as a workspace-level SQLite column name storing strategy JSON data — not as a `ClientActionSourceType`:

- `server/workspaces.ts`
- `server/content-gaps.ts`
- `server/cannibalization-issues.ts`
- `server/keyword-gaps.ts`
- `server/topic-clusters.ts`
- `server/page-keywords.ts`
- `server/quick-wins.ts`
- `server/intelligence/seo-context-slice.ts`
- `server/keyword-strategy-follow-ons.ts`
- `server/db/migrate-json.ts`
- `tests/fixtures/strategy-seed.ts`
- All `tests/unit/keyword-strategy-*.test.ts`
- All `tests/integration/keyword-strategy-*.test.ts`
- All `tests/component/KeywordStrategy*.test.tsx`

---

## Exhaustiveness Risk

`ClientActionDetailModal.tsx` has a `switch (action.sourceType)` at line 279. With 5 source types today (aeo_change, internal_link, keyword_strategy, redirect_proposal, content_decay), removing keyword_strategy leaves 4. The switch uses `default:` so TypeScript won't error. No exhaustiveness issue.

---

## FEATURE_AUDIT.md

13 mentions of `KeywordStrategy` — all refer to the feature/component, not the ClientActionSourceType. No entry specifically for `keyword_strategy` as a client action. **No update needed** (the feature itself is not retired, only the "Send to client" pathway is removed).

---

## Parallelization Strategy

Small PR — 10 files, single commit batch is fine. No shared contracts need pre-commit because:
- Type removal in `shared/types/client-actions.ts` must commit first (or simultaneously) before any consumer file
- Actually: all changes can ship in a single commit since all files are within one developer's exclusive ownership

### Phase 0 — Migration (Haiku)
1. Write `092-archive-keyword-strategy-actions.sql` + commit

### Phase 1 — Type + server + frontend + tests (single Sonnet task)
2. Shared types → server → frontend → tests → docs → all in one coordinated commit
   (Small enough that a single well-briefed Sonnet agent can handle all 10 files cleanly)

---

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Migration SQL | Haiku | Pure SQL, trivial |
| Core removal (types + server + frontend + tests) | Sonnet | Multi-file coordination, needs to verify import cleanup |
