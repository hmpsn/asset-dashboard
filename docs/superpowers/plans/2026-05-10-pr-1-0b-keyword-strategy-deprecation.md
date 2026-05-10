# PR 1.0b — Deprecate `keyword_strategy` Client Action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `keyword_strategy` from `ClientActionSourceType`, archive any pending rows in the DB, and strip the creation UI button from `KeywordStrategy.tsx`. The SEO Strategy page and workspace-level `keyword_strategy` column are untouched.

**Architecture:** Pure deletion / archival PR. Migration archives pending rows; type union removal + 3 file patches + 4 test fixture updates complete the sweep. No new routes, no UI additions.

**Tech Stack:** TypeScript / React 19 / Express / SQLite (better-sqlite3) / Vitest

---

## File Map

### Create (1)
- `server/db/migrations/092-archive-keyword-strategy-actions.sql`

### Modify — Server + Shared (3)
- `shared/types/client-actions.ts` — remove `'keyword_strategy'` from union + 3 payload types
- `server/client-actions.ts:24,97` — remove from validSources + fix fallback default
- `server/routes/client-actions.ts:22` — remove from sourceTypeSchema z.enum

### Modify — Frontend (2)
- `src/components/KeywordStrategy.tsx` — remove sendStrategyToClient + state + button + dead imports
- `src/components/client/ClientActionDetailModal.tsx` — remove KeywordStrategyRenderer + case + import

### Modify — Tests (4)
- `tests/integration/client-actions-routes.test.ts:141,329`
- `tests/integration/client-actions-broadcasts.test.ts:127,137`
- `tests/contract/intelligence-slice-population.test.ts:234`
- `tests/unit/row-mapper-completeness.test.ts:190`

---

## Task 1: Write migration + verify tests fail expectedly

**Files:**
- Create: `server/db/migrations/092-archive-keyword-strategy-actions.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 092-archive-keyword-strategy-actions.sql
-- Archive all pending keyword_strategy client_actions.
-- The keyword_strategy source type is retired per IA redesign PR 1.0b.
-- Rows are preserved as archived (not deleted) for audit trail.
UPDATE client_actions
SET status = 'archived', updated_at = datetime('now')
WHERE source_type = 'keyword_strategy' AND status = 'pending';
```

- [ ] **Step 2: Commit migration**

```bash
git add server/db/migrations/092-archive-keyword-strategy-actions.sql
git commit -m "db: migration 092 — archive pending keyword_strategy client_actions"
```

---

## Task 2: Remove keyword_strategy from type system, server, frontend, and tests

**Files:**
- Modify: `shared/types/client-actions.ts`
- Modify: `server/client-actions.ts`
- Modify: `server/routes/client-actions.ts`
- Modify: `src/components/KeywordStrategy.tsx`
- Modify: `src/components/client/ClientActionDetailModal.tsx`
- Modify: `tests/integration/client-actions-routes.test.ts`
- Modify: `tests/integration/client-actions-broadcasts.test.ts`
- Modify: `tests/contract/intelligence-slice-population.test.ts`
- Modify: `tests/unit/row-mapper-completeness.test.ts`

- [ ] **Step 1: Update `shared/types/client-actions.ts`**

Remove `'keyword_strategy'` from union (line 4) and the three payload types (lines 60–74).

BEFORE:
```typescript
export type ClientActionSourceType =
  | 'aeo_change'
  | 'internal_link'
  | 'keyword_strategy'
  | 'redirect_proposal'
  | 'content_decay';
```

AFTER:
```typescript
export type ClientActionSourceType =
  | 'aeo_change'
  | 'internal_link'
  | 'redirect_proposal'
  | 'content_decay';
```

Also remove lines 60–74 entirely:
```typescript
export interface KeywordStrategyPage {
  page: string;
  keyword: string;
  currentPosition?: number;
}
export interface KeywordStrategyQuickWin {
  keyword: string;
  opportunity: string;
}
export interface KeywordStrategyPayload {
  mappedPages?: KeywordStrategyPage[];
  quickWins?: KeywordStrategyQuickWin[];
  contentGaps?: string[];
  opportunities?: string[];
}
```

- [ ] **Step 2: Update `server/client-actions.ts`**

Line 24 — remove `'keyword_strategy'` from `validSources`:
```typescript
const validSources: ClientActionSourceType[] = ['aeo_change', 'internal_link', 'redirect_proposal', 'content_decay'];
```

Line 97 — change fallback from `'keyword_strategy'` to `'aeo_change'`:
```typescript
function rowToAction(row: ClientActionRow): ClientAction {
  const sourceType = validSources.includes(row.source_type as ClientActionSourceType)
    ? row.source_type as ClientActionSourceType
    : 'aeo_change';  // fallback for any legacy rows with retired source types
```

- [ ] **Step 3: Update `server/routes/client-actions.ts`**

Line 22 — remove `'keyword_strategy'` from sourceTypeSchema:
```typescript
const sourceTypeSchema = z.enum(['aeo_change', 'internal_link', 'redirect_proposal', 'content_decay']);
```

- [ ] **Step 4: Update `src/components/KeywordStrategy.tsx`**

Remove `sendingToClient` and `sentToClient` state (lines 85–86):
```typescript
// DELETE these two lines:
const [sendingToClient, setSendingToClient] = useState(false);
const [sentToClient, setSentToClient] = useState(false);
```

Remove `sendStrategyToClient` function (lines 250–280):
```typescript
// DELETE this entire function block:
const sendStrategyToClient = async () => {
  if (!strategy) return;
  setSendingToClient(true);
  setError(null);
  try {
    await clientActions.create(workspaceId, {
      sourceType: 'keyword_strategy',
      ...
    });
    setSentToClient(true);
  } catch (err) {
    console.error('KeywordStrategy operation failed:', err);
    setError('Failed to send keyword strategy to client');
  } finally {
    setSendingToClient(false);
  }
};
```

Remove "Send to Client" button block (lines 330–339):
```typescript
// DELETE this block:
{isRealStrategy && (
  <button
    onClick={sendStrategyToClient}
    disabled={sendingToClient || sentToClient}
    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)] transition-colors disabled:opacity-50 t-caption font-medium"
  >
    <Icon as={sentToClient ? Check : Send} size="sm" className={sentToClient ? 'text-emerald-400' : undefined} />
    {sendingToClient ? 'Sending...' : sentToClient ? 'Sent' : 'Send to Client'}
  </button>
)}
```

Remove the `clientActions` import (line 25) — now unused:
```typescript
// DELETE this line:
import { clientActions } from '../api/clientActions';
```

Remove `Send` from lucide imports (line 7) — `Check` is still used at line 731:
```typescript
// BEFORE:
  Eye, MousePointerClick, Trophy, AlertTriangle, Plus, Check, Send,
// AFTER:
  Eye, MousePointerClick, Trophy, AlertTriangle, Plus, Check,
```

- [ ] **Step 5: Update `src/components/client/ClientActionDetailModal.tsx`**

Remove `KeywordStrategyPayload` from imports (line 19):
```typescript
// BEFORE:
import type {
  ClientAction,
  InternalLinkPayload,
  InternalLinkItem,
  RedirectProposalPayload,
  RedirectItem,
  KeywordStrategyPayload,
  AeoChangePayload,
  AeoChangeDiff,
} from '../../../shared/types/client-actions';

// AFTER:
import type {
  ClientAction,
  InternalLinkPayload,
  InternalLinkItem,
  RedirectProposalPayload,
  RedirectItem,
  AeoChangePayload,
  AeoChangeDiff,
} from '../../../shared/types/client-actions';
```

Remove `KeywordStrategyRenderer` inline component (lines 126–end of that function, approximately 55 lines). Delete from:
```typescript
function KeywordStrategyRenderer({ payload }: { payload: KeywordStrategyPayload }) {
```
to the closing `}` of the function (before `function AeoChangeRenderer`).

Remove `case 'keyword_strategy':` from `renderPayload()` switch (line 284):
```typescript
// DELETE:
      case 'keyword_strategy':
        return <KeywordStrategyRenderer payload={p as unknown as KeywordStrategyPayload} />;
```

Update the JSDoc comment at the top of the file:
```typescript
// BEFORE:
 * Source types with modals: internal_link, redirect_proposal,
 * keyword_strategy, aeo_change.

// AFTER:
 * Source types with modals: internal_link, redirect_proposal, aeo_change.
```

- [ ] **Step 6: Update test fixtures — replace `'keyword_strategy'` with `'aeo_change'`**

`tests/integration/client-actions-routes.test.ts` lines 141, 329:
- Change `sourceType: 'keyword_strategy'` → `sourceType: 'aeo_change'`

`tests/integration/client-actions-broadcasts.test.ts` lines 127, 137:
- Change `sourceType: 'keyword_strategy'` → `sourceType: 'aeo_change'`

`tests/contract/intelligence-slice-population.test.ts` line 234:
- Change `sourceType: 'keyword_strategy'` → `sourceType: 'aeo_change'`

`tests/unit/row-mapper-completeness.test.ts` line 190:
- Remove `'keyword_strategy'` from the source type enum validation list

- [ ] **Step 7: Run tests to confirm green**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/keyword-strategy-deprecation
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: typecheck zero errors, build clean, all tests pass, pr-check 0 errors.

- [ ] **Step 8: Commit all changes**

```bash
git add shared/types/client-actions.ts server/client-actions.ts server/routes/client-actions.ts \
  src/components/KeywordStrategy.tsx src/components/client/ClientActionDetailModal.tsx \
  tests/integration/client-actions-routes.test.ts tests/integration/client-actions-broadcasts.test.ts \
  tests/contract/intelligence-slice-population.test.ts tests/unit/row-mapper-completeness.test.ts
git commit -m "feat: remove keyword_strategy from ClientActionSourceType

- Drop 'keyword_strategy' from ClientActionSourceType union and validSources
- Remove KeywordStrategyPayload/Page/QuickWin types (only used by client_action modal)
- Remove sendStrategyToClient() function and 'Send to Client' button from KeywordStrategy.tsx
- Remove KeywordStrategyRenderer and case handler from ClientActionDetailModal.tsx
- Fix rowToAction() fallback default: 'keyword_strategy' → 'aeo_change'
- Update 4 test files: replace keyword_strategy fixtures with aeo_change"
```
