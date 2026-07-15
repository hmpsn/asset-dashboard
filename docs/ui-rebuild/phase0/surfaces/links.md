# Phase 0 Surface Ledger — Links (Search & Site Health)

**Surface:** Links — admin `Page 'links'` (`/ws/:workspaceId/links`)
**HEAD entry points:** `src/routes.ts:6` (`'links'` in `Page` union); `src/lib/navRegistry.tsx:129-130` (group `site-health`, `needsSite: true`, "Internal links, broken links, and redirect management"); mounted in `src/App.tsx:406` (`<LinksPanel siteId workspaceId>`, requires `selected.webflowSiteId`).
**Prototype view read:** `hmpsn studio Design System/mockup/links.js` (457 lines).
**Parity Ledger row:** "Links · LinksPanel · links" — `status:'improved'`, 4 tool rows all `s:'present'` (Redirects / InternalLinks / LinkChecker / SiteArchitecture); plus separate row "Site Architecture — `status:'moved'` → links.js (Architecture tab)". No Gap/Partial rows for this surface in the ledger.

Audit stance: additive-only. "Prototype omits X" ≠ "X is cut" — but every omission with no named home is marked **at_risk** below.

---

## 1. Capability table

Status legend: `preserved` = obvious same-or-better home in prototype; `improved` = prototype upgrades it; `new_proposed` = prototype-only, needs sign-off; `at_risk` = exists at HEAD, no visible home in prototype.

### Shell (LinksPanel)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | 3 sub-tabs: Redirects / Internal Links / Dead Links | `src/components/LinksPanel.tsx:18-22,66-78` | preserved/improved | links.js sub-tabs | Prototype keeps all 3 and adds a 4th (Architecture) + per-tab count badges (improvement). |
| 2 | `?tab=` deep-link receiver (valid-value guard, fallback `redirects`, clear-on-manual-change) | `src/components/LinksPanel.tsx:27-42` via `src/lib/tab-search-param.ts`; contract test `tests/contract/tab-deep-link-wiring.test.ts` | at_risk | links.js `LinksView.open(t)` exists (`links.js:445`) but prototype has no URL param contract | Sender exists at HEAD: `SeoAudit.tsx:536` navigates `adminPath(ws,'links')+'?tab=dead-links'`. Rebuild MUST wire the two-halves `?tab=` contract (CLAUDE.md UI rule 12). |
| 3 | Site Audit fix-routing lands on Links (`redirect_chain`, `broken_link`, `missing_canonical` → `'links'`) | `src/components/audit/types.ts:99`; `SeoAudit.tsx:536,550` | preserved | Ledger note: "with Site Audit deep-linking in" | Cross-surface contract with Site Audit; verify at build time. |
| 4 | Dead Links tab lazy-loaded with ErrorBoundary + Suspense spinner | `src/components/LinksPanel.tsx:11,72-78` | preserved | implementation detail | Keep code-splitting behavior. |

### Tab 1 — Redirects (`RedirectManager.tsx`, 552 lines)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 5 | Run redirect scan (static + CMS pages via sitemap; traces multi-hop redirects, loops, broken destinations) | `src/components/RedirectManager.tsx:113-143`; `server/redirect-scanner.ts:65-70,202`; endpoint `server/routes/webflow-analysis.ts:198-236` | preserved | Redirects tab (implicit rescan) | Prototype shows results only; scan trigger implied by "Last crawl 6h ago". |
| 6 | GSC ghost-URL detection (pages Google still indexes that no longer exist, w/ clicks+impressions) | `server/routes/webflow-analysis.ts:203-220`; `server/redirect-scanner.ts:252-261` | preserved (data), improved (display) | Redirects tab "404s/mo" hits column | Prototype's per-404 hit counts (`links.js:228`) are exactly what GSC ghost clicks/impressions can feed — but HEAD's `PageStatus` does NOT expose hits today (`server/redirect-scanner.ts:38-48`). Data ticket, not UI ticket. |
| 7 | Redirect-target recommendations (heuristic slug keyword-overlap match against healthy pages) | `server/redirect-scanner.ts:143-160,357-380` | preserved | Redirects tab suggested 301 rows | Prototype labels these "AI 96%" confidence (`links.js:63,231`). HEAD is heuristic, not AI, and computes NO confidence score. Displaying a fabricated "AI %" would violate "never change a client-facing number's meaning" — see stop-and-ask Q3. |
| 8 | Accept / Dismiss suggested redirect rule | `src/components/RedirectManager.tsx:145-146,417-419` | preserved | `links.js:236-237,446-447` accept/reject icons | Same interaction. |
| 9 | Edit redirect target inline (Enter/Escape, save) | `src/components/RedirectManager.tsx:147-151,394-406`; "Change target" after accept `:422-428` | at_risk | none in prototype | Prototype rows are accept/reject only. Editing the AI/heuristic target is how the operator fixes a wrong suggestion — losing it makes bad suggestions dead ends. |
| 10 | Export accepted rules as Webflow-compatible CSV (`Old Path,Redirect To`) | `src/components/RedirectManager.tsx:155-165,369-371` | preserved | `links.js:251,448-450` Export CSV (n) | Prototype keeps count-in-button (improvement). |
| 11 | Copy all accepted rules to clipboard | `src/components/RedirectManager.tsx:167-172,366-368` | at_risk | none in prototype | Small but real; used when pasting into chat/tickets instead of CSV. |
| 12 | Send accepted rules to client as `redirect_proposal` client action + optional note (≤2000 chars) | `src/components/RedirectManager.tsx:174-203,362-365,375-387` | at_risk | none in prototype Redirects tab | Prototype has per-suggestion "Client" send ONLY on Internal Links tab. The client-facing consumer exists (`RedirectRenderer` in `src/components/client/decision-renderers.tsx`, FEATURE_AUDIT.md:922) — dropping the producer strands it. |
| 13 | Redirect Chains panel: multi-hop trace (per-hop status badges), loop detection badge, internal/external badge, final destination link, expand/collapse | `src/components/RedirectManager.tsx:288-343`; chain model `server/redirect-scanner.ts:21-29` | at_risk | none in prototype | **Biggest omission on this tab.** Chains are a headline capability (FEATURE_AUDIT.md:2060-2061) and Site Audit's tip "Review redirect chains in Redirects" (`SeoAudit.tsx:550`) deep-links here. Prototype only shows 404→301 suggestions. |
| 14 | All-pages status table: HTTP code badge per page, path+title, source badge (static/cms/GSC), redirects-to link, inline suggested-redirect row | `src/components/RedirectManager.tsx:473-527`; `httpCodeBadge :206-212` (annotated `status-semantic-ok`, FEATURE_AUDIT.md:7615) | at_risk | none in prototype | The full-inventory view (incl. healthy pages) is how you audit a migration; prototype shows only 404s-with-suggestions. |
| 15 | Filter tabs (All / Redirects / 404s / Errors) + text search on path/title | `src/components/RedirectManager.tsx:69,214-222,435-471` | at_risk | none in prototype | Follows from #14. |
| 16 | Summary stat cards: Healthy / Redirecting / 404s / Chains (+ longest chain) | `src/components/RedirectManager.tsx:280-285` | partially preserved | `links.js:241-245` stats (404 URLs / hits wasted / rules ready) | Prototype replaces health-inventory stats with action-oriented stats (arguably improved) but loses Healthy/Chains counts → tied to #13/#14. |
| 17 | Snapshot persistence + auto-restore on mount (survives deploys), scanned-at timestamp, Rescan | `src/components/RedirectManager.tsx:88-111,269-277`; `server/redirect-store.ts:82,101`; snapshot endpoint `webflow-analysis.ts:239-243` | preserved | implied by prototype "Last crawl 6h ago" | Must keep GET `/api/webflow/redirect-snapshot/:siteId`. |
| 18 | Activity log on scan (`redirects_scanned`) | `server/routes/webflow-analysis.ts:227-229`; type `server/activity-log.ts:48`; rendered in `ActivityFeed.tsx:26`, `WorkspaceOverview.tsx:523` | preserved | server-side, unchanged | Keep on any new scan trigger. |
| 19 | Empty state (never scanned) w/ CTA + inline error; loading state; error state w/ retry | `src/components/RedirectManager.tsx:224-260,243-247` | preserved | `links.js:224` empty state | Prototype's empty state promises "New 404s from the next crawl will surface here" — implies scheduled crawl (see new_proposed N3). |
| 20 | How-to tips block (chains latency, Webflow 301 import path, cross-links to Site Audit / Dead Links) | `src/components/RedirectManager.tsx:530-548` | preserved/improved | `links.js:246` how-it-works note | Prototype keeps the Webflow-CSV-bridge explanation. |

### Tab 2 — Internal Links (`InternalLinks.tsx`, 461 lines)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 21 | AI internal-link suggestion analysis (sitemap+CMS discovery up to 100 pages, content fetch, `callAI` gpt-5.4 `researchMode`, `feature:'internal-links'`, voice-layered `buildSystemPrompt`, prompt-injection sanitization, Zod `parseJsonSafeArray` validation, path-existence filtering) | `server/internal-links.ts:198,288-314,369-380,383-401`; schema `server/schemas/internal-links-schemas.ts`; endpoint `webflow-analysis.ts:246-284` | preserved | Internal tab + Re-analyze (`links.js:292,453`) | Also enriched with page-keyword clusters (`internal-links.ts:301-314`) and SEO prompt blocks (`:288`) per FEATURE_AUDIT.md:4526. |
| 22 | Suggestion rows: from→to, anchor text, reason, priority (high/med/low) | `src/components/InternalLinks.tsx:358-420`; type `shared/types/internal-links.ts:1-9` | preserved | `links.js:265-281` | Prototype keeps all fields, sorted priority-first. |
| 23 | Priority filter tabs w/ live counts + free-text search (page/title/anchor) | `src/components/InternalLinks.tsx:84-99,252-285` | at_risk | none in prototype | Prototype has no filter/search on this tab; at 30-50 suggestions this matters. |
| 24 | List vs grouped-by-source-page view toggle | `src/components/InternalLinks.tsx:286-305,315-356` | at_risk | none in prototype | Grouped view is the "work one page at a time" mode. |
| 25 | Copy `<a href>` HTML snippet per suggestion | `src/components/InternalLinks.tsx:342-350,381-389` | at_risk | prototype replaces with "Insert" (see N1) | If Insert ships, Copy may be subsumed; until Insert exists, Copy is the only implement path — don't drop before replacement lands. |
| 26 | Orphan-page detection + expandable list (inbound=0; shows path, title, outbound count) | `src/components/InternalLinks.tsx:224-250`; computed `server/internal-links.ts:247-262` | preserved | `links.js:287-288` orphan callout w/ page chips | Prototype loses per-orphan outbound-count detail (minor). |
| 27 | Page link-health scoring (per-page inbound/outbound score 0-100) + Avg Link Score stat | `server/internal-links.ts:247-259`; `src/components/InternalLinks.tsx:221` | at_risk | none in prototype | `pageHealth` powers orphans (kept) but the score itself and 5-stat row (High/Med/Low/Orphans/AvgScore, `InternalLinks.tsx:216-222`) shrink to 3 stats (`links.js:282-286`). Avg Link Score + per-page health has no home. Also feeds `page-profile-slice` (see #40). |
| 28 | Send filtered suggestion batch to client as ONE `internal_link` client action + optional note (≤2000), summary payload (pageCount, existingLinkCount, orphanCount) | `src/components/InternalLinks.tsx:101-131,177-181,202-213`; mapper `src/lib/internal-link-client-action.ts` | at_risk (shape change) | prototype: per-suggestion "Client" button (`links.js:277-278,452`) | Per-item send is arguably better UX but changes the client-action payload shape consumed by `InternalLinkRenderer`/Inbox routing (`docs/rules/inbox-section-routing.md`) and drops the note + batch summary. Needs owner decision — see Q4. |
| 29 | Reanalyze (re-run analysis, snapshot updated via React Query `setQueryData`) | `src/components/InternalLinks.tsx:53-77,182-184` | preserved | `links.js:292,453` Re-analyze | |
| 30 | Snapshot persistence + auto-restore (React Query, 5-min staleTime); server save on every analyze | `src/components/InternalLinks.tsx:43-51`; `server/performance-store.ts:358-362`; snapshot endpoint `webflow-analysis.ts:287-290` | preserved | implied | Keep GET `/api/webflow/internal-links-snapshot/:siteId`. |
| 31 | Outcome tracking: top-5 suggestions recorded as `internal_link_added` actions (`not_acted_on`, deduped by source) | `server/routes/webflow-analysis.ts:253-277` | preserved | server-side, unchanged | Feeds outcome learnings; must survive any endpoint rework. Also `invalidateIntelligenceCache` (`:276`). |
| 32 | Partial-fetch diagnostics: `pageCount/attemptedPageCount` warning states (password-protected site, <2 pages, all-healthy success state) | `src/components/InternalLinks.tsx:438-458`; `server/internal-links.ts:414` (FEATURE_AUDIT.md:4154) | at_risk | prototype has generic empty state only | These diagnostics were built specifically because silent empty results confused operators. |
| 33 | Empty/analyze CTA, contextual loading ("Analyzing page content..."), `ErrorState` w/ retry+dismiss | `src/components/InternalLinks.tsx:133-165,189-200` | preserved | `links.js` empty states | |
| 34 | How-to-implement / SEO-impact tips block (cross-links SEO Editor, Site Audit) | `src/components/InternalLinks.tsx:424-436` | preserved | `links.js:323` note (dead tab) + `lk-grad` footer | |

### Tab 3 — Dead Links (`LinkChecker.tsx`, 290 lines)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 35 | Crawl-domain selector (staging vs custom/live domains) before running check | `src/components/LinkChecker.tsx:48-57,111-124`; `server/link-checker.ts:33-36`; endpoint `webflow-analysis.ts:166-176` | at_risk | none in prototype | Real differentiator (staging-gated sites give false 404s). Endpoint GET `/api/webflow/link-check-domains/:siteId`. |
| 36 | Full-site link check: every page (CMS via sitemap), extracts links incl. onclick + form actions, dedupe, `/cdn-cgi/` Cloudflare filter; checks 404/timeout/error + redirects | `server/link-checker.ts:38-57,100`; canonical extractor `server/html-analysis-utils.ts` (FEATURE_AUDIT.md:1149,1699-1700); endpoint `webflow-analysis.ts:178-189` | preserved | Dead tab | Prototype shows results; run trigger implied. |
| 37 | Result stats: total links / healthy / dead / redirects | `src/components/LinkChecker.tsx:19-26,156-173` | partially preserved | `links.js:318-322` broken/internal/external stats | Prototype loses Total Links + Healthy counts and the all-healthy success banner (`LinkChecker.tsx:175-183` — prototype has equivalent empty state `links.js:302`). |
| 38 | Dead vs Redirects sub-toggle (3xx links found in content) + internal/external type filter | `src/components/LinkChecker.tsx:43-44,186-217` | at_risk | none in prototype | Prototype dead tab lists dead links only; the 3xx "links pointing at redirects" list (update-your-links workflow) has no home (distinct from Redirects tab's page-level scan). Type filter partially covered by internal/external stat split. |
| 39 | Export CSV of dead links + redirects (8 columns) | `src/components/LinkChecker.tsx:82-99,219-227` | at_risk | none in prototype | Redirects tab CSV ≠ this CSV (different data). |
| 40 | Per-link detail: URL (clickable), status code, statusText, found-on page + slug + anchor text, type badge; Re-check button; last-checked timestamp + crawled domain | `src/components/LinkChecker.tsx:228-287` | preserved | `links.js:304-316` rows | Prototype keeps status/url/found-on/anchor; loses statusText + crawled-domain footer (minor). |
| 41 | Snapshot persistence + auto-restore on mount | `src/components/LinkChecker.tsx:72-80`; `server/performance-store.ts:348-352`; endpoint `webflow-analysis.ts:192-195` | preserved | implied | |
| 42 | Empty/first-run state w/ crawl explanation; long-running loading state ("may take a few minutes") | `src/components/LinkChecker.tsx:101-146` | preserved | `links.js:302` | Note: HEAD runs this as a synchronous long GET, not a background job — see trade-offs. |

### Cross-surface wiring owned by this surface's data

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 43 | Site Audit auto-runs dead-link check as part of every audit (opt-out) and deep-links results here | `server/seo-audit.ts:234` (`checkSiteLinks`); `SeoAudit.tsx:536` (FEATURE_AUDIT.md:1700) | preserved | Parity Ledger Site Audit row: "LinkChecker (dead links) — present — dead-link panel + Links" | Shared server module; keep `checkSiteLinks` signature stable. |
| 44 | Intelligence slices read this surface's snapshots: `site-health-slice` (link check + redirect snapshot), `page-profile-slice` (internal-links snapshot incl. pageHealth), AdminChat context (link check) | `server/intelligence/site-health-slice.ts:194,282`; `server/intelligence/page-profile-slice.ts:179`; `server/admin-chat-context.ts:920` | preserved | server-side, unchanged | Any change to snapshot shape breaks AI context silently — keep types. |
| 45 | Client Inbox renders the outputs: `internal_link` and `redirect_proposal` client actions via shared decision-renderers | `src/components/client/decision-renderers.tsx` (`InternalLinkRenderer`, `RedirectRenderer`); consumed by `DecisionDetailModal.tsx`, `DeliverableDetailModal.tsx` (FEATURE_AUDIT.md:922) | preserved | Inbox surface (other auditor) | Producer half lives HERE (#12, #28). |
| 46 | Auth: all endpoints behind `requireWorkspaceSiteAccessFromQuery()` (admin HMAC pass-through) | `server/routes/webflow-analysis.ts:166,178,192,198,239,246,287` | preserved | server-side, unchanged | No tier gates, no client-facing route, no WebSocket events on this surface at HEAD (snapshot GETs mutate stores without `broadcastToWorkspace` — pre-existing; a rebuild that adds broadcasts must add both halves per data-flow rule 1/2). |

### Prototype-only NEW functionality (needs sign-off)

| # | Proposal | Prototype evidence | HEAD gap | Notes |
|---|----------|--------------------|----------|-------|
| N1 | "Insert" internal link directly into source page (publishes with next sync) | `links.js:275-276,451` | No write path exists; HEAD is copy-HTML + manual Webflow edit (`InternalLinks.tsx:430`) | Needs SEO Editor / write-target contract (`docs/rules/seo-editor-write-targets.md`). Big scope. |
| N2 | Per-404 traffic counts ("404s/mo" hits) + confidence % on redirect suggestions | `links.js:56-57,163-167,228-231` | `PageStatus` has no hits/confidence fields (`server/redirect-scanner.ts:38-48`); GSC ghost URLs carry clicks/impressions but only for ghost pages (`webflow-analysis.ts:204-214`) | Data ticket. Confidence % must not be invented (Q3). |
| N3 | Scheduled/automatic crawls ("Last crawl 6h ago"; "next crawl re-checks") | `links.js:431,224,302` | All three scans are manual, synchronous GETs | Would want the background-job platform (`docs/rules/background-generation.md`). |
| N4 | Dead-link row actions: "Redirect" (send internal dead link to Redirects tab pre-staged) and "Reviewed" (dismiss/mark handled, persisted) | `links.js:310-315,454-455` | No dead-link→redirect handoff; no reviewed/suppression state on Links (Site Audit has dead-link suppressions per Parity Ledger, Links does not) | Good additive flow; needs persistence design. |
| N5 | Architecture as 4th Links tab (URL tree existing/planned/strategy/gap, schema coverage, gaps + "Add page", orphans, depth distribution) | `links.js:332-412,426`; Parity Ledger "Site Architecture → moved → Links" | Exists at HEAD inside Page Intelligence (`src/components/PageIntelligence.tsx:25,239`, `src/components/SiteArchitecture.tsx:212-267`; API `server/routes/site-architecture.ts:19,34`) | Relocation, not new code. Cross-surface: coordinate with Page Intelligence auditor so it isn't double-counted or dropped. HEAD capabilities to carry: filter (all/existing/planned/strategy/gap) + search (`SiteArchitecture.tsx:216-217,249-267`), schema-coverage cross-ref (`api/content.ts:383`), refresh, empty/error/retry states. Prototype adds "Add page" gap CTA (new). |
| N6 | "Graduates into Insights Engine" — link fixes that recover traffic become insights | `links.js:2-6,435` | No links→insights bridge at HEAD | New integration; bridge-authoring rules apply if built. |

---

## 2. Prototype coverage notes

- **Demonstrates:** 3-tab shell + counts, redirect accept/reject/export-CSV, internal-link opportunities w/ priority+anchor+reason, orphan callout, re-analyze, dead-link listing w/ status+found-on+anchor, empty states, Webflow-CSV how-to note, Architecture tab (tree, filters, gaps, depth, orphans, schema flags).
- **Omits (drives the at_risk rows):** redirect chains UI, all-pages status table + filters/search, edit-target, copy-rules, send-redirects-to-client, internal-links search/filter/grouped-view/copy-HTML/avg-link-score/batch-send-with-note/fetch-diagnostics, dead-links domain selector/3xx-sub-tab/type-filter/CSV/re-check.
- **Proposes new:** N1–N6 above. Prototype's per-view `const css` is explicitly NOT the implementation pattern (Primitive Reuse Audit).
- **Color-law check for rebuild:** prototype uses purple for "AI %" confidence chips and "strategy" tree badges (`links.js:63,140`) — purple is admin-AI-only, fine here (admin surface), but confidence values themselves are unbacked (Q3).

## 3. Parity Ledger reconciliation

- Links row: `status:'improved'`, tools Redirects/Internal/Dead/Architecture all `present`. **No Gap/Partial rows for Links.**
- However the ledger's `present` is mockup-level. This code audit finds the mockup covers the headline loop of each tab but omits 12 concrete HEAD capabilities (#9, #11, #12, #13, #14, #15, #23, #24, #25, #27, #32, #35, #38, #39 — the at_risk set). These are unresolved until the build spec names homes for them; the ledger row should not be treated as closing them.
- "Site Architecture → moved → Links" row: resolvable, contingent on carrying HEAD `SiteArchitecture.tsx` capabilities (filter/search/schema-coverage/refresh) — see N5 and the Page Intelligence surface ledger.

## 4. Trade-offs (quick win vs full)

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Redirects tab | Ship prototype's 404→suggestion→accept/export loop reusing existing scan + snapshot endpoints unchanged; add back Edit-target + Send-to-client + a collapsed "Chains (n)" section using HEAD's chain data | Add GSC-hits column (N2 data work), scheduled crawls (N3), page-status inventory table w/ filters | Without chains + page table, Site Audit's "review redirect chains" deep link lands on a page that can't show chains — broken cross-surface promise |
| Confidence % | Omit the chip entirely (HEAD has none) | Compute a real match-score from the keyword-overlap scorer (`redirect-scanner.ts:143`) and label it "match", not "AI" | Shipping the mockup's fabricated "AI 96%" invents a number — hard violation of "never change a client-facing number" |
| Internal Links | Prototype list + orphans + re-analyze + batch Send-to-client (keep HEAD payload shape); keep Copy-HTML button | Per-suggestion send (new payload contract, Q4), Insert-into-page (N1, needs write-target work), search/filter/grouped view restored | Per-item send without contract work breaks `InternalLinkRenderer`/inbox routing; dropping Copy leaves no implement path until N1 exists |
| Dead Links | Prototype list + stats + Redirect/Reviewed row actions (N4, session-state only at first); keep domain selector + Re-check + CSV from HEAD | Persisted reviewed-state, scheduled re-crawl, 3xx sub-list restored | Dropping domain selector re-introduces false 404s on staging-gated sites (a solved support problem) |
| Scan execution | Keep synchronous GET scans | Move all three scans to background-job platform w/ NotificationBell (aligns with N3) | Sync scans block for minutes and die on deploy — acceptable short-term since it's HEAD parity |
| Architecture tab | Mount existing `SiteArchitecture.tsx` data/API under Links tab 4 (route move only) | Prototype's richer layout + "Add page" gap CTA wired to pipeline | Low — API (`/api/site-architecture/:wsId`) already exists; coordinate removal from Page Intelligence in same commit (route-removal checklist) |

## 5. Open questions (stop-and-ask — owner sign-off required)

1. **Redirect chains + all-pages status table (#13, #14, #15):** prototype has no home for either. Restore inside the new Redirects tab (collapsed sections), move to Site Audit, or cut deliberately? Cutting loses the only chains UI on the platform and breaks `SeoAudit.tsx:550`'s deep-link promise.
2. **Dead Links tab losses (#35, #38, #39):** domain selector, 3xx "links pointing at redirects" sub-list, and dead-links CSV export have no prototype home. Carry all three into the new Dead tab?
3. **Fabricated "AI %" confidence (N2):** mockup shows AI-branded confidence on redirect suggestions, but HEAD's recommender is a keyword-overlap heuristic with no score. Options: (a) drop the chip, (b) expose the heuristic's real match score labeled "match", (c) build an actual AI scoring pass. Which?
4. **Send-to-client shape (#12, #28):** prototype changes internal-links send from one batched client action (with note + summary) to per-suggestion sends, and drops redirect-proposal send entirely. Both payloads have live client-side consumers (`decision-renderers.tsx`, inbox routing rules). Keep batch semantics, adopt per-item (contract change), or support both?
5. **Architecture relocation (N5):** confirm the move Page Intelligence → Links tab 4, and that HEAD filter/search/schema-coverage/refresh come along. Who owns the removal from Page Intelligence (route-removal + feature-move help-text grep)?
6. **"Insert link" (N1) and "graduates to Insights Engine" (N6):** both are new engineering (Webflow write path; links→insights bridge). Confirm they are post-parity roadmap items, not Phase-1 blockers.
7. **`?tab=` values:** prototype tab ids are `redirects|internal|dead|architecture`; HEAD's are `redirects|internal|dead-links`. Rebuild must keep `dead-links` working (legacy alias) for existing bookmarks + `SeoAudit.tsx:536` — confirm alias approach via `tab-search-param.ts`.

---
*Audited at HEAD of `ui-rebuild-phase-0` (== post-Reconcile origin/staging). Read-only audit; no code changed.*
