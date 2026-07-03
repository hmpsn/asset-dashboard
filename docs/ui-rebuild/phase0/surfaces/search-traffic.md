# Phase 0 Additive-Parity Ledger — Search & Traffic (analytics-hub)

- **Zone:** Search & Site Health
- **HEAD entry point:** `Page 'analytics-hub'` (`src/routes.ts:9`), mounted in `src/App.tsx:416` as `<AnalyticsHub>`; nav entry `src/lib/navRegistry.tsx:119-120` (label "Search & Traffic", group `monitoring`, `needsSite: true`).
- **Prototype view:** `hmpsn studio Design System/mockup/traffic.js` (776 lines, read in full).
- **Audit date:** 2026-07-02, branch `ui-rebuild-phase-0` (read-only audit; this file is the only write).

Status legend: `preserved` (obvious same-or-better home) · `improved` (prototype upgrades it) · `new_proposed` (prototype-only, needs sign-off) · `at_risk` (exists at HEAD, no visible home in prototype). Uncertain = at_risk, never preserved.

---

## 1. Surface shell

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| S1 | 4 sub-tabs: Overview · Annotations · Search Performance · Site Traffic | `src/components/AnalyticsHub.tsx:17-24,45-71` | at_risk (Overview tab) / preserved (other 3) | traffic.js sub-tabs `search`/`analytics`/`annos` (`traffic.js:199,537-540`) | Prototype has 3 tabs — the unified **Overview** tab has no home (see O1–O4 below). |
| S2 | Keyboard shortcut `3` jumps to analytics-hub | `src/App.tsx:259` | at_risk | — | No shortcut map shown in prototype nav; global concern but this surface loses its binding if dropped. |
| S3 | Nav gating: surface requires a connected site (`needsSite`) | `src/lib/navRegistry.tsx:119`, `src/App.tsx:361` | at_risk | — | Prototype always renders demo data; gating/locked state not demonstrated. |
| S4 | No `?tab=` deep link (explicitly exempted) | `src/components/AnalyticsHub.tsx:37` | preserved | — | Prototype tabs are JS state too. If rebuild adds `?tab=`, receiver must follow the two-halves contract (CLAUDE.md UI/UX rule 12). |
| S5 | Page header + contextual subtitle | `src/components/AnalyticsHub.tsx:31-35` | improved | traffic.js narrative header (`traffic.js:484-491,607-612`) | Prototype upgrades to a data-driven narrative headline ("Organic is up +34% this quarter"). |

## 2. Overview tab (AnalyticsOverview)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| O1 | Unified GSC+GA4 metric row: Clicks, Impressions, Avg CTR, Avg Position, Users, Sessions — each a **MetricToggleCard** that toggles its chart line | `src/components/AnalyticsOverview.tsx:41-92,161-180` | at_risk | — | Prototype has KPI tiles per tab (search-only or GA4-only) but **no unified cross-source card row** and **no click-to-toggle chart lines** anywhere (`traffic.js:448-458,551-560` are static tiles). |
| O2 | Unified merged GSC+GA4 trend chart (clicks/impressions/ctr/position/users/sessions on one date-keyed chart, dual y-axes) | `src/hooks/admin/useAnalyticsOverview.ts:59-104`, `src/components/AnalyticsOverview.tsx:183-197` | at_risk | — | Prototype charts are per-source (GSC trend `traffic.js:506`; GA4 users+sessions `traffic.js:621`). The blended one-chart view has no home. |
| O3 | Integration-aware card/line pruning (GSC-only or GA4-only workspaces see only their metrics) | `src/components/AnalyticsOverview.tsx:136-151` | at_risk | — | Prototype assumes both sources connected. |
| O4 | Priority Insights feed on Overview (top-5, severity pills, View All expansion) | `src/components/AnalyticsOverview.tsx:199-210`, `src/components/insights/InsightFeed.tsx:28-104` | at_risk | traffic.js "graduation bridge" is adjacent but different (`traffic.js:493-497`) | Parity Ledger marks "Insights narrative — present", but the prototype shows no insight feed on this surface (see I1–I6). |
| O5 | Delta chips vs previous period on every card (GSC clicks/impressions/position, GA4 users/sessions), position delta inverted + raw-spots suffix | `src/components/AnalyticsOverview.tsx:41-92,94-103`; data from `useAnalyticsOverview.ts:110-120` | preserved | traffic.js KPI deltas (`traffic.js:362-366,545-550`) | Prototype keeps "+X% vs prev" chips incl. invert-for-position (`traffic.js:452`) and bounce goodDown (`traffic.js:554`). |
| O6 | CTR delta deliberately omitted (hook doesn't expose it; shows `—` rather than a wrong value) | `src/components/AnalyticsOverview.tsx:63` | preserved | — | Behavior contract: never show a fabricated delta. Prototype search tab has no CTR KPI at all (see Q7). |
| O7 | Date range presets 7d/28d/90d/6mo/16mo (GSC-appropriate) | `src/components/AnalyticsOverview.tsx:106,157`, `src/components/ui/constants.ts:163-169` | at_risk | traffic.js range switch 28d/90d/12m (`traffic.js:704-708`) | Prototype **reduces** the preset set: loses 7d and 16-month lookback (GSC's max window). 16mo matters for YoY seasonal reads. |
| O8 | Loading state ("Loading analytics...") and no-integrations EmptyState with setup guidance | `src/components/AnalyticsOverview.tsx:113-130` | at_risk | — | Static prototype demonstrates no loading/empty/error/locked states (Build Conventions require all four). |

## 3. Search Performance tab (SearchDetail — GSC)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| Q1 | GSC KPI cards: Clicks, Impressions, CTR, Position with comparison deltas (`%`, `pt`, raw), each toggling a chart line | `src/components/SearchDetail.tsx:175-213` | improved (values) / at_risk (toggle) | traffic.js KPI row + sparklines (`traffic.js:448-458`) | Prototype adds per-KPI sparklines (improvement) but tiles are static — line-toggle interaction lost. |
| Q2 | Search trend chart: clicks/impressions/ctr/position lines, annotations overlaid, click-to-annotate | `src/components/SearchDetail.tsx:216-231` | improved / at_risk (interactions) | traffic.js trendChart w/ prior-period dashed overlay + annotation markers (`traffic.js:393-414,501-507`) | Prototype adds prior-period comparison line (improvement, HEAD lacks it). But prototype chart is single-metric (traffic) — ctr/position/impressions lines lost; click-to-annotate lost (see A-group). |
| Q3 | Ranking-drop **callout bubbles** pinned to insight `detectedAt` date on chart (top-2 critical/warning ranking_movers) | `src/components/SearchDetail.tsx:101-112`, `AnnotatedTrendChart.tsx:36-41,395-413` | at_risk | — | Not demonstrated in prototype. |
| Q4 | Queries ⇄ Pages table toggle | `src/components/SearchDetail.tsx:65,251-271` | preserved | traffic.js `qpTab` seg control (`traffic.js:525-528`) | |
| Q5 | Sortable columns (clicks/impressions/ctr/position, asc/desc toggle), sticky header, scrollable body height-matched to sidebar | `src/components/SearchDetail.tsx:128-138,289-297,70-78` | at_risk | — | Prototype tables are static, unsorted, capped at ~6 demo rows. |
| Q6 | Insight badges on query/page rows: LOW CTR · NEAR P1 · CANNIBAL · RANK UP/DROP · DECAY (built from live insight feed) | `src/components/SearchDetail.tsx:37-61,299-345` | at_risk | traffic.js `fav` dot is a strategy-keyword marker only (`traffic.js:461-462`) | The insight-to-row cross-link is a signature capability; the prototype's green dot doesn't carry type/severity. |
| Q7 | CTR shown per row + CTR KPI | `src/components/SearchDetail.tsx:194-202,287` (rows via `KeywordTable` columns) | at_risk | — | Prototype search tab drops CTR everywhere (KPIs: traffic/clicks/impressions/position; query rows: clicks/impr/position only, `traffic.js:460-465`). |
| Q8 | Pages table: external-link icon opens the live URL; page URLs normalized for display | `src/components/SearchDetail.tsx:315,331-345`, `normalizePageUrl` import line 10 | at_risk | — | Prototype page rows aren't links. |
| Q9 | GSC **Devices** breakdown (share bars, clicks, CTR, position per device) | `src/components/SearchDetail.tsx:354-378` | at_risk | — | Prototype has devices only on the GA4 tab; GSC device split (with position/CTR) has no home. |
| Q10 | GSC **Top Countries** (top 8, clicks + position) | `src/components/SearchDetail.tsx:380-397` | at_risk | — | Not in prototype (either tab). |
| Q11 | GSC **Search Types** breakdown (web/image/video share + position) | `src/components/SearchDetail.tsx:399-423` | at_risk | — | Not in prototype. |
| Q12 | Domain-filtered insight feed (`domain="search"` + filter chips) between chart and tables | `src/components/SearchDetail.tsx:234-241` | at_risk | — | See I-group. |
| Q13 | Not-configured EmptyState ("Search Console not configured" + settings pointer), error banner, loading state | `src/components/SearchDetail.tsx:140-148,161-170` | at_risk | — | No states in prototype. |
| Q14 | Full-row query text (no truncation) on queries view | `src/components/SearchDetail.tsx:292` (`truncateKeyword={false}`) | preserved | prototype ellipsizes (`traffic.js:61`) | Minor: keep no-truncate or tooltip. |

## 4. Site Traffic tab (TrafficDetail — GA4)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| G1 | GA4 KPI cards: Users, Sessions (toggleable lines) + Bounce Rate, Avg Duration (display-only, invert-delta bounce) | `src/components/TrafficDetail.tsx:135-173` | preserved (values) / at_risk (toggles) | traffic.js GA4 KPIs users/sessions/bounce/avg-engagement (`traffic.js:551-560`) | Same static-tile caveat as Q1. |
| G2 | Traffic trend chart (users/sessions/pageviews lines) with annotations + click-to-annotate | `src/components/TrafficDetail.tsx:176-192` | preserved (users+sessions) / at_risk (pageviews line, annotate interaction) | traffic.js gaTrendChart (`traffic.js:417-438,616-622`) | Prototype chart draws users+sessions with annotation markers; pageviews series absent. |
| G3 | Exact date-range readout ("start — end") + full presets 7d…1y | `src/components/TrafficDetail.tsx:126-131`, `constants.ts:154-161` | at_risk | prototype: 28d/90d/12m only | Preset reduction; explicit date-window readout absent. |
| G4 | Domain-filtered insight feed (`domain="traffic"`) | `src/components/TrafficDetail.tsx:195-202` | at_risk | — | See I-group. |
| G5 | **Growth Signals** card (user/session/pageview growth %, bounce change) | `src/components/TrafficDetail.tsx:205-232` | at_risk | partially covered by narrative headline (`traffic.js:607-611`) | The compact multi-metric growth read-out has no dedicated home. |
| G6 | **Engagement Analysis** card (new/returning engagement rates, top-page avg engagement, organic avg engagement) | `src/components/TrafficDetail.tsx:235-258` | at_risk | nvr block covers segment engagement (`traffic.js:580-584`) | Top-page + organic engagement comparisons lost. |
| G7 | **Organic vs All Traffic** card (organic share of users, organic vs all bounce, organic vs all engagement) | `src/components/TrafficDetail.tsx:262-305`; server `ga4Admin.organic` (`src/api/analytics.ts:113-114`) | at_risk | — | Whole card absent from prototype — key SEO-agency proof metric. |
| G8 | **Top Pages** table (pageviews + users per path, rank-numbered, scrollable) | `src/components/TrafficDetail.tsx:308-329` | at_risk | prototype has landing pages only (`traffic.js:586-591`) | HEAD has BOTH Top Pages (all pageviews) and Landing Pages (entries); prototype keeps only landing. |
| G9 | **Traffic Sources** (top 10 source/medium, session share bars) | `src/components/TrafficDetail.tsx:333-353` | preserved | traffic.js sources card (`traffic.js:562-571,624-629`) | |
| G10 | **Devices** (GA4 share bars + user counts + icons) | `src/components/TrafficDetail.tsx:355-374` | preserved | traffic.js devices card (`traffic.js:573-578,630-633`) | |
| G11 | **Top Countries** (GA4 users) | `src/components/TrafficDetail.tsx:376-381` | at_risk | — | Not in prototype GA4 tab. |
| G12 | **New vs Returning** segments (share, users, engagement rate, avg engagement time) | `src/components/TrafficDetail.tsx:384-414` | preserved | traffic.js nvr card (`traffic.js:580-584,637-641`) | |
| G13 | **Events & Conversions** collapsible: Key Events grid (count/users/rate) + Top Landing Pages table (sessions/users/bounce/conversions, top 20) | `src/components/TrafficDetail.tsx:419-498` | preserved / improved | traffic.js section 03 with landing⇄events seg control + Top conversion events card (`traffic.js:593-604,643-659`) | Prototype surfaces events by default (improvement over collapsed-by-default) and adds a top-events bar card. Landing table loses per-row users column (prototype: sessions/bounce/conv only). |
| G14 | GA4 error state with **Retry** (React Query invalidation), not-configured EmptyState, no-data EmptyState, per-card empty states | `src/components/TrafficDetail.tsx:82-121,327,351,372,412` | at_risk | — | No states in prototype. |

## 5. Annotations tab (AnalyticsAnnotations) + chart annotation layer

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| A1 | Annotation CRUD UI: create form (date/category/label), inline edit, delete, hover-reveal actions | `src/components/AnalyticsAnnotations.tsx:48-67,90-123,159-219` | at_risk | traffic.js "Add annotation" is a toast stub; no edit/delete (`traffic.js:692`) | Full CRUD must survive. Server: GET/POST/PATCH/DELETE `server/routes/google.ts:477-535`. |
| A2 | Category filter pills (All/Site Change/Algorithm/Campaign/Other) + newest-first sort + count badge | `src/components/AnalyticsAnnotations.tsx:125-154,69-71,86` | at_risk / preserved (timeline list) | traffic.js timeline list + category legend (`traffic.js:663-695`) | Prototype shows list + legend but no filtering. |
| A3 | Click-anywhere-on-chart → create-annotation popover (label + category, Enter/Escape, click-outside dismiss) | `src/components/charts/AnnotatedTrendChart.tsx:186-270,288-302` | at_risk | — | Signature interaction on all three HEAD charts; prototype markers are display-only (`traffic.js:381-390`). |
| A4 | Annotation markers on charts with hover tooltip (date/category/label); dashed reference lines auto-hidden above 10 annotations | `AnnotatedTrendChart.tsx:159-183,285,382-393` | preserved | traffic.js annoMarks + `<title>` hover (`traffic.js:381-390,411,435`) | |
| A5 | Category color system shared chart↔list (site_change=blue, algorithm=amber, campaign=brand, other=neutral) | `AnalyticsAnnotations.tsx:22-27`; `ANNOTATION_COLORS` in chart | preserved | `traffic.js:256-261` (ACAT map; campaign=purple) | ⚠ prototype uses **purple** for campaign — HEAD uses brand/teal; purple is admin-AI-only per Four Laws. Flag to design. |
| A6 | Server broadcasts `ANNOTATION_BRIDGE_CREATED` on create/update/delete (admin+client caches stay live) | `server/routes/google.ts:491-494,514-517,527-530` | preserved (backend) | n/a | Rebuild must keep the `useWorkspaceEvents` receiving half. |
| A7 | Annotations exposed to client portal (`/api/public/analytics-annotations`) and to intelligence slices (pageUrl field, migration 065) | `server/routes/google.ts:539`, FEATURE_AUDIT.md:5364 | preserved (backend) | n/a | Out-of-surface consumers; do not break write path. `pageUrl` is accepted by the API but not exposed in the admin form — parity is form-less today. |
| A8 | Annotation date-range/category query filtering server-side | `server/routes/google.ts:477-485`, `src/api/misc.ts:96-104` | preserved (backend) | n/a | UI uses client-side filter today; API capability must survive. |

## 6. Insight feed (shared across Overview/Search/Traffic tabs)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| I1 | Priority insight feed: 20+ typed insight renderers (ranking_mover, ctr_opportunity, content_decay, cannibalization, anomaly_digest, serp_feature_opportunity, local_visibility_shift, …) with headline+context transforms | `src/hooks/admin/useInsightFeed.ts:38-447` | at_risk | Parity Ledger claims "Insights narrative — present" but traffic.js renders no feed | The Insights Engine surface (issue/cockpit views) may re-home this — no evidence in traffic.js. Needs explicit home. |
| I2 | Severity summary pills (drops/opportunities/wins/schema gaps/decaying pages) that filter the feed | `useInsightFeed.ts:455-481`, `src/components/insights/SummaryPills.tsx:20-53`, `InsightFeed.tsx:32-45` | at_risk | — | |
| I3 | Domain filter chips (search/traffic) on detail tabs | `InsightFeed.tsx:13,32` + `SearchDetail.tsx:237`, `TrafficDetail.tsx:198` | at_risk | — | |
| I4 | Expandable insight details (cannibalization page lists, cluster queries, lost-visibility queries) | `useInsightFeed.ts:403-429`, `InsightFeedItem.tsx:97-111` | at_risk | — | |
| I5 | **Run Deep Diagnostic** CTA on anomaly_digest insights → diagnostics report deep-link (`?report=` param), running/failed/completed states | `src/components/insights/InsightFeedItem.tsx:17-68,112-116` | at_risk | Parity Ledger: **Diagnostics = the one Gap row** ("no home… decide whether it belongs in Settings/Admin, or is intentionally cut") | Double at-risk: the CTA and its destination are both homeless. |
| I6 | Impact-score sort + 5-min stale-time cache + WS invalidation (INSIGHT_RESOLVED, INSIGHT_BRIDGE_UPDATED → insightFeed key) | `useInsightFeed.ts:492-505`, `src/lib/wsInvalidation.ts:261-267,346-351` | preserved (backend) | n/a | Rebuild must re-wire the invalidation registry. |

## 7. Data layer / permissions (must survive unchanged)

| # | Capability | Evidence (HEAD) | Status | Notes |
|---|------------|-----------------|--------|-------|
| D1 | Admin GSC endpoints: search-overview/performance-trend/search-devices/search-countries/search-types/search-comparison, guarded by `requireWorkspaceSiteAccessFromQuery` + `requireWorkspaceGscPropertyAccess` | `server/routes/google.ts:245-330` | preserved (backend) | Overview returns topQueries+topPages (`shared/types/analytics.ts:27-36`; avgCtr already a percentage — do NOT re-multiply). |
| D2 | Admin GA4 endpoints ×11 (overview/trend/top-pages/sources/devices/countries/comparison/new-vs-returning/organic/landing-pages/conversions), `requireWorkspaceAccess` | `server/routes/google.ts:332-473`, client `src/api/analytics.ts:85-127` | preserved (backend) | landing-pages supports `organic=true` + `limit` params — unused by HEAD UI, available for rebuild. |
| D3 | React Query hooks + query keys (`useAdminSearch`, `useAdminGA4`, `useAnalyticsOverview`, `useAnalyticsAnnotations`, `useInsightFeed`) | `src/hooks/admin/useAdminSearch.ts:20-63`, `useAdminGA4.ts:25-51`, `useAnalyticsOverview.ts:43-128`, `useAnalyticsAnnotations.ts:19-61`, `useInsightFeed.ts:492-513` | preserved (backend) | All frontend data via React Query (mandatory). |
| D4 | Dormant admin GSC AI chat endpoint (`gscAdmin.chat` → POST `/api/google/search-chat/:siteId`) | `src/api/analytics.ts:148-149`, `server/routes/google.ts:192` | at_risk (dormant) | No HEAD component calls it (client portal uses `/api/public/search-chat`). Decide: retire or re-home; do not silently drop the server op. |
| D5 | Anomaly system: `AnomalyAlerts` component + `get_anomalies` | `src/components/AnomalyAlerts.tsx`, mounted at `src/components/WorkspaceHome.tsx:614` (NOT in AnalyticsHub) | out of scope (owned by Home/Command Center surface) | Parity Ledger lists AnomalyAlerts as a Search & Traffic tool — at HEAD it lives on WorkspaceHome. Coordinate with the Home surface auditor so it isn't double-counted or dropped. |
| D6 | `ChartPointDetail` component | `src/components/ChartPointDetail.tsx` (defined; no import sites found in src) | note | Parity Ledger claims "ChartPointDetail — present (point drill-in)"; at HEAD it is orphaned/unmounted. Not a parity loss; ledger overclaims. |

## 8. Prototype coverage summary (traffic.js)

**Demonstrates (same or better):** 3 sub-tabs; narrative data-driven headlines; KPI tiles with deltas + sparklines; GSC trend with prior-period dashed overlay + annotation markers with hover tooltips; queries⇄pages toggle; GA4 users/sessions dual-line chart; sources/devices/new-vs-returning cards; landing⇄events toggle + top-conversion-events card; annotations timeline with category legend.

**Omits (drives the at_risk rows above):** unified Overview tab (merged GSC+GA4 chart + toggle cards); metric-line toggling; CTR (KPI and row-level); sortable tables; insight feed + pills + domain chips + expandable details + diagnostic CTA; insight badges on rows; chart callout bubbles; click-to-annotate popover; annotation CRUD (edit/delete/filter); GSC devices/countries/search-types; GA4 top pages (non-landing), countries, organic-vs-all, growth signals, engagement analysis; 7d + 16mo/1y presets; all loading/empty/error/locked states.

**New functionality proposed (needs owner sign-off):**

| # | New capability | Prototype evidence | Notes |
|---|----------------|--------------------|-------|
| N1 | **Book roll-up scope** ("Across your book"): cross-client traffic/clicks/position table, aggregate KPIs, click-through to client | `traffic.js:715-766` | No HEAD equivalent on this surface (nearest: Team Outcomes). Needs a cross-workspace GSC aggregate endpoint — a data ticket, not just UI. |
| N2 | **Rank movers panels** (Biggest gains / Needs attention, `#from→#to`) | `traffic.js:472-481,509-519` | Rank tracking lives in Keyword Hub at HEAD. Duplicating here needs a shared read path (Keyword Hub owns rank data — see `docs/rules/keyword-hub.md`). |
| N3 | **"Stage wins as proof" graduation bridge** → Insights Engine | `traffic.js:493-497` | New cross-surface write (wins → proof points). Needs contract + owner sign-off. |
| N4 | Prior-period comparison line on trend chart | `traffic.js:408` | Additive improvement; comparison data already exists (`search-comparison` endpoint). |
| N5 | Per-KPI sparklines | `traffic.js:369-378` | Additive; trend data already fetched. |
| N6 | Strategy-keyword "fav" dot on query/mover rows | `traffic.js:461-462,477` | HEAD has `strategyKeyword` on insights (`useInsightFeed.ts:385-387`) but not on GSC rows; needs a join. |
| N7 | "View all queries/pages →" full explorer | `traffic.js:531-532` (toast stub) | HEAD shows the full topQueries list scrollably; an explorer is an upgrade path, stub today. |

## 9. Parity Ledger reconciliation

- **Search & Traffic row:** status `improved`; tools AnalyticsOverview / AnalyticsAnnotations / AnomalyAlerts / ChartPointDetail / Insights-narrative all marked `present`. **Contested by this audit:** (a) no insight feed is actually rendered in traffic.js (I1–I5); (b) AnomalyAlerts is a WorkspaceHome capability at HEAD, not analytics-hub (D5); (c) ChartPointDetail is unmounted at HEAD (D6); (d) the Overview tab's unified chart + toggle cards have no prototype home (O1–O3). The row's `improved` verdict holds only for narrative framing, sparklines, prior-period overlay, and the events surfacing.
- **Gap rows for this surface:** none directly. The single ledger Gap — **Diagnostics ("no home… decide")** — intersects this surface via the anomaly-insight "Run Deep Diagnostic" CTA (I5). Unresolved.
- **Partial rows:** none exist in the ledger for any surface.

## 10. Quick-win vs full implementation trade-offs

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Trend charts | Static SVG line chart w/ annotation markers (prototype-style) | Recharts-equivalent w/ line toggles, click-to-annotate popover, callouts, dual axes | Loses A3/Q3/O1 interactions users have today — parity failure if shipped as "done". Ship read-only chart first ONLY if annotate/toggles land same phase. |
| Tables | Static top-N rows | Sortable, sticky-header, full-list, insight-badged, external-link rows | Silent loss of Q5/Q6/Q8; operators sort by impressions daily. |
| Insight feed | Reuse existing `InsightFeed` component unstyled inside new shell | Redesign feed to new design system w/ pills, chips, details, diagnostic CTA | Low — reusing the live component preserves parity; restyle later. Recommended bridge. |
| Annotations | List + create form (no chart-click, no edit) | Full CRUD + chart-click popover + category filters | Medium — create+list covers 80% of use; edit/delete loss breaks cleanup workflows (A1). |
| Book roll-up (N1) | Defer entirely (per-client scope only) | Cross-workspace aggregate endpoint + roll-up table | None — it's new; deferring loses nothing at HEAD. |
| Rank movers (N2) | Link out to Keyword Hub | Embedded movers fed by Keyword Hub read path | None at parity level; embedding without the shared read path risks a second rank-data source (forbidden). |
| Date ranges | Prototype's 28d/90d/12m | Full `DATE_PRESETS_SEARCH`/`FULL` sets incl. 7d + 16mo | Quick win is a regression (O7/G3) — presets are cheap; ship full set day one. |
| Organic-vs-all + growth/engagement cards (G5–G7) | Fold key numbers into narrative header | Dedicated cards | Narrative alone drops the organic bounce/engagement comparisons — the agency's core proof metric. Keep at least organic share + organic-vs-all bounce. |

## 11. Open questions (stop-and-ask — owner decisions required)

1. **Overview tab:** The prototype drops the unified GSC+GA4 Overview (merged chart, cross-source toggle cards, priority feed). Is Overview intentionally cut in favor of the narrative headers, or must the rebuild add a fourth "Overview" sub-view? (O1–O4)
2. **Insight feed home:** Where does the in-surface insight feed (pills, domain chips, expandable details, row badges) live in the new IA — inside Search & Traffic, or exclusively in the Insights Engine (issue/cockpit)? Parity ledger says "present" but traffic.js shows none. (I1–I4, Q6, Q12, G4)
3. **Diagnostics:** The only ledger Gap. The "Run Deep Diagnostic" CTA on anomaly insights deep-links to the diagnostics page. Keep (where?), or cut deliberately? (I5)
4. **Book roll-up (N1), rank movers (N2), graduation bridge (N3):** all new — sign off scope + data contracts before build. N2 must consume Keyword Hub's read path, N3 needs a wins→proof-points write contract.
5. **Dormant admin GSC chat endpoint (D4):** retire `/api/google/search-chat/:siteId` + `gscAdmin.chat`, or give it a home?
6. **AnomalyAlerts ownership (D5):** ledger assigns it to Search & Traffic; HEAD mounts it on WorkspaceHome. Which surface owns it in the new IA? (Coordinate with Home auditor.)
7. **Date presets (O7/G3):** confirm full preset sets (incl. 16mo GSC lookback) ship despite the prototype showing only three.
8. **Campaign annotation color (A5):** prototype uses purple for campaign markers; purple is admin-AI-only under the Four Laws. Confirm the rebuild's annotation palette.
9. **GSC breakdowns (Q9–Q11) and GA4 top pages/countries (G8/G11):** omitted from prototype — confirm homes (e.g. a "Detail" drawer/explorer) rather than silent cuts.
