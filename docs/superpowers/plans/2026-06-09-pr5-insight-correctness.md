# PR 5 — Insight Correctness Cluster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) + `requesting-code-review`. Contract+test-centric. Per task: READ real code → failing test (red for the right reason) → minimal impl → green + typecheck → commit. STOP and record if reality contradicts a contract.

**Goal:** Fix the confirmed page_health insight collision (#5) and the cheap guessed-field / wiring defects in the insight feed, where every audit silently overwrites real GSC/GA4 metrics with zeros and two feed fields are guessed/unset.

**Branch:** `claude/audit-pr5-insight-correctness` off `origin/staging` (`87ed28ed`). **Base PR:** `staging`.

**Owning bounded context:** analytics-insights (`server/reports.ts`, `server/intelligence/insights-slice.ts` consumers) + insight feed (`src/hooks/admin/useInsightFeed.ts`, `src/lib/wsInvalidation.ts`).

**SCOPE NOTE (recorded):** the audit's broader "insights correctness" set also includes competitor_alert enrichment, anomaly_digest pruning, the 9 missing renderer cases + contract test, and the two unwired state machines (#8 REQUEST/MATRIX_CELL_TRANSITIONS, a different bounded context). **Those move to PR 5b (insight enrichment/pruning + renderers) and PR 5c (state-machine wiring — requests/content-matrices context).** PR 5 is the page_health collision + the trivial guessed-field/feed-wiring fixes — a cohesive, well-testable slice.

**REVIEW FOLLOW-UPS for PR 5b (recorded, non-blocking — confirmed by code review):**
- **Site-level audit representation is split.** This PR unified the PAGE level on `audit_finding`, but reports.ts Bridge #15 still writes `site_health` while scheduled-audits + on-demand bridges write site-level `audit_finding` (scope:'site', pageId:null). No collision (distinct types), but the `/api/reports/:siteId/snapshot` route now produces BOTH from one audit. PR 5b should pick one canonical site-level type.
- **Idempotent double-write on `/snapshot`.** That route fires saveSnapshot Bridge #12 AND `handleOnDemandSeoAuditResult`, which now both write page-level `audit_finding` for the same keys (identical data, same bridgeSource) — two idempotent upserts + two INSIGHT_BRIDGE_UPDATED broadcasts for the first 20 pages. Safe (read-before-write, identical content) but wasteful; collapse the dual dispatch in PR 5b.
- **`page-health.ts` briefing template** reads `topIssues`/`errorCount`/`warningCount`/`auditSnapshotId` that only the old Bridge #12 wrote — now permanently absent from page_health (degrades gracefully; audit context relocated to the audit_finding projector). Prune the dead branches in a follow-up.

**Verified facts (@ 87ed28ed):**
- reports.ts `saveSnapshot` Bridge #12 (`:219-260`) writes `insightType: 'page_health'` with HARDCODED zero metrics (clicks/impressions/ctr/pageviews/bounceRate=0) + audit fields. analytics-intelligence writes `page_health` with REAL GSC/GA4 metrics to the same `(workspace_id, page_id, 'page_health')` key; `ON CONFLICT` replaces `data` wholesale → every audit zeroes real traffic (feeds client InsightCards sorting + AI prompts).
- The proven migration template is scheduled-audits.ts `:189-242` (mislabeled "page_health" comment, actually writes `audit_finding` with read-before-write + base-score carry-forward) and webflow-seo-audit-bridges.ts `:65-115`. `audit_finding` is a registered type (analytics.ts:203, InsightDataMap:485) with its own renderer.
- Every saveSnapshot caller ALSO writes audit_finding EXCEPT the `/api/reports/:siteId/save` route (routes/reports.ts:201 — no `handleOnDemandSeoAuditResult`), so reports.ts Bridge #12 must be MIGRATED (not deleted) to keep that path's audit coverage.
- reports.ts Bridge #15 writes `site_health` (pageId=null, its OWN type — NO collision with page_health). Leave it: out of scope for the confirmed page_health fix; retiring site_health is a separate change.
- serp_opportunity renderer (`useInsightFeed.ts:171`) reads `data.schemaType` — `SerpOpportunityData` (analytics.ts:343) defines `schemaStatus`; producer writes `schemaStatus: 'missing'` (analytics-intelligence.ts:833). `schemaType` is always undefined → context line never renders (the #1 guessed-field bug).
- `FeedInsight.detectedAt` (insights.ts:17, "for chart callouts") is never set by `transformToFeedInsight` (the only producer) → SearchDetail callouts pin to the last chart date.
- The admin insight feed key `queryKeys.admin.insightFeed` is invalidated only on WORKSPACE_UPDATED + DIAGNOSTIC_COMPLETE; INSIGHT_RESOLVED / INSIGHT_BRIDGE_UPDATED / ANOMALIES_UPDATE don't invalidate it (verify exact current state before editing).

---

## Task Dependencies
```
Task 1 (page_health → audit_finding migration in reports.ts) — independent, backend
Task 2 (serp_opportunity schemaStatus + detectedAt)          — independent, frontend
Task 3 (insight-feed invalidation keys)                      — independent, frontend
```
Model: orchestrator-inline; reviewer Opus-tier.

## Task 1 — Migrate reports.ts Bridge #12: page_health → audit_finding
**Files:** `server/reports.ts` (Bridge #12 block `:219-260`). Test: new `tests/integration/audit-page-health-no-collision.test.ts`.
**Contracts:**
1. Bridge #12 writes `insightType: 'audit_finding'` (NOT page_health), keyed `pageId: toAuditFindingPageId(page)`, with the read-before-write + base-score carry-forward pattern COPIED from scheduled-audits.ts:206-242 (getInsight existing audit_finding, carry `_scoreAdjustments`, `_originalBaseScore`, `data: { scope:'page', issueCount, issueMessages, source:'bridge_12_audit_page_health' }`, `impactScore` base 80 (error) / 50 (warning), `severity` critical/warning). Use `toAuditFindingPageId` (import from helpers — confirm the import the other bridges use).
2. NO `page_health` insight is ever written from an audit again — analytics-intelligence becomes the sole page_health writer (real metrics).
3. The bridge name (`bridge-audit-page-health`) + return `{ modified }` + auto-broadcast are unchanged.
4. Leave Bridge #15 (site_health) untouched.
**Test assertions:** (a) seed an analytics-sourced page_health insight with real metrics (clicks/impressions>0) for page P; run saveSnapshot with an audit flagging P with issues; the page_health row STILL has the real metrics (not zeroed); (b) an audit_finding insight for P now exists with the issue count; (c) no page_health row carries `source: 'bridge_12_audit_page_health'` / zero metrics. (Use the real saveSnapshot + a seeded workspace + getInsight reads.)

## Task 2 — Fix serp_opportunity guessed field + populate detectedAt
**Files:** `src/hooks/admin/useInsightFeed.ts`. Test: extend the existing useInsightFeed test (`rg -l 'transformToFeedInsight|useInsightFeed' tests/`).
**Contracts:**
1. The serp_opportunity case reads `data.schemaStatus` (not `data.schemaType`) and renders a human label ('Schema missing'/'Schema partial'/'Schema complete'). Narrow the `data` access per the typed `SerpOpportunityData` if feasible without a large refactor; at minimum read the field that the producer actually writes.
2. `transformToFeedInsight` sets `detectedAt: insight.computedAt` on the returned FeedInsight.
**Test assertions:** a serp_opportunity insight with `data.schemaStatus: 'missing'` → the transformed feed item's context line reflects schema status (non-empty); a transformed feed item has `detectedAt === insight.computedAt`.

## Task 3 — Insight-feed cache invalidation on insight mutations
**Files:** `src/lib/wsInvalidation.ts` (admin scope). Test: extend `tests/unit/*wsInvalidation*` or the invalidation-keys test pattern from PR 2.
**Contracts:**
1. INSIGHT_RESOLVED, INSIGHT_BRIDGE_UPDATED, and ANOMALIES_UPDATE admin-scope cases include `queryKeys.admin.insightFeed(workspaceId)` in their returned keys (additive — keep existing keys). Verify each event's current admin-scope case first; only add the insightFeed key.
**Test assertions:** `getWorkspaceInvalidationKeys(INSIGHT_RESOLVED, ws, _, 'admin')` contains `queryKeys.admin.insightFeed(ws)`; same for INSIGHT_BRIDGE_UPDATED and ANOMALIES_UPDATE.

## Systemic Improvements
- New tests: page_health-no-collision integration, serp_opportunity/detectedAt unit, feed-invalidation unit.
- Contract test "every InsightDataMap key has a non-default renderer": **deferred to PR 5b** (rides with the 9 renderer cases).
- Feature-class: bugfix — full gates; no FEATURE_AUDIT/flag changes.

## Verification Strategy
- [ ] New tests green; full suite; typecheck; build; pr-check; flags; ratchet
- [ ] `superpowers:requesting-code-review` — fix Important+ in-PR
