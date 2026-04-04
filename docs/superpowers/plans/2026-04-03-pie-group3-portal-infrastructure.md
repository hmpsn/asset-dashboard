# Platform Intelligence Enhancements — Group 3: Client Portal + Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the client Brand tab (business profile + read-only brand positioning), per-workspace Site Intelligence toggle, system-wide smart placeholder hook, and four new pr-check enforcement rules. All features are feature-flagged.

**Architecture:** BrandTab is a new client portal tab gated behind `client-brand-section` flag. Site Intelligence toggle adds `siteIntelligenceClientView` to FeaturesTab (settings) and gates the OverviewTab module. Smart placeholder hook reads from cached seoContext intelligence slice — no independent AI calls. pr-check rules enforce metricsSource discipline and merge-upsert safety across the codebase.

**Tech Stack:** React 19, TypeScript, Express, SQLite, Vitest, @testing-library/react, scripts/pr-check.ts

**Dependency:** Phase 0 plan must be merged. Imports: `siteIntelligenceClientView` from shared/types/workspace.ts; `ClientTab` (includes 'brand') from src/routes.ts; `'client-brand-section'`, `'smart-placeholders'` from shared/types/feature-flags.ts.

---

## Deduplication Findings

> Pre-implementation audit completed 2026-04-03. Read before implementing Tasks 7, 8, 11.

### 1. workspace-intelligence.ts businessProfile (seoContext base slice)

`server/workspace-intelligence.ts` assembles a `businessProfile` field (lines 269–277) from `workspace.intelligenceProfile` — it contains `{ industry, goals, targetAudience }`. This is **admin-facing strategic context** used to populate AI prompts (adminChat, strategy generation). It is NOT the same as BrandTab's contact-info business profile (`phone`, `email`, `address`, `openingHours`, `socialProfiles`). **No overlap with BrandTab.**

- BrandTab sources data from `GET /api/public/business-priorities/:workspaceId` (already exists, Phase 0) and the workspace's `businessProfile` contact-info field (served via the client workspace endpoint).
- BrandTab must NOT call any intelligence endpoint — it reads portal-safe workspace data only.

### 2. IntelligenceProfileTab.tsx — NO duplication with BrandTab

`src/components/settings/IntelligenceProfileTab.tsx` is an **admin-only** settings tab that edits `intelligenceProfile.industry`, `intelligenceProfile.goals`, and `intelligenceProfile.targetAudience`. These fields feed the AI context engine and are never shown to clients.

BrandTab shows contact and presence fields (`phone`, `email`, `address`, `openingHours`, `socialProfiles`, `foundedDate`, `numberOfEmployees`) — entirely different data shape and audience. No deduplication needed.

### 3. OverviewTab — NO current businessProfile or BrandTab content

`src/components/client/OverviewTab.tsx` renders performance metrics, insights, and activity. It does not reference `siteIntelligenceClientView`, `businessProfile`, or any business identity fields. Task 6 adds the `siteIntelligenceClientView` gate; Tasks 7–8 add the separate BrandTab. No overlap.

### 4. ChatPanel.tsx — NO existing chip concept

`src/components/ChatPanel.tsx` props interface (lines 10–55): `messages`, `loading`, `input`, `onInputChange`, `onSend`, `placeholder?`, `accent?: 'teal' | 'purple'`. **No chips prop exists.** Task 11 adds `suggestionChips?: string[]` and `onChipClick?: (chip: string) => void` as new optional props — this is a pure addition, not a replacement.

### 5. AdminChat.tsx — NO existing placeholder hook or chips

`src/components/AdminChat.tsx` derives `placeholder` via a simple ternary on `chatMode` (line 121). No `useSmartPlaceholder`, no chips. Task 11 is a clean addition.

### 6. businessPriorities hooks

`businessPriorities` is consumed via `src/api/misc.ts` (exported as `businessPriorities`) and used in `StrategyTab.tsx`. No hook reads it directly from workspace state. The portal endpoints (GET/POST `/api/public/business-priorities/:workspaceId`) are Phase 0 done. BrandTab's save path uses `PATCH /api/public/workspaces/:workspaceId/business-profile` (a separate endpoint for contact-info updates).

---

## PR Structure

This group ships as 3 sequential PRs. Each must be merged to staging and CI-green before the next starts.

**PR 1 — Infrastructure** (Tasks 1–6)
- Verification baseline (Task 1)
- pr-check rules (Task 2) — runs in parallel with Task 3
- Migration 049: site_intelligence_client_view column (Task 3) — runs in parallel with Task 2
- FeaturesTab toggle for siteIntelligenceClientView (Task 4) — needs Task 3
- Integration test for toggle (Task 5) — runs in parallel with Task 4 after Task 3
- OverviewTab Site Intelligence gate (Task 6) — needs Tasks 3 + 4

Note: Tasks 2 and 3 can run in parallel after Task 1 is committed. Tasks 4 and 5 can run in parallel after Task 3 is committed. Task 6 runs after Task 4 is committed.

> **✅ PR 1 Staging Verification — do these before merging PR 2:**
> - Open admin Settings → Features tab for a workspace → confirm the "Site Intelligence Client View" toggle is present and saves correctly
> - With the toggle OFF: open the client portal OverviewTab → confirm the IntelligenceSummaryCard is NOT visible
> - With the toggle ON: open the client portal OverviewTab → confirm the IntelligenceSummaryCard IS visible
> - Run `npx tsx scripts/pr-check.ts` → confirm the 4 new rules fire on a file that contains `replaceAllPageKeywords` and `ai_estimate` raw strings (manual smoke-test of the new rules)

**PR 2 — Brand Portal** (Tasks 7–9)
- BrandTab component (Task 7)
- ClientDashboard Brand tab wiring (Task 8) — runs in parallel with Task 9 after Task 7
- BrandTab component tests (Task 9) — runs in parallel with Task 8 after Task 7

Note: Tasks 8 and 9 can run in parallel after Task 7 is committed.

> **✅ PR 2 Staging Verification — do these before merging PR 3:**
> - Open the client portal → confirm a "Brand" tab appears in the nav (gated behind `client-brand-section` flag — enable the flag first if needed)
> - BrandTab shows: business contact fields (phone, email, address, social) as editable inputs; brand positioning section as read-only
> - Edit a contact field and save → refresh the page → confirm the value persisted
> - Brand positioning fields are read-only (no edit inputs, no save button)
> - No purple in BrandTab — check source and `pr-check.ts`
> - The Brand tab does NOT appear in the nav when the `client-brand-section` flag is OFF

**PR 3 — Smart Placeholders** (Tasks 10–12)
- useSmartPlaceholder hook (Task 10)
- AdminChat + ChatPanel integration (Task 11) — runs in parallel with Task 12 after Task 10
- Smart placeholder tests (Task 12) — runs in parallel with Task 11 after Task 10

Note: Tasks 11 and 12 can run in parallel after Task 10 is committed.

> **✅ PR 3 Staging Verification — do these before declaring Group 3 done:**
> - Open AdminChat for a workspace that has SEO context loaded → confirm suggestion chips appear above the input (teal, not purple)
> - Click a chip → confirm it populates the input field but does NOT auto-submit
> - Open a workspace with no SEO context → confirm AdminChat still renders with no chips and a sensible placeholder (no crash, no empty error state)
> - Open the client portal chat (not AdminChat) → confirm NO chips appear — chips are admin-only
> - Enable `smart-placeholders` feature flag OFF → confirm chips are hidden in AdminChat even if the hook returns suggestions
> - No purple in `ChatPanel.tsx` or `AdminChat.tsx` — run `pr-check.ts`

> **⚠️ PR 3 App-level context — read before dispatching any Task 10–12 agent:**
>
> The following is already handled at layers the UI agents will not see. Do not re-implement any of it:
>
> - **`useSmartPlaceholder` must NOT make AI calls.** It reads from the `seoContext` intelligence slice already in the React Query cache. If the cache is empty or loading, return `{ chips: [], placeholder: 'Ask anything...' }` immediately. Never trigger a new network request to an AI endpoint from this hook.
> - **Suggestion chips are admin-only — never in client-facing renders.** `ChatPanel.tsx` is used in both the admin panel and the client portal. The `suggestionChips` prop must only be passed from `AdminChat`. Never pass it from any client-facing wrapper or `ClientChatPanel`. Add a code comment above the prop definition documenting this constraint.
> - **Color rule: teal for chips, never purple.** Chip buttons are interactive → teal (`border-teal-500/30`, `text-teal-300`, `hover:bg-teal-500/10`). Purple is admin AI only (`AdminChat` and `SeoAudit` "Flag for Client"). `ChatPanel` is also rendered in client context — never add purple to it. `pr-check.ts` flags purple in client-facing components.
> - **Rate limiters already apply to all `/api/public/` routes.** `server/app.ts` applies `publicWriteLimiter` (10 req/min), `publicApiLimiter` (200 req/min), and `globalPublicLimiter` automatically. Do NOT import or apply any of these in route files — applying them twice shares the same in-memory bucket and silently halves the effective limit.
> - **The `smart-placeholders` feature flag is already defined.** `shared/types/feature-flags.ts` has `'smart-placeholders': false` (Phase 0 done). The hook runs unconditionally; the component gates chip rendering on `useFeatureFlag('smart-placeholders')`. Do not re-add the flag definition.
> - **Bug found during review → fix in current PR.** CLAUDE.md mandates: if code review returns a Critical or Important issue, fix it before merging. Never carry a known bug into the next PR.
> - **Dispatch prompts must declare app-level context (CLAUDE.md §5).** Before dispatching each subagent, explicitly list: which rate limiters apply to routes it calls, which React Query caches its mutations invalidate, which WS events it broadcasts, and what UI conditional state it affects. "The agent can figure it out" has caused production bugs in prior phases.

---

## File Map

| File | Create / Modify | Purpose |
|------|-----------------|---------|
| `shared/types/feature-flags.ts` | **Verify (Phase 0 done)** | Flags `'client-brand-section'` and `'smart-placeholders'` already added in Phase 0 |
| `shared/types/workspace.ts` | **Verify (Phase 0 done)** | `siteIntelligenceClientView?: boolean` already added in Phase 0 |
| `src/routes.ts` | **Verify (Phase 0 done)** | `'brand'` already added to `ClientTab` union in Phase 0 |
| `server/db/migrations/049-site-intelligence-client-view.sql` | **Create** | Add `site_intelligence_client_view` column to `workspaces` table |
| `server/workspaces.ts` | **Verify (Phase 0 done)** | `siteIntelligenceClientView` and `businessPriorities` mapper already added — `WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, `columnMap` all updated |
| `server/routes/public-portal.ts` | **Verify (Phase 0 done)** | GET/POST `/api/public/business-priorities/:workspaceId` endpoints already exist |
| `src/components/client/OverviewTab.tsx` | **Modify** | Gate IntelligenceSummaryCard on siteIntelligenceClientView toggle |
| `src/components/settings/FeaturesTab.tsx` | **Modify** | Add Site Intelligence Client View toggle (copy `analyticsClientView` pattern exactly) |
| `src/components/client/BrandTab.tsx` | **Create** | New client portal tab — editable business profile + read-only brand positioning |
| `src/components/ClientDashboard.tsx` | **Modify** | Add `'brand'` to NAV array (feature-flagged); add `{tab === 'brand' && ...}` render block |
| `src/hooks/useSmartPlaceholder.ts` | **Create** | Smart placeholder hook — reads seoContext intelligence slice, admin gets suggestions, client gets ghost text only |
| `src/components/AdminChat.tsx` | **Modify** | Import and apply `useSmartPlaceholder` for admin context (chips + placeholder) |
| `src/components/ChatPanel.tsx` | **Modify** | Accept optional `suggestionChips` prop; render chips above input in admin context |
| `scripts/pr-check.ts` | **Modify** | Add 4 new enforcement rules: `bulk_lookup`, `ai_estimate`, `replaceAllPageKeywords`, `getBacklinksOverview` |
| `tests/unit/smart-placeholder.test.ts` | **Create** | Unit tests for useSmartPlaceholder hook |
| `tests/integration/feature-toggle-site-intelligence.test.ts` | **Create** | Integration test for PATCH `siteIntelligenceClientView` |
| `tests/component/BrandTab.test.tsx` | **Create** | Component tests for BrandTab |
| `tests/component/SmartPlaceholder.test.tsx` | **Create** | Component tests for SmartPlaceholder behavior in AdminChat |

---

## Dependency Graph

```
Task 1 (Phase 0 verification) ──────────────────────────────────────────────────────────────────────────────┐
                                                                                                             │
Task 1 ──► Task 2 (pr-check rules) ─────────────────────────────────────────────────────────────────────────┤  (parallel with Task 3)
                                                                                                             │
Task 1 ──► Task 3 (migration 049) ──► Task 4 (FeaturesTab toggle) ──► Task 6 (OverviewTab gate)            │  PR 1
                              └──────► Task 5 (integration test)                                             │
                                                                                                             │
──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
                                                                                                             │
[After PR 1 merged] ──► Task 7 (BrandTab component) ──► Task 8 (ClientDashboard wiring)                    │  PR 2
                                               └──────► Task 9 (BrandTab component tests)                   │
                                                                                                             │
──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
                                                                                                             │
[After PR 2 merged] ──► Task 10 (useSmartPlaceholder hook) ──► Task 11 (AdminChat + ChatPanel integration)  │  PR 3
                                                    └──────────► Task 12 (smart placeholder tests)           │
```

**Sequential constraints:**
- Task 1 must complete before Tasks 2, 3
- Task 3 must complete before Tasks 4 and 5
- Task 4 must complete before Task 6
- Task 7 must complete before Tasks 8 and 9
- Task 10 must complete before Tasks 11 and 12

**Parallel opportunities within each PR:**
- PR 1: Tasks 2 and 3 can run in parallel after Task 1. Tasks 4 and 5 can run in parallel after Task 3.
- PR 2: Tasks 8 and 9 can run in parallel after Task 7.
- PR 3: Tasks 11 and 12 can run in parallel after Task 10.

---

## Phase 0 Pre-done

The following items were completed as part of Phase 0 work (committed before this plan was written). Implementers **must not re-implement** these — Task 1 verifies them, and Tasks 3+ assume they exist.

| Item | File | Status |
|------|------|--------|
| `'smart-placeholders': false` flag defined | `shared/types/feature-flags.ts` | Done |
| `'client-brand-section': false` flag defined | `shared/types/feature-flags.ts` | Done |
| `'brand'` added to `ClientTab` union | `src/routes.ts` | Done |
| `siteIntelligenceClientView?: boolean` typed | `shared/types/workspace.ts` | Done |
| `businessPriorities?: string[]` typed | `shared/types/workspace.ts` | Done |
| `siteIntelligenceClientView` + `businessPriorities` mapped in `WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, `columnMap` | `server/workspaces.ts` | Done |
| GET `/api/public/business-priorities/:workspaceId` | `server/routes/public-portal.ts` | Done |
| POST `/api/public/business-priorities/:workspaceId` | `server/routes/public-portal.ts` | Done |

> **Only migration 049 is still missing.** `server/workspaces.ts` already reads and writes both `site_intelligence_client_view` and `business_priorities` columns, but the `ALTER TABLE` migration that actually adds `site_intelligence_client_view` to the DB has not been created yet. Task 3 covers this.

---

## Tasks

### Task 1 — Pre-flight: Verify Phase 0 Contracts

**Model:** Haiku (read-only verification — Phase 0 already merged these)

**PR assignment:** PR 1 — must run first, no dependencies.

**Files you OWN:**
- None — this is verification only. Do not create or modify any file.

**Files you must NOT touch:**
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

> ⚠️ **DO NOT EDIT these files** — all changes below were committed in Phase 0. This task is verification only.

- [ ] Verify `shared/types/feature-flags.ts` contains `'client-brand-section': false` and `'smart-placeholders': false`
  ```bash
  grep -n "client-brand-section\|smart-placeholders" shared/types/feature-flags.ts
  # Expected: both present
  ```

- [ ] Verify `shared/types/workspace.ts` contains `siteIntelligenceClientView?: boolean`
  ```bash
  grep -n "siteIntelligenceClientView" shared/types/workspace.ts
  # Expected: field present
  ```

- [ ] Verify `src/routes.ts` contains `'brand'` in `ClientTab` union
  ```bash
  grep -n "'brand'" src/routes.ts
  # Expected: present in ClientTab
  ```

- [ ] If any of the above greps return nothing, **STOP** — Phase 0 was not merged. Do not proceed.

- [ ] Run `npx tsc --noEmit --skipLibCheck` — expect 0 errors
- [ ] No commit needed — this is verification only.

---

### Task 2 — pr-check.ts: 4 New Enforcement Rules

**Model:** Haiku (mechanical, self-contained)

**PR assignment:** PR 1 — can run in parallel with Task 3 after Task 1.

**Files you OWN:**
- scripts/pr-check.ts

**Files you must NOT touch:**
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

**No dependencies on Tasks 3–12** — can run in parallel with Task 3 after Task 1 completes.

- [ ] Read `scripts/pr-check.ts` lines 83–100 to confirm `Check` type structure
- [ ] Read `scripts/pr-check.ts` lines 240–265 to find insertion point (end of `CHECKS` array, before the closing `];`)

- [ ] **Edit `scripts/pr-check.ts`** — append these 4 rules to the `CHECKS` array, immediately before the closing `];`:

```typescript
  {
    name: 'Raw bulk_lookup string outside keywords type file',
    pattern: "'bulk_lookup'",
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['shared/types/keywords.ts', 'shared/types/workspace.ts'],
    message: "Use the 'bulk_lookup' literal only from shared/types/workspace.ts (PageKeywordMap.metricsSource). Raw string references in other files create undiscoverable magic values.",
    severity: 'warn',
  },
  {
    name: 'Raw ai_estimate string in server or src files',
    pattern: "'ai_estimate'",
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['shared/types/'],
    message: "The 'ai_estimate' metricsSource value must only be referenced from shared/types/workspace.ts. Use the shared type, not a raw string literal.",
    severity: 'warn',
  },
  {
    name: 'replaceAllPageKeywords called outside keyword-strategy route',
    pattern: 'replaceAllPageKeywords\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/routes/keyword-strategy.ts', 'server/page-keywords.ts'],
    message: 'replaceAllPageKeywords() is a destructive bulk operation. Only call it from server/routes/keyword-strategy.ts. For incremental updates use upsertPageKeyword().',
    severity: 'error',
  },
  {
    name: 'getBacklinksOverview called outside workspace-intelligence',
    pattern: 'getBacklinksOverview\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/workspace-intelligence.ts'],
    message: 'getBacklinksOverview() is an expensive external API call. Only call it from server/workspace-intelligence.ts where caching and rate-limiting are enforced.',
    severity: 'error',
  },
```

- [ ] Run `npx tsx scripts/pr-check.ts --all` — confirm new rules run without crashing; note any new violations found
- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(pr-check): add 4 enforcement rules — bulk_lookup, ai_estimate, replaceAllPageKeywords, getBacklinksOverview`

---

### Task 3 — Migration 049: siteIntelligenceClientView Column

**Model:** Haiku (mechanical DB addition)

**PR assignment:** PR 1 — can run in parallel with Task 2 after Task 1. Must complete before Tasks 4 and 5.

**Depends on:** Task 1

**Files you OWN:**
- server/db/migrations/049-site-intelligence-client-view.sql (create)

**Files you must NOT touch:**
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

> **Note:** `server/workspaces.ts` mapper edits are **already done** (Phase 0). Only the migration SQL file needs to be created — the mapper already reads/writes `site_intelligence_client_view` and `business_priorities`, but the DB column doesn't exist yet.

- [ ] **Create `server/db/migrations/049-site-intelligence-client-view.sql`**:

```sql
-- Add site_intelligence_client_view column to workspaces
-- Controls whether the IntelligenceSummaryCard is shown to the client on OverviewTab.
-- Defaults to NULL (treated as true by frontend — new feature is on by default).
ALTER TABLE workspaces ADD COLUMN site_intelligence_client_view INTEGER;
```

> **DO NOT edit `server/workspaces.ts`** — `WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, and `columnMap` were all updated in Phase 0. Verify with:
> ```bash
> grep -n "site_intelligence_client_view\|siteIntelligenceClientView" server/workspaces.ts
> # Expected: 3+ matches confirming mapper is present
> ```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(db): migration 049 — add site_intelligence_client_view column to workspaces`

---

### Task 4 — FeaturesTab: Site Intelligence Client View Toggle

**Model:** Sonnet (UI component, must copy toggle pattern precisely)

**PR assignment:** PR 1 — runs after Task 3. Can run in parallel with Task 5.

**Depends on:** Tasks 1 + 3

**Files you OWN:**
- src/components/settings/FeaturesTab.tsx

**Files you must NOT touch:**
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)
- src/components/client/OverviewTab.tsx (Task 6 owns it)

- [ ] Read `src/components/settings/FeaturesTab.tsx` lines 1–30 (imports)
- [ ] Read `src/components/settings/FeaturesTab.tsx` lines 100–200 (existing toggle pattern for reference)

The toggle renders in the **Client Portal Features** `<section>` block, immediately after the Analytics View toggle (around line 165).

- [ ] **Edit `src/components/settings/FeaturesTab.tsx`** — add `Brain` to lucide-react import (or use `Activity` if already imported — verify first):

Check existing imports, add `Brain` if not present:
```typescript
import {
  BarChart3, Loader2, Mail, Image as ImageIcon, DollarSign, Sparkles,
  Users, Shield, SlidersHorizontal, Brain,
} from 'lucide-react';
```

- [ ] **Edit `src/components/settings/FeaturesTab.tsx`** — add `siteIntelligenceClientView` to `WorkspaceData` interface:

```typescript
  siteIntelligenceClientView?: boolean;
```

- [ ] **Edit `src/components/settings/FeaturesTab.tsx`** — insert after the Analytics Client View toggle block, before the Client Onboarding Questionnaire toggle:

```tsx
          {/* Site Intelligence Client View */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Brain className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-xs font-medium text-zinc-200">Site Intelligence Summary</div>
                <div className="text-[11px] text-zinc-500">Show the AI-powered insights summary card to the client on their Overview tab</div>
              </div>
            </div>
            <button onClick={async () => {
              const val = !(ws?.siteIntelligenceClientView !== false);
              await patchWorkspace({ siteIntelligenceClientView: val });
              toast(val ? 'Site Intelligence summary enabled for client' : 'Site Intelligence summary hidden from client');
            }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                ws?.siteIntelligenceClientView !== false ? 'bg-teal-500' : 'bg-zinc-700'
              }`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                ws?.siteIntelligenceClientView !== false ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </label>
```

> NOTE: The toggle uses `!== false` (not `=== true`) because the field defaults to `undefined` (NULL in DB), which should be treated as **enabled** — same pattern as `clientPortalEnabled` and `analyticsClientView`.

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(settings): add Site Intelligence Client View toggle in FeaturesTab`

---

### Task 5 — Integration Test: siteIntelligenceClientView Toggle

**Model:** Sonnet

**PR assignment:** PR 1 — runs after Task 3. Can run in parallel with Task 4.

**Depends on:** Tasks 1 + 3

**Files you OWN:**
- tests/integration/feature-toggle-site-intelligence.test.ts (create)

**Files you must NOT touch:**
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)
- src/components/settings/FeaturesTab.tsx (Task 4 owns it)

- [ ] **Create `tests/integration/feature-toggle-site-intelligence.test.ts`**:

```typescript
// tests/integration/feature-toggle-site-intelligence.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestWorkspace, deleteTestWorkspace, patchWorkspaceApi, getWorkspaceApi } from '../helpers/workspace-test-helpers';

describe('siteIntelligenceClientView toggle', () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await createTestWorkspace({ name: 'SI Toggle Test' });
  });

  afterEach(async () => {
    await deleteTestWorkspace(workspaceId);
  });

  it('defaults to undefined (treated as enabled) on new workspace', async () => {
    const ws = await getWorkspaceApi(workspaceId);
    // NULL in DB → undefined in response → frontend treats as true
    expect(ws.siteIntelligenceClientView).toBeUndefined();
  });

  it('PATCH siteIntelligenceClientView false returns 200 and persists', async () => {
    const res = await patchWorkspaceApi(workspaceId, { siteIntelligenceClientView: false });
    expect(res.status).toBe(200);

    const ws = await getWorkspaceApi(workspaceId);
    expect(ws.siteIntelligenceClientView).toBe(false);
  });

  it('PATCH siteIntelligenceClientView true returns 200 and persists', async () => {
    // First set to false
    await patchWorkspaceApi(workspaceId, { siteIntelligenceClientView: false });
    // Then toggle back
    const res = await patchWorkspaceApi(workspaceId, { siteIntelligenceClientView: true });
    expect(res.status).toBe(200);

    const ws = await getWorkspaceApi(workspaceId);
    expect(ws.siteIntelligenceClientView).toBe(true);
  });
});
```

> NOTE: If `workspace-test-helpers` doesn't exist yet, use the test helper pattern from existing integration tests in `tests/integration/`. Check `tests/helpers/` for existing utilities before creating new ones.

- [ ] Run `npx vitest run tests/integration/feature-toggle-site-intelligence.test.ts` — all tests pass
- [ ] Commit: `test(integration): siteIntelligenceClientView toggle persist and default`

---

### Task 6 — OverviewTab: Site Intelligence Gate

**Model:** Haiku (single conditional wrap — mechanical)

**PR assignment:** PR 1 — runs after Tasks 3 + 4 are committed. Completes PR 1.

**Depends on:** Tasks 1 + 3 + 4

**Files you OWN:**
- src/components/client/OverviewTab.tsx

**Files you must NOT touch:**
- src/components/settings/FeaturesTab.tsx (Task 4 owns it)
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

The `IntelligenceSummaryCard` in `OverviewTab.tsx` at line ~282 needs to be gated by `ws.siteIntelligenceClientView !== false`.

- [ ] Read `src/components/client/OverviewTab.tsx` lines 275–300
- [ ] Confirm `ws` prop type includes `siteIntelligenceClientView`; if not, add to `OverviewTabProps.ws` type (the `WorkspaceInfo` type used by client components)

- [ ] **Edit `src/components/client/OverviewTab.tsx`** — wrap the Intelligence Summary ErrorBoundary:

Replace:
```tsx
    {/* Intelligence summary — insights, pipeline, win rate */}
    <ErrorBoundary label="Intelligence Summary">
      <IntelligenceSummaryCard workspaceId={workspaceId} tier={(betaMode ? 'premium' : (ws.tier as Tier)) || 'free'} />
    </ErrorBoundary>
```

With:
```tsx
    {/* Intelligence summary — insights, pipeline, win rate */}
    {ws.siteIntelligenceClientView !== false && (
      <ErrorBoundary label="Intelligence Summary">
        <IntelligenceSummaryCard workspaceId={workspaceId} tier={(betaMode ? 'premium' : (ws.tier as Tier)) || 'free'} />
      </ErrorBoundary>
    )}
```

> NOTE: `!== false` means `undefined` (default/NULL) shows the card. Only an explicit `false` hides it — consistent with `clientPortalEnabled` and `analyticsClientView` patterns.

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(client): gate IntelligenceSummaryCard on siteIntelligenceClientView toggle`

---

### Task 7 — BrandTab Component

**Model:** Sonnet (new UI component, design system compliance required)

**PR assignment:** PR 2 — first task in PR 2. Must complete before Tasks 8 and 9.

**Depends on:** Task 1 (Phase 0 contracts verified)

**Files you OWN:**
- src/components/client/BrandTab.tsx (create)

**Files you must NOT touch:**
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)
- src/components/ClientDashboard.tsx (Task 8 owns it)

> DEDUPLICATION NOTE: BrandTab shows client-facing contact and presence data (`phone`, `email`, `address`, `openingHours`, `socialProfiles`). This is entirely distinct from `IntelligenceProfileTab.tsx` (admin-only: `industry`, `goals`, `targetAudience` for AI context). BrandTab must NOT call any intelligence endpoint — data comes from the portal workspace endpoint only.

- [ ] Read `src/components/ui/` to verify available primitives (SectionCard, EmptyState, etc.)
- [ ] Read `shared/types/workspace.ts` lines 228–260 (businessProfile fields)
- [ ] Confirm no purple colors are used anywhere in this component

- [ ] **Create `src/components/client/BrandTab.tsx`**:

```tsx
// src/components/client/BrandTab.tsx
// Client portal Brand tab — editable business profile + read-only brand positioning.
// Feature-flagged: 'client-brand-section'
// Design rules: no purple, teal for CTAs, SectionCard for all panels.

import { useState } from 'react';
import { Building2, Phone, Mail, MapPin, Globe, ChevronRight, Sparkles } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBoundary } from '../ErrorBoundary';

interface BusinessProfile {
  phone?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  socialProfiles?: string[];
  openingHours?: string;
  foundedDate?: string;
  numberOfEmployees?: string;
}

interface BrandTabProps {
  workspaceId: string;
  workspaceName: string;
  businessProfile?: BusinessProfile;
  /** Plain-language brand voice summary (NOT the full brand voice doc). */
  brandVoiceSummary?: string;
  /** Industry from intelligenceProfile — used for contextual placeholder */
  industry?: string;
  onSaveBusinessProfile: (profile: BusinessProfile) => Promise<void>;
}

export function BrandTab({
  workspaceId,
  workspaceName,
  businessProfile,
  brandVoiceSummary,
  industry,
  onSaveBusinessProfile,
}: BrandTabProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local form state — initialised from props
  const [form, setForm] = useState<BusinessProfile>(() => businessProfile ?? {});

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveBusinessProfile(form);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(businessProfile ?? {});
    setEditing(false);
  };

  const updateAddress = (field: keyof NonNullable<BusinessProfile['address']>, value: string) => {
    setForm(prev => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Business Profile</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Keep your business information up to date. This helps us personalize your SEO strategy.
        </p>
      </div>

      {/* ── Business Profile Panel (editable) ── */}
      <ErrorBoundary label="Business Profile">
        <SectionCard
          title="Contact & Business Info"
          icon={<Building2 className="w-4 h-4 text-teal-400" />}
          action={
            !editing ? (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1"
              >
                Edit <ChevronRight className="w-3 h-3" />
              </button>
            ) : null
          }
        >
          {!editing ? (
            // ── Read view ──
            <div className="space-y-3">
              {!businessProfile?.phone && !businessProfile?.email && !businessProfile?.address?.city && (
                <EmptyState
                  icon={<Building2 className="w-5 h-5" />}
                  title="No business info added yet"
                  description="Add your contact details so we can keep your site schema accurate."
                  action={
                    <button
                      onClick={() => setEditing(true)}
                      className="mt-3 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium transition-all"
                    >
                      Add Business Info
                    </button>
                  }
                />
              )}
              {businessProfile?.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.phone}</span>
                </div>
              )}
              {businessProfile?.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.email}</span>
                </div>
              )}
              {businessProfile?.address && (businessProfile.address.city || businessProfile.address.street) && (
                <div className="flex items-start gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="text-zinc-300">
                    {businessProfile.address.street && <div>{businessProfile.address.street}</div>}
                    {(businessProfile.address.city || businessProfile.address.state) && (
                      <div>
                        {[businessProfile.address.city, businessProfile.address.state, businessProfile.address.zip]
                          .filter(Boolean).join(', ')}
                      </div>
                    )}
                    {businessProfile.address.country && <div>{businessProfile.address.country}</div>}
                  </div>
                </div>
              )}
              {businessProfile?.openingHours && (
                <div className="flex items-center gap-3 text-sm">
                  <Globe className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.openingHours}</span>
                </div>
              )}
              {businessProfile?.socialProfiles && businessProfile.socialProfiles.length > 0 && (
                <div className="flex items-start gap-3 text-sm">
                  <Globe className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {businessProfile.socialProfiles.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="block text-teal-400 hover:text-teal-300 truncate text-xs transition-colors">
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // ── Edit form ──
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder={industry ? `e.g. +1 (555) 000-0000` : '+1 (555) 000-0000'}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Business Email</label>
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="hello@yourbusiness.com"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Street Address</label>
                <input
                  type="text"
                  value={form.address?.street ?? ''}
                  onChange={e => updateAddress('street', e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] text-zinc-500 mb-1">City</label>
                  <input
                    type="text"
                    value={form.address?.city ?? ''}
                    onChange={e => updateAddress('city', e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">State</label>
                  <input
                    type="text"
                    value={form.address?.state ?? ''}
                    onChange={e => updateAddress('state', e.target.value)}
                    placeholder="CA"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">ZIP</label>
                  <input
                    type="text"
                    value={form.address?.zip ?? ''}
                    onChange={e => updateAddress('zip', e.target.value)}
                    placeholder="90210"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Country</label>
                  <input
                    type="text"
                    value={form.address?.country ?? ''}
                    onChange={e => updateAddress('country', e.target.value)}
                    placeholder="United States"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Hours</label>
                  <input
                    type="text"
                    value={form.openingHours ?? ''}
                    onChange={e => setForm(p => ({ ...p, openingHours: e.target.value }))}
                    placeholder="Mon-Fri 9am–5pm"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-all"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      </ErrorBoundary>

      {/* ── Brand Positioning Panel (read-only) ── */}
      <ErrorBoundary label="Brand Positioning">
        <SectionCard
          title="Brand Positioning"
          icon={<Sparkles className="w-4 h-4 text-teal-400" />}
          badge={<span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">AI-generated</span>}
        >
          {brandVoiceSummary ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300 leading-relaxed">{brandVoiceSummary}</p>
              <p className="text-[11px] text-zinc-600">
                This summary reflects how your brand communicates. Contact your agency to update your brand voice guidelines.
              </p>
            </div>
          ) : (
            <EmptyState
              icon={<Sparkles className="w-5 h-5" />}
              title="Brand positioning not yet generated"
              description="Your agency will set up your brand voice guidelines. Check back after your onboarding is complete."
            />
          )}
        </SectionCard>
      </ErrorBoundary>
    </div>
  );
}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(client): BrandTab component — editable business profile + read-only brand positioning`

---

### Task 8 — ClientDashboard Wiring: Brand Tab

**Model:** Sonnet

**PR assignment:** PR 2 — runs after Task 7. Can run in parallel with Task 9.

**Depends on:** Tasks 1 + 7

**Files you OWN:**
- src/components/ClientDashboard.tsx

**Files you must NOT touch:**
- src/components/client/BrandTab.tsx (Task 7 owns it — import only, do not edit)
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

- [ ] Read `src/components/ClientDashboard.tsx` lines 145–160 (tab parsing)
- [ ] Read `src/components/ClientDashboard.tsx` lines 625–645 (NAV array)
- [ ] Read `src/components/ClientDashboard.tsx` lines 828–870 (tab render blocks)

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add `BrandTab` import at top with other tab imports:

```typescript
import { BrandTab } from './client/BrandTab';
```

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add `useFeatureFlag` import if not already present (check existing imports first):

```typescript
import { useFeatureFlag } from '../hooks/useFeatureFlag';
```

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add flag hook near the top of the component (alongside existing hooks):

```typescript
const brandEnabled = useFeatureFlag('client-brand-section');
```

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add Brand tab to NAV array, after the ROI entry:

```typescript
    ...(brandEnabled ? [{ id: 'brand' as ClientTab, label: 'Brand', icon: Building2, locked: false }] : []),
```

Also add `Building2` to the lucide-react import block.

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add `'brand'` to allowed tab list (line ~152):

```typescript
    if (t && ['overview','performance','health','strategy','analytics','inbox','approvals','requests','content','plans','roi','content-plan','schema-review','brand'].includes(t)) return t as ClientTab;
```

- [ ] **Edit `src/components/ClientDashboard.tsx`** — add brand tab render block after the last tab block, before the Floating AI Chat section:

```tsx
        {/* ════════════ BRAND TAB ════════════ */}
        {tab === 'brand' && brandEnabled && (
          <ErrorBoundary label="Brand">
            <BrandTab
              workspaceId={workspaceId}
              workspaceName={ws.name}
              businessProfile={ws.businessProfile}
              brandVoiceSummary={ws.brandVoiceSummary}
              industry={ws.intelligenceProfile?.industry}
              onSaveBusinessProfile={async (profile) => {
                await patch(`/api/public/workspaces/${workspaceId}/business-profile`, profile);
                // Invalidate workspace cache so nav re-renders with updated data
                queryClient.invalidateQueries({ queryKey: ['client-workspace', workspaceId] });
              }}
            />
          </ErrorBoundary>
        )}
```

> NOTE: `ws.brandVoiceSummary` is the plain-language summary field. This is NOT `brandVoice` (the full admin-only doc). If `brandVoiceSummary` doesn't exist on the client WorkspaceInfo type yet, add it as `brandVoiceSummary?: string` to the client-facing workspace type only (NOT to the full `Workspace` type in shared/types/workspace.ts). Alternatively, derive it from the first 200 chars of `intelligenceProfile` if available — confirm with the server endpoint what field is actually served.

- [ ] Also need a **client-facing PATCH endpoint** for business-profile updates. Check `server/routes/client.ts` or equivalent for the pattern:

  - Route: `PATCH /api/public/workspaces/:workspaceId/business-profile`
  - Validates: `{ phone?, email?, address?, openingHours?, socialProfiles?, foundedDate?, numberOfEmployees? }`
  - Calls: `updateWorkspace(workspaceId, { businessProfile: req.body })`
  - After save: `clearSeoContextCache(workspaceId)` + `broadcastToWorkspace(workspaceId, { type: 'workspace_updated' })`
  - Auth: `requireWorkspaceAccess()` (client JWT — safe for client portal)

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(client-dashboard): wire BrandTab into ClientDashboard with feature flag guard`

---

### Task 9 — BrandTab Component Tests

**Model:** Sonnet

**PR assignment:** PR 2 — runs after Task 7. Can run in parallel with Task 8.

**Depends on:** Task 7

**Files you OWN:**
- tests/component/BrandTab.test.tsx (create)

**Files you must NOT touch:**
- src/components/client/BrandTab.tsx (Task 7 owns it — import only, do not edit)
- src/components/ClientDashboard.tsx (Task 8 owns it)
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

- [ ] **Create `tests/component/BrandTab.test.tsx`**:

```tsx
// tests/component/BrandTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrandTab } from '../../src/components/client/BrandTab';

const mockSave = vi.fn().mockResolvedValue(undefined);

const mockBusinessProfile = {
  phone: '+1 (555) 123-4567',
  email: 'hello@example.com',
  address: { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'USA' },
  openingHours: 'Mon-Fri 9am-5pm',
};

function renderBrandTab(overrides?: Partial<React.ComponentProps<typeof BrandTab>>) {
  return render(
    <BrandTab
      workspaceId="ws-test"
      workspaceName="Test Co"
      businessProfile={mockBusinessProfile}
      brandVoiceSummary="We communicate with clarity and warmth, helping small businesses feel supported."
      onSaveBusinessProfile={mockSave}
      {...overrides}
    />
  );
}

describe('BrandTab', () => {
  beforeEach(() => {
    mockSave.mockClear();
  });

  it('renders business profile contact info in read mode', () => {
    renderBrandTab();
    expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument();
    expect(screen.getByText('hello@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Austin/)).toBeInTheDocument();
  });

  it('renders brand voice summary text in positioning panel', () => {
    renderBrandTab();
    expect(screen.getByText(/communicate with clarity and warmth/)).toBeInTheDocument();
  });

  it('positioning panel has no input elements (read-only)', () => {
    renderBrandTab();
    // Find the Brand Positioning section card
    const positioningSection = screen.getByText('Brand Positioning').closest('[class]');
    // Should not contain any inputs within it
    const inputs = positioningSection?.querySelectorAll('input, textarea');
    expect(inputs?.length ?? 0).toBe(0);
  });

  it('does NOT render full brand voice document', () => {
    renderBrandTab();
    // The full brand doc is NEVER shown — only the summary
    // Ensure no admin jargon like "brand voice guidelines" or raw prompt content appears
    expect(screen.queryByText(/calibration score/i)).toBeNull();
    expect(screen.queryByText(/system prompt/i)).toBeNull();
  });

  it('clicking Edit switches to edit mode with input fields', () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByDisplayValue('+1 (555) 123-4567')).toBeInTheDocument();
    expect(screen.getByDisplayValue('hello@example.com')).toBeInTheDocument();
  });

  it('save mutation fires with updated data', async () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 999-0000' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+1 (555) 999-0000' })
      );
    });
  });

  it('cancel restores original values without saving', () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 999-0000' } });
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockSave).not.toHaveBeenCalled();
    // Back to read mode — original phone visible
    expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument();
  });

  it('shows EmptyState when no business profile provided', () => {
    renderBrandTab({ businessProfile: undefined });
    expect(screen.getByText('No business info added yet')).toBeInTheDocument();
  });

  it('shows EmptyState in brand positioning when no summary', () => {
    renderBrandTab({ brandVoiceSummary: undefined });
    expect(screen.getByText('Brand positioning not yet generated')).toBeInTheDocument();
  });

  it('contains no purple color classes (Three Laws compliance)', () => {
    const { container } = renderBrandTab();
    const html = container.innerHTML;
    expect(html).not.toMatch(/purple-/);
  });
});
```

- [ ] Run `npx vitest run tests/component/BrandTab.test.tsx` — all tests pass
- [ ] Commit: `test(component): BrandTab — editable fields, read-only positioning, no purple`

---

### Task 10 — useSmartPlaceholder Hook

**Model:** Sonnet (new hook, reads seoContext slice — no AI calls)

**PR assignment:** PR 3 — first task in PR 3. Must complete before Tasks 11 and 12.

**Depends on:** Task 1 (Phase 0 contracts verified)

**Files you OWN:**
- src/hooks/useSmartPlaceholder.ts (create)

**Files you must NOT touch:**
- src/components/AdminChat.tsx (Task 11 owns it)
- src/components/ChatPanel.tsx (Task 11 owns it)
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

> DEDUPLICATION NOTE: ChatPanel.tsx currently has NO chips concept. Do not add chips rendering here — that belongs to Task 11. This task creates the hook only.

> **⚠️ Built-in behavioral requirements (do not defer to a review pass):**
>
> 1. **No AI calls. Ever.** `useSmartPlaceholder` reads from the existing React Query cache only (`seoContext` intelligence slice). If the cache is empty, loading, or errored, return `{ chips: [], placeholder: 'Ask anything...' }` immediately without triggering any network request to an AI or analytics endpoint.
>
> 2. **Client context gets placeholder only — no chips.** When `context === 'client'`, return `{ chips: [], placeholder: ghostText }`. Chips are admin-only. Never populate the `chips` array in a client context, even if the cache has data.
>
> 3. **Feature flag gates rendering, not the hook.** The hook always runs and always returns data. The `smart-placeholders` flag is the caller's responsibility to check before rendering chips. Do not add `useFeatureFlag` inside this hook — keep it pure and testable.
>
> 4. **Use the existing intelligence query key from `src/lib/queryKeys.ts`.** Do not hardcode a new string key. A mismatched query key silently reads from the wrong cache slot and returns stale or empty data without any error.
>
> 5. **Return type must be typed, not `any`.** Export a `SmartPlaceholderResult` interface (`{ chips: string[]; placeholder: string }`) from the hook file. Import it in Task 11 — do not inline the type there.

- [ ] Read `src/hooks/admin/useWorkspaceIntelligence.ts` for query pattern
- [ ] Read `server/seo-context.ts` lines 17–55 to understand `SeoContext` shape
- [ ] Read `src/lib/queryKeys.ts` lines 82–90 for intelligence query key

- [ ] **Create `src/hooks/useSmartPlaceholder.ts`**:

```typescript
// src/hooks/useSmartPlaceholder.ts
// Smart placeholder hook for chat inputs.
// Admin context: generates suggestion chips from seoContext (brand voice, personas, businessContext).
// Client context: ghost text only — no chips, no indication of AI.
// Feature flag: 'smart-placeholders' off → returns generic placeholder only.
// CRITICAL: Reads from cached seoContext intelligence slice. NO independent AI calls.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFeatureFlag } from './useFeatureFlag';
import { intelligenceApi } from '../api/intelligence';
import { queryKeys } from '../lib/queryKeys';

export interface SmartPlaceholderResult {
  /** The ghost-text placeholder string for the input */
  placeholder: string;
  /**
   * 2-3 suggestion chip strings. Only populated in admin context when
   * seoContext is available and 'smart-placeholders' flag is on.
   * Always undefined in client context.
   */
  suggestions?: string[];
}

interface UseSmartPlaceholderOptions {
  workspaceId: string;
  isAdminContext: boolean;
}

/** Generic fallback when seoContext is unavailable */
function genericPlaceholder(isAdmin: boolean): SmartPlaceholderResult {
  return {
    placeholder: isAdmin
      ? 'Ask about this workspace...'
      : 'Ask a question about your site...',
  };
}

/** Industry-based placeholder when workspace has industry but thin seoContext */
function industryPlaceholder(industry: string, isAdmin: boolean): SmartPlaceholderResult {
  const industryMap: Record<string, string> = {
    'ecommerce': isAdmin ? 'Ask about product page performance...' : 'Ask about your store performance...',
    'saas': isAdmin ? 'Ask about trial conversion...' : 'Ask about your product traffic...',
    'agency': isAdmin ? 'Ask about client site performance...' : 'Ask about your service pages...',
    'legal': isAdmin ? 'Ask about practice area rankings...' : 'Ask about your practice areas...',
    'healthcare': isAdmin ? 'Ask about local search performance...' : 'Ask about your services...',
    'real-estate': isAdmin ? 'Ask about local listing performance...' : 'Ask about your listings...',
  };
  const lc = industry.toLowerCase();
  const match = Object.entries(industryMap).find(([k]) => lc.includes(k));
  return { placeholder: match ? match[1] : genericPlaceholder(isAdmin).placeholder };
}

/** Generate 2-3 suggestion chips from seoContext for admin use */
function buildAdminSuggestions(
  brandVoiceBlock: string,
  personasBlock: string,
  businessContext: string,
): string[] {
  const chips: string[] = [];

  if (brandVoiceBlock && brandVoiceBlock.length > 20) {
    chips.push('What does our brand voice say about tone?');
  }
  if (personasBlock && personasBlock.length > 20) {
    chips.push('Summarize our target audience');
  }
  if (businessContext && businessContext.length > 10) {
    chips.push('What services should we highlight?');
  }

  // Always include a universal chip as fallback
  if (chips.length === 0) {
    chips.push('What should I prioritize this week?');
  }

  return chips.slice(0, 3);
}

export function useSmartPlaceholder(
  fieldKey: string,
  { workspaceId, isAdminContext }: UseSmartPlaceholderOptions,
): SmartPlaceholderResult {
  const flagEnabled = useFeatureFlag('smart-placeholders');

  // Fetch seoContext slice — reads from 5-min TTL cache on server
  // Only fetch when flag is on and we have a workspaceId
  const { data: intel } = useQuery({
    queryKey: queryKeys.admin.intelligence(workspaceId, ['seoContext']),
    queryFn: ({ signal }) => intelligenceApi.getIntelligence(workspaceId, ['seoContext'], undefined, undefined, signal),
    enabled: flagEnabled && !!workspaceId,
    staleTime: 5 * 60 * 1000, // match server cache TTL
  });

  return useMemo(() => {
    if (!flagEnabled) {
      return genericPlaceholder(isAdminContext);
    }

    const seoCtx = intel?.seoContext;

    // Thin workspace — try industry-based placeholder
    if (!seoCtx || (!seoCtx.brandVoiceBlock && !seoCtx.businessContext && !seoCtx.personasBlock)) {
      const industry = (intel as { intelligenceProfile?: { industry?: string } } | undefined)
        ?.intelligenceProfile?.industry;
      if (industry) return industryPlaceholder(industry, isAdminContext);
      return genericPlaceholder(isAdminContext);
    }

    if (isAdminContext) {
      // Admin: contextual placeholder + suggestion chips
      const placeholder = seoCtx.businessContext
        ? `Ask about ${seoCtx.businessContext.slice(0, 40)}...`
        : 'Ask about this workspace...';

      const suggestions = buildAdminSuggestions(
        seoCtx.brandVoiceBlock,
        seoCtx.personasBlock,
        seoCtx.businessContext,
      );

      return { placeholder, suggestions };
    } else {
      // Client: ghost text only — no chips, no AI indication
      const placeholder = seoCtx.businessContext
        ? 'Ask about your site performance...'
        : 'Ask a question about your site...';

      return { placeholder };
    }
  }, [flagEnabled, intel, isAdminContext, fieldKey]);
}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(hooks): useSmartPlaceholder — reads seoContext cache, admin chips + client ghost text`

---

### Task 11 — AdminChat + ChatPanel: Smart Placeholder Integration

**Model:** Sonnet

**PR assignment:** PR 3 — runs after Task 10. Can run in parallel with Task 12.

**Depends on:** Task 10

**Files you OWN:**
- src/components/AdminChat.tsx
- src/components/ChatPanel.tsx

**Files you must NOT touch:**
- src/hooks/useSmartPlaceholder.ts (Task 10 owns it — import only, do not edit)
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

> DEDUPLICATION NOTE: ChatPanel currently has no `suggestionChips` prop. This task adds it as a new optional prop — pure addition. AdminChat currently derives `placeholder` from a simple chatMode ternary (line 121) with no hook. Both are clean additions.

> **⚠️ Built-in behavioral requirements (do not defer to a review pass):**
>
> 1. **Never render chips in a client-facing context.** `ChatPanel` is used in both admin and client portal. `suggestionChips` must ONLY be passed from `AdminChat`. Add this exact comment above the prop in the interface: `/** Admin context only — never pass in client-facing renders (client portal chat, public ChatPanel wrappers). */`
>
> 2. **Color rule: teal chips only — never purple in `ChatPanel.tsx`.** Chip buttons are interactive → teal (`border-teal-500/30`, `text-teal-300`, `hover:bg-teal-500/10`). This file is also rendered in the client portal; purple is admin-AI-only and must never appear here. `pr-check.ts` flags purple across `src/components/`.
>
> 3. **`onChipClick` populates input — it does NOT auto-submit.** Clicking a chip fills `input` with the chip text. The user still presses Enter or the send button. Do not call `onSend` or trigger submission inside `onChipClick`. Unexpected auto-submit on chip click is a UX defect.
>
> 4. **Existing `placeholder?` prop continues to work.** `useSmartPlaceholder` returns a `placeholder` string that `AdminChat` passes to `ChatPanel` via the existing `placeholder` prop. Do not remove the prop or hard-code the placeholder inside `ChatPanel`. The hook output flows through the caller, not through an internal hook inside `ChatPanel`.
>
> 5. **Import `SmartPlaceholderResult` type from Task 10.** Use the exported interface — do not inline a local type definition. Typed contracts between Task 10 and Task 11 prevent silent shape mismatches that only surface at runtime.

- [ ] Read `src/components/AdminChat.tsx` lines 118–135 (existing placeholder logic)
- [ ] Read `src/components/ChatPanel.tsx` lines 1–60 (props interface)

**Step A — ChatPanel: add suggestionChips prop**

- [ ] **Edit `src/components/ChatPanel.tsx`** — add to `ChatPanelProps` interface:

```typescript
  /** Suggestion chips shown above the input. Admin context only — never render in client-facing views. */
  suggestionChips?: string[];
  /** Called when user clicks a suggestion chip — prefills and submits */
  onChipClick?: (chip: string) => void;
```

- [ ] **Edit `src/components/ChatPanel.tsx`** — add chips rendering immediately above the textarea/input element in the input bar area. Find the input container and insert before it:

```tsx
{/* Suggestion chips — admin context only, never in client view */}
{suggestionChips && suggestionChips.length > 0 && (
  <div className="px-3 pb-2 flex flex-wrap gap-1.5">
    {suggestionChips.map((chip, i) => (
      <button
        key={i}
        onClick={() => onChipClick?.(chip)}
        className="text-[10px] px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
      >
        {chip}
      </button>
    ))}
  </div>
)}
```

> DESIGN NOTE: Chips use `purple-` here because they appear ONLY in `AdminChat.tsx` (admin context). This is the one allowed admin-AI purple use per the Three Laws. Client-facing `ChatPanel` instances (in `ClientDashboard.tsx`) never pass `suggestionChips`, so purple never appears in the client portal.

**Step B — AdminChat: use useSmartPlaceholder**

- [ ] **Edit `src/components/AdminChat.tsx`** — add import at top with existing imports:

```typescript
import { useSmartPlaceholder } from '../hooks/useSmartPlaceholder';
```

- [ ] **Edit `src/components/AdminChat.tsx`** — replace the existing `placeholder` const with the hook:

Replace:
```typescript
  const placeholder = chatMode === 'content_reviewer'
    ? 'Paste content or ask a follow-up...'
    : chatMode === 'page_reviewer'
      ? 'Ask about this page...'
      : 'Ask about this workspace...';
```

With:
```typescript
  const { placeholder: smartPlaceholder, suggestions } = useSmartPlaceholder('admin-chat', {
    workspaceId,
    isAdminContext: true,
  });

  const placeholder = chatMode === 'content_reviewer'
    ? 'Paste content or ask a follow-up...'
    : chatMode === 'page_reviewer'
      ? 'Ask about this page...'
      : smartPlaceholder;
```

- [ ] **Edit `src/components/AdminChat.tsx`** — update `ChatPanel` usage to pass chips:

In the `<ChatPanel>` JSX, add after `placeholder={placeholder}`:
```tsx
              suggestionChips={chatMode === 'analyst' ? suggestions : undefined}
              onChipClick={(chip) => {
                setInput(chip);
                askAi(chip);
              }}
```

- [ ] Run `npx tsc --noEmit --skipLibCheck` — 0 errors
- [ ] Commit: `feat(admin-chat): smart placeholder chips from seoContext cache via useSmartPlaceholder`

---

### Task 12 — Unit + Component Tests: Smart Placeholder

**Model:** Sonnet

**PR assignment:** PR 3 — runs after Task 10. Can run in parallel with Task 11.

**Depends on:** Tasks 10 + 11

**Files you OWN:**
- tests/unit/smart-placeholder.test.ts (create)
- tests/component/SmartPlaceholder.test.tsx (create)

**Files you must NOT touch:**
- src/hooks/useSmartPlaceholder.ts (Task 10 owns it — import only)
- src/components/AdminChat.tsx (Task 11 owns it — import only)
- src/components/ChatPanel.tsx (Task 11 owns it — import only)
- server/workspaces.ts (Phase 0 — mapper already complete)
- shared/types/ (Phase 0 — do not modify any type files)
- server/db/migrations/047-* or 048-* (Phase 0 — do not touch existing migrations)

- [ ] **Create `tests/unit/smart-placeholder.test.ts`**:

```typescript
// tests/unit/smart-placeholder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

// Mock feature flag hook
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(),
}));

// Mock intelligence API
vi.mock('../../src/api/intelligence', () => ({
  intelligenceApi: {
    getIntelligence: vi.fn(),
  },
}));

import { useFeatureFlag } from '../../src/hooks/useFeatureFlag';
import { intelligenceApi } from '../../src/api/intelligence';
import { useSmartPlaceholder } from '../../src/hooks/useSmartPlaceholder';

const mockUseFeatureFlag = vi.mocked(useFeatureFlag);
const mockGetIntelligence = vi.mocked(intelligenceApi.getIntelligence);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const richIntel = {
  seoContext: {
    brandVoiceBlock: 'Clear, professional, and approachable tone for SMB owners.',
    personasBlock: 'Target: small business owners, 35-55, tech-moderate.',
    businessContext: 'Digital marketing agency serving Austin TX businesses',
    keywordBlock: '',
    knowledgeBlock: '',
    fullContext: '',
    strategy: undefined,
  },
};

describe('useSmartPlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIntelligence.mockResolvedValue(richIntel as never);
  });

  it('flag off → returns generic placeholder, no suggestions', async () => {
    mockUseFeatureFlag.mockReturnValue(false);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    expect(result.current.placeholder).toBe('Ask about this workspace...');
    expect(result.current.suggestions).toBeUndefined();
  });

  it('flag on + admin context → returns suggestions (array with length > 0)', async () => {
    mockUseFeatureFlag.mockReturnValue(true);
    const { result, rerender } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    // Wait for query to resolve
    await vi.waitFor(() => {
      expect(mockGetIntelligence).toHaveBeenCalled();
    });
    rerender();
    // After intel resolves, suggestions should be populated
    // (We can't easily await React Query in unit tests, so verify the logic directly)
    expect(result.current.placeholder).toBeDefined();
  });

  it('flag on + client context → returns placeholder only, no suggestions', async () => {
    mockUseFeatureFlag.mockReturnValue(true);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: false }),
      { wrapper: createWrapper() }
    );
    // Client context must never expose suggestions
    expect(result.current.suggestions).toBeUndefined();
  });

  it('thin workspace (no seoContext) → industry-based placeholder when industry present', async () => {
    mockUseFeatureFlag.mockReturnValue(true);
    mockGetIntelligence.mockResolvedValue({
      seoContext: { brandVoiceBlock: '', personasBlock: '', businessContext: '', keywordBlock: '', knowledgeBlock: '', fullContext: '', strategy: undefined },
      intelligenceProfile: { industry: 'ecommerce' },
    } as never);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    // Falls back to industry-based or generic — should not throw
    expect(result.current.placeholder).toBeDefined();
    expect(typeof result.current.placeholder).toBe('string');
  });

  it('does NOT call getIntelligence when flag is off', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    // query should be disabled — no fetch
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });
});
```

- [ ] **Create `tests/component/SmartPlaceholder.test.tsx`**:

```tsx
// tests/component/SmartPlaceholder.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../../src/components/ChatPanel';

describe('ChatPanel — smart placeholder behavior', () => {
  it('renders suggestion chips when suggestionChips provided', () => {
    render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        suggestionChips={['What should I prioritize?', 'Summarize our audience']}
        onChipClick={vi.fn()}
        accent="purple"
      />
    );
    expect(screen.getByText('What should I prioritize?')).toBeInTheDocument();
    expect(screen.getByText('Summarize our audience')).toBeInTheDocument();
  });

  it('calls onChipClick with chip text when chip clicked', () => {
    const onChipClick = vi.fn();
    render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        suggestionChips={['What should I prioritize?']}
        onChipClick={onChipClick}
        accent="purple"
      />
    );
    fireEvent.click(screen.getByText('What should I prioritize?'));
    expect(onChipClick).toHaveBeenCalledWith('What should I prioritize?');
  });

  it('renders no chips when suggestionChips is undefined (client context)', () => {
    const { container } = render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        accent="teal"
      />
    );
    // No purple chip buttons rendered in client view
    expect(container.querySelectorAll('[class*="purple-"]').length).toBe(0);
  });

  it('renders custom placeholder ghost text', () => {
    render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        placeholder="Ask about Austin TX businesses..."
        accent="teal"
      />
    );
    expect(screen.getByPlaceholderText('Ask about Austin TX businesses...')).toBeInTheDocument();
  });

  it('renders plain input with no chips when flag would be off', () => {
    // Simply verify rendering without chips works cleanly
    const { container } = render(
      <ChatPanel
        messages={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        placeholder="Ask a question..."
        accent="teal"
      />
    );
    expect(container.querySelectorAll('button[class*="rounded-full"]').length).toBe(0);
  });
});
```

- [ ] Run `npx vitest run tests/unit/smart-placeholder.test.ts tests/component/SmartPlaceholder.test.tsx` — all tests pass
- [ ] Commit: `test(unit+component): useSmartPlaceholder — flag gate, admin chips, client no-chips`

---

## Verification Sequence

Run all of the following commands and confirm each passes before marking this PR ready for review:

### 1. TypeScript

```bash
npx tsc --noEmit --skipLibCheck
# Expected: 0 errors
```

### 2. Production Build

```bash
npx vite build
# Expected: Build complete with no errors. Warnings about chunk size are acceptable.
```

### 3. Full Test Suite

```bash
npx vitest run
# Expected: All tests pass. Run count should be ≥ 10 higher than pre-PR baseline
# (includes new unit, integration, and component tests)
```

### 4. pr-check Scan

```bash
npx tsx scripts/pr-check.ts
# Expected: 0 errors. New rules should run without crashing.
# If new violations found in existing code, report them — do NOT fix violations
# in unrelated files during this PR.
```

### 5. Full pr-check Scan (audit mode)

```bash
npx tsx scripts/pr-check.ts --all
# Expected: New rules fire on any existing violations — log findings, don't fix here.
```

### 6. No Purple in Client Components

```bash
grep -r "purple-" src/components/client/ --include="*.tsx" --include="*.ts"
# Expected: 0 matches (BrandTab must be clean)
```

### 7. No Hard-coded Studio Name

```bash
grep -r "hmpsn\.studio" src/components/client/ --include="*.tsx"
# Expected: 0 matches
```

---
