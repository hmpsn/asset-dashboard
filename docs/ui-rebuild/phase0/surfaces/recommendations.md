# Phase 0 Additive-Parity Ledger — Recommendations (Client-facing)

- **Surface:** Recommendations · zone: CLIENT-FACING (handoff brief 18-surface map: "CLIENT-FACING · Recommendations · Client portal")
- **Branch audited:** `ui-rebuild-phase-0` (== post-Reconcile `origin/staging` HEAD)
- **Prototype view:** `hmpsn studio Design System/mockup/recs.js` (256 lines — a SPLIT view: operator triage desk on the left + a live "What Acme sees" client-portal preview on the right). This ledger covers the **client-facing half**; the operator desk half belongs to the admin Recommendations/Strategy-cockpit surface audit. Overlaps are flagged, not adjudicated.
- **Canonical contracts doc:** `docs/rules/strategy-recommendations.md` (two-axis model, single-writer, `isActiveRec`, carry-over, auto-resolve exemption, public allow-list, `REC_POLICY_REGISTRY`)
- **Auditor stance:** additive-only. Anything uncertain is `at_risk`, never `preserved`.

## 1. Where recommendations reach the client at HEAD (4 mounts + 1 mirror)

| Mount | File | Notes |
|---|---|---|
| The Issue client overview (curated feed) | `src/components/client/the-issue/TheIssueClientPage.tsx:118-561`, mounted from `src/components/client/OverviewTab.tsx:135,158,219` when `strategy-the-issue` is ON | The evergreen money surface: content-plan hero + also-on-plan + next-bets + loop footer |
| Legacy InsightsEngine "Prioritized Action Plan" | `src/components/client/InsightsEngine.tsx:133-739`, sole live mount = Health tab `actionPlanSlot`, `src/components/ClientDashboard.tsx:632-637` | Full self-serve action plan (status updates, dismiss, cart, regenerate). `compact` mode (lines 308-405) currently has **no live mount** — capability exists but is unmounted |
| Overview "#1 Priority" top-rec card | `src/components/client/OverviewTab.tsx:120-132, 395-440` | topRecommendationId + opportunity-score badge + "Why this is #1" contribution bars |
| Client Inbox mirror | `src/components/client/inbox/UnifiedInbox.tsx:547-600` | `recommendation`-type deliverables render respond-ONLY (write verbs disabled; review → nudge toast to Strategy hub; server 409s generic /respond) |
| (admin-side feeders that the client experiences) | send + bulk-send email `server/routes/recommendations.ts:651,910` (`notifyClientCuratedRecsSent`); weekly trust-ladder auto-send cron `server/strategy-issue-cron.ts:199,223` | These fill the client feed / client email inbox |

## 2. Capability table

Status legend: **preserved** = obvious same-or-better home in prototype · **improved** = prototype upgrades it · **new_proposed** = prototype-only, needs sign-off · **at_risk** = exists at HEAD, no visible home in prototype.

### A. Public API / data contract

| # | Capability | Evidence (file:line) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| A1 | Public GET set — `GET /api/public/recommendations/:ws` with `?status=`, `?priority=`, `?clientStatus=` filters; empty-set on cache miss (never inline generation); 404 on unknown ws; soft client-portal auth | `server/routes/recommendations.ts:150-166`; `server/client-insight-recommendation-view-model.ts:20-46,88-100` | preserved | Client portal Recommendations page data source | Prototype's client preview = `clientStatus ∈ {sent, approved}` subset; HEAD curated feed reads `?clientStatus=sent` |
| A2 | Allow-list public projection — EMV/`predictedEmv`/`roiPerEffortDay` stripped, `estimatedGain` sanitized, `impactBand` computed from raw emvPerWeek ($25 floor / $2,000 cap), admin lifecycle axis (`lifecycle`, `struckAt`, `cascade`, `sendChannel`, `throttledUntil`, `sentAt`) NEVER serialized | `server/recommendation-public-projection.ts:37-86`; contract: `docs/rules/strategy-recommendations.md` §Public read | at_risk | Must be the ONLY read path for the rebuilt surface | **Trust-critical.** Prototype card shows "≈ $3,900/mo pipeline" — a raw dollar figure. Rebuild must render only the banded `impactBand.monthlyRangeUsd`, never raw EMV. Kit CLAUDE.md rule 8 ("never change a client-facing number") + this allow-list must be reconciled |
| A3 | Restricted `clientStatus` exposure (`sent/approved/declined/discussing` only) + `delivered` flag + server-computed `actOn` descriptor, all gated per-workspace on `strategy-the-issue` (flag-OFF byte-identical) | `server/recommendation-public-projection.ts:16-35,76-83`; `shared/types/recommendations.ts:282-336` | at_risk | Rebuilt cards must consume `actOn`, not re-derive | Prototype has no descriptor concept; re-deriving lock state client-side was an audited blocker (B1) |
| A4 | Operator wording overrides + client running-order sort applied at the display boundary (flag ON) | `server/client-insight-recommendation-view-model.ts:39-43,102-122`; `server/rec-operator-overrides.ts` | at_risk | Invisible plumbing — rebuild keeps it for free ONLY if it reads A1 | If the rebuild fetches recs any other way, operator-corrected copy/order silently vanishes |
| A5 | Client-safe response summary — `GET /:ws/responses` → `{approved, declined, discussing, recent[≤5]}` | `server/routes/recommendations.ts:489-499`; `server/client-insight-recommendation-view-model.ts:62-86` | at_risk | Loop footer / "you've greenlit N" | No loop-count render anywhere in prototype |
| A6 | Resilient curated feed read (`getSafe` → empty set, never an error card, for thin/new clients) + separate query keys (`client.theIssue` vs `shared.recommendations` vs `client.curatedRecommendations`) | `src/api/theIssue.ts:41-87`; `src/components/client/the-issue/useClientTheIssue.ts`; `src/lib/queryKeys.ts:257-342` | at_risk | Data-fetch layer of the rebuilt page | Degrade-to-floor behavior is deliberate (content floor, 2-state) |

### B. Client decisions / writes

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| B1 | **Act-on greenlight** — `POST /:ws/:recId/act-on`: single-writer `clientStatus sent\|discussing → approved`, atomic with a durable content REQUEST (`dedupe:false`, rec lineage + StrategyCardContext, briefId null — NOTHING generated), TrackedAction attribution, deliverable-mirror lockstep sync, dual broadcasts, activity log | `server/routes/recommendations.ts:340-475`; `server/recommendation-lifecycle.ts:116`; hook `src/hooks/client/useActOnRecommendation.ts` | preserved | Prototype "Approve & go" button (`recs.js:196`, `_recApprove` 253) | Prototype demonstrates the click; the request-not-generate semantics + attribution join + mirror sync are backend contracts the rebuild must not weaken |
| B2 | Server-authoritative pricing gate — free tier + monetizable RecType → `403 {requiredTier:'growth'}` BEFORE the transaction; UI mirror = `actOn.mode:'locked'` → TierGate upsell (never an active button) | route `server/routes/recommendations.ts:353-366`; UI `src/components/client/the-issue/IssueContentCard.tsx:104-110,183-194` | at_risk | Locked state of the rebuilt card | Prototype has NO locked/tier state. Kit says every surface owes a "locked" state — this is that state's real contract |
| B3 | Confirm dialog before greenlight (rec headline + no-charge consequence line; Cancel writes nothing) | `src/components/client/the-issue/IssueContentCard.tsx:222-235`; copy `evergreenCopy.ts` | at_risk | Rebuilt card decision flow | Prototype approves in one tap with no confirm — a regression against audit blocker D1/D3 if copied literally |
| B4 | Greenlight verb split — monetizable → "Request this", non-monetizable → "Discuss this" (label only; both hit act-on) | `IssueContentCard.tsx:105-106` | at_risk | Rebuilt card CTA label | Prototype uses "Approve & go" for everything |
| B5 | Relevance feedback — Relevant / Not-relevant per target keyword (writes keyword-feedback spine; declined disables greenlight) | `TheIssueClientPage.tsx:207-208`; `IssueContentCard.tsx:141-168,211` (`disabled={isActingOn \|\| declined}`) | at_risk | No home in prototype recs view | Feeds strategy keyword-feedback; losing it severs a client-input loop |
| B6 | "Let's talk" soft-yes — opens AI advisor pre-seeded with the move (title + targetKeyword) | `TheIssueClientPage.tsx:211-216`; `IssueContentCard.tsx:197-204` | at_risk | Prototype's "Discuss" button is the closest analog but implies a status write (see N2) | HEAD's soft-yes does NOT change clientStatus |
| B7 | Legacy self-serve status updates — client PATCHes `pending→in_progress→completed` ("I'll Handle This" / "Mark Done"; premium "Start Working On This" / "Mark Complete"); completion mirrors affected pages to live state + records outcome action + broadcasts | route `server/routes/recommendations.ts:173-286`; UI `InsightsEngine.tsx:200-211,613-676` | at_risk | None visible | Whole self-serve action-plan interaction model absent from prototype |
| B8 | Legacy dismiss — client `DELETE /:ws/:recId` (read-before-dismiss activity log, broadcast) | route `:289-310`; UI `InsightsEngine.tsx:214-225,688-698` | at_risk | None visible (prototype dismiss is operator-side) | |
| B9 | Client-triggered regeneration — `POST /:ws/generate` background job (dedupes onto active job), tracked via `useBackgroundTasks`, cache invalidated on done | route `:118-136`; UI `InsightsEngine.tsx:144-197,291-303` | at_risk | None visible | The client's own "Refresh" affordance |
| B10 | Per-item purchase CTA — `productType`/`productPrice` recs add to SEO cart ("Let Us Fix This — $X" / "Order Content Brief — $X"), In-Cart state, premium-upsell footer ($999/mo) | `InsightsEngine.tsx:498,637-658,713-728`; `useCart` | at_risk | None visible | Revenue path (per-item content purchases per MONETIZATION.md); prototype has no pricing UI at all (and The Issue surface deliberately bans pricing copy — two different HEAD behaviors on two mounts) |

### C. Display / composition

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| C1 | Curated content-plan HERO — content-archetype recs (authority_bet) sorted by opportunity, emphasized lead card, value-first copy, 2-state content floor (cards OR one honest line, never filler) | `src/components/client/the-issue/IssueContentPlanSection.tsx:85-137` | preserved | Prototype client cards show client-friendly title + plain-language why + impact band (`recs.js:182-199`) | Floor state ≈ prototype's "Nothing waiting on you right now" empty (`recs.js:240`) |
| C2 | "Also on your plan" — non-content moves grouped by archetype with client-friendly labels (refresh/defend/quick-win/technical/local), counts, link-outs | `IssueAlsoOnPlanSection.tsx:34-88`; `src/lib/recArchetypeMap` | at_risk | None visible — prototype's client preview lists every shared rec flat | Archetype grouping + jargon-free label map is a persona-audit outcome |
| C3 | "Your next bets" $-forecast band — top ~3 moves as banded monthly $ (from `impactBand.monthlyRangeUsd`) + outcome-unit equivalent only when ≥1; renders nothing below the $ floor; deliberately NO per-bet greenlight (hands off to plan) | `IssueNextBetsSection.tsx:1-114`; `nextBetsForecast.ts`; flag `the-issue-client-next-bets` | at_risk | None visible | NOTE: FEATURE_AUDIT.md entry #607 (line 8648) still claims a per-bet "Act on this" — the code removed it (adversarial review C1/I1/M1). Code is authoritative; doc drift |
| C4 | Loop footer — "you've greenlit N moves · M in discussion" + briefs-in-flight + quick-question advisor seeds; jump anchor from the "Your turn" strip | `IssueLoopFooter.tsx:28-86`; `TheIssueClientPage.tsx:271-279,390-413`; `useClientRecResponses.ts` | at_risk | None visible | The client-side close-the-loop render |
| C5 | Verdict/status headline tie-in — `summary.topRecommendationId` → topRec feeds IssueVerdictHeadline + NarratedStatusHeadline | `TheIssueClientPage.tsx:195-197,288,425,463` | at_risk | None visible in recs view (may belong to Client-portal overview surface — boundary question Q7) | |
| C6 | Overview "#1 Priority" card — top rec with opportunity Score badge (0-100, never $) + "Why this is #1" component-contribution bars; navigates to Health | `OverviewTab.tsx:120-132,395-440` | at_risk | None visible | Graceful for legacy recs without `opportunity` |
| C7 | Legacy priority grouping — fix_now/fix_soon/fix_later/ongoing sections with per-priority descriptions, expand/collapse (`useToggleSet`), pending/in-progress/done counts, impact + effort badges, affected-pages chips (8 + overflow), traffic/impressions-at-risk, estimated gain, generated timestamp footer | `InsightsEngine.tsx:66-129,407-739` | at_risk | Prototype shows impact + effort chips per card (`recs.js:174-177` operator side; client card impact band only) but no priority taxonomy, no affected pages, no counts | The whole four-priority information architecture is absent |
| C8 | `competitor` rec client renderer gate — hidden until `strategy-competitor-send` ON (a sent competitor rec must not surface before its renderer exists) | `InsightsEngine.tsx:136-138,236-238` | at_risk | Pattern must carry to any rebuilt renderer | Guard-by-construction against renderer-less types |
| C9 | Inbox mirror respond-only card — recommendation deliverables show in Unified Inbox with write verbs disabled + "act on it from your Strategy hub" nudge; server 409s generic respond | `UnifiedInbox.tsx:547-600`; `server/domains/inbox/send-to-client.ts` | at_risk | Prototype has no inbox concept in recs view | Cross-surface: also flag to the Inbox surface auditor |
| C10 | Client-approved confirmation state ("greenlit card drops out of feed; footer count ticks up"; toast names the plan + no-charge consequence) | `useActOnRecommendation.ts:35-46`; `evergreenCopy.ts` (`ISSUE_REQUEST_SUCCESS_TOAST`) | preserved | Prototype approved card: "You approved this — the team is on it. We'll update you here." (`recs.js:183-189`) | Prototype's persistent in-list approved card is arguably an IMPROVEMENT over HEAD's drop-out (HEAD shows the count only) — see Q5 |
| C11 | States — loading ("Analyzing your site…"), error + retry, empty aware of active/failed generation job ("Generating…" / "Refresh failed" + job error message) + Refresh CTA, Issue skeleton loading, TierGate locked, preview-mode read-only | `InsightsEngine.tsx:248-306`; `TheIssueClientPage.tsx:229-239`; `IssueContentCard.tsx:183-194`; previewMode `TheIssueClientPage.tsx:205-208,396-401` | at_risk | Kit demands all four states per surface | Prototype demonstrates only empty; job-aware empty state is richer than anything shown |
| C12 | Admin "Preview as client" read-only mode — act-on/feedback suppressed, loop footer replaced with explainer, leads suppressed | `TheIssueClientPage.tsx:94-95,131,205-208,268,339,396-401` | at_risk | None visible | Operator-safety affordance |

### D. Real-time, jobs, lifecycle plumbing (client-experienced)

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| D1 | WS-driven freshness — `RECOMMENDATIONS_UPDATED` invalidates `shared.recommendations` + `client.theIssue` + `client.recResponses` + `client.curatedRecommendations`; `DELIVERABLE_SENT/UPDATED` covers the mirror | `src/lib/wsInvalidation.ts:416-429,617-618,648-660` | at_risk | Both-halves broadcast contract (CLAUDE.md data-flow #1/#2) | Any rebuilt fetch layer must re-register these |
| D2 | Generation as a background job — `RECOMMENDATIONS_GENERATION` job type, active-job dedupe, notification-bell tracking | `server/routes/recommendations.ts:118-136`; `InsightsEngine.tsx:144-157,190-197` | at_risk | With B9 | |
| D3 | Curated-send client email — `notifyClientCuratedRecsSent` on per-row send + bulk send | `server/routes/recommendations.ts:39,651,910` | preserved (untouched by UI rebuild) | Server-side | Listed so the touchpoint isn't orphaned if send UX moves |
| D4 | Weekly trust-ladder auto-send fills the client feed (earned buckets only, `autoSent` marked, recall-based review window) | `server/strategy-issue-cron.ts:199,212-223`; flag `strategy-trust-ladder-autosend` | preserved (server-side) | Server-side | Client surface must keep rendering auto-sent recs identically to manual sends |
| D5 | Regen continuity — `applyLifecycleCarryOver` (sent/approved survive regen with id + sentAt lineage), auto-resolve exemption (`sent/discussing/approved`), struck≠completed guard (`StruckRecCompletionError`), signal-rec guard | `docs/rules/strategy-recommendations.md:107-150,255-264`; `server/domains/recommendations/rules.ts:264`; `finalization.ts` | preserved (server-side, untouched) | Server-side | The invariant the kit itself restates: "a struck rec must never read as completed" |
| D6 | `isCuratedForClient` — the client-seen-set predicate (`clientStatus∈{sent,approved,discussing}` minus struck) used by POV client variant + projections | FEATURE_AUDIT.md:211 (#525 Phase 0); `shared/recommendation-predicates.ts` | preserved (server-side) | Server-side | |

### E. Tier gates, flags, deep links

| # | Capability | Evidence | Status | Notes |
|---|---|---|---|---|
| E1 | Flags gating this surface: `strategy-the-issue` (mount + projection), `the-issue-client-spine`, `the-issue-client-next-bets`, `the-issue-client-return-hook`, `client-ia-v2`, `strategy-competitor-send`; all default OFF; client `useFeatureFlag` resolves GLOBAL flags only (per-workspace overrides gate the server, not the client render) | `shared/types/feature-flags.ts:77-115,308-480`; CLAUDE.md flag-scope rule | at_risk | The rebuild's own flag strategy must map each of these to a decision (owner direction 2026-07-02: rebuild retires UI-shell flags; backend flags on lifecycle) |
| E2 | Tier semantics — premium ("we handle it") vs growth/free (cart or self-serve) InsightsEngine variants; free+monetizable act-on lock | `InsightsEngine.tsx:159,432-444,613-686`; `recommendation-public-projection.ts:29-35` | at_risk | Three-tier behavior matrix nowhere in prototype |
| E3 | Deep links — "See the details" → `strategy` tab, or under `client-ia-v2` → `deep-dive?sub=rankings&tab=rankings` (both halves of the `?tab=` contract); betaMode path variants | `TheIssueClientPage.tsx:217-226`; `src/routes.ts` `clientPath` | at_risk | Rebuild must re-home these destinations when IA changes |

### F. Prototype-only (new proposals — need sign-off)

| # | Capability | Evidence | Status | Notes |
|---|---|---|---|---|
| N1 | Standalone client-portal **Recommendations page/route** (`acme.hmpsn.studio/recommendations`, "Recommended for you") | `recs.js:230-243` | new_proposed | HEAD has NO dedicated client recommendations tab — recs live inside Overview (The Issue), Health (InsightsEngine), and Inbox (mirror). Consolidation is plausible-but-unowned (Q1) |
| N2 | Working **"Discuss"** decision on the client card | `recs.js:197` | new_proposed | The `sent→discussing` edge exists in `server/state-machines.ts:129-134` and is COUNTED (loop footer, responses view) but has **no writer anywhere at HEAD** (no route, no lifecycle function — verified: `recommendation-lifecycle.ts` exports send/autoSent/approve/strike/unstrike/throttle/fix only). Prototype implies building the write. HEAD's nearest behavior is the "Let's talk" advisor pre-seed (no status change). Decision needed (Q2) |
| N3 | Client sees operator **recall** (a sent rec disappearing from the portal) | `recs.js:159,252` (`_recUnsend` → status back to new) | new_proposed | HEAD has no `sent→system` unsend transition; nearest is strike (lifecycle suppression, leaves curated projection). Admin-surface overlap — flag to that auditor too (Q6) |
| N4 | Client-card **category taxonomy** (Opportunity / Anomaly / Site audit / Content tags on client cards) | `recs.js:100-105,169` | new_proposed | HEAD client cards do not show a source-category tag; HEAD taxonomies are RecType (15 values) + archetype (6 buckets). A third taxonomy needs mapping + sign-off |
| N5 | Persistent **approved card stays in the client list** ("You approved this — the team is on it. We'll update you here.") | `recs.js:183-189` | new_proposed (improvement candidate) | HEAD drops greenlit recs out of the feed (`clientStatus` no longer `sent`) and shows only footer counts + Inbox/requests tracking. Prototype's in-place progress promise is arguably better UX — but "We'll update you here" creates an update-delivery obligation that needs a real data home (content-request status join, cf. issue-lenses stage model) |

## 3. Prototype coverage notes

**Demonstrated by `recs.js` (client half):** curated-subset visibility (sent+approved only), plain-language client title/why distinct from operator copy (≈ HEAD's wording-override + client-projection layers), impact value band with sub-line, effort framing, one-tap approve, discuss affordance, approved confirmation, empty state, shared-count badge.

**Demonstrated but belonging to the admin surface:** triage queue (share / keep internal / dismiss / restore), flow ribbon (Generated → You triage → Stage into Insights Engine → Client approves → pipeline), recall, "Waiting on Acme" / "queued into Content Pipeline" status notes. The ribbon's third step ("Stage into Insights Engine — becomes a client-tracked move") matches HEAD's stage-local + single "Send issue" commit model (FEATURE_AUDIT #525 B5).

**Omitted by the prototype (the at_risk list above):** tier/locked state, confirm dialog, relevance feedback, soft-yes advisor seed, loop-footer counts, next-bets forecast, self-serve status/dismiss/regenerate, cart purchases, priority taxonomy, affected pages, top-rec overview card, inbox mirror, WS freshness, job-aware empty states, preview mode, competitor renderer gate, wording-override/running-order dependency on the canonical read path.

**Prototype fidelity hazards:** (1) raw "$3,900/mo pipeline" on a client card vs HEAD's banded-only, EMV-stripped contract (A2); (2) one-tap approve with no confirm vs audit blocker D1/D3 (B3); (3) `.rec-card` per-view CSS and purple category chips (`cat-content` uses `--purple`) — purple is admin-AI-only and must not reach client-facing cards (Four Laws / kit rule 4).

## 4. Parity Ledger reconciliation

The Platform Parity Ledger is explicitly **"Migration Parity Audit · Admin surfaces"** built from `navRegistry.tsx` (admin `Page` union). It contains **no rows for the client-facing Recommendations surface** — client capability tracking for this zone exists only in this Phase-0 ledger.

Rows that touch this surface indirectly:

| Ledger row | Status there | Relevance / resolution |
|---|---|---|
| Strategy (`KeywordStrategy · seo-strategy`) | improved — "Reframed as the client-facing Insights Engine (recommendations + the issue merged). Verify the page↔keyword mapping surface is fully represented." | The merge target is the admin Insights Engine surface; the CLIENT half of that merge is exactly this ledger. The page↔keyword verify item belongs to the Strategy/Keywords auditors. Not resolvable here |
| Requests (`RequestManager · requests`) → "Inbox (bottom bar), moved, function intact" | moved | The act-on-created content requests surface to the client via requests/inbox — the rebuilt inbox must keep rendering rec-lineage requests (cross-check with Inbox auditor) |

**Gap recorded:** no Parity Ledger coverage of client-facing surfaces at all (see structured `parityLedgerGaps`).

## 5. Trade-offs — quick win vs full

| Item | Quick win | Full version | Risk of the quick win |
|---|---|---|---|
| Curated feed page | Ship prototype's list reading `?clientStatus=sent` + act-on POST, states: populated/empty | Port the full IssueContentCard decision row: server `actOn` descriptor → TierGate locked state, confirm dialog, verb split, relevance feedback, soft-yes | Free-tier client tapping Approve on a monetizable rec hits a bare 403 (route gate stays, UI mirror gone); loses feedback + soft-yes loops; violates audit blockers B1/D1 already litigated at HEAD |
| Legacy self-serve action plan (InsightsEngine) | Keep the existing component mounted as-is inside the new shell (it is self-contained: own fetch, states, cart, jobs) | Rebuild it in the design system as the client "action plan" module of the new page | Quick win carries old-styling debt into the new IA but loses nothing; REBUILDING WITHOUT IT loses B7-B10 (self-serve status, dismiss, regenerate, per-item purchases) — hard stop |
| Discuss | Keep HEAD behavior: "Discuss" = advisor pre-seed (no status write) | Implement `sent→discussing` public write + client `rec_discussion` thread (route + single-writer fn + WS + UI); edges already defined in `state-machines.ts:133` | Quick win: prototype's Discuss silently doesn't change status; loop-footer "M in discussion" stays 0 forever (it already does at HEAD — no writer). Full: new public write surface needs its own review |
| Next bets / loop footer / return-hook extras | Omit initially (all are flag-gated, default OFF at HEAD) | Port each band as a design-system module when its flag graduates | None at flag-OFF parity, BUT each capability must keep a named home; dropping the code path silently = loss by omission |
| Inbox mirror | Keep respond-only mirror card exactly as-is | Deep-link the mirror card straight to the rebuilt recommendations page card | Quick win preserves; skipping the mirror entirely orphans sent recs from the inbox timeline |

## 6. Open questions (stop-and-ask — owner sign-off required)

1. **Canonical home:** Prototype proposes a standalone client "Recommendations" portal page. HEAD spreads recs across The Issue overview, Health action-plan slot, Overview #1-priority card, and the Inbox mirror. Which becomes canonical, and do the other mounts persist, redirect, or fold in?
2. **Discuss write:** build the `sent→discussing` client write (edge exists, zero writers at HEAD) or keep Discuss = advisor pre-seed? Note the loop footer already advertises a count that nothing can increment.
3. **Legacy self-serve capabilities** (client status updates, dismiss, regenerate, cart purchase CTAs): explicitly preserved, or deliberately retired with owner sign-off? They are absent from the prototype and revenue-relevant.
4. **Client-facing dollar display:** prototype shows raw "$/mo pipeline"; HEAD only exposes banded `impactBand` under flags. Confirm the rebuild renders banded values only (A2 is a trust invariant, not a styling choice).
5. **Approved-state UX:** adopt prototype's persistent "you approved this — we'll update you here" card (needs a status-join data home) or keep HEAD's drop-out + counts?
6. **Recall semantics** (admin overlap): is prototype "recall" = strike, or a new unsend transition? Client-visible either way.
7. **Boundary:** verdict/status headline (C5) and the wider Issue spine — owned by this surface or the Client-portal overview surface? Both auditors should agree on who carries topRec.
8. **Doc drift:** FEATURE_AUDIT #607 describes a per-bet greenlight the code removed — update the audit entry (out of scope for read-only Phase 0; flagging).

## 7. Cross-checks performed

- `docs/rules/strategy-recommendations.md` read in full (two-axis, single-writer, predicates, carry-over, policy registry, R4 mirror contracts).
- FEATURE_AUDIT.md grepped: #525 (The Issue Phases 0-6 + steering batch, line 209-219), #607 (next bets, 8645-8656), The Issue (Client) P0/P1a/P1b/P1c entries (8396-8515), client-briefing-v2 teardown (8489-8503).
- Platform Parity Ledger + UI Rebuild Handoff Brief extracted (`textutil`) and searched; ledger confirmed admin-only scope.
- Feature-flag catalog read for all six gating flags (`shared/types/feature-flags.ts`).
- Verified no writer exists for `clientStatus:'discussing'` (grep across `server/`, lifecycle exports at `recommendation-lifecycle.ts:75-213`).
- Verified InsightsEngine `compact` mode has no live mount (`grep '<InsightsEngine'` → ClientDashboard.tsx:636 only).
