# Intelligence Layer — Post-Migration Backlog

> Running list of opportunities discovered during Phases 3A/3B. These are "free wins" or low-effort enhancements that build on the intelligence layer infrastructure. Review after Phase 3B (or Phase 4 if applicable) and prioritize for a dedicated sprint.

---

## Assembled But Underutilized Slices

These slices are fully assembled by `buildWorkspaceIntelligence()` but have few or no server-side consumers today. The data exists — it just needs consumption points.

### 1. `learnings.weCalledIt` — Prediction Accuracy Showcase

**What it is:** "Predictions we got right" — outcome tracking validates that recommendations led to measurable improvements. The assembler already packages strong wins with confidence scores.

**Opportunity:** A client-facing card or dashboard section: "We predicted [keyword X] would reach page 1 within 45 days — it did in 38 days." Powerful trust signal for retention and upsells.

**Effort:** ~2-4h — frontend component + API consumption. No backend work needed.

**Value:** High — directly demonstrates ROI to clients. Differentiator vs competitors.

---

### 2. `contentPipeline.cannibalizationWarnings` — Proactive Keyword Conflict Alerts

**What it is:** Detected keywords where multiple pages compete against each other, diluting rankings.

**Opportunity:** Surface as actionable alerts in the content pipeline dashboard. Trigger keyword strategy review prompts when new warnings appear. Could also feed into brief generation (Phase 3B stretch goal already notes this).

**Effort:** ~2-3h — frontend alert component. Data already assembled.

**Value:** Medium-High — prevents a common SEO mistake that clients don't know they have.

---

### 3. `clientSignals.compositeHealthScore` — Workspace Health Dashboard

**What it is:** Weighted aggregate (40% churn risk + 30% ROI trend + 30% engagement) normalized to 0-100.

**Opportunity:**
- **Admin dashboard:** Sort workspaces by health score. At-risk clients bubble to top.
- **Client dashboard:** Show health score as a headline metric (like a credit score for their SEO).
- **Automated alerts:** Notify admin when a workspace drops below threshold.

**Effort:** ~3-5h — frontend component + optional webhook/notification.

**Value:** High — proactive churn prevention. Replaces gut-feel client management with data.

---

### 4. `operational.actionBacklog` — Stale Action Escalation

**What it is:** Tracks pending outcome measurements that haven't been resolved. When the backlog grows, it means recommendations are being made but not acted on.

**Opportunity:** Alert admin when action backlog exceeds N items or average age exceeds M days. Could drive client check-in cadence.

**Effort:** ~1-2h — threshold check in outcome-crons + notification.

**Value:** Medium — operational hygiene. Ensures the feedback loop stays closed.

---

## Deferred Assembler Fields (Cheap to Wire)

These fields have placeholder values in the assembler but could be populated from existing DB data.

### 5. `clientSignals.approvalPatterns.avgResponseTime`

**Currently:** Hardcoded `null`.

**What's needed:** If the `approvals` table has `created_at` and `resolved_at` timestamps, this is a single `AVG(resolved_at - created_at)` query.

**Value:** Tells you which clients are responsive vs ghosting. Feeds into churn prediction.

**Effort:** ~1h — one SQL query + assembler wiring.

---

### 6. `clientSignals.portalUsage`

**Currently:** Always `null`.

**What's needed:** If client portal login events or page views are logged anywhere (activity log?), count recent sessions.

**Value:** Engagement signal. Clients who never log in are churn risks regardless of SEO performance.

**Effort:** ~1-2h depending on whether events are already tracked.

---

### 7. `pageProfile.linkHealth` — Inbound/Outbound Link Counts

**Currently:** Hardcoded `{ inbound: 0, outbound: 0, orphan: false }`.

**What's needed:** If `internal-links` analysis stores per-page link counts, wire a JOIN into the pageProfile assembler.

**Value:** Orphan page detection, internal linking strategy. Data likely already exists from internal link audits.

**Effort:** ~2h — query + assembler wiring.

---

## Prompt Enrichment Opportunities

These leverage intelligence data to improve AI output quality across the platform. Some are Phase 3B stretch goals; others are post-migration.

### 8. Brief Generator + Learnings + Cannibalization (Phase 3B stretch)

**Status:** Noted in Phase 3B plan Task 4. Request `slices: ['seoContext', 'learnings', 'contentPipeline']` and inject top patterns + cannibalization warnings.

### 9. AEO Review + Learnings (Phase 3B stretch)

**Status:** Noted in Phase 3B plan Task 5. Inject `learnings.topPatterns` as data-backed evidence for recommendations.

### 10. Admin Chat + compositeHealthScore (Phase 3B stretch)

**Status:** Noted in Phase 3B plan Task 11. Inject health score so AI can reference workspace health in status updates.

### 11. SEO Audit + Cannibalization Awareness

**Not in Phase 3B plan.** When auditing a page whose keyword is cannibalized, the audit AI should recommend consolidation rather than just meta tag fixes.

**Effort:** ~1h — conditional block in seo-audit.ts prompt.

---

## Infrastructure / Cleanup

### 12. Deprecate `seo-context.ts` Entirely

After Phase 3B migration, `buildSeoContext`, `buildPageAnalysisContext`, and `buildKeywordMapContext` will have zero external callers. The file becomes dead code.

**Options:**
- Delete immediately after Phase 3B (aggressive — clean but risky if anything was missed)
- Mark as `@deprecated` with a pr-check `error` rule, delete in Phase 4

**Recommendation:** Mark deprecated, delete in next phase.

---

### 13. Server-Side Intelligence Consumers

Today the intelligence layer is a one-way feed: assembler → API → frontend. No backend service reads `buildWorkspaceIntelligence()` to make automated decisions.

**Opportunities:**
- Outcome crons could read `compositeHealthScore` to prioritize which workspaces get measured first
- Scheduled audits could skip low-health workspaces or increase frequency for at-risk ones
- Content decay detection could factor in learnings (pages matching high-win-rate patterns get priority refresh)

**Effort:** Variable — each is 2-4h but requires careful design to avoid circular dependencies.

---

## Known Edge Cases (document, don't fix yet)

### 14. Cold-start check ignores `sections` filter in `formatForPrompt`

`formatForPrompt` at `server/workspace-intelligence.ts:~1134` checks `seoContext`, `insights`, and `learnings` to detect a cold-start workspace, regardless of which sections the caller requested via `opts.sections`. A caller requesting only `sections: ['pageProfile']` on a cold workspace would get a cold-start message instead of page content.

**Why it's acceptable:** A workspace with page data almost always has some SEO context. The cold-start is a workspace-level concept. If this causes real issues, fix by scoping the cold-start check to sections actually requested.

**Effort:** ~30min.

---

### 15. Token budget priority chain drops explicitly-requested sections

`applyTokenBudget` in `formatForPrompt` operates on section headers (e.g., `s.startsWith('## Operational')`), not on which sections were requested via `opts.sections`. If a caller requests `sections: ['operational']` with a very tight token budget, the operational section is dropped first and the final fallback returns `seoContext` — which wasn't requested.

**Why it's acceptable:** No current caller combines a specific `sections` filter with a tight `tokenBudget`. The two options are designed for different use cases. Fix if a future caller needs both.

**Effort:** ~1h — check `opts.sections` in the priority chain and preserve requested sections.

---

### 17. outcome-crons Stale Cache When `getPendingActions` Fails

**What it is:** `runMeasure` in `server/outcome-crons.ts` wraps `getPendingActions` in its own try/catch to isolate it from blocking measurement. If `getPendingActions` throws, `affectedWsIds` stays `[]` and no `invalidateIntelligenceCache()` calls are made — even if `measurePendingOutcomes` later succeeds and writes new data. Result: updated outcome data sits behind a stale cache until the next natural TTL expiry (5 min).

**Why it's acceptable:** Low-probability scenario (transient DB error on a read-only query). The 5-minute TTL provides eventual consistency. New behavior (measurement not blocked by cache-tracking failure) is arguably preferable to the old behavior (measurement skipped entirely).

**Fix if needed:** Collect `affectedWsIds` inside the `measurePendingOutcomes` return value rather than pre-computing from `getPendingActions`, so cache invalidation is always tied to actual write results.

**Effort:** ~30min.

---

### 16. Token budget Step 5 drops `contentPipeline`, `siteHealth`, `pageProfile` without gradual degradation

`applyTokenBudget` steps 1-4 drop/truncate specific slices in order (operational → insights → clientSignals → learnings). If none of those steps bring the output under budget, Step 5 jumps directly to keeping only `seoContext`, discarding `contentPipeline`, `siteHealth`, and `pageProfile` all at once. There's no gradual fallback for these three slices — they either survive entirely or disappear entirely when budget is very tight.

**Why it's acceptable:** Matches the documented §20 priority chain. These three slices are lower-priority than SEO context for prompt completeness. The abrupt behavior only appears at very tight budgets.

**Fix if needed:** Add intermediate steps between Step 4 and Step 5 that individually drop `pageProfile`, then `siteHealth`, then `contentPipeline` before falling back to seoContext-only.

**Effort:** ~1h.


---

## Priority Ranking

| # | Item | Effort | Value | Phase |
|---|------|--------|-------|-------|
| 1 | compositeHealthScore dashboard | 3-5h | High | Post-3B |
| 2 | weCalledIt client card | 2-4h | High | Post-3B |
| 3 | cannibalizationWarnings alerts | 2-3h | Medium-High | Post-3B |
| 4 | avgResponseTime wiring | 1h | Medium | Post-3B |
| 5 | Deprecate seo-context.ts | 1h | Cleanup | Phase 4 |
| 6 | portalUsage wiring | 1-2h | Medium | Post-3B |
| 7 | linkHealth wiring | 2h | Medium | Post-3B |
| 8 | actionBacklog escalation | 1-2h | Medium | Post-3B |
| 9 | SEO audit + cannibalization | 1h | Medium | Post-3B |
| 10 | Server-side intelligence consumers | 8-12h | High (long-term) | Phase 4+ |
| 14 | Cold-start ignores section filter | 30min | Low | If needed |
| 15 | Token budget drops requested sections | 1h | Low | If needed |
| 16 | Token budget Step 5 abrupt drop (contentPipeline/siteHealth/pageProfile) | 1h | Low | If needed |
| 17 | outcome-crons stale cache on getPendingActions failure | 30min | Low | Post-3B |
