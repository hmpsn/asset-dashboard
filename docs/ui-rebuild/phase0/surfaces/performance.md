# Phase 0 Additive-Parity Ledger — Performance (zone: Search & Site Health)

**Surface:** Performance (`Page 'performance'`) + Content Perf (`Page 'content-perf'`)
**Audited at HEAD:** branch `ui-rebuild-phase-0` (== post-Reconcile `origin/staging`), 2026-07-02
**Prototype views read:** `hmpsn studio Design System/mockup/performance.js` (Performance) and `hmpsn studio Design System/mockup/pipeline.js` Published tab + drawer (`resultsHtml()` L765, `publishedSectionHtml()` L955) — the Parity Ledger routes Content Perf to `pipeline.js → Published + Content Health`, not to `performance.js`.

## Routes and entry points at HEAD

| Item | Evidence |
|---|---|
| `Page` union values `'performance'`, `'content-perf'` | `src/routes.ts:10-11` |
| Nav registry: Performance (group `site-health`, `needsSite: true`) | `src/lib/navRegistry.tsx:127-128` |
| Nav registry: Content Perf (group `content`, `needsSite: true`) | `src/lib/navRegistry.tsx:161-162` |
| Mounts: `<Performance>` / `<ContentPerformance>` | `src/App.tsx:417-418` (site required: `src/App.tsx:360-361`) |
| API client: `pageWeight.*`, `contentPerformance.*` | `src/api/seo.ts:428-449`, `src/api/seo.ts:361-373` |
| Server: page weight scan + snapshot | `server/routes/webflow-audit.ts:148`, `:208` |
| Server: pagespeed bulk / snapshot / single | `server/routes/webflow-pagespeed.ts:26`, `:50`, `:56` |
| Server: content performance admin GET + trend | `server/routes/content-requests.ts:294`, `:305` |
| Server: content performance public GET + trend (client) | `server/routes/public-content.ts:565`, `:575` |
| Domain handler (admin/public audiences, scrubbed for public) | `server/domains/content/content-performance.ts:177-299` |
| MCP tool `get_content_performance` (same handler) | `server/mcp/tools/content.ts:59`, `:135-143` |
| Inbound deep link: Site Audit "Review speed and CWV in Performance" tip | `src/components/SeoAudit.tsx:552` |

## Capability table

Status legend: **preserved** = obvious same-or-better home in prototype · **improved** = prototype upgrades it · **new_proposed** = prototype-only, needs sign-off · **at_risk** = exists at HEAD, no visible home in the prototype (uncertain = at_risk).

### A. Performance → Page Weight tab (`PageWeight.tsx`)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| A1 | On-demand page-weight scan (assets × usage per published page) | `src/components/PageWeight.tsx:63-71`; `server/routes/webflow-audit.ts:148-206` | preserved | Performance → Page Weight; mockup `Re-scan` (`performance.js:138`) | Mockup toast at `performance.js:215` |
| A2 | Snapshot persistence + auto-restore on mount (survives navigation/deploys) | `src/components/PageWeight.tsx:74-84`; `server/routes/webflow-audit.ts:199` (`savePageWeight`), `:208-211` | improved | Same | Mockup adds "Last scan 1d ago" freshness meta (`performance.js:198`) HEAD lacks |
| A3 | Summary cards: pages-with-assets, total asset size, heavy pages (>2MB), avg page weight | `src/components/PageWeight.tsx:149-168` | preserved | Same 4 cards, `performance.js:127-132` | Identical thresholds |
| A4 | Search across page names AND asset filenames | `src/components/PageWeight.tsx:138-142` | preserved | `performance.js:110,134` | Mockup preserves focus/caret on re-render (`performance.js:213`) |
| A5 | Source filter: All / Pages / CMS / **CSS** | `src/components/PageWeight.tsx:60,131-137,187-192` | at_risk | Mockup select has only all/page/cms (`performance.js:136`) | **CSS-only option dropped.** Server emits `css:`-prefixed rows (usage scan), so filter loses a real source class |
| A6 | Ranked page list with proportional weight bar, 4-tier color thresholds (5MB/2MB/1MB) | `src/components/PageWeight.tsx:35-52,204-232` | preserved | `performance.js:105,118-125` | Same thresholds in mockup `barCol` |
| A7 | Expandable per-page asset breakdown (name, content type, size; >500KB highlighted) | `src/components/PageWeight.tsx:234-246` | improved | `performance.js:117` | Mockup adds per-asset **Compress → Asset Manager** action (see A9) |
| A8 | Heavy-page cross-link tip to Asset Manager | `src/components/PageWeight.tsx:251-257` | improved | `performance.js:141` | At HEAD the banner is **static text** (no onClick); mockup makes it a real deep-link `AssetsView.open('over')` |
| A9 | (new) Per-asset "Compress" button → Asset Manager | — | new_proposed | `performance.js:117,216` | Needs sign-off + a deep-link contract (asset id → Asset Manager compress flow) |
| A10 | States: pre-run empty (CTA), loading (30–60s message), error w/ retry | `src/components/PageWeight.tsx:86-127` | preserved | State-kit convention (Build Conventions: every surface owes 4 states) | Static prototype doesn't demo them; rebuild owes all four |

### B. Performance → Page Speed tab (`PageSpeedPanel.tsx`)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| B1 | Single-page PSI test with searchable page selector (password pages filtered) | `src/components/PageSpeedPanel.tsx:140-151,196-216,351-379`; `server/routes/webflow-pagespeed.ts:56-88` | preserved | Mockup "Tested page" select, `performance.js:187` | Server resolves URL from workspace page metadata |
| B2 | **Bulk test (top-N pages, default 3, max 25) with averaged score + averaged vitals + per-page expandable results** | `src/components/PageSpeedPanel.tsx:172-194,455-610`; `server/routes/webflow-pagespeed.ts:26-47` (`MAX_PAGESPEED_PAGES=25`) | at_risk | No visible home — mockup shows exactly one tested page at a time | Bulk mode, avg-score panel, and the per-page expandable result list have no mockup equivalent |
| B3 | Mobile / desktop strategy toggle (re-runs per strategy) | `src/components/PageSpeedPanel.tsx:129,459-481` | improved | Mockup renders Mobile + Desktop **side-by-side simultaneously** (`performance.js:189`) | Strictly better presentation |
| B4 | Performance score ring (0–100, 90/50 color thresholds) | `src/components/PageSpeedPanel.tsx:64-68,258,491` | preserved | `performance.js:163-166` | Same thresholds |
| B5 | Core Web Vitals cards: **LCP, FCP, CLS, INP, TBT, Speed Index** (+FID/TTI rated in code) with Google thresholds | `src/components/PageSpeedPanel.tsx:83-96,263-270,494-501` | at_risk | Mockup CWV strip shows only LCP/INP/CLS (`performance.js:167-170`) | FCP, TBT, SI displays dropped (thresholds match for the 3 kept) |
| B6 | Field-data (CrUX "Real users") vs "Lab test" provenance badge | `src/components/PageSpeedPanel.tsx:260-261` (`fieldDataAvailable`) | at_risk | Not in mockup | Trust-signal loss: field vs lab is the actual ranking-signal distinction |
| B7 | Opportunities list with estimated savings | `src/components/PageSpeedPanel.tsx:273-295,541-572` | improved | `performance.js:188-190` | Mockup adds per-opportunity **Fix** button + "-Xs LCP" savings framing |
| B8 | Diagnostics list (title, description, displayValue) | `src/components/PageSpeedPanel.tsx:297-317,575-604` | at_risk | Not in mockup | Whole section absent from prototype |
| B9 | Snapshot persistence per strategy + restore on mount; "N pages tested · time" stamp; single-result persistence | `src/components/PageSpeedPanel.tsx:153-170,482-484`; `server/routes/webflow-pagespeed.ts:40,50-54,82` | preserved | "Last scan 1d ago" meta (`performance.js:198`) | Single-page results persist server-side (`saveSinglePageSpeed`) but are not UI-restored at HEAD either |
| B10 | Rate-limit-aware error (`GOOGLE_PSI_KEY` guidance), loading (30–60s), retry | `src/components/PageSpeedPanel.tsx:185,408-451` | preserved | State-kit convention | Prototype doesn't demo error/loading |
| B11 | `?tab=speed\|weight` deep-link receiver on Performance page | `src/components/Performance.tsx:11-15` | preserved | New shell must keep the two-halves contract | Known sender: `SeoAudit.tsx:552` (no tab param, lands on default) |
| B12 | Server side-effects: intelligence cache invalidation on test; CWV summary feeds site-health slice, per-page score feeds page-profile slice, admin chat context | `server/routes/webflow-pagespeed.ts:41,84`; `server/intelligence/site-health-slice.ts:207-224`; `server/intelligence/page-profile-slice.ts:309-310` | preserved | Backend contract — rebuild must keep writing the same `performance-store` shapes | AI context goes blind if the store write path changes |
| B13 | (new) Lighthouse category scores: Accessibility / Best Practices / SEO bars | — | new_proposed | `performance.js:172` | HEAD `runSiteSpeed`/`runSinglePageSpeed` return performance-only; needs API + PSI category fetch sign-off |
| B14 | (dead code, not a capability) `pageWeight.get/analyze` → `/api/pagespeed/:wsId` has **no server route** | `src/api/seo.ts:429-433`; no match in `server/routes/` | — | Delete during rebuild | Confirmed unrouted; no component consumes it |

### C. Content Perf (`ContentPerformance.tsx` → prototype home: `pipeline.js` Published tab)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| C1 | Per-published-piece GSC read-back: clicks, impressions, position | `src/components/ContentPerformance.tsx:283-303` | improved | Published-tab result cards `pipeline.js:779-796` | Mockup adds position **from→to** framing and per-card verdict edge |
| C2 | Per-piece **CTR** read-back | `src/components/ContentPerformance.tsx:343-345` | at_risk | Not in mockup tiles (clicks/position/impressions/engagement only) | Small but real metric loss |
| C3 | GA4 per-piece detail: sessions, users, bounce rate, avg engagement time | `src/components/ContentPerformance.tsx:363-385` | at_risk | Mockup shows only engagement time + lift% tile (`pipeline.js:778-779,440`) | Sessions/users/bounce have no visible home |
| C4 | Aggregate stats: total clicks, impressions, sessions, avg position | `src/components/ContentPerformance.tsx:156-217` | improved | `pipeline.js:768-773,799-805` (pieces live, clicks recovered/mo, avg position gain, wins) | Reframed outcome-first; **sessions/impressions totals dropped** — see stop-and-ask #6 |
| C5 | Sort controls: clicks / impressions / sessions / age | `src/components/ContentPerformance.tsx:121,145-153,220-237` | at_risk | Not in mockup | No sort affordance on Published tab |
| C6 | Per-piece lazy-loaded daily trend (clicks + impressions dual-axis, tooltip, date range) since publish | `src/components/ContentPerformance.tsx:132-143,42-79`; `server/routes/content-requests.ts:305-331` (`getPageTrend`, publish-date start, 3-day GSC delay) | improved | Clicks-since-publish sparkline standard on every card (`pipeline.js:777-778`) | Impressions line + hover tooltip not shown; sparkline is inline (better default) |
| C7 | **Term-coverage grading + brief-execution joinback** (coverage % badge, matched/required, missing-term chips, brief/post lineage, source-evidence badge) | `src/components/ContentPerformance.tsx:86-102,267,388-419`; `server/domains/content/content-performance.ts:114-176`; FEATURE_AUDIT.md:517-527 (#503) | at_risk | **No visible home** in Published tab or drawer (`pipeline.js:955-966` shows outcome + live URL only) | Biggest single loss risk on this surface — shipped 2026 diagnostic |
| C8 | Matrix-published cells included (dedup by keyword) with "Content Plan" source badge | `src/components/ContentPerformance.tsx:268-272`; FEATURE_AUDIT.md:3727-3729 (#162); `server/domains/content/content-performance.ts` (`listMatrices` import, L2) | at_risk | Mockup pieces carry source chips (`decay/ai/strategy`, `pipeline.js:440-454`) but no matrix-sourced published example | Probably preserved via source-chip model — uncertain, so at_risk; verify matrix items reach the Published list |
| C9 | Page-type badge, target keyword, target slug per piece | `src/components/ContentPerformance.tsx:243,260-279` | preserved | `pipeline.js:789` (`kw · pageType · published … · days live`) | |
| C10 | Status badge; tracks **delivered** AND published requests | `src/components/ContentPerformance.tsx:266`; empty-state copy `:183-188`; `server/routes/public-content.ts:580-582` (`PUBLIC_CONTENT_PERFORMANCE_STATUSES`) | at_risk | Published tab filters `stage==='published'` only (`pipeline.js:766`) | Delivered-not-yet-published items have no visible home |
| C11 | Days-since-publish display | `src/components/ContentPerformance.tsx:305-310` | preserved | "N days live" (`pipeline.js:789`) | |
| C12 | Empty state (action-oriented) / error banner / loading | `src/components/ContentPerformance.tsx:163-188` | preserved | `pipeline.js:767` empty state | Error/loading owed by state kit |
| C13 | Public (client) scrubbed read path — client ContentTab consumes same handler; never serializes raw source evidence | `server/domains/content/content-performance.ts:290-299`; `server/routes/public-content.ts:565-590`; `src/components/client/ContentTab.tsx:144` | preserved | Server contract — untouched by admin rebuild, but handler is shared: don't fork shapes | Cross-surface dependency (client dashboard audit owns the UI) |
| C14 | MCP `get_content_performance` tool | `server/mcp/tools/content.ts:59,135-143` | preserved | Backend contract | Same handler |
| C15 | (new) Verdict per piece: **win / early / flat** with color-coded cards | — | new_proposed | `pipeline.js:324-327,775-796` | Parity Ledger lists verdict as a Content Perf "func" but it does **not exist at HEAD** in this surface; nearest existing vocabulary is `shared/types/outcome-tracking.ts:47-48` (`strong_win`/`win`) + `EarlySignal` (`:126`). Needs a data-source decision |
| C16 | (new) "Add to Insights Engine" graduation action on wins | — | new_proposed | `pipeline.js:788,962-966` | Write-path (insight creation from a content win) doesn't exist; needs sign-off + contract |
| C17 | (new) "View live" button per piece | — | new_proposed | `pipeline.js:785` | Trivial once live URL resolution is defined |
| C18 | (new) Engagement lift % ("+22% engagement") and impressions-lift % vs before/launch | — | new_proposed | `pipeline.js:440-441` | Requires a baseline comparison read HEAD doesn't compute |

## Prototype coverage notes

- `performance.js` explicitly states it "Mirrors Performance.tsx" (L2-5) and reproduces the two-tab structure faithfully; its stated purpose is the **detect side of the media-optimization loop** with hand-offs to Asset Manager.
- What it demonstrates: summary cards, search/filter/rescan toolbar, ranked bars, expandable assets, heavy-page tip (now clickable), score rings, CWV strip (3 metrics), opportunities with Fix buttons, side-by-side mobile/desktop.
- What it omits (all flagged at_risk above): CSS source filter (A5), bulk multi-page testing with averages and per-page results (B2), FCP/TBT/SI vitals (B5), field-vs-lab badge (B6), diagnostics (B8).
- What it invents: per-asset Compress action (A9), Lighthouse category scores (B13), per-opportunity Fix routing (folded into B7), a `derivedSpeed()` page-weight-based score penalty (`performance.js:179-183`) — the last is prototype artifice for demo realism, not a feature to build.
- Content Perf's prototype home is **not** `performance.js` — the Parity Ledger routes it to `pipeline.js → Published + Content Health` with status "improved / gap closed". The Published tab covers the metric read-back convincingly but is silent on the term-coverage/brief-execution diagnostic (#503, C7), CTR (C2), GA4 breadth (C3), sorting (C5), and delivered-status items (C10).

## Parity Ledger reconciliation

- **Performance row** (ledger `Performance / PageSpeedPanel / PageWeight`, status `improved`): no Gap/Partial recorded. Audit verdict: mostly justified, but the ledger's func list ("PageSpeed / Lighthouse scores, CWV, per-page load time + page weight, heavy-page hand-off") under-specifies HEAD — bulk testing (B2), full vitals set (B5), field/lab provenance (B6), and diagnostics (B8) are real HEAD functions with no mockup home. **These four are unresolved sub-gaps the ledger does not track.**
- **Content Perf row** (ledger status `improved`, gap noted "Closed"): the gap-closed claim holds for metric read-back + trajectory + engagement, but (a) it lists "Verdict (win/flat/early)" as an existing func — it is prototype-new, not HEAD (C15); (b) it does not account for term-coverage grading/joinback (C7), which shipped as FEATURE_AUDIT #503 and is absent from the mockup. **C7 is an untracked gap; the ledger's "Closed" is optimistic.**
- Site Audit ledger row's nested sub-tool `CWV summary → at: 'Performance'` (audit surface's remit): satisfiable only if Performance retains a CWV display — fine under current mockup.
- No Gap/Partial rows for this surface appear in the ledger's `gapItems` collection (both rows are status `improved`).

## Trade-offs: quick win vs full implementation

| Item | Quick win | Full version | Risk of quick win |
|---|---|---|---|
| Page Speed tab | Port mockup layout (side-by-side mobile/desktop, single tested page) reading the existing bulk snapshot's per-page entries | Restore bulk top-N testing UI + per-page expandable results + diagnostics + field/lab badge on the new shell | Quick win silently drops B2/B6/B8 — exactly the additive-parity violation Phase 0 exists to prevent; snapshot-only reads also hide the 25-page server capability |
| Verdict (win/early/flat) | Client-side heuristic from existing trend + position deltas, rendered as badges | Server-side verdict wired to `outcome-tracking` types (`OutcomeScore`/`EarlySignal`) with a persisted, auditable scoring rule | Heuristic verdicts shown to an operator can contradict the outcome-tracking engine's authoritative scores; a "win" label is client-adjacent language — meaning must not drift |
| Add to Insights Engine | Button that opens a pre-filled manual insight/outcome form | Automatic graduation: content win → insight write with broadcast + activity log + client-story surfacing | Manual path is safe; automatic path touches insight-store contracts (bridge rules, broadcast, state machine) and needs its own plan |
| Term-coverage diagnostic (C7) | Keep coverage % badge + missing-term chips on the Published card, joinback lines in the drawer | Dedicated brief-execution panel in the piece drawer with evidence links | Quick win preserves parity cheaply; omitting it entirely is a hard stop |
| Per-asset Compress (A9) | Deep-link to Asset Manager filtered to the asset | In-place compress action calling the existing compression pipeline | Deep-link is fine; verify Asset Manager supports asset-id deep-link param first |
| Lighthouse category scores (B13) | Skip (not at HEAD; additive-only doesn't require it) | Extend `runSiteSpeed`/`runSinglePageSpeed` to persist a11y/BP/SEO categories + store migration | None — it's net-new; ship later without parity risk |

## Open questions (stop-and-ask — owner sign-off required)

1. **C7 term-coverage/brief-execution diagnostic has no home in the prototype.** Where does it live — Published card footer, piece drawer, or a Content Health sub-view? Dropping it would lose shipped feature #503.
2. **B2 bulk PageSpeed testing (top-N, averaged score/vitals, per-page results) is absent from the mockup.** Retain as a mode on the new Performance surface, or intentionally consolidate to single-page testing? (Server supports up to 25 pages.)
3. **B6/B8 field-vs-lab badge and diagnostics section** — intentional simplification or omission? Field-vs-lab is the trust distinction between CrUX ranking data and lab runs.
4. **C10 delivered-but-not-published items** are tracked at HEAD (and in the client public route's status set) but the Published tab filters to published only. Where do delivered items' metrics surface?
5. **C15/C16 verdict + graduation are new functionality** (the Parity Ledger mislabels verdict as existing). Confirm the data source: heuristic vs `outcome-tracking` domain, and what "Add to Insights Engine" writes.
6. **C4 aggregate reframing** drops total sessions/impressions in favor of "clicks recovered/mo · avg position gain · wins". Accept the outcome-first framing, or keep the GSC/GA4 totals somewhere?
7. **A5 CSS source filter and C5 sort controls** dropped by the mockup — intentional?
8. **B14 cleanup**: `pageWeight.get/analyze` client methods point at `/api/pagespeed/:wsId` which has no server route — confirm deletion during rebuild (dead code, no capability attached).
