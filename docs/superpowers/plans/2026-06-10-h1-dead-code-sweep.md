# H1 — Dead-Code Sweep + 6b Inbox Deletions

> **Branch:** `claude/core-h1-dead-code-sweep` from `origin/staging`
> **Date:** 2026-06-10
> **Model:** Sonnet (implementing)

---

## Deletion targets — grep-proof status (verified at plan time)

### Commit 1 — sweep

| Target | Grep status | Notes |
|--------|-------------|-------|
| `src/components/client/FixRecommendations.tsx` | CLEAN — zero production imports in `src/` or `server/` | Test-only refs in `tests/component/client/FixRecommendations.test.tsx` and `tests/components/client/client-components.test.tsx` — both must be deleted/stripped |
| `src/components/client/WeCalledIt.tsx` | CLEAN — zero component imports in `src/` or `server/` | `WeCalledItEntry` TYPE is imported by `PredictionShowcaseCard.tsx` from `shared/types/intelligence` (NOT from WeCalledIt.tsx — already correct). No type relocation needed. Test refs in `tests/components/client/client-components.test.tsx` — strip WeCalledIt section |
| `src/components/client/ClientActionDetailModal.tsx` | CLEAN — zero imports in `src/` or `server/` | Test-only ref in `tests/unit/ClientActionDetailModal.test.tsx` — delete that test |
| `src/components/client/InsightCards.tsx` | CLEAN — zero imports in `src/` or `server/` | Test-only refs in `tests/component/InsightCards.test.tsx` and `tests/component/InsightCardsPhase4.test.tsx` — both deleted. NOTE: `tests/unit/platform-organization-report.test.ts:74` references `src/components/insights/InsightCards.tsx` (DIFFERENT path, synthetic fixture — unaffected) |
| `server/copy-voice-feedback.ts` | CLEAN — zero non-test imports | Referenced by `tests/unit/copy-voice-feedback.test.ts` (delete), `tests/contract/voice-authority-consumer-inventory.test.ts` (surgical), `tests/contract/ai-dispatch-migration.test.ts` (surgical) |
| `tests/unit/copy-voice-feedback.test.ts` | Deleted with parent | |
| `tests/component/client/FixRecommendations.test.tsx` | Deleted with parent | |
| `tests/component/InsightCards.test.tsx` | Deleted with parent | |
| `tests/component/InsightCardsPhase4.test.tsx` | Deleted with parent | |
| `tests/unit/ClientActionDetailModal.test.tsx` | Deleted with parent | |

**Surgical edits — commit 1:**
- `tests/contract/voice-authority-consumer-inventory.test.ts:35` — remove `copy-voice-feedback.ts` entry. correct count in inventory: 21→20
- `docs/superpowers/audits/2026-05-26-voice-authority-audit.md` — update `correct: 21` → `correct: 20` (required by count-sync test in voice-authority-consumer-inventory.test.ts)
- `tests/contract/ai-dispatch-migration.test.ts:38` — remove the `copy-voice-feedback.ts` entry from `migratedOperationBackedStructuredFiles`
- `tests/components/client/client-components.test.tsx` — strip the `FixRecommendations` section (lines ~1115–1209) and the `WeCalledIt` section (lines ~1255–1282). Keep OutcomeSummary, SeoCart, OrderStatus, ClientHeader, and all other sections

**NOT deleted:** `src/components/client/OutcomeSummary.tsx`, `src/hooks/client/useClientOutcomes.ts`, `src/components/client/PredictionShowcaseCard.tsx`

### Commit 2 — 6b inbox deletions

| Target | Grep status | Notes |
|--------|-------------|-------|
| `src/components/client/inbox/InboxTabLayouts.tsx` | CLEAN — only imports from `useInboxTabShell` | Delete |
| `src/components/client/inbox/useInboxTabShell.ts` | CLEAN — only imported by `InboxTabLayouts.tsx` | Delete |

**InboxTab dead props — count verified by reading `InboxTab.tsx` at plan time:**

Props in `InboxTabProps` interface but NOT destructured in the function body:

| # | Prop | Still needed elsewhere in ClientDashboard? |
|---|------|-------------------------------------------|
| 1 | `approvalBatches: ApprovalBatch[]` | YES — chatDeps, OverviewTab, pendingApprovals calc; computation STAYS |
| 2 | `clientActions?: ClientAction[]` | NO — only InboxTab; `clientActionsQ` + `clientActions` local + sectionErrors.clientActions can be removed |
| 3 | `approvalsLoading: boolean` | NO — only InboxTab; local var can be removed |
| 4 | `pendingApprovals: number` | YES — ClientHeader and OverviewTab; computation STAYS |
| 5 | `setApprovalBatches` | NO — only InboxTab; useCallback can be removed |
| 6 | `loadApprovals` | NO — only InboxTab; useCallback can be removed |
| 7 | `contentPlanReviewCells?: ContentPlanReviewCell[]` | NO — only InboxTab; local var can be removed |
| 8 | `hasCopyEntries?: boolean` | YES — ClientHeader uses it; computation STAYS |
| 9 | `pageMap?: ApprovalPageKeyword[]` | NO — only InboxTab; check `approvalPageKeywords` consumers below |

**Total dead props confirmed: 9**

**Dead computations in ClientDashboard (verified single-consumer — can be removed):**
- `useClientActions` hook call + `clientActions` local var + `errs.clientActions` sectionError entry
- `approvalsLoading` local var
- `setApprovalBatches` useCallback
- `loadApprovals` useCallback
- `contentPlanReviewCells` local var

**Check `pageKeywordsQ`/`approvalPageKeywords` before removing:**
- `approvalPageKeywords = pageKeywordsQ.data ?? null` — only used as `approvalPageKeywords ?? strategyData?.pageMap` in InboxTab prop. Can remove the local var; keep `pageKeywordsQ` hook if anything else uses it.

**Doc sync:** FEATURE_AUDIT.md entries referencing deleted components are historical feature entries (document what was built); no change needed. CLAUDE.md has no references to any deleted component.

---

## Gate sequence

1. Plan doc committed first
2. Execute commit 1 (sweep) → full gates
3. Execute commit 2 (inbox) → full gates
4. `superpowers:requesting-code-review` on full diff → fix Important+ issues
5. Push
