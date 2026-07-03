# Phase 0 Additive-Parity Ledger — Competitors (zone: Strategy & Content)

- **Surface:** admin Competitors page — `Page 'competitors'` (`src/routes.ts:7`), NON_REGISTRY (`src/lib/navRegistry.tsx:105`), rendered at `src/App.tsx:404` (lazy import `src/App.tsx:51`).
- **Entry at HEAD:** deep-link only — "Competitor intelligence →" button in The Issue cockpit Diffs & gaps disclosure (`src/components/KeywordStrategy.tsx:798`), flag-ON path. No global nav item, so flag-OFF nav is byte-identical.
- **Prototype view read:** `hmpsn studio Design System/mockup/competitors.js` (319 lines, raw). Supporting: `mockup/wsettings.js:184-190` (competitor-domain chips + Auto-discover moved to Workspace settings).
- **Parity Ledger row:** `Platform Parity Ledger.html:413-415` — `Competitors · status: improved`, funcs `['Competitor set + tracking','Content-gap vs competitors','Competitor send flows']`, home `competitors.js`. Also `:248` KeywordGaps → "Competitors → gaps tab" (present), `:251` CompetitiveIntel → "Competitors" (present). **No Gap/Partial rows for this surface.**
- **Audited:** 2026-07-02, branch `ui-rebuild-phase-0` (read-only).

## 1. Capability table

Status legend: `preserved` = obvious home in prototype/new IA, same or better · `improved` = prototype upgrades it · `new_proposed` = prototype-only, needs sign-off · `at_risk` = exists at HEAD, no visible home in the prototype.

### Page shell & routing

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 1 | `competitors` Page union value, admin route `/ws/:id/competitors` | `src/routes.ts:7`, `src/App.tsx:404` | preserved | Competitors surface (Strategy & Content zone, `UI Rebuild Handoff Brief.html:291`) | Prototype promotes it from deep-link-only to a foundational nav surface — improvement of reachability. |
| 2 | NON_REGISTRY / flag-OFF nav byte-identical; reached via The Issue cockpit deep-link | `src/lib/navRegistry.tsx:105-107`, `src/components/KeywordStrategy.tsx:798` | improved | First-class nav item in rebuild | Rebuild retires the deep-link-only constraint (per P2 direction: UI-shell flags retired by rebuild). Cockpit deep-link should still land here. |
| 3 | PageHeader: title "Competitors", subtitle "Share of voice, keyword gaps, backlinks, and competitor movement." | `src/components/competitors/CompetitorsPage.tsx:45-49` | preserved | `competitors.js:257` (verbatim copy) | |
| 4 | Page-level loading state while strategy loads | `CompetitorsPage.tsx:50-51` | preserved | Build Conventions four-state contract | Prototype is static; states owed by convention. |
| 5 | Competitor list derived from strategy settings (`settings.competitors` split/trim), `seoDataAvailable`, `keywordGaps` from stored strategy | `CompetitorsPage.tsx:25-35` | preserved | Data ticket: same reads | Prototype `wsettings.js:70-88` shows same per-workspace competitor arrays as source. |

### Competitor alerts (CompetitorAlertsPanel — Phase 6 net-new at HEAD)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 6 | GET `/api/workspaces/:id/competitor-alerts` (read-only projection of `competitor_alerts`, newest-first, limit 50, `requireWorkspaceAccess`) | `server/routes/competitor-alerts.ts:33-49`, `server/competitor-snapshot-store.ts:256` | preserved | Competitors → alerts card (`competitors.js:264-269`) | Wire shape `shared/types/competitor-alerts.ts:20-38` (`insightId` deliberately not exposed). |
| 7 | Alert row: competitor domain, type label (Gained/Lost/Authority shift/New keyword), keyword, position move `#prev → #cur` (blue), volume, snapshot date | `src/components/competitors/CompetitorAlertsPanel.tsx:17-22,40-80` | preserved | `competitors.js:201-213` (same fields, same blue tabular-nums) | |
| 8 | Severity badges critical=red / warning=amber / opportunity=emerald (no purple) | `CompetitorAlertsPanel.tsx:28-38` | preserved | `competitors.js:48-51,211` | |
| 9 | Alerts loading / error / empty ("No competitor movement detected") states | `CompetitorAlertsPanel.tsx:95-104` | preserved | Convention (four states) — prototype shows populated card only | Rebuild must implement the configured-but-quiet empty state, not just the unconfigured one. |
| 10 | WS both-halves refresh: invalidate on `STRATEGY_UPDATED`; 1h staleTime | `src/hooks/admin/useCompetitorAlerts.ts:30-46` | preserved | Data ticket: same hook contract | |
| 11 | "N this week" alert count + "Weekly check · updated Mon" sync line | — (not at HEAD) | new_proposed | `competitors.js:253,267` | Additive header metadata; needs a real "last cron run" source (derivable from max `snapshotDate`). |

### Share of voice (ShareBar)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 12 | Per-domain share-of-voice bars from organic traffic; own domain blue + "(you)", competitors orange; leader-first sort | `src/components/strategy/ShareBar.tsx:33-81` | preserved | `competitors.js:216-220,271-275` | Prototype scales bars to max pct rather than absolute pct — cosmetic. |
| 13 | Own-domain guard: renders nothing when own domain lacks measurable traffic, <2 domains, or total ≤0 (avoids misleading competitor-only chart) | `ShareBar.tsx:47-51` | at_risk | none visible | Trust guard, not chrome. Prototype always renders SoV. Must carry: a SoV chart that omits "you" is a documented trust landmine. |
| 14 | Cache sharing: ShareBar reuses CompetitiveIntel's query key — one fetch for both cards (168h staleTime) | `ShareBar.tsx:8-9,35-41` | preserved | Data ticket / implementation detail | |

### Head-to-head (CompetitiveIntel, `merged` variant on this page)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 15 | Live intel fetch GET `/api/seo/competitive-intel/:ws?competitors=` — own+competitor domain overviews, backlinks, top keywords (20), keyword gap (30), client-geo apples-to-apples, ≤5 domains, invalid-domain cleaning, per-area provider-failure collection, `degraded` flag, sanitized 502 on full primary failure | `server/routes/seo-provider.ts:59-171`, `server/constants.ts:11` | preserved | Data ticket for Competitors surface | Endpoint unchanged; the rebuild consumes it. |
| 16 | Per-competitor summary row: domain, organic traffic, keyword count, referring domains | `src/components/strategy/CompetitiveIntel.tsx:357-379` | improved | `competitors.js:277-286` head-to-head table (all domains incl. you, sorted by traffic, leader bolded, "YOU" pill) | Table is a genuine upgrade of the collapsed-row scan. |
| 17 | Per-competitor **expandable detail**: you-vs-them comparison bars — organic traffic, keywords, referring domains, **traffic value ($)** | `CompetitiveIntel.tsx:381-394` | at_risk | none — prototype flattens to the table and drops traffic-value entirely | Traffic value ($ organicCost) appears nowhere in the prototype. |
| 18 | Per-competitor **"Their Top Keywords"** list (top 10: position, volume, KD-colored) | `CompetitiveIntel.tsx:397-411` | at_risk | none visible | Only per-competitor keyword-level view on the platform outside the Hub. |
| 19 | Refresh button → invalidates `competitorIntelAll` cache | `CompetitiveIntel.tsx:336-343` | at_risk | none visible | Paired with server cache-clear utilities (#28). |
| 20 | Degraded/partial-data messaging ("Some live provider data is unavailable…") + "Live fetch failed — showing cached data." + Retry | `CompetitiveIntel.tsx:455-463` | at_risk | none — prototype is static happy-path | Convention covers generic error states, but the *degraded-yet-rendering* and *cached-fallback* distinctions are specific behaviors that must be specced. |
| 21 | Cached keyword-gap fallback from the stored strategy blob + amber "from strategy" provenance badge | `CompetitiveIntel.tsx:296-297,429,466-467` | at_risk | none visible | Provenance honesty rule (Content & Access Conventions) argues for carrying it. |
| 22 | Freshness label: "Updated {fetchedAt}" (merged) / "Cached 48h · …" (full) | `CompetitiveIntel.tsx:465-474` | preserved | `competitors.js:253` weekly-sync line is the analogue | Needs the honest response-assembly-time caveat carried. |
| 23 | Empty states: "Competitive analysis requires DataForSEO" and "Add competitor domains" (Strategy Settings pointer) | `src/components/strategy/StrategyCompetitiveTab.tsx:40-57`, `CompetitiveIntel.tsx:255-281` | preserved / **partial** | `competitors.js:184-195` add-domains empty state → Workspace settings | Prototype has the add-domains state but **not** the provider-not-configured state — two distinct causes at HEAD; both must exist. |
| 24 | "Authority" (DR) column + "Top 3" rankings count in head-to-head | — (not at HEAD: intel response has no domain-rank field, and only 20 top keywords are fetched, so an absolute top-3 count is not derivable) | new_proposed | `competitors.js:282` (`dr`, `top3` columns) | Data ticket required (e.g. DataForSEO rank + top-3 aggregate) before these numbers can render — kit rule: never fabricate a client-facing number. |

### Keyword gaps (standalone KeywordGaps card)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 25 | Gap rows: keyword, volume/mo, KD % (color-banded <30/<60/≥60), competitor domain + position; "Raw Competitor Evidence" framing + "Evidence only" badge | `src/components/strategy/KeywordGaps.tsx:56-121`, KD colors via `kdColor` (`StrategyCompetitiveTab.tsx:72`) | preserved | `competitors.js:233-240,288-293` (same fields, same KD banding at `competitors.js:110`) | Prototype drops the "Evidence only / auditability" framing copy — carry the meaning (these are provider terms, not curated actions). |
| 26 | Per-gap **Create brief** CTA → navigates to `seo-briefs` with `fixContext` state | `StrategyCompetitiveTab.tsx:75-79`, `KeywordGaps.tsx:103-113` | preserved | `competitors.js:239,85-87` Create brief button | Prototype toast-stubs it; wire to Content Pipeline brief flow. |
| 27 | Per-gap **View in Hub** deep-link → `seo-keywords` + `buildHubDeepLinkQuery({keyword})` | `KeywordGaps.tsx:92-102` | at_risk | none visible in `competitors.js` | Cross-surface keyword investigation path; Keywords surface exists in the new IA so the link has a natural target — it's just not drawn. |
| 28 | Per-gap **Track keyword** affordance (optional `onTrack` prop) | `KeywordGaps.tsx:26-29,80-91` | preserved (elsewhere) | Keywords surface | NOT mounted on this page at HEAD (`StrategyCompetitiveTab.tsx:70-80` passes no `onTrack`); owned by the Strategy Reference-band/Keywords audit. Listed to prevent double-counting. |

### Backlink profile (BacklinkProfile)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 29 | Stat cards: total backlinks, referring domains, follow-link % (+follow count), link types (text/image) | `src/components/strategy/BacklinkProfile.tsx:68-75` | preserved | `competitors.js:299-304` (same 4 cards) | |
| 30 | Top referring domains table: domain (external link, new tab), backlink count, first seen, last seen | `BacklinkProfile.tsx:78-116` | preserved | `competitors.js:242-248,305-309` | Prototype anchors are `onclick="return false"` — real build must keep the external link-out. |
| 31 | States: loading, DataForSEO-env-missing guidance (`DATAFORSEO_LOGIN`/`PASSWORD`), error, "No Backlink Data" empty | `BacklinkProfile.tsx:18-51` | preserved | Convention (four states) | Env-var hint is admin-appropriate; keep. |
| 32 | Refetch on `strategy:updated` via `useBacklinkProfile` React Query hook | `BacklinkProfile.tsx:13-15` | preserved | Data ticket | |

### Competitor send flow (strategy-competitor-send)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 33 | Per-gap "Send to client": mint-competitor-rec (idempotent) + send through rec lifecycle; optimistic Sent badge; WhyHowResult why-line; client approved/declined/discussing feedback pill; send-error line; doubly flag-gated (`strategy-command-center` && `strategy-competitor-send`, both default OFF `shared/types/feature-flags.ts:72,83`) | `CompetitiveIntel.tsx:122-228,237-240`; server mint: `server/routes/recommendations.ts:695-720` (broadcast + activity) | at_risk | none — prototype shows only Create brief | **Nuance:** the UI is *currently unreachable at HEAD* — GapRow renders only in the `full` variant's embedded gaps section (`CompetitiveIntel.tsx:419` gated `!merged`), and every mount is `merged` (`StrategyCompetitiveTab.tsx:66`, the only JSX mount). The backend (mint endpoint, rec lifecycle, flags) is live. Parity Ledger row lists "Competitor send flows" as a carried func, so it cannot be dropped by omission. |

### Competitor set management (powers this surface; UI lives in settings)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 34 | Save competitor domains: POST `/api/seo/competitors/:ws` — cleaned (`cleanCompetitorDomains`), capped `MAX_COMPETITORS = 5`, broadcasts `STRATEGY_UPDATED`, `addActivity` audit entry | `server/routes/seo-provider.ts:196-217`, `server/constants.ts:11` | preserved | `wsettings.js:184-190,266-267` chips + add/remove ("max 5" copy matches) | HEAD edit UI is in Strategy Settings (`src/components/strategy/hooks/useStrategySettings.ts:126-136`); prototype moves it to Workspace settings and cross-labels "Shared with Competitors surface". Placement change — see stop-and-ask Q4. |
| 35 | Auto-discover competitors: GET `/api/seo/discover-competitors/:ws` (provider `getCompetitors`, filtered, client geo) then save | `server/routes/seo-provider.ts:174-193`, `useStrategySettings.ts:126-136` | preserved | `wsettings.js:188` Auto-discover button | |
| 36 | Competitor set chips + "Edit set" button in the Competitors page header | — (not at HEAD; set only visible inside Strategy Settings) | new_proposed | `competitors.js:258-261` | Additive visibility win; empty state CTA also routes to workspace settings (`competitors.js:192`). |
| 37 | SEO provider cache clear: DELETE `/api/seo/cache/:ws` + GET `/api/seo/clear-cache/:ws` ("…click Refresh on Competitive Intelligence"), plus `/api/seo/diagnose/:ws` cache/domain diagnostics | `server/routes/seo-provider.ts:250-258,261-303` | at_risk | none visible | Admin ops utilities paired with the page's Refresh (#19). If Refresh is carried, these keep working; record so they're not orphaned. |

### Background pipeline & cross-surface consumers

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 38 | `competitor-monitoring` cron (registry entry, daily tick, **Monday-only** execution): per-domain weekly snapshot (top-50 keywords in client geo), skip-if-snapshotted-today idempotency | `server/cron-registry.ts:254-262`, `server/intelligence-crons.ts:91-160` | preserved | backend unchanged | Registry description says "Daily competitor visibility check" but execution is Monday-gated (`intelligence-crons.ts:93-94`) — the prototype's "Weekly check" copy is the accurate one. |
| 39 | Alert detection: `keyword_gained` (≥5 position jump, ≥100 vol), `new_keyword` (top-10 entry), `keyword_lost`, `authority_change`; severity computation | `server/competitor-snapshot-store.ts:157-230` (thresholds `:164`) | preserved | backend unchanged | |
| 40 | Each alert upserts a `competitor_alert` **insight** (severity, impact score), alert row linked to insight id; stale-insight cleanup with failed-domain + no-domain-processed guards | `server/intelligence-crons.ts:160-186,225-232` | preserved | Insights Engine surface consumes these | Insight renderers: admin `src/hooks/admin/useInsightFeed.ts:283`, client `src/components/client/InsightsDigest.tsx:394,430` — owned by the Insights/client audits, noted to prevent loss. |
| 41 | Competitor overtake → DECAYING opportunity-event boost on our ranking page's recs (PR7 Spine B; keyword→page map, `EVENT_BOOST_DEFAULTS.competitor`) | `server/intelligence-crons.ts:114-133,187-218` | preserved | backend unchanged | Invisible-to-UI scoring behavior; must survive untouched. |
| 42 | Client-facing competitor surfaces: premium `CompetitorGapsSection` (public `/api/public/competitor-gaps/:ws`), client strategy keyword-gap list | `src/components/client/CompetitorGapsSection.tsx:19`, `src/api/competitorGaps.ts:12`, `src/components/client/strategy/StrategyContentOpportunitiesSection.tsx:370-391` | preserved (out of scope) | Client dashboard audit owns these | Listed for cross-reference only. |
| 43 | Competitor schema comparison: GET `/api/competitor-schema/:ws` (crawl competitor JSON-LD, compare coverage) | `server/routes/competitor-schema.ts:18-79` | preserved (out of scope) | Schema surface audit owns this | Reads the same `ws.competitorDomains` set. |

## 2. Prototype coverage notes (`mockup/competitors.js`)

**Demonstrates (faithful):** header + verbatim subtitle; alerts card with all 4 alert types, severity pills, position move, volume, date; share of voice (you=blue, competitors=orange, sorted); keyword gaps with vol/KD-banded/comp-rank + Create brief; backlink profile (4 stat cards + referring-domains table with first/last seen); per-client scoping; add-domains empty state for a new client (`competitors.js:184-195`).

**Improves:** head-to-head as a single sortable table incl. your row with "YOU" pill (`:277-286`); competitor-set chips + Edit set in the header (`:258-261`); "N this week" alert count (`:267`); "Weekly check · updated Mon" sync line (`:253`); empty state routes to workspace settings where the set now lives.

**Omits (→ at_risk rows above):** per-competitor expandable detail (comparison bars incl. traffic value $, their top-10 keywords) — #17, #18; per-gap View in Hub — #27; competitor send-to-client flow — #33; Refresh/cache invalidation — #19, #37; degraded/cached-fallback/provenance messaging — #20, #21; ShareBar own-domain trust guard — #13; DataForSEO-not-configured empty state — #23; configured-but-no-movement alerts empty state — #9.

**Proposes new (needs sign-off):** Authority (DR) + Top 3 columns (#24 — requires new provider data; not derivable at HEAD); header competitor chips (#36); weekly-sync indicator + alert count (#11).

## 3. Parity Ledger reconciliation

- `Competitors` row (`Platform Parity Ledger.html:413-415`): status **improved**, no Gap/Partial for this surface. Broadly correct for layout/IA, **but** its own funcs list includes "Competitor send flows", which the mockup does not render — the ledger row over-claims on that one func (see #33 / Q1).
- `KeywordGaps` (`:248` → "Competitors → gaps tab", present): resolves, minus the View-in-Hub affordance (#27).
- `CompetitiveIntel` (`:251` → "Competitors", present): resolves for the head-to-head core; the expandable per-competitor detail and degraded-data behaviors are not in the mockup (#17, #18, #20, #21).
- No other Gap/Partial ledger rows reference this surface.

## 4. Trade-offs (quick win vs full)

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Head-to-head table | Build from the existing intel response (traffic, keywords, referring domains); omit Authority/Top-3 columns | Extend provider + endpoint with domain rank and a true top-3 count; add columns | None if columns are omitted; showing DR/Top-3 from fabricated or top-20-sampled data violates the "never change a client-facing number" rule |
| Per-competitor depth | Table only; drop expandable detail | Row expands (or drawer) to comparison bars + traffic value + their top-10 keywords, reusing the already-fetched `topKeywords` | Losing the only per-competitor keyword view outside the Hub; data is already in the payload so the full version is cheap |
| Competitor send flow | Ship page without send (matches mockup; the UI path is already dark at HEAD) | Add Send-to-client on gap rows via existing mint+lifecycle endpoints, flag-gated | Quick win silently retires a ledger-listed func and live backend; owner must decide, not omission (Q1) |
| Alerts card | Read-only feed (HEAD behavior) | Expose `insightId` on the wire and link each alert to its Insights Engine entry / resolve action | Low — read-only matches HEAD parity; linkage is additive |
| Degraded-data handling | Generic error state from Build Conventions | Carry the three distinct HEAD behaviors: degraded-partial banner, cached-fallback gaps + "from strategy" provenance badge, honest freshness label | Quick win collapses "provider half-failed but data shown" into "error" — misleading for an operator diagnosing provider issues |
| Set management | Chips read-only on Competitors + Edit set → Workspace settings (reuse POST/discover endpoints) | Inline add/remove/discover on the Competitors page itself | Low, provided Workspace settings actually wires save + auto-discover and the Strategy-generation flow can still see/edit the set (Q4) |

## 5. Open questions (stop-and-ask)

1. **Competitor send flow (#33):** The Parity Ledger lists "Competitor send flows" as a carried func; the mockup doesn't render it; at HEAD the UI is unreachable (merged-variant gating) while the backend (mint endpoint, flags, lifecycle) is live. Carry into the rebuilt gaps card, keep backend-only, or formally retire? Owner decision required.
2. **Per-competitor detail (#17, #18):** The flat head-to-head table drops the comparison bars, traffic value ($), and "Their Top Keywords" lists. Intentional simplification, or add an expand/drawer? (Data is already in the intel response.)
3. **Authority (DR) / Top 3 columns (#24):** Not derivable from the HEAD response. Approve a data ticket (provider domain-rank + top-3 aggregate) or drop the columns from v1?
4. **Set-management home (#34-36):** Prototype moves competitor-domain editing from Strategy Settings to Workspace settings. Confirm single home, that the strategy-generation flow retains access to the set, and that Auto-discover ships there.
5. **View in Hub (#27):** Carry the per-gap Keyword-Hub deep-link into the new gaps card? The Keywords surface exists in the new IA, so this is one affordance, not a data ticket.
6. **Degraded/provenance behaviors (#13, #20, #21):** Confirm these are specced into the surface's state matrix (they are behaviors, not just states): ShareBar own-domain guard, degraded-partial banner, cached-fallback "from strategy" badge.
7. **Cross-surface ownership:** Confirm the client competitor surfaces (#42) and `competitor_alert` insight renderers (#40) are covered by the Client Dashboard and Insights Engine audits respectively, so they are not lost between ledgers.
