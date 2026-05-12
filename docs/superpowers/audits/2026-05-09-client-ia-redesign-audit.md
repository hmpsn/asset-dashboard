# Client IA Redesign — Phase 1 Pre-Plan Audit

**Date:** 2026-05-09
**Spec:** `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md`
**Scope:** Phase 1 only (re-route existing data into the new IA + cross-cutting deprecations + basic Wins surface)
**Method:** Four parallel Explore agents + targeted verification greps

---

## 1. Scope Summary

Phase 1 touches the client Inbox, the Insights page, every admin "send to client" entry point, three deprecation paths (`feedback`, `keyword_strategy`, "we called it"), and one type enrichment (`AeoChangeDiff`). Total estimated file surface area: **~40 files modified, ~10 files created, ~4 files deleted**, plus tests, types, migrations, and pr-check rules.

---

## 2. Findings by Category

### 2.1 Inbox restructure — current files in scope

The current `InboxTab` and its sub-components total **~5,300 lines across 11 component files** plus tests. Phase 1 keeps all sub-component renderers (PostReviewCard, ClientCopyReview, SchemaReviewTab, etc.) intact and re-routes them under the new section structure.

| File | Lines | Phase 1 disposition |
|------|------:|---------------------|
| `src/components/client/InboxTab.tsx` | 746 | **Major rewrite** — restructure to 3 sections (Decisions/Reviews/Conversations); remove in-Inbox PriorityStrip; add header "Wins this week →" link |
| `src/components/client/ApprovalsTab.tsx` | 603 | **Adapt** — render under Decisions; preserve approval batch logic |
| `src/components/client/RequestsTab.tsx` | 333 | **Refactor** — re-frame as Conversations; status mapping (6 → 4 client states); category badge; "Team replied" synthesis |
| `src/components/client/ContentTab.tsx` | 739 | **Split** — briefs/posts/copy → Reviews section; in-progress items → Reviews "Coming soon" footer |
| `src/components/client/ContentPlanTab.tsx` | 164 | **Re-route** — content plan cells with brief/outline → Reviews; topic-only cells → Decisions |
| `src/components/client/ClientActionDetailModal.tsx` | 369 | **Major rewrite** — implement trust-first primitive (bulk mode); per-sourceType renderers continue but new shell + footer |
| `src/components/client/SchemaReviewTab.tsx` | 374 | **Re-route** — surfaces in Reviews (renderer body); approval action remains |
| `src/components/client/SchemaReviewModal.tsx` | 57 | **Adapt** — wrap inside the Reviews modal shell |
| `src/components/client/PostReviewCard.tsx` | 487 | **Adapt** — render inside Reviews modal shell |
| `src/components/client/ClientCopyReview.tsx` | 581 | **Adapt** — render inside Reviews modal shell |
| `src/components/client/PriorityStrip.tsx` | 80 | **Delete** (in-Inbox usage); keep file if reused on Insights/Overview |

### 2.2 Routes and filter chip definitions

| File | Lines | Change required |
|------|------:|-----------------|
| `src/components/client/InboxTab.tsx` | 41–47 | `InboxFilter` type, `INBOX_FILTER_VALUES`, `LEGACY_FILTER_MAP`, `isInboxFilter` — replace `'all' \| 'needs-action' \| 'seo-changes' \| 'content'` with `'all' \| 'decisions' \| 'reviews' \| 'conversations'` |
| `src/routes.ts` | 25–36, 49–54 | `ClientInboxAlias` type, `CLIENT_INBOX_ALIASES`, `isClientInboxAlias`, `clientPath()` — update mapping (`approvals → decisions`, `requests → conversations`, `content → reviews`) |
| `src/components/client/InboxTab.tsx` | 161–180 | `useEffect` for `?tab=` parsing — extend `LEGACY_FILTER_MAP` with old → new mapping |
| `scripts/pr-check.ts` (rule 86 `inbox-legacy-filter-literal`) | — | Update forbidden literals; add new section names to allow-list |

### 2.3 WebSocket event handlers

Already wired and reusable — no schema changes needed:

| Event | Listener (current) | Phase 1 disposition |
|-------|-------------------|---------------------|
| `APPROVAL_BATCH_UPDATED` | InboxTab `useWorkspaceEvents` | Keep — invalidate Decisions queries |
| `REQUEST_CREATED` | InboxTab | Keep — invalidate Conversations queries |
| `CONTENT_REQUEST_CREATED` | InboxTab | Keep — invalidate Reviews queries |
| `SCHEMA_PLAN_UPDATED` | InboxTab | Keep — invalidate Reviews (Schema Plan now lives there) |
| `COPY_SECTION_UPDATED` | ClientCopyReview | Keep — unchanged |
| `CLIENT_ACTION_UPDATE` | (used by ClientActionDetailModal flows) | Keep — invalidate Decisions queries |

### 2.4 Admin send-to-client buttons (one-button + optional-note collapse)

All Phase 1 candidates for the §5.2 platform-wide convention. Six entry points create `client_actions`; multiple paths create `approval_batches`.

| File | Line(s) | Current button | Creates | Note field today | Phase 1 change |
|------|--------:|----------------|---------|------------------|----------------|
| `src/components/AeoReview.tsx` | 386 | "Send to client" | `client_action` (`aeo_change`) | No | Add optional note field; enrich payload (§5.3) |
| `src/components/ContentDecay.tsx` | 248–259 | "Send to Client" | `client_action` (`content_decay`) | No | Add optional note field |
| `src/components/InternalLinks.tsx` | 197–199 | "Send to Client" | `client_action` (`internal_link`) | No | Add optional note field |
| `src/components/RedirectManager.tsx` | 171–193 (cb), 365 (btn) | "Send to Client" | `client_action` (`redirect_proposal`) | No | Add optional note field |
| `src/components/KeywordStrategy.tsx` | 334 | "Send to Client" | `client_action` (`keyword_strategy`) | No | **Remove the button entirely** (deprecation §5.4) |
| `src/components/audit/AuditIssueRow.tsx` | 135 (Send for Review), 166–189 (inline flag form, **already has note field**), 304 (overflow Send to Client) | "Send for Review" + "Flag for Client" double-button | `approval_batch` | **YES already exists** (`flagNote` state) | Collapse to one button; reuse existing note state |
| `src/components/SeoAudit.tsx` | (parent of AuditIssueRow) | wraps the double-button | `approval_batch` | YES via AuditIssueRow | Mirror the collapse |
| `src/components/schema/BulkPublishPanel.tsx` | 43–49 | "Send to Client" | `approval_batch` | No | Add optional note field |
| `src/components/schema/SchemaPageCard.tsx` | 419–430 | "Send to Client" | `approval_batch` | No | Add optional note field |
| `src/components/schema/SchemaPlanPanel.tsx` | 265–273 | "Send to Client" | `approval_batch` | No | Add optional note field; routes to Reviews not Decisions |
| `src/components/editor/useSeoEditorApprovalWorkflow.ts` | 57–92 (sendPageToClient), 94–121 (sendForApproval) | "Send for Review" / "Send for Approval" | `approval_batch` | No | Add optional note field; same routing rule |
| `src/components/cms-editor/useCmsEditorApprovalWorkflow.ts` | 64–100 | "Send for Approval" | `approval_batch` | No | Add optional note field |
| `src/components/brand/CopyReviewPanel.tsx` | 312, 363 | "Send to Client Review" | (status update; not approval batch) | No | Different path — confirm whether to add note field; routes to Reviews |
| `src/components/briefs/BriefDetail.tsx` | 62–65 | "Send to Client" | (verify — possibly client_action) | Unknown | Confirm path; add optional note field |

### 2.5 AeoChangeDiff payload enrichment (§5.3)

| File | Line | Change |
|------|-----:|--------|
| `shared/types/client-actions.ts` | (`AeoChangeDiff` type def) | Add `rationale?: string`, `effort?: 'low' \| 'medium' \| 'high'`, `priority?: 'high' \| 'medium' \| 'low'` |
| `src/components/AeoReview.tsx` | 386 (sendPageToClient) | Map `AeoPageChange` source data → `AeoChangeDiff` enriched fields at send-time |
| `src/components/client/ClientActionDetailModal.tsx` | (aeo_change renderer) | Render `rationale` inline on row expand; do NOT render `effort` or `priority` (hidden per §5.3) |
| `tests/integration/client-actions-routes.test.ts` | (fixtures) | Update aeo_change fixture to include enriched fields |

### 2.6 `feedback` table retirement (§3.5 Rule 4 / §5.1)

Confirmed: `FeedbackWidget` is **client-facing**, mounted in `ClientDashboard.tsx:916`. Full removal is in scope.

| File | Disposition |
|------|-------------|
| `src/components/ClientDashboard.tsx` (line 30 import, line 916 mount) | Remove import and mount |
| `src/components/client/FeedbackWidget.tsx` | Delete |
| `src/components/client/index.ts` (line 4) | Remove export |
| `src/components/client/ClientChatWidget.tsx` (lines 28, 91 — `chatExpanded` callback for FeedbackWidget) | Remove the callback wiring |
| `server/routes/feedback.ts` | Delete |
| `server/routes/public-feedback.ts` | Delete |
| `server/app.ts` | Remove route registrations for `/api/feedback/*` and `/api/public/feedback/*` |
| `shared/types/feedback.ts` (if exists) | Delete |
| Migration: new file | Migrate `feedback` rows → `requests` (`category: 'general'`); drop `feedback` table after one-release grace period |
| `tests/integration/feedback-routes.test.ts` | Delete |
| Any hook in `src/hooks/` referencing feedback | Delete (Agent 4 noted possible existence — verify during plan) |

### 2.7 `keyword_strategy` client_action deprecation (§3.5 Rule 3 / §5.4)

| File | Line | Change |
|------|-----:|--------|
| `src/components/KeywordStrategy.tsx` | 334 | Remove "Send to Client" button entirely; keyword strategy lives only on SEO Strategy page |
| `shared/types/client-actions.ts` | (sourceType union) | Remove `'keyword_strategy'` from union; remove `KeywordStrategyPayload` type and discriminated union arm |
| `src/components/client/ClientActionDetailModal.tsx` | (keyword_strategy renderer) | Delete the case branch and renderer |
| `server/client-actions.ts` | (validSources array) | Remove `'keyword_strategy'` |
| Migration: new file | Mark all existing `pending` `keyword_strategy` rows → `archived` |
| `tests/integration/client-actions-routes.test.ts` | (fixtures) | Remove keyword_strategy test cases |
| `tests/integration/client-actions-broadcasts.test.ts` | (fixtures) | Remove keyword_strategy test cases |
| `tests/contract/intelligence-slice-population.test.ts` | (references) | Remove keyword_strategy references |
| `tests/contract/keyword-strategy-follow-ons.test.ts` | (full file?) | Verify and remove or repurpose |

### 2.8 Status simplification (§3.5 Rule 6)

| File | Change |
|------|--------|
| `shared/types/requests.ts` (or wherever `RequestStatus` lives) | Add a `ClientRequestStatus` derived type (`'awaiting_team' \| 'in_progress' \| 'resolved' \| 'team_replied'`) and a server-side mapping function |
| `src/components/client/RequestsTab.tsx` (renamed/refactored to ConversationsTab) | Use derived client status; render synthesized "Team replied" amber badge when latest note author is `'team'` and unread |
| `server/routes/public-requests.ts` (or equivalent public read endpoint) | Compute and serialize the synthesized client status server-side |

### 2.9 Insights page — Wins surface and "we called it" removal

#### Insights page composition (current)

| Sequence | Component | File | Tier | Phase 1 |
|---------:|-----------|------|------|---------|
| 1 | WeeklyOpener | `Briefing/WeeklyOpener.tsx` | Premium | Keep |
| 2 | DateLine | `Briefing/DateLine.tsx` | — | Keep |
| 3 | IssueSummaryLine | `Briefing/IssueSummaryLine.tsx` | — | Keep |
| 4 | ActionQueueStrip | `Briefing/ActionQueueStrip.tsx` | — | **Keep** (per spec §2.2 — explicitly retained) |
| 5 | PulseStrip | `Briefing/PulseStrip.tsx` | — | Keep |
| 6 | MonthlyDigestContent | `Briefing/MonthlyDigestContent.tsx` | — | Keep |
| **7 (NEW)** | **Wins Surface** | new file | Growth+ | **Add** between MonthlyDigest and DataSpread |
| 8 | DataSpread | `Briefing/DataSpread.tsx` | — | Keep |
| 9 | RecommendedForYou | `Briefing/RecommendedForYou.tsx` | Growth+ | Keep |
| 10–13 | SecondaryStoryRow ×4 | `Briefing/SecondaryStoryRow.tsx` | — | Keep |

Tests: **0 existing tests** for any Insights/Briefing component — Phase 1 is an opportunity to add basic coverage.

#### Wins data plumbing — already partially exists

Important verified finding: an admin-side `getTopWins` API already exists.

| File | Status | Phase 1 use |
|------|--------|-------------|
| `server/outcome-tracking.ts` | Exists | Read pattern for tracked_actions + action_outcomes — adapt for client endpoint |
| `shared/types/outcome-tracking.ts` | Exists; `ActionType` enum at line 4 | Use as-is for the Phase 1 translation map |
| `src/api/outcomes.ts:41` (`getTopWins`) | Exists for admin | Pattern to copy; create client variant under `src/api/client/` |
| `src/hooks/admin/useOutcomes.ts:47` | Exists | Pattern to copy; create `src/hooks/client/useClientWins.ts` |
| `tests/unit/outcome-tracking.test.ts` | Exists | Test patterns to extend |
| **NEW**: `server/routes/public-outcomes.ts` (or extend existing public route file) | Missing | Add `GET /api/public/wins/:workspaceId` endpoint |
| **NEW**: `src/components/client/Briefing/WinsSurface.tsx` | Missing | New component, Growth+ tier-gated |
| **NEW**: `shared/types/client-wins.ts` (translation map) | Missing | Maps `action_type` enum → human label |

#### "We called it" tab removal — VERIFICATION NEEDED

The user requested removal of "we called it" from the Insights page. Verified files involved:

| File | Lines | Disposition |
|------|------:|-------------|
| `src/components/client/WeCalledIt.tsx` | 1–end | Standalone component with `title="We called it"` (line 176) |
| `src/components/client/PredictionShowcaseCard.tsx` | 5, 8 | Imports `WeCalledItEntry` type |
| `src/components/client/OverviewTab.tsx` | 331 | Renders `<PredictionShowcaseCard predictions={clientIntel.weCalledIt} />` — **mounted on OverviewTab, NOT InsightsBriefingPage** |
| `src/hooks/client/useClientOutcomes.ts` | 5, 23 | Hook for "we called it" wins feed |
| `shared/types/intelligence.ts` | (`WeCalledItEntry`) | Type definition |

**Verification needed from user:** the audit found "we called it" rendering on `OverviewTab.tsx` (the Overview/Briefing area), not directly on the InsightsBriefingPage component file. The user's request was to remove it from "the insights page" — this likely refers to the OverviewTab rendering. Recommend confirming before committing the deletion path. See §4.

### 2.10 Pr-check rules — existing and new

#### Existing rules touching this scope

| Rule | Source line | Phase 1 disposition |
|------|-------------|---------------------|
| `inbox-legacy-filter-literal` (rule 86) | `scripts/pr-check.ts` ~line 850 | Update forbidden literals; add new section names |

#### Recommended new rules (prevention layer)

| Rule | Pattern | Why |
|------|---------|-----|
| `feedback-table-import` | `import.*FeedbackWidget`, `from.*feedback`, `/api/feedback`, `/api/public/feedback` | Prevent reintroduction of the deprecated client-facing system |
| `keyword-strategy-client-action` | `'keyword_strategy'` literal in `client_actions` source_type contexts | Prevent recreating the deprecated source type |
| `request-status-admin-leak` | Use of admin-only status values (`'in_review'`, `'closed'`) in `src/components/client/` | Prevent admin-only states leaking into client UI |
| `inbox-priority-strip-import` | Import of `PriorityStrip` in `InboxTab.tsx` | Prevent reintroduction inside Inbox (Insights usage stays valid) |
| `we-called-it-import` | Import of `WeCalledIt` or `PredictionShowcaseCard` (if removed) | Prevent reintroduction without a re-design decision |

### 2.11 Documentation updates (CLAUDE.md and docs/rules/)

Once Phase 1 ships, the following docs need updates:

- `CLAUDE.md` — update inbox section vocabulary, remove feedback references, note keyword_strategy deprecation
- `docs/workflows/ui-vocabulary.md` — update canonical labels for inbox sections, the "Send to Client" + optional note pattern
- `docs/rules/data-flow.md` — note any new WS event additions (none expected)
- New (post-Phase-1): `docs/rules/inbox-section-routing.md` — document the routing rules (note presence → Conversations, length → Reviews vs Decisions, etc.)

---

## 3. Existing Coverage

### 3.1 What's already wired

- **WebSocket event plumbing** for all current Inbox cache invalidations (no new events needed)
- **`tracked_actions` + `action_outcomes` schema** (no new migrations needed for Wins data)
- **Admin `getTopWins` API + hook** (pattern to mirror for client side)
- **`AuditIssueRow` flag-with-note state** (already implemented; just collapse the double-button into reuse)
- **TierGate pattern on Insights** (apply same pattern to Wins surface, Growth+ required)
- **`outcome-tracking.test.ts` test coverage** (extend rather than start from zero)

### 3.2 What's NOT covered — Phase 1 gaps

- **No tests for Insights page or any Briefing sub-component** — Phase 1 should add basic coverage for the new Wins surface at minimum
- **No public read endpoint for `tracked_actions`/`action_outcomes`** — must create
- **No client-side `useClientWins` hook** — must create
- **No `action_type → human label` translation map** — must create (10 entries)
- **Status simplification mapping not yet expressed in code** — must add `ClientRequestStatus` derived type + server-side serializer

---

## 4. Open Questions for User

These must be resolved before the Phase 1 plan can be written:

1. **"We called it" removal scope.** The component renders on `OverviewTab.tsx:331` via `PredictionShowcaseCard`, not directly on `InsightsBriefingPage`. Confirm:
   - **(A)** Remove from `OverviewTab` only (delete the line 331 mount, keep the component files for potential reuse)
   - **(B)** Remove the rendering AND delete `WeCalledIt.tsx`, `PredictionShowcaseCard.tsx`, the `useClientOutcomes.ts` "we called it" feed, and the `WeCalledItEntry` type
   - **(C)** Hide via feature flag for now, no file deletions

2. **Schema Plan routing nuance.** Spec §3.2 lists Schema Plan in Reviews. Confirm: the existing `SchemaReviewModal.tsx:57` (which is already a full-screen modal wrapper around `SchemaReviewTab`) becomes the body renderer inside the new Reviews modal shell. No additional UI work beyond shell consistency. Yes/No?

3. **Content plan cell routing decision.** Spec §3.5 Rule 2 says cells with "brief or outline that needs reading" → Reviews; topic-only cells → Decisions. Confirm: which `ContentPlanCell` field tells us which mode the cell is in? (Likely `cell.brief` or `cell.outline` presence — but worth confirming there's a clear discriminator before the plan codifies it.)

4. **Phase 1 scope boundary on "feedback" deletion.** Hard-delete the `feedback` table immediately, or one-release grace (mark routes `410 Gone` + drop table next phase)? Spec §5.1 says one-release grace; confirm.

5. **The `BriefDetail.tsx:62-65` "Send to Client" button.** Audit could not fully resolve which mechanism it uses (likely a status update rather than `client_action` or `approval_batch`). The Phase 1 plan needs to know — should this surface in the spec, or do we treat as out-of-scope discovery?

---

## 5. Infrastructure Recommendations

### 5.1 Shared utilities to introduce

| Utility | File | Purpose |
|---------|------|---------|
| `mapToClientRequestStatus(status, latestNoteAuthor, hasUnread)` | `shared/types/requests.ts` | Compute synthesized client status; used both server-side (serializer) and client-side (badge) |
| `renderActionTypeLabel(action_type)` | `shared/utils/wins-labels.ts` | The 10-entry enum-to-human-label translation map |
| `<DecisionPrimitive>` shell component | `src/components/client/decisions/DecisionPrimitive.tsx` | Trust-first batch modal shell (reused across all bulk Decisions) |
| `<ReviewsShell>` modal component | `src/components/client/reviews/ReviewsShell.tsx` | Full-screen review modal shell (reused across all Reviews types) |
| `<ConversationCard>` and `<ConversationThread>` | `src/components/client/conversations/` | Split out of refactored RequestsTab |

### 5.2 Pattern decisions before parallel work begins

Before any subagents work in parallel, the following shared contracts should be committed first (per `docs/rules/multi-agent-coordination.md`):

- The new `InboxFilter` type and `INBOX_FILTER_VALUES` (in InboxTab.tsx)
- The updated `CLIENT_INBOX_ALIASES` in routes.ts
- The `AeoChangeDiff` type with new optional fields (in shared/types/client-actions.ts)
- The `ClientRequestStatus` derived type and mapping function
- The `WinsLedgerItem` type and translation map signature

### 5.3 Parallelization strategy for Phase 1

Phase 1 has natural seams between subsystems. Parallel batches:

**Batch 0 (sequential, must commit first):**
- Shared contracts above
- Migration: `keyword_strategy` archive + feedback row migration

**Batch 1 (4 parallel agents):**
- Agent A: `InboxTab.tsx` restructure (3-section shell, chip update, header wins-link, deep-link routing) — sonnet
- Agent B: Adapt 3 existing tab components (ApprovalsTab → Decisions render, RequestsTab → Conversations render with status mapping, ContentTab → Reviews render with coming-soon footer) — sonnet
- Agent C: Trust-first `<DecisionPrimitive>` modal + adapt `ClientActionDetailModal` per-sourceType renderers — sonnet
- Agent D: Insights page changes: add `<WinsSurface>` component + `GET /api/public/wins/:wsId` endpoint + `useClientWins` hook + remove "we called it" — sonnet

**Batch 2 (3 parallel agents):**
- Agent E: Cross-cutting deprecations — feedback removal + keyword_strategy removal (delete files, drop routes, mark migrations) — haiku
- Agent F: Send-to-client button collapse — apply optional-note pattern across 13 admin components — haiku
- Agent G: Pr-check rule additions + tests for new rules — sonnet

**Batch 3 (final sweep):**
- Documentation updates (CLAUDE.md, ui-vocabulary.md, new inbox-section-routing.md)
- AeoChangeDiff payload enrichment in AeoReview.tsx (must run after Batch 2 to avoid touching same file twice)

### 5.4 Model assignments

| Work type | Model | Rationale |
|-----------|-------|-----------|
| Mechanical deprecations (file deletions, route removals) | Haiku | Pattern-matching work |
| Send-to-client button collapse (13 sites, same pattern) | Haiku | Repetitive application of one pattern |
| New component creation (DecisionPrimitive, WinsSurface) | Sonnet | Requires design judgment + integration |
| InboxTab restructure | Sonnet | Multi-file integration, prop wiring, deep-link logic |
| Pr-check rule authoring | Sonnet | Regex + customCheck logic |
| Verification + orchestration | Opus | Cross-cutting consistency checks |

---

## 6. Phase 1 Implementation Checklist

Once user resolves §4 questions, the implementation plan covers:

- [ ] Batch 0: shared contracts committed (types, migrations, route alias updates)
- [ ] Batch 1A: InboxTab restructure to 3 sections + chip bar + header wins-link
- [ ] Batch 1B: Adapt ApprovalsTab/RequestsTab/ContentTab as section renderers
- [ ] Batch 1C: `<DecisionPrimitive>` trust-first modal + ClientActionDetailModal renderer updates (incl. removed `keyword_strategy` case)
- [ ] Batch 1D: Insights `<WinsSurface>` + `GET /api/public/wins/:wsId` + `useClientWins` + "we called it" removal (per §4 resolution)
- [ ] Batch 2E: `feedback` table retirement (delete files + routes; migrate rows; drop table after grace)
- [ ] Batch 2F: Apply optional-note pattern to 13 admin "Send to client" components
- [ ] Batch 2G: New pr-check rules with tests
- [ ] Batch 3: AeoChangeDiff payload enrichment in AeoReview.tsx
- [ ] Batch 3: Documentation updates (CLAUDE.md, ui-vocabulary.md, new docs/rules/inbox-section-routing.md)
- [ ] Final: full test suite green; pr-check zero errors; staging deploy verified

---

## 7. References

- Spec: `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md`
- Prior audit (4-agent send-to-client landscape sweep): in conversation history, 2026-05-09
- `docs/rules/multi-agent-coordination.md` — parallel agent dispatch rules
- `docs/PLAN_WRITING_GUIDE.md` — implementation plan structure
- `scripts/pr-check.ts` rule 86 (`inbox-legacy-filter-literal`) — pattern for new prevention rules
