# Duplication Audit Catalog — Design Spec

**Date:** 2026-04-21
**Status:** Catalog (meta-spec) — each cluster below becomes its own spec → plan → PR in a follow-up session.
**Related prior art:** [`docs/superpowers/plans/2026-04-21-unified-page-join-hooks.md`](../plans/2026-04-21-unified-page-join-hooks.md), [`docs/superpowers/plans/2026-04-21-broadcast-invalidation-audit.md`](../plans/2026-04-21-broadcast-invalidation-audit.md)

---

## Purpose

Catalog duplicative and hand-rolled functions across the hmpsn.studio platform so each cluster can be unified in a targeted PR. This document is an **index of future work**, not an implementation plan. It exists because the team has been shipping fast enough that duplication has outrun centralization, and bugs have started repeating in sibling code paths (the `pageMap` matching drift that motivated the unified-page-join plan is the canonical example).

This document is NOT itself a plan. Do not execute clusters from it directly — each Tier 1/2 cluster must pass through the normal spec → pre-plan-audit → plan → PR pipeline. The catalog's job is to make the work visible, prioritized, and deduplicated against existing plans.

---

## Methodology

Three parallel audit agents swept the codebase with these scopes:

1. **Semantic clones** — different code, same job, divergent rules (the high-value case).
2. **AI prompt assembly / authority-chain violations** — the `formatBrandVoiceForPrompt` class of landmine.
3. **Hand-rolled state primitives + parallel admin/client implementations.**

Agent findings were then manually spot-verified (grep + Read against live source) before landing in the catalog below. Three clusters that failed verification were dropped:

- **`useState<Set>` hand-rolled toggles** — ZERO matches in `src/`. The CLAUDE.md rule is being followed.
- **`parseJsonFallback` duplication** — function does not exist; `parseJsonSafe`/`parseJsonSafeArray` is canonical and widely used.
- **`EditState` interface shared across only 2 files** — too small to warrant its own plan; fold into a future form-primitive plan if ever needed.

### Known-covered clusters (explicitly excluded)

- **Page ↔ strategy matching** — covered by [`2026-04-21-unified-page-join-hooks.md`](../plans/2026-04-21-unified-page-join-hooks.md)
- **Broadcast → React Query cache invalidation** — covered by [`2026-04-21-broadcast-invalidation-audit.md`](../plans/2026-04-21-broadcast-invalidation-audit.md)
- **Anything already mechanized by `scripts/pr-check.ts`** — see [`docs/rules/automated-rules.md`](../../rules/automated-rules.md)

---

## Tier 1 — High value (confirmed divergence, multiple sites, material bug surface)

### Cluster 1. Score color / label bucketing

**Sites (verified):**
- [src/components/ui/constants.ts:10](../../../src/components/ui/constants.ts) — canonical frontend `scoreColor()` + `scoreColorClass()`, 80/60 two-threshold tiering, Tailwind classes
- [server/email-templates.ts:611](../../../server/email-templates.ts) — 80/60 thresholds, hex palette `#059669` / `#d97706` / `#dc2626`
- [server/email-templates.ts:814](../../../server/email-templates.ts) — 80/60 thresholds, **different** hex palette `#4ade80` / `#fbbf24` / `#f87171` (two conflicting palettes *within the same file*)
- [server/sales-report-html.ts:8](../../../server/sales-report-html.ts) — own `scoreColor()` + own `scoreLabel()` function
- [server/reports.ts:458](../../../server/reports.ts) — **four**-bucket variant (80/60/40) with a third hex palette

**Divergence observed:** Both the threshold count (3-tier vs 4-tier) and the hex values differ between callsites. The same numeric score renders in different colors depending on whether the user is looking at an email, a sales report, or the dashboard.

**Unified primitive sketch:** `shared/lib/scoreColors.ts` exporting:
- `scoreBucket(score): 'excellent' | 'good' | 'warn' | 'poor'` (canonical 4-tier enum)
- `scoreHex(score, palette: 'email-light' | 'email-dark' | 'report' | 'dashboard'): string`
- `scoreLabel(score): string`
- `scoreTailwindClass(score): string` (wraps existing `scoreColorClass`)

**Bug surface:** User-facing color inconsistency across comms surfaces undermines visual trust. A 60 is amber on the dashboard, green in one email template, and orange in a sales report.

**Effort:** M — shared lib + 5 callsite migrations + snapshot tests for each palette.

---

### Cluster 2. OpenAI SDK bypass for vision endpoints

**Sites (verified):**
- [server/alttext.ts:15](../../../server/alttext.ts) — `new OpenAI()` direct instantiation; lines 34–57 hand-roll exponential backoff retry + 500ms throttle
- [server/routes/misc.ts:128](../../../server/routes/misc.ts) — `new OpenAI()` direct instantiation for smart-naming; no retry, no throttle

**Divergence observed:** alttext and smart-naming both do OpenAI vision work but with different rate-limit resilience (alttext has retry + throttle; smart-naming does not). Neither goes through `callAI()` → both miss shared telemetry, Sentry wrapping, and voice-authority context injection that `buildSystemPrompt` would have supplied.

**Unified primitive sketch:** Extend `server/ai.ts` `callAI()` to accept `kind: 'vision'` with multimodal content (image + text). Migrate both sites to route through it. Retry + throttle policy becomes centralized in `openai-helpers.ts`.

**Bug surface:**
- Rate-limit bugs must be fixed twice (and so far, only alttext got the fix).
- Vision prompts bypass the voice-authority chain entirely — alt-text and smart file naming for a calibrated-voice workspace currently ignore that workspace's voice DNA.
- Any future telemetry dashboard for AI usage will miss vision calls.

**Effort:** M — requires extending the dispatcher signature (shared contract), then migrating 2 callsites, then adding a pr-check rule that bans `new OpenAI(`/`new Anthropic(` outside `server/ai.ts` + `openai-helpers.ts` + `anthropic-helpers.ts`.

---

### Cluster 3. Activity-log payload construction

**Sites (verified):**
- [server/routes/approvals.ts:256](../../../server/routes/approvals.ts) — structured metadata: `{ batchId, itemId, pageId }`
- [server/routes/approvals.ts:309](../../../server/routes/approvals.ts) — different shape in the *same file* for a different activity type
- [server/routes/aeo-review.ts:134](../../../server/routes/aeo-review.ts) — score embedded in free-text `description` string, not in metadata
- [server/routes/ai.ts:120](../../../server/routes/ai.ts) — `"Admin chat:"` prefix pattern in description
- Likely more sites — every route that calls `addActivity()` builds its payload ad-hoc

**Divergence observed:** No shared builders. Some activities put structured data in metadata (queryable); others embed it in free-text descriptions (not queryable). Analytics queries over activities have inconsistent shape — a dashboard that tries to count "approvals applied per batch" has to also regex-parse description strings for the activity types that didn't use metadata.

**Unified primitive sketch:** `server/activity-builders.ts` exporting type-safe factories keyed by activity type:
```typescript
export const activityBuilders = {
  approvalApplied: (wsId, batchId, itemId, pageId) => ({ type: 'approval_applied', title: ..., description: ..., metadata: { batchId, itemId, pageId } }),
  aeoCompleted: (wsId, score, pageCount) => ({ ..., metadata: { score, pageCount } }),
  adminChat: (wsId, messagePreview) => ({ ..., metadata: { messagePreview } }),
  // ...
};
```
Route handlers call `addActivity(activityBuilders.approvalApplied(...))`. Shared Zod schema validates metadata shape per type.

**Bug surface:** Activity-feed search / filter / analytics silently drops activities whose context is in description strings instead of metadata. This breaks cross-type aggregation in any reporting surface.

**Effort:** M — type the full activity taxonomy first (probably 15–20 activity types), then migrate ~30+ callsites. Worth a shared Zod schema + pr-check rule banning inline `addActivity({ type: ..., metadata: ... })` outside the builders file.

---

### Cluster 4. Bulk-progress tracking + UI rendering

**Sites (to re-verify at plan-writing time):**
- [src/components/PageIntelligence.tsx](../../../src/components/PageIntelligence.tsx) — bulk analyze progress
- [src/components/SeoEditor.tsx](../../../src/components/SeoEditor.tsx) — bulk analyze + bulk rewrite progress (two separate states)
- [src/components/AssetBrowser.tsx](../../../src/components/AssetBrowser.tsx) — bulk asset ops progress
- [src/components/AssetAudit.tsx](../../../src/components/AssetAudit.tsx) — bulk alt-text + bulk compress progress (two separate states)

**Divergence observed:** Each component tracks `{ done, total }` locally, handles WebSocket progress events, renders a bar, and clears state on complete. Minor but real differences in cleanup timing and division-by-zero handling.

**Unified primitive sketch:**
- Hook: `useBulkProgress(jobId: string | null)` returning `{ progress, reset, percent }` with safe `percent` (handles `total === 0`)
- Component: `<BulkProgressOverlay progress={...} label="Analyzing X of Y" onCancel={...} />` in `src/components/ui/`
- Co-locate with the existing `BULK_OPERATION_PROGRESS` / `_COMPLETE` / `_FAILED` events — these are already exempted from the central `useWsInvalidation` hook per the broadcast-invalidation plan because they key off component-local `jobId` state. This hook owns that coupling correctly.

**Bug surface:** Division-by-zero when `total === 0`; inconsistent cancel support; cleanup races when one job finishes while another starts in the same component.

**Effort:** M — file:line claims from the audit agent were imprecise on this cluster; a pre-plan-audit for this specific cluster should re-verify each callsite before planning.

---

## Tier 2 — Real, smaller scope (each is ~S effort; can bundle)

### Cluster 5. Per-item loading-flag state (`Record<string, boolean>`)

**Sites:**
- `src/components/CmsEditor.tsx:97` — `aiLoading: Record<string, boolean>`
- `src/components/client/AnalyticsTab.tsx:54` — `modulePageLoading`
- `src/components/PageRewriteChat.tsx:20` — `msgEdits`
- `src/components/brand/VoiceTab.tsx` — `localRatings`, `localFeedback`

**Primitive:** `usePerItemFlag(initial?)` → `[flags, toggle(id), set(id, v), clear()]` in `src/hooks/`.

**Effort:** S.

---

### Cluster 6. Session-ID generator

**Sites:**
- `src/components/AdminChat.tsx` — ``as-${Date.now()}-${Math.random()...}``
- `src/components/PageRewriteChat.tsx:20` — ``rewrite-${Date.now()}-${Math.random()...}``

**Primitive:** `useSessionId(prefix: string)` in `src/hooks/`. Stable across re-renders, testable.

**Effort:** S.

---

### Cluster 7. URL `?tab=` sync logic

**Sites:**
- `src/components/ContentPipeline.tsx:52`
- `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx`
- `src/components/SeoAudit.tsx:63`

**Context:** A contract test at `tests/contract/tab-deep-link-wiring.test.ts` already enforces the *receiver side* of the two-halves contract (CLAUDE.md UI/UX rule #11). Each of the three sites implements the read/initialize/clear-on-manual-change logic independently.

**Primitive:** `useUrlTabSync(tabs, defaultTab, paramKey?)` → `[tab, setTab]` with implicit param initialization + clear-on-manual-change.

**Effort:** S. **Coordination note:** this plan should update the contract test to additionally check that receivers call `useUrlTabSync` rather than hand-rolling, so future additions can't drift.

---

### Cluster 8. Diagnostic orchestrator voice-context bypass

**Sites (needs 30-minute confirmation audit):**
- [server/diagnostic-orchestrator.ts](../../../server/diagnostic-orchestrator.ts) — calls `buildWorkspaceIntelligence(...)` but (per audit inference) the synthesis `callOpenAI` at a later line may not pass `seoContext.effectiveBrandVoiceBlock` as system context.

**Bug surface (if confirmed):** Diagnostic synthesis AI output may contradict calibrated workspace brand voice — tone, terminology, format — because it's missing the pre-resolved authority form that every other generator uses.

**Primitive:** pass `slice.effectiveBrandVoiceBlock` into the synthesis system prompt. No new infrastructure; single-file fix.

**Effort:** S. The confirmation audit *is* the pre-plan work here.

---

## Tier 3 — Speculative, audit before planning

### Cluster 9. Admin vs client insight renderers

Audit agent could not confirm an explicit parallel pair; the duplication may be intentional framing separation (per CLAUDE.md "Client vs admin insight framing" rule — client must use narrative, no purple, premium wrapped in `<TierGate>`). A dedicated exploration session should confirm whether a shared base renderer + `mode: 'admin' | 'client'` prop is feasible without violating the framing rule, or whether the split is load-bearing.

### Cluster 10. Admin vs client analytics hook pair

`src/hooks/admin/useAnalyticsOverview.tsx` vs `src/hooks/client/useClientGA4.ts` — touch the same endpoints with different transforms. Unclear if the transform split is deliberate (client gets pre-narrativized data) or accidental. Dedicated exploration session to determine.

---

## Recommended Dispatch Order

Each Tier 1/2 cluster becomes its own spec → plan → PR in a dedicated session. Tier 3 clusters require an exploration session first.

### Wave 1 — highest ROI, independent, ship in any order

1. **Cluster 1 (score colors)** — 2–3 hours, fixes visible cross-surface inconsistency
2. **Cluster 2 (OpenAI vision bypass)** — 3–4 hours, closes real telemetry + retry + voice-authority gap
3. **Clusters 5 + 6 + 7 bundled as "shared interaction hooks"** — ~3 hours total, one PR with three small hook extractions

### Wave 2 — more design work needed, schedule after Wave 1 lands

4. **Cluster 3 (activity builders)** — requires typing the full activity taxonomy before any migration starts; run a pre-plan-audit sweep to enumerate every `addActivity(` callsite and classify by type before writing the plan
5. **Cluster 4 (bulk progress)** — file:line claims need re-verification; run a pre-plan-audit confirming exact state-variable names and WebSocket event subscription shapes before writing the plan

### Wave 3 — confirmation audit first, then plan

6. **Cluster 8 (diagnostic voice bypass)** — 30-minute audit session to confirm the bypass, then a ~1-hour fix plan
7. **Cluster 9, 10 (admin/client parallel)** — dedicated exploration sessions. May or may not produce a plan depending on whether duplication is real vs. intentional framing.

---

## CLAUDE.md rules to check against each future plan

For every cluster that graduates to a plan, the author must verify against these rules before dispatch:

1. **Shared contracts before parallel dispatch** (Multi-Agent Coordination) — e.g. Cluster 3's `activity-builders.ts` type taxonomy must be pre-committed before any route-migration agent starts.
2. **Exclusive file ownership per parallel agent** — Cluster 4 touches 4 component files; assign one agent per file or one agent total.
3. **pr-check rule to prevent regression** (follow the pattern from both reference plans) — Clusters 1, 2, 3, 5, 6 all warrant a new mechanized rule so the next component that tries to hand-roll the duplicated pattern fails CI.
4. **Contract test for shape invariants** (follow the `ws-invalidation-coverage.test.ts` pattern) — Cluster 3 should have a contract test asserting every activity type in the taxonomy has a builder.
5. **FEATURE_AUDIT.md + roadmap.json + BRAND_DESIGN_LANGUAGE.md updates** (Quality Gates) — per the post-task checklist.
6. **Authority-chain rule** (CLAUDE.md "Authority-layered fields — expose one resolved representation") — Cluster 2's voice-authority injection into vision prompts MUST read from `slice.effectiveBrandVoiceBlock`, not raw `workspace.brandVoice`. This is the PR #167/#168 lesson.

---

## Out of Scope for This Catalog

- Any cluster covered by an existing plan (page-join, broadcast-invalidation)
- Any pattern already mechanized by `scripts/pr-check.ts`
- Refactoring for refactoring's sake — every cluster above has a concrete bug surface beyond "it's duplicated"
- Tier 3 clusters that require dedicated exploration before producing a plan
- Performance / bundle-size refactors (different audit)

---

## Follow-up Questions for Future Exploration Sessions

Things the audit pass surfaced but didn't conclusively answer:

1. Are there duplicate `rowToX()` mappers across `server/db/` that share identical field lists and should use a shared base? (Audit agent inferred but didn't verify.)
2. Are there `getOrCreate*` / `upsert*` functions with identical shapes that should share a generic? (Similar — inferred, not verified.)
3. Is there a parallel audit worth running on `server/schemas/` for Zod schemas that redefine types already in `shared/types/`?
4. Is there drift between the 12 modules in `src/api/`? (Not audited this pass.)
5. Are there migration-file patterns in `server/db/migrations/` that repeat scaffolding?

These are candidates for a Round 2 audit session once the Tier 1 Wave 1 clusters ship.

---

## Maintenance Note

This catalog is a snapshot. Once the Wave 1 clusters ship (Clusters 1, 2, 5, 6, 7), this document should be updated to strike them through or move them to an "Completed" section. When new duplication is identified during regular development, add it here as a new cluster rather than filing a standalone doc — keeps the index centralized.

If more than half the catalog ships within a single sprint, the leftover clusters should be promoted into active roadmap items (`data/roadmap.json`) rather than lingering here.
