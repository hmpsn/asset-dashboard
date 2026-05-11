# PR 1.1 — Shared Contracts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish shared type contracts and feature flags that PRs 1.2–1.4 depend on.

**Architecture:** Pure type/contract additions. No new routes. No DB migrations. No UI additions. 5 files total. Two tasks handled sequentially by Haiku subagents.

**Tech Stack:** TypeScript / React 19 / Vitest

**Spec:** `docs/superpowers/specs/2026-05-10-pr-1-1-shared-contracts-design.md`

**Worktree:** `/Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts/`

---

## File Map

### Modify — Shared Types (3)
- `shared/types/client-actions.ts` — add `mapAeoEffortToClientEffort` + enrich `AeoChangeDiff`
- `shared/types/requests.ts` — add `ClientRequestStatus` type + `toClientRequestStatus()` function
- `shared/types/feature-flags.ts` — add `new_inbox_ia` + `client_wins_surface` flags

### Modify — Frontend (1)
- `src/components/AeoReview.tsx` — populate `rationale`, `effort`, `priority` at send-time

### Modify — Routes (1)
- `src/routes.ts` — update `CLIENT_INBOX_ALIASES` targets to new IA section names

---

## Task 1: Update shared type files

**Model:** Haiku

**Files:**
- Modify: `shared/types/client-actions.ts`
- Modify: `shared/types/requests.ts`
- Modify: `shared/types/feature-flags.ts`

### Step 1: Update `shared/types/client-actions.ts`

**Add import at top** (after the existing empty header — this file has no imports currently):

```typescript
import type { AeoEffort } from './aeo.js';
```

**Add helper function** (before or after `AeoChangeDiff` interface — after is fine):

```typescript
/** Maps AeoEffort (admin internal) to client-facing effort tier. */
export function mapAeoEffortToClientEffort(e: AeoEffort): 'low' | 'medium' | 'high' {
  if (e === 'quick') return 'low';
  if (e === 'significant') return 'high';
  return 'medium'; // 'moderate'
}
```

**Update `AeoChangeDiff` interface** (currently lines 59–65):

BEFORE:
```typescript
export interface AeoChangeDiff {
  page: string;
  /** Which section/question type is changing */
  section?: string;
  current: string;
  proposed: string;
}
```

AFTER:
```typescript
export interface AeoChangeDiff {
  page: string;
  /** Which section/question type is changing */
  section?: string;
  current: string;
  proposed: string;
  /** Why this change — one sentence from AeoPageChange.rationale */
  rationale?: string;
  /** Admin effort estimate, mapped from AeoEffort via mapAeoEffortToClientEffort() */
  effort?: 'low' | 'medium' | 'high';
  /** Urgency hint from AeoPageChange.priority — hidden in client view by default (Phase 1) */
  priority?: 'high' | 'medium' | 'low';
}
```

- [ ] **Step 1a: Apply `shared/types/client-actions.ts` changes** (import + helper + AeoChangeDiff)

- [ ] **Step 1b: Verify typecheck is clean**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npm run typecheck
```

Expected: zero errors.

---

### Step 2: Update `shared/types/requests.ts`

**Add after `RequestStatus` type** (currently line 4):

```typescript
export type RequestStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';

/**
 * The 4 client-visible request states synthesized from admin RequestStatus + notes.
 * Replaces the raw 6-state RequestStatus in all client-facing components.
 */
export type ClientRequestStatus =
  | 'awaiting_team'  // admin: 'new' | 'in_review' — no unread team note
  | 'in_progress'    // admin: 'in_progress' | 'on_hold' — no unread team note
  | 'resolved'       // admin: 'completed' | 'closed'
  | 'team_replied';  // any non-terminal + last note.author === 'team'

/**
 * Maps admin RequestStatus + notes to the 4 client-visible states.
 * "team_replied" is inferred from last note author (no explicit unread tracking in DB).
 * Priority: resolved > team_replied > in_progress > awaiting_team
 */
export function toClientRequestStatus(
  status: RequestStatus,
  notes: Pick<RequestNote, 'author'>[],
): ClientRequestStatus {
  if (status === 'completed' || status === 'closed') return 'resolved';
  const lastNote = notes[notes.length - 1];
  if (lastNote?.author === 'team') return 'team_replied';
  if (status === 'in_progress' || status === 'on_hold') return 'in_progress';
  return 'awaiting_team';
}
```

Note: `RequestNote` is defined later in the same file. The function uses `Pick<RequestNote, 'author'>` which only needs the `author` field.

- [ ] **Step 2a: Apply `shared/types/requests.ts` changes**

- [ ] **Step 2b: Verify typecheck is still clean**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npm run typecheck
```

---

### Step 3: Update `shared/types/feature-flags.ts`

Add two new flags to the `FEATURE_FLAGS` const object, near the end (before the `} as const`):

```typescript
  // Client IA Redesign Phase 1 (PRs 1.2 + 1.3)
  'new_inbox_ia': false,         // Gates PR 1.2 inbox restructure (high UX blast radius)
  'client_wins_surface': false,  // Gates PR 1.3 wins surface + "we called it" hide
```

- [ ] **Step 3a: Apply `shared/types/feature-flags.ts` changes**

- [ ] **Step 3b: Verify typecheck is clean**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npm run typecheck
```

---

### Step 4: Run tests to confirm green

- [ ] **Step 4a: Run full test suite**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4b: Run pr-check**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npx tsx scripts/pr-check.ts
```

Expected: 0 errors (1 pre-existing warning about PageHeader is OK).

---

### Step 5: Commit shared type changes

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts
git add shared/types/client-actions.ts shared/types/requests.ts shared/types/feature-flags.ts
git commit -m "feat: shared contracts — AeoChangeDiff enrichment, ClientRequestStatus type, feature flags"
```

---

## Task 2: Update AeoReview.tsx send-time population + route aliases

**Model:** Haiku

**Files:**
- Modify: `src/components/AeoReview.tsx`
- Modify: `src/routes.ts`

### Step 1: Update `src/components/AeoReview.tsx`

**Add import** at top with existing client-actions import:

Find the existing import of `clientActions`:
```typescript
import { clientActions } from '../api/clientActions';
```

Add after the `aeo.ts` import line (line 16):
```typescript
import { mapAeoEffortToClientEffort } from '../../shared/types/client-actions';
```

**Update the `.map()` call** in `sendPageToClient()` (lines 157–164):

BEFORE:
```typescript
        payload: {
          diffs: (clientReadyPage.changes ?? []).map(c => ({
            page: clientReadyPage.pageTitle || clientReadyPage.pageUrl,
            section: c.location,
            current: c.currentContent ?? '',
            proposed: c.suggestedChange,
          })),
        },
```

AFTER:
```typescript
        payload: {
          diffs: (clientReadyPage.changes ?? []).map(c => ({
            page: clientReadyPage.pageTitle || clientReadyPage.pageUrl,
            section: c.location,
            current: c.currentContent ?? '',
            proposed: c.suggestedChange,
            rationale: c.rationale,
            effort: mapAeoEffortToClientEffort(c.effort),
            priority: c.priority,
          })),
        },
```

- [ ] **Step 1a: Apply `AeoReview.tsx` changes** (import + map update)

- [ ] **Step 1b: Verify typecheck is clean**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npm run typecheck
```

Expected: zero errors. The new fields are typed as optional in `AeoChangeDiff`; `c.rationale` is `string` (satisfies `string | undefined`); `c.priority` is `AeoPriority` = `'high' | 'medium' | 'low'` (satisfies `AeoChangeDiff.priority`).

---

### Step 2: Update `src/routes.ts`

**Update `CLIENT_INBOX_ALIASES`** (currently lines 28–31):

BEFORE:
```typescript
export const CLIENT_INBOX_ALIASES: Record<ClientInboxAlias, string> = {
  approvals: 'seo-changes',
  requests: 'needs-action',
  content: 'content',
};
```

AFTER:
```typescript
export const CLIENT_INBOX_ALIASES: Record<ClientInboxAlias, string> = {
  approvals: 'decisions',     // legacy /approvals → Decisions section (PR 1.2)
  requests: 'conversations',  // legacy /requests → Conversations section (PR 1.2)
  content: 'reviews',         // legacy /content → Reviews section (PR 1.2)
};
```

Note: InboxTab currently ignores unrecognized filter values and falls back to 'all'. This is harmless until PR 1.2 adds the new section handling.

- [ ] **Step 2a: Apply `src/routes.ts` changes**

- [ ] **Step 2b: Verify typecheck is clean**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npm run typecheck
```

---

### Step 3: Run full verification

- [ ] **Step 3a: Run full test suite**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claire/worktrees/ia-shared-contracts && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3b: Run vite build**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npx vite build
```

Expected: clean build with no errors.

- [ ] **Step 3c: Run pr-check**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts && npx tsx scripts/pr-check.ts
```

Expected: 0 errors (1 pre-existing PageHeader warning is OK to ignore).

---

### Step 4: Commit AeoReview + routes changes

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/ia-shared-contracts
git add src/components/AeoReview.tsx src/routes.ts
git commit -m "feat: populate AeoChangeDiff enrichment at send-time; update ClientInboxAlias targets for new IA"
```
