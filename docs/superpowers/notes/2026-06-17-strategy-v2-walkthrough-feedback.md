# Strategy v2 + Dashboard Walkthrough — Feedback Capture

**Date:** 2026-06-17
**Session:** live preview walkthrough against real staging data (13 workspaces, all tiers)
**Method:** Josh drives and calls out items; Claude captures verbatim + clarifications. **No solutioning until all feedback is collected**, then brainstorm the path forward.

---

## Open clarifying questions (resolve before brainstorming)
- **[Q1 for #3 — Strike cascade]** Is the cascade type-specific? e.g. strike a *keyword-gap/keyword* rec → remove that keyword from strategy + tracking; strike a *CTR/decay* rec → just dismiss (nothing downstream to remove). AND: struck = permanent suppression — the rec engine regenerates recs each run, so a struck item must be *remembered as "don't re-suggest,"* not just deleted once. Confirm both.
- **[Q2 for #3 — Throttle]** Temporary how? (a) auto-resurfaces after N days, (b) stays throttled until manually un-throttled, or (c) just de-prioritized/sent to the bottom but still visible? Lean?
- **[Q3 for #3 — Send to client]** Reuse the existing admin "Send to client" → client-action/deliverable flow (shows in the client inbox for discussion/approval, response feeds back)? This is exactly the `source='strategy_recommendation'` decision-adapter the Phase 6 plan flagged. Confirm reuse.

## Captured notes

> Format per item — **[N] Screen/element** · what Josh said (verbatim where possible) · _clarification Q&A_ · `tag`
> Tags: `ux` `copy` `data` `layout` `bug` `monetization` `scope` `idea` `parking-lot`

**[1] Admin Strategy (v2, Faros) → "Strategy Settings" collapsible card** (SEO Data Provider · Page Limit · Business Context)
- Verbatim: _"This should find a way to live with the local SEO. Technically, it's the parent of this entire page. OR perhaps it collapses down into just a button or couple of buttons? We've removed a lot from it over time, so open to thoughts here."_
- Read: Strategy Settings is really the *config/parent* that drives the whole strategy, but it's been pared down over time → now feels too heavy for what it holds. Two directions floated: **(a)** co-locate / integrate it with the Local SEO panel; **(b)** collapse it to a button or a couple of buttons (e.g. a settings affordance). Josh is "open to thoughts" — revisit in brainstorm.
- **DECISION (Josh): direction (b)** — fold Strategy Settings **+** Local SEO into ONE shared "strategy config" surface. Likely reconciles with the "collapse to a button/couple of buttons" idea: a single collapsed **Strategy setup/config** entry that expands to provider + page limit + business context + local market/location.
- **+ Dedupe the Keyword Hub:** Josh — "we'd probably need to think about completely removing it from the Keyword Hub as well." **Verified:** `LocalSeoVisibilityPanel` renders in BOTH `KeywordStrategy.tsx` (Strategy page, `localSeoEl` lines 217/418/494) AND `KeywordHub.tsx` (line 539). Consolidating ⇒ pick ONE home.
- **Nuance to resolve in brainstorm:** there are two distinct things — Local SEO **config** (location/market settings) vs Local SEO **visibility** (the results panel). Config clearly folds into the new shared settings surface; the *visibility panel*'s home (Strategy vs Hub vs both) is a separate placement call.
- `ux` `layout` `idea` — direction set (b); details + Hub dedupe for brainstorm.

**[2] Admin Strategy (v2, Faros) → Overview tab → "Client Keyword Feedback" card** (shows "1 declined · 0 requested · 1 approved" + a declined-log row: "code management git, May 5")
- Verbatim Q: _"Should this move to the keyword hub page?"_
- Claude take (parked): leaning **yes for the feedback LOG/history** — it's keyword-level reference data and the Hub is the keyword home; moving it declutters the Strategy Overview (which should lead with Orient + Act). **BUT** split: client **requested** keywords are an *action* (client asked to add a keyword → operator decides) and arguably belong in the Strategy **Act queue**, not buried in a log; the **declined/approved history** is the reference that fits the Hub. (Here it's 0 requested, so currently all log.)
- `ux` `layout` `idea`
- **THEME (emerging):** #1 and #2 are both about the **Strategy ↔ Keyword Hub boundary** — what's keyword-management/reference (→ Hub) vs strategy decision/action (→ Strategy). Worth resolving as one principle in the brainstorm.

**[3] Admin Strategy (v2, Faros) → Overview → "What to do next" (Act queue — 144 active recs)** ⭐ BIG / load-bearing
- Verbatim: _"This section is LONG and makes it almost impossible to get to the bottom. I think we also need the ability to 'strike' a recommendation if we don't agree with it or if its incorrect. It should then run all the way down the chain (IE: reject recommendation = remove keyword from strategy) and maybe some idea like 'throttle' a recommendation if we temporarily want to focus on other things. I also need simply a 'send to client' button so I can send it for discussion with them. Kind of like we do on some of the page intelligence stuff. basically, we need to make 'what to do next' the recommendation layer for us to send to clients and make it fully actionable."_
- **Decomposed asks:**
  1. **Length / pagination** — 144 recs in one scroll; can't reach the bottom. Needs limiting / pagination / "show more" / collapse. (Today `ActQueue` `visible.map(...)` renders the full active set with no cap.)
  2. **STRIKE (reject + cascade)** — reject a rec you disagree with / that's wrong; it "runs all the way down the chain" (e.g. reject keyword-gap rec → remove keyword from strategy). Type-specific cascade.
  3. **THROTTLE (temporary defer)** — temporarily suppress a rec to focus elsewhere (snooze/de-prioritize).
  4. **SEND TO CLIENT (per-rec)** — a per-row "Send to client" button to send a rec for client discussion, like the Page Intelligence send convention.
  5. **VISION** — make "What to do next" THE recommendation layer: fully actionable (Fix / Strike / Throttle / Send-to-client) AND the client-send layer. This is the monetization + client-collaboration hub.
- **Grounding (verified):** rec statuses already include `dismissed` (`RecStatus = pending|in_progress|completed|dismissed`, `shared/types/recommendations.ts:7`) — so reject-as-status partly exists; the ActQueue already hides dismissed+completed. BUT the ActQueue today has ONLY a `Fix` CTA (`onFix` → navigate) — **no dismiss/throttle/send UI on the row**. Cascade (remove keyword + suppress regeneration), `throttle` status, and per-rec send are all **net-new**. Send-to-client infra exists (admin send convention → client-actions/deliverables); new = a `source='strategy_recommendation'` adapter (the Phase 6 plan already flagged this exact source).
- `ux` `layout` `monetization` `scope` `idea` — **largest item so far; likely its own multi-phase feature.**
- **THEME (reinforced):** "Act queue as the actionable + client-send layer" is the spine of the monetization story (rec → send to client → approve/discuss → work → invoice). Connects to Phase 6b client recs-as-decisions.
- **Josh architecture steer (partial answer to Q1):** _"We do have the intelligence engine, which likely is where we'd plug recommendations into/out of — just a flag."_ **Verified:** recs are ALREADY wired into the intelligence engine — `operational-slice.ts` exposes a `recommendationQueue` (fixNow/fixSoon/fixLater) surfaced in `formatter-operational.ts`, and the rec engine consumes intelligence via the shared generation-context (`content-pipeline-slice.ts:91`). The **soft-flag precedent already exists**: `client-signals-slice.ts:164` filters churn signals via `WHERE dismissed_at IS NULL`. ⇒ **strike/throttle ≈ "a status/flag + filter"** (e.g. extend `RecStatus` with `struck`/`throttled` or add timestamps), and the cascade + AI-context awareness ride the existing intelligence plumbing rather than net-new wiring. This makes the engine work smaller than the UI work.

**[4] Admin Strategy (v2, Faros) → Overview → Reference & Analysis → "Keyword Cannibalization Detected" (38 critical)**
- Verbatim: _"I previously flagged this and I think added it to the roadmap, but we need to be able to select which we recommend to be the best and then also be able to send to the client (as well as receive their feedback). Thinking through this — I'd likely have to be a greater discussion with the client that would need to be handled. Something for us to brainstorm through either now or later."_
- Asks: (a) **select which page is the keeper/best** (override the auto-suggested canonical); (b) **send to client** + (c) **receive client feedback**; (d) the client interaction likely needs a **richer discussion**, not just approve/decline.
- **🔑 KEY FINDING — most of this is ALREADY BUILT, but ORPHANED:** the rich `CannibalizationTriage` leaf (bands run, PRs #1252 / #1254 / #3b-ii) already has: keeper marked, Fix-in-editor per duplicate, **Mark-resolved**, and **Send-to-client via a dedicated `cannibalization` client-action/deliverable type** (purpose-built consolidation card; `CannibalizationPayload` + `CannibalizationRenderer` in DeliverableDetailModal + DecisionDetailModal all exist). **BUT the v2 command-center Overview renders the PASSIVE `CannibalizationAlert`** (read-only — no send, no keeper-pick, no resolve). `CannibalizationTriage` is currently **orphaned** (index.ts:30 literally comments it as "orphaned after Phase R, re-homed by Strategy v2" — but it was **never actually re-homed into v2**).
- (a) "select the keeper" = the EXISTING **pending** roadmap item `strategy-cannibalization-operator-keeper-override` (P3, est M, already specced incl. the persist-across-regeneration constraint).
- The genuinely net-new / brainstorm part = (d) the **richer client discussion** model (beyond the deliverable's approve / decline / request-changes).
- `ux` `monetization` `scope` `idea` — mostly **re-home + finish a specced item**, not net-new.

**[THEME — ⚠️ important] v2 reverted rich bands-run leaves to passive originals.** Cannibalization is the proof: v2 shows passive `CannibalizationAlert`, the actionable `CannibalizationTriage` is orphaned. The index.ts orphan comment also lists **DecayingPagesCard / LostQueryRecoveryCard / RequestedKeywordTriage** as "re-homed by Strategy v2" — **need to AUDIT whether those were actually re-homed or also silently dropped.** The Phase-2 intent was "the Act queue absorbs these as rec types," but cannibalization is still a passive reference card, not in the actionable queue. **This ties #3 and #4 together: the actionability Josh wants partly existed and got lost in the v2 recomposition.**

**[5] Admin Strategy (v2, Faros) → Overview → Reference & Analysis → "What Changed" (StrategyDiff — "198 strategy updates since Apr 23, 2026")**
- Verbatim: _"This should probably be top of this section? It's so important but is buried and collapsed at the bottom of the page!!!"_
- Ask: **promote** What Changed — top of the Reference section as a floor; given "so important," candidate to go even higher (near Orient — the "what's changed since you last looked" companion to the visibility headline).
- **🔁 REVERSES A LOCKED SPEC DECISION:** the v2 plan (line 21) says _"What Changed (StrategyDiff) is RETIRED from v2. History remains via strategy_history / activity log elsewhere."_ It was **specced to retire but never actually removed** — still rendered at `KeywordStrategy.tsx:446` (Overview Reference) + 524 (legacy), collapsed at the bottom. Josh's live reaction is the **opposite of retire** → keep + elevate. Good example of the abstract decision looking different against real data (198 updates = a rich change-log / transparency-and-trust layer).
- `ux` `layout` — decision update: **un-retire + promote** What Changed.

**[6] Admin Strategy (v2, Faros) → Overview → Reference & Analysis → "Site Target Keywords"** (+ likely "Keyword Opportunities" below it)
- Verbatim: _"This section (and maybe the one below it) should join a keyword page of some sort. I see these as 'these are the top 10-20 keywords we're targeting in our strategy. Then we can add, remove, keep them. This is the truncated view for admins who just want to pop in and manage a small amount of work without having to see the entire keyword universe.' If they remove a keyword, a new one pops in to replace it. They can also search and add keywords, add from client recommendations, etc."_
- **Vision: a curated "strategy keywords" working set** — the top ~10-20 keywords we're actively targeting, with **add / remove / keep**, distinct from the full **Keyword Hub** ("the entire keyword universe"). A *truncated, lightweight management* surface for a quick pop-in, on a keyword page.
- Behaviors: **auto-replenish** (remove one → a replacement suggestion pops in, presumably from the opportunity/gap pool), **search-and-add**, and **add from client recommendations** (← directly ties to #2's client *requested* keywords feeding this set).
- Today: `SiteTargetKeywords` (strategy.siteKeywords + per-row Track + View-in-Hub) and `KeywordOpportunities` (AI-suggested phrases) are passive reference cards on the Strategy Overview. Josh wants them promoted into an actionable curated-set manager on a keyword surface.
- Open for brainstorm: is the curated set a **new dedicated surface**, a **"strategy mode" within the Keyword Hub**, or stays on Strategy but becomes actionable? (Josh leans "a keyword page … truncated view vs the full universe.")
- **[6b] Keyword Opportunities = a keyword *recommendation* piece (send-to-client).** Verbatim: _"maybe the 'keyword opportunities' is like a keyword recommendation piece, where we can send to the client and ask, 'hey are you interested in this one?'"_ → per-opportunity **Send to client → "interested?"** (same send-to-client pattern as #3 Act queue + #4 cannibalization).
- `ux` `layout` `idea` `scope`

**[7] Admin Strategy (v2, Faros) → Overview → Reference & Analysis → "Intelligence Signals" (54)** (Gap / Misaligned signals — e.g. "space metrics — Gap", "best ai coding agents 2026 — Misaligned")
- Verbatim: _"I'm not sure what purpose this serves right now. We can discuss whether we keep it, kill it, or change it."_
- **🔑 The v2 plan ALREADY answered this — it was supposed to be GONE.** Spec line 48: _"Intelligence signals fold INTO the action queue — a signal that matters is a recommendation, not a peer card."_ Plan **Task 2.2 (Signals → recommendations)**: "route each signal into the queue as a row with impact" + assertion that "`IntelligenceSignals` standalone card **not rendered** in command-center layout." → **Task 2.2 was DEFERRED/skipped**, so the standalone card still renders (`intelligenceSignalsEl`, KeywordStrategy.tsx:444). Josh's instinct = the plan's intent: **change = fold into the Act queue (do the deferred Task 2.2), then kill the standalone card.** (The "Gap" signal already overlaps the Act queue's keyword-gap rec type — redundant by design.)
- `ux` `scope` — resolution leans **"change → fold into Act queue per Task 2.2 (deferred), then remove standalone."** Reinforces the #3/#4 theme: actionability the plan specced but deferred.

**[BUG] "Computed 1 day ago ago" (double "ago")** — `IntelligenceSignals.tsx:49`: `Computed {timeAgo(data.computedAt, { style: 'long' })} ago` — `timeAgo(..., {style:'long'})` already returns "1 day ago", and the template appends a literal " ago" → duplication. From Phase 5b's "Computed X ago" caption; **live on staging.** Trivial fix (drop the literal " ago" or use a style without it). `bug` — quick win, batch into the fix pass.

**[THEME — 🔄 the keyword collaboration LOOP] #2 + #6 + #6b are one closed loop:**
`Keyword Opportunities` (AI-suggested) → admin **sends to client** "are you interested?" (#6b) → client responds interested/not → **interested → added to the curated Site Target Keywords working set** (#6's "add from client recommendations") → the responses surface as **Client Keyword Feedback** requested/approved/declined (#2). So #2 is the *log*, #6b is the *outbound send*, #6 is the *destination set*. Design these together, not as 3 separate cards. Reinforces the "Strategy = decide/act, send-to-client is the spine" theme (#3/#4) — keywords get the SAME send-to-client treatment as recs.

**[8] Admin Strategy (v2, Faros) → Content tab → "Content Gaps"** (cards with Draft Brief / Generate Brief CTAs)
- **[8a] Pre-seed the brief generator with the card's real data.** Verbatim: _"when we 'draft brief' or 'create brief', we don't pre-seed the brief generator with any real data. Would be cool to pre-seed with the prompt from the card as well as anything else valuable to set the brief generator up for success."_ **CONFIRMED gap:** both CTAs (`ContentGaps.tsx:78`/`:86`) pass ONLY `{ primaryKeyword/pageName: gap.targetKeyword, pageType }` — they DROP the rich context the gap already carries: `rationale` (the strategic "why"/prompt), `competitorProof`, `volume`, `intent`, `topic`, `questionKeywords`, `serpFeatures`. → extend the `fixContext` (and the brief-generator receiver) to seed all of it. **High value** (briefs are the monetization output — they're starting blank instead of grounded). Likely **global**: every rec→brief / Create-brief handoff (Act queue Fix #3, KeywordGaps Create-brief from Phase 5) should carry full context.
- **[8b] Length / digestibility — make it scannable (and do it GLOBALLY).** Verbatim: _"display 5 or so max and add a 'show more' button so you can actually get to the next section?… Or minimize the cards, change their layout, and then open the content that lives inside… Might be something we consider globally on the strategy side. Just simplifying so you don't get information overload."_ Two patterns floated: **(a)** cap at ~5 + "show more"; **(b)** minimize/compact cards + **progressive disclosure** (expand for detail). Apply consistently page-wide.
- `ux` `layout` `monetization` `scope`

**[THEME — 📏 information overload / lists too long (GLOBAL)] #3 + #8b (and #6's "truncated view").** Repeated across the page: long, verbose card lists you can't scroll past (Act queue 144, Content Gaps, etc.). Need ONE consistent pattern — cap N + "show more", and/or compact-card + progressive disclosure — applied across all Strategy sections. This is a top-level simplification principle for the redesign-of-the-redesign.
**[THEME — 🌱 context pre-seeding (GLOBAL)] #8a.** Every "turn this into work" handoff (gap→brief, rec→fix, keyword→brief) should carry the full computed context into the generator, not just a keyword — so the AI output starts grounded. The system already computed the rationale/evidence; don't throw it away at the handoff.

**[9] Admin Strategy (v2, Faros) → Content tab → "Topical Authority" (TopicClusters — clusters ranked by coverage gap; e.g. "AI Engineering Roles 0/10", "CI CD Operations 0/26")**
- **[9a] Make it actionable — add / remove clusters** ("Same feedback here. We should be able to add new authority clusters, remove them, etc."). Same curated-management ask as #6 — clusters become an editable set, not a passive list.
- **[9b] (bigger idea) Run research off the clusters.** _"we can then run research of some kind off those clusters. Not sure if that makes sense?"_ → a cluster as a **research seed** (expand into sub-topics / keywords / content plan / competitive angle). Exploratory — parking-lot but promising. `idea`
- **[9c] Each cluster needs richer "why / how / result" context.** _"What is the topical authority cluster, what data do we have as to why we should target it, potentially some competitor notes if available. Basically, here's why we should and here's how, and here's what it could result in."_ The cluster already carries `topCompetitor` + coverage (e.g. "jellyfish.co: 60%" is shown) — but lacks the **narrative**: what it is, the data-backed *why*, competitor notes, the *how*, and the **projected result/impact**.
- `ux` `layout` `idea` `scope`

**[THEME — ➕ "make it a managed set" (add/remove/keep) — #6 + #9a.]** Passive reference lists (target keywords, topic clusters) should become **editable curated sets** — add / remove / keep, auto-replenish, search-and-add. Same interaction pattern; build once, reuse.
**[THEME — 💡 every item needs "why → how → what it could result in" — #8a + #9c (and the Act-queue rows).]** Recommendations/gaps/clusters should each tell a complete story: the data-backed *why* (incl. competitor evidence), the *how* (the action), and the **projected impact**. This is both an operator-trust and a client-send requirement (you can't send "interested?" or "here's the plan" without the why+result). Ties to the send-to-client spine (#3/#4/#6b).

**[10] Admin Strategy (v2, Faros) → Content tab → "Decaying pages" (DecayingPagesCard — pages losing traffic; CTAs today: Refresh brief / Review page)**
- Verbatim: _"Same — Send to client as a 'hey should we refresh this?' before doing so."_
- Add a per-row **Send to client** action ("should we refresh this?") alongside Refresh brief / Review page. Same pattern as #3 / #4 / #6b.
- Note: DecayingPagesCard **did** make it into v2 (Phase 3 re-homed it into the Content tab) — so unlike cannibalization it's not orphaned; it just needs the send-to-client action added.
- `monetization` `ux` `scope`

**[THEME — 📤 SEND-TO-CLIENT is a UNIVERSAL action (now #3, #4, #6b, #10 — basically every rec type).]** Every actionable item — recommendations (#3), cannibalization (#4, already built), keyword opportunities (#6b), decaying pages (#10) — wants the SAME "**Send to client → they discuss/approve → it feeds back**" action. ⇒ Don't build this per-card. Build ONE generic mechanism: a `source='strategy_recommendation'` (and friends) client-action/deliverable adapter + a small per-type renderer (cannibalization already proved the pattern). This is THE monetization spine: every strategy item is sendable, the client collaborates, approved items become work → invoice.

**[11] Admin Strategy (v2, Faros) → Rankings tab** (only "Ranking Distribution" + the "Full keyword tracking… in the Keyword Hub" link)
- Verbatim: _"This page is just about empty. Maybe this is where our other keyword thoughts move over to, then linking out to the greater keyword page for deep research."_
- **Rankings tab feels empty** — just the distribution bar + a Hub link. (Partly by design: **Phase 4 deliberately made Rankings a thin "summarize + deep-link the Hub, don't rebuild tracking" surface**, and the "Position movements" card is **gated off** when there's no `previousPosition` movement data — Phase 4 gating. So the thinness is half-intentional, but Josh's live reaction is it's *too* empty.)
- **🔑 Idea — this RESOLVES #6's open "where does the curated keyword set live?" question:** move the **curated keyword surfaces here** — Site Target Keywords (#6) + Keyword Opportunities (#6b) → the **Rankings tab** (effectively "**Keywords & Rankings**"), which then **links out to the Keyword Hub for the full universe / deep research.** Fills the empty tab AND gives the keyword-management stuff a Strategy-side home.
- `ux` `layout` `idea` `scope`

**[THEME — UPDATE to the Strategy↔Hub boundary (#1/#2/#6 → now resolved shape)]:** The boundary is **curated-vs-universe**, and the curated keyword set lives on **Strategy → Rankings tab** (rename candidate: "Keywords & Rankings"): distribution + movements + the curated target-keyword working set + keyword opportunities (send-to-client) — all **linking out to the Keyword Hub** for the full universe + deep research. Resolves the "#6 new surface vs Hub-mode vs stay-on-Strategy" question → **stays on Strategy (Rankings tab), links to Hub.** Also another spec-vs-live moment: Phase 4 made Rankings intentionally thin; Josh wants it fuller.

**[THEME — strong] Strategy ↔ Keyword Hub boundary (now 3 notes: #1, #2, #6).** A recurring pattern: much of the Strategy page's *reference* content is really **keyword management** that wants to live on a keyword surface — leaving Strategy as **Orient + Act + (promoted) What Changed**. Emerging principle to lock in the brainstorm: **Strategy = decide/act + orient; Keyword Hub (or a curated "strategy keywords" view) = keyword management/universe.** The curated top-10-20 set is the interesting middle: a Strategy-flavored, truncated, actionable slice that lives on the keyword side but is fed by strategy + client recs.

---

**[12] Admin Strategy (v2, Faros) → Competitive tab** (Josh has no DataForSEO data for Faros, so high-level)
- **[12a] Backlinks + competitor bundled — logically correct? Maybe backlinks gets its own page.** A `'links'` Page route already exists (`routes.ts:6`) and `BacklinkProfile` is currently rendered inside the Strategy Competitive tab (Phase 5). Question for brainstorm: split **backlinks → its own (Links) page**, leaving Competitive = share-of-voice + keyword gaps + competitor comparison. (Same dedup/placement flavor as #1.) `ux` `layout`
- **[12b] Competitor — action on it + send to client** (same as previous). 5th instance of the send-to-client spine. `monetization`

- **[12c] ⭐⭐ KEYSTONE — "a major platform shift": the client dashboard as a 3-LAYER recommendation system.** Verbatim: _"Something I want to think about is the client dashboard as a layer for us to send recommendations that we've approved. There's general data, stats, etc. Then system generated recommendations (things like hard data observation, things we're noticing, etc.), then there's the recommendation layer where we are actually sending things for approval and we get to decide those. I feel like this is a major platform shift, but it seems like it allows us to control the narrative a little more. Something to noodle on."_
  - **Layer 1 — Data:** general stats / metrics / facts (always-on).
  - **Layer 2 — System recommendations:** auto-generated hard-data observations ("things we're noticing") — the engine's raw output.
  - **Layer 3 — Curated/approved recommendations:** the agency **selects → sends → client approves**; "we get to decide those." Human-in-the-loop, **narrative-controlled.**
  - **Why it matters:** the client doesn't see the raw system firehose — they see the data + the recommendations the agency *chose* to surface. Agency controls the narrative.

## Themes (filled in during synthesis, after the walkthrough)

**⭐ KEYSTONE FRAME (#12c) ties the WHOLE session together.** Nearly every note is an instance of this 3-layer model:
- **Layer 3 (curated/approved → send → approve)** = the **send-to-client spine** (#3 Act queue, #4 cannibalization, #6b keyword opps, #10 decaying pages, #12b competitor) + **strike/throttle** (#3 — the admin *curating* which system recs are valid/promoted before they reach the client) + the client reframe (Phase 6b) as the *surface* for all 3 layers.
- **Layer 2 (system recs)** = the Act queue raw feed + Intelligence Signals (#7) + every "we're noticing X" card.
- **Layer 1 (data)** = Orient, Ranking Distribution, the stats.
- ⇒ The redesign-of-the-redesign isn't "a nicer Strategy page" — it's **"a 3-layer agency↔client recommendation platform,"** with the admin Strategy page as the *curation cockpit* and the client dashboard as the *narrative-controlled delivery surface.* This should be the CENTER of the brainstorm.

**Other recurring themes (consolidated):**
1. **Strategy ↔ Keyword Hub boundary** (#1, #2, #6, #11) → curated-vs-universe; curated keyword set lives on **Strategy → Rankings ("Keywords & Rankings")**, links out to the Hub. Dedup Local SEO (#1) + backlinks→Links page (#12a).
2. **Send-to-client = universal action** (#3, #4, #6b, #10, #12b) → build ONCE generically (`strategy_recommendation` adapter + per-type renderer; cannibalization already proves it).
3. **Make passive lists managed sets** (#6, #9a) → add/remove/keep + auto-replenish.
4. **Every item needs why → how → projected result** (#8a, #9c) → operator trust + a prerequisite for client-send.
5. **Information overload / lists too long** (#3, #8b, + #6 truncation) → ONE global cap-N + "show more" and/or compact-card + progressive disclosure.
6. **Context pre-seeding at every "turn into work" handoff** (#8a) → carry full computed context into the generator, not a bare keyword.
7. **v2 specced-but-deferred / lost actionability** (#4 cannibalization orphaned, #7 signal-fold deferred) → AUDIT what else got reverted to passive (DecayingPagesCard survived; CannibalizationTriage/RequestedKeywordTriage/LostQueryRecoveryCard?).
8. **Live reactions flipping locked spec decisions** (#5 un-retire What Changed; #11 Rankings "intentionally thin" → too empty).
9. **Bugs:** "Computed X ago ago" (#7).
