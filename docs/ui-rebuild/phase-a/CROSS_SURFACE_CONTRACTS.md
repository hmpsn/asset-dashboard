# Phase A — Cross-Surface Ownership Contracts

**Purpose:** the ONE page resolving every cross-surface ownership ambiguity from the Phase A discovery.
After owner ratification this document is **LAW for all ticket-cuts** (read order: `PHASE_A_DECISIONS.md` → this file → `BUILD_CONVENTIONS.md` → surface JSON). A ticket that contradicts a ratified row goes back to the owner, not into a PR.
**Source:** fan-out plan §W0.6 · `completeness-critique.json` · `owner-decisions.json` (AD-014, AD-022) · surface docs cited per item.

---

## Contested items

### C-1 InsightsEngine rec-set mount (insights ↔ recommendations, hole B1)
- **Question:** Who mounts InsightsEngine's "Prioritized Action Plan" recommendations set in the new IA?
- **Claimants:** insights (`capabilityClassification[9]` B1 = `unknown`, "pickup NOT verified from this seat"; `crossSurfaceDeps[2]`); recommendations (Q1 default keeps the Health-tab `actionPlanSlot` carry-over — sole live mount today is `ClientDashboard.tsx:633` → `HealthTab.actionPlanSlot`; Q3 default "preserve via T1: keep InsightsEngine mounted as-is"). Flagged `important` in `completeness-critique.json` — neither surface commits to owning the render.
- **DEFAULT (ratify or override):** Split by lane per AD-005. **Client half:** recommendations C-lane ticket owns the T1 carry-over of `src/components/client/InsightsEngine.tsx` in the Health action-plan slot, unchanged. **Operator half:** the **engine** surface owns the operator rec-set mount; the recommendations admin desk (`AdminRecommendationQueue`) links to it and mounts no second copy.
- **Consequence if unresolved:** the capability lands in neither ticket and the action plan orphans in every lane — the exact "falls between tickets" failure this program exists to prevent.

### C-2 Branded-demand split (ai-visibility Q10 vs search-traffic)
- **Question:** Which surface owns the branded vs non-branded demand split (ai-visibility row N5)?
- **Claimants:** ai-visibility (`capabilityClassification[48]` N5 = open-question; Q10; `crossSurfaceDeps[4]` "contested ownership … and shared GA4 AI-referrer work (sn-ai-visibility-2)"); search-traffic (implicit owner per ai-visibility Q10's own proposedDefault: "Search & Traffic owns it; omit here").
- **DEFAULT (ratify or override):** **ai-visibility owns** the branded-demand split (plan W0.6 default — it powers the AI-demand narrative); **search-traffic links** to it and builds no duplicate split. ⚠ Note: this *inverts* the ai-visibility surface-doc default (which ceded to Search & Traffic) — owner is explicitly choosing between the two here; whichever wins, sn-ai-visibility-6 rides the owning ticket only.
- **Consequence if unresolved:** double-build of the same GA4 split with two divergent numbers (a score-authority/trust landmine under AD-016).

### C-3 AnomalyAlerts (search-traffic vs cockpit)
- **Question:** Who owns the AnomalyAlerts panel (ack/dismiss/scan) — Search & Traffic or the cockpit?
- **Claimants:** search-traffic (`capabilityClassification[59]` D5 = open-question; OQ6 — HEAD mounts it at `WorkspaceHome.tsx:614`, ledger says analytics; its default says "Home surface owns it"); cockpit (`capabilityClassification[34]` row 35: "Moves to Search & Traffic (cross-surface); POST /api/anomalies/scan verified (server/routes/anomalies.ts:63)"; `crossSurfaceDeps[2]`).
- **DEFAULT (ratify or override):** **search-traffic keeps** AnomalyAlerts (full panel: ack/dismiss/scan actions, not display-only — cockpit's own audit demands this); **cockpit consumes via a hand-off card** that deep-links in. Neither the cockpit nor global-ops mounts the actionable panel.
- **Consequence if unresolved:** each surface's default cedes to the other — the panel drops from both (orphaned capability), or ships twice with divergent ack state.

### C-4 Insight-feed home (insights Q6 / search-traffic I1–I6)
- **Question:** Where does the operator 21-type priority insight feed live?
- **Claimants:** insights (Q6: "Will the operator Insights Engine host the full 21-type priority feed (covers search-traffic I1–I6 too)?" — default **yes**; `crossSurfaceDeps[3]`); search-traffic (OQ2 blocks O4, Q12, G4, I1 — its bridge default reuses the live `InsightFeed` component unstyled inside its tabs).
- **DEFAULT (ratify or override):** the **operator Insights Engine (engine surface) is the single 21-type feed home** (one DataTable/GroupBlock feed, severity pills, domain FilterChips). Search-traffic may render *domain-filtered* views by reusing the live `InsightFeed` component unstyled (its OQ2 bridge) — that is a filtered window, not a second home; no re-implementation of typed renderers outside engine.
- **Consequence if unresolved:** 20+ typed insight renderers rebuilt twice, drifting per UI/UX rule 9.

### C-5 Competitor-set editing home
- **Question:** Does competitor-set editing consolidate to Workspace Settings as the single home?
- **Claimants:** competitors (Q4 / rows #34–36: "only the edit-UI HOME (Strategy vs Workspace settings) is undecided"; endpoint `POST /api/seo/competitors/:ws` exists, `seo-provider.ts:196-217`); global-ops (settings zone). Pre-filled by **AD-014**.
- **DEFAULT (ratify or override):** **Workspace Settings is the single edit home** (Auto-discover ships there); the Competitors page shows **read-only FilterChips + "Edit set" routing** to Workspace Settings; endpoints unchanged; strategy-generation retains programmatic access.
- **Consequence if unresolved:** two edit UIs against one endpoint — wrong-lane build plus a clobber-risk seam.

### C-6 Brand-AI Page Strategy / Copy Pipeline destination
- **Question:** Do Page Strategy blueprints (rows 39-41) and the copy pipeline (rows 42-45) relocate to Content Pipeline now?
- **Claimants:** brand-ai (Q2 — "pointer says Content Pipeline; pipeline.js has none of it"; its default: relocate wholesale); content-pipeline (named target with **zero reserved room** — brand-ai `unknowns[0]`; all 14 copy-pipeline endpoints verified at `server/routes/copy-pipeline.ts`).
- **DEFAULT (ratify or override):** **stay as T1 carry-over drill-ins on brand-ai now** (AD-010 pattern) — plan W0.6 overrides the surface-doc relocate default because the destination reserved no room. The content-pipeline relocation becomes a **named C3-later ticket**; the W4 content-pipeline ticket-cut must NOT absorb these rows.
- **Consequence if unresolved:** relocation into a destination that reserved no room — the moved capability lands nowhere mid-fan-out (the AeoReview/ContentDecay hazard, repeated).

### C-7 Diagnostics fate
- **Question:** Does Diagnostics keep a nav entry + reports-list lens, or become prototype drill-in-only?
- **Claimants:** global-ops (`capabilityClassification[25]` row 85 = open-question; its OQ default: "Keep nav entry and add a list lens — without it old reports become unreachable after insight resolution"); engine + search-traffic (per AD-022 `surfaces`, as `?report=` senders). Pre-filled by **AD-022**.
- **DEFAULT (ratify or override):** **keep the Diagnostics nav entry + add a reports-list lens.** The Run-Deep-Diagnostic CTA and `?report=` deep-link keep pointing at the existing page unchanged. Per-move deep-diagnostic (E8) and stage-as-backing-move (sn-global-ops-5) stay deferred.
- **Consequence if unresolved:** resolved-insight reports become permanently unreachable (orphaned capability) while two sender surfaces keep emitting dead `?report=` links.

### C-8 Meeting Brief
- **Question:** Who owns Meeting Brief (formerly claimed by cockpit rows 36-37, global-ops §8, content-pipeline)?
- **Claimants:** none remaining — blocking hole #1 (`completeness-critique.json`) resolved by owner cut.
- **DEFAULT (already ratified 2026-07-05, listed for completeness):** **RETIRED.** W0.3 executes the route-removal checklist for Page `brief`, seeds `D8_REDIRECT_MAP.md` (`brief` → `home`), retargets its deep-link senders (incl. the cockpit `?tab=meeting-brief` receiver, cockpit row 4), and corrects the misattributed Parity Ledger row. Cockpit Q2 is superseded.
- **Consequence if unresolved:** n/a — ratified; listed so no ticket resurrects it.

---

## Frozen Contracts (no lane may alter — fan-out plan sequencing rule 5)

1. **Links snapshot shapes read by intelligence slices** — `server/intelligence/page-profile-slice.ts:179-180` reads `getInternalLinks(...)` snapshots as `InternalLinkResult`. Snapshot shape changes break the slice silently.
2. **`checkSiteLinks` signature** — `server/link-checker.ts:100`: `checkSiteLinks(siteId: string, workspaceId?: string, domain?: string): Promise<LinkCheckResult>`.
3. **`?tab=dead-links` deep-link aliases** — sender `src/components/SeoAudit.tsx:536` → receiver tab id `'dead-links'` in `src/components/LinksPanel.tsx:21,72` (+ label map `src/components/layout/RebuiltBreadcrumb.tsx:51`). Two-halves contract; both halves survive every links/site-audit PR.
4. **`LocalSeoVisibilityPanel` props** — `src/components/local-seo/LocalSeoVisibilityPanel.tsx`, consumed by `PageIntelligence.tsx:272`, `KeywordStrategy.tsx:347` (flag-OFF path), and `KeywordDetailDrawer` (`LocalSeoVisibilityBadge`). Prop shape frozen.
5. **Route id `local-seo`** — `src/routes.ts:7` Page union + `src/lib/navRegistry.tsx:141`. Label may change ("Local Presence"); the id may not.
6. **SEO-editor same-endpoint write-through** — `PUT /api/webflow/pages/:pageId/seo` (`server/routes/webflow.ts:192`, accepts `{seo, openGraph, title}` with mirrored OG write via `useSeoEditorPageWorkflow`). WorkspaceHome `SeoChangeImpact` depends on this write-through (seo-editor dep: "do not bypass PUT pages/:pageId/seo").
7. **C-lane public audit shape** — `getEffectiveAudit` / `getLatestEffectiveSnapshot` (`server/audit-snapshot-views.ts`, consumed at `server/routes/public-portal.ts:18`).
8. **`getContentPerformance` public audience** — `server/domains/content/content-performance.ts:177` (`audience: 'public'` wrapper at `:299`).
9. **Public recommendation projection (A1/A2)** — `GET /api/public/recommendations/:workspaceId` (`server/routes/recommendations.ts:150`) + allow-list projection `server/recommendation-public-projection.ts` (EMV stripped, `impactBand` only — trust invariant).
10. **Analytics annotations public read** — `GET /api/public/annotations/:workspaceId` (`server/routes/annotations.ts:16`); annotations bridge (`ANNOTATION_BRIDGE_CREATED`) untouched.
11. **`schema_item` / `schema_plan` deliverables** — `shared/types/client-deliverable.ts:21-22` + migration `server/db/migrations/111-client-deliverable.sql` (incl. `parent_deliverable_id` self-FK and `external_ref` = site_id for `schema_plan`).

---

## Ratification

`Status: DRAFT — awaiting owner walk`

- [ ] C-1 InsightsEngine rec-set mount — engine owns operator mount; C-lane keeps Health-slot carry-over
- [ ] C-2 Branded-demand split — ai-visibility owns; search-traffic links *(inverts surface-doc default — decide deliberately)*
- [ ] C-3 AnomalyAlerts — search-traffic keeps; cockpit hand-off card
- [ ] C-4 Insight-feed home — engine is the 21-type feed home; search-traffic filtered reuse only
- [ ] C-5 Competitor-set editing — Workspace Settings single home (AD-014)
- [ ] C-6 Page Strategy / Copy Pipeline — T1 drill-ins on brand-ai now; relocation = C3-later ticket
- [ ] C-7 Diagnostics — keep nav entry + reports-list lens (AD-022)
- [ ] C-8 Meeting Brief — retired (acknowledge; already ratified 2026-07-05)
- [ ] Frozen Contracts register 1–11 — acknowledged as binding on every ticket-cut

On full tick-through, flip Status to `RATIFIED — <date>` and record it in `owner-decisions.json`.
