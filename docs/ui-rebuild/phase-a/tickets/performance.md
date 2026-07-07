# Wave 3 BUILD TICKET — Performance (Page `performance`)

> **Surface:** admin `Page 'performance'` (`src/routes.ts:9`) in Site Health nav (`src/lib/navRegistry.tsx:126-127`, `needsSite: true`).
> **HEAD component + mount:** `Performance` (`src/components/Performance.tsx:10-15`, `?tab=speed|weight` receiver) mounted from `src/App.tsx:433`.
> **Wave:** W3 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **M** (`docs/ui-rebuild/phase-a/surfaces/performance.json:415`).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` (especially §1 freshness, §2 verdicts, §6 honest absence, §7 structural template, §8 tests) -> `surfaces/performance.json` -> `phase0/surfaces/performance.md` -> this ticket -> Keywords pilot (`src/components/keywords-rebuilt/`).
> **Mount contract:** rebuilt surface mounts behind `ui-rebuild-shell` through one `REBUILT_SURFACES['performance']` entry (`src/components/layout/rebuiltSurfaces.ts:5-15,19-38`). Flag-OFF remains byte-identical legacy `Performance` in `App.tsx:433`.

---

## 1. ⚠ OWNER DELTAS

**none — all defaults adopted.** Every discovery open question in `surfaces/performance.json:268-328` resolves to its proposed default or to a ratified AD / cross-surface row. No item goes back to the owner.

| Discovery OQ | Resolution (default adopted) | Backing |
|---|---|---|
| OQ1 — C7 term-coverage / brief-execution placement | Keep coverage % badge + missing-term chips on the Published card; full joinback panel in the piece Drawer. Dropping this is a hard parity stop. | `performance.json:269-274`; HEAD coverage/joinback UI `ContentPerformance.tsx:86-102,388-420`; AD-011 additive parity (`owner-decisions.json:159-173`). |
| OQ2 — B2 bulk PageSpeed testing | Retain as a Page Speed `Segmented` mode; server supports `maxPages` up to `MAX_PAGESPEED_PAGES`, and the HEAD UI already has bulk mode. | `performance.json:275-280`; HEAD `PageSpeedPanel.tsx:172-194,321-403,455-610`; route `webflow-pagespeed.ts:26-47`; AD-011. |
| OQ3 — B6 field/lab badge + B8 diagnostics | Keep both: provenance `Badge` for field/lab and diagnostics as a collapsed `GroupBlock`. | `performance.json:281-286`; HEAD field/lab `PageSpeedPanel.tsx:255-262`; diagnostics `PageSpeedPanel.tsx:297-317,574-604`; `server/pagespeed.ts:22-33,280-305`; AD-011 + BUILD_CONVENTIONS §6. |
| OQ4 — C10 delivered-but-not-published items | Status `FilterChip` includes `delivered`; do not server-filter them away. | `performance.json:288-292`; server includes delivered + published `content-performance.ts:207-209`; UI status badge `ContentPerformance.tsx:266`; AD-011. |
| OQ5 — C15 verdict + C16 graduation | Verdict is server-side only via `OutcomeReadback`; automatic insight graduation defers to the C3 owner-signed seam. Manual pre-filled outcome form may be a non-insight fallback, but no ad-hoc "Add to Insights Engine" write ships here. | `performance.json:293-298`; AD-002 (`PHASE_A_DECISIONS.md:10-13`); AD-004 (`PHASE_A_DECISIONS.md:13,28-30`); SB-006 (`server-backlog.json:87-99`); SB-001 (`server-backlog.json:7-23`). |
| OQ6 — C4 aggregate reframe | Use outcome-first headline tiles, but keep GSC/GA4 totals as secondary `MetricTile`s. | `performance.json:300-304`; HEAD totals `ContentPerformance.tsx:155-217`; BUILD_CONVENTIONS §5 rate-denominator rule. |
| OQ7 — A5 CSS filter + C5 sort controls | Keep both: CSS rows are real server output and DataTable sorting is low-cost parity. | `performance.json:306-310`; CSS filter `PageWeight.tsx:60,131-137,187-192`; sort controls `ContentPerformance.tsx:121,145-153,219-237`; AD-011. |
| OQ8 — B14 dead `pageWeight.get/analyze` methods | Delete the unrouted wrappers in the rebuild PR. | `performance.json:312-316`; wrappers `src/api/seo.ts:427-433`; AD-030 lists "pageWeight dead methods" cleanup (`owner-decisions.json:381-395`). |
| OQ9 — Page `content-perf` retirement | Adopt the default, but **not in this Page `performance` PR**: the Content Pipeline consolidation PR owns `content-perf -> content-pipeline?tab=published` route removal + D8. | `performance.json:317-322`; current route still exists `src/routes.ts:10`, mount `src/App.tsx:434`; route-removal checklist applies only in the consolidation PR. |
| OQ10 — A9 Asset Manager receiver | Asset Manager owns the receiver; Performance ships sender only after that contract exists. Full in-place compress defers. | `performance.json:323-328`; Asset Manager ticket receiver matrix `docs/ui-rebuild/phase-a/tickets/asset-manager.md:105-123`; Page Weight tip `PageWeight.tsx:250-257`. |

---

## 2. Capability checklist

Every `capabilityClassification` row in `surfaces/performance.json:4-214` is an acceptance criterion. DataTables are self-carded (`BUILD_CONVENTIONS.md:159-163`) and must not be `SectionCard`-wrapped.

### 2.1 Page shell / routing / URL state
- [ ] **B11** `?tab=speed|weight` deep-link receiver survives. HEAD reads `searchParams.get('tab')` and defaults to `weight` (`Performance.tsx:10-15`), renders Page Weight / Page Speed by tab (`Performance.tsx:24-33`), and Site Audit links into Performance (`SeoAudit.tsx:541-552`). Rebuild uses `LensSwitcher` plus a validated URL-state hook; add runtime + static tests (§4).
- [ ] **A2/B9 freshness meta** renders in the `Toolbar` trailing slot: Page Weight snapshot restore (`PageWeight.tsx:73-84`; `server/routes/webflow-audit.ts:207-211`; `performance-store.ts:141-167`) and PageSpeed snapshot restore (`PageSpeedPanel.tsx:153-170,482-484`; `webflow-pagespeed.ts:49-53`; `performance-store.ts:186-193`). Primitive: `Toolbar` + `ToolbarSpacer` + caption meta + Refresh/Re-scan button.
- [ ] **B12** server side-effects and snapshot shapes are unchanged. Bulk PageSpeed writes `savePageSpeed` + invalidates intelligence (`webflow-pagespeed.ts:39-41`); single-page writes `saveSinglePageSpeed` + invalidates (`webflow-pagespeed.ts:78-82`); site-health/page-profile slices depend on these persisted shapes (`phase0/surfaces/performance.md:57-58`). Primitive: none — backend contract.
- [ ] **B14** dead `pageWeight.get/analyze` wrappers are deleted, not rebuilt (`src/api/seo.ts:427-433`; no server route per `performance.json:121-124`). Primitive: none — cleanup.

### 2.2 Page Weight lens (A1-A10)
- [ ] **A1** on-demand page-weight scan calls the existing endpoint (`PageWeight.tsx:63-71`; `server/routes/webflow-audit.ts:148-206`). Primitive: `Toolbar` Re-scan action + `useMutation`.
- [ ] **A2** snapshot persistence + freshness meta as above (`PageWeight.tsx:73-84`; `performance-store.ts:141-167`). Primitive: Toolbar meta; honest copy per AD-001 (`PHASE_A_DECISIONS.md:10`).
- [ ] **A3** four summary cards carry pages-with-assets, total asset size, heavy pages >2MB, avg page weight (`PageWeight.tsx:144-168`). Primitive: `MetricTile` grid.
- [ ] **A4** search pages and asset filenames (`PageWeight.tsx:131-142,173-181`). Primitive: `SearchField` with preserved focus/caret behavior.
- [ ] **A5** CSS source filter stays (`PageWeight.tsx:60,131-137,187-192`; `performance.json:26-29`). Primitive: `FilterChip` row or validated select; keep `all|page|cms|css`.
- [ ] **A6** ranked weight bars + 5MB/2MB/1MB thresholds carry (`PageWeight.tsx:35-52,204-232`). Primitive: self-carded `DataTable` rows + `Meter`; score colors through shared helpers, not hard-coded thresholds in JSX.
- [ ] **A7** per-page asset breakdown carries names/content type/size and >500KB emphasis (`PageWeight.tsx:234-246`). Primitive: row expand or `Drawer` detail.
- [ ] **A8** heavy-page tip becomes a real Asset Manager deep-link once the receiver exists (`PageWeight.tsx:250-257`; `performance.json:41-44`). Primitive: `InlineBanner` + `Button` link to `media?tab=audit&filter=oversized` (or asset-specific param if receiver supports it).
- [ ] **A9** per-asset Compress full action is deferred; quick-win is Asset Manager deep-link only (`performance.json:46-49,330-335`). Primitive now: link `Button`; full action DEF-performance-001.
- [ ] **A10** four states carry: pre-run CTA, 30-60s loading, error with Retry, empty snapshot (`PageWeight.tsx:86-127`). Primitive: `Skeleton`, `EmptyState`, `ErrorState`, `InlineBanner`.

### 2.3 Page Speed lens (B1-B14)
- [ ] **B1** single-page PSI test with searchable page selector (`PageSpeedPanel.tsx:140-151,196-216,351-379`; route `webflow-pagespeed.ts:55-87`). Primitive: `SearchField`/combobox + `Button`.
- [ ] **B2** bulk top-N PageSpeed testing carries (default top 3, server max 25) with averaged score/vitals and per-page results (`PageSpeedPanel.tsx:172-194,321-403,455-610`; `webflow-pagespeed.ts:26-47`). Primitive: `Segmented` single/bulk mode + self-carded `DataTable`.
- [ ] **B3** mobile/desktop strategy becomes side-by-side where practical, but keeps per-strategy reruns (`PageSpeedPanel.tsx:129,459-481`). Primitive: `Segmented` + two `GroupBlock`s.
- [ ] **B4** performance score ring carries (`PageSpeedPanel.tsx:64-68,255-260,487-492`). Primitive: `MetricRing`/`Meter`; no client-composed verdict.
- [ ] **B5** full CWV set carries: LCP, FCP, CLS, INP, TBT, Speed Index (and the existing threshold helper covers FID/TTI too) (`PageSpeedPanel.tsx:83-96,263-270,494-500,531-537`; `server/pagespeed.ts:11-20`). Primitive: `MetricTile`/`Meter` grid.
- [ ] **B6** field-data (CrUX) vs lab provenance badge carries (`PageSpeedPanel.tsx:255-262`; `server/pagespeed.ts:22-33`). Primitive: `Badge`.
- [ ] **B7** opportunities list with savings carries (`PageSpeedPanel.tsx:273-295,540-572`; `server/pagespeed.ts:240-278`). Primitive: collapsed `GroupBlock`; per-opportunity Fix routing defers (DEF-performance-002).
- [ ] **B8** diagnostics list carries (`PageSpeedPanel.tsx:297-317,574-604`; `server/pagespeed.ts:280-305`). Primitive: collapsed `GroupBlock`.
- [ ] **B9** snapshot persistence/restore per strategy carries (`PageSpeedPanel.tsx:153-170,482-484`; `webflow-pagespeed.ts:49-53`; `performance-store.ts:186-193`). Primitive: freshness meta.
- [ ] **B10** rate-limit-aware error/loading/retry keeps GOOGLE_PSI_KEY guidance and 30-60s copy (`PageSpeedPanel.tsx:181-185,408-451`). Primitive: `ErrorState` + Retry; stale cached data banner per BUILD_CONVENTIONS §1.
- [ ] **B11** receiver covered in §2.1/§4 (`Performance.tsx:10-15`; `SeoAudit.tsx:552`). Primitive: URL-state hook + `LensSwitcher`.
- [ ] **B12** side-effects covered in §2.1; keep calling the same endpoints (`src/api/seo.ts:441-448`; `webflow-pagespeed.ts:26-56`). Primitive: React Query hooks, not raw fetch.
- [ ] **B13** Lighthouse accessibility / best-practices / SEO category scores defer to SB-024 (`server/pagespeed.ts:59-64,224-228`; `performance.json:116-119,421-424`). Primitive later: `MetricTile`/`Meter`; DEF-performance-003.
- [ ] **B14** dead wrappers covered in §2.1 (`src/api/seo.ts:427-433`). Primitive: none.

### 2.4 Content Performance hand-off spec (C1-C18)

Content Perf folds into the Content Pipeline Published tab + piece Drawer (`performance.json:377-382,403-409`). This Page `performance` ticket records the spec and must not fork the shared admin/public/MCP handler.

- [ ] **C1** per-piece GSC clicks/impressions/position carry (`ContentPerformance.tsx:282-300,327-351`; server assembly `content-performance.ts:216-227,264-274`). Primitive: `DataTable` columns + drawer `KeyValueRow`.
- [ ] **C2** per-piece CTR carries despite prototype omission (`ContentPerformance.tsx:342-345`; server GSC `ctr` `content-performance.ts:216-227`). Primitive: drawer metric tile.
- [ ] **C3** GA4 sessions/users/bounce/engagement carry in drawer (`ContentPerformance.tsx:358-384`; server GA4 `content-performance.ts:233-245,273-274`). Primitive: drawer `MetricTile`/`KeyValueRow`.
- [ ] **C4** outcome-first headline tiles plus secondary total clicks/impressions/sessions/avg position (`ContentPerformance.tsx:155-217`; `performance.json:141-144,300-304`). Primitive: `MetricTile` grid.
- [ ] **C5** sort controls carry (`ContentPerformance.tsx:121,145-153,219-237`). Primitive: `DataTable` sort / `Toolbar` sort control.
- [ ] **C6** per-piece daily trend carries from the real endpoint (`ContentPerformance.tsx:132-143,422-429`; `content-requests.ts:304-329`). Primitive: inline `Sparkline` + drawer trend chart; no fabricated series (AD-026).
- [ ] **C7** term-coverage grading + brief-execution joinback carries (`ContentPerformance.tsx:86-102,388-420`; server coverage/joinback `content-performance.ts:251-278`). Primitive: `Badge`, missing-term `FilterChip`s, drawer `GroupBlock`.
- [ ] **C8** matrix-published cells render with source badge (`ContentPerformance.tsx:268-272`; matrix serialization `content-performance.ts:282-308`). Primitive: `Badge`/`IntentTag`.
- [ ] **C9** page-type, keyword, slug badges carry (`ContentPerformance.tsx:257-279`). Primitive: `Badge`/`IntentTag`.
- [ ] **C10** delivered and published statuses carry (`content-performance.ts:207-209`; `ContentPerformance.tsx:266`; empty-state copy `ContentPerformance.tsx:183-188`). Primitive: status `FilterChip`.
- [ ] **C11** days-since-publish display carries (`content-performance.ts:271-272`; `ContentPerformance.tsx:305-309`). Primitive: `KeyValueRow` / compact badge.
- [ ] **C12** states carry: loading, empty, error (`ContentPerformance.tsx:163-188`). Primitive: `Skeleton`, `EmptyState`, `InlineBanner`.
- [ ] **C13** public scrubbed read path remains shared and untouched (`scrubForPublic` `content-performance.ts:184-198`; public/admin wrappers `content-performance.ts:317-327`). Primitive: none — Frozen Contract #8.
- [ ] **C14** MCP `get_content_performance` stays on the same handler (`server/mcp/tools/content.ts:59-63,135-144`). Primitive: none.
- [ ] **C15** win/early/flat verdict is server-side only. Current branch already exposes `ContentPerformanceItem.outcome` (`shared/types/content.ts:398-406`) from server readbacks (`content-performance.ts:162-181,251-278`); UI maps `OutcomeScore` to labels/tones only. Primitive: `Badge`/`StatusBadge`; no UI heuristics (AD-002).
- [ ] **C16** automatic "Add to Insights Engine" graduation defers; insights routes only expose queue + resolve today (`server/routes/insights.ts:13-51`). Primitive now: optional disabled/link-out/manual outcome fallback with honest copy; DEF-performance-004 for the automatic write.
- [ ] **C17** "View live" button composes from workspace/site URL + slug; the trend route shows the server-side recipe (`content-requests.ts:315-321`) and UI has `targetPageSlug` (`ContentPerformance.tsx:276-278`). Primitive: external-link `Button`.
- [ ] **C18** engagement/impressions lift vs baseline defers; server currently reads one trailing 90-day GSC/GA4 window only (`content-performance.ts:216-249`; `performance.json:211-214,436-439`). Primitive later: `MetricTile`; DEF-performance-005.

---

## 3. Server tickets [ride vs defer]

Consume verifier-adjusted backlog IDs, not the gatherer-only `sn-*` labels. Local Performance `sn-*` rows map to the SB rows below.

| SB / sn | Title | Effort | Disposition | Rationale |
|---|---|---|---|---|
| **SB-006** (`sn-performance-2`) | Server-computed win/early/flat verdict on content/performance items | S | **RIDE W3 (consume/verify)** | AD-002 forbids client-composed verdicts. `server-backlog.json:87-99` says the work is a join to existing `OutcomeReadback`, not a new enum. Current branch already has `ContentPerformanceItem.outcome` (`shared/types/content.ts:398-406`) and server lookup (`content-performance.ts:162-181,251-278`), so W3 should consume it and test honest absence; if a build branch lacks it, wire SB-006 before rendering C15. |
| **SB-024** (`sn-performance-1`) | Lighthouse extra category scores (a11y / best-practices / SEO) | S | **DEFER** | Net-new, zero parity risk. PSI request asks only `category:'performance'` (`server/pagespeed.ts:59-64`) and `extractScore` reads only performance (`server/pagespeed.ts:224-228`). Surface JSON recommends defer (`performance.json:116-119,421-424`). Add DEF-performance-003. |
| **SB-001** (`sn-performance-3`) | Shared insight-graduation write seam | L | **DEFER** | AD-004 defers all graduation bridges to one C3-era owner-signed cross-surface contract (`PHASE_A_DECISIONS.md:13,28-30`). `server/routes/insights.ts:13-51` has queue + resolve only; no content-win POST route. Add DEF-performance-004. |
| **SB-008** (`sn-performance-4`) | Pre/post-publish baseline lift computation | M | **DEFER** | Server reads one trailing 90-day GSC/GA4 window today (`content-performance.ts:216-249`) and the verifier confirms no baseline/lift fields (`performance.json:436-439`). No fabricated lift %. Add DEF-performance-005. |

**Net:** SB-006 rides as consume/verify; SB-024, SB-001, and SB-008 defer. Non-local backlog items that list `performance` as a future consumer but are not referenced by `performance.json` local server needs (for example Asset Manager dimensions/savings and site-audit category rollups) are not owned by this Page `performance` ticket; consume them only if their owning surface has already landed the field.

---

## 4. Deep-link receiver matrix

Two-halves contract applies (CLAUDE.md UI rule 12; BUILD_CONVENTIONS §7/§8). Update `tests/contract/tab-deep-link-wiring.test.ts` and add a runtime receiver test for the rebuilt surface.

| Link | Sender | Receiver / target | Disposition |
|---|---|---|---|
| `?tab=weight` | Existing/possible direct bookmarks; rebuilt shell breadcrumb labels know `performance.weight` (`RebuiltBreadcrumb.tsx:71-74`). | Page `performance`, Page Weight lens | **KEEP.** Existing receiver validates `weight` (`Performance.tsx:10-15`). Rebuild reads it in `usePerformanceSurfaceState.ts`; runtime test renders `/ws/ws-1/performance?tab=weight`. |
| `?tab=speed` | Site Audit quick fix currently links plain `performance` (`SeoAudit.tsx:541-552`); future sender may add `?tab=speed`. | Page `performance`, Page Speed lens | **KEEP.** Existing receiver validates `speed` (`Performance.tsx:10-15`). Runtime test renders `/ws/ws-1/performance?tab=speed`. |
| `?tab=<bad>` | User/bookmark noise | Page `performance`, default Page Weight lens | Validate and fall back to `weight` (pilot URL-state pattern; `Performance.tsx:13-15` is the HEAD behavior). |
| Asset Manager hand-off | Page Weight heavy-page tip (`PageWeight.tsx:250-257`) | Page `media` receiver (`?tab=audit&filter=oversized`, asset param only if Asset Manager supports it) | Performance owns the sender after Asset Manager receiver exists (`asset-manager.md:105-123`); do not emit a URL whose receiver ignores the params. |
| Content Perf consolidation | Page `content-perf` | Content Pipeline Published tab | Not this PR. The Content Pipeline consolidation PR owns the route-removal checklist + D8 row (`performance.json:317-322,403-409`). |

---

## 5. Flag disposition

| Flag | Kind | Disposition | Evidence |
|---|---|---|---|
| `ui-rebuild-shell` | A-lane UI-shell flag | **Gates this rebuilt surface.** Add one `REBUILT_SURFACES['performance']` mount; flag-OFF falls through to legacy `Performance` in `App.tsx:433` byte-identical. | Flag default/catalog `shared/types/feature-flags.ts:117-120,460-466`; mount seam `rebuiltSurfaces.ts:5-15,19-38`; surface mount note `performance.json:400-401`. |

No new feature flag is introduced. No existing flag is retired by this surface. Backend/provider limits (Google PSI quota, Webflow access, GSC/GA4 availability) render as four-state UI, not as new flags.

---

## 6. File ownership

**Owned by this ticket (create/edit):**
- `src/components/performance-rebuilt/**` — new `@ds-rebuilt` surface directory. Expected split: `PerformanceSurface.tsx`, Page Weight lens/table/detail drawer, Page Speed lens/detail drawer, `usePerformanceSurfaceState.ts` (validated `?tab=` reads/writes), mutation-feedback helper using `useToast` + `mutationErrorMessage`, and shared formatters. Every file first line `// @ds-rebuilt`.
- `src/hooks/admin/useAdminPerformance.ts` (or a small hook family beside it) — React Query wrappers for `pageWeight.webflowPageWeight`, `webflowPageWeightSnapshot`, `pagespeedBulk`, `pagespeedSingle`, `pagespeedSnapshot`, and Content Performance reads as needed. Current `src/hooks/admin` has no Performance hook; legacy components fetch via raw `useState`/`useEffect` (`PageWeight.tsx:63-84`, `PageSpeedPanel.tsx:140-170`, `ContentPerformance.tsx:123-143`).
- `src/lib/queryKeys.ts` — add admin performance query-key factories (prefix `admin-performance-*` or equivalent) near the existing SEO/audit keys (`queryKeys.ts:66-143`).
- `src/components/layout/rebuiltSurfaces.ts` — one line keyed by Page `'performance'`: `lazyWithRetry(() => import('../performance-rebuilt/PerformanceSurface').then(m => ({ default: m.PerformanceSurface })))`. Never add a new `App.tsx` branch.
- `tests/component/performance-rebuilt/**` — flag-transition component test with real `useFeatureFlag` seeded through `QueryClient`, a11y-floor assertion, Page Weight/Page Speed state tests, and runtime deep-link receiver tests for `?tab=weight|speed`.
- `tests/contract/tab-deep-link-wiring.test.ts` — keep static sender/receiver contract green for any `?tab=` sender targeting `performance`; the test's contract is documented at `tab-deep-link-wiring.test.ts:1-13`.
- `data/ui-rebuild-deferred-ledger.json` — add the DEF rows drafted in §7 in the implementation PR only. This ticket does not edit the ledger.

**Reused, NOT rewritten:**
- Existing API client methods `pageWeight.*` and `contentPerformance.*` (`src/api/seo.ts:360-373,427-449`); remove only the dead `pageWeight.get/analyze` wrappers (`src/api/seo.ts:427-433`).
- Existing server routes and side effects: page weight (`webflow-audit.ts:148-211`), PageSpeed bulk/snapshot/single (`webflow-pagespeed.ts:26-87`), performance snapshots (`performance-store.ts:141-193`), content performance (`content-performance.ts:200-327`), and MCP `get_content_performance` (`server/mcp/tools/content.ts:59-63,135-144`).
- Existing business logic for asset usage, PSI extraction, coverage grading, joinback, public scrub, and outcome readbacks. The rebuild changes render and query discipline, not server meaning.

**Must NOT touch / other-owner constraints:**
- **Frozen Contract #8** — `getContentPerformance` public audience (`server/domains/content/content-performance.ts:184-198,317-327`) must stay shared; do not fork admin/public shapes for this rebuild.
- **Frozen Contract #7** — C-lane public audit shape (`CROSS_SURFACE_CONTRACTS.md:69`) is untouched; Performance may receive a Site Audit link but does not alter public audit serialization.
- Any Frozen Contract #1-#11 unless explicitly named in this ticket; `CROSS_SURFACE_CONTRACTS.md:61-73` says no lane may alter them.
- `src/components/client/**` client portal render paths; client-facing content performance remains C-lane / client-portal owned (`performance.json:403-408`).
- Content Pipeline Published tab implementation unless the controller explicitly pairs this work with the content-pipeline surface; this ticket records C-group acceptance criteria but does not retire `content-perf`.
- Asset Manager receiver implementation; Performance ships sender only after the `media` receiver contract lands (`asset-manager.md:105-123`).
- Route id `performance` in `src/routes.ts:9`; it is not renamed or removed.

---

## 7. D8 / DEF entries

**D8 redirect map:** none for Page `performance`. The route id is preserved (`src/routes.ts:9`) and the legacy mount remains flag-OFF (`src/App.tsx:433`). No `D8_REDIRECT_MAP.md` row is added by this ticket.

**Content Perf note:** if/when Page `content-perf` is retired, that belongs to the Content Pipeline consolidation PR and must add `content-perf -> content-pipeline?tab=published` through the route-removal checklist (`performance.json:317-322,403-409`). This ticket does not remove or redirect `content-perf`.

**Deferred-ledger rows to add in the surface PR** (copy the existing ledger shape; classes use the valid enum only: `token | primitive | behavior | data | a11y | perf | copy`):

```jsonc
{
  "id": "DEF-performance-001",
  "surface": "performance",
  "item": "Per-asset in-place Compress action from Page Weight asset rows",
  "decision": "Ship the Asset Manager deep-link sender only; defer in-place compression until the receiver and per-asset action contract are proven.",
  "class": "behavior",
  "upgradeTrigger": "Asset Manager exposes a verified asset-id/filter receiver plus a per-asset compression action contract.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "surface": "docs/ui-rebuild/phase-a/surfaces/performance.json:46-49,323-328",
    "receiver": "docs/ui-rebuild/phase-a/tickets/asset-manager.md:105-123"
  }
},
{
  "id": "DEF-performance-002",
  "surface": "performance",
  "item": "Per-opportunity Fix routing from PageSpeed opportunities",
  "decision": "Render the opportunities list with savings now; defer Fix buttons because destination ownership is undefined.",
  "class": "behavior",
  "upgradeTrigger": "A signed fix-target routing contract names the owning surface for each PageSpeed opportunity class.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "surface": "docs/ui-rebuild/phase-a/surfaces/performance.json:86-89,342-345"
  }
},
{
  "id": "DEF-performance-003",
  "surface": "performance",
  "item": "Lighthouse accessibility, best-practices, and SEO category bars",
  "decision": "Defer extra Lighthouse categories; ship the existing performance score and full Core Web Vitals parity first.",
  "class": "data",
  "upgradeTrigger": "SB-024 fetches and persists extra Lighthouse categories on the PageSpeed snapshot shape.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "backlog": "SB-024",
    "surface": "docs/ui-rebuild/phase-a/surfaces/performance.json:116-119,421-424",
    "server": "server/pagespeed.ts:59-64,224-228"
  }
},
{
  "id": "DEF-performance-004",
  "surface": "performance",
  "item": "Automatic content-win graduation to Insights Engine",
  "decision": "Defer the automatic insight write to the owner-signed C3 graduation seam; do not build an ad-hoc Performance-only endpoint.",
  "class": "behavior",
  "upgradeTrigger": "SB-001 lands the shared graduation write contract with InsightType registration, broadcast, activity log, and snapshot provenance.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "decision": "AD-004",
    "backlog": "SB-001",
    "surface": "docs/ui-rebuild/phase-a/surfaces/performance.json:201-204,293-298",
    "server": "server/routes/insights.ts:13-51"
  }
},
{
  "id": "DEF-performance-005",
  "surface": "performance",
  "item": "Engagement and impressions lift percent versus pre-publish baseline",
  "decision": "Do not fabricate lift percentages from the trailing 90-day read; defer until a real pre/post baseline derivation exists.",
  "class": "data",
  "upgradeTrigger": "SB-008 adds pre/post-publish GA4 and GSC window reads and serializes lift fields.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "backlog": "SB-008",
    "surface": "docs/ui-rebuild/phase-a/surfaces/performance.json:211-214,436-439",
    "server": "server/domains/content/content-performance.ts:216-249"
  }
}
```

### Gates before merge

`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Add flag-transition component coverage with a seeded `QueryClient`, static + runtime deep-link receiver tests, and a flag-ON browser smoke against a workspace with real page-weight, PageSpeed, GSC, and GA4 data.
