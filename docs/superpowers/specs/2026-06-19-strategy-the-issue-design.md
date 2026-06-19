# Design Spec — "The Issue": the curated recommendation artifact (admin curation layer + V2 client dashboard)

**Status:** Direction locked; adversarial completeness pass folded in (§15). Awaiting owner "lock" → phased implementation plan. Not yet built.
**Branch context:** follows the Strategy reimagination work on `strategy-redesign-phase-4`.
**Supersedes the intent of:** the twice-redesigned admin Strategy IA ("we rearranged, we didn't reimagine").
**Grounding docs:**
- `docs/superpowers/notes/2026-06-19-strategy-redesign-walkthrough-feedback.md` (the critique + north star)
- `docs/superpowers/notes/2026-06-19-strategy-reimagination-understanding-brief.md` (capability/data audit)
- `docs/superpowers/notes/2026-06-19-strategy-reimagination-phase-a-capability-map.md` (verified substrate — **ground truth**)
- `docs/superpowers/notes/2026-06-19-strategy-reimagination-phase-bc-tournament-verdict.md` (the 6-concept tournament)

---

## 1. The problem this solves

The admin Strategy surface is the product's core: its recommendations decide what content gets written, what keywords clients target, and what the client dashboard shows. Two prior redesigns rearranged the same parts — they kept the operator's job as *"read ~195 recs + 15 keywords + 8 clusters and assemble a point of view in your head,"* and they handed the client a wall of complexity the clients themselves called *"too complex, too much thought to understand."*

**The flip:** the system already drafts a value-first point of view (verified ~70% built); the human's job becomes **curate a finished draft**, and the client's job becomes **comprehend a stated meaning and decide** — not derive it.

### North star
An operator can *pop in cold, understand the lay of the land, and curate a client-ready point of view fast.* Win condition = **time-to-prepared + client comprehension**, not features-on-page.

### The artifact serves four jobs from one curated set
1. Client-meeting value/prep.
2. **The V2 client-dashboard recommendation feed** (the prize / where the money is).
3. The content direction/plan.
4. The keyword targets.

### What this surface IS — the configuration surface

The admin Strategy surface is the agency's **configuration / control surface**: where all the data we collect is confirmed, steered, and shaped into what ultimately reaches the client. "Curate" therefore has two depths: (a) **remove / suppress / pick the keeper** — cut, park, cannibalization keeper-override — shipping in this overview redesign; and (b) **steer the recommendations themselves** — modify/correct a wrong one, reorder, and add the one the system missed — the owner-emphasized **deeper steering** that is the planned **follow-up batch** (§12), kept out of Phase 1 only to keep it tractable (these are the LARGE/MEDIUM lifts Phase A flagged). The point of view: nothing reaches the client that the operator hasn't confirmed and shaped.

### Scope of THIS redesign

We are redesigning the two **overview surfaces** — the admin Strategy cockpit and the client dashboard overview. The **interior deep-dive pages** (Keyword Hub, content pipeline/editor, page intelligence) are **reused and linked to**, not redesigned now. The **full competitor page** is a net-new interior page in a later phase. So: **overviews now; interiors linked/reused; deeper operator-steering + the competitor page are follow-ups.**

---

## 2. Locked design decisions (owner, 2026-06-19)

| Decision | Choice | Implication |
|---|---|---|
| **Client opening** | **Blend: proof → plan** | Client surface leads with a short earned-results band, then the narrated value move + cards. |
| **Trust dial** | **System drafts the opinion as PROSE** | The system writes the narrated point of view; the operator edits / cuts / keeps. Biggest job-flip. |
| **Delivery** | **Both: standing page + weekly nudge** | A standing Strategy page, plus each week's issue pre-baked and pushed via doorbell to review/approve. |
| **Cadence** | **Weekly (internal)** | The operator curates on a weekly rhythm (regen tick + push nudge). No meeting-date data exists; calendar-tie is out of scope. |
| **Client framing** | **Evergreen** | The client experiences a continuously-current dashboard — NO time-relative language ("since last week", issue numbers). Proof is framed "what's working right now". |
| **Monetization** | **Retainer greenlight, NO pricing UI** | "Act on this" = a work-scope/priority signal, billed separately. No checkout, no TierGate in this surface. |
| **Automation posture** | **Manual now, trust ladder later** | v1 the operator gates everything the client sees; a designed-in path auto-sends low-risk buckets after N consistent cycles. |

---

## 3. The artifact: "The Issue"

**The Issue** (internal/admin codename — the client never sees an "issue" or a date) is the per-workspace, system-drafted, operator-curated recommendation set, expressed as a value-first point of view. The operator curates it on a weekly rhythm; **the client experiences it as an evergreen, continuously-current dashboard**. It is one object seen twice:

- **Admin side = the curation layer.** The operator reviews the system's draft (with full detail), subtracts the noise (cut / park / fix-silently), and tightens the prose. This gate is what fixes "too much for a client to hack through."
- **Client side = the money surface.** The client opens to proof-then-plan: what the work earned, then the curated moves as plain value statements, each with one decision — "act on this" (retainer greenlight) or "let's talk."

The same Issue also *projects* into the meeting view, the content work-order, and the keyword-target list (job #1/#3/#4) — see §9.

---

## 4. Admin curation layer

The operator opens a **pre-baked weekly Issue** (cheap content-hash recompute, so it opens ready, not spinning). Top-to-bottom:

1. **Header** — client + `Issue #N · week of <date>` + status (`drafted by system — ready to curate`) + `Preview as client` toggle + `Send issue to client` (primary). The strategy-generation config (`StrategyConfigPanel`: provider, max pages, competitors, context) lives here as **page chrome above the surface** (walkthrough [1]), not buried at the bottom of a tab.
2. **Stance glance** (PORTFOLIO graft, **admin-only**) — a single archetype allocation bar read in ~10 seconds: `4 new authority bets · 3 refresh & reclaim · 2 defend · 5 quick wins · 6 technical`, with cut/parked counts. Free from `RecType` + a thin archetype map.
3. **The point of view** (PULSE — the synthesis surface) — the system-drafted narrated POV the client will read, **editable inline**: a dateline ("since we last spoke…"), "the one move I'd bring this cycle" with its business impact, plus short "wins worth saying out loud" + "what I'd flag" lists. Drawn from the re-pointed meeting-brief generator (§8) over the **curated** set.
4. **Backing moves** (QUEUE — the curation engine) — the recs grouped by archetype, each a card: value headline + `estimatedGain` on the face, confidence + archetype chips, `Why?` progressive-disclosure (the deterministic `insight` + `opportunity.components[].evidence` one-liners), and the fast verbs. Each archetype loads a **system-defaulted shortlist** (top-value N pre-kept) with the rest behind "show the rest" — the operator never faces the full ~195-rec wall (walkthrough [5]); the default state is "the system already subtracted the noise." **Cannibalization backing-move cards carry an operator keeper-selector** (which page survives), backed by the already-roadmapped keeper-override store/endpoint (walkthrough [2] — the item missed three times). **Cutting a card removes the sentence it backs from the POV above** — the signature move that makes curation and prep the same act.

**The job-flip:** the operator subtracts from and tightens a finished opinion; they never assemble one from raw panels. The §4.3 point of view, re-pointed over the curated set, **is the v1 meeting-prep deliverable (job #1)** — served in Phase 1, not deferred to a lens.

---

## 5. Client money surface (V2 client dashboard recommendation layer)

**An evergreen, continuously-current dashboard** the client pops into anytime — NOT a dated edition. No time-relative language ("since last week", "this week", issue numbers). It should read like a status update from a high-end SEO firm: engaging and informative enough that a client *wants* to spend 10–15 minutes on it, yet **far more digestible than today's**. The current client dashboard (see the captured screenshot) lays out 12+ co-equal sections (health ring, 5-stat strip, attention banner, #1 priority, grow-traffic, monthly performance, site intelligence, your results, predictions, 10 insight cards, content opportunities, recent work, advisor) and clients call it "too complex." The reimagined surface **leads with meaning and pushes detail behind progressive disclosure**, with a **varied, editorial, interactive card rhythm** (not monotonous full-width rows). No admin jargon, no archetype/confidence/severity, no purple, no pricing; **one decision per card**.

Opening order is the locked **blend (proof → plan)**, expressed evergreen, and structured as a **curated feed that links out to the interior deep-dive pages** — the feed is the entry layer; depth (content briefs, page intelligence, keyword hub, competitive) lives on the existing interior pages every card links to:

1. **Narrated status headline** (PULSE) — one or two sentences of plain-English meaning about where the site stands and where the momentum is, anchored to the client's *stated goal*. Evergreen ("your visibility is climbing… toward more qualified demos"), never time-stamped. A compact trend chip + a single health number sit beside it; the full metric strip is one tap away ("see your numbers"), not shoved forward.
2. **Content plan** (the prominent, dedicated section — *this is how the agency makes money*, so it leads the plan) — **multiple** content recommendations near the top, each a value-first card ("publish X → capture ~Y searches/mo → projected Z"), with the highest-priority one emphasized. Each links out to the **recommendation's details** (not a pre-made brief). **`Act on this` is a content REQUEST** — the client approves the recommendation and it enters the agency's work queue (retainer greenlight). **Nothing is pre-generated or generated on the fly**; the operator decides whether/when to create the brief. The client CTA reads "Act on this / Request" — never "open the brief", because the brief doesn't exist until the agency acts.
3. **Also on your plan** (secondary, compact, de-emphasized below content) — the non-content moves (refresh & reclaim, technical, keyword/topic, defend) grouped and lighter, each linking out to its interior page; `Act on this` where relevant.
4. **What's working right now** (LEDGER graft, evergreen) — a compact strip of 2–3 result tiles framed as current state ("cycle-time guide now #3", "'engineering KPIs' on page 1 — we called it", "organic value trending up"), NOT "since last week". On a **thin/new client** it degrades to a "queries you're losing / at stake" strip — never blank.
5. **Quiet footer** — "ask your strategist" (reuse the existing advisor) + the loop status ("you've greenlit 4 moves · 1 in discussion", from pre-aggregated `recResponses`).

Rendered in the client's **calibrated brand voice** so it reads like the agency wrote it. The richness that justifies a 10–15 min read lives in the on-demand "the full story" expanders, not in visible clutter.

---

## 6. The curation grammar (verbs → existing lifecycle)

Cheap verbs that map 1:1 onto the verified single-writer lifecycle (`server/recommendation-lifecycle.ts`):

| Verb | Lifecycle mutation | Framing |
|---|---|---|
| **Keep** | no-op (default) | "leave it in the Issue" |
| **Cut** | `strikeRecommendation` (reversible Undo) | "drop this line" — the backing sentence vanishes from the POV |
| **Park** | `throttleRecommendation(7/30/90d)` (auto-resurfaces) | "not this issue" |
| **Send** | `sendRecommendation` (issue-level atomic bulk-apply) | the single "Send issue" commit |
| **Fix (silently)** | `fixRecommendation` (internal `status`, never client-facing) | "we'll just do it" — leaves the client letter |

**Editing the POV** is editing the *narrative prose* (a stored, regenerable artifact) — cheap — **not** rewriting individual rec wording in place (LARGE, deferred — see §11). Ordering uses the fixed archetype-bucket order + the system's lead-move pick; **drag-reorder is deferred** (LARGE).

---

## 7. Closing the loop (the #12c keystone) — the revenue spine

Today "Send to client" is a write-only dead end: the public rec read ignores `clientStatus`, no `normalizeRecommendation` adapter exists, and even the one `sendChannel:'deliverable'` policy isn't wired. **Closing this is core to job #2.** The clean path (per Phase A): route rec-sends through the **deliverable spine** (approve/changes-requested/decline + remind + live updates). The completeness pass found the loop as first written was *two half-loops*; these contracts close it:

- **Operator send → client sees** — `sendRecommendation` mints a generalized **rec→deliverable** (born `awaiting_client`, stamped with the **source rec id + `targetKeyword` + the rec's `StrategyCardContext`**), wiring the mirror branch in both per-row and bulk send handlers. A `normalizeRecommendation` adapter renders it in the curated client feed. (MEDIUM)
- **Client `Act on this` is a durable content REQUEST, not generation** — it writes a **durable server-side request record** (a content request) carrying the rec id + `targetKeyword` + `StrategyCardContext`, and sets `clientStatus → approved`. **Nothing is pre-generated or generated on the fly** — approval creates a *request*, not a brief. It does **NOT** fire `fixContext` (admin-only navigation state). Later, **at the operator's discretion**, the operator works the request and *may* use `fixContext` to pre-seed the brief generator from the record — a deliberate manual step, never automatic.
- **Apply is respond-only for rec-derived deliverables** — the deliverable `/apply` route resolves a `legacyBatchId` that rec-derived deliverables don't have (it would 400). They are **`applyable: false`** (no Apply button): greenlight = `clientStatus → approved` + work-queue item + a `TrackedAction`. Marking the work **complete is a manual operator action** (matches the locked "retainer greenlight"). Auto-apply / a rec-completion bridge is deferred.
- **Greenlight → result attribution (the "we called it" join)** — when a greenlit rec is marked delivered, create a **`TrackedAction` with a baseline snapshot keyed to the rec id + `targetKeyword`**, and carry the rec id onto the resulting brief so a later `milestone_attribution` resolves back to the originating move. "What's working right now" then surfaces the client's **own greenlit-and-winning moves first** ("the move you chose is now working") rather than decoupled, ambient wins. Without this join the loop only *looks* closed.
- **Silent `Fix` still earns credit** — every fix path (client-greenlit OR operator-silent) creates a `TrackedAction` (`platform_executed`); the only difference is whether it surfaced as a client decision, not whether the agency gets "we handled this" attribution.

---

## 8. Data & substrate (build on, don't reinvent)

Verified reusable (Phase A map): the meeting-brief draft engine (re-point its prompt at the **curated/sent** set + expand its content-hash signal — MEDIUM); zero-AI renderable recs (`insight` + `estimatedGain` + `evidence`); free archetype + create/refresh/defend maps; the two-axis lifecycle + carry-over (survives weekly regen) + `isActiveRec`; the atomic bulk-apply route; the deliverable respond/apply/remind spine; the weekly push cron + batched doorbell email rail; calibrated brand-voice prose; and the unexploited anchors — the **send-history ledger** ("since we last spoke"), pre-aggregated **recResponses** ("the loop"), the client's **stated goals/personas** ("toward YOUR goal"), and **lost queries** (thin-week stakes strip).

**Net-new work (with lifts):** strategy-POV fusion op + cache-signal (MEDIUM); `normalizeRecommendation` / rec→deliverable adapter + send-handler mirror (MEDIUM); pushed weekly Issue job — clone `briefing-cron` + one `BACKGROUND_JOB_TYPES` entry (MEDIUM); archetype + create/refresh/defend presentation maps (SMALL); expose a client-safe `delivered` projection (SMALL).

**Reuse the existing client dashboard — don't rebuild it.** The current client surface (`src/components/client/StrategyTab.tsx`, `InsightsEngine.tsx`, `StrategyClientOrientHeader.tsx`, the #1-priority card, the monthly-performance narrative, content-opportunities, recent-work, the SEO advisor) already ships most of the pieces. The reimagination **curates, reduces, and re-sequences** them (admin-gated) into the digestible evergreen editorial flow. Net-new is the curation gate + the proof→plan sequencing + the noise reduction + the closed loop — not new component families.

---

## 9. The four-jobs projection

- **Job #1 (meeting prep)** — served in **Phase 1**: the admin §4.3 point of view, re-pointed over the curated set, IS the meeting deliverable. Not a deferred lens.
- **Job #2 (client feed)** — the core (§5).
- **Job #3 (content direction)** — led by the client content section (§5.2) + the durable act-on → **content-request** record (§7); the agency works the request manually (no auto-generation).
- **Job #4 (keyword targets)** — curated `keyword_gap` + `topic_cluster` recs (status active/sent) projected through the existing managed-set / Keyword Hub deep-links. Acceptance: a curated keyword/topic rec appears as a target the operator (and client) can act on. Kept a later phase, but contracted here so it isn't orphaned.

These are projections of one source of truth; the #3/#4 lens polish lands after the core artifact + loop ship.

---

## 10. Delivery, cadence & the trust ladder

- **Standing page** at the `seo-strategy` route (the Issue as the default surface) **plus** a **pushed weekly Issue**: a cron pre-bakes next week's draft and pings the operator's doorbell ("Faros Issue #15 is drafted and ready to curate"). "Opens ready" is literal. The weekly/episodic framing is **operator-facing only** — the client dashboard never shows issue numbers or dates; it simply reflects the latest curated state (evergreen).
- **Trust ladder:** v1 manual (the Issue waits for the operator's `Send issue`). Designed-in path: a per-archetype `auto-send Quick wins next time` toggle that, once the operator has greenlit the same low-risk bucket N consecutive issues, promotes it to auto-send with a review window.

---

## 11. Out of scope / deferred

> **Operator steering** (edit/correct a rec, reorder, generic add) is **deferred to a named follow-up phase (§12) — NOT abandoned.** The owner flagged guiding/modifying recommendations as extremely important (Strategy = the configuration surface, §1); it's kept out of the overview redesign only to keep Phase 1 tractable.

- **In-place editing of a rec's wording** (LARGE — no write path; must survive weekly regen re-mint) — operator-steering follow-up. v1 edits the *narrative prose*, not rec atoms.
- **Drag-to-reorder** recs (LARGE — no persisted sort order).
- **Calendar / real meeting-date tie** ("meeting Thursday") — NO backing data exists; cadence keys off the weekly tick. A simple manual `next_meeting_at` field is cheap if later desired.
- **Pricing / tier-gating / per-item checkout** — explicitly out; "act on this" is a retainer greenlight.
- **Generic add-a-rec** (MEDIUM) — exists competitor-only; generalize later if needed.
- **Auto-apply / rec-completion bridge** — deferred; rec-derived deliverables are respond-only and marked complete manually by the operator (§7).

---

## 12. Feature flag & phasing (one PR per phase)

New flag `strategy-the-issue` (add to `shared/types/feature-flags.ts` before the first commit; dark-launch each phase). Proposed phases (one PR each; N+1 not started until N is merged + green on staging):

1. **Admin Issue surface** — artifact + config-as-page-chrome (walkthrough [1]) + stance glance + drafted narrated POV (= job #1 meeting deliverable) + archetype-shortlisted keep/cut/park/send queue with backing-moves cap (walkthrough [5]) + **cannibalization keeper-override** (walkthrough [2]) + preview-as-client + send-issue, behind the flag. (Strategy-POV fusion op; archetype maps; POV-cache signal §15 D2.)
2. **Close the loop** — client money surface (blend, content-led, content floor §15 D1) reading the curated/sent projection; rec→deliverable routing with the durable act-on record (§7); respond-only apply (§7); greenlight→result attribution (§7). (#12c.)
3. **Pushed weekly Issue** — clone `briefing-cron` to pre-bake + doorbell nudge.
4. **Trust ladder** — per-archetype auto-send after N consistent cycles.
5. **(Later) Four-jobs lenses** — content work-order + keyword-target (job #4) projections (job #1 already served in Phase 1).
6. **(Later) Full competitor page** — promote the competitor snapshot/intelligence into a dedicated competitor surface (share of voice, gaps, backlinks, alerts) on both sides.

**Operator steering (owner-emphasized — the likely NEXT BATCH after the overview ships).** The deeper curation verbs from §11: **modify/correct** a rec's wording, **reorder**, and **add-a-rec** the system missed — the LARGE/MEDIUM lifts (persisted edit + `sortOrder` + generalized mint), all surviving the weekly regen carry-over. The overview redesign already ships remove/cut/park/keeper-override; this batch adds *shape-and-correct*, completing Strategy as the full configuration surface. Sequences after Phase 1–2.

(The site-analytics stats bar [client] and orientation glance [admin] are part of Phase 2 / Phase 1 respectively, mostly reusing existing components.)

---

## 13. Success criteria

- **Time-to-prepared:** an operator unfamiliar with a client can open the Issue and reach "ready to send / ready to talk" in minutes, not by assembling panels.
- **Client comprehension & engagement:** evergreen and value-first, leading with meaning and hiding detail behind progressive disclosure — measurably less cluttered than today's 12-section dashboard (the explicit client complaint), yet engaging enough that clients *want* to spend 10–15 min/week on it. One decision per card. No time-relative language.
- **Loop closed:** a sent rec actually reaches the client, the client can act/respond, and the response flows back — no write-only dead ends.
- **Curation is fast:** <60s/item triage; the noise is gone before the client sees it.
- **Reimagination, not rearrangement:** the operator subtracts from a drafted opinion; the client comprehends a stated meaning. Neither "assembles."

---

## 14. Open questions for the implementation plan

1. POV prose persistence — RESOLVED in principle (§15 D2: persist as a versioned field; cache hash = curated/sent rec id-set + their `clientStatus` + a hash of prose edits + manual "regenerate POV"). Implementation choice for the plan: extend the meeting-brief store vs a new strategy-issue store.
2. Apply semantics — RESOLVED (§15 C1: rec-derived deliverables are respond-only; "complete" is a manual operator action).
3. Does the standing page render the *latest pushed* Issue or recompute on visit (and how do operator edits since the last push reconcile)?
4. Exact archetype map (the 6 buckets) and the create/refresh/defend headline derivation — confirm against the live `RecType` union.

---

## 15. Completeness-pass resolutions (adversarial review, 2026-06-19)

A 4-reviewer pass confirmed the spec is sound to lock; the one weak spot was the revenue loop (it was "two half-loops"). Resolutions:

**Contracts now in the spec (must hold):**
- **C1** — Apply is respond-only for rec-derived deliverables; greenlight = `approved` + work-queue + `TrackedAction`; complete = manual operator action. (§7)
- **C2** — Greenlight→result attribution via a `TrackedAction` keyed to rec id + `targetKeyword`; "what's working" surfaces the client's own greenlit-winning moves. (§7)
- **C3** — Client `Act on this` writes a durable server-side work-queue/brief-intent record; it never fires the admin-only `fixContext`. (§7)
- **C4** — Cannibalization keeper-override is **in Phase 1** (walkthrough [2], missed 3×). (§4, §12)
- **C5** — Silent `Fix` still creates a `TrackedAction` (`platform_executed`) for attribution. (§7)
- **C6** — Job #1 served in Phase 1 (admin POV); Job #4 contracted with a source + acceptance. (§9)

**Defaults folded in / to apply during planning (rubber-stamped, non-architectural):**
- **D1** — Content-section floor: the lead content section is never empty; <2 curated content recs → fallback ladder (un-curated content gaps → topic-cluster gaps → lost-query) framed "opportunities we're evaluating." Mirrors the §5.4 thin-client pattern.
- **D2** — POV cache signal as in §14.1; persist edited prose as a versioned field + manual "regenerate POV" escape hatch.
- **D3** — Client deep-link targets per archetype: content→content-plan/strategy, rankings→performance/roi; archetypes with no client interior page use an in-card "full story" expander instead of a link-out.
- **D4** — Admin "backing moves" cap: system-defaulted shortlist per archetype + "show the rest" (walkthrough [5]; also §4).
- **D5** — Evergreen copy guard: two prompt variants (admin keeps the dateline; client is evergreen — achieved-state + causal claim, no time anchor); add a temporal-phrase grep to phase acceptance.
- **D6** — Config placement: `StrategyConfigPanel` as admin page chrome (walkthrough [1]; also §4).

---

## 16. Full surface inventory (both overviews) — accounting for EVERYTHING, not just the spine

The reimagination centerpiece is the curated recommendation engine ("The Issue"), but each side is a complete dashboard with the engine as its SPINE and the rest as supporting context (mostly reused, subordinated — NOT a wall of co-equal panels). Owner additions folded here: a simple **site-analytics stats bar** and a **competitor surface** (growing into a full competitor page).

_Audited against the live codebase by the inventory sweep (2026-06-19); the **bold-marked** items below were dropped/under-scoped in the first draft and folded back in._

**Client dashboard (top → bottom):**
0. **Your turn / pending decisions** — "N items need your attention" (approvals, brief/post reviews, replies) with deep-links. Reuse (OverviewTab action banner / ActionQueueStrip). *(sweep: must-have)*
1. Narrated status (evergreen) + the #1-priority "why" contribution bars as progressive disclosure. New prose over reused header.
2. **Site-analytics stats bar** (simple) — visits / search clicks / impressions / avg position / health + **conversions / key-events**. Reuse.
3. **⭐ What your SEO is worth** — organic traffic value / ad-spend equivalent / revenue at stake / per-page value. Reuse (ROIDashboard, today orphaned on its own tab). *(sweep: must-have — the money proof)*
4. ⭐ Content plan (hero — the money) — multiple content moves, top emphasized, linking to the recommendation details (a **request**, not a pre-made brief; nothing auto-generated); **Relevant / Not-relevant** feedback alongside **Act on this** (= request). New.
5. ⭐ Also on your plan — refresh / technical / keyword / defend, compact, link out. New.
6. What's working (evergreen proof) — wins + **your requested-keyword rank trend** + **work-in-flight** (briefs in progress). Reuse outcomes / milestones.
7. Competitor snapshot — share of voice / you-vs-them → **future full competitor page**. Reuse data now.
8. Ask your strategist + **guide this strategy** (client-editable goal/priorities) + **the loop** (greenlit / discussing). Advisor + goal input reuse; **the loop is NET-NEW client render** (no component reads `recResponses` today). *(sweep: must-have — net-new, not reuse)*

**Admin Strategy cockpit (top → bottom):**
1. Page chrome + config (provider / pages / competitors / context) + generate/refresh + preview-as-client + Send issue. Reuse, repositioned.
2. Orientation glance — site health + visibility / clicks / impressions / avg-position (deltas) + **"What changed" structured diff** (added/retained/reassigned/retired + clickable per-keyword next-actions) + **search-intent mix** + **position movements** + (conditional) **local-SEO results** + anomaly linkage [reuse] + the archetype **stance bar** [new]. *(sweep: StrategyDiff = must-have)*
3. ⭐ The Issue — 3a drafted POV (editable prose = the meeting deliverable) + 3b backing-moves queue (archetype shortlist · keep/cut/park/send · keeper-override). New.
4. Competitor intelligence — share of voice / keyword gaps / backlinks → **future full competitor page**. Reuse.
5. Keywords & rankings — distribution / managed set / opportunities / feedback → Keyword Hub. Reuse.
6. Content — gaps / clusters / decay → content pipeline / editor. Reuse.
7. The loop / send history — sent / responses / overdue + **needs-attention strip** (stale-sent / superseded / new reply) + **strategy-scoped AI advisor**. Reuse (`listAdminDeliverables` + NeedsAttentionStrip + AdminChat).

**Scope discipline:** the MAP is complete; the BUILD is phased (§12). Most supporting surfaces REUSE existing components, re-homed under the spine — the sweep's additions are almost all existing renders the first draft dropped (the one genuine net-new is the client-side loop render). Net-new is concentrated in the spine + stance bar + the loop contracts (§7). The competitor full page is an explicit later phase. "Account for everything" (this inventory) ≠ "build everything at once" (the phasing).

---

## 17. Horizons — where this fits (VISION, not current scope)

Owner framing (2026-06-19) — captured to give future work a home; **explicitly NOT added to this build's scope**:

- **Overview surfaces = "right now."** The immediate curated plan — what's shipping this cycle and what the client sees today. *This redesign.* Fast curation grammar (keep / cut / park / send + keeper-override).
- **Interior admin pages (keyword, content, …) = "the midterm."** Per-page **control / dial-in micro-views** — the cannibalization keeper-selector, but generalized so each page's top-level recommendations can be steered at depth. This is exactly where the **operator-steering follow-up** (§11/§12: edit/correct/reorder/add) lives — page by page on the interiors. The cannibalization selector is the *template* for these micro-views.
- **Long-term views (e.g. the keyword universe) = "the long term."** The big strategic/exploratory surfaces.

The three horizons keep the overview focused on *now* (so it stays digestible), give the deeper steering controls a clear home (the interiors, midterm), and frame the exploratory surfaces (long term) — all without expanding the current redesign.
