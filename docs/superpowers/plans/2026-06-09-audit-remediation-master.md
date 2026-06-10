# Platform Audit Remediation — Master Run Plan

> **For agentic workers:** This is the run-level plan for remediating [docs/audits/2026-06-09-platform-multi-domain-audit.md](../../audits/2026-06-09-platform-multi-domain-audit.md). Each PR has (or will get) its own detailed contract+test-centric plan in this directory, authored just-in-time against the then-current `staging` head. REQUIRED SUB-SKILLS per PR: `superpowers:executing-plans` or `superpowers:subagent-driven-development`, plus the code-review gate from CLAUDE.md.

**Goal:** Land all confirmed audit findings plus the sequenced medium-severity fixes as 7 serialized PRs into `staging`, each merged green before the next begins.

**Architecture:** Strictly serialized phase-per-PR (CLAUDE.md rule). Each PR: branch off latest `origin/staging` → detailed plan → implement with full quality gates → push → PR → CI + Devin review green (inline Devin comments cross-referenced against code, not trusted from status alone) → merge to staging → next. `staging → main` promotion is **out of scope** for the autonomous run — owner verifies the staging deploy and releases.

**Pre-plan audit:** the 2026-06-09 multi-domain audit itself (19 agents, adversarial verification of all critical/high findings) serves as the pre-plan audit artifact. Each per-PR plan MUST re-verify its citations against the current staging head before locking contracts — staging moves between PRs.

---

## Decision log (owner-confirmed 2026-06-09)

| Decision | Choice |
|---|---|
| Scope | Full 7-PR sequence |
| Merge authority | Autonomous merge to `staging` when CI + review green; `staging → main` stays with owner |
| seoDataMode `'none'` | **Honor it**: explicit 'none' = zero provider calls, with test; absent param still auto-promotes to 'quick' |
| Passwordless workspaces | **Closed until configured**: no client-portal data served until a client credential exists |
| Purple scope (default, not owner-blocking) | "Purple marks admin AI-powered elements, never action buttons" — CLAUDE.md Law 4 + BRAND_DESIGN updated to match in PR 6 |

## Run protocol (every PR)

1. `git fetch origin staging` → branch `claude/audit-prN-<slug>` off `origin/staging`.
2. Author/finalize `docs/superpowers/plans/2026-06-09-prN-<slug>.md` (contracts + test assertions, no pre-baked bodies). Re-verify audit citations against real code; if reality contradicts the audit finding, STOP that item and note it in the PR body rather than forcing the fix.
3. Execute task-by-task: read real code → failing test (run it, confirm red for the right reason) → minimal implementation → green + typecheck → commit.
4. Gates before PR: `npm run typecheck` · `npx vite build` · `npx vitest run` (full) · `npm run pr-check` · `npm run verify:feature-flags` · `npm run verify:coverage-ratchet` · code review skill (`requesting-code-review` single-agent; `scaled-code-review` if subagents used) · all review-surfaced bugs fixed in-PR.
5. Doc sync in the same PR: roadmap notes if applicable, BRAND_DESIGN_LANGUAGE if UI changed, `npm run rules:generate` whenever a pr-check rule is added.
6. Push, `gh pr create --base staging`, monitor `gh pr checks --watch` in background. Devin inline comments: read each, verify against code, fix real ones.
7. Merge (squash per repo convention — verify existing convention on PR 0), confirm staging deploy kicks off, update task tracker, proceed.

**Failure handling:** CI red → fix on branch, re-push. A finding that turns out wrong on re-verification → drop it, document in PR body. Never expand a PR's scope beyond its plan except for review-surfaced bugs (CLAUDE.md: fix bugs found during review in the current PR).

---

## PR sequence

### PR 0 — Audit report + plans (docs only)
Ships the audit report, this master plan, and the PR 1 plan. Zero code risk; validates the CI/merge loop end-to-end.

### PR 1 — Money + trust (all S-effort) — plan: `2026-06-09-pr1-money-trust.md`
Owning contexts: keyword-strategy (server), client inbox (frontend).
1. Honor explicit `seoDataMode: 'none'` — zero provider calls (confirmed #1; regression from `a5644282`).
2. Cannibalization detection without GSC data (hoist loop out of the `gscData.length > 0` guard).
3. Refund strategy-generation usage slot on the sanitizer-only `noOpChanged` path.
4. Humanize client-facing field identifiers (`seoTitle` → "SEO Title") via shared label map.
5. DecisionCard disabled/submitting state during respond mutation.

### PR 2 — Inbox integrity — plan authored after PR 1 merges
Owning context: inbox domain (`server/domains/inbox/`), data-flow wiring.
1. `cancelDeliverable` (status → `cancelled` via existing transition map) + call from `deleteApprovalBatchForClient`; fix the unit test that currently asserts orphaning; audit client-action + work-order deletion for the same pattern (confirmed #3).
2. Broadcast `DELIVERABLE_SENT`/`DELIVERABLE_UPDATED` at approval-batch and client-action mirror seams (schema-plan precedent; briefing seam excluded per verifier) + meta-test pairings (confirmed #4).
3. Legacy public approval respond endpoints: mirror-sync or 410 (decide at plan time after checking external consumers).
4. `INSIGHT_RESOLVED` + `CONTENT_PUBLISHED` client-side invalidation handlers.
5. Correct the stale "dark/flag-gated" dual-write module headers (causally coupled to items 1–2, so they ride here rather than PR 6).

### PR 3 — Tenant scoping + portal posture — plan authored after PR 2
Owning context: auth/middleware, public portal.
1. Guard every admin route deriving `workspaceId` from query/body (`requireWorkspaceAccessFromQuery/FromBody`) — admin-chat, activity, debug/prompt, ai/usage, ai/time-saved, plus a grep-verified sweep (confirmed #2). Fix the wrong comment in `debug.ts:44`.
2. New pr-check rule: admin route reading query/body `workspaceId` without a guard (+ `rules:generate`).
3. Passwordless workspaces: client-portal reads closed until a credential is configured (owner decision). Must verify the admin frontend's own use of `/api/public/*` (the admin insight feed consumes one) keeps working via admin token pass-through, and seed/demo fixtures get passwords so local dev + e2e stay green.
4. Harden `/api/public/insights` (+ `/narrative`, `/digest`) with `requireAuthenticatedClientPortalAuth` and strip internal bookkeeping fields from the raw payload.
5. Riders if trivially small at plan time: 404-vs-401 oracle, SESSION_SECRET production hard-fail.

### PR 4 — Background-job migrations — plan authored after PR 3
Owning contexts: content generation, admin tools, jobs platform.
1. Copy pipeline single-entry generation → job platform (batch-of-one via copy-batch-jobs); reuse `entry.briefId` instead of regenerating Layer 4.5 brief; skip brief enrichment on single-section regenerate (confirmed #6).
2. Blueprint generation → background job with per-entry progress (confirmed #7).
3. LinkChecker, AEO site review, llms.txt, internal-links → job platform with progress + cancellable where applicable (confirmed #9).
4. pr-check: extend background-generation allowlist + add sync-awaited-AI-loop detection; evaluate enforcing `executionMode: 'background-only'` at the `callAI` boundary.
This is the largest PR; if plan-time sizing says it's too big for one reviewable diff, split 4a (copy+blueprint) / 4b (admin crawls) — the phase-per-PR rule applies to each.

### PR 5 — Insights correctness — plan authored after PR 4
Owning context: analytics-insights, intelligence.
1. `page_health` writer collision: migrate `reports.ts` Bridge #12 to `audit_finding` with read-before-write, per the existing scheduled-audits pattern (confirmed #5).
2. competitor_alert enrichment (impactScore/domain via the enrichAndUpsert path).
3. anomaly_digest pruning/auto-resolve mirroring the boost-reversal loop.
4. Insight-feed invalidation keys for INSIGHT_RESOLVED / INSIGHT_BRIDGE_UPDATED / ANOMALIES_UPDATE.
5. Renderer cases for the 9 default-falling InsightTypes + contract test "every InsightDataMap key has a non-default rendering path".
6. Wire REQUEST_TRANSITIONS + MATRIX_CELL_TRANSITIONS via validateTransition + GUARD_SIGNALS entries (confirmed #8).
7. Small riders: serp_opportunity `schemaStatus`, `detectedAt: insight.computedAt`, outcome-reweight `toInsightPageId` normalization, `getWorkspaceHealthScore` cache-key fix.

### PR 6 — Migration debris + doc truth — plan authored after PR 5
Owning context: client inbox (deletions), docs.
1. Delete the 8 dead inbox components + `InboxTabLayouts`/`useInboxTabShell` — **decision at plan time:** the inbox filter-chip finding (UnifiedInbox hides sections with no UI) recommends *mounting* InboxTabLayouts; either mount it here as the filter fix or delete it and add a minimal "Showing X only — Show all" banner. Don't delete and re-create.
2. Strip InboxTab's 9 dead props + ClientDashboard threading; check upstream legacy fetches for remaining consumers.
3. Delete InsightCards.tsx + useClientRawInsights + their tests + query key.
4. Delete ActionPill/SegmentedControl + barrel exports + CLAUDE.md/DESIGN_SYSTEM/BRAND_DESIGN entries.
5. Briefing Phase 2.5d deletion; REACT_QUERY_MIGRATION_PROGRESS.md + test-branding.ts removal.
6. Doc corrections in the same commit as their code: CLAUDE.md client-inbox component list (live set), inbox-section-routing.md enforcement table, bridge-authoring.md (rule fiction, flag count, phantom bridges), ui-vocabulary.md (purple rows, Send for Approval, Tasks label), KCC hard-delete exception, client-dashboard-tab.ts comment.

### PR 7 — Performance — plan authored after PR 6
Owning context: workspace store, intelligence.
1. `getWorkspaceBySiteId` reusing the existing `getBySiteId` prepared statement (+ attachPageStates); swap ~41 siteId `.find` sites and ~6 id-equality sites (re-grep at plan time); pr-check rule banning `listWorkspaces().find(`.
2. `InsightsSlice.byType` per-type cap (top 25 by impactScore) with MCP payload size before/after check.

---

## Cross-PR contracts

- **PR 2 exports** `cancelDeliverable(workspaceId, id)` from `server/client-deliverables.ts` — PR 6's deletion sweep and any future mirror-family work consume it; do not reimplement.
- **PR 3 exports** the query/body workspace-guard pr-check rule — PR 4's new routes must pass it.
- **PR 4 exports** new `BACKGROUND_JOB_TYPES` entries — PR 6 doc updates must not contradict them.
- **PR 5 exports** the InsightDataMap-renderer contract test — any later insight work must satisfy it.
- Findings *not* in any PR (deferred to opportunistic work): unverified low-severity UX polish (mobile overflow, z-index tokens, dialog a11y on legacy overlays, native confirm() sweep, send-label casing sweep, notification deep-links, AnalyticsOverview error states, brand-engine parseJsonFallback, voice double-injection, AI-fix misfires, grounding provenance flags, language-code threading). These remain documented in the audit report; revisit after the 7-PR run or fold into adjacent feature work. **The run is complete when PRs 0–7 are merged, not when the audit report is empty.**

## Systemic improvements roll-up (mechanization shipped inside the PRs)

pr-check rules: query/body workspaceId guard (PR 3) · background-generation allowlist + sync-AI-loop (PR 4) · `listWorkspaces().find(` ban (PR 7).
Contract tests: explicit-'none' zero-provider-calls (PR 1) · DELIVERABLE broadcast pairings (PR 2) · requests + matrix_cell in GUARD_SIGNALS (PR 5) · InsightDataMap renderer coverage (PR 5).
Every rule addition runs `npm run rules:generate` in the same commit.

## Verification strategy

- Per-PR: the gate list in the run protocol, plus per-plan specific assertions (each PR plan names exact `npx vitest run <file>` commands).
- UI-touching PRs (1, 2, 6): preview screenshots of the affected client surfaces at desktop + mobile widths.
- PR 3: manual curl matrix — member-JWT cross-workspace request returns 403; passwordless workspace public GET returns 401/403; admin HMAC still passes.
- PR 4: trigger each migrated job on a seeded workspace (`npm run seed:demo`), observe TaskPanel progress, verify result persistence parity with the old sync path.
- After each staging merge: confirm the Render staging deploy goes healthy before starting the next PR (deploy failure = stop and fix).

## Model assignments

Claude/Anthropic platform. Default executor: Sonnet-class subagents for pattern-following tasks, orchestrator (Fable) implements high-judgment items inline; reviewer: Opus-class (never downgraded). Mechanical sweeps (label casing, doc-line deletions, `.find` swaps): Haiku-class acceptable with explicit file ownership.
