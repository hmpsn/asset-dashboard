# Wave 2 Build Ticket — Competitors (admin surface)

> **Zone:** Strategy & Content · **Route:** `/ws/:id/competitors` (Page `competitors`, `src/routes.ts:7`; rendered `src/App.tsx:404`, lazy `src/App.tsx:51`)
> **Lane / flag:** A-lane `ui-rebuild-shell` (surface mount). Backend gates `strategy-command-center` + `strategy-competitor-send` stay lifecycle-governed (AD-006).
> **Effort:** M (surface JSON `effortEstimate: "M"`, competitors.json:379).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` → `CROSS_SURFACE_CONTRACTS.md` → `BUILD_CONVENTIONS.md` → `surfaces/competitors.json` → this ticket → the Keywords pilot (`src/components/keywords-rebuilt/`).
> **Reference implementation:** the merged Keywords pilot is authoritative for every structural pattern (BUILD_CONVENTIONS §7); when this ticket and the pilot disagree, the pilot wins.

---

## 1. ⚠ OWNER DELTAS

**None — all per-surface-dispatch proposedDefaults adopted.**

Every `needsOwner: true` open question in `competitors.json` is already resolved by a ratified decision — no live deviation remains:

- **Q1 (#33 send flow)** — resolved by AD-006: `strategy-competitor-send` is lifecycle-governed and stays. Carry the send affordance behind the existing flag (proposedDefault "Carry"). Not a retirement; no owner call needed here.
- **Q2 (#17/#18 per-competitor depth)** — adopt the Drawer default (comparison bars + traffic value + top-10 keywords; data already in payload).
- **Q3 (#24 Authority/Top-3)** — adopt "drop from v1, never fabricate"; **SB-019 rides** at scoped effort (W0.5 probe confirmed procurement — see §3). Columns render only after SB-019 lands.
- **Q4 (#34-36 set-editing home)** — resolved by **C-5 / AD-014** (Workspace Settings single edit home; read-only chips + Edit-set routing here). Ratified `CROSS_SURFACE_CONTRACTS.md:38`, `owner-decisions.json:200-206`.
- **Q5 (#27 View-in-Hub)** — `needsOwner: false`; adopt (reuse `buildHubDeepLinkQuery`, Keywords surface exists in new IA).
- **Q6 (#13/#20/#21 trust behaviors)** — `needsOwner: false`; adopt (spec all three into the state matrix).
- **Q7 (#40/#42 cross-surface renderers)** — `needsOwner: false`; cross-reference only (see §4).

> Watch item (not a delta): the surface JSON's `mountNote` says "promoted … to a first-class Strategy & Content nav item." That promotion is an **F4 shell `NavItem` addition** (competitors.json:13, phase0 competitors.md:18). The Wave 2 surface PR mounts the page; the nav-item registration is coordinated with the F4 shell owner and must NOT be silently assumed in this PR if the shell nav is not yet accepting new entries. Flagged for the plan, not an owner decision.

---

## 2. Capability checklist (every `ui-only` row = acceptance criterion)

Grounded in `competitors.json` `capabilityClassification` + phase0 `competitors.md` §1. Each `ui-only` / adopted-`open-question` row below is a hard acceptance criterion for the surface PR. Rows marked **(server-gated)** render only after their SB-* lands (§3).

### Page shell & routing
- [ ] **#1** `competitors` Page + admin route re-skinned, route unchanged (competitors.json:6-8).
- [ ] **#2** Deep-link entry preserved: The Issue cockpit "Competitor intelligence →" (`KeywordStrategy.tsx:798`) keeps landing on `/ws/:id/competitors` — no redirect map (route unchanged). First-class nav item is the F4 shell addition (see §1 watch item).
- [ ] **#3** `PageHeader` title "Competitors" + subtitle "Share of voice, keyword gaps, backlinks, and competitor movement." (verbatim, `CompetitorsPage.tsx:45-49`).
- [ ] **#4** Four-state page loading via existing `useKeywordStrategy` `isLoading` (BUILD_CONVENTIONS four-state contract).
- [ ] **#5** Competitor list derived from `settings.competitors` + `keywordGaps` from stored strategy (`CompetitorsPage.tsx:25-35`), same reads.

### Competitor alerts (`CompetitorAlertsPanel` carry)
- [ ] **#6** Consume `GET /api/workspaces/:id/competitor-alerts` as-is (`competitor-alerts.ts:34-50`).
- [ ] **#7** Render all alert-row fields (`shared/types/competitor-alerts.ts:20-38`) in a `DataTable`; position move `#prev → #cur` in blue tabular-nums (Four Laws: blue = data).
- [ ] **#8** Severity badges via `Badge`/`IntentTag` tones: critical=red, warning=amber, opportunity=emerald. **No purple** (`CompetitorAlertsPanel.tsx:28-38`).
- [ ] **#9** Alerts four-state — and the **configured-but-quiet** empty ("No competitor movement detected") MUST be distinct from the unconfigured empty (`CompetitorAlertsPanel.tsx:95-104`; prototype has only one).
- [ ] **#10** WS wiring: reuse `useCompetitorAlerts` verbatim — invalidate on `STRATEGY_UPDATED`, 1h staleTime (`useCompetitorAlerts.ts:30-46`); carry the `// ws-invalidation-ok` justification per BUILD_CONVENTIONS §7.
- [ ] **#11 (server-gated — SB-020a)** "N this week" count + "Weekly check · updated Mon" sync line. Count is client-derivable from alerts; the **sync line for the zero-alerts case needs `lastSnapshotDate`** (SB-020). Render the count now; render the sync line only when the field is on the wire.

### Share of voice (`ShareBar`)
- [ ] **#12** Per-domain SoV bars from `organicTraffic` via `Meter`; own domain accent + "(you)", competitors distinct; leader-first sort.
- [ ] **#13 (Q6, trust)** Carry `ShareBar` own-domain guard — render nothing when own domain lacks measurable traffic / <2 domains / total ≤0 (`ShareBar.tsx:47-51`). A SoV chart omitting "you" is a documented trust landmine; this is a required behavior, not chrome.
- [ ] **#14** Keep the single shared fetch: `ShareBar` reuses `queryKeys.admin.competitorIntelAll` (`queryKeys.ts:135`) — one fetch for SoV + head-to-head.

### Head-to-head (`CompetitiveIntel` → DataTable)
- [ ] **#15** Consume `GET /api/seo/competitive-intel/:ws` unchanged (geo apples-to-apples, ≤5 cap, `degraded` flag, `providerFailures`, sanitized 502; `seo-provider.ts:59-171`).
- [ ] **#16** Head-to-head single sortable `DataTable` incl. the YOU row with a "YOU" pill, sorted by traffic, leader emphasized (columns traffic/keywords/refDomains already in response, `CompetitiveIntel.tsx:357-379`). Self-carded `DataTable` — do NOT double-card.
- [ ] **#17 (Q2 → Drawer)** Per-competitor detail Drawer: you-vs-them comparison bars incl. **traffic value ($ `organicCost`)** (`seo-data-provider.ts:58`; `CompetitiveIntel.tsx:381-394`). Raw `$/mo` is **admin-only** — this is an admin surface, so raw is permitted (AD-028 bands apply to client surfaces only); use `KeyValueRow` in the Drawer.
- [ ] **#18 (Q2 → Drawer)** Per-competitor "Their Top Keywords" (top 10: position, volume, KD-banded) from the already-fetched `topKeywords[20]` (`seo-provider.ts:126-128`).
- [ ] **#19** Refresh button → invalidate `competitorIntelAll` in the rebuilt `Toolbar` (freshness/refresh per AD-001 / BUILD_CONVENTIONS §1). Honest copy: "Re-scan"/"Refresh" + `Last scanned {fetchedAt}` meta.
- [ ] **#20 (Q6, trust)** State matrix must carry the three distinct behaviors: **degraded-partial** banner ("Some live provider data is unavailable…"), **cached-fallback** ("Live fetch failed — showing cached data.") + Retry (`CompetitiveIntel.tsx:455-463`). Do NOT collapse degraded-yet-rendering into a generic error.
- [ ] **#21 (Q6, trust)** Cached keyword-gap fallback from the stored strategy blob + amber **"from strategy"** provenance badge (`CompetitiveIntel.tsx:296-297,466-467`).
- [ ] **#22** Honest freshness label from `fetchedAt` (`seo-provider.ts:160`) — response-assembly-time caveat carried.
- [ ] **#23** **Two distinct page empty states**: provider-not-configured (503 no DataForSEO) vs add-domains (empty competitor list → routes to Workspace Settings). Prototype has only add-domains; both are required (`StrategyCompetitiveTab.tsx:40-57`).
- [ ] **#24 (server-gated — SB-019b; Q3)** Authority (DR) + Top-3 columns. **Dropped from v1** — render only after SB-019 lands. Never fabricate from the top-20 sample.

### Keyword gaps (`KeywordGaps`)
- [ ] **#25** Gap rows: keyword, vol/mo, KD % (banded <30/<60/≥60), competitor domain+position; carry the **"Raw Competitor Evidence" / "Evidence only"** framing meaning (provider terms, not curated actions) (`KeywordGaps.tsx:56-121`).
- [ ] **#26** Per-gap **Create brief** CTA → real `navigate` to `seo-briefs` with `fixContext` state (`KeywordGaps.tsx:103-113`). Wire it — do NOT toast-stub.
- [ ] **#27 (Q5 → carry)** Per-gap **View in Hub** deep-link → `seo-keywords` + `buildHubDeepLinkQuery({keyword})` (`KeywordGaps.tsx:92-102`). Routes through the Keyword Hub — read-only navigation, no second keyword write path.
- [ ] **#28** **Track keyword** is NOT mounted here (owned by Keywords surface, single-writer). Listed to prevent double-count — do NOT build a second keyword write path (`KeywordGaps.tsx:26-29`; not passed at HEAD).

### Backlink profile (`BacklinkProfile`)
- [ ] **#29** 4 stat cards (total backlinks, referring domains, follow %, link types) via `MetricTile` ×4 (`BacklinkProfile.tsx:68-75`; `seo-data-provider.ts:82-91`).
- [ ] **#30** Top referring-domains `DataTable` with **real external link-out** anchors (new tab) — not the prototype's dead `onclick="return false"` (`BacklinkProfile.tsx:78-116`).
- [ ] **#31** States incl. the admin-appropriate **DataForSEO env-var hint** (`DATAFORSEO_LOGIN`/`PASSWORD`) (`BacklinkProfile.tsx:18-51`).
- [ ] **#32** Refetch on `strategy:updated` via `useBacklinkProfile` (`useBacklinkProfile.ts:18-20`).

### Competitor send flow
- [ ] **#33 (Q1 → carry, flag-gated)** Per-gap **Send to client** via the existing mint endpoint `POST /api/recommendations/:ws/competitor-rec` (`recommendations.ts:691-724`), doubly gated `strategy-command-center` && `strategy-competitor-send` (`feature-flags.ts:72,83`, both default OFF, lifecycle-governed per AD-006). Optimistic Sent badge, why-line, client feedback pill, send-error line. Carrying it is `ui-only`; the ledger lists it as a func so it cannot be dropped by omission.

### Set management (read-only here; edit home = Workspace Settings, C-5/AD-014)
- [ ] **#34** Save endpoint `POST /api/seo/competitors/:ws` UNCHANGED (`seo-provider.ts:196-217`). Edit UI lives in Workspace Settings — do NOT build a second edit UI here.
- [ ] **#35** Auto-discover `GET /api/seo/discover-competitors/:ws` UNCHANGED (`seo-provider.ts:174`); Auto-discover **ships in Workspace Settings**, not here.
- [ ] **#36** Header competitor-set chips: **read-only `FilterChip`s** from `settings.competitors` + an **"Edit set"** action **routing to Workspace Settings** (C-5). No inline add/remove/discover on this page.
- [ ] **#37** SEO cache-clear / diagnose utilities (`DELETE /api/seo/cache/:ws`, `/api/seo/diagnose/:ws`) stay working by carrying Refresh (#19) — recorded so they are not orphaned.

### Background pipeline & cross-surface (backend UNCHANGED — no UI work; carry copy only)
- [ ] **#38** `competitor-monitoring` cron backend unchanged; use accurate **"Weekly check"** copy (execution Monday-gated, `intelligence-crons.ts:93-94`). (Registry description "Daily…" is stale — fixed under AD-030, NOT this PR.)
- [ ] **#39** Alert detection thresholds/severity backend unchanged (`competitor-snapshot-store.ts:157-230`).
- [ ] **#40** `alert → competitor_alert insight` upsert + renderers backend unchanged; renderers owned by Insights Engine / client audits (§4).
- [ ] **#41** Competitor-overtake → DECAYING rec boost — **invisible scoring behavior, must survive untouched, zero UI work** (`intelligence-crons.ts:114-133`).
- [ ] **#42** Client competitor surfaces (public gaps, client strategy) OUT OF SCOPE — owned by Client Dashboard audit (§4).
- [ ] **#43** Competitor-schema comparison OUT OF SCOPE — owned by Schema surface audit; shares the `competitorDomains` set (§4).

### AD-011 additive-parity floor (competitors is a named surface)
- [ ] Comparison bars / traffic-value / top-keywords land in the **Drawer** (#17/#18) — export/capability drops violate a hard floor (AD-011, `owner-decisions.json:161-173`).

### AD-030 dead-code fold-in (C3-later, NOT this PR)
- [ ] The cron "Daily → Weekly" competitor-check description fix is folded into a surface PR under AD-030 but tagged **C3-later** (`owner-decisions.json:381-395`). Record here; do not block the Wave 2 surface PR on it. Use "Weekly" copy in the UI now (#38).

---

## 3. Server tickets (SB-* — ride vs defer, verifier-adjusted home + effort)

| SB | Scope | Ride / Defer | Home (verifier-adjusted) | Effort | Gate |
|----|-------|--------------|--------------------------|--------|------|
| **SB-020** (`competitors-2` + `-3`) | `lastSnapshotDate` (MAX snapshot_date) on alerts response → #11 sync line; `insightId` on `CompetitorAlertView` → #40 Insights linkage | **RIDE (wave-1-adjacent)** | `server/competitor-snapshot-store.ts` (one MAX query) + `server/routes/competitor-alerts.ts` `toView` + `shared/types/competitor-alerts.ts` | **S** | Both read EXISTING columns — **no migration**, no column+mapper lockstep (verify verdict `competitors.json:391-401`). |
| **SB-019b** (`competitors-1`) | Domain rank (DR/authority) + true top-3 count on competitive-intel, from DataForSEO `backlinks_bulk_ranks` (ONE bulk call for the set) + `pos_1 + pos_2_3` from `domain_rank_overview` (one call/domain) → #24 columns | **RIDE at scoped effort** — owner-gate satisfied (Q3 default = drop-from-v1-until-ticket-lands; probe confirms procurement) | `server/seo-data-provider.ts` (provider interface + DataForSEO impl) + `server/routes/seo-provider.ts` competitive-intel handler | **M** (live pass-through, **no migration**) | W0.5 **probe CONFIRMED procurable** (`probes.md` Probe 2): direct payload reads, no scraping / no N+1 keyword fan-out. Verdict `competitors.json:387-388`. #24 columns stay hidden until this lands. |
| **SB-005** (top-3 half only) | Per-page primaryKeyword/rank/traffic/optimizationScore projection onto page rows | **DEFER — not on competitors' critical path** | `server/routes/webflow.ts` all-pages assembly + `server/page-keywords.ts` | M | competitors is only one of five consumers; the **top-3 half is separate** and belongs to SB-019, per the SB-005 note ("competitors-1(top-3 half separate)"). Competitors surface needs nothing from SB-005 directly. |

> **Note:** the surface JSON's local `serverNeeds` (sn-competitors-1/-2/-3) map to the backlog as SB-019b (sn-competitors-1) and SB-020 (sn-competitors-2 + sn-competitors-3). Consume the backlog IDs; the sn-* originals are the gatherer view.

---

## 4. Deep-link receiver matrix

| Direction | Sender | Receiver / target | Contract |
|-----------|--------|-------------------|----------|
| **Inbound** | The Issue cockpit "Competitor intelligence →" `KeywordStrategy.tsx:798` | this surface, `/ws/:id/competitors` (route unchanged) | No `?tab=`/`?param=` — plain route. No redirect map needed (route id preserved). |
| **Outbound** | per-gap **View in Hub** (#27) | Keywords surface `seo-keywords` + `buildHubDeepLinkQuery({keyword})` | Sender half of a two-halves `?`-query contract; the Keywords pilot receiver already validates its params (`useKeywordsSurfaceState.ts` `readHubDeepLink`). Keep `tests/contract/tab-deep-link-wiring.test.ts` green. |
| **Outbound** | per-gap **Create brief** (#26) | `seo-briefs` with `fixContext` navigation state | React Router location state (not a URL param); wire the real `navigate`, not a toast stub. |
| **Outbound** | **Edit set** (#36) | Workspace Settings (competitor-set edit home, C-5) | Read-only chips here; edit routes out. |
| **Outbound (server-linked)** | alert row (#40, after SB-020 `insightId`) | Insights Engine entry / resolve action | Renders only once `insightId` is on the wire; renderers owned by Insights audit. |

This surface adds **no new `?tab=` param of its own** (single-page section stack, no LensSwitcher — `composition.lensesOrTabs`, competitors.json:336-343). Do not overload `tab` (BUILD_CONVENTIONS §7 URL-state rule).

---

## 5. Flag disposition

| Flag | Kind | Disposition | Evidence |
|------|------|-------------|----------|
| `ui-rebuild-shell` | UI-shell (A-lane) | **Surface mount gate.** Surface mounts in `RebuiltAppChrome` when ON; flag-OFF falls through to legacy byte-identical. Retired on the rebuild track once the surface is accepted. | `rebuiltSurfaces.ts:5-16`, AD-006 |
| `strategy-command-center` | backend/behavior gate | **Stays — lifecycle-governed, NOT retired by this rebuild.** Gates the #33 send flow (with the flag below). | AD-006 (`owner-decisions.json:98`); `feature-flags.ts:72` |
| `strategy-competitor-send` | backend/behavior gate | **Stays — lifecycle-governed, NOT retired by this rebuild.** Second gate on #33; carry the send affordance behind it (Q1 default). | AD-006; `feature-flags.ts:83` |

No flag is retired by this surface. The nav-item promotion (#2) is an F4 shell concern, not a flag change on this surface.

---

## 6. File ownership

### Owned by this ticket (create / edit)
- `src/components/competitors-rebuilt/**` — the new `@ds-rebuilt` surface directory (every file first line `// @ds-rebuilt`). Mirror the pilot's file split: `CompetitorsSurface.tsx` (page skeleton: `PageContainer`/`PageHeader`/`Toolbar` + section stack), section components (`CompetitorAlerts`, `ShareOfVoice`, `HeadToHeadTable`, `KeywordGapsCard`, `BacklinkProfileCard`), `CompetitorDetailDrawer.tsx` (#17/#18), a `useCompetitorsSurfaceState.ts` if any URL state is added, and a mutation-feedback module reusing `useToast`.
- `src/components/layout/rebuiltSurfaces.ts` — **add ONE line**: `'competitors': lazyWithRetry(() => import('../competitors-rebuilt/CompetitorsSurface').then(m => ({ default: m.CompetitorsSurface })))` (`rebuiltSurfaces.ts:19-23`). Never a new `App.tsx` branch.
- **Hooks:** REUSE existing hooks — `useKeywordStrategy`, `useStrategySettings`, `useCompetitorAlerts`, `useBacklinkProfile`, `queryKeys.admin.competitorIntelAll`. Only add a thin surface-local hook if new URL state is introduced. Do NOT fork these.
- **Tests:** `tests/component/competitors-rebuilt/CompetitorsSurface.test.tsx` — mandatory flag-transition test with a **seeded real `QueryClient`** (do NOT mock `useFeatureFlag`; BUILD_CONVENTIONS §8, `RebuiltSidebar.test.tsx:55-70` snippet), a11y-floor assertion (`expectNoA11yViolations`), and a deep-link runtime receiver test if #27 emits params. Keep `tests/contract/tab-deep-link-wiring.test.ts` green.
- `data/ui-rebuild-deferred-ledger.json` — add any `DEF-*` row for a quick-win trade-off shipped (§7).

### Server (only if SB-019b/SB-020 ride in this wave — coordinate lane ownership)
- `server/competitor-snapshot-store.ts`, `server/routes/competitor-alerts.ts`, `shared/types/competitor-alerts.ts` (SB-020).
- `server/seo-data-provider.ts`, `server/routes/seo-provider.ts` (SB-019b).

### Must NOT touch (frozen / other-owner)
- `src/components/competitors/**`, `src/components/strategy/{ShareBar,CompetitiveIntel,KeywordGaps,BacklinkProfile,StrategyCompetitiveTab}.tsx` — legacy HEAD, left byte-identical until the shell flag retires (carry-over machinery may be imported unchanged per AD-010, never edited).
- **Competitor-set EDIT UI** — belongs to Workspace Settings (C-5/AD-014). No edit UI on this page beyond read-only chips + routing.
- **Keyword write path** — Track-keyword (#28) is owned by the Keyword Hub single-writer. Do not add a second write path.
- All `server/intelligence-crons.ts` competitor cron / detection / DECAYING-boost logic (#38-41) — backend unchanged.
- `server/routes/recommendations.ts` competitor-rec mint endpoint (#33) — consume as-is, do not modify.
- Insights Engine renderers, Client Dashboard competitor surfaces, Schema comparison (#40/#42/#43) — other-surface audits.

---

## 7. D8 / deferred-ledger entries

Two capabilities ship "absent-until-server-ticket" and each needs a `DEF-*` row in `data/ui-rebuild-deferred-ledger.json` **in the surface PR** (BUILD_CONVENTIONS §7; `verify:deferred-ledger` enforces schema/expiry/roadmap links). Draft rows (fill `roadmapItemId`/`links`/`reviewBy` at PR time; copy `DEF-foundation-001` field set):

```jsonc
{
  "id": "DEF-competitors-001",
  "surface": "competitors",
  "item": "Authority (DR) + Top-3 columns dropped from head-to-head v1 — not derivable at HEAD; rendering them requires SB-019b provider fields.",
  "decision": "Drop from v1, never fabricate from the top-20 sample (Q3 default). Columns render only after SB-019b lands the DataForSEO domain-rank + top-3 aggregate fields.",
  "class": "data",
  "upgradeTrigger": "SB-019b ships domain rank (backlinks_bulk_ranks) + pos_1+pos_2_3 top-3 count onto the competitive-intel response.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": { "pr": "<surface PR>", "backlog": "SB-019" }
},
{
  "id": "DEF-competitors-002",
  "surface": "competitors",
  "item": "Alerts 'Weekly check · updated Mon' sync line hidden in the zero-alerts case — no lastSnapshotDate timestamp on the wire.",
  "decision": "Render the 'N this week' count (client-derivable) now; render the sync line only once SB-020 exposes lastSnapshotDate. No fabricated timestamp.",
  "class": "data",
  "upgradeTrigger": "SB-020 exposes lastSnapshotDate (MAX snapshot_date) on the competitor-alerts response.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": { "pr": "<surface PR>", "backlog": "SB-020" }
}
```

> If SB-019b and/or SB-020 land **in the same wave** as the surface (both are no-migration and wave-1-adjacent), the corresponding `DEF-*` row is unnecessary — ship the capability instead. The rows exist only for the deferred case. **AD-004** (insight-graduation) writes: this surface builds **no** ad-hoc graduation path; #40 Insights linkage is a read-only `insightId` display (SB-020), not a graduation write — so no additional AD-004 DEF-* row is owed here beyond the program-wide C3 contract.

---

### Verification (per-PR gates, BUILD_CONVENTIONS §8)
`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Then the **flag-ON real-render smoke** (CLAUDE.md UI rule 13): flip `ui-rebuild-shell` via the env-flag local mechanism against a live DB workspace that actually has competitor data, click through degraded / cached-fallback / two empty states in the browser, screenshot in the PR.
