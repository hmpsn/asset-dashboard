# Client IA — P3: Re-home the content-plan surface into Deep Dive › Rankings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Controller commits; subagents never git-write.

**Goal:** Under `client-ia-v2`, the content-plan roadmap (matrix) + per-cell flag surface — orphaned by the P2 nav collapse (it's not in the 4-tab nav and not folded anywhere) — is re-homed as a **default-collapsed section in Deep Dive › Rankings**, so a hands-on client can still see the content roadmap and flag cells. Content **brief/post review already works in Inbox** (ProjectedReviewModal) — P3 changes nothing there.

**Architecture finding (pre-plan scan):** Under IA v2 (nav = Overview · Inbox · Results · Deep Dive · Settings), tracing every content path:
- **Brief/post review → ALREADY reachable** in Inbox › Reviews (a `content_request` deliverable → "Review" → ProjectedReviewModal → ContentTab solo-mode with the full deep editor). No change.
- **Schema review → ALREADY reachable** (SchemaReviewModal). No change.
- **Content-plan roadmap VIEW + per-cell flag → ORPHANED** (only via the off-nav `content-plan` tab). ← the only thing P3 fixes.
- Content-plan cells have flag/comment only (no approve/decline action), so this is a *view + flag* re-home, NOT a new Inbox-deliverable projection (that would be a much larger change and isn't warranted by the cell model).

**Architecture:** Reuse the existing `ContentPlanTab` verbatim as a ReactNode slot (same slot pattern as P2). Add an optional `contentPlanSlot?: ReactNode` to `DeepDiveTab`, rendered as a default-collapsed `<details>` section UNDER the Rankings `rankingsSlot` (StrategyTab). `ClientDashboard` composes `<ContentPlanTab .../>` into that slot ONLY when a plan exists (`contentPlanSummary.totalCells > 0`) and `client-ia-v2` is ON; otherwise `undefined` (section absent). Flag-OFF: the standalone `content-plan` tab + nav entry are unchanged (byte-identical) — the slot is only populated under IA v2.

**Scope source:** `docs/superpowers/audits/2026-06-21-client-ia-preplan-audit.md` + the P3 architecture scan. **Depends on:** P2 merged to staging.

**Out of scope:** any change to content brief/post review (works in Inbox); a new Inbox-deliverable type for content-plan cells (cell model is flag-only); Share/Export + attribution (P4).

---

## Task 0: Extend DeepDiveTab with the collapsed content-plan slot

**Files:** `src/components/client/DeepDiveTab.tsx`, `tests/component/client/DeepDiveTab.test.tsx`

- [ ] **Step 1:** Add `contentPlanSlot?: React.ReactNode` to `DeepDiveTabProps`. In the **Rankings** sub-tab render, after `rankingsSlot`, render (only when `contentPlanSlot != null`) a default-collapsed `<details>` section titled "Content roadmap" using the same `<details>`/`<summary>` chrome as `TheIssueClientPage`'s "Under the hood" block (token classes, `group-open:rotate-180` chevron, `t-label text-[var(--brand-text-muted)] uppercase tracking-wider`). Wrap `contentPlanSlot` in an `ErrorBoundary`.
- [ ] **Step 2:** Test (extend `DeepDiveTab.test.tsx`): with a `contentPlanSlot` provided, the Rankings sub-tab shows a collapsed "Content roadmap" `<details>` (closed by default — assert the summary present, slot content behind it); Analytics sub-tab does NOT show it; with `contentPlanSlot` omitted, no "Content roadmap" section anywhere. Run red→green.
- [ ] **Step 3: Commit** `feat(client-ia): DeepDive Rankings gains a collapsed content-roadmap slot (P3)`.

---

## Task 1: Compose ContentPlanTab into the slot from ClientDashboard

**Files:** `src/components/ClientDashboard.tsx`, `tests/component/client/ClientDashboard.iaV2.test.tsx` (extend)

- [ ] **Step 1:** In the `deep-dive` panel, pass `contentPlanSlot` to `DeepDiveTab`: when `clientIaV2 && contentPlanSummary && contentPlanSummary.totalCells > 0`, compose `<LazyClientTabPanel><ErrorBoundary label="Content Plan"><ContentPlanTab workspaceId={workspaceId} setToast={setToast} /></ErrorBoundary></LazyClientTabPanel>` (the EXACT props the existing `content-plan` panel uses); else pass `undefined`. (`ContentPlanTab` is already a lazy import — keep the Suspense wrapper.)
- [ ] **Step 2:** Extend `ClientDashboard.iaV2.test.tsx`: with `client-ia-v2` ON + a workspace whose `contentPlanSummary.totalCells > 0`, rendering `initialTab: 'deep-dive'` + switching to Rankings shows the collapsed "Content roadmap" with the ContentPlanTab stub; with `totalCells === 0`, the section is absent. (Mock ContentPlanTab as a stub like the other folded children.) Run red→green.
- [ ] **Step 3: Commit** `feat(client-ia): re-home content-plan roadmap into DeepDive Rankings under IA v2 (P3)`.

---

## Task 2: Guard that content review stays reachable in Inbox (regression contract)

**Files:** `tests/component/client/ClientDashboard.iaV2.test.tsx` (extend) OR a focused inbox test

- [ ] **Step 1:** Add an assertion that under `client-ia-v2` ON, `initialTab: 'inbox'` mounts UnifiedInbox with the Reviews filter reachable (the brief/post review path is preserved by IA v2 — it must not regress). Lightweight: assert the Inbox panel mounts + the reviews filter is selectable. Run red→green (likely green; this is a guard).
- [ ] **Step 2: Commit** `test(client-ia): guard content review stays reachable in Inbox under IA v2 (P3)`.

---

## Task 3: Verification gate

- [ ] `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:feature-flags && npm run verify:coverage-ratchet` — all green.
- [ ] **Flag-OFF byte-identical:** the standalone `content-plan` tab + nav entry unchanged when `client-ia-v2` OFF (the slot is only populated under the flag).
- [ ] **scaled-code-review** (multi-agent) → fix Critical/Important.
- [ ] **Docs:** `FEATURE_AUDIT.md` (#600), `data/roadmap.json` (P3 built; `sort-roadmap`), `BRAND_DESIGN_LANGUAGE.md` only if a new pattern (the collapsed section reuses the under-the-hood chrome → likely no change).
- [ ] **PR → staging**, CI green, merge. Then P4.

---

## Self-Review

- **Spec coverage:** roadmap VIEW + cell-flag re-homed to Deep Dive › Rankings (collapsed) — the only orphaned content surface. Brief/post review confirmed already in Inbox (Task 2 guards it). The tournament's "per-page approvals → Inbox" is N/A (cells are flag-only; real approvals are briefs/posts already in Inbox).
- **Flag-OFF parity:** slot only populated under `client-ia-v2` + a plan; standalone content-plan tab untouched.
- **Reuse, not rewrite:** ContentPlanTab mounted verbatim as a slot (lowest risk).

## Execution Handoff

Subagent-driven (small phase). Task 0 (DeepDiveTab slot) → Task 1 (ClientDashboard compose) → Task 2 (inbox guard) → gate. One PR into staging.
