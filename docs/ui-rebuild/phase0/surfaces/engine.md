# Phase 0 Additive-Parity Ledger — Engine (SEO Decision Engine / Strategy)

- **Surface:** Engine — admin Strategy page (Strategy v3 curation cockpit / "The Issue")
- **HEAD entry point:** `Page 'seo-strategy'` (`src/routes.ts:7`), mounted as `KeywordStrategyPanel` (`src/App.tsx:399`), nav entry `src/lib/navRegistry.tsx:135`
- **New-IA zone:** CLIENT · OVERVIEW → **Insights Engine** (`UI Rebuild Handoff Brief.html` surface map: "CLIENT · OVERVIEW Cockpit Insights Engine"; mockup nav `nav.js:20` `{id:'issue', label:'Insights Engine'}`)
- **Prototype view read:** `hmpsn studio Design System/mockup/strategy.js` (renders `view-issue`, "THE ISSUE — STRATEGY SPINE"); cross-referenced `wsettings.js` (Strategy inputs relocation), `cockpit.js` (signal promotion → Insights Engine), `nav.js`
- **Parity Ledger row:** Strategy → `strategy.js → Insights Engine (issue)`, surface status **improved**, note: *"Reframed as the client-facing Insights Engine (recommendations + the issue merged). Verify the page↔keyword mapping surface is fully represented."* No Gap/Partial sub-tool rows for this surface (all `present` or `folded`).
- **Audit date:** 2026-07-02, branch `ui-rebuild-phase-0` (post-Reconcile staging HEAD)

## Scope boundary

This surface is the **admin** Strategy/Engine page. Adjacent surfaces referenced but owned by other audits: client `TheIssueClientPage` / client Strategy tab (`src/components/client/the-issue/`, `src/components/client/strategy/` → Client portal / Recommendations surfaces), Keyword Hub (`seo-keywords`), Competitors page, Local Presence, Content Pipeline, Workspace Settings. Where HEAD capabilities move to those homes, the row below says so — the receiving audit must confirm pickup (fan-out rule).

## HEAD orchestrator anatomy (for reference)

`src/components/KeywordStrategy.tsx` renders three composed Overview branches gated by flags read at `KeywordStrategy.tsx:138-159`:
1. **Legacy** (`strategy-command-center` OFF): OrientZone → ActQueue (or QuickWins/LHF/KeywordGaps fallback) → Reference & Analysis (`KeywordStrategy.tsx:904-928`).
2. **Command-center v3** (`strategy-command-center` ON): nudges → Orient → StrategyDiff → StrategyCockpit → CannibalizationTriage → StrategyConfigPanel (`KeywordStrategy.tsx:857-902`).
3. **The Issue** (`strategy-the-issue` AND command-center ON): IssueSetupReadiness → IssueHeader → StanceBar → DraftedPovEditor → BackingMovesQueue → docked send bar → 3 Disclosure groups (`KeywordStrategy.tsx:618-815`).
Interior `?tab=` tabs: `overview | content | rankings | competitive` (`KeywordStrategy.tsx:74-87,100-111`).

---

## Capability table

Status legend: **preserved** (obvious home, same or better) · **improved** (prototype upgrades it) · **new_proposed** (prototype-only, needs sign-off) · **at_risk** (exists at HEAD, no visible home in prototype — uncertain = at_risk).

### A. Generation, settings, page chrome

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| A1 | Generate keyword strategy as background job (`POST /api/webflow/keyword-strategy/:ws`), progress indicator, error retry, "Strategy ready" NextSteps | `server/routes/keyword-strategy.ts:139`; `src/components/strategy/hooks/useStrategyGeneration.ts:60-90`; `KeywordStrategy.tsx:388-419` | preserved | wsettings "Re-run initial strategy" (`wsettings.js:163`) + scheduled "Strategy regeneration" cadence (`wsettings.js:107-109`) + nudge "Regenerate strategy" (`strategy.js:311`) | Job progress must surface via the rebuilt notification/job rail; mockup shows toast only |
| A2 | **Full vs incremental** generation modes (two distinct header actions) | `KeywordStrategy.tsx:274-279`; `useStrategyGeneration.ts:60,84` | **at_risk** | — | Prototype exposes only a single "Regenerate"; mode distinction has no visible home |
| A3 | **RefreshOrderingPrompt** — local-SEO-refresh-then-regenerate ordering dialog | `KeywordStrategy.tsx:319-337`; `src/components/keyword-strategy/RefreshOrderingPrompt.tsx` | **at_risk** | — | Guards a real data-ordering hazard (stale local data baked into strategy); no prototype equivalent |
| A4 | Strategy inputs: seoDataMode (none/quick/full), maxPages, competitor domains + AI auto-discover, business context | `KeywordStrategy.tsx:363-384,879-901`; `StrategyConfigPanel.tsx`, `StrategySettings.tsx` | improved | Workspace → Strategy & intelligence (`wsettings.js:169-200`: provider, competitors + Auto-discover, context, seoMode note `wsettings.js:105`) | Ledger rows StrategySettings/StrategyConfigPanel → "Workspace → Strategy inputs". Competitors marked "Shared with Competitors surface" |
| A5 | Local market label + LocalSeoMarketSetupDrawer from config panel | `KeywordStrategy.tsx:166-167,899-900,1028-1035` | preserved | Local Presence surface (`local.js` / `local-setup.js`) | Receiving audit: Local Presence |
| A6 | Flag-OFF LocalSeoVisibilityPanel (mode='strategy') outside tabs | `KeywordStrategy.tsx:346-352` | preserved | Keywords / Local Presence (already de-duped at HEAD when v3 ON) | |
| A7 | Header freshness subtitle ("Generated {date} · N pages mapped") | `KeywordStrategy.tsx:262-264` | preserved | "What changed … since {prev}" chip (`strategy.js:325`) | Verify a generated-at stamp survives somewhere visible |
| A8 | "How it works" explainer (tooltip flag-ON / inline flag-OFF) incl. seoDataMode + ranking caveats | `KeywordStrategy.tsx:286-288,505`; `StrategyHowItWorks.tsx` | **at_risk** | — | No prototype equivalent |
| A9 | AIContextIndicator pre-generation (what context the AI will use) | `KeywordStrategy.tsx:339-341` | **at_risk** | — | Small but user-facing trust surface |
| A10 | Loading / fetch-error / no-workspace / empty (StrategyEmptyState) states | `KeywordStrategy.tsx:238-259,421` | preserved | State kit is mandatory per Build Conventions ("every surface owes four states") | |
| A11 | `?tab=` deep links `overview|content|rankings|competitive` (two-halves contract, contract-tested) | `KeywordStrategy.tsx:74-111`; `tests/contract/tab-deep-link-wiring.test.ts` | **at_risk** | — | New IA dissolves the interior tabs across surfaces; old URLs need a redirect map (see stop-and-ask Q3) |

### B. Orient / verdict / value framing

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| B1 | OrientZone: visibility score + delta, clicks, impressions, ranked keywords, avg position (vs last gen) | `src/components/strategy/OrientZone.tsx:57-71`; mounted `KeywordStrategy.tsx:509-511,779` | preserved | Ledger: "OrientZone · NeedsAttention · QuickWins → Cockpit" (Cockpit surface); avg-position also in prototype money frame (`strategy.js:398`) | Receiving audit: Cockpit. Visibility score itself must not be dropped in the split |
| B2 | Admin verdict headline ("Acme is invisible for…") opening the Engine | `strategy.js:384-387` | **new_proposed** | Insights Engine top | HEAD has client-side verdict (`IssueVerdictHeadline`, client surface) and admin POV prose; an admin-facing verdict banner is new presentation — must be drafted from `StrategyPov`, never hardcoded |
| B3 | Money frame: "Pipeline value at stake" + basis pill ("Agency estimate"), "Recovered so far", "Backing moves live", avg position | `strategy.js:389-399` | **new_proposed** | Insights Engine | HEAD computes outcome/ROI values only on the client spine (`computeROI`, outcome provenance) and per-rec `estimatedGain`. Surfacing them on the admin Engine needs a data ticket + owner sign-off (client-facing-number law: UI must not compute money) |

### C. Recommendation set + curation cockpit

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| C1 | Unified recommendation set read (`GET /api/recommendations/:ws`) shared by cockpit/queue | `server/routes/recommendations.ts:509`; `KeywordStrategy.tsx:177-184` | preserved | Insights Engine backing-moves data source | |
| C2 | Lifecycle facet buckets Active / Sent / Approved / Throttled with counts | `src/components/strategy/StrategyCockpit.tsx:28-33,126-143` | **at_risk** | — | Prototype shows only active staged/unstaged moves; no lifecycle browsing |
| C3 | Category chips (Content / Technical / Quick wins) + sort (Value / Impact / Age) | `StrategyCockpit.tsx:41-45,146-182` | **at_risk** | — | Archetype grouping partially covers category, but sort + chips have no home |
| C4 | Fix-now pin (capped, by value, cross-facet) | `StrategyCockpit.tsx:75-78,116-123`; `cockpitRowModel.ts` `FIX_NOW_CAP` | **at_risk** | — | |
| C5 | NeedsAttentionStrip: stale_sent / superseded / new_reply nudges + jump-to-rec | `StrategyCockpit.tsx:63,113`; `NeedsAttentionStrip.tsx:4-14`; staleness scan cron (FEATURE_AUDIT.md:239) | **at_risk** | — | Server scan (`strategy-staleness-scan`) keeps writing nudges; UI consumer needed |
| C6 | CurationMeter ("N sent · curate, don't just send" over-send coach) | `CurationMeter.tsx:8-14`; `StrategyCockpit.tsx:112` | **at_risk** | — | |
| C7 | Bulk curation: predicate select-all-in-filter + sticky bulk bar → **Send / Throttle 7-30-90d / Strike (arm-confirm)** via atomic `POST /bulk` | `StrategyCockpit.tsx:93-103,230-243`; `CurationBulkActionBar.tsx:4-16`; `server/routes/recommendations.ts:595` | **at_risk** | — | The `/bulk` send spine is also what "Send issue" rides — losing the bar loses throttle/strike at scale |
| C8 | Per-row verbs: Send-to-client w/ note (CockpitSendPanel), Strike + confirm, Unstrike, Throttle picker, Mark fixed (`/fix`), Undismiss | `CockpitRow.tsx:145-232`; `recommendations.ts:884,925,943,961,984,543` | **at_risk** | — | Prototype rows expose only a Stage toggle |
| C9 | Per-rec **discussion thread** (client replies; get/post) | `recommendations.ts:1031,1038`; `RECOMMENDATIONS_DISCUSSION_UPDATED` `server/ws-events.ts:155` | **at_risk** | Possibly Recommendations/Inbox surface (`recs.js` / bottom-bar Inbox) | Receiving audit must claim it explicitly |
| C10 | Operator wording override (inline title/insight edit; regen-durable, display-boundary-applied) | `CockpitRow.tsx:23-26`; `PATCH …/:recId/wording` `recommendations.ts:851`; migration 145 (FEATURE_AUDIT.md:211 §11) | **at_risk** | — | |
| C11 | Add a rec the system missed (`AddRecommendationModal` → `POST /manual-rec`, `manual:` source, regen-retained) | `AddRecommendationModal.tsx:1-14`; `recommendations.ts:806`; `KeywordStrategy.tsx:805-813` | **at_risk** | — | Prototype's only additive path is client-request promotion (E2) |
| C12 | Client running-order reorder endpoint (UI cut at HEAD per audit B4; endpoint live) | `recommendations.ts:757` | **at_risk** (endpoint-only) | — | Decide: revive in rebuild or formally retire |
| C13 | Backing moves grouped by archetype, per-group counts, shortlist cap + "show the rest" | `BackingMovesQueue.tsx:2-16`; `KeywordStrategy.tsx:676-689` | preserved | `strategy.js:279-296` archetype groups (`bm-grp`/`bm-arch`) | |
| C14 | Local staging set (stage/unstage, reconciled against sendable set) + staged counter "N staged · M already with client" | `KeywordStrategy.tsx:191-199,531-566`; `strategy.js:375,430` "N of M staged" | preserved | Insights Engine stage toggles | Shared `isCuratedForClient` predicate keeps numerator/denominator honest — carry it over |
| C15 | **"Send issue" — the ONE client commit** (header button + docked send bar; atomic bulk send, clears staging) | `KeywordStrategy.tsx:553-560,636-645,696-716`; `IssueHeader.tsx:44-57` | **at_risk** | — | **The prototype has staging but NO send/commit control anywhere in `strategy.js`.** Hard stop until answered (Q1) |
| C16 | Cut→sentence contract: cutting a backing move strikes its POV sentence live | `KeywordStrategy.tsx:191,680`; `DraftedPovEditor.tsx:136-141` | **at_risk** | — | Prototype demonstrates neither cut nor the reflow |
| C17 | Competitor-rec send (`POST /competitor-rec`, `strategy-competitor-send` flag) | `recommendations.ts:692`; `KeywordStrategy.tsx:158-159,1021` | preserved | Competitors surface (Competitive tab moves there) | Receiving audit: Competitors |

### D. POV, stance, diff, signals

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| D1 | System-drafted POV: GET / generate / regenerate / PATCH edit (versioned, content-hash cached, admin+client variants) + `STRATEGY_POV_GENERATED` broadcast | `server/routes/strategy-pov.ts:36-114`; `server/ws-events.ts:111-113`; `useStrategyPov` | preserved | "The point of view we send Acme" + Edit POV (`strategy.js:401-411`) | Prototype shows Edit; explicit Regenerate affordance must survive (HEAD: `KeywordStrategy.tsx:650-651,663-672`) |
| D2 | POV-staleness nudge (cut/edited moves diverged from draft → regenerate) | `KeywordStrategy.tsx:574-580,657-673` | **at_risk** | — | |
| D3 | StanceBar — archetype allocation of the curated set (+ cut/parked totals) | `StanceBar.tsx:86-103`; `KeywordStrategy.tsx:646` | improved | "How we're spending the effort" proportional bar (`strategy.js:413-423`) | Prototype adds % weights; weights must derive from real rec data |
| D4 | StrategyDiff "What changed": Added/Retained/Reassigned/Retired summary, new/lost keywords, gap chips, reassignment rows (`GET /diff`) | `StrategyDiff.tsx:33-66,124-179`; `server/routes/keyword-strategy.ts:323` | improved | `changedPanel()` (`strategy.js:315-337`) adds "Why these matter" cards with per-row CTAs (Create brief / Refresh page) | CTA targets = pipeline/editor deep-links; wire, don't fake |
| D5 | Staleness nudges: (a) generated without volume validation → open inputs; (b) local data newer than strategy → regenerate; dismissible | `StrategyStalenessNudges.tsx:23-41`; `KeywordStrategy.tsx:449-459` | preserved | `stalenessNudge()` (`strategy.js:299-313`) — both kinds, dismiss, deep-link to wsettings | |
| D6 | IntelligenceSignals: momentum / content_gap / misalignment rows + freshness caption + "Recompute now" (`GET/POST signals`) | `IntelligenceSignals.tsx:40-53`; `keyword-strategy.ts:703,742` | preserved | `signalsSection()` (`strategy.js:184-199`) with count + computed-ago + Recompute | HEAD also has `strategy-signal-fold` flag (signals→recs); decide once |
| D7 | Lost-visibility recovery: top lost queries (was-#N, impressions at risk) + "Create recovery content" → pipeline | `LostQueryRecoveryCard.tsx:1-14`; `useLostVisibility` | **improved (restores dead code)** | `lostSection()` (`strategy.js:201-226`) | **At HEAD this component is exported but mounted NOWHERE** (grep: only `strategy/index.ts:35` + `types.ts:108`). Prototype gives it its first real home — additive win; wire to the real `lost_visibility` insight |

### E. The Issue operational spine (cron, trust, readiness, leads)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| E1 | Weekly Issue push cron: pre-bakes POV per ISO week per eligible workspace, stamps idempotency, rings **operator doorbell** (`issue.ready` in overview summary → NotificationBell deep-link to `seo-strategy`) | `server/strategy-issue-cron.ts:1-33`; `server/cron-registry.ts:310-312` | **at_risk** | — | Backend survives a UI rebuild, but the doorbell's deep-link target and bell consumer need a named home in the new shell |
| E2 | Client request promoted into the Engine as a backing move ("From a client request" group) / cockpit "Promoted to a strategy signal → backing move" | `strategy.js:366-374`; `cockpit.js:290-291` | **new_proposed** | Insights Engine | HEAD nearest paths: ClientKeywordFeedback approve→strategy (`KeywordStrategy.tsx:427-432`) and manual-rec mint. A generic request→rec promotion flow does not exist at HEAD — needs sign-off + data design |
| E3 | Trust ladder: per-archetype (quick_win, technical) earned auto-send toggles, 3-cycle streak, `GET/PATCH /api/auto-send-policy`, `STRATEGY_AUTOSEND_POLICY_UPDATED`, dark-launch flag `strategy-trust-ladder-autosend` | `TrustLadderPanel.tsx:170-181`; `server/routes/auto-send-policy.ts:4-5`; `server/ws-events.ts:118`; `shared/types/feature-flags.ts:90-95` | **at_risk** | — | Not in prototype |
| E4 | IssueSetupReadiness checklist (ga4/value/segment/events/webflow/POV ✓⚠ rollup, "N steps left", `?tab=` deep-links to fix surfaces) | `IssueSetupReadiness.tsx:1-13`; `KeywordStrategy.tsx:628-635`; `server/routes/the-issue-conversion-tracking.ts:46` | **at_risk** | possibly wsettings / onboarding (`onboard.js`?) | Flag `the-issue-client-measured-capture`; the integrity guard for every money number the Engine shows |
| E5 | AdminLeadsReadout: captured named leads (PII, admin-only), unbounded total badge, Load-more pagination, connect CTA | `AdminLeadsReadout.tsx:1-28`; `KeywordStrategy.tsx:726-748`; `the-issue-conversion-tracking.ts:91,120,155` | **at_risk** | possibly Outcomes/Action Results (`outcomes.js`) or Cockpit | |
| E6 | Outcome-value AI enrich proposer (`POST /outcome-value-enrich`, never persists, 502 on failure) | `server/routes/the-issue-admin.ts:28-46` | **at_risk** | wsettings outcome-value field (unverified) | |
| E7 | Issue lenses read-projection: content work-orders (stage pills, pipeline `?tab=` deep-links) + keyword targets (Hub `?q=` deep-links) (`GET /issue-lenses`) | `ContentWorkOrderLens.tsx:212-220`; `KeywordTargetsLens.tsx:1-14`; `server/routes/strategy-issue-lenses.ts:12-27`; `KeywordStrategy.tsx:761-779` | improved | "What each staged move becomes" lens tabs (`strategy.js:434-441,351-363`) | Prototype restores the KeywordTargetsLens that HEAD cut to a single deep-link row (audit B4) — additive win |
| E8 | Anomaly move → "Run deep diagnostic" | `strategy.js:287` (`window.Diagnostics.run()`) | **new_proposed** | Insights Engine per-move | HEAD has a Diagnostics page (`routes.ts:23`, `navRegistry.tsx:177`) but **no diagnostic trigger from strategy components** (grep: zero hits). Parity Ledger marks Diagnostics itself as surface-level **Gap/unassigned** — see Q7 |
| E9 | Client trust-spine preview ("What Acme sees") inside the admin Engine | `strategy.js:443-459` | **new_proposed** | Insights Engine footer | HEAD Phase 1 removed a preview-as-client toggle as a dead control (`IssueHeader.tsx:63-64` comment); reintroducing it needs the client spine to exist to preview |

### F. Tab content that fans out to other surfaces

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes (receiving audit must confirm) |
|---|---|---|---|---|---|
| F1 | Content tab: ContentGaps (intent-colored, SERP/AI-Overview chips), TopicClusters, DecayingPagesCard (refresh-brief / review-page / send-to-client), action-oriented EmptyState | `KeywordStrategy.tsx:930-960`; `DecayingPagesCard.tsx:1-15`; `ContentGaps.tsx`, `TopicClusters.tsx` | preserved (folded/moved) | Ledger: ContentGaps → "moves + Editor Research" (folded); TopicClusters → "a cluster-hub move" (folded); DecayingPages → "Pipeline → Content Health" | Folds must keep the per-item CTAs, incl. DecayingPages **Send to client** |
| F2 | Rankings tab: RankingDistribution + movements summary + Keyword-Hub deep-link | `StrategyRankingsTab.tsx:5,31-94` | preserved | Keywords / Traffic (ledger: RankingDistribution → "Keywords / Traffic") | |
| F3 | SiteTargetKeywords + rank tracking (trackKeyword) + **managed keyword working set** (add/remove/keep, `strategy-keywords-managed-set`, `STRATEGY_KEYWORD_SET_UPDATED`) | `KeywordStrategy.tsx:488-503,971-986`; `keyword-strategy.ts:775-812`; `ws-events.ts:162` | preserved | Keywords surface (ledger: SiteTargetKeywords → "Workspace inputs / Keywords") | Managed-set verbs must land in the Keywords rebuild |
| F4 | KeywordOpportunities incl. v3 "Interested?"→send spine + add-to-strategy-set seam | `KeywordStrategy.tsx:988-1003` | preserved | Keywords (ledger: "opportunity scoring") | The send affordance (enableSend) must not be dropped in the move |
| F5 | ClientKeywordFeedback: declined/requested/approved summary + "Add to Strategy" approve; feedback CRUD + bulk endpoints | `ClientKeywordFeedback.tsx:9-82`; `keyword-strategy.ts:615-687`; approve handler `KeywordStrategy.tsx:427-445` | preserved | Keywords · feedback panel (ledger note verbatim) | |
| F6 | Feedback-newer-than-strategy nudge | `KeywordStrategy.tsx:354-359`; `StrategyFeedbackNudge.tsx` | **at_risk** | — | Small nudge; not visible in `keywords.js`/`strategy.js` |
| F7 | Competitive tab: ShareBar share-of-voice, CompetitiveIntel, KeywordGaps (per-gap actions), BacklinkProfile | `KeywordStrategy.tsx:1013-1023`; `StrategyCompetitiveTab.tsx` | preserved | Competitors surface (ledger: KeywordGaps → "Competitors → gaps tab", CompetitiveIntel → Competitors) | |
| F8 | CannibalizationTriage: keeper marked, **KeeperSelector operator override** (regen-durable), Fix-in-editor, Mark-resolved (outcome), Send-to-client (dedicated client action) | `CannibalizationTriage.tsx:1-11`; `KeeperSelector.tsx:1-13`; mounted `KeywordStrategy.tsx:482-486,795` | **at_risk** | Ledger says "folded → a backing move" | The fold names the *card* but not the 4 sub-verbs (keeper override / resolve / fix / send). Uncertain = at_risk (Q5) |
| F9 | QuickWins / LowHangingFruit / KeywordGaps fallback sections (pre-rec-set strategies) | `KeywordStrategy.tsx:461-475,873-877,909-914` | preserved (folded) | Folded into moves + Competitors + Cockpit (ledger: QuickWins → Cockpit) | Fallback-when-rec-set-empty behavior must survive: no actionable content hidden behind an empty queue (`KeywordStrategy.tsx:513-517`) |
| F10 | AiVisibilityPanel (listed under strategy/ components) | ledger row: → "Brand & AI / AI Visibility"; `src/components/strategy/AiVisibilityPanel.tsx` | preserved | AI Visibility surface | Receiving audit: AI Visibility |

### G. Cross-cutting wiring (must be re-wired, not re-invented)

| # | Capability | Evidence (HEAD) | Status | Notes |
|---|---|---|---|---|
| G1 | WS-driven freshness: `STRATEGY_UPDATED`, `RECOMMENDATIONS_UPDATED`, `RECOMMENDATIONS_DISCUSSION_UPDATED`, `STRATEGY_POV_GENERATED`, `STRATEGY_AUTOSEND_POLICY_UPDATED`, `STRATEGY_KEYWORD_SET_UPDATED`, `SERP_SNAPSHOTS_REFRESHED` → React Query invalidations via `useWorkspaceEvents` | `server/ws-events.ts:111-167` | preserved | Every rebuilt panel needs its handler half (feedback-loop completeness rule) |
| G2 | Flag family: `strategy-command-center`, `strategy-the-issue`, `strategy-keywords-managed-set`, `strategy-competitor-send`, `strategy-signal-fold`, `strategy-trust-ladder-autosend`, `strategy-divergence-sweep`, `the-issue-client-measured-capture` | `shared/types/feature-flags.ts:72-110,476` | preserved | Owner direction (P2 prep): rebuild retires UI-shell flags; backend flags stay on lifecycle |
| G3 | State machines / single-writer lifecycle (`validateTransition`, `recommendation-lifecycle.ts`), `isActiveRec`/`isCuratedForClient` shared predicates | `shared/recommendation-predicates.ts`; `KeywordStrategy.tsx:5,531-548` | preserved | Hard stop from the kit: "a struck rec must never read as completed" — reuse the predicates verbatim |
| G4 | Client/public recommendation surface (public GET/PATCH/act-on/responses, one-pager + my-leads exports) | `recommendations.ts:118-490`; `server/routes/the-issue-export.ts:38,57` | preserved (other surface) | Owned by Recommendations / Client portal audits; listed for the send-spine dependency |

---

## Prototype coverage summary

**Demonstrates (maps to HEAD):** staleness nudges (both kinds), What-changed diff panel (+ upgraded "why" CTA cards), POV block + Edit, stance/allocation bar, intelligence signals + recompute, lost-visibility section (restores an unmounted HEAD component), archetype-grouped backing moves with staging, lens tabs (keyword targets / content work orders — restores the cut KeywordTargetsLens), client-request-promoted move, wsettings relocation of Strategy inputs.

**Omits (⇒ at_risk above):** the entire curation machinery beyond staging — lifecycle facets, fix-now pin, category/sort, bulk bar (send/throttle/strike), per-row verbs (send-with-note, strike/unstrike, throttle, mark-fixed), discussion threads, wording overrides, manual add-rec, **the Send-issue commit itself**, cut→sentence, POV-staleness nudge, trust ladder, setup readiness, leads readout, weekly-push doorbell target, full/incremental generation modes, refresh-ordering prompt, how-it-works, feedback nudge, `?tab=` deep-link continuity.

**Proposes new (needs sign-off):** admin verdict headline (B2), money frame with agency-estimate basis (B3), client-request→backing-move promotion flow (E2), per-move deep-diagnostic trigger (E8), client trust-spine preview (E9).

## Parity Ledger reconciliation

- Strategy surface row: **improved**; zero Gap/Partial sub-tool rows. The ledger's own open item is its note: *"Verify the page↔keyword mapping surface is fully represented"* — page↔keyword mapping at HEAD lives in the strategy blob (`pageMap`, exposed via Page Intelligence → SEO Editor Research mode per the Page Intelligence ledger row) and in per-page keyword sections; the Engine prototype does not show it. Treated as **cross-surface at_risk** — the SEO Editor / Keywords audits must claim `pageMap`.
- Ledger rows claiming relocation were verified against the mockup where possible: StrategySettings/ConfigPanel → wsettings ✓ (`wsettings.js:169-200`); LostQueryRecoveryCard → Insights Engine ✓ (`strategy.js:201-226`); IntelligenceSignals → Insights Engine ✓ (`strategy.js:184-199`). Rows pointing at other surfaces (KeywordGaps→Competitors, DecayingPages→Pipeline, OrientZone/QuickWins→Cockpit, RankingDistribution→Keywords/Traffic, AiVisibilityPanel→AI Visibility, ClientKeywordFeedback→Keywords) are **delegated** to those surface audits.
- Ledger discrepancy worth flagging: it marks `StrategyCockpit / CockpitRow` **present** "at the spine + moves", but the mockup's move rows carry none of CockpitRow's verbs — the ledger's "present" is optimistic relative to the drawn prototype (rows C2–C11, C15).
- Only surface-level **Gap** in the whole ledger touching this audit: **Diagnostics (unassigned)** — relevant because the prototype's Engine adds a "Run deep diagnostic" hook into it (E8/Q7).

## Quick-win vs full implementation trade-offs

| Item | Quick win | Full version | Risk of quick win |
|---|---|---|---|
| Engine spine | Re-skin the existing Issue branch (IssueHeader→StanceBar→POV→BackingMovesQueue) with design-system components; keep Disclosure groups | Full prototype IA: verdict + money frame + signals/lost-visibility sections inline | Quick win ships without the verdict/money framing the redesign is *for*; acceptable only as an interim milestone |
| Money frame (B3) | Show only fields with existing data plumbing: avg position (Orient), backing-moves live count (rec set), per-rec estimatedGain sum labeled "Agency estimate" | Real recovered-value + pipeline-at-stake from outcome tracking / computeROI with provenance pills | Quick win risks a number the client-facing law forbids the UI to compute; needs a server field either way |
| Lost visibility (D7) | Mount the existing (currently dead) LostQueryRecoveryCard as-is | Prototype's richer rows (was-#N, impressions-at-risk per query) + bulk "create recovery content" | Low — component + insight data already exist |
| What changed (D4) | Keep HEAD StrategyDiff inside a Disclosure | Prototype's why-cards with per-row Create-brief / Refresh-page CTAs | Quick win loses the new CTA affordance (additive, can follow) |
| Curation verbs (C2–C11) | Keep StrategyCockpit mounted below the Engine spine (as HEAD does today behind flags) until the new move-row detail absorbs the verbs | Move-row drawer/detail exposing send/strike/throttle/fix/wording/discussion per prototype's component system (Drawer, DataList) | Quick win = two stacked paradigms on one page; full version without a drawer spec risks silent verb loss — hard stop either way is: no verb dropped |
| Send issue (C15) | Reuse HEAD's docked send bar verbatim on the new surface | Whatever commit affordance design answers Q1 with | None — the docked bar is already the audited, single-commit pattern |
| Signals (D6) | Keep IntelligenceSignals panel | Decide `strategy-signal-fold` (signals become recs) and build once | Building the panel then folding = double work; decide before build |

## Open questions (stop-and-ask — owner/design must answer; never decide by omission)

1. **Where is the "Send issue" commit in the new Engine?** `strategy.js` stages moves but has no send/commit control (C15). Options: (a) header primary button as at HEAD, (b) docked send bar as at HEAD, (c) staging auto-commits (would violate the one-commit model B5 established). 
2. **Does the Insights Engine absorb the full curation machinery (C2–C11) or does curation live elsewhere?** The Parity Ledger marks StrategyCockpit "present" but the prototype doesn't draw the verbs. Options: move-row drawer on the Engine / a separate curation lens / keep StrategyCockpit as a second section.
3. **`?tab=` deep-link continuity (A11):** old `seo-strategy?tab=rankings|content|competitive` URLs — redirect map to Keywords/Pipeline/Competitors, or 301 to the Engine root?
4. **Homes for the operational spine:** trust ladder (E3), setup readiness (E4), leads readout (E5), weekly-push doorbell target (E1), outcome-value enrich (E6). Options: Engine collapsed section / wsettings / Cockpit / Outcomes.
5. **Cannibalization fold (F8):** when cannibalization becomes "a backing move", where do KeeperSelector, Mark-resolved, Fix-in-editor, and the dedicated Send-to-client land? 
6. **Money frame + verdict (B2/B3):** sign off the data contract (which server-computed fields, which provenance/basis pill) before any UI shows an admin-side dollar figure.
7. **Deep diagnostic hook (E8):** Diagnostics is itself a ledger Gap ("no home … decide whether it belongs in Settings/Admin, or is intentionally cut"). Confirm Diagnostics' fate before wiring the Engine's anomaly hook to it.
8. **Generation modes (A2/A3):** does the rebuild keep full-vs-incremental and the refresh-ordering prompt, or collapse to one "Regenerate" + scheduled cadence? Collapsing silently changes cost/latency behavior and the local-data-ordering guard.
9. **Client-request promotion (E2):** confirm scope — is this ClientKeywordFeedback-approve rebranded, or a new inbox-request→manual-rec promotion path (new server work)?
10. **Page↔keyword mapping** (ledger's own verify note): confirm the Keywords / SEO Editor audits claim `pageMap` so the Engine can drop it without loss.

## Status counts

- preserved: 25 (A1, A5, A6, A7, A10, B1, C1, C13, C14, C17, D1, D5, D6, F1, F2, F3, F4, F5, F7, F9, F10, G1, G2, G3, G4)
- improved: 5 (A4, D3, D4, D7, E7)
- new_proposed: 5 (B2, B3, E2, E8, E9)
- at_risk: 26 (A2, A3, A8, A9, A11, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C15, C16, D2, E1, E3, E4, E5, E6, F6, F8)

Total capabilities enumerated: 61 rows (sections A:11, B:3, C:17, D:7, E:9, F:10, G:4 — the 4 G rows are wiring contracts rather than user-visible capabilities; 57 user-facing capabilities + 4 wiring contracts).
