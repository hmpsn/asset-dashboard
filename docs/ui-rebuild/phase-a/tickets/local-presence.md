# Wave 2 Build Ticket — Local Presence (`local-seo`)

> **Surface:** `local-presence` · **Route id (FROZEN):** `local-seo` · **Wave:** W2 · **Effort:** L
> **Read order (LAW):** `PHASE_A_DECISIONS.md` → `CROSS_SURFACE_CONTRACTS.md` → `BUILD_CONVENTIONS.md` → `surfaces/local-presence.json` (verifier-adjusted) → this ticket.
> **Reference implementation:** the merged Keywords pilot `src/components/keywords-rebuilt/` (PR #1480 + #1481). When this ticket and the pilot disagree on structure, the pilot wins.
> **Grounding:** every claim below is anchored to file:line or a JSON row. `UNVERIFIED` marks anything not confirmed against code in this pass.

---

## 1. ⚠ OWNER DELTAS

**None — all per-surface-dispatch proposedDefaults adopted.**

The local-presence surface carried ~9 `needsOwner` open questions (surface JSON `openQuestions` OQ1–OQ8 + the flag question). Every one was resolved by a ratified owner decision (AD-024, AD-025, AD-029) or a frozen contract (CROSS_SURFACE_CONTRACTS items 4–5), so this ticket adopts the defaults verbatim with no deviation to escalate:

| OQ | proposedDefault adopted | Ratified by |
|----|-------------------------|-------------|
| OQ1 geo-grid | Defer (DEF row); ship markets×keywords posture grid on real data | AD-025 |
| OQ2 GBP Performance | Cut from hero; show rating + reviews + completeness (all real) | AD-025 (SB-058 defer) |
| OQ3 Visibility-tab home | Keep a Visibility lens restyled with F3 primitives (additive-parity floor) | AD-011 |
| OQ4 Verified badge | Keep suppressed — provider can't report unclaimed listings | AD-025 |
| OQ5 auth review-sync placement | Reviews-lens pipeline header block (Sync + per-location chips + policy footer) | surface default (no owner conflict) |
| OQ6 manual refresh | Keep both manual triggers; scheduled refresh is a separate cron decision | AD-001 |
| OQ7 declined/cancelled + Reopen | Render declined/cancelled (mandatory); defer Reopen (SB-018 / sn-local-presence-7) | AD-024 |
| OQ8 `?tab=` mapping | Keep 4 receiver-recognized values; alias collapsed lenses per D8 | frozen contract 5 + D8 |
| flags question | Keep all 4 GBP flags (backend/tier/phase-governed) | AD-006 |

> If a build agent finds a proposedDefault that cannot be honored on real data (e.g. a "real" field turns out fabricated), STOP and escalate — do not silently downgrade. Fabricating grid/metric data violates the honest-absence hard floor (BUILD_CONVENTIONS §6).

---

## 2. Capability checklist

Source rows: `phase0/surfaces/local-presence.md` §1 (rows 1–48, N1–N10) + surface JSON `capabilityClassification`. Disposition legend: **BUILD** = ships in this W2 PR on real data · **CARRY (T1)** = token-restyled drill-in, machinery reused not redesigned (AD-010) · **DEFER** = DEF row + rides an SB backlog item · **SUPPRESS** = deliberately not rendered · **UNCHANGED** = server/shared plumbing untouched by this UI rebuild.

### 2.1 Shell / tabs / deep links / states
- [ ] **BUILD** Row 1 — dedicated Local Presence page under Strategy nav (`routes.ts:7`, `navRegistry.tsx:141`). Label may render "Local Presence"; **route id `local-seo` FROZEN** (contract 5).
- [ ] **BUILD** Row 2 — `?tab=` receiver wiring for the 4 legacy values `overview|visibility|reviews|setup` (two-halves contract, `LocalPresencePage.tsx:16-27`). Keep receiver `useSearchParams` + validating type-guard (BUILD_CONVENTIONS §7 URL state). Use a separate `lens` param for the surface's own lens; do **not** overload `tab` (pilot review finding). Collapsed lenses alias per D8 (OQ8).
- [ ] **BUILD** Rows 7, 13, 31, 35, 48 — Skeleton / not-configured EmptyState (Open-setup CTA) / first-load ErrorState-with-retry rendered **before** the flag check / flag-OFF renders-nothing (empty server payload, not 404) / 403 tier + 404 flag + 409 conflict surfaced as error bands. `statesPlan` in surface JSON is the contract.

### 2.2 Overview lens (hero GBP card + operating-status + share-of-voice + reviews mini-strip)
- [ ] **BUILD** Row 3 — overview stat cards (Markets / Checked / Visible / flag-dependent 4th) recomposed as `MetricTile`s from `LocalSeoReadResponse.report` (server-computed; §5 score authority).
- [ ] **BUILD** Row 4 — Local operating status card: posture badge + `setupLabel`/`setupDetail` + market chips (`shared/types/local-seo.ts:532-535`). Prototype has no home; give it one in Overview.
- [ ] **BUILD** Row 5 / N5 — reviews-vs-competitors → **map-pack share-of-voice table** with a **% column** (rides SB-019a / sn-local-presence-3, §2.3 server tickets).
- [ ] **BUILD** Row 27 — GBP aggregate readout (own rating/review-count vs top competitor, review-gap sentence). Never invent 0★ (`GbpReviewsPanel.tsx:19-24,131-163`; aggregates-only, no per-review PII).
- [ ] **BUILD** Row 28 / N4 (quick-win) — GBP completeness score /100 → `Meter`, with the **3 real completeness signals** (photos/attributes/category) rendered as the profile-health checklist. Fix CTAs must not dead-end. Full checklist ingestion **DEFER** (SB-056 / sn-local-presence-8).
- [ ] **SUPPRESS** Row 30 / N3 — Verified badge stays suppressed (AD-025; `GbpReviewsPanel.tsx:44-47`). Provider defaults `is_claimed=true`; badge would lie.
- [ ] **DEFER** N2 — profile views + calls/directions hero metrics (SB-058 / sn-local-presence-2). Cut from hero until the Google scope ships.

### 2.3 Visibility lens (posture grid, trends, repeat competitors + Track, manual Refresh)
- [ ] **BUILD** Row 8 — 5-posture visibility grid (`visible|possible_match|not_visible|local_pack_present|provider_degraded`, `LocalSeoVisibilityPanel.tsx:24-30,197-220`) restyled with `MetricTile`s. This is the **markets×keywords posture grid** shipping in place of the geo-grid.
- [ ] **DEFER** N1 — 49-point geo-grid rank map (SB-057 / sn-local-presence-1). No data source exists (verified: no `geo_grid` table/code). DEF row required.
- [ ] **BUILD** Row 9 — setup-state callout (`has_data|ready_no_data|needs_market|non_local`) incl. the **"Keyword and ranking data were not changed"** safety copy — carry verbatim (`LocalSeoVisibilityPanel.tsx:156-195`).
- [ ] **BUILD** Row 10 — manual visibility Refresh (job-aware via `useBackgroundTasks.findActiveJob`, disabled unless active market + local posture; `POST /refresh`, `server/routes/local-seo.ts:225-250`). Honest copy per BUILD_CONVENTIONS §1 (Re-scan, not Sync/Live). AD-001.
- [ ] **BUILD** Row 11 — per-market visibility trend `Sparkline`s (`LocalSeoVisibilityTrendSeries`, `shared/types/local-seo.ts:566-570`). Honest-absence: series from real snapshots only, paired caption (BUILD_CONVENTIONS §6). Never pad.
- [ ] **BUILD** Row 12 — repeat competitors → `DataTable` with one-click **Track** row action (`LocalSeoRepeatCompetitor` :537, `useRankTrackingAddKeyword`; per-keyword pending/tracked/error state).
- [ ] **BUILD (AD-011 carry)** Row 26 — refresh API extras (`keywords[]`, `device`, `languageCode`, `thenRegenerateStrategy`, `strategyGeneration` chaining, `local-seo.ts:93-112`) are API-only and consumed by Strategy regen + MCP. Rewiring the Refresh button must **not** drop these; server contract UNCHANGED.

### 2.4 Reviews lens (funnel + desk filters + response pipeline + auth sync)
- [ ] **BUILD** N6 — reviews pipeline funnel + desk filters (On-your-desk / With-client / Published / All) via `Segmented`/`FilterChip`. Pure re-presentation of existing statuses.
- [ ] **BUILD (mandatory)** Row 37 / OQ7 — render **all** lifecycle stages **including `declined` and `cancelled`** (all 9 in `GBP_REVIEW_RESPONSE_TRANSITIONS`, `state-machines.ts:172-186`). Prototype omitted 2; rebuild must render them. **AD-024.**
- [ ] **BUILD** Rows 36, 38–41 — draft/edit/send-to-client/approve-&-publish/retry/policy-footer (hooks + routes verified `useGoogleBusinessProfile.ts:114-173`, `google-business-profile.ts:289-448`). Admin AI actions (draft/rewrite) may use purple (admin surface; Four Laws Law 4).
- [ ] **BUILD** N9 — Rewrite-with-AI (exists via `upsertGbpReviewResponseDraft`, `google-business-profile.ts:303`) + **Write-manually** + **Draft-and-send** (new additive routes; SB-018 / sn-local-presence-6). AD-024 adopts N9.
- [ ] **BUILD** Row 34 / OQ5 — authenticated review-sync block: Sync trigger (disabled unless connected + mapped), per-location sync health (synced/partial/failed + `lastError`), aggregate stats, copy-policy footer. Placement = **Reviews-lens pipeline header block** (surface default). Failures stay visible (`google-business-profile.ts:207-274`).
- [ ] **BUILD** Rows 32–33 — GBP OAuth connect/disconnect **connection-health chip** + mapping-status chip (additive; `google-business-profile.ts:140-205,449-499`). The Workspace-Settings `GbpConnectionCard` **survives** in the Settings surface (cross-surface dep; do not delete).
- [ ] **DEFER** N7 — Nudge-client reminder (SB-014 — REUSE `POST /api/deliverables/:ws/:id/remind`; only a per-target rate-limit is net-new). Ledger note: not a fabrication risk, so it may ride W2 if the rate-limit lands; otherwise DEF row. See §3.
- [ ] **DEFER** N8 — View-on-Google link (SB-018 / sn-local-presence-5 — no maps URL persisted; DB-column lockstep). DEF row.
- [ ] **DEFER** N10 — Reopen-for-edits (SB-018 / sn-local-presence-7 — `approved→draft` **illegal today**, `state-machines.ts:172-186`; needs separate state-machine sign-off). **AD-024.** DEF row.

### 2.5 Setup lens (drawer launcher)
- [ ] **CARRY (T1)** Rows 15–25 — `LocalSeoMarketSetupDrawer` mounts as a **token-restyled `Drawer` drill-in** (AD-010): posture select + reasons, service gaps + copy-keywords, suggested markets, market CRUD (max-3-active), DataForSEO provider match/candidates/advanced identity, set-primary, budget override + live cost math, validation, Save vs Save-and-refresh, focus-trap/Escape/dirty-state resync. Near-1:1 prototype parity; **reuse the machinery, reskin the shell — never redesign in Phase A.** Server contract `local-seo.ts:71-118,195-250` UNCHANGED.
- [ ] **BUILD (link only)** Rows 6, 22 — Setup entry points + business-locations shortcut → Brand & AI (`?tab=business-footprint&focus=locations-section`). Locations **editor** stays in Brand & AI; this surface only links/status.

### 2.6 Plumbing that must survive (UNCHANGED — do not reshape)
- [ ] **UNCHANGED** Row 14 — shared `LocalSeoVisibilityPanel` + `LocalSeoVisibilityBadge` mounts (Strategy / Keyword Hub / Page Intelligence). **Props FROZEN** (contract 4); do not delete or reshape.
- [ ] **UNCHANGED** Rows 42–47 — locations CRUD API, background jobs (`local-seo-refresh`, `-location-backfill`, `local-gbp-refresh`, `gbp-review-reply-publish`), WS events + invalidation (both broadcast halves), insights/intelligence integration (`LocalSeoSlice`, `local_visibility_shift` bridge), MCP `start_local_seo_refresh` + job-dashboard link to `/local-seo`.

---

## 3. Server tickets (ride vs defer)

| SB / sn id | Title | Effort | Disposition | Rationale |
|-----------|-------|--------|-------------|-----------|
| **SB-019a** (sn-local-presence-3) | Map-pack share-of-voice % on `LocalSeoRepeatCompetitor` | S | **RIDE W2** | Pure in-memory reduction in `getLocalSeoCompetitorBrands` (`server/domains/local-seo/visibility-read-model.ts:28-100`); computed type, **no migration** (verifier CONFIRMED). Cheapest new item; unlocks the SoV % column (Row 5 / N5). Server-computed → satisfies §5 score authority. |
| **SB-014** (sn-local-presence-4) | Generic client-nudge rate-limit | S | **RIDE W2 (or DEF if rate-limit slips)** | Email/broadcast/activity halves **already exist** — `POST /api/deliverables/:ws/:id/remind` → `remindDeliverable()` already covers awaiting_client GBP deliverables (verifier ADJUSTED). Only net-new = per-target throttle. Small; ride if it lands, else DEF-local-presence-004 with SB-014. |
| **SB-018** (sn-local-presence-5, -6, -7) | GBP review-response authoring/lifecycle extensions | M | **SPLIT** | -6 (manual-create + draft-and-send, S) **RIDE W2** — additive routes, no migration, powers N9. -5 (persist review/maps URL, S, DB-column lockstep) **DEFER** → DEF-local-presence-002 (N8). -7 (reopen transitions `approved→draft`, S) **DEFER** → DEF-local-presence-003 (N10; needs state-machine sign-off, AD-024). |
| **SB-057** (sn-local-presence-1) | 49-point geo-grid scan (job + table + projection) | L | **DEFER** | AD-025. No data source; new paid scan job + snapshot table + migration. DEF-local-presence-001. Ship posture grid instead (Row 8). |
| **SB-058** (sn-local-presence-2) | GBP Performance API ingestion (views/calls/directions) | L | **DEFER** | AD-025. New Google OAuth scope + client method + storage; GBP client has no performance method today (verifier CONFIRMED). DEF-local-presence-005. Cut hero metrics (N2). |
| **SB-056** (sn-local-presence-8) | Extended GBP profile ingestion (hours/products/Q&A/service-area) + fix flows | L | **DEFER** | `priority: later`. Only photos/attributes/category captured today (verifier CONFIRMED). DEF-local-presence-006 (N4 full). Ship the 3-signal checklist now. |

**RIDE W2:** SB-019a, SB-018-6, (SB-014 conditional).  **DEFER:** SB-057, SB-058, SB-056, SB-018-5, SB-018-7.

---

## 4. Deep-link receiver matrix

Two-halves contract (CLAUDE.md UI rule 12; BUILD_CONVENTIONS §7). Static contract test `tests/contract/tab-deep-link-wiring.test.ts` **must stay green**; add a runtime receiver test (per BUILD_CONVENTIONS §8) rendering the surface at a fully-loaded deep-link URL and asserting every param landed, incl. legacy aliases.

| Inbound param (sender) | Receiver behavior in rebuilt surface | Notes |
|------------------------|--------------------------------------|-------|
| `?tab=overview` | Overview lens (or alias → `presence` per D8 if lenses collapse to 3) | Legacy; overview historically strips the param — preserve or 301-alias via D8 |
| `?tab=visibility` | Visibility lens | Legacy value; **must** remain receiver-recognized (OQ8 default) |
| `?tab=reviews` | Reviews lens | Legacy value |
| `?tab=setup` | Opens the reskinned `LocalSeoMarketSetupDrawer` (Setup lens) | Legacy value; drawer launcher |
| `?tab=business-footprint&focus=locations-section` | **Outbound** to Brand & AI (rows 6, 22) — this surface is the sender | Locations editor lives in Brand & AI; do not receive here |
| own-lens param | Use a **separate `lens` param**, not `tab` | Pilot review finding: overloading `tab` silently drops inbound filter deep-links |
| MCP `start_local_seo_refresh` job link → `/local-seo` | Route id must resolve unchanged | Row 47; **route id FROZEN** (contract 5) |

D8: any lens consolidation seeds `D8_REDIRECT_MAP.md` with the alias (e.g. `overview → presence`) so existing `?tab=` bookmarks resolve.

---

## 5. Flag disposition

Per **AD-006** — enumerate, retire nothing outside the flag-lifecycle process. All four GBP/local flags are **backend/tier/phase gates → stay BACKEND-lifecycle-governed. This rebuild retires NONE of them.**

| Flag | Kind | Disposition | Evidence |
|------|------|-------------|----------|
| `local-gbp` | Paid Growth+ / tier gate | **KEEP** — lifecycle-governed | `shared/types/feature-flags.ts:40-53,472`; gate `LocalPresencePage.tsx:181,217-225` |
| `gbp-auth-connection` | Backend phase (2A) gate | **KEEP** — lifecycle-governed | `feature-flags.ts:243-251` |
| `gbp-auth-reviews` | Backend phase (2B) gate | **KEEP** — lifecycle-governed | `feature-flags.ts:243-251` |
| `gbp-review-responses` | Backend phase (2C) gate | **KEEP** — lifecycle-governed | `feature-flags.ts:243-251` |

The rebuilt surface itself mounts behind the A-lane **`ui-rebuild-shell`** flag (via `REBUILT_SURFACES`); that is the shell-lane flag, orthogonal to the 4 above. Flag-OFF for any GBP flag ⇒ server returns an **empty payload** and the block renders nothing (Row 31) — never a 404 crash.

---

## 6. File ownership

**Owns (create/edit freely):**
- `src/components/local-presence-rebuilt/**` — new surface dir, every file `// @ds-rebuilt` header (7 gates). Follow the pilot skeleton: `LocalPresenceSurface.tsx` (PageHeader → Toolbar w/ LensSwitcher+SearchField+ToolbarSpacer+Refresh+freshness-meta → FilterChip row → MetricTiles → lens content), lens components, `LocalPresenceReviewsPipeline`, reviews `DataTable`, market-setup `Drawer` wrapper (T1 carry-over of `LocalSeoMarketSetupDrawer`), `useLocalPresenceSurfaceState.ts` (URL state), `localPresenceMutationFeedback.ts` (re-export `mutationErrorMessage`, do not fork).
- `src/components/layout/rebuiltSurfaces.ts` — **one-line** `REBUILT_SURFACES` entry keyed by `Page` `'local-seo'`: `lazyWithRetry(() => import('../local-presence-rebuilt/LocalPresenceSurface').then(m => ({ default: m.LocalPresenceSurface })))`. No new `App.tsx` branch.
- `data/ui-rebuild-deferred-ledger.json` — the DEF rows in §7 (same PR).
- `tests/component/local-presence-rebuilt/**` — flag-transition test (seeded QueryClient, real `useFeatureFlag`, a11y floor) + runtime deep-link receiver test.
- New hooks only if a rebuilt-surface-specific view hook is needed; prefer reusing the existing `useLocalSeo` / `useGoogleBusinessProfile` hook families (surface JSON `dataHooks`).
- Server (if RIDE items land): `server/domains/local-seo/visibility-read-model.ts` + `shared/types/local-seo.ts` (SB-019a); `server/routes/google-business-profile.ts` + `google-business-profile-review-responses-store.ts` (SB-018-6); `server/routes/deliverables.ts` rate-limit (SB-014, coordinate — shared consumer).

**MUST NOT touch:**
- `src/components/local-seo/LocalSeoVisibilityPanel.tsx` **props** — FROZEN (contract 4; consumed by `PageIntelligence.tsx:272`, `KeywordStrategy.tsx:347`, `LocalSeoVisibilityBadge`). May be mounted/read; not reshaped.
- **Route id `local-seo`** in `src/routes.ts:7` / `src/lib/navRegistry.tsx:141` — FROZEN (contract 5). Label only may change to "Local Presence".
- `GbpConnectionCard` in `settings/ConnectionsTab.tsx:257` — owned by the Settings surface; must survive.
- Locations editor in Brand & AI (`business-footprint`) — link/status only here.
- Server WS-event constants, background-job types, MCP tool, insight bridge — plumbing UNCHANGED (rows 42–47).
- `tests/contract/tab-deep-link-wiring.test.ts` sender↔receiver contract — keep green, extend don't break.

---

## 7. D8 / DEF ledger entries

**D8 redirect map** (`D8_REDIRECT_MAP.md`): no Page removal on this surface (route id preserved). If lenses collapse from 4 → 3, add `?tab=overview → ?lens=presence` (and any other collapsed value) alias so bookmarks resolve (OQ8).

**Deferred-ledger rows** (add to `data/ui-rebuild-deferred-ledger.json` in the surface PR; `npm run verify:deferred-ledger` enforces schema/expiry/roadmap links). Copy the `DEF-foundation-001` shape (fields: `id, surface, item, decision, class, upgradeTrigger, owner, status, roadmapItemId, createdAt, reviewBy, links`).

| DEF id | item | class | upgradeTrigger | rides |
|--------|------|-------|----------------|-------|
| DEF-local-presence-001 | Geo-grid rank map deferred; posture grid ships on real per-market single-point data | scope | Owner greenlights the paid geo-grid scan job | SB-057 (N1) |
| DEF-local-presence-002 | View-on-Google link deferred; no review/maps URL persisted | data | SB-018-5 lands the maps-URL column + mapper + serialization | SB-018 / sn-local-presence-5 (N8) |
| DEF-local-presence-003 | Reopen-for-edits deferred; `approved→draft` illegal today | data | State-machine sign-off adds the reopen transitions (clears approval metadata) | SB-018 / sn-local-presence-7 (N10) |
| DEF-local-presence-004 | Nudge-client rate-limit deferred (only if SB-014 throttle does not ride W2) | scope | SB-014 per-target rate-limit ships | SB-014 (N7) — omit this row if N7 rides W2 |
| DEF-local-presence-005 | GBP Performance hero metrics (views/calls/directions) cut; rating+reviews+completeness shown | scope | Owner greenlights the new Google Performance scope | SB-058 (N2) |
| DEF-local-presence-006 | Profile-health checklist ships 3 real signals; hours/products/Q&A/service-area deferred | data | SB-056 extended GBP ingestion lands | SB-056 / sn-local-presence-8 (N4 full) |

`owner: josh`, `status: open`, `roadmapItemId: null` (or link a roadmap row if one exists), `createdAt` = PR date, `reviewBy` ≈ +6 weeks, `links.pr` = the surface PR.

---

### Gates before merge (BUILD_CONVENTIONS §8)
`npm run typecheck && npx vite build && npx vitest run` (full suite) · `npm run pr-check` · `npm run lint:hooks` · `npm run verify:deferred-ledger` · `npm run verify:bundle-budget` (surgical baseline only) · flag-transition component test (seeded QueryClient, **not** mocked `useFeatureFlag`) · deep-link receiver tests (static + runtime) · **flag-ON real-render smoke** in the browser against a workspace with real local-SEO data (the pilot's smoke caught 3 defects every automated gate missed).
