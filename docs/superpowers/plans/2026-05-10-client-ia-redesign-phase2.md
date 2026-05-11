# Client IA Redesign — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Decisions presentation across `client_actions` and `approval_batches` into a single `<DecisionCard>` + `<DecisionDetailModal>` component family, and correct the InboxTab section routing so Decisions/Reviews/Conversations contain the items the spec intends.

**Architecture:** Phase 1 (complete) created the filter system and 3-section structure but left section content routing partially misaligned: approval_batches land in the "reviews" filter, content briefs land in "conversations," and requests sit inside the "decisions" section. Phase 2 corrects all three routing errors and introduces a unified card presenter so both `client_actions` and `approval_batches` render through the same component family. A `NormalizedDecision` shape bridges the two data sources; adapters translate each type into it. PR 2.2 adds at-scale features (grouping, search, type breakdown) for large batches (50+ items).

**Tech Stack:** React 19, TypeScript strict, Vitest + @testing-library/react, Tailwind v4 CSS tokens, existing `shared/types/`, `src/components/client/`, `src/lib/` patterns.

**Spec:** `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md` §4.1, §3.5.

---

## Current section routing (broken — Phase 2 fixes this)

| Filter chip | Shows now | Should show (spec §3) |
|-------------|-----------|----------------------|
| `decisions` | client_actions + content_plan + **requests** | client_actions + **approval_batches** + content_plan |
| `reviews` | **approval_batches** + schema_plan | content briefs/posts + copy + schema_plan |
| `conversations` | **content briefs/posts + copy** | **requests** |

---

## Pre-requisites

- [ ] Spec committed: `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md`
- [ ] Audit reviewed: `docs/superpowers/audits/2026-05-09-client-ia-redesign-audit.md`
- [ ] Phase 1 PRs (1.0a–1.5) merged to staging and green
- [ ] Verify `PATCH /api/public/approvals/:wsId/:batchId/approve` endpoint exists (Task 6 calls it). Run: `grep -r "approvals.*approve" server/routes/` to confirm.
- [ ] Shared types (Tasks 1+2) committed before parallel batch (Tasks 3+4+5) dispatched

---

## File map

| File | Action | Task | Purpose |
|------|--------|------|---------|
| `shared/types/decision.ts` | Create | T2 | `NormalizedDecision` interface |
| `shared/types/client-actions.ts` | Modify | T1 | Add `rationale?` / `effort?` / `priority?` to `AeoChangeDiff` |
| `src/components/AeoReview.tsx` | Modify | T1 | Populate enriched fields at send-time (audit §2.5) |
| `tests/integration/client-actions-routes.test.ts` | Modify | T1 | Update aeo_change fixture with enriched fields |
| `src/lib/decision-adapters.ts` | Create | T3 | `normalizeClientAction()`, `normalizeApprovalBatch()`, `badgeForBatch()` |
| `tests/unit/decision-adapters.test.ts` | Create | T3 | Pure-function unit tests for both adapters |
| `src/components/client/DecisionCard.tsx` | Create | T4 | Inbox entry-point card; two modes: bulk (→ modal) and single-action (inline) |
| `tests/unit/DecisionCard.test.tsx` | Create | T4 | Component render tests for both card modes |
| `src/components/client/DecisionDetailModal.tsx` | Create | T5 | Full-screen trust-first approval modal |
| `tests/unit/DecisionDetailModal.test.tsx` | Create | T5 | Modal render + per-item flagging + CTA label tests |
| `src/components/client/InboxTab.tsx` | Modify | T6 | Fix section routing; wire DecisionCard + DecisionDetailModal |

---

## Task Dependencies

```
Parallel (no dependencies, commit both before next batch):
  Task 1 (AeoChangeDiff enrichment)  ∥  Task 2 (NormalizedDecision type)

↓ COMMIT Tasks 1+2 ↓

Parallel after Tasks 1+2 committed (no shared files):
  Task 3 (Adapters + tests)  ∥  Task 4 (DecisionCard + tests)  ∥  Task 5 (DecisionDetailModal + tests)

↓ DIFF REVIEW CHECKPOINT after all three complete ↓

Sequential (touches InboxTab — single owner):
  Task 6 (InboxTab routing fix + wire components)
  Task 7 (Build verify + PR 2.1)

↓ PR 2.1 merged to staging ↓

Sequential (modifies files owned by Tasks 4+5):
  Task 8 (At-scale features → PR 2.2)
```

**Rules:**
- Tasks 1+2 are fully independent — different files, no cross-imports
- Tasks 3, 4, 5 each own distinct files — no overlap, safe to run concurrently
- Task 6 is the only task touching `InboxTab.tsx` — never parallelize it
- Task 8 modifies `DecisionCard.tsx` and `DecisionDetailModal.tsx` — only safe after Task 7's PR merges

---

## PR 2.1 — Presenter Unification

### Task 1: Enrich AeoChangeDiff (missed from PR 1.1) — Model: sonnet

**Owns (create or modify freely):**
- `shared/types/client-actions.ts`
- `src/components/AeoReview.tsx`
- `tests/integration/client-actions-routes.test.ts`

**Must not touch:** `shared/types/decision.ts` (Task 2 owns it)

**Files:**
- Modify: `shared/types/client-actions.ts` (AeoChangeDiff interface)
- Modify: `src/components/AeoReview.tsx` (line ~386 — populate fields at send-time)
- Modify: `tests/integration/client-actions-routes.test.ts` (aeo_change fixture)

Three optional fields (from audit §2.5). `rationale` surfaces in the Decisions modal on row expand. `effort` and `priority` are stored but hidden from the client view (spec §5.3). `AeoReview.tsx` must populate them at send-time — the fields are useless if the admin-side never writes them.

- [ ] **Step 1: Add fields to AeoChangeDiff**

Open `shared/types/client-actions.ts`. Replace the `AeoChangeDiff` interface:

```typescript
export interface AeoChangeDiff {
  page: string;
  /** Which section/question type is changing */
  section?: string;
  current: string;
  proposed: string;
  /** One-sentence rationale surfaced in the client Decisions modal on row expand. */
  rationale?: string;
  /** Internal effort estimate — stored but hidden from client view (spec §5.3). */
  effort?: 'low' | 'medium' | 'high';
  /** Per-diff priority override — hidden from client view (spec §5.3). */
  priority?: 'high' | 'medium' | 'low';
}
```

- [ ] **Step 2: Typecheck the type change**

```bash
npm run typecheck
```
Expected: no errors (fields are all optional — no downstream breakage).

- [ ] **Step 3: Wire enriched fields in AeoReview.tsx at send-time**

Open `src/components/AeoReview.tsx`. Find the `sendPageToClient` callback (around line 386) where the `AeoChangeDiff` array is constructed. Each element currently has `page`, `section`, `current`, `proposed`. Extend each diff object to include the new optional fields from the source `AeoPageChange` data:

```typescript
// Inside sendPageToClient, when building the diffs array — extend each diff:
const diffs: AeoChangeDiff[] = pendingChanges.map(change => ({
  page: change.pageUrl,
  section: change.section ?? undefined,
  current: change.currentValue,
  proposed: change.proposedValue,
  rationale: change.rationale ?? undefined,   // e.g. from the AEO analysis reasoning
  effort: change.effort ?? undefined,          // e.g. 'low' | 'medium' | 'high'
  priority: change.priority ?? undefined,      // e.g. per-question priority
}));
```

> **Note for implementer:** The exact field names on the source `AeoPageChange` object may differ from the above — check the actual type definition in `shared/types/` or wherever `AeoPageChange` is defined before wiring. If the source data doesn't carry these fields yet, leave them as `undefined` for now — the type allows it and they can be populated when the analysis pipeline is extended.

- [ ] **Step 4: Update integration test fixture**

Open `tests/integration/client-actions-routes.test.ts`. Find the `aeo_change` fixture and add the enriched fields to at least one diff entry (to confirm they round-trip through storage):

```typescript
// In the aeo_change fixture's diffs array, update one entry:
{
  page: '/about',
  section: 'What we do',
  current: 'We build websites',
  proposed: 'We build growth-focused websites that convert',
  rationale: 'The proposed copy is more specific and outcome-oriented.',
  effort: 'low',
  priority: 'high',
}
```

Run the integration test to confirm round-trip:
```bash
npx vitest run tests/integration/client-actions-routes.test.ts
```
Expected: all tests pass (enriched fields stored + returned correctly).

- [ ] **Step 5: Commit**

```bash
git add shared/types/client-actions.ts src/components/AeoReview.tsx tests/integration/client-actions-routes.test.ts
git commit -m "feat(types): add rationale + effort + priority to AeoChangeDiff; wire at send-time (PR 1.1 follow-up)"
```

---

### Task 2: NormalizedDecision shape — Model: haiku

**Owns (create or modify freely):**
- `shared/types/decision.ts`

**Must not touch:** `shared/types/client-actions.ts` (Task 1 owns it)

**Files:**
- Create: `shared/types/decision.ts`

- [ ] **Step 1: Create the shared type**

Create `shared/types/decision.ts`:

```typescript
/**
 * NormalizedDecision — unified shape for InboxTab Decisions section items.
 *
 * Both `client_actions` and `approval_batches` are adapted into this shape
 * by `src/lib/decision-adapters.ts`. The shape drives `<DecisionCard>` (entry-point)
 * and `<DecisionDetailModal>` (full-screen approval flow).
 *
 * Key discriminant: `isSingleAction`
 *  - true  → `content_decay`: rendered inline in the Decisions section with
 *             approve/flag-with-note buttons, no modal.
 *  - false → all other types: rendered as an entry-point card that opens
 *             `<DecisionDetailModal>` on click.
 */
export type DecisionSource = 'client_action' | 'approval_batch';

export interface NormalizedDecision {
  /** Unique display ID (prefixed: 'ca-{id}' or 'ab-{id}'). */
  id: string;
  source: DecisionSource;
  /** Original record ID from `client_actions.id` or `approval_batches.id`. */
  sourceId: string;
  title: string;
  summary: string;
  priority?: 'high' | 'medium' | 'low';
  /** Total number of changes (1 for content_decay, batch.items.length for batches). */
  itemCount: number;
  /**
   * true only for `content_decay` client_actions.
   * Inline approve/flag affordance — no full-screen modal.
   */
  isSingleAction: boolean;
  /** Short human label shown as a badge: "AEO", "SEO Editor", "Schema", etc. */
  badge: string;
  createdAt: string;
}

/** An item flagged by the client inside DecisionDetailModal. */
export interface FlaggedItem {
  itemId: string;
  note: string;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors (new file with no imports yet).

- [ ] **Step 3: Commit**

```bash
git add shared/types/decision.ts
git commit -m "feat(types): add NormalizedDecision + FlaggedItem shared types"
```

---

### Task 3: Adapter functions + tests — Model: sonnet

**Owns (create or modify freely):**
- `src/lib/decision-adapters.ts`
- `tests/unit/decision-adapters.test.ts`

**Must not touch:** `src/components/client/DecisionCard.tsx` (Task 4), `src/components/client/DecisionDetailModal.tsx` (Task 5), `src/components/client/InboxTab.tsx` (Task 6)

**Reads (do not modify):**
- `shared/types/client-actions.ts` (committed by Task 1)
- `shared/types/decision.ts` (committed by Task 2)
- `shared/types/approvals.ts` (pre-existing)

**Files:**
- Create: `src/lib/decision-adapters.ts`
- Create: `tests/unit/decision-adapters.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `tests/unit/decision-adapters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeClientAction, normalizeApprovalBatch } from '../../src/lib/decision-adapters';
import type { ClientAction } from '../../shared/types/client-actions';
import type { ApprovalBatch } from '../../shared/types/approvals';

const baseAction: ClientAction = {
  id: 'ca-1',
  workspaceId: 'ws-1',
  sourceType: 'aeo_change',
  title: 'Update AEO answers',
  summary: '3 changes proposed',
  payload: { diffs: [{page: '/about', current: 'old', proposed: 'new'}] },
  status: 'pending',
  priority: 'high',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

const baseBatch: ApprovalBatch = {
  id: 'ab-1',
  workspaceId: 'ws-1',
  siteId: 'site-1',
  name: 'SEO Editor — 5 pages',
  items: [
    { id: 'i1', pageId: 'p1', pageTitle: 'Home', pageSlug: '/', field: 'seoTitle',
      currentValue: 'Old', proposedValue: 'New', status: 'pending',
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
  ],
  status: 'pending',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('normalizeClientAction', () => {
  it('produces id prefixed with ca-', () => {
    expect(normalizeClientAction(baseAction).id).toBe('ca-ca-1');
  });

  it('sets source to client_action', () => {
    expect(normalizeClientAction(baseAction).source).toBe('client_action');
  });

  it('preserves sourceId as original action id', () => {
    expect(normalizeClientAction(baseAction).sourceId).toBe('ca-1');
  });

  it('sets isSingleAction=false for aeo_change', () => {
    expect(normalizeClientAction(baseAction).isSingleAction).toBe(false);
  });

  it('sets isSingleAction=true for content_decay', () => {
    const decayAction = { ...baseAction, sourceType: 'content_decay' as const };
    expect(normalizeClientAction(decayAction).isSingleAction).toBe(true);
  });

  it('sets badge to "AEO" for aeo_change', () => {
    expect(normalizeClientAction(baseAction).badge).toBe('AEO');
  });

  it('sets badge to "Internal Links" for internal_link', () => {
    const linkAction = { ...baseAction, sourceType: 'internal_link' as const };
    expect(normalizeClientAction(linkAction).badge).toBe('Internal Links');
  });

  it('sets itemCount=1 for content_decay', () => {
    const decayAction = { ...baseAction, sourceType: 'content_decay' as const };
    expect(normalizeClientAction(decayAction).itemCount).toBe(1);
  });

  it('sets itemCount=3 for aeo_change with 3 diffs', () => {
    const action3 = {
      ...baseAction,
      payload: { diffs: [{}, {}, {}] },
    };
    expect(normalizeClientAction(action3 as ClientAction).itemCount).toBe(3);
  });

  it('sets priority from action', () => {
    expect(normalizeClientAction(baseAction).priority).toBe('high');
  });
});

describe('normalizeApprovalBatch', () => {
  it('produces id prefixed with ab-', () => {
    expect(normalizeApprovalBatch(baseBatch).id).toBe('ab-ab-1');
  });

  it('sets source to approval_batch', () => {
    expect(normalizeApprovalBatch(baseBatch).source).toBe('approval_batch');
  });

  it('sets isSingleAction=false', () => {
    expect(normalizeApprovalBatch(baseBatch).isSingleAction).toBe(false);
  });

  it('sets itemCount from pending items', () => {
    const batch2 = {
      ...baseBatch,
      items: [
        { ...baseBatch.items[0], id: 'i1', status: 'pending' as const },
        { ...baseBatch.items[0], id: 'i2', status: 'applied' as const },
        { ...baseBatch.items[0], id: 'i3', status: 'pending' as const },
      ],
    };
    expect(normalizeApprovalBatch(batch2).itemCount).toBe(3);
  });

  it('sets badge based on batch name prefix', () => {
    expect(normalizeApprovalBatch(baseBatch).badge).toBe('SEO Editor');
  });

  it('sets badge to "Schema" for schema batches', () => {
    const schemaBatch = { ...baseBatch, name: 'Schema — 10 pages' };
    expect(normalizeApprovalBatch(schemaBatch).badge).toBe('Schema');
  });

  it('sets badge to "CMS" for CMS batches', () => {
    const cmsBatch = { ...baseBatch, name: 'CMS Editor — Blog collection' };
    expect(normalizeApprovalBatch(cmsBatch).badge).toBe('CMS');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/decision-adapters.test.ts
```
Expected: FAIL — "Cannot find module '../../src/lib/decision-adapters'"

- [ ] **Step 3: Implement the adapters**

Create `src/lib/decision-adapters.ts`:

```typescript
import type { ClientAction } from '../../shared/types/client-actions';
import type { ApprovalBatch } from '../../shared/types/approvals';
import type { NormalizedDecision } from '../../shared/types/decision';

// ── Badge labels ───────────────────────────────────────────────────────────

const CLIENT_ACTION_BADGES: Record<string, string> = {
  aeo_change:        'AEO',
  internal_link:     'Internal Links',
  redirect_proposal: 'Redirects',
  content_decay:     'Content',
  keyword_strategy:  'Keywords',   // deprecated; archived rows only
};

/**
 * Infer a short human badge from an approval_batch name.
 * Batch names are generated by admin tools: "SEO Editor — N pages",
 * "Schema — N pages", "CMS Editor — collection".
 */
export function badgeForBatch(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith('schema')) return 'Schema';
  if (lower.startsWith('cms')) return 'CMS';
  if (lower.startsWith('seo editor') || lower.startsWith('seo')) return 'SEO Editor';
  if (lower.startsWith('audit')) return 'Audit';
  return 'SEO';   // fallback
}

// ── Item count helpers ────────────────────────────────────────────────────

/**
 * For client_actions, itemCount reflects the number of individual changes
 * inside the payload. Falls back to 1 (the action itself is the single item).
 */
function itemCountForAction(action: ClientAction): number {
  const p = action.payload as Record<string, unknown>;
  if (Array.isArray(p?.diffs)) return (p.diffs as unknown[]).length;        // aeo_change
  if (Array.isArray(p?.suggestions)) return (p.suggestions as unknown[]).length;  // internal_link
  if (Array.isArray(p?.redirects)) return (p.redirects as unknown[]).length;  // redirect_proposal
  return 1;  // content_decay and unknown types
}

// ── Public adapters ────────────────────────────────────────────────────────

/**
 * Normalize a `client_action` row into a `NormalizedDecision` for `<DecisionCard>`.
 *
 * `isSingleAction` is true only for `content_decay` — those render inline
 * with approve/flag buttons; all other types open `<DecisionDetailModal>`.
 */
export function normalizeClientAction(action: ClientAction): NormalizedDecision {
  return {
    id: `ca-${action.id}`,
    source: 'client_action',
    sourceId: action.id,
    title: action.title,
    summary: action.summary,
    priority: action.priority,
    itemCount: itemCountForAction(action),
    isSingleAction: action.sourceType === 'content_decay',
    badge: CLIENT_ACTION_BADGES[action.sourceType] ?? action.sourceType.replace(/_/g, ' '),
    createdAt: action.createdAt,
  };
}

/**
 * Normalize an `approval_batch` row into a `NormalizedDecision` for `<DecisionCard>`.
 *
 * Approval batches never have isSingleAction=true — they always open the
 * full-screen `<DecisionDetailModal>` regardless of item count.
 */
export function normalizeApprovalBatch(batch: ApprovalBatch): NormalizedDecision {
  return {
    id: `ab-${batch.id}`,
    source: 'approval_batch',
    sourceId: batch.id,
    title: batch.name,
    summary: `${batch.items.length} change${batch.items.length !== 1 ? 's' : ''} ready for your approval`,
    priority: undefined,
    itemCount: batch.items.length,
    isSingleAction: false,
    badge: badgeForBatch(batch.name),
    createdAt: batch.createdAt,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/decision-adapters.test.ts
```
Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decision-adapters.ts tests/unit/decision-adapters.test.ts
git commit -m "feat(inbox): NormalizedDecision adapters for client_action + approval_batch"
```

---

### Task 4: DecisionCard component + tests — Model: sonnet

**Owns (create or modify freely):**
- `src/components/client/DecisionCard.tsx`
- `tests/unit/DecisionCard.test.tsx`

**Must not touch:** `src/components/client/DecisionDetailModal.tsx` (Task 5), `src/components/client/InboxTab.tsx` (Task 6), `src/lib/decision-adapters.ts` (Task 3)

**Reads (do not modify):**
- `shared/types/decision.ts` (committed by Task 2)

**Files:**
- Create: `src/components/client/DecisionCard.tsx`
- Create: `tests/unit/DecisionCard.test.tsx`

The card has two modes:
- **Single-action** (`isSingleAction=true`, i.e. `content_decay`): inline approve / flag-with-note, no modal.
- **Bulk** (all others): entry-point card with "Review N changes →" CTA that calls `onOpen`.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/DecisionCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionCard } from '../../src/components/client/DecisionCard';
import type { NormalizedDecision } from '../../shared/types/decision';

const bulkDecision: NormalizedDecision = {
  id: 'ca-1',
  source: 'client_action',
  sourceId: 'ca-1',
  title: 'Update AEO answers',
  summary: '3 changes proposed',
  priority: 'high',
  itemCount: 3,
  isSingleAction: false,
  badge: 'AEO',
  createdAt: '2026-05-01T00:00:00Z',
};

const singleDecision: NormalizedDecision = {
  ...bulkDecision,
  id: 'ca-2',
  sourceId: 'ca-2',
  title: 'Refresh /services page',
  summary: 'Content showing signs of decay',
  itemCount: 1,
  isSingleAction: true,
  badge: 'Content',
  priority: undefined,
};

describe('DecisionCard — bulk mode', () => {
  it('renders title', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('Update AEO answers')).toBeInTheDocument();
  });

  it('renders badge', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('AEO')).toBeInTheDocument();
  });

  it('renders "Review 3 changes" CTA', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /review 3 changes/i })).toBeInTheDocument();
  });

  it('calls onOpen when CTA clicked', () => {
    const onOpen = vi.fn();
    render(<DecisionCard decision={bulkDecision} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /review 3 changes/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows High priority badge when priority=high', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('High priority')).toBeInTheDocument();
  });

  it('does not show priority badge when priority is undefined', () => {
    render(<DecisionCard decision={{ ...bulkDecision, priority: undefined }} onOpen={vi.fn()} />);
    expect(screen.queryByText('High priority')).not.toBeInTheDocument();
  });
});

describe('DecisionCard — single-action mode', () => {
  it('renders Approve button', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onApprove={vi.fn()} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });

  it('renders "Request changes" button', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={vi.fn()} />);
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument();
  });

  it('calls onApprove when Approve clicked', () => {
    const onApprove = vi.fn();
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('shows note field after "Request changes" click', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
  });

  it('does NOT render bulk CTA in single-action mode', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /review.*change/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npx vitest run tests/unit/DecisionCard.test.tsx
```
Expected: FAIL — "Cannot find module '../../src/components/client/DecisionCard'"

- [ ] **Step 3: Implement DecisionCard**

Create `src/components/client/DecisionCard.tsx`:

```typescript
// src/components/client/DecisionCard.tsx
import { useState } from 'react';
import { Button } from '../ui';
import type { NormalizedDecision } from '../../../shared/types/decision';

interface DecisionCardProps {
  decision: NormalizedDecision;
  /** Called when the user clicks the bulk "Review N changes →" CTA. */
  onOpen: () => void;
  /** Single-action mode: called when the user clicks "Approve". */
  onApprove?: () => void;
  /** Single-action mode: called with the note when user submits "Request changes". */
  onFlagWithNote?: (note: string) => void;
}

/**
 * DecisionCard — Inbox entry-point card for the Decisions section.
 *
 * Two modes:
 *  - bulk (isSingleAction=false): shows badge, title, summary, item count,
 *    and a "Review N changes →" button that opens DecisionDetailModal.
 *  - single-action (isSingleAction=true, i.e. content_decay): renders the
 *    full action inline with Approve / Request-changes buttons. No modal.
 */
export function DecisionCard({
  decision, onOpen, onApprove, onFlagWithNote,
}: DecisionCardProps) {
  const [flagging, setFlagging] = useState(false);
  const [flagNote, setFlagNote] = useState('');

  const handleSubmitFlag = () => {
    const note = flagNote.trim();
    onFlagWithNote?.(note);
    setFlagging(false);
    setFlagNote('');
  };

  return (
    // pr-check-disable-next-line -- brand signature radius intentional
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      {/* Header row: badge + priority */}
      <div className="flex items-center gap-2 mb-1">
        <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
          {decision.badge}
        </span>
        {decision.priority === 'high' && (
          <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
        )}
      </div>

      {/* Title + summary */}
      <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">{decision.title}</h4>
      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{decision.summary}</p>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        {decision.isSingleAction ? (
          /* Single-action mode (content_decay) — inline approve / flag */
          <>
            <Button size="sm" variant="primary" onClick={onApprove}>
              Approve
            </Button>
            {!flagging ? (
              <Button size="sm" variant="ghost" onClick={() => setFlagging(true)}>
                Request changes
              </Button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={flagNote}
                  onChange={e => setFlagNote(e.target.value)}
                  placeholder="Add a note for your team…"
                  className="flex-1 px-3 py-1.5 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
                />
                <Button size="sm" variant="primary" onClick={handleSubmitFlag}>
                  Send
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setFlagging(false); setFlagNote(''); }}>
                  Cancel
                </Button>
              </div>
            )}
          </>
        ) : (
          /* Bulk mode — entry-point CTA opens DecisionDetailModal */
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Review {decision.itemCount} change{decision.itemCount !== 1 ? 's' : ''} →
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm PASS**

```bash
npx vitest run tests/unit/DecisionCard.test.tsx
```
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/client/DecisionCard.tsx tests/unit/DecisionCard.test.tsx
git commit -m "feat(inbox): DecisionCard component — bulk + single-action modes"
```

---

### Task 5: DecisionDetailModal — full-screen trust-first approval modal — Model: sonnet

**Owns (create or modify freely):**
- `src/components/client/DecisionDetailModal.tsx`
- `tests/unit/DecisionDetailModal.test.tsx`

**Must not touch:** `src/components/client/DecisionCard.tsx` (Task 4), `src/components/client/InboxTab.tsx` (Task 6), `src/lib/decision-adapters.ts` (Task 3)

**Reads (do not modify):**
- `shared/types/decision.ts` (committed by Task 2)
- `shared/types/client-actions.ts` (committed by Task 1)
- `shared/types/approvals.ts` (pre-existing)

**Files:**
- Create: `src/components/client/DecisionDetailModal.tsx`
- Create: `tests/unit/DecisionDetailModal.test.tsx`

The modal shell is uniform for all decision types. The body is type-specific:
- For `approval_batch`: renders a list of `ApprovalItem` rows with per-item flag interaction.
- For `client_action` (aeo_change, internal_link, redirect_proposal): delegates to the existing payload renderers from `ClientActionDetailModal.tsx`.

Footer is always the same: "Looks good — implement N of M →" CTA (N = unflagged count) + "Save for later" escape.

Per-item flagging: clicking "Flag" on a row adds it to local `flaggedItems` state. The CTA label updates. On approval submission, the flagged items' notes are serialized to `clientNote` on the batch (Phase 1 approach — no per-item exclusion yet; that's Phase 3.3).

- [ ] **Step 1: Implement DecisionDetailModal**

Create `src/components/client/DecisionDetailModal.tsx`:

```typescript
// src/components/client/DecisionDetailModal.tsx
import { useState, useEffect, useCallback } from 'react';
import { X, Flag } from 'lucide-react';
import { Button, Icon } from '../ui';
import type { NormalizedDecision, FlaggedItem } from '../../../shared/types/decision';
import type { ApprovalBatch, ApprovalItem } from '../../../shared/types/approvals';
import type { ClientAction, InternalLinkPayload, RedirectProposalPayload, AeoChangePayload } from '../../../shared/types/client-actions';

// ── Approval batch item list ───────────────────────────────────────────────

function ApprovalItemRow({
  item, flagged, onFlag, onUnflag,
}: {
  item: ApprovalItem;
  flagged: boolean;
  onFlag: (note: string) => void;
  onUnflag: () => void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState('');

  return (
    <div className={`py-3 border-b border-[var(--brand-border)] last:border-b-0 ${flagged ? 'border-l-2 border-l-amber-500/60 pl-3 -ml-3' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-0.5">
            {item.pageTitle || item.pageSlug} — {item.field}
          </p>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current</p>
              <p className="t-caption text-[var(--brand-text)] line-clamp-2">{item.currentValue || '—'}</p>
            </div>
            <div>
              <p className="t-caption-sm text-accent-brand mb-0.5">Proposed</p>
              <p className="t-caption text-[var(--brand-text)] line-clamp-2">{item.proposedValue}</p>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0">
          {flagged ? (
            <button
              type="button"
              onClick={onUnflag}
              className="t-caption-sm text-accent-warning hover:text-[var(--brand-text)] transition-colors px-2 py-1"
            >
              Unflag
            </button>
          ) : !flagging ? (
            <button
              type="button"
              onClick={() => setFlagging(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-warning hover:bg-amber-500/10 transition-colors border border-transparent hover:border-amber-500/20"
            >
              <Icon as={Flag} size="sm" />
              Flag
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="What's your concern? (optional)"
                className="px-2 py-1 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-amber-500/50 w-48"
                autoFocus
              />
              <button
                type="button"
                onClick={() => { onFlag(note.trim()); setFlagging(false); setNote(''); }}
                className="t-caption-sm font-medium text-accent-warning px-2 py-1 hover:bg-amber-500/10 rounded-[var(--radius-md)] transition-colors"
              >
                Flag it
              </button>
              <button
                type="button"
                onClick={() => { setFlagging(false); setNote(''); }}
                className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors px-1"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
      {flagged && (
        <p className="t-caption-sm text-accent-warning mt-1 flex items-center gap-1">
          <Icon as={Flag} size="sm" /> Flagged — your team will hold this change for review.
        </p>
      )}
    </div>
  );
}

// ── Client action renderers (re-used from ClientActionDetailModal) ──────────

function AeoRenderer({ payload }: { payload: AeoChangePayload }) {
  const diffs = payload.diffs ?? [];
  if (diffs.length === 0) return <p className="t-body text-[var(--brand-text-muted)]">No changes in this batch.</p>;
  return (
    <div className="space-y-4">
      {diffs.map((d, i) => (
        <div key={i} className="space-y-1">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">{d.page}{d.section ? ` — ${d.section}` : ''}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current</p>
              <p className="t-caption text-[var(--brand-text)] bg-[var(--surface-3)] p-2 rounded-[var(--radius-md)]">{d.current}</p>
            </div>
            <div>
              <p className="t-caption-sm text-accent-brand mb-0.5">Proposed</p>
              <p className="t-caption text-[var(--brand-text)] bg-teal-500/5 border border-teal-500/20 p-2 rounded-[var(--radius-md)]">{d.proposed}</p>
            </div>
          </div>
          {d.rationale && <p className="t-caption-sm text-[var(--brand-text-muted)] italic">Why: {d.rationale}</p>}
        </div>
      ))}
    </div>
  );
}

function InternalLinkRenderer({ payload }: { payload: InternalLinkPayload }) {
  const suggestions = payload.suggestions ?? [];
  if (suggestions.length === 0) return <p className="t-body text-[var(--brand-text-muted)]">No link suggestions in this batch.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--brand-border)]">
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Anchor text</th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Target URL</th>
            <th className="py-2 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Source page</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--brand-border)]">
          {suggestions.map((s, i) => (
            <tr key={i}>
              <td className="py-3 pr-4 t-ui font-medium text-[var(--brand-text-bright)] align-top">{s.anchorText}</td>
              <td className="py-3 pr-4 align-top">
                <a href={s.targetUrl.startsWith('http') ? s.targetUrl : undefined} target="_blank" rel="noopener noreferrer"
                  className="t-caption text-accent-brand hover:underline">
                  {s.targetTitle || s.targetUrl}
                </a>
              </td>
              <td className="py-3 t-caption text-[var(--brand-text-muted)] align-top">{s.sourcePage || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RedirectRenderer({ payload }: { payload: RedirectProposalPayload }) {
  const redirects = payload.redirects ?? [];
  if (redirects.length === 0) return <p className="t-body text-[var(--brand-text-muted)]">No redirects in this batch.</p>;
  return (
    <div className="space-y-3">
      {redirects.map((r, i) => (
        <div key={i} className="flex items-start gap-3 py-2 border-b border-[var(--brand-border)] last:border-b-0">
          <p className="t-caption text-[var(--brand-text)] flex-1 min-w-0 break-all">{r.source}</p>
          <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">→</span>
          <p className="t-caption text-accent-brand flex-1 min-w-0 break-all">{r.target}</p>
          {r.rationale && <p className="t-caption-sm text-[var(--brand-text-muted)] italic">{r.rationale}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface DecisionDetailModalProps {
  decision: NormalizedDecision;
  /** Pass the original record for type-specific body rendering. */
  originalData: { type: 'client_action'; action: ClientAction } | { type: 'approval_batch'; batch: ApprovalBatch };
  /**
   * Called when user clicks "Looks good — implement N of M →".
   * Receives the list of flagged items (may be empty).
   * Should return a promise; modal stays open on rejection.
   */
  onApprove: (flaggedItems: FlaggedItem[]) => Promise<void>;
  onDismiss: () => void;
  submitting?: boolean;
}

/**
 * DecisionDetailModal — full-screen trust-first approval flow (spec §4.1.1).
 *
 * Shell: header (title + source badge + back), scrollable body (type-specific
 * renderer), fixed footer ("Looks good — implement N of M →" CTA).
 *
 * Per-item flagging tracked in local state. Flagged items get amber border
 * and "Flagged" pill. CTA label shows unflagged count.
 *
 * Submission: all items approved; flagged items' notes serialized to
 * `clientNote` on the batch for manual team handling (Phase 1 workaround;
 * per-item exclusion is Phase 3.3).
 */
export function DecisionDetailModal({
  decision, originalData, onApprove, onDismiss, submitting = false,
}: DecisionDetailModalProps) {
  // flaggedItems: itemId → note (empty string = flagged with no note)
  const [flaggedItems, setFlaggedItems] = useState<Map<string, string>>(new Map());

  const flagItem = useCallback((id: string, note: string) => {
    setFlaggedItems(prev => new Map(prev).set(id, note));
  }, []);

  const unflagItem = useCallback((id: string) => {
    setFlaggedItems(prev => { const m = new Map(prev); m.delete(id); return m; });
  }, []);

  // Escape key closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  // Compute unflagged count for CTA label
  const totalItems = decision.itemCount;
  const flaggedCount = flaggedItems.size;
  const unflaggedCount = totalItems - flaggedCount;

  const handleApprove = async () => {
    const flaggedList: FlaggedItem[] = Array.from(flaggedItems.entries()).map(([itemId, note]) => ({ itemId, note }));
    await onApprove(flaggedList);
  };

  // ── Body renderer ──────────────────────────────────────────────────────

  let body: React.ReactNode;

  if (originalData.type === 'approval_batch') {
    const { batch } = originalData;
    body = (
      <div>
        {batch.items.map(item => (
          <ApprovalItemRow
            key={item.id}
            item={item}
            flagged={flaggedItems.has(item.id)}
            onFlag={(note) => flagItem(item.id, note)}
            onUnflag={() => unflagItem(item.id)}
          />
        ))}
      </div>
    );
  } else {
    const { action } = originalData;
    const p = action.payload as Record<string, unknown>;
    if (action.sourceType === 'aeo_change') {
      body = <AeoRenderer payload={p as AeoChangePayload} />;
    } else if (action.sourceType === 'internal_link') {
      body = <InternalLinkRenderer payload={p as InternalLinkPayload} />;
    } else if (action.sourceType === 'redirect_proposal') {
      body = <RedirectRenderer payload={p as RedirectProposalPayload} />;
    } else {
      body = <pre className="t-caption text-[var(--brand-text-muted)] overflow-auto">{JSON.stringify(action.payload, null, 2)}</pre>;
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-modal-title"
      className="fixed inset-0 z-[var(--z-modal-fullscreen)] flex flex-col"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onDismiss} />

      {/* Panel */}
      <div className="relative z-10 flex flex-col h-full max-w-3xl mx-auto w-full bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ borderRadius: '0 0 var(--radius-signature-lg) var(--radius-signature-lg)' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
          <button
            type="button"
            autoFocus
            onClick={onDismiss}
            aria-label="Close"
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <Icon as={X} size="md" className="text-[var(--brand-text-muted)]" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
                {decision.badge}
              </span>
              {decision.priority === 'high' && (
                <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
              )}
            </div>
            <h2 id="decision-modal-title" className="t-h2 text-[var(--brand-text-bright)] truncate">
              {decision.title}
            </h2>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {body}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--brand-border)] bg-[var(--surface-2)] space-y-2">
          <Button
            variant="primary"
            className="w-full"
            disabled={submitting}
            onClick={handleApprove}
          >
            {submitting
              ? 'Submitting…'
              : flaggedCount > 0
                ? `Looks good — implement ${unflaggedCount} of ${totalItems} →`
                : `Looks good — implement ${totalItems} →`}
          </Button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors py-1"
          >
            Save for later
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write tests for DecisionDetailModal**

Create `tests/unit/DecisionDetailModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DecisionDetailModal } from '../../src/components/client/DecisionDetailModal';
import type { NormalizedDecision } from '../../shared/types/decision';
import type { ApprovalBatch } from '../../shared/types/approvals';

const mockDecision: NormalizedDecision = {
  id: 'ab-1',
  source: 'approval_batch',
  sourceId: 'ab-1',
  title: 'SEO Editor — 3 pages',
  summary: '3 changes ready for approval',
  priority: undefined,
  itemCount: 3,
  isSingleAction: false,
  badge: 'SEO Editor',
  createdAt: '2026-05-01T00:00:00Z',
};

const mockBatch: ApprovalBatch = {
  id: 'ab-1',
  workspaceId: 'ws-1',
  siteId: 'site-1',
  name: 'SEO Editor — 3 pages',
  items: [
    { id: 'i1', pageId: 'p1', pageTitle: 'Home', pageSlug: '/', field: 'seoTitle',
      currentValue: 'Old Title', proposedValue: 'New Title', status: 'pending',
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
    { id: 'i2', pageId: 'p2', pageTitle: 'About', pageSlug: '/about', field: 'seoDescription',
      currentValue: 'Old desc', proposedValue: 'New desc', status: 'pending',
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
    { id: 'i3', pageId: 'p3', pageTitle: 'Services', pageSlug: '/services', field: 'seoTitle',
      currentValue: 'Old svc', proposedValue: 'New svc', status: 'pending',
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
  ],
  status: 'pending',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

function renderModal(onApprove = vi.fn().mockResolvedValue(undefined), onDismiss = vi.fn()) {
  return render(
    <DecisionDetailModal
      decision={mockDecision}
      originalData={{ type: 'approval_batch', batch: mockBatch }}
      onApprove={onApprove}
      onDismiss={onDismiss}
    />,
  );
}

describe('DecisionDetailModal', () => {
  it('renders dialog with title', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('SEO Editor — 3 pages')).toBeInTheDocument();
  });

  it('renders all batch items', () => {
    renderModal();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
  });

  it('renders "Looks good — implement 3 →" CTA when no items flagged', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /looks good — implement 3/i })).toBeInTheDocument();
  });

  it('calls onDismiss when close button clicked', () => {
    const onDismiss = vi.fn();
    renderModal(undefined, onDismiss);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when "Save for later" clicked', () => {
    const onDismiss = vi.fn();
    renderModal(undefined, onDismiss);
    fireEvent.click(screen.getByText('Save for later'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('updates CTA label after flagging one item', async () => {
    renderModal();
    // Click the Flag button on the first item row
    const flagButtons = screen.getAllByRole('button', { name: /flag/i });
    fireEvent.click(flagButtons[0]);
    // Submit the flag (empty note is fine)
    fireEvent.click(screen.getByRole('button', { name: /flag it/i }));
    // CTA should now say "implement 2 of 3"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /implement 2 of 3/i })).toBeInTheDocument();
    });
  });

  it('calls onApprove with empty flaggedItems when no flags', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderModal(onApprove);
    fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith([]));
  });
});
```

- [ ] **Step 3: Run tests to confirm PASS**

```bash
npx vitest run tests/unit/DecisionDetailModal.test.tsx
```
Expected: all 8 tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/client/DecisionDetailModal.tsx tests/unit/DecisionDetailModal.test.tsx
git commit -m "feat(inbox): DecisionDetailModal — trust-first full-screen approval modal + tests"
```

---

### Task 6: Fix InboxTab section routing + wire DecisionCard/DecisionDetailModal — Model: sonnet

**Owns (create or modify freely):**
- `src/components/client/InboxTab.tsx`

**Must not touch:** any file in the parallel batch (Tasks 3–5 files). All those are committed before this task starts.

**Reads (do not modify):**
- `src/lib/decision-adapters.ts` (Task 3, committed)
- `src/components/client/DecisionCard.tsx` (Task 4, committed)
- `src/components/client/DecisionDetailModal.tsx` (Task 5, committed)
- `shared/types/decision.ts` (Task 2, committed)

**Pre-check:** Before starting, verify `PATCH /api/public/approvals/:wsId/:batchId/approve` exists: `grep -r "approvals.*approve" server/routes/`

**Files:**
- Modify: `src/components/client/InboxTab.tsx`

This is the largest task. The routing changes are:

| Before | After |
|--------|-------|
| Decisions section: client_actions + content_plan + **requests** | Decisions: client_actions + **approval_batches (no note)** + content_plan |
| Reviews section: **approval_batches** + schema_plan | Reviews: **content briefs/posts + copy** + schema_plan |
| Conversations section: **content briefs/posts + copy** | Conversations: **requests** |

**Critical:** `approval_batches` with a `note` field route to **Conversations** (note = team's first message). Batches without a note route to Decisions.

- [ ] **Step 1: Write routing assertions test before touching InboxTab**

Add to `tests/unit/inbox-filter-values.test.ts`:

```typescript
// At bottom of the file — add this describe block

describe('InboxTab approval batch routing rules', () => {
  it('INBOX_FILTER_VALUES still contains decisions + reviews + conversations', () => {
    // Regression guard — Phase 2 routing fix must not break filter values
    expect(INBOX_FILTER_VALUES).toContain('decisions');
    expect(INBOX_FILTER_VALUES).toContain('reviews');
    expect(INBOX_FILTER_VALUES).toContain('conversations');
  });
});
```

Run to confirm it passes (it should — it's just a guard):
```bash
npx vitest run tests/unit/inbox-filter-values.test.ts
```
Expected: all tests pass.

- [ ] **Step 2: Update InboxTab imports**

At the top of `src/components/client/InboxTab.tsx`, add new imports after existing ones:

```typescript
import { DecisionCard } from './DecisionCard';
import { DecisionDetailModal } from './DecisionDetailModal';
import { normalizeClientAction, normalizeApprovalBatch } from '../../lib/decision-adapters';
import type { NormalizedDecision, FlaggedItem } from '../../../shared/types/decision';
```

Also verify `patch` is already imported from the API client (needed in Step 10). If missing, add it:

```typescript
// Check existing import — add 'patch' if absent:
import { get, post, patch } from '../../api/client';
```

And verify `useQueryClient` is already called at the top of the component body. If missing, add:

```typescript
const queryClient = useQueryClient();
```

- [ ] **Step 3: Add new state variables for DecisionDetailModal**

Inside the `InboxTab` function body, after the existing state declarations (after `changeRequestNote` state), add:

```typescript
// Decision detail modal state
const [openDecision, setOpenDecision] = useState<NormalizedDecision | null>(null);
const [decisionSubmitting, setDecisionSubmitting] = useState(false);
```

- [ ] **Step 4: Compute routing groups**

Replace the existing derived count variables. Find the block starting at line ~156 (after the existing `const pendingClientActions` declarations) and replace/add:

```typescript
// Routing: approval_batches split by note presence (spec §3.5 Rule 1)
const approvalsForDecisions = approvalBatches.filter(b =>
  !b.note && b.items.some(i => i.status === 'pending'),
);
const approvalsForConversations = approvalBatches.filter(b =>
  !!b.note && b.items.some(i => i.status === 'pending'),
);

// NormalizedDecision lists for the Decisions section
const decisionItems: NormalizedDecision[] = [
  ...pendingClientActions.map(a => normalizeClientAction(a)),
  ...approvalsForDecisions.map(b => normalizeApprovalBatch(b)),
];

// Filter chip counts (spec §3)
const decisionsCount = decisionItems.length + planReviewCount;
const reviewsCount = contentReviews + copyReviewCount + (schemaPlanPending ? 1 : 0);
const conversationsCount = requestReplies + approvalsForConversations.length;
```

- [ ] **Step 5: Update filter chip counts**

Find the `filterChips` array definition and replace the count values:

```typescript
const filterChips: { id: InboxFilter; label: string; count?: number }[] = [
  { id: 'all', label: 'All' },
  { id: 'decisions', label: 'Decisions',
    count: decisionsCount || undefined },
  { id: 'reviews', label: 'Reviews',
    count: reviewsCount || undefined },
  ...(!betaMode ? [{ id: 'conversations' as InboxFilter, label: 'Conversations',
    count: conversationsCount || undefined }] : []),
];
```

- [ ] **Step 6: Update section visibility flags**

Replace the existing `showSection1/2/3` lines:

```typescript
const showDecisions = mode === 'active' && (filter === 'all' || filter === 'decisions');
const showReviews = mode === 'active' && (filter === 'all' || filter === 'reviews');
const showConversations = mode === 'active' && !betaMode && (filter === 'all' || filter === 'conversations');
```

- [ ] **Step 7: Rewrite Section 1 — Decisions**

Find the Section 1 block (`{/* ── Section 1: Needs Action & Requests ── */}`) and replace it entirely:

```tsx
{/* ── Section 1: Decisions ── */}
{showDecisions && (
  <section aria-label="Decisions" className="space-y-4">
    <div className="flex items-center gap-2">
      <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Decisions</h3>
      {decisionsCount > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-amber-500/15 text-accent-warning border border-amber-500/30">
          {decisionsCount} pending
        </span>
      )}
    </div>

    {decisionItems.length > 0 ? (
      <div className="space-y-3">
        {decisionItems.map(decision => {
          const originalData = decision.source === 'client_action'
            ? { type: 'client_action' as const, action: pendingClientActions.find(a => a.id === decision.sourceId)! }
            : { type: 'approval_batch' as const, batch: approvalsForDecisions.find(b => b.id === decision.sourceId)! };

          return (
            <DecisionCard
              key={decision.id}
              decision={decision}
              onOpen={() => setOpenDecision(decision)}
              onApprove={decision.isSingleAction
                ? () => respondToClientAction(decision.sourceId, 'approved').catch(() => {})
                : undefined}
              onFlagWithNote={decision.isSingleAction
                ? (note) => respondToClientAction(decision.sourceId, 'changes_requested', note || undefined).catch(() => {})
                : undefined}
            />
          );
        })}
      </div>
    ) : (
      <p className="t-caption text-[var(--brand-text-muted)] py-2">All caught up — no decisions needed right now.</p>
    )}

    {/* Content Plan sign-offs */}
    {planReviewCount > 0 && (
      <div className="space-y-3">
        <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Content Plan</p>
        {contentPlanReviewCells.map(cell => {
          const isFlagging = flaggingCell === cell.cellId;
          const isFlagged = cell.status === 'flagged';
          return (
            // pr-check-disable-next-line -- Brand signature radius intentional
            <div key={cell.cellId} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="t-caption font-medium text-[var(--brand-text)]">{cell.targetKeyword}</span>
                      <span className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${
                        isFlagged
                          ? 'bg-amber-500/10 border-amber-500/30 text-accent-warning'
                          : 'bg-teal-500/10 border-teal-500/30 text-accent-brand'
                      }`}>
                        {isFlagged ? 'Flagged' : 'Needs Review'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
                      <span>{cell.matrixName}</span>
                      {cell.plannedUrl && (
                        <span className="flex items-center gap-0.5">
                          <Icon as={ExternalLink} size="xs" /> {cell.plannedUrl}
                        </span>
                      )}
                    </div>
                  </div>
                  {!isFlagged && !isFlagging && (
                    <button
                      type="button"
                      onClick={() => setFlaggingCell(cell.cellId)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text)] transition-colors"
                    >
                      <Icon as={Flag} size="sm" /> Request Changes
                    </button>
                  )}
                </div>
                {isFlagging && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={flagComment}
                      onChange={e => setFlagComment(e.target.value)}
                      placeholder="Describe what you'd like changed..."
                      rows={2}
                      className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="primary" disabled={flagSubmitting || !flagComment.trim()} onClick={() => handleFlagCell(cell)}>
                        {flagSubmitting ? 'Submitting…' : 'Submit Feedback'}
                      </Button>
                      <button type="button" onClick={() => { setFlaggingCell(null); setFlagComment(''); }}
                        className="px-3 py-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
                {isFlagged && (
                  <div className="mt-2 t-caption-sm text-accent-warning flex items-center gap-1">
                    <Icon as={Flag} size="sm" /> You've flagged this — your team is reviewing your feedback.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    )}

    {decisionsCount === 0 && planReviewCount === 0 && (
      <p className="t-caption text-[var(--brand-text-muted)] py-2">All caught up — no decisions needed right now.</p>
    )}
  </section>
)}
```

- [ ] **Step 8: Rewrite Section 2 — Reviews**

Replace the Section 2 block (`{/* ── Section 2: SEO Changes ── */}`) with:

```tsx
{/* ── Section 2: Reviews ── */}
{showReviews && (
  <section aria-label="Reviews" className="space-y-4">
    <div className="flex items-center gap-2">
      <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Reviews</h3>
      {reviewsCount > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-blue-500/15 text-accent-info border border-blue-500/30">
          {reviewsCount} needs review
        </span>
      )}
    </div>

    {/* Schema plan */}
    {schemaPlan && (
      <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Icon as={Shield} size="sm" className="text-accent-brand" />
              <span className="t-caption-sm font-medium text-accent-brand">Schema Strategy</span>
              {schemaPlanPending && (
                <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/30">Ready for review</span>
              )}
            </div>
            <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">
              Schema strategy — {schemaPlan.pageRoles.length} page{schemaPlan.pageRoles.length !== 1 ? 's' : ''}
            </h4>
            <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
              {schemaPlanPending
                ? 'Your schema strategy is ready for your review and approval.'
                : schemaPlan.status === 'client_approved' ? 'Approved — implementation in progress.'
                : schemaPlan.status === 'active' ? 'Active schema strategy.'
                : 'Schema strategy on file.'}
            </p>
          </div>
          <Button size="sm" variant={schemaPlanPending ? 'primary' : 'ghost'} onClick={() => setSchemaModalOpen(true)}>
            Review schema plan →
          </Button>
        </div>
      </div>
    )}

    {/* Copy review */}
    {hasCopyEntries && (
      <div className="space-y-2">
        <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Copy Review</p>
        <ClientCopyReview workspaceId={workspaceId} />
      </div>
    )}

    {/* Content briefs + posts */}
    <div className="space-y-2">
      <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Content Pipeline</p>
      <ContentTab
        contentRequests={contentRequests}
        setContentRequests={setContentRequests}
        effectiveTier={effectiveTier}
        briefPrice={briefPrice}
        fullPostPrice={fullPostPrice}
        fmtPrice={fmtPrice}
        setPricingModal={setPricingModal}
        pricingConfirming={pricingConfirming}
        workspaceId={workspaceId}
        setToast={setToast}
        hidePrices={hidePrices}
      />
    </div>
  </section>
)}
```

- [ ] **Step 9: Rewrite Section 3 — Conversations**

Replace the Section 3 block (`{/* ── Section 3: Content ── */}`) with:

```tsx
{/* ── Section 3: Conversations ── */}
{showConversations && (
  <section aria-label="Conversations" className="space-y-4">
    <div className="flex items-center gap-2">
      <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Conversations</h3>
      {conversationsCount > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-teal-500/15 text-accent-brand border border-teal-500/30">
          {conversationsCount} active
        </span>
      )}
    </div>
    <RequestsTab
      workspaceId={workspaceId}
      requests={requests}
      requestsLoading={requestsLoading}
      clientUser={clientUser}
      loadRequests={loadRequests}
      setToast={setToast}
    />
  </section>
)}
```

- [ ] **Step 10: Wire DecisionDetailModal and approve handler**

Find the modals section at the bottom of InboxTab (after the completed mode block, before the closing `</div>`). Replace the existing ClientActionDetailModal mount with the new DecisionDetailModal:

```tsx
{/* DecisionDetailModal — trust-first full-screen approval for both client_actions and approval_batches */}
{openDecision && (() => {
  const origAction = pendingClientActions.find(a => a.id === openDecision.sourceId);
  const origBatch = approvalsForDecisions.find(b => b.id === openDecision.sourceId);
  if (!origAction && !origBatch) return null;
  const originalData = origAction
    ? { type: 'client_action' as const, action: origAction }
    : { type: 'approval_batch' as const, batch: origBatch! };
  return (
    <DecisionDetailModal
      decision={openDecision}
      originalData={originalData}
      submitting={decisionSubmitting}
      onDismiss={() => setOpenDecision(null)}
      onApprove={async (flaggedItems) => {
        setDecisionSubmitting(true);
        try {
          if (originalData.type === 'client_action') {
            const note = flaggedItems.length > 0
              ? flaggedItems.map(f => `${f.itemId}: ${f.note || 'flagged'}`).join('; ')
              : undefined;
            await respondToClientAction(originalData.action.id, 'approved', note);
          } else {
            // Approval batch: approve batch, attach flagged item notes as clientNote
            const clientNote = flaggedItems.length > 0
              ? `Flagged items: ${flaggedItems.map(f => `${f.itemId}: ${f.note || 'flagged'}`).join('; ')}`
              : undefined;
            const updated = {
              ...originalData.batch,
              items: originalData.batch.items.map(item => ({ ...item, status: 'approved' as const, clientNote })),
            };
            await patch(`/api/public/approvals/${workspaceId}/${originalData.batch.id}/approve`, { clientNote });
            setApprovalBatches(prev => prev.map(b => b.id === originalData.batch.id ? updated : b));
            queryClient.invalidateQueries({ queryKey: queryKeys.client.approvals(workspaceId) });
            setToast({ message: 'Approved. Your team will implement the changes.', type: 'success' });
          }
          setOpenDecision(null);
        } catch {
          setToast({ message: 'Failed to submit approval. Please try again.', type: 'error' });
          throw new Error('approval failed');  // keeps modal open for retry
        } finally {
          setDecisionSubmitting(false);
        }
      }}
    />
  );
})()}
```

Also remove the old `ClientActionDetailModal` mount (it's now replaced by `DecisionDetailModal`).

- [ ] **Step 11: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 12: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass. Fix any failures before committing.

- [ ] **Step 13: Commit**

```bash
git add src/components/client/InboxTab.tsx
git commit -m "feat(inbox): fix section routing + wire DecisionCard/DecisionDetailModal (PR 2.1)"
```

---

### Task 7: Build verify + PR

- [ ] **Step 1: Full quality gates**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```
Expected: all pass.

- [ ] **Step 2: Check pr-check for new inbox routing violations**

```bash
npx tsx scripts/pr-check.ts 2>&1 | grep -i "inbox\|decision\|approval"
```
Expected: zero errors related to inbox routing.

- [ ] **Step 3: Scaled code review (required — parallel agents used)**

PR 2.1 used parallel agents (Tasks 3+4+5 ran concurrently across 10+ files). CLAUDE.md requires `superpowers:scaled-code-review` before merging. Invoke it now with the SHA range covering Tasks 1–6:

```bash
BASE_SHA=$(git log --oneline | grep "add rationale + effort + priority" | head -1 | awk '{print $1}')~1
HEAD_SHA=$(git rev-parse HEAD)
echo "Review range: $BASE_SHA..$HEAD_SHA"
```

Invoke `superpowers:scaled-code-review` with `BASE_SHA` and `HEAD_SHA`. Fix all Critical and Important issues before proceeding to Step 4. Do not open the PR until the review is clean.

- [ ] **Step 4: Commit any final cleanup and open draft PR**

```bash
git add -p  # stage any remaining changes
git commit -m "chore: cleanup DecisionDetailModal + InboxTab routing"
# Open PR targeting staging
gh pr create --draft --title "feat(inbox): Presenter unification + section routing correction (PR 2.1)" \
  --body "$(cat <<'EOF'
## Summary
- Fixes InboxTab section routing: approval_batches → Decisions, content → Reviews, requests → Conversations
- Introduces \`NormalizedDecision\` shape + adapters for both \`client_actions\` and \`approval_batches\`
- \`<DecisionCard>\`: unified entry-point card (bulk mode + single-action mode for content_decay)
- \`<DecisionDetailModal>\`: trust-first full-screen approval modal (spec §4.1.1)
- Enriches \`AeoChangeDiff\` with \`rationale?\` + \`effort?\` (missed from PR 1.1)

## Spec
\`docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md\` §4.1, §3.5

## Test plan
- [ ] Verify decisions section shows client_actions + approval_batches (no note)
- [ ] Verify reviews section shows content briefs/posts + copy review + schema plan
- [ ] Verify conversations section shows requests only
- [ ] Verify approval_batch with note does NOT appear in Decisions
- [ ] Verify DecisionDetailModal opens from bulk DecisionCard click
- [ ] Verify trust-first footer CTA decrements N when items are flagged
- [ ] Verify content_decay still renders inline (no modal)
- [ ] \`npx vitest run\` all green
EOF
)"
```

- [ ] **Step 5: Codex CLI independent review**

With the draft PR open, request an independent Codex review:

```bash
codex "Review the open draft PR for feat/ia-presenter-unification. Focus on: correctness of the note-based approval_batch routing split (batches with note → Conversations, without → Decisions), per-item flagging state management in DecisionDetailModal, and whether the NormalizedDecision adapters correctly handle all ClientActionSourceType values. Project conventions are in CLAUDE.md (.codex/config.toml points there)."
```

Capture all findings. Fix every Critical and Important finding, push fix commits to the draft PR. If >20 lines changed by fixes, re-run scaled-code-review (Step 3) on the updated diff before Step 6.

- [ ] **Step 6: Mark PR ready + wait for CI**

```bash
gh pr ready  # un-drafts the PR
```

Wait for staging CI to go green. If CI fails, diagnose and fix before proceeding.

- [ ] **Step 7: Merge to staging once CI green**

```bash
gh pr merge --squash
```

---

## PR 2.2 — At-Scale Decisions

### Task 8: Type breakdown pills + search bar for large batches — Model: sonnet

**Owns (create or modify freely):**
- `src/components/client/DecisionDetailModal.tsx`
- `src/components/client/DecisionCard.tsx`
- `tests/unit/DecisionCard.test.tsx` (add at-scale test cases)
- `tests/unit/DecisionDetailModal.test.tsx` (add at-scale test cases)

**Must not touch:** `src/components/client/InboxTab.tsx`, `src/lib/decision-adapters.ts`, any shared type files.

**Note:** This task only starts after PR 2.1 is merged to staging. It re-opens files that Tasks 4 and 5 created.

At-scale threshold: `AT_SCALE_THRESHOLD = 25` items. Only renders grouping UI when batch exceeds this.

- [ ] **Step 1: Add type breakdown to DecisionDetailModal**

In `DecisionDetailModal.tsx`, add a `TypeBreakdown` sub-component and a search state. Insert after the imports, before the `ApprovalItemRow` component:

```typescript
const AT_SCALE_THRESHOLD = 25;

function TypeBreakdown({ items }: { items: ApprovalItem[] }) {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.field] = (acc[item.field] ?? 0) + 1;
    return acc;
  }, {});
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {sorted.map(([field, count]) => (
        <span key={field} className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text-muted)]">
          {count} {field.replace(/([A-Z])/g, ' $1').trim()}
        </span>
      ))}
    </div>
  );
}
```

Then add search state inside `DecisionDetailModal`:

```typescript
const [searchQuery, setSearchQuery] = useState('');
```

And update the approval_batch body section to include breakdown + search:

```typescript
if (originalData.type === 'approval_batch') {
  const { batch } = originalData;
  const isAtScale = batch.items.length >= AT_SCALE_THRESHOLD;
  const filteredItems = isAtScale && searchQuery
    ? batch.items.filter(item =>
        item.pageTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.pageSlug.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : batch.items;

  body = (
    <div>
      {isAtScale && <TypeBreakdown items={batch.items} />}
      {isAtScale && (
        <input
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search pages…"
          className="w-full px-3 py-2 mb-4 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
        />
      )}
      {filteredItems.length === 0 && (
        <p className="t-caption text-[var(--brand-text-muted)] py-4 text-center">No pages match "{searchQuery}"</p>
      )}
      {filteredItems.map(item => (
        <ApprovalItemRow
          key={item.id}
          item={item}
          flagged={flaggedItems.has(item.id)}
          onFlag={(note) => flagItem(item.id, note)}
          onUnflag={() => unflagItem(item.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add type breakdown to DecisionCard for at-scale batches**

In `DecisionCard.tsx`, add a type breakdown line after the summary paragraph when `itemCount >= 25` and `source === 'approval_batch'`. This requires knowing the breakdown — pass it as an optional prop:

Update the `DecisionCardProps` interface:

```typescript
interface DecisionCardProps {
  decision: NormalizedDecision;
  onOpen: () => void;
  onApprove?: () => void;
  onFlagWithNote?: (note: string) => void;
  /** Optional type breakdown for at-scale batches (shown as pills). */
  typeBreakdown?: string;   // e.g. "180 LocalBusiness · 12 Service · 8 FAQ"
}
```

Add the `typeBreakdown` prop to the component and render it after the summary:

```typescript
export function DecisionCard({
  decision, onOpen, onApprove, onFlagWithNote, typeBreakdown,
}: DecisionCardProps) {
```

And after `<p className="t-caption ...">...</p>`:
```tsx
{typeBreakdown && (
  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{typeBreakdown}</p>
)}
```

- [ ] **Step 3: Add grouped collapse for at-scale batches**

In `DecisionDetailModal.tsx`, add grouped rendering when `isAtScale`. Groups are by `item.field` (e.g. "seoTitle", "seoDescription"). Each group starts collapsed.

Add `GroupedItemList` component:

```typescript
function GroupedItemList({
  items, flaggedItems, onFlag, onUnflag,
}: {
  items: ApprovalItem[];
  flaggedItems: Map<string, string>;
  onFlag: (id: string, note: string) => void;
  onUnflag: (id: string) => void;
}) {
  const groups = items.reduce<Record<string, ApprovalItem[]>>((acc, item) => {
    const key = item.field;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  return (
    <div className="space-y-2">
      {Object.entries(groups).map(([field, groupItems]) => (
        <div key={field} className="border border-[var(--brand-border)] rounded-[var(--radius-lg)] overflow-hidden">
          <button
            type="button"
            onClick={() => toggle(field)}
            className="w-full flex items-center justify-between px-4 py-3 text-left bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors"
          >
            <span className="t-caption-sm font-medium text-[var(--brand-text)]">
              {field.replace(/([A-Z])/g, ' $1').trim()} ({groupItems.length})
            </span>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {expanded.has(field) ? '▲' : '▼'}
            </span>
          </button>
          {expanded.has(field) && (
            <div className="px-4">
              {groupItems.map(item => (
                <ApprovalItemRow
                  key={item.id}
                  item={item}
                  flagged={flaggedItems.has(item.id)}
                  onFlag={(note) => onFlag(item.id, note)}
                  onUnflag={() => onUnflag(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

Then update the at-scale approval_batch body to use `GroupedItemList` when `isAtScale && !searchQuery`:

```typescript
body = (
  <div>
    {isAtScale && <TypeBreakdown items={batch.items} />}
    {isAtScale && (
      <input
        type="search"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="Search pages…"
        className="w-full px-3 py-2 mb-4 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
      />
    )}
    {isAtScale && !searchQuery ? (
      <GroupedItemList
        items={batch.items}
        flaggedItems={flaggedItems}
        onFlag={flagItem}
        onUnflag={unflagItem}
      />
    ) : (
      <>
        {filteredItems.length === 0 && (
          <p className="t-caption text-[var(--brand-text-muted)] py-4 text-center">No pages match "{searchQuery}"</p>
        )}
        {filteredItems.map(item => (
          <ApprovalItemRow key={item.id} item={item}
            flagged={flaggedItems.has(item.id)}
            onFlag={(note) => flagItem(item.id, note)}
            onUnflag={() => unflagItem(item.id)}
          />
        ))}
      </>
    )}
  </div>
);
```

- [ ] **Step 4: Write tests for at-scale features**

Add to `tests/unit/DecisionCard.test.tsx`:

```typescript
describe('DecisionCard — type breakdown prop', () => {
  it('renders typeBreakdown when provided', () => {
    render(
      <DecisionCard
        decision={{ ...bulkDecision, itemCount: 200 }}
        onOpen={vi.fn()}
        typeBreakdown="180 LocalBusiness · 12 Service · 8 FAQ"
      />,
    );
    expect(screen.getByText('180 LocalBusiness · 12 Service · 8 FAQ')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/DecisionCard.test.tsx tests/unit/decision-adapters.test.ts
```
Expected: all pass.

- [ ] **Step 6: Final quality gates**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

- [ ] **Step 7: Code review (single-agent task — requesting-code-review)**

PR 2.2 is a single-agent task touching 2 files. CLAUDE.md requires `superpowers:requesting-code-review` before merging:

```bash
BASE_SHA=$(git log --oneline | grep "PR 2.1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)
echo "Review range: $BASE_SHA..$HEAD_SHA"
```

Invoke `superpowers:requesting-code-review` with `BASE_SHA` and `HEAD_SHA`. Fix all Critical and Important issues before opening the PR.

- [ ] **Step 8: Commit and open draft PR**

```bash
git add src/components/client/DecisionDetailModal.tsx src/components/client/DecisionCard.tsx tests/unit/DecisionCard.test.tsx tests/unit/DecisionDetailModal.test.tsx
git commit -m "feat(inbox): at-scale Decisions — type breakdown, search, grouped collapse (PR 2.2)"

gh pr create --draft --title "feat(inbox): At-scale Decisions — type breakdown + search + grouping (PR 2.2)" \
  --body "$(cat <<'EOF'
## Summary
- Type breakdown pills in DecisionDetailModal header for batches ≥25 items
- Search bar to filter by page title/slug in at-scale batches
- Grouped collapse rendering by field type (seoTitle, seoDescription, etc.)
- \`typeBreakdown\` prop on DecisionCard for at-scale entry-point cards

## Spec
\`docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md\` §4.1.2

## Test plan
- [ ] Large approval_batch (≥25 items) shows type breakdown pills
- [ ] Search input filters items by page title or slug
- [ ] Groups are collapsed by default, expand on click
- [ ] Small batches (<25 items) show flat list (no grouping/search)
- [ ] \`npx vitest run\` all green
EOF
)"
```

- [ ] **Step 9: Codex CLI independent review**

```bash
codex "Review the open draft PR for feat/ia-at-scale-decisions. Focus on: the AT_SCALE_THRESHOLD=25 branching logic, search filter correctness for both pageTitle and pageSlug, grouped collapse state management (Set<string> expand toggle), and whether the TypeBreakdown pill counts are accurate. Project conventions are in CLAUDE.md (.codex/config.toml points there)."
```

Fix all Critical and Important findings. Push fix commits to the draft PR.

- [ ] **Step 10: Mark PR ready + wait for CI, then merge**

```bash
gh pr ready
# Wait for CI green
gh pr merge --squash
```

---

## Systemic Improvements

### Shared utilities introduced
- `normalizeClientAction()` + `normalizeApprovalBatch()` in `src/lib/decision-adapters.ts` — these are the single source of truth for how both data sources are represented in the Inbox. Phase 3 work should import from here rather than inline-mapping.
- `badgeForBatch(name)` — exported from adapters; Phase 3.1 (schema-admin-consolidation) can reuse this.

### pr-check rules to verify/add
- **No new rule needed:** The `inbox-legacy-filter-literal` rule (pr-check rule 86) guards against old filter values. The filter chip IDs ('decisions', 'reviews', 'conversations') did not change from Phase 1 — this rule remains valid.
- **Verify after Task 6:** Run `npx tsx scripts/pr-check.ts` and confirm no violations from the InboxTab routing changes. Specifically check the `inbox-legacy-filter-literal` rule doesn't flag anything in the new section JSX.
- **Post-phase:** Consider adding a rule that flags direct `ApprovalsTab` or `ClientActionDetailModal` imports inside `InboxTab.tsx` — Phase 2 replaces both with `DecisionCard` + `DecisionDetailModal`. If they reappear it's a regression.

### Test coverage added by this plan
| Test file | Coverage |
|-----------|---------|
| `tests/unit/decision-adapters.test.ts` | 17 tests — adapter pure functions, badge logic, itemCount, source discrimination |
| `tests/unit/DecisionCard.test.tsx` | 12 tests — bulk + single-action modes, priority badge, onOpen/onApprove callbacks, flag flow |
| `tests/unit/DecisionDetailModal.test.tsx` | 8 tests — render, item list, CTA label update on flag, dismiss, approve callback |
| `tests/integration/client-actions-routes.test.ts` | Updated fixture — AeoChangeDiff enriched fields round-trip |

### Wiring checklist for Task 6 (verify before marking done)
- [ ] `tests/contract/tab-deep-link-wiring.test.ts` still green — the `?tab=` deep-link contract must survive the routing change (filter chip IDs didn't change; just section contents did)
- [ ] `PATCH /api/public/approvals/:wsId/:batchId/approve` endpoint confirmed to exist before Task 6 starts
- [ ] `FEATURE_AUDIT.md` updated after PR 2.1 merges (DecisionCard, DecisionDetailModal are new features)
- [ ] `data/roadmap.json` items for Phase 2 marked done after each PR merges

---

## Post-Phase-2 notes

### Phase 3 sub-projects (each requires dedicated brainstorming → spec → plan)

The spec names five Phase 3 items. Each is intentionally scoped as "a separate sub-project with its own spec":

| Sub-project | Notes |
|-------------|-------|
| **3.1 schema-admin-consolidation** | Merge per-page + bulk schema entry points. Admin-side only — does not affect the client InboxTab. |
| **3.2 wins-enrichment** | Aggregates, ROI value estimate, win patterns ("your meta updates win 80% of the time"), full ROI history page. High-impact feature. |
| **3.3 per-item-exclusion** | Backend support for excluding flagged items from batch approval. Only needed if the Phase 1 note-only workaround proves to be a bottleneck in practice. |
| **3.4 client-signals-resolution** | Decide: surface to client, repurpose for admin chat, or retire. Decision first, then spec. |
| **3.5 action-playbooks-resolution** | Decide: surface as recommendations, keep internal, or retire. Same pattern as 3.4. |

To start a Phase 3 sub-project: use the `brainstorming` skill to produce a spec, then return to `writing-plans`.
