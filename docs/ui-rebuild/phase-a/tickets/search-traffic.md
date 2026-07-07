# Wave 2 BUILD TICKET — Search & Traffic (`analytics-hub`)

> **Lane:** A-lane (`ui-rebuild-shell`). **Wave:** W2. **Effort:** L (largest W2 surface — 4 lenses, ~50 capability rows, carried-over chart, full annotation CRUD, + one server field).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` → `CROSS_SURFACE_CONTRACTS.md` → `BUILD_CONVENTIONS.md` → `surfaces/search-traffic.json` → `phase0/surfaces/search-traffic.md` → this ticket.
> **Reference implementation:** the merged Keywords pilot `src/components/keywords-rebuilt/` (PR #1480/#1481). When this ticket and the pilot disagree, the pilot wins.
> **Route id note:** the `Page` union value is **`analytics-hub`** (`src/routes.ts:8`) — "search-traffic" is the surface/lane label only. The route id does NOT move (mirrors frozen-contract discipline; no D8 entry for this surface, see §7).

---

## 1. ⚠ OWNER DELTAS

**One delta — the rest adopt their `proposedDefault`.**

- **⚠ OQ1 (Overview tab) vs C-4 tension — surfaces a real scope call.** OQ1's `proposedDefault` (surface-doc, `search-traffic.json`) is **keep Overview as a 4th lens** (`useAnalyticsOverview.ts:59-104` already merges GSC+GA4; cutting it is a capability deletion with no named home → hard-floor violation per O1–O4). This is not overridden by any AD/C row, so the default holds and I adopt it: **build the Overview lens.** I flag it only because it is the single largest scope lever on this L-sized ticket (the merged dual-axis chart + cross-source toggle-card row O1/O2 are the heaviest UI in the surface) and it was a `needsOwner:true` question. **If the owner wants W2 trimmed, cutting Overview to narrative-header-only is the one high-leverage descope** — but it must be an explicit owner cut (route the O1–O4 rows to a named C3 follow-up), never a silent drop. Absent that instruction, Overview ships.

All other per-surface-dispatch decisions (AD-011, AD-022, AD-026, AD-030) and open questions (OQ2–OQ9 + the newly-found pageUrl question) adopt their proposedDefault — see the sections below. Notably OQ6/D5 is **overridden by C-3** (search-traffic KEEPS AnomalyAlerts — the surface-doc's "Home surface owns it" default is dead), and OQ2/OQ4/D4 defaults are constrained by C-4 / AD-004 / AD-030 respectively.

---

## 2. Capability checklist (acceptance criteria)

Every `ui-only` row in `surfaces/search-traffic.json` is an acceptance criterion. Grouped by lens. Row ids are the surface-JSON `capabilityClassification` keys (S/O/Q/G/A/I/D). Build Conventions cited as `BC §n`.

### 2.1 Shell (S-group) + AD-011 additive-parity floor
- [ ] **S1** — 4 sub-tabs via `LensSwitcher`: **Overview · Search Performance (GSC) · Site Traffic (GA4) · Annotations** (`composition.lensesOrTabs`). Overview included per §1.
- [ ] **S2** — re-bind keyboard shortcut `3` in the rebuilt shell keymap (ui-only; global keymap for `RebuiltAppChrome` — see `unknowns[1]`, UNVERIFIED that a keymap file exists yet; if none, note in PR and defer with a DEF-* row rather than inventing one).
- [ ] **S3** — `needsSite` nav gating renders a **locked state** (`navRegistry.tsx:119` `needsSite:true`); rebuild must show the locked/empty state, not a crash or fake data (BC §7 states plan).
- [ ] **S4** — if the rebuild adds `?tab=`, honor the two-halves contract (CLAUDE.md rule 12 / BC §7 URL-state). HEAD is `?tab=`-exempt; a separate `lens` param is preferred over overloading `tab` (BC §7, pilot review #1480). See §4.
- [ ] **S5** — page header + honest one-line subtitle via `PageHeader` (BC §7). Narrative headline is **delta-from-server** only (`SearchComparison.changePercent`, `shared/types/analytics.ts:47-52`) — **no client-composed verdict** (BC §2, AD-002 hard floor). If a narrative verdict string is wanted it must arrive as a server field; absent → honest-absence (BC §6).
- [ ] **AD-011 floor** — every prototype-dropped capability is carried into a Drawer/overflow, never deleted: GSC devices/countries/search-types + GA4 top-pages/countries land in the **Breakdowns Drawer** (OQ9 default, §2.4); full date-preset sets ship (OQ7). Export/breakdown drops are a hard-floor violation.

### 2.2 Overview lens (O-group) — build per §1
- [ ] **O1** — unified cross-source `MetricToggleCard` row (Clicks/Impressions/CTR/Position/Users/Sessions), each toggling its chart line (`AnalyticsOverview.tsx:41-92`). Toggle interaction rebuilt (Segmented/MetricTile + line-toggle).
- [ ] **O2** — merged GSC+GA4 dual-y-axis trend chart (data merge exists `useAnalyticsOverview.ts:59-104`). Uses the carried-over `AnnotatedTrendChart` (T1, §6).
- [ ] **O3** — integration-aware card/line pruning: GSC-only or GA4-only workspaces see only their metrics (reads existing `gscConfigured`/`ga4Configured` signals, `AnalyticsOverview.tsx:136-151`).
- [ ] **O4** — priority insight feed on Overview → **filtered reuse of live `InsightFeed` only** (C-4 / OQ2, §2.6).
- [ ] **O5** — delta chips vs previous period on every card, position-delta inverted (`search-comparison`+`analytics-comparison` verified `google.ts:311-322,405-415`).
- [ ] **O6** — **CTR delta now shown** (improvable-for-free: `SearchComparison.changePercent.ctr` already exists `shared/types/analytics.ts:47-52`); no fabricated delta where data is genuinely absent → em-dash (BC §7).
- [ ] **O7** — full date presets incl. 7d + 16mo (`ui/constants.ts:154-169`; OQ7 default = ship full set, prototype's 28d/90d/12m is a regression).
- [ ] **O8** — loading / no-integrations states (Skeleton + EmptyState, BC §7).

### 2.3 Search Performance lens (Q-group, GSC)
- [ ] **Q1** — GSC KPI cards (Clicks/Impressions/CTR/Position) with comparison deltas + **per-KPI sparklines (N5)** and rebuilt line-toggle. Sparklines render only from real series (BC §6 / AD-026, §3 SB-012).
- [ ] **Q2** — search trend chart (multi-line + annotations) — **ui-only for the multi-line/annotate half**; the **prior-period dashed overlay (N4) rides SB-012** (§3). Carried-over `AnnotatedTrendChart` (T1).
- [ ] **Q3** — ranking-drop callout bubbles pinned to insight `detectedAt` (off existing `ranking_mover` insights via `useInsightFeed`; rendered in the carried-over chart).
- [ ] **Q4** — queries⇄pages toggle (`Segmented`).
- [ ] **Q5** — sortable sticky-header `DataTable` (full `topQueries`/`topPages` already in `search-overview`). Self-carded DataTable — do NOT double-card (BC §7).
- [ ] **Q6** — insight badges on query/page rows (client-side join of `useInsightFeed` onto rows, as at `SearchDetail.tsx:37-61`) — filtered reuse, not a second feed home (C-4).
- [ ] **Q7** — CTR per row + CTR KPI (`avgCtr`/row ctr already in `SearchOverview`; restore despite prototype omission — additive-parity floor).
- [ ] **Q8** — external-link page rows + `normalizePageUrl` display (DataTable cell renderer).
- [ ] **Q9/Q10/Q11** — GSC devices / top-countries / search-types → **Breakdowns Drawer** (OQ9 default; endpoints verified `google.ts:271-309`). §2.4.
- [ ] **Q12** — domain-filtered insight feed on Search tab (C-4 filtered reuse, §2.6).
- [ ] **Q13** — GSC not-configured/error/loading states (GSC gates independently from GA4).
- [ ] **Q14** — full-row query text, no truncation (keep `truncateKeyword={false}` behavior or tooltip).

### 2.4 Site Traffic lens (G-group, GA4) + Breakdowns Drawer
- [ ] **G1** — GA4 KPI cards (users/sessions/bounce/duration) with toggles rebuilt.
- [ ] **G2** — traffic trend chart incl. **pageviews line** + annotate (carried-over chart; HEAD trend already carries pageviews).
- [ ] **G3** — exact date-range readout + full presets (`DATE_PRESETS_FULL`, `constants.ts`).
- [ ] **G4** — domain-filtered insight feed on Traffic tab (C-4 filtered reuse).
- [ ] **G5** — Growth Signals card (`KeyValueRow`/`MetricTile` from analytics-comparison payload).
- [ ] **G6** — Engagement Analysis card (keep top-page + organic engagement comparisons).
- [ ] **G7** — **Organic vs All Traffic card — HARD KEEP** (core agency proof metric; `analytics-organic` verified `google.ts:429-439`).
- [ ] **G8** — Top Pages (all pageviews) table alongside landing pages (`analytics-top-pages`, `google.ts:332-473`).
- [ ] **G9** — Traffic Sources with `Meter` share bars.
- [ ] **G10** — GA4 Devices (`analytics-devices` verified `google.ts:380-391`).
- [ ] **G11** — GA4 Top Countries → **Breakdowns Drawer** (`analytics-countries` verified `google.ts:393-403`).
- [ ] **G12** — New vs Returning segments (`analytics-new-vs-returning` verified `google.ts:417-427`).
- [ ] **G13** — Events & Conversions + landing pages table; **keep per-row users column** (additive parity vs prototype).
- [ ] **G14** — GA4 error-with-Retry / empty states (React Query invalidate).
- [ ] **Breakdowns Drawer (OQ9 default)** — one F3 `Drawer` per detail lens holding the omitted-in-prototype cards (Q9/Q10/Q11, G8/G11). Preserves parity without cluttering the prototype layout. Endpoints all verified; a silent cut is an AD-011 hard-floor violation.

### 2.5 Annotations lens (A-group) + chart layer
- [ ] **A1** — **full annotation CRUD UI** (create/edit/delete + hover-reveal) — NOT the prototype's toast stub. GET/POST/PATCH/DELETE verified in `google.ts` annotations section.
- [ ] **A2** — category filter pills + newest-first sort + count badge (`FilterChip`, client-side filter as at HEAD).
- [ ] **A3** — click-chart-to-annotate popover (signature interaction — carry over `AnnotatedTrendChart`, T1, so it ships same phase; a static chart is a **parity failure**).
- [ ] **A4** — annotation markers + hover tooltip (preserved in carried-over chart).
- [ ] **A5** — shared category color system — **OQ8 default: keep HEAD teal/brand palette; translate the prototype's purple `campaign` color at port time.** Purple is admin-AI-only under the Four Laws; a purple campaign marker is a color-law violation. Use the `--anno-*` annotation-color tokens (CLAUDE.md token category "Annotation colors"; UNVERIFIED exact token names — confirm in `src/tokens.css` at build time, do not hardcode hex).
- [ ] **A6** — re-wire the `ANNOTATION_BRIDGE_CREATED` `useWorkspaceEvents` receiver (server half FROZEN, §6). Invalidate the annotation query key.
- [ ] **A7** — public + intelligence annotation consumers untouched (backend frozen, §6). **Newly-found default = YES: expose the optional `pageUrl` field in the create/edit form** (API + slices already accept it; trivial cost, closes the form-less gap).
- [ ] **A8** — server-side annotation query filtering capability survives (`getAnnotations({startDate,endDate,category})`) regardless of the client-side filter UI choice.

### 2.6 Insight feed (I-group) — C-4 CONSTRAINED
- [ ] **I1–I6** — **domain-filtered reuse of the live `InsightFeed` component only** (OQ2 default + C-4). Search-traffic renders *domain-filtered windows* (search/traffic) reusing the live component unstyled; it MUST NOT re-implement the 20+ typed insight renderers or claim the 21-type feed home — that home is the **engine** surface (C-4). I2 severity pills / I3 domain chips / I4 expandable details are the reused component's own affordances.
- [ ] **I5** — Run Deep Diagnostic CTA + `?report=` deep-link → **keep pointing at the existing Diagnostics page unchanged** (C-7 / AD-022 default; nav entry + reports-list lens preserved by the global-ops/diagnostics owner). See §4.
- [ ] **I6** — impact sort + stale-time + WS invalidation re-registered against the `insightFeed` query key.

### 2.7 Data layer (D-group) — must survive
- [ ] **D1/D2/D3** — all 6 GSC + 11 GA4 endpoints and all 5 React Query hooks composed unchanged (`google.ts:245-473`; `useAdminSearch`/`useAdminGA4`/`useAnalyticsOverview`/`useAnalyticsAnnotations`/`useInsightFeed` all verified present). `avgCtr` is already a percentage — do NOT re-multiply (BC §5).
- [ ] **D4** — dormant GSC chat wrapper → **AD-030 cleanup: delete the `gscAdmin.chat` API wrapper** (`src/api/analytics.ts:148-149`, verified; zero component callers). Keep the server op until a deliberate server-side removal PR (public portal uses a separate route). See §5/§6.
- [ ] **D5** — AnomalyAlerts → **C-3: KEEP the full actionable panel here** (§2.8).
- [ ] **D6** — `ChartPointDetail` is orphaned/unmounted at HEAD — nothing to rebuild (ledger overclaims). Note only.

### 2.8 AnomalyAlerts (C-3 — RATIFIED, do not drop)
- [ ] Mount the **full `AnomalyAlerts` panel** on Search & Traffic with **ack / dismiss / scan** actions (not display-only) — `POST /api/anomalies/scan` verified `server/routes/anomalies.ts:63`. HEAD mounts it at `WorkspaceHome.tsx:614`; C-3 moves ownership here. The cockpit consumes via a **hand-off card that deep-links in** and mounts NO second actionable copy. Record the hand-off so neither surface drops it.

### 2.9 Adopted new features (kitNewFeatures)
- [ ] **N4** prior-period comparison line — adopt, via SB-012 (§3).
- [ ] **N5** per-KPI sparklines — adopt (zero server work; honest-absence per BC §6).
- [ ] **N6** strategy-keyword "fav" dot on query rows — adopt (client-side set-membership join against `GET /api/webflow/keyword-strategy/:workspaceId/keyword-set`, `keyword-strategy.ts:775`; no new server work).
- [ ] **N1** book roll-up, **N2** rank movers, **N3** graduation bridge, **N7** full explorer — **DEFER** (§3, §5). N2 ships as a link-out to Keyword Hub now (not an embedded second rank-data source — forbidden per `docs/rules/keyword-hub.md`).

---

## 3. Server tickets — RIDE vs DEFER

Consume the **VERIFIER-adjusted** homes/efforts (`server-backlog.json` + `surfaces/search-traffic.json` `verify.verdicts`), never the gatherer originals.

### RIDES in this PR
| SB / sn | What | Verifier-adjusted home + effort | Why it rides W2 |
|---|---|---|---|
| **SB-012** (was `sn-search-traffic-1`) | GSC prior-period dated trend series for the N4 dashed overlay | **~1-line route param thread** in `server/routes/google.ts:258-270` (thread `startDate`/`endDate`/offset → the existing `dateRange`-capable `fetchPerformanceTrend` at `analytics-data.ts:27-33`; `getPreviousGscWindow` at `search-console.ts:721` already exists). **Effort S.** NOT a fetcher extension (verifier ADJUSTED sn-search-traffic-1). | N4 (Q2 dashed overlay) is adopted-in-rebuild; the client requests the prior window. Client-side 2× fetch-and-split is the zero-server fallback if the route thread slips. |
| **sn-ai-visibility-6** = **SB-055** (branded vs non-branded demand split) | **C-2 (owner OVERRIDE): search-traffic OWNS the server computation + the canonical field.** Build the GA4/GSC branded/non-branded split derivation + canonical read HERE, W2. | **Home: search/keyword domain alongside the GSC read paths (NOT ai-visibility routes)** — `server-backlog.json` SB-055 notes + C-2. **Effort M.** | Data locality (branded/non-branded is a GSC query-data metric whose source already assembles in the S&T context) + wave order: W2 computes it a wave before ai-visibility W3 renders it. ai-visibility reads/displays only (builds no duplicate split). This **inverts the surface doc** — bake it in, do not re-litigate. This ticket is a *producer*; ai-visibility is the downstream *consumer*. |

> **C-2 build note:** ownership of the field ≠ where it is shown. This ticket ships the SERVER field + canonical read + (optionally) a minimal S&T display of the split; ai-visibility's W3 ticket renders the richer view. Register the metric server-computed per **AD-016** (score authority — no second client heuristic). Confirm the exact denominator (branded ÷ all demand) in the field's JSDoc.

### DEFERS (with DEF-* ledger rows — AD-004 graduation writes ALWAYS defer)
| SB / sn | Why deferred | Ledger action |
|---|---|---|
| **SB-061** (was `sn-search-traffic-3`) / **SB-001** graduation seam — N3 "stage wins as proof" | **AD-004: all graduation bridges deferred wholesale to one C3-era owner-signed cross-surface contract.** No surface builds an ad-hoc graduation write. Verifier CONFIRMED `existsToday=no` (proof-point contract is mockup-only, `lexicon.ts:497,521` `proposed`-class). Effort M/L (persisted ledger row → DB-column+mapper lockstep). | `DEF-search-traffic-00X` — N3 graduation bridge, class `deferred-cross-surface`, `upgradeTrigger` = C3 graduation contract signed, links to AD-004 + SB-001/SB-061. |
| **SB-013** (was `sn-search-traffic-2`) — N1 cross-workspace GSC book roll-up | Verifier CONFIRMED `existsToday=no` (every GSC endpoint is per-site behind `requireWorkspaceSiteAccessFromQuery`). Overlaps global-ops cross-workspace scope; deferring loses nothing at HEAD. Effort M (net-new module). | `DEF-search-traffic-00Y` — N1 book roll-up, class `deferred-new-feature`, `upgradeTrigger` = global-ops cross-workspace wave, links to SB-013. |
| **N2** rank movers (embedded) | Must consume Keyword Hub's rank read path (`docs/rules/keyword-hub.md`); embedding without the shared read path = a forbidden second rank-data source. Ships as a **link-out** now. | `DEF-search-traffic-00Z` — N2 embedded movers, class `deferred-new-feature`, `upgradeTrigger` = shared Keyword-Hub rank read path. |
| **N7** full queries/pages explorer | Stub in prototype; HEAD shows the full list scrollably, so parity holds. | Optional DEF-* row if any prototype affordance is visibly stubbed; else note-only. |

> Every quick-win trade-off shipped also needs its own `DEF-*` row (BC §7 gates + ledger). Copy an existing entry (e.g. `DEF-foundation-001`); `npm run verify:deferred-ledger` enforces schema/expiry/roadmap links.

---

## 4. Deep-link receiver matrix → contract-test assertions

Each surviving sender/receiver becomes an assertion in `tests/contract/tab-deep-link-wiring.test.ts` (static) **and** a runtime receiver test (BC §8).

| Sender | Param | Receiver / destination | Disposition | Test assertion |
|---|---|---|---|---|
| I5 "Run Deep Diagnostic" CTA (`InsightFeedItem.tsx:17-68,112-116`) | `?report=<id>` | Diagnostics page (unchanged) | **KEEP** (C-7/AD-022). CTA + `?report=` still point at the existing diagnostics page. | Assert the CTA still emits `?report=` and the Diagnostics receiver reads it (owned by the diagnostics/global-ops surface — coordinate; this ticket only keeps the *sender* live). |
| S4 lens navigation (new) | `?lens=` (if added) | this surface's `LensSwitcher` | **Two-halves contract** (CLAUDE.md rule 12 / BC §7). Prefer a dedicated `lens` param; do NOT overload the shared `tab` param (pilot review #1480). | Runtime test renders `/ws/:id/analytics-hub?lens=search` (etc.) and asserts the correct lens mounts; static test wires sender↔receiver. |
| HEAD `?tab=`-exempt (S4) | — | AnalyticsHub JS state | HEAD had no `?tab=`; if none added, nothing to assert beyond default-lens render. | Runtime test: default URL → Overview (or first) lens. |
| N2 rank-movers link-out | (route to Keyword Hub) | Keyword Hub surface | Link-out only (no embedded panel). | Assert the link targets the Keyword Hub route, not a local rank read. |

> If this surface adds any `?lens=`/`?report=` sender, the static contract test + a fully-loaded runtime deep-link receiver test are BOTH required (BC §8) — copy the pilot's `KeywordsSurface.test.tsx:516` fully-loaded-URL pattern.

---

## 5. Flag disposition (AD-006 mapping)

- **This surface rides the A-lane `ui-rebuild-shell` flag** (operator/admin surface; `shared/types/feature-flags.ts:120,460`). Mount is in-place behind the flag with `@ds-rebuilt` markers — one line in `REBUILT_SURFACES` (§6).
- **Retires NO flag.** Per AD-006, no surface retires a flag outside the enumerated mapping. Search & Traffic touches no UI-shell-retirement flag of its own and no backend/tier/phase gate (`local-gbp`, `gbp-auth-*`, `strategy-the-issue`, `strategy-competitor-send`, `the-issue-client-*` are lifecycle-governed and untouched here).
- **D4 dead-code (AD-030):** deleting the `gscAdmin.chat` **API wrapper** is a code deletion, **not a flag retirement** — no flag involved. The server op stays until a deliberate server-side removal PR.
- **C-2 branded/non-branded field:** shipped as a plain server field, not behind a new feature flag (it is data the ai-visibility W3 consumer needs regardless). If the owner wants it dark-launched, add a backend gate via the flag-lifecycle process — do not invent one in this ticket.

---

## 6. File ownership

**CREATES (this ticket owns exclusively):**
- `src/components/search-traffic-rebuilt/**` — the new surface dir (skeleton mirrors `keywords-rebuilt/`: `SearchTrafficSurface.tsx` page shell, per-lens components, `SearchTrafficTable`-style DataTables, the Breakdowns `Drawer`, annotation CRUD panel, URL-state hook `useSearchTrafficSurfaceState.ts`, mutation-feedback module). Every file carries the `// @ds-rebuilt` first-line marker (opts into the 7 pr-check gates, BC §7).
- One-line entry in `src/components/layout/rebuiltSurfaces.ts` `REBUILT_SURFACES` keyed by `'analytics-hub'` (`lazyWithRetry(() => import('../search-traffic-rebuilt/SearchTrafficSurface')...)`, uniform `{ workspaceId }` props). **Never a new `App.tsx` branch.**
- Tests: `tests/component/search-traffic-rebuilt/*` (flag-transition test with **seeded QueryClient — do NOT mock `useFeatureFlag`**, BC §8; a11y-floor assertion) + the deep-link runtime receiver test + additions to `tests/contract/tab-deep-link-wiring.test.ts`.
- The SB-012 route param thread + the **SB-055/sn-ai-visibility-6 branded/non-branded server field** (search/keyword GSC domain — this ticket is the C-2 producer).
- `DEF-*` rows in `data/ui-rebuild-deferred-ledger.json` for §3 defers.

**COMPOSES unchanged (reads, does not rewrite):**
- Hooks `useAdminSearch` / `useAdminGA4` / `useAnalyticsOverview` / `useAnalyticsAnnotations` / `useInsightFeed` (all verified present).
- The live `InsightFeed` component (C-4 filtered reuse — do NOT fork or re-implement typed renderers).
- `AnnotatedTrendChart` — **T1 carry-over-then-reskin** (token-restyle the real chart; keep click-to-annotate, line toggles, callouts). A static chart is a parity failure (AD-010 / A3/Q3).
- The `AnomalyAlerts` component (C-3 — mount with full ack/dismiss/scan).

**MUST NOT TOUCH (frozen / other lanes):**
- **FROZEN (CROSS_SURFACE_CONTRACTS §Frozen 10):** the annotations bridge (`ANNOTATION_BRIDGE_CREATED`) and public annotations read `GET /api/public/annotations/:workspaceId` (`server/routes/annotations.ts:16`). Re-wire only the frontend `useWorkspaceEvents` *receiver* half.
- **C-lane paths:** any client-facing render (this is the A-lane operator surface; client halves ride C-lane per AD-005).
- **engine surface:** the 21-type insight feed home (C-4). Do not claim it.
- **cockpit surface:** the AnomalyAlerts hand-off *card* is cockpit-owned; this ticket owns only the actionable panel (C-3).
- **ai-visibility surface:** the *display* of the branded/non-branded split is ai-visibility's W3 work; this ticket ships only the field + canonical read (C-2).
- **Diagnostics/global-ops:** the Diagnostics page + reports-list lens (C-7/AD-022) — this ticket only keeps the `?report=` sender pointing at it.
- The **route id `analytics-hub`** must not change (§7).
- The GSC chat **server op** (only the client wrapper is deleted, D4/§5).

---

## 7. D8 redirect-map entries

**None.** The `Page` route id stays `analytics-hub` (`src/routes.ts:8`) — no route/tab move, so no `D8_REDIRECT_MAP.md` entry is added by this ticket. (The only search-traffic-adjacent D8 rows are the already-executed Meeting-Brief retirements `brief → home` and `home?tab=meeting-brief → home` at W0.3 — `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md:7-8` — which are C-8's, not this ticket's.) If the rebuild later introduces a `?lens=` scheme replacing a prior URL shape, add the mapping in the same PR; none exists at HEAD (S4 is `?tab=`-exempt).
