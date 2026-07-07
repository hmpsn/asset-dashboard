# Wave 3 BUILD TICKET — Links (Page `links`)

> **Surface:** admin `Page 'links'` (`src/routes.ts:5`) in Site Health nav (`src/lib/navRegistry.tsx:128-129`, `needsSite: true`).
> **HEAD component + mount:** `LinksPanel` (`src/components/LinksPanel.tsx:18-33`, `?tab=redirects|internal|dead-links` receiver) mounted from `src/App.tsx:422`.
> **Wave:** W3 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **L** (`docs/ui-rebuild/phase-a/surfaces/links.json:419`).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` (especially §1 freshness, §5 score authority, §6 honest absence, §7 structural template, §8 tests) -> `surfaces/links.json` -> `phase0/surfaces/links.md` -> this ticket -> Keywords pilot (`src/components/keywords-rebuilt/`).
> **Mount contract:** rebuilt surface mounts behind `ui-rebuild-shell` through one `REBUILT_SURFACES['links']` entry (`src/components/layout/rebuiltSurfaces.ts:5-20`). Flag-OFF remains byte-identical legacy `LinksPanel` in `App.tsx:422`.

---

## 1. ⚠ OWNER DELTAS

**none - all defaults adopted.** Every Links discovery question resolves to its proposed default, AD-027, AD-017, AD-004, or Frozen Contract #3. No item goes back to the owner.

| Discovery OQ / N | Resolution (default adopted) | Backing |
|---|---|---|
| Q1 - Redirect chains + all-pages status table + filters | Restore chains and all-pages inventory inside Redirects as collapsed `GroupBlock`s plus a self-carded `DataTable` and `FilterChip`/`SearchField` controls. Cutting this would break the Site Audit "Review redirect chains" promise. | `links.json:306-310`; AD-027 (`owner-decisions.json:348-356`); Site Audit sender `SeoAudit.tsx:550`; HEAD chains/table/filter UI `RedirectManager.tsx:287-343,435-527`. |
| Q2 - Dead Links domain selector, 3xx sub-list, CSV export | Carry all three. Domain selection prevents staging-domain false positives; 3xx content links and CSV export are HEAD capabilities, not polish. | `links.json:312-316`; AD-027 (`owner-decisions.json:348-356`); HEAD domain selector/export/sub-toggle `LinkChecker.tsx:48-57,82-99,185-237`. |
| Q3 - prototype "AI %" confidence chip | Do not ship fabricated AI confidence. SB-025 rides W3 to expose the real keyword-overlap score as `match %`; until present, render honest absence. | `links.json:318-322`; AD-027 (`owner-decisions.json:348-356`); scorer exists without serialization `redirect-scanner.ts:146-192,357-381`; SB-025 (`server-backlog.json:351-361`). |
| Q4 - send-to-client shape | Keep HEAD batch `internal_link` action + note, and restore `redirect_proposal` send. Per-suggestion sends are a payload-contract change and defer. | `links.json:324-328`; AD-027 (`owner-decisions.json:350-351`); producers `InternalLinks.tsx:101-123`, `RedirectManager.tsx:174-195`; consumers `decision-renderers.tsx:356-414`; payload types `client-actions.ts:8-13,81-94`. |
| Q5 - Architecture tab relocation | Add Architecture as the 4th Links tab and carry HEAD filter/search/schema-coverage/refresh. Page Intelligence removal/D8 is the D3/Page Intelligence owner half, not a silent Links-side delete. | `links.json:330-334,370-373`; AD-027 (`owner-decisions.json:350-351`); current Page Intelligence mount `PageIntelligence.tsx:25,237-240`; Architecture API `site-architecture.ts:19-34`; UI filter/search/refresh `SiteArchitecture.tsx:212-246,305-323,402-429`. |
| Q6 / N1 - Insert internal link directly into page | Defer. It is a new Webflow write path, not parity. Ship copy-HTML/manual implementation path now. | `links.json:336-339,350-352`; AD-017 (`owner-decisions.json:232-245`); copy-HTML is HEAD parity `InternalLinks.tsx:342-350,381-389`. DEF-links-001. |
| Q6 / N6 - Links -> Insights Engine graduation bridge | Defer to the C3 owner-signed graduation seam. No ad-hoc Links-only insight write ships. | `links.json:336-339,375-378`; AD-004 (`PHASE_A_DECISIONS.md:13,28-30`). DEF-links-006. |
| Q7 - `dead` vs `dead-links` ids | Keep HEAD ids and keep `dead-links` as the canonical receiver. Add `dead -> dead-links` as a legacy alias in the rebuilt URL-state hook. | `links.json:342-346`; Frozen Contract #3 (`CROSS_SURFACE_CONTRACTS.md:65`); helper supports aliases `tab-search-param.ts:1-4,26-28`; current receiver `LinksPanel.tsx:18-31,72-75`. |
| N2 - per-404 hits + match % | Adopt via SB-025. Hits are real GSC clicks/impressions already fetched; match is the real heuristic score, never "AI." | `links.json:355-358`; GSC data fetched `webflow-analysis.ts:203-215`; dropped from PageStatus today `redirect-scanner.ts:195-200,252-265`; SB-025 (`server-backlog.json:351-361`). |
| N3 - scheduled/automatic crawls | Defer. Keep manual Re-scan + freshness meta per AD-001; background jobs/cron are follow-up. | `links.json:360-363`; AD-001 (`PHASE_A_DECISIONS.md:10`); scans run inline today `webflow-analysis.ts:178-183,198-224,246-251`; SB-045 (`server-backlog.json:607-617`). DEF-links-004. |
| N4 - Dead-link Redirect/Reviewed row actions | Adopt session-state quick win only. Persisted reviewed/suppressed state and direct Webflow redirect writes defer. | `links.json:365-368`; no Links suppression store per verifier `links.json:437-440`; SB-027 (`server-backlog.json:377-387`); SB-026 redirect-create gap (`server-backlog.json:364-374`). DEF-links-003 + DEF-links-005. |
| N5 - Architecture as 4th tab | Adopt the relocation. Carry HEAD architecture capabilities; prototype-only "Add page" gap CTA defers unless a receiver is signed. | `links.json:370-373`; phase0 notes Add-page as new `phase0/surfaces/links.md:95`; `SiteArchitecture.tsx:325-350,353-391,394-429`. DEF-links-007 for Add-page CTA. |

---

## 2. Capability checklist

Every `capabilityClassification` row in `surfaces/links.json:4-255` and every HEAD row in `phase0/surfaces/links.md:16-96` is an acceptance criterion. DataTables are self-carded (`BUILD_CONVENTIONS.md:159-163`) and must not be `SectionCard`-wrapped.

### 2.1 Page shell / routing / URL state
- [ ] **#1** 4-tab shell: Redirects, Internal Links, Dead Links, Architecture. HEAD has 3 tabs (`LinksPanel.tsx:18-22`) and N5 adds Architecture (`links.json:247-250,370-373`). Primitive: `LensSwitcher` or `Segmented` with count badges.
- [ ] **#2** `?tab=` receiver survives for `redirects|internal|dead-links`, with `dead` legacy alias and bad-param fallback to Redirects. HEAD reads/validates `tab` (`LinksPanel.tsx:27-33`); alias helper exists (`tab-search-param.ts:1-4,26-28`). Primitive: `useLinksSurfaceState.ts` URL-state hook.
- [ ] **#3** Site Audit fix-routing lands here unchanged: issue fix map routes `redirect_chain|broken_link|missing_canonical` to Links (`audit/types.ts:94-100`), and Site Audit's broken-link stat sends `?tab=dead-links` (`SeoAudit.tsx:528-537`). Primitive: route receiver + contract tests (§4).
- [ ] **#4** Dead Links remains lazy/error-boundary safe. HEAD lazy-loads `LinkChecker` (`LinksPanel.tsx:11`) and wraps the tab in `ErrorBoundary`/`Suspense` (`LinksPanel.tsx:72-77`). Primitive: rebuilt lazy lens with `Skeleton` fallback and error branch.
- [ ] **AD-001 freshness** applies to all four tabs: manual Re-scan/Analyze action + "Last scanned/analyzed" meta in `Toolbar` trailing slot, no implied scheduled scans (`PHASE_A_DECISIONS.md:10`; `BUILD_CONVENTIONS.md:16-46`).

### 2.2 Redirects lens (#5-#20)
- [ ] **#5** Run redirect scan through existing route/client. UI call `redirects.scan` (`misc.ts:250-255`) hits `GET /api/webflow/redirect-scan/:siteId` (`webflow-analysis.ts:198-224`). Primitive: `Toolbar` Re-scan `Button` + mutation feedback.
- [ ] **#6 / N2** GSC ghost URL hits display rides SB-025. GSC pages include clicks/impressions (`webflow-analysis.ts:203-215`) but PageStatus currently stores only url/path/title/source for ghost rows (`redirect-scanner.ts:252-265`). Primitive: `DataTable` column, em-dash until field exists.
- [ ] **#7** Redirect target recommendations carry the heuristic target/reason. Scorer `findBestMatch` computes `bestScore` but returns only page today (`redirect-scanner.ts:146-192`); recommendations attach target/reason at `redirect-scanner.ts:357-381`. Primitive: `DataTable`/`BoardCard` rows + `Badge` "match %" after SB-025.
- [ ] **#8** Accept/dismiss suggested rules carry (`RedirectManager.tsx:145-146,416-419`). Primitive: row actions in `Toolbar`/icon buttons with labels.
- [ ] **#9** Edit target inline carries (`RedirectManager.tsx:147-151,394-406,422-428`). Primitive: row edit state or Drawer detail with `FormInput`.
- [ ] **#10** Export accepted rules CSV carries (`RedirectManager.tsx:155-165,369-371`). Primitive: Toolbar overflow/action.
- [ ] **#11** Copy accepted rules carries (`RedirectManager.tsx:167-172,366-368`). Primitive: icon button + `useToast` or local copied state.
- [ ] **#12** Send accepted rules to client as `redirect_proposal` carries (`RedirectManager.tsx:174-195,361-387`); client renderer consumes `RedirectProposalPayload` (`decision-renderers.tsx:414-430`; `client-actions.ts:85-94`). Primitive: "Send to client" `Button` + optional note.
- [ ] **#13** Redirect Chains panel carries (`RedirectManager.tsx:287-343`; model `redirect-scanner.ts:21-29`). Primitive: collapsed `GroupBlock` + `Drawer`/expand rows.
- [ ] **#14** All-pages status table carries path/title/source/status/redirect target/suggested row (`RedirectManager.tsx:473-527`; PageStatus shape `redirect-scanner.ts:38-48`). Primitive: self-carded `DataTable`.
- [ ] **#15** Status filters + search carry (`RedirectManager.tsx:69,214-222,435-471`). Primitive: `FilterChip` row + `SearchField`.
- [ ] **#16** Summary stats carry Healthy/Redirecting/404s/Chains + longest chain (`RedirectManager.tsx:279-285`; summary shape `redirect-scanner.ts:50-62`). Primitive: `MetricTile` grid.
- [ ] **#17** Snapshot persistence/restore carries (`RedirectManager.tsx:87-111`; `redirect-store.ts:82-103`; snapshot route `webflow-analysis.ts:238-242`). Primitive: React Query snapshot read + freshness meta.
- [ ] **#18** Activity log on scan stays server-side (`webflow-analysis.ts:226-229`). Primitive: none - backend side effect unchanged.
- [ ] **#19** Empty/loading/error states carry and upgrade to shared states (`RedirectManager.tsx:224-260`). Primitive: `EmptyState`, `Skeleton`, `ErrorState`, stale cached-data `InlineBanner`.
- [ ] **#20** How-to tips carry (`RedirectManager.tsx:529-548`). Primitive: `GroupBlock`/`InlineBanner` with action links.

### 2.3 Internal Links lens (#21-#34)
- [ ] **#21** AI internal-link analysis uses existing server pipeline, unchanged (`webflow-analysis.ts:246-251`; `internal-links.ts:288-315,368-420`). Primitive: Toolbar Re-analyze action over React Query.
- [ ] **#22** Suggestion rows carry from/to, anchor, reason, priority (`InternalLinks.tsx:358-420`; shared type `internal-links.ts:1-9`). Primitive: self-carded `DataTable` + row `Drawer`.
- [ ] **#23** Priority filters + search carry (`InternalLinks.tsx:84-99,252-285`). Primitive: `FilterChip` + `SearchField`.
- [ ] **#24** List vs grouped-by-source view toggle carries (`InternalLinks.tsx:35,286-305,315-356`). Primitive: `Segmented`.
- [ ] **#25** Copy `<a href>` HTML carries until N1 insert exists (`InternalLinks.tsx:342-350,381-389`). Primitive: row icon button + copied feedback.
- [ ] **#26** Orphan-page detection/list carries (`InternalLinks.tsx:224-250`; server computes orphans `internal-links.ts:247-263`). Primitive: collapsible `GroupBlock`.
- [ ] **#27** Per-page link-health score + Avg Link Score carries (`InternalLinks.tsx:216-222`; shared `PageLinkHealth.score` `internal-links.ts:11-18`; server computes score `internal-links.ts:247-259`). Primitive: `Meter` + `MetricTile`; color via score helpers.
- [ ] **#28** Batch send suggestions to client as one `internal_link` action + note carries (`InternalLinks.tsx:101-123,177-181,202-213`; mapper `internal-link-client-action.ts:29-54`; renderer `decision-renderers.tsx:356-410`). Primitive: "Send to client" `Button` + note.
- [ ] **#29** Reanalyze carries (`InternalLinks.tsx:53-77,182-184`). Primitive: Toolbar action + mutation feedback.
- [ ] **#30** Snapshot persistence/restore carries (`InternalLinks.tsx:41-51`; `performance-store.ts:358-363`; snapshot route `webflow-analysis.ts:286-289`). Primitive: React Query query key; current key exists at `queryKeys.ts:130-131`.
- [ ] **#31** Outcome tracking of top-5 suggestions stays server-side (`webflow-analysis.ts:253-277`). Primitive: none - endpoint side effect unchanged.
- [ ] **#32** Partial-fetch diagnostics carry (`InternalLinks.tsx:438-458`; server emits `attemptedPageCount` `internal-links.ts:411-418`). Primitive: `InlineBanner` warning/success states.
- [ ] **#33** Empty/loading/error states carry (`InternalLinks.tsx:133-165,189-200`). Primitive: `EmptyState`, `LoadingState`/`Skeleton`, `ErrorState`.
- [ ] **#34** How-to / SEO-impact tips carry (`InternalLinks.tsx:424-436`). Primitive: `GroupBlock`/`InlineBanner`.

### 2.4 Dead Links lens (#35-#42)
- [ ] **#35** Crawl-domain selector carries (`LinkChecker.tsx:48-57,111-124`; domain endpoint `webflow-analysis.ts:165-176`; `getSiteDomains` `link-checker.ts:33-36`). Primitive: `FormSelect`/validated select in Toolbar.
- [ ] **#36** Full-site link check carries with extractor behavior unchanged (`link-checker.ts:38-57,100-122`; route `webflow-analysis.ts:178-183`). Primitive: Toolbar "Run Link Check" / Re-check action.
- [ ] **#37** Result stats carry total/healthy/dead/redirects (`LinkChecker.tsx:19-26,155-173`; result shape `link-checker.ts:22-29`). Primitive: `MetricTile` grid.
- [ ] **#38** Dead vs Redirects sub-toggle + internal/external type filter carries (`LinkChecker.tsx:43-44,185-217`). Primitive: `Segmented` + `FilterChip`.
- [ ] **#39** Dead-links CSV export carries (`LinkChecker.tsx:82-99,219-227`). Primitive: Toolbar export action.
- [ ] **#40** Per-link detail, Re-check, timestamp, crawled domain carry (`LinkChecker.tsx:228-287`; server returns `statusText`/`crawledDomain` `link-checker.ts:12-29,234-241`). Primitive: `DataTable` row + Drawer/detail.
- [ ] **#41** Snapshot persistence/restore carries (`LinkChecker.tsx:72-80`; `performance-store.ts:348-353`; snapshot route `webflow-analysis.ts:191-194`). Primitive: React Query snapshot read + freshness meta.
- [ ] **#42** Empty/first-run/long-loading states carry (`LinkChecker.tsx:101-146`). Primitive: `EmptyState`, `Skeleton`, long-running `InlineBanner`.

### 2.5 Cross-surface / data contracts (#43-#46)
- [ ] **#43** Site Audit auto-runs dead-link check + deep-links here. Server calls `checkSiteLinks(siteId, wsId)` (`seo-audit.ts:228-235`); UI sender targets `links?tab=dead-links` (`SeoAudit.tsx:536`). Primitive: no server change; receiver tests (§4).
- [ ] **#44** Intelligence slices read snapshots unchanged. `site-health-slice` reads link check and redirect snapshots (`site-health-slice.ts:188-198,276-286`), `page-profile-slice` casts internal-link snapshot as `InternalLinkResult` (`page-profile-slice.ts:178-180`), and AdminChat reads link-check detail (`admin-chat-context.ts:916-924`). Primitive: none - Frozen Contract #1.
- [ ] **#45** Client Inbox renderers for `internal_link` / `redirect_proposal` stay compatible (`decision-renderers.tsx:356-414`; source union `client-actions.ts:8-13`). Primitive: none - producer payloads unchanged.
- [ ] **#46** Endpoint auth remains `requireWorkspaceSiteAccessFromQuery()` for all Links routes (`webflow-analysis.ts:166,178,192,198,239,246,287`). Primitive: none - no route/auth changes.

### 2.6 Adopted / deferred kit features (N1-N6)
- [ ] **N1** Insert internal link directly into page - **DEFER** to seo-editor write-target follow-up (AD-017). DEF-links-001.
- [ ] **N2** Per-404 hits + match % - **RIDE W3** via SB-025; render no fabricated values (`server-backlog.json:351-361`).
- [ ] **N3** Scheduled/automatic crawls - **DEFER** to SB-045; manual scans remain (`server-backlog.json:607-617`). DEF-links-004.
- [ ] **N4** Dead-link Redirect/Reviewed row actions - **BUILD session-state quick win**, defer persisted reviewed state + direct redirect-create (`links.json:365-368`; SB-027 `server-backlog.json:377-387`; SB-026 `server-backlog.json:364-374`). DEF-links-003 + DEF-links-005.
- [ ] **N5** Architecture as 4th tab - **BUILD relocation**, carry existing SiteArchitecture capabilities; defer prototype-only Add-page CTA (`links.json:370-373`; `phase0/surfaces/links.md:95`). DEF-links-007.
- [ ] **N6** Links -> Insights Engine graduation bridge - **DEFER** under AD-004; no ad-hoc insight write. DEF-links-006.

---

## 3. Server tickets [ride vs defer]

Consume verifier-adjusted backlog IDs, not gatherer-only `sn-*` labels. Local Links `sn-*` rows map to the SB rows below.

| SB / sn | Title | Effort | Disposition | Rationale |
|---|---|---|---|---|
| **SB-025** (`sn-links-1` + `sn-links-2`) | GSC hits + match-score on redirect PageStatus rows | S | **RIDE W3** | N2 is adopted (`links.json:355-358`) and AD-027 requires real `match %`, never fabricated "AI %" (`owner-decisions.json:348-356`). Verifier confirms GSC clicks/impressions are fetched but dropped and `bestScore` is not serialized (`links.json:425-435`). Backlog says no migration because redirect results persist as JSON (`server-backlog.json:351-361`; `redirect-store.ts:82-96`). |
| **SB-026** | Webflow redirect-create endpoint | M | **DEFER → DEF-links-005** | Direct Webflow redirect creation is a write path. W3 ships export/pre-stage parity; AD-017 says new write paths are owner-signed follow-ups (`owner-decisions.json:232-245`). Backlog confirms no route backs `/api/webflow/redirects` today (`server-backlog.json:364-374`). |
| **SB-027** (`sn-links-3`) | Persisted reviewed/suppressed state for dead links | M | **DEFER → DEF-links-003** | N4 adopts session-state row actions only (`links.json:365-368`). Verifier confirms no Links suppression store or toggle endpoint exists (`links.json:437-440`); backlog homes the new store/endpoint in `performance-store` or routes (`server-backlog.json:377-387`). |
| **SB-045** (`sn-links-4`) | Move synchronous long-GET link/redirect/internal-link scans to background jobs | M | **DEFER → DEF-links-004** | AD-001 keeps manual Refresh and explicitly defers scheduled/cron scanning (`PHASE_A_DECISIONS.md:10`). Verifier confirms all three scans run inline in GET handlers and no cron exists (`links.json:443-446`); backlog marks this later (`server-backlog.json:607-617`). |

**Net:** SB-025 rides W3. SB-026, SB-027, and SB-045 defer with DEF rows. Shared backlog rows that list Links as a future consumer but are not local Links server needs - SB-009 schema/readiness coverage (`server-backlog.json:127-139`) and SB-010 audit category rollups (`server-backlog.json:142-156`) - are not owned by this Page `links` ticket; consume those fields only if their owning Site Audit/Schema work has landed.

---

## 4. Deep-link receiver matrix

Two-halves contract applies (CLAUDE.md UI rule 12; BUILD_CONVENTIONS §7/§8). Keep `tests/contract/tab-deep-link-wiring.test.ts` green and add a runtime receiver test for the rebuilt Links surface. The static test only proves source wiring (`tab-deep-link-wiring.test.ts:1-13`); runtime test must render the URL and assert the lens lands.

| Link | Sender | Receiver / target | Disposition |
|---|---|---|---|
| `?tab=dead-links` | Site Audit broken-link stat (`SeoAudit.tsx:536`) | Page `links`, Dead Links lens (`LinksPanel.tsx:21,72-75`), breadcrumb label `dead-links` (`RebuiltBreadcrumb.tsx:45-46`) | **KEEP - Frozen Contract #3.** Rebuilt `useLinksSurfaceState.ts` must read/validate `tab=dead-links`; runtime test renders `/ws/ws-1/links?tab=dead-links`. |
| `?tab=redirects` | Direct bookmarks / future Site Audit redirect-chain sender (current quick-fix target is plain Links at `SeoAudit.tsx:550`) | Page `links`, Redirects lens (`LinksPanel.tsx:18-21,66-68`) | **KEEP.** Default is Redirects; runtime test covers explicit `?tab=redirects` and plain `/links`. |
| `?tab=internal` | Direct bookmarks | Page `links`, Internal Links lens (`LinksPanel.tsx:18-21,69-70`) | **KEEP.** Runtime test renders `/ws/ws-1/links?tab=internal`. |
| `?tab=dead` | Prototype / legacy alias noise (`links.json:342-346`) | Page `links`, Dead Links lens | **ALIAS.** Use `legacyAliases: { dead: 'dead-links' }` via `tab-search-param.ts:1-4,26-28`; runtime test proves alias. |
| `?tab=<bad>` | User/bookmark noise | Page `links`, Redirects lens | **VALIDATE + FALLBACK.** Preserve HEAD fallback behavior (`LinksPanel.tsx:29-32`) and pilot URL-state pattern. |
| Architecture tab | New rebuilt surface tab (no existing Page route change) | Page `links`, Architecture lens | **NEW INTERNAL LENS ONLY.** Use the same validated state hook, but do not break `dead-links`. Any Page Intelligence removal/D8 sender retarget is D3/Page Intelligence-owned (§7). |

---

## 5. Flag disposition

| Flag | Kind | Disposition | Evidence |
|---|---|---|---|
| `ui-rebuild-shell` | A-lane UI-shell flag | **Gates this rebuilt surface.** Add one `REBUILT_SURFACES['links']` mount; flag-OFF falls through to legacy `LinksPanel` in `App.tsx:422` byte-identical. | Flag default/catalog `feature-flags.ts:117-120,460-468`; mount seam `rebuiltSurfaces.ts:5-20`; shell mount branch `App.tsx:460-480`. |

No new feature flag is introduced. No existing flag is retired by this surface. Provider/data availability (Webflow site, GSC, AI key, link-check domain, long-running scans) renders through four-state UI, not a new flag.

---

## 6. File ownership

**Owned by this ticket (create/edit):**
- `src/components/links-rebuilt/**` - new `@ds-rebuilt` surface directory. Expected split: `LinksSurface.tsx`, `RedirectsLens.tsx`, `InternalLinksLens.tsx`, `DeadLinksLens.tsx`, `ArchitectureLens.tsx`, `LinksTable`/detail Drawer components, `useLinksSurfaceState.ts` (validated `?tab=` receiver + `dead` alias), `linksMutationFeedback.ts` using `useToast` + `mutationErrorMessage`, and shared formatters. Every file first line `// @ds-rebuilt`.
- `src/hooks/admin/useAdminLinks.ts` (or colocated rebuilt hooks) - React Query wrappers over existing API clients: `redirects.scan/snapshot` (`misc.ts:250-255`), `webflow.linkCheck*` / `internalLinks*` (`seo.ts:293-321`), and `siteArchitecture.*` (`content.ts:347-383`). No raw `fetch()` in components.
- `src/lib/queryKeys.ts` - add admin Links query-key factories for redirect snapshots, link-check domains/check/snapshot, and architecture if needed; reuse existing `internalLinksSnapshot` key (`queryKeys.ts:130-131`).
- `src/components/layout/rebuiltSurfaces.ts` - one line keyed by Page `'links'`: `lazyWithRetry(() => import('../links-rebuilt/LinksSurface').then(m => ({ default: m.LinksSurface })))`. Never add a new `App.tsx` branch.
- `tests/component/links-rebuilt/**` - flag-transition component test with real `useFeatureFlag` seeded through `QueryClient`, a11y-floor assertion, per-lens state tests, and runtime receiver tests for `?tab=redirects|internal|dead-links|dead|bad`.
- `tests/contract/tab-deep-link-wiring.test.ts` - keep static sender/receiver contract green for the Site Audit `?tab=dead-links` sender; the test's contract is documented at `tab-deep-link-wiring.test.ts:1-13`.
- `server/redirect-scanner.ts` + shared/result type touch only if SB-025 rides in the same PR; optional JSON fields on `PageStatus` are additive and must not reshape existing snapshot arrays (`redirect-scanner.ts:38-48`; `server-backlog.json:351-361`).
- `data/ui-rebuild-deferred-ledger.json` - add the DEF rows drafted in §7 in the implementation PR only. This ticket does not edit the ledger.

**Reused, NOT rewritten:**
- Existing server routes and side effects in `server/routes/webflow-analysis.ts`: domains/link-check/snapshot (`:165-194`), redirect scan/snapshot (`:198-242`), internal links/snapshot (`:246-289`).
- Existing stores `redirect-store.ts:73-103` and `performance-store.ts:348-363`; snapshot persistence stays opaque JSON unless a named SB row says otherwise.
- Existing client-action payload renderers for `internal_link` and `redirect_proposal` (`decision-renderers.tsx:356-414`) and source-type union (`client-actions.ts:8-13`).
- Existing `SiteArchitecture` data/API and UI machinery (`SiteArchitecture.tsx:212-246,305-429`; `site-architecture.ts:19-34`), carried into the 4th tab rather than redesigned.
- Existing intelligence consumers: `site-health-slice.ts:188-198,276-286`, `page-profile-slice.ts:178-180`, and `admin-chat-context.ts:916-924`.

**Must NOT touch / other-owner constraints:**
- **Frozen Contract #1 - Links snapshot shapes read by intelligence slices.** `page-profile-slice.ts:178-180` reads `getInternalLinks(...)` snapshots as `InternalLinkResult`; `InternalLinkResult` shape is `shared/types/internal-links.ts:20-27`; contract is registered at `CROSS_SURFACE_CONTRACTS.md:63`. Do not reshape snapshots or rename fields.
- **Frozen Contract #2 - `checkSiteLinks` signature.** `server/link-checker.ts:100` is `checkSiteLinks(siteId: string, workspaceId?: string, domain?: string): Promise<LinkCheckResult>`; contract is registered at `CROSS_SURFACE_CONTRACTS.md:64`. Do not change the signature or call semantics used by Site Audit (`seo-audit.ts:228-235`).
- **Frozen Contract #3 - `?tab=dead-links` sender/receiver.** Sender `SeoAudit.tsx:536`, receiver tab id `LinksPanel.tsx:21,72-75`, and breadcrumb label `RebuiltBreadcrumb.tsx:45-46` must survive; contract is registered at `CROSS_SURFACE_CONTRACTS.md:65`. The rebuilt surface remains the receiver.
- `src/components/client/**` and Inbox renderer payload shapes; Q4 keeps batch send semantics. Per-suggestion sends need a separate owner-signed payload change.
- Page Intelligence / SEO Editor D3 removal work for `SiteArchitecture`. Links mounts the new home; the other owner removes or retargets the old home in its own paired effort (`links.json:330-332`).
- Route id `links` in `src/routes.ts:5`; it is not renamed or removed.

---

## 7. D8 / DEF entries

**D8 redirect map:** none for Page `links`. The route id is preserved (`src/routes.ts:5`) and the legacy mount remains flag-OFF (`src/App.tsx:422`). No `D8_REDIRECT_MAP.md` row is added by this ticket.

**Architecture relocation note:** if Page Intelligence removes its Architecture tab or retargets bookmarks, that D8/removal row belongs to the D3/Page Intelligence removal PR named by Q5 (`links.json:330-332`). This Page `links` ticket does not rename or remove a Page.

**Deferred-ledger rows to add in the surface PR** (copy the existing ledger shape; classes use the valid enum only: `token | primitive | behavior | data | a11y | perf | copy`, enforced by `verify-deferred-ledger.ts:22-34`):

```jsonc
{
  "id": "DEF-links-001",
  "surface": "links",
  "item": "Insert internal link directly into a Webflow source page",
  "decision": "Ship copy-HTML/manual implementation parity now; defer direct insertion because it is a new Webflow write path under AD-017.",
  "class": "behavior",
  "upgradeTrigger": "A signed seo-editor write-target contract adds a safe Webflow insert-internal-link path with preview, auth, activity log, and rollback semantics.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-08-18",
  "links": {
    "decision": "AD-017",
    "surface": "docs/ui-rebuild/phase-a/surfaces/links.json:350-352",
    "head": "src/components/InternalLinks.tsx:342-350,381-389"
  }
},
{
  "id": "DEF-links-002",
  "surface": "links",
  "item": "Per-suggestion internal-link client sends",
  "decision": "Keep the HEAD batched internal_link action plus optional note; defer per-suggestion sends because they change the Inbox payload contract.",
  "class": "behavior",
  "upgradeTrigger": "Owner signs a new per-item client-action payload contract and the client Inbox renderer supports both batch and item-level review.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-08-18",
  "links": {
    "decision": "AD-027",
    "surface": "docs/ui-rebuild/phase-a/surfaces/links.json:324-328",
    "clientRenderer": "src/components/client/decision-renderers.tsx:356-410"
  }
},
{
  "id": "DEF-links-003",
  "surface": "links",
  "item": "Persisted reviewed or suppressed state for dead links",
  "decision": "Ship Reviewed as session-state row feedback only; defer durable suppression until a Links-owned store and toggle endpoint exist.",
  "class": "data",
  "upgradeTrigger": "SB-027 lands the reviewed/suppressed store, POST toggle endpoint, and link-check snapshot serialization.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-08-18",
  "links": {
    "backlog": "SB-027",
    "surface": "docs/ui-rebuild/phase-a/surfaces/links.json:365-368,437-440",
    "server": "docs/ui-rebuild/phase-a/server-backlog.json:377-387"
  }
},
{
  "id": "DEF-links-004",
  "surface": "links",
  "item": "Background jobs and scheduled crawls for link, redirect, and internal-link scans",
  "decision": "Keep manual synchronous GET scans for parity and honest freshness; defer job migration and recurring crawl scheduling.",
  "class": "perf",
  "upgradeTrigger": "SB-045 moves the three scans to the background-job platform and, if scheduled crawl is adopted, registers the cron with the registry census test.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-08-18",
  "links": {
    "decision": "AD-001",
    "backlog": "SB-045",
    "surface": "docs/ui-rebuild/phase-a/surfaces/links.json:360-363,443-446",
    "server": "docs/ui-rebuild/phase-a/server-backlog.json:607-617"
  }
},
{
  "id": "DEF-links-005",
  "surface": "links",
  "item": "Direct Webflow redirect-create action from Dead Links or Redirects",
  "decision": "Ship export, copy, send-to-client, and pre-stage flows; defer direct Webflow redirect creation because the server route is missing and write paths require AD-017 treatment.",
  "class": "behavior",
  "upgradeTrigger": "SB-026 adds the redirect-create endpoint and the Links surface has an owner-signed write UX with activity logging and failure states.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-08-18",
  "links": {
    "decision": "AD-017",
    "backlog": "SB-026",
    "surface": "docs/ui-rebuild/phase-a/surfaces/links.json:242-245",
    "server": "docs/ui-rebuild/phase-a/server-backlog.json:364-374"
  }
},
{
  "id": "DEF-links-006",
  "surface": "links",
  "item": "Links-to-Insights Engine graduation bridge",
  "decision": "Do not build a Links-only insight write; defer graduation to the C3 owner-signed cross-surface seam required by AD-004.",
  "class": "behavior",
  "upgradeTrigger": "The C3 graduation contract explicitly includes Links signals and defines InsightType registration, broadcast, activity log, and source provenance.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-08-18",
  "links": {
    "decision": "AD-004",
    "surface": "docs/ui-rebuild/phase-a/surfaces/links.json:375-378",
    "phaseA": "docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13,28-30"
  }
},
{
  "id": "DEF-links-007",
  "surface": "links",
  "item": "Architecture gap Add-page CTA",
  "decision": "Relocate the existing Architecture view now; defer the prototype-only Add-page CTA until a destination and write contract are signed.",
  "class": "behavior",
  "upgradeTrigger": "A Content Pipeline or strategy-planning receiver is named for creating planned pages from architecture gaps, including route params and ownership.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "2026-07-07",
  "reviewBy": "2026-08-18",
  "links": {
    "surface": "docs/ui-rebuild/phase0/surfaces/links.md:95",
    "architecture": "src/components/SiteArchitecture.tsx:353-391"
  }
}
```

### Gates before merge

`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Add flag-transition component coverage with a seeded `QueryClient`, static + runtime deep-link receiver tests (including `?tab=dead-links`), and a flag-ON browser smoke against a workspace with real redirect, internal-link, dead-link, and architecture data.
