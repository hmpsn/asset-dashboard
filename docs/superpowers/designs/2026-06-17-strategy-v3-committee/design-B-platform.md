# Strategy v3 — Design B: Platform-Foundation (architecture-first)

**Date:** 2026-06-17
**Author lens:** Platform-grade / architecture-first
**Inputs (non-negotiable):** [v2 feedback audit findings](../../audits/2026-06-17-strategy-v2-feedback-audit-findings.md) (forks A/B/C, orphan audit, D1–D4, effort estimates) · [walkthrough feedback](../../notes/2026-06-17-strategy-v2-walkthrough-feedback.md) (#1–#12 + themes)
**Honors:** D1 (curated client overview + inline pointers) · D2 (hybrid: recs = lifecycle status, work-products = deliverables) · D3 (one Act queue with Active/Sent/Approved/Throttled + Send/Fix/Throttle/Strike) · D4 (self-managing + learning lifecycle).

---

## 1. Thesis

Treat Strategy v3 not as "a nicer page" but as the moment we install the **recommendation-lifecycle substrate** the platform will reuse for every future rec type (SEO, content, local, competitive, and whatever comes next). The walkthrough surfaced 12 notes that are really *five cross-cutting abstractions* (audit §"Cross-cutting levers"); a feature-first build would re-implement each abstraction five times and straddle two send substrates (Fork A) plus two persistence models (Fork B) — guaranteeing the exact drift the audit already documents (`useShowMore` "implemented twice," cannibalization rendered both passive *and* as a queue type). Design B pays the substrate forks down **decisively and once**: a single first-class **Recommendation Lifecycle Service** (the canonical Layer-2→3 engine carrying a client-facing status), the **unified `client_deliverable` send path** for genuine work-products (D2), and a **respected-edits persistence overlay** that *every* regenerated set honors (Fork B), behind the existing OFF `strategy-command-center` flag with byte-identical flag-OFF output. We accept a slightly larger Phase-2/4 to buy: a strike that is soft+reversible+never-auto-`completed`, a curation cockpit and a narrative-controlled client overview that read the *same* status field, and a learning loop (D4) that is a thin layer on the already-built outcome/learnings infra. The result scales to rec types we haven't invented yet — the cost is paid in clean abstractions, not in tech debt.

---

## 2. Architecture — the recommendation lifecycle (admin + client)

### 2.1 The one new substrate: a client-facing lifecycle status on the recommendation entity

Today `RecStatus = pending | in_progress | completed | dismissed` (`shared/types/recommendations.ts:7`). That is an **execution** status (is the *work* done). The walkthrough asks for a second, orthogonal axis: a **curation/delivery** status (where is this rec in the agency→client narrative). D2 locks this as "a lightweight client-facing lifecycle on the recommendation entity" — so we add it as a *new field*, not by overloading `RecStatus`.

```ts
// shared/types/recommendations.ts — ADD (additive; absent ⇒ 'system' on legacy rows)
export type RecLifecycle =
  | 'system'      // L2: raw engine output, admin-only, never client-visible
  | 'curated'     // operator promoted it (kept in cockpit, not yet sent)
  | 'sent'        // sent to client; appears in "Recommended this month"
  | 'discussing'  // client opened a light thread on it
  | 'approved'    // client said yes → becomes work
  | 'declined'    // client said no → outcome signal, supersedable
  | 'throttled'   // operator temporarily deferred (D3)
  | 'struck';     // operator rejected as wrong (D3, soft+reversible)

export interface Recommendation {
  // ...existing...
  lifecycle?: RecLifecycle;        // absent ⇒ 'system' (flag-OFF byte-identical)
  lifecycleAt?: string;            // ISO of last lifecycle transition (D4 staleness clock)
  throttledUntil?: string | null;  // D3 throttle auto-resurface
  sentDeliverableRef?: string | null; // when 'sent', the client_deliverable.sourceRef if a thread was opened (D2)
}
```

**Why a field, not a new table:** recs already round-trip through `loadRecommendations`/`saveRecommendations` (JSON-backed set) and are already wired into the intelligence engine (`operational-slice.ts` `recommendationQueue`). A field rides the existing read/write/broadcast plumbing; a new table would fork the read path. The lifecycle axis is small, finite, and 1:1 with the rec — it belongs on the entity (CLAUDE.md: typed contracts at boundaries; status transitions via state machine).

**The state machine (new, in `server/state-machines.ts`):**

```
RECOMMENDATION_LIFECYCLE_TRANSITIONS:
  system     → curated | sent | throttled | struck | dismissed-passthrough
  curated    → sent | throttled | struck | system(un-curate)
  sent       → discussing | approved | declined | throttled | struck
  discussing → approved | declined | throttled | struck
  throttled  → curated | sent | struck   (and auto → system when throttledUntil passes)
  struck     → system   (UN-STRIKE — reversibility is a first-class transition, not a delete)
  declined   → system   (supersession can re-mint; D4)
  approved   → (terminal for lifecycle; execution continues on RecStatus)
```

Every mutation calls `validateTransition('recommendation_lifecycle', ...)` — a lifecycle jump that isn't listed is a bug (CLAUDE.md state-machine rule). Critically, **lifecycle and RecStatus are independent**: `approved` (lifecycle) does NOT set `RecStatus='completed'`. Execution completion stays on `RecStatus` exactly as today. This is the firewall that prevents the strike-cascade-to-completed hazard (§5.1).

### 2.2 The Recommendation Lifecycle Service — the canonical L2→L3 engine

A new server module `server/recommendation-lifecycle.ts` is the **single writer** of `lifecycle`. No route handler mutates the field directly (mirrors how `send-to-client.ts` is the single deliverable writer). It exposes:

```ts
transitionLifecycle(workspaceId, recId, to: RecLifecycle, opts): Recommendation
  // validateTransition → mutate rec.lifecycle/lifecycleAt → side-effects per target → broadcast RECOMMENDATIONS_UPDATED
  // side-effects table (the ONE place cascade/learning/send wiring lives):
  //   → 'struck'     : recordStrike() (soft cascade, §5.1) + recordOutcomeSignal('struck')
  //   → 'throttled'  : set throttledUntil + add throttle branch to merge carry-over
  //   → 'sent'       : open light deliverable thread (D2) ONLY IF operator added a note; record sentAt for D4 clock
  //   → 'approved'   : recordOutcomeSignal('approved') → feeds learnings (D4); spawn work via existing handoff
  //   → 'declined'   : recordOutcomeSignal('declined') + write keyword_feedback declined row if keyword-bearing (suppress regen)
```

This is the one abstraction Design B invests in upfront. Every per-type behavior (cascade target, outcome action type, whether a send opens a thread) is a row in a **per-type policy registry** keyed by `RecType`, so adding a future rec type means adding one policy entry — not editing five call sites:

```ts
// server/recommendation-lifecycle-policy.ts
interface RecLifecyclePolicy {
  cascadeOnStrike: 'keyword_feedback' | 'cluster_feedback' | 'none'; // §5.1 — soft targets only
  outcomeActionType: ActionType;        // reuse outcome-tracking.ts unions
  sendOpensThread: boolean;             // D2: recs default false (overview), keyword opps true ("interested?")
  clientSurface: 'overview' | 'inline' | 'both'; // D1 routing
}
const POLICY: Record<RecType, RecLifecyclePolicy> = { /* keyword_gap, topic_cluster, content_decay, cannibalization, technical, ... */ };
```

**Admin plumbing the audit flagged as net-new** (audit §"Engine de-risk"): there is no admin status-mutation endpoint today (only `PATCH /api/public/recommendations/...` on the client route; the admin route is GET-only, `server/routes/recommendations.ts:304`). We add:

- `PATCH /api/recommendations/:workspaceId/:recId/lifecycle` (admin, `requireWorkspaceAccess`) → `transitionLifecycle()`.
- `useRecommendationLifecycle` mutation hook + a **`RECOMMENDATIONS_UPDATED` `useWorkspaceEvents` handler** in the Act queue (today the queue does NOT live-refresh — audit). Both halves of the data-flow contract (CLAUDE.md feedback-loop completeness).

### 2.3 The cockpit (admin UI) — D3, one Act queue with status filters

`ActQueue.tsx` (currently Fix-only, no cap) becomes the **curation cockpit** — *one* surface, *no* extra tab (D3-A):

- **Status-filter chips** along the existing filter row: `Active` (system+curated) / `Sent` / `Approved` / `Throttled` / `Struck`. These read `rec.lifecycle`, reusing the existing chip pattern. (Keeps the existing All/Content/Technical/Quick-wins *category* chips as a second axis.)
- **Row actions** on `RecommendationRow`: **Send · Fix · Throttle · Strike** (D3). Fix = today's navigate-to-tab. Send/Throttle/Strike = `useRecommendationLifecycle`. Strike shows an **Undo toast** (it's reversible — §5.1).
- **Cap-N + show-more** via the shared `<ShowMoreList>` primitive (§3.5) — solves #3.1's "144 recs, can't reach the bottom."
- **why → how → result** layout on each row (§3.4) — the data already ships (`OpportunityComponent.evidence`, `insight`, `impactBand`); this is a render change. It is *also* the precondition for Send (you can't send "interested?" without a result line).

### 2.4 The curated client overview (client UI) — D1

A new client surface **"Recommended this month"** (`src/components/client/RecommendedThisMonth.tsx`) is the client's hub for Layer 3. It reads recs where `lifecycle ∈ {sent, discussing, approved}` via a new public projection (EMV-stripped, as today). Per D1 each rec is short and finite: **why → projected result → one action** (`Approve` / `Add ($)` / `Discuss`). "Discuss" opens the light thread (D2). This is *not* the inbox pile — it is a curated, narrative-controlled rollup (audit north-star #2).

**Inline pointers (D1):** on the relevant client data screens (Health, a content/keyword view), a light **"💡 1 recommendation here →"** chip jumps into the overview, anchored to that rec. Driven by `POLICY[recType].clientSurface` — `inline` recs render the pointer where relevant, `overview` recs only roll up, `both` do both. One render helper, policy-routed.

### 2.5 Learning / staleness / supersession (D4) — admin + client

D4 is "Layer 2 watching Layer 3." Grounded de-risk: `server/outcome-tracking.ts` (`OutcomeScore`, `EarlySignal`, `LearningsTrend`), `server/workspace-learnings.ts`, and `server/intelligence/learnings-slice.ts` already exist; `sentAt`/`lifecycleAt` give the clock. Net-new is a thin layer:

- **Staleness nudges (admin):** a daily pass (reuse the existing recompute cron, Phase 5c) flags `sent` recs where `now - lifecycleAt > N days && lifecycle still 'sent'` → mints a **meta-nudge** rec ("available to client 14 days, not accepted — throttle / re-send / drop?"). Rendered via the *existing* `StrategyStalenessNudges.tsx` component (precedent already in repo).
- **Supersession (admin):** when the engine mints a new rec whose `buildMergeKey` (source+pages+title — already exists, `recommendations.ts:897`) overlaps a `sent`/`declined` rec with a *higher* opportunity value, flag the old one "a better rec now exists." Reuses the merge-key infra.
- **Client response as outcome signal (admin+backend):** `approved`/`declined`/`discussing` each call `recordOutcomeSignal()` → feeds the existing learnings backend → calibrates future OV (the EMV calibration loop already snapshots `predicted_emv` at action time). No new learning engine — just wiring the lifecycle transition into the existing `recordAction`/outcome path.
- **Client-side D4 surface:** none added beyond the overview — the client never sees the meta-loop; it stays admin-only ("control the narrative," #12c). The client *feels* D4 only as freshness: stale recs quietly leave the overview when throttled/dropped.

---

## 3. The keyword / content half

### 3.1 The Strategy ↔ Hub boundary (the locked principle)

**Strategy = decide/act + orient. Keyword Hub = the full keyword universe + deep research. The curated working set is the Strategy-flavored middle** (audit theme #1; walkthrough #11 resolution). Crisp ownership, enforced by where data lives:

| Concern | Home | Why |
|---|---|---|
| Orient + Act queue + What Changed | Strategy → Overview | decide/act |
| Curated target-keyword set (top ~10–20) + Keyword Opportunities (send) + requested-keyword triage + distribution + movements | Strategy → **"Keywords & Rankings"** tab (#11) | the actionable, truncated slice |
| Full keyword universe, rank tracking, deep research, declined/approved feedback *log* | **Keyword Hub** | reference/management |
| Local SEO **config** (location/market) | one collapsed **"Strategy setup"** surface (#1, dir-b) | config is the strategy's parent |
| Local SEO **visibility** panel | **Keyword Hub only** (dedupe — remove from Strategy) | single home |

### 3.2 "Keywords & Rankings" tab (#11) — fills the empty Rankings tab

Rename `StrategyRankingsTab` → "Keywords & Rankings" (keep the route id; the `?tab=` receiver already exists — CLAUDE.md two-halves contract is satisfied). It composes: Ranking Distribution → Position Movements (gated as today) → **curated target-keyword set** (managed, §3.3) → **Keyword Opportunities** (send-to-client, §3.4 + #6b) → **requested-keyword triage** (re-homed `RequestedKeywordTriage`, restoring locked Decision #7) → **"Open the Keyword Hub for the full universe & deep research →"** deep-link. This is the closed keyword-collaboration loop (audit theme): opportunities → send "interested?" → client responds → interested → joins the curated set → response logs as Client Keyword Feedback.

### 3.3 Managed sets (add/remove/keep) + the Fork-B overlay — the decisive resolution

The PATCH write path fully exists (`server/routes/keyword-strategy.ts:468` accepts `siteKeywords[]` + `topicClusters[]`, transactional, snapshots history, regens recs). The trap (Fork B): `siteKeywords`/`opportunities`/`topicClusters` are **AI-regenerated on every refresh** (`keyword-strategy-ai-synthesis.ts`) — a naive PATCH is silently clobbered on the next Refresh. **A managed set without an overlay is a trust-destroying mirage** (audit, verbatim).

**Design B resolution — one respected-edits overlay model, used by ALL regenerated sets (not just keywords):**

A single new table `strategy_set_overlay` (one model, three set-kinds) records operator intent the synthesis pass must honor:

```sql
CREATE TABLE strategy_set_overlay (
  workspace_id TEXT NOT NULL,
  set_kind     TEXT NOT NULL,   -- 'site_keywords' | 'topic_clusters' | 'opportunities'
  item_key     TEXT NOT NULL,   -- normalized keyword / cluster-id / opportunity-key
  intent       TEXT NOT NULL,   -- 'kept' | 'removed' | 'added'
  created_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, set_kind, item_key)
);
```

A pure `applyOverlay(generatedSet, overlay)` function sits at the synthesis output boundary (`keyword-strategy-ai-synthesis.ts`, the masterData assembly point): after the AI regenerates a set, the overlay is applied — `removed` items are dropped, `added`/`kept` items are pinned in, `kept` items are protected from auto-eviction. **Auto-replenish** (remove one → a replacement pops in, #6) pulls from `opportunities`/`keywordGaps`, **skipping** anything in the `removed` overlay *and* anything `keyword_feedback`-declined (the declined filter already exists, `server/keyword-feedback.ts:61`). This is the *same* "persist-across-regeneration" constraint the cannibalization keeper-override roadmap item already specced (audit) — we build it once, generically, and the keeper-override becomes a consumer of the same overlay.

`useManagedKeywordSet` (a generic hook over the PATCH path + overlay writes) drives both #6 (keywords) and #9a (clusters). Remove-cluster is the cheap first win; add/keep follow.

### 3.4 why → how → result + send for keyword/content items

- **Opportunities (#6b):** must be *typed* first — today they're bare strings (audit: this is what makes #6b an **L**, gated). Add `volume/intent/rationale/projectedImpact` to the opportunity shape (a typed interface in `shared/types/`, not `Record<string,unknown>`), then per-opportunity **Send → "interested?"** via the lifecycle service (`sendOpensThread: true` in policy).
- **Topic clusters (#9c/#9a):** only net-new field is `rationale` + `projectedImpact` on `TopicCluster` (audit) — which #9a/#9b also want. Render why (what it is + data-backed reason + `topCompetitor`) → how (the action) → result (projected impact).
- **Cluster research (#9b):** wiring, not new infra — per-cluster "Run research" → `getKeywordIdeas(cluster keywords)` on the existing research/jobs platform (must be a background job — CLAUDE.md long-running-generation rule).
- **Brief pre-seed (#8a):** the `StrategyCardContext` + `buildStrategyCardBlock` abstraction already exists (`server/content-brief.ts`). The gap: `strategyCardContext?` is **MISSING** from `FixContext` + `StandaloneContentBriefGenerationParams`, so naive wiring silently drops it. Add the field to both, build the gap/rec→context **mapper ONCE**, wire it at all three handoff sites (gap→brief, rec→fix, keyword→brief).

### 3.5 Dedups + the shared show-more primitive

- **`<ShowMoreList>` / `useShowMore`** — implemented twice + faked by silent `.slice(0,N)` in ~9 cards (audit: "the single biggest systemic lever"). Extract one primitive into `src/components/ui/`, sweep ~9 sites converting silent caps → cap-with-show-more. Sequence with #9c + #3 (same rows).
- **Local SEO dedupe (#1):** `LocalSeoVisibilityPanel` renders in BOTH `KeywordStrategy.tsx` and `KeywordHub.tsx`. Config → "Strategy setup" surface; visibility → Hub only.
- **Backlinks → Links page (#12a):** `BacklinkProfile` is self-contained (workspaceId only). Move to a Backlinks tab on the existing `links` page; remove from Competitive; fix the `siteId!` assertion so it loads without a connected site.
- **Client Keyword Feedback routing (#2):** component already takes separable requested/declined/approved props — route requested→Keywords&Rankings triage, declined+approved *log*→Hub. No rewrite.

---

## 4. Explicit resolutions — every open item

| Open item | Resolution |
|---|---|
| **Fork A (send substrate)** | **Hybrid per D2 — and it's the platform-clean answer.** Recs do NOT become deliverables; they get the `lifecycle` field (§2.1) and the curated overview reads `sent` recs. Genuine **work-products** (content briefs, cannibalization consolidation) use the **unified `client_deliverable` / `sendToClient()` path** (already built, `server/domains/inbox/send-to-client.ts`). We do NOT invest further in legacy `client_actions` for NEW types — cannibalization's existing `client_actions`-backed adapter keeps working (it's proven), but every new send is unified. The generic admin send route is the lifecycle PATCH (for recs) + a thin admin wrapper over `sendToClient()` (for work-products). No `coerceType`-silent-fallback exposure for recs (they never enter the deliverable type union). |
| **Fork B (overlay)** | **One `strategy_set_overlay` model honored by ALL regenerated sets** (§3.3). `applyOverlay()` at the synthesis boundary. Auto-replenish skips removed + declined. The cannibalization keeper-override roadmap item becomes a consumer of the same overlay (don't build two). |
| **Fork C (Layer-2 flip)** | **Client sees curated-only (Layer 3) in the new overview; raw Layer-2 is NOT emptied — it's redefined.** The client InsightsEngine Action Plan + Health upsell continue to read recs, but from a **flag-gated projection**: flag-OFF = today's raw recs (byte-identical); flag-ON = recs where `lifecycle ∈ {sent,discussing,approved}` PLUS a small always-on "system health" set the engine designates `clientSurface:'inline'`. So those surfaces are *narrowed to curated*, never emptied. The overview is the new primary; InsightsEngine/Health become inline-pointer hosts. (§5.3.) |
| **LostQueryRecoveryCard (silent total loss)** | **Add a first-class `lost_query` rec type** (not just re-home the card). It's lost-query *recovery* — an actionable opportunity that belongs in the lifecycle (sendable, curatable, learnable) exactly like cannibalization. Re-homing the orphaned card alone would leave it outside the queue/send spine and re-create the passive-card problem. New rec type = the four-in-one-commit registration is small here (it's not an `InsightType`); add to `RecType`, a policy entry, a renderer case, and a minter that reads the existing lost-query data. The orphaned card is then deleted (its data flows through the queue). |
| **`CannibalizationTriage` orphaned (#4)** | Re-home into the Keywords&Rankings / Act area (S). Restores keeper+fix+resolve+send instantly. **Lock ONE home** — remove the passive `CannibalizationAlert` from Overview so it doesn't double-render. |
| **`RequestedKeywordTriage` orphaned (#2)** | Re-home into Keywords&Rankings triage — restores locked Decision #7. |
| **`StrategyDiff` "What Changed" (#5)** | **Un-retire + promote** to top of the Reference section (candidate: near Orient). **Amend the locked plan Decision #3 in the same commit** (audit hazard: otherwise the next executor re-reverts). |
| **Intelligence Signals (#7)** | Do the deferred Task 2.2 — route signals into the Act queue as rows, **dedup vs keyword_gap recs**, remove the standalone card + fix the stale `index.ts` orphan comment in the same commit. |
| **"Computed X ago ago" bug** | One-line: drop the literal ` ago` (`IntelligenceSignals.tsx:49`) + a regression test assertion. |
| **`OpportunitiesList`, `DecisionQueue`** | Dead, superseded by ActQueue — delete in cleanup. Fix the stale-and-misleading `index.ts` orphan comment. |
| **Throttle semantics** | **Auto-resurface after N days** (`throttledUntil`), mirroring the `suggested-briefs` snooze precedent (`status='snoozed'` + `snoozed_until`). Add a throttle branch to merge carry-over so a throttled rec doesn't re-appear early. Operator can un-throttle manually. |
| **Auto-replenish source/rule** | Pull from `opportunities` ∪ `keywordGaps`, ranked by opportunity value, **skipping** `removed`-overlay + `keyword_feedback`-declined keywords. |
| **Keep the `strategy-command-center` flag?** | **Yes — reuse it as the umbrella** (still OFF on prod). v3 is the same flag's full realization, not a new flag. Add narrower sub-flags only if a phase needs independent dark-launch (CLAUDE.md feature-flag scope minimality). |

---

## 5. Key risks + how Design B handles them

### 5.1 Strike must be soft, reversible, and must NEVER auto-resolve to `completed` (the audit's #1 engineering risk)

The hazard is concrete: `resolveRecommendationsForChange` (`server/recommendations.ts:463`) auto-sets `RecStatus='completed'` for any active rec whose `affectedPages` intersect a changed page. If a strike cascade *removed* a keyword/gap and that touched a page, the struck rec could read as "✓ done" to the client.

Design B's firewall:
1. **Strike sets `lifecycle='struck'`, never `RecStatus='completed'`** — the two axes are independent (§2.1). The merge/resolve block only touches `RecStatus`; `struck` recs are *filtered out of the active set by lifecycle* before that block runs, so they can't be swept to `completed`.
2. **Cascade targets are soft + reversible only.** Per `POLICY[recType].cascadeOnStrike`: keyword/cluster/local recs → write a **`keyword_feedback` declined row** (already suppresses regen + the gap, `keyword-feedback.ts`); CTR/technical/decay recs → `cascadeOnStrike:'none'` (plain lifecycle strike, nothing downstream). **No hard page-keyword deletes.** This matches Josh's Q1 type-specific answer.
3. **Un-strike is a first-class transition** (`struck → system`) that *removes* the `keyword_feedback` declined row — fully reversible.
4. **Add a guard test:** strike a keyword-gap rec, remove its keyword, touch the page → assert the struck rec is still `struck` (lifecycle) and NOT `completed` (RecStatus), and that the client overview/Health never shows it as done.

### 5.2 The overlay (Fork B) — the silent-clobber risk

`applyOverlay()` is a **pure function at the synthesis output boundary**, unit-testable in isolation: given (generatedSet, overlay) → resolvedSet. Test: PATCH a kept keyword → Refresh (full regen) → assert the kept keyword survives and a removed one stays gone. Delete-then-reinsert metadata preservation (CLAUDE.md) applies to the overlay table itself. Without this test the managed-set feature is the "trust-destroying mirage" — so it gates the managed-set phase (no managed UI ships before the overlay test is green).

### 5.3 The Layer-2 flip powering client InsightsEngine + Health (Fork C)

Risk: naively hiding raw L2 empties the client Action Plan + Health upsell (audit Fork C). Design B never hides — it **narrows via a flag-gated projection**: flag-OFF byte-identical (raw recs); flag-ON = curated (`sent/discussing/approved`) + designated always-on inline health recs. Integration test must exercise the **public read path** `GET /api/public/recommendations/:id` (CLAUDE.md: test the public endpoint, not the admin GET) for both flag states. The "byte-identical flag-OFF" assertion is a contract test.

### 5.4 Double-render + stale orphan comment (audit re-home hazards)

Every re-home locks **ONE home per concern** (cannibalization, signal-fold). The `index.ts` orphan comment is corrected in the same commit. The #5/#7 plan-decision reversals are amended in-commit (otherwise re-reverted).

---

## 6. Phase-per-PR decomposition (flag-gated, staging-first, each shippable)

Each phase = one PR, behind `strategy-command-center` (OFF on prod), staging-verified before the next opens (CLAUDE.md phase-per-PR + staging-before-main). Effort uses the audit's S/M/L/XL.

| # | Phase | Effort | Ships | Gate / dependency |
|---|---|---|---|---|
| **P0** | **Decisions + contracts** — commit `RecLifecycle` type, lifecycle state machine, `RecLifecyclePolicy` registry skeleton, `strategy_set_overlay` migration, ws-event handlers' signatures, the StrategyCardContext field additions. Amend the locked plan for #5/#7. | **M** | shared contracts only (no behavior) | none — must land before any parallel work (CLAUDE.md pre-commit shared contracts) |
| **P1** | **Quick wins + foundations** — re-home `CannibalizationTriage` (lock one home, fix orphan comment); promote `StrategyDiff` (+plan amend); "ago ago" bug; extract `<ShowMoreList>` + sweep ~9 sites; admin `PATCH .../lifecycle` endpoint + `useRecommendationLifecycle` + `RECOMMENDATIONS_UPDATED` queue handler. | **L** | visible cleanup + the lifecycle write spine | P0 contracts |
| **P2** | **Lifecycle service + send spine + why→how→result** — `recommendation-lifecycle.ts` (single writer) + policy wiring; cockpit row actions **Send/Fix/Throttle/Strike** with Undo; why→how→result row layout; per-rec Send + decaying-page Send; cap-N in Act queue. Strike = soft+reversible+never-`completed` (§5.1) + guard test. | **L** | the curation cockpit (admin) | P1 |
| **P3** | **Engine — strike cascade + throttle + signal-fold** — `keyword_feedback` cascade per policy; `throttledUntil` + merge carry-over branch; Task 2.2 signal-fold (dedup vs keyword_gap, remove standalone card + comment). | **L** | full D3 actionability | P2 |
| **P4** | **Overlay + managed sets + Strategy↔Hub boundary** — `applyOverlay()` at synthesis boundary + overlay test (gates the phase); `useManagedKeywordSet`; curated keyword set (#6) + clusters add/remove/keep (#9a); Keywords&Rankings tab compose (#11); #2 routing; #1 Local SEO config fold + Hub dedupe; #12a backlinks→Links page. | **XL** | the keyword half | P0 overlay migration; P3 (cascade shares `keyword_feedback`) |
| **P5** | **Enrichment + client delivery (D1/D4/Fork C)** — type `opportunities` → keyword-opp Send (#6b); cluster `rationale`/`projectedImpact` + cluster research (#9b, background job); brief pre-seed mapper (#8a) at 3 sites; **client "Recommended this month" overview** + inline pointers (D1); Fork-C narrowed projection + public-read contract test; competitor send (#12b, last); D4 staleness nudges + supersession + outcome-signal wiring. | **XL** | the client narrative surface + the learning loop | P2 (lifecycle), P4 (typed opps) |

Parallelism within a phase follows CLAUDE.md (exclusive file ownership, diff-review checkpoint, `scaled-code-review` if multi-agent). P4/P5 are XL and should themselves be sub-phased if a single PR exceeds review capacity — but each sub-PR stays independently shippable and flag-gated.

---

## 7. Coverage table — all 12 feedback notes + orphans

| Note | Addressed by | Phase |
|---|---|---|
| **#1** Strategy Settings + Local SEO fold + Hub dedupe | "Strategy setup" config surface; visibility → Hub only (§3.1, §3.5) | P4 |
| **#2** Client Keyword Feedback routing | requested→Keywords&Rankings triage; log→Hub (§3.5) | P4 |
| **#3** Act queue: pagination + strike + throttle + send + vision | Cockpit (§2.3) + lifecycle service (§2.2) + cap-N + Send/Throttle/Strike + soft cascade (§5.1) | P1–P3 |
| **#4** Cannibalization keeper + send + discussion | Re-home `CannibalizationTriage`; send via deliverable spine; discuss = light thread (§4) | P1 |
| **#5** Promote "What Changed" | Un-retire + promote + plan amend (§4) | P1 |
| **#6** Curated managed keyword set | `useManagedKeywordSet` + overlay + auto-replenish (§3.3) | P4 |
| **#6b** Keyword Opportunities send "interested?" | Type opps + per-opportunity Send via lifecycle (§3.4) | P5 |
| **#7** Intelligence Signals fate | Fold into Act queue (Task 2.2), remove standalone + fix comment (§4) | P3 |
| **BUG** "Computed X ago ago" | One-line fix + test (§4) | P1 |
| **#8a** Pre-seed brief generator | `strategyCardContext` field + mapper at 3 sites (§3.4) | P5 (field in P0) |
| **#8b** Information overload / show-more (global) | `<ShowMoreList>` primitive + ~9-site sweep (§3.5) | P1 |
| **#9a** Add/remove topic clusters | Managed-set hook + overlay (§3.3) | P4 |
| **#9b** Run research off clusters | Per-cluster research as background job (§3.4) | P5 |
| **#9c** Cluster why→how→result | `rationale`/`projectedImpact` fields + render (§3.4) | P5 |
| **#10** Decaying-page Send | Per-row Send via lifecycle/deliverable (§2.3) | P2 |
| **#11** Rankings → "Keywords & Rankings" | Rename + compose curated surfaces + Hub deep-link (§3.2) | P4 |
| **#12a** Backlinks → Links page | Move `BacklinkProfile`; fix `siteId!` (§3.5) | P4 |
| **#12b** Competitor send | `strategy_recommendation` lifecycle, recType=competitive, gated, last (§4) | P5 |
| **#12c** KEYSTONE 3-layer model | Lifecycle field (L2→L3) + cockpit + curated overview + Fork-C projection (§2, §4) | P2–P5 |
| **Orphan: LostQueryRecoveryCard** | New `lost_query` rec type → lifecycle (§4) | P3 (mint) / P5 (send) |
| **Orphan: index.ts stale comment** | Corrected in re-home commits (§5.4) | P1 |

---

## 8. What makes Design B *Design B*

The feature-first alternative ships the same 12 notes faster but re-implements the send/cascade/overlay/show-more abstractions per surface and straddles two send substrates + two persistence models — which is precisely the drift the audit already documents. Design B's bet: build the **Recommendation Lifecycle Service + policy registry + one overlay model + the unified send path** once, so the platform's *next* rec type is a policy row, not a project. The cost is a heavier P0/P2/P4; the payoff is testability (every transition is a state-machine + a pure overlay function + a guard test), zero straddle debt, and a model that already has a slot for rec types nobody has thought of yet.
