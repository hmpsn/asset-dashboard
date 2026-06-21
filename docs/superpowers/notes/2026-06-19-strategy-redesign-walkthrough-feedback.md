# Strategy Redesign Walkthrough — Feedback Capture (round 2)

**Date:** 2026-06-19
**Context:** Post-merge walkthrough of the admin IA redesign (P1–P4, all merged to staging). Run locally on `~/.asset-dashboard` with the 3 P4 child flags ON for **Faros** (`ws_1772637771590`); managed keyword set + 53 folded signals populated. The **#12c client 3-layer recommendation platform is NOT built** (known keystone gap — the client-facing track).
**Method:** Josh drives and calls out items; Claude captures **verbatim** where possible + clarifications. **NO solutioning until all feedback is collected**, then we decide the path forward.

> Format per item — **[N] Screen/element** · what Josh said (verbatim) · _clarification Q&A_ · `tags`
> Tags: `ux` `copy` `data` `layout` `bug` `monetization` `scope` `idea` `parking-lot` `keystone`

---

## Captured items

**[1] Strategy → Overview → "Strategy Configuration" collapsed panel** (`StrategyConfigPanel` — the consolidated DataForSEO · 500 pages · Context · 5 competitors config disclosure)
- Verbatim: _"This is supposed to be at the top of the page, above the tab selectors. It's at the very bottom."_
- Read: the config disclosure currently renders at the **bottom** of the Overview tab; Josh expects it at the **top of the page, ABOVE the tab selectors** — i.e. page-level chrome (visible across all tabs), since it's the parent/config that drives the whole strategy. Ties back to original walkthrough #1 ("it's the parent of this entire page").
- Code: rendered inside `KeywordStrategyPanel` at the foot of the flag-ON Overview; target placement is above the `TabBar` (page chrome), not inside a tab.
- `layout` `ux`

**[2] Strategy → Overview → Keyword Cannibalization (`CannibalizationTriage`)** — selected the "faros" issue card (competing pages list + Send to client + Mark resolved + per-page Fix in editor)
- Verbatim: _"We discussed in depth that we should be able to select a cannibalization target page, basically overriding the recommendation. And that we'd already built it and ignored it. We still haven't implemented that."_
- **VERIFIED — confirmed NOT implemented.** The triage only **displays an auto-derived keeper** (`keeperPathOf()` = canonical tag if set, else best-ranking page — read-only). There is **no operator affordance to select/override which page is the keeper**, and **no server endpoint/store** for an operator keeper override. The work is a tracked-but-unbuilt roadmap item: `strategy-cannibalization-operator-keeper-override` (P3, est M, logged 2026-06-16 "Owner refinement", still pending). = original walkthrough item #4(a).
- This is a **"missed across the whole redesign"** item — specced + roadmapped months ago, never built.
- `ux` `scope` `data`

**[3] Strategy → Overview → "Curate recommendations" cockpit → Sort control (Value / Impact / Age)** (`StrategyCockpit`)
- Verbatim: _"These don't work"_
- **VERIFIED — live repro.** Clicking Value → Impact → Age flips the button's `aria-pressed` state but the rendered recommendation order is **byte-identical across all three** — including **Age** (sorts by `createdAt`, so a real reorder was expected). The sort is not reaching the rendered list.
- Code note (for diagnosis, not a fix): the handler LOOKS wired — `setSort(s.id)` → `visible = useMemo(() => sortRecs(filtered, sort), [inBucket, cats, sort])`, and `sortRecs` correctly differentiates value (`opportunity.value ?? impactScore`) / impact (`impactScore`) / age (`createdAt`). Yet nothing re-orders. Also note the **FIX NOW** section is hardcoded `sortRecs(..., 'value')` and capped at 5, so it never responds to the toggle regardless. Root cause TBD.
- `bug` `ux`

**[obs-A] (Claude-observed, NOT user-tagged — verify) Cockpit shows duplicate recommendation rows.** While repro'ing [3], the cockpit rendered `Keyword Cannibalization: "faros community edition"` **3×** and `Site-Wide: Cwv Lab` **2×** (distinct rec IDs, same title). ⚠️ **Likely an artifact of the local strategy regen Claude ran to populate signal-fold** (related to the carry-over dup-ID bug already flagged) — NOT confirmed on production data. Flag to verify whether real (a generation bug minting near-duplicate cannibalization/audit recs) vs local-only before treating as a product issue.

**[4] Strategy → Overview → Curate recommendations cockpit → "Select all 197" control** (`StrategyCockpit` + `useCurationSelection`)
- Verbatim: _"Simply use a checkbox for select all and unselect all. Like we do on the keywords page. This also falls strangely in the middle of the list? I'm not 100 sure why/how is built like this."_
- **[4a]** Replace the ghost **text-button** "Select all N" with a **checkbox** (select-all / unselect-all), matching the Keyword Hub pattern (`HubKeywordList.tsx:268` "Select all visible keywords" checkbox).
- **[4b]** **Placement is confusing** — verified: the cockpit renders the FIX NOW capped section first (`StrategyCockpit:118`), THEN the sort/category controls, THEN "Select all {visible.length}" + the bucket list (`:199`). So the select-all lands **mid-list** (after the Fix-now rows) instead of at the top of the selectable list. Reads as "why is this in the middle."
- `ux` `layout`

**[5] Strategy → Overview → Curate recommendations cockpit → the recommendation list** (`StrategyCockpit`)
- Verbatim: _"We discussed a maximum number of items before 'load more'. This is still as long as it could possibly be."_
- **VERIFIED — confirmed NOT capped.** Only the FIX NOW group is capped (`.slice(0, FIX_NOW_CAP)` = 5, `:78`). The main `visible` bucket renders the **entire set** (`visible.map(...)`, `:213`) with **no cap and no "load more"/show-more**. `useShowMore` (added in P1 to the 4 legacy leaves) was **never applied to the v3 cockpit** — i.e. the headline list, exactly where the overload is worst. = original #8b (global cap-N + "load more"), unaddressed on the main surface.
- Pattern: redesign built the cap-N affordance but didn't wire it into the cockpit that replaced the old surfaces.
- `ux` `layout` `scope`

**[6] Strategy → Content → "Topical Authority" (`TopicClusters`)** — cluster cards with "Keep" buttons + coverage bars (maxVisible:5)
- Verbatim: _"Still no ability to add/suggest clusters."_
- **VERIFIED — confirmed.** `TopicClusters` ships ONLY a **Keep** affordance (`topic_cluster_keep` via `tracked_actions`, gated `strategy-keywords-managed-set`). There is **no add / suggest / remove**. The managed-set spec deliberately scoped Topic Clusters (+ Content Gaps) to **keep-markers only**, while add/remove/auto-replenish/search-and-add went to the *keyword* set. So original #9a's "add new authority clusters, remove them" was **not** implemented for clusters — keep-only.
- Related still-open from original #9 (not tagged here, noting for completeness): #9b run-research-off-a-cluster, #9c why→how→result narrative per cluster.
- Note: the cap-N IS applied here (`maxVisible:5`) — contrast with the cockpit [5] where it isn't.
- `ux` `scope`

**[7] Strategy → Content → Decaying pages (`DecayingPagesCard` → `WhyHowResult`)** — the insight / "why" narrative text
- Verbatim: _"This overflows the bounds of the page making the content inside of it useless, because you can't see it."_
- **VERIFIED.** The text renders through `WhyHowResult` in **compact mode** (`expanded=false`, the default), which clamps the Why line to a **single truncated line** (`truncate`, `WhyHowResult.tsx:128`). The full **Why → How → Result** tiers (multi-line, readable) exist only in **`expanded` mode** (`:134+`), which `DecayingPagesCard` never sets. So the narrative the operator needs to read is cut to one ellipsis'd line → unreadable.
- This is the why→how→result narrative (original #9c / theme "every item needs why→how→result") — **built, but rendered in truncated/compact form so its content is invisible**, defeating the purpose (and it's a prerequisite for client-send).
- `ux` `bug`

**[8] Strategy → Keywords & Rankings → "Site Target Keywords" (`SiteTargetKeywords` — the managed set, original #6)** — 15 curated keywords w/ volume + KD + per-row icon actions, Add input, Show less. ⭐ **OVERARCHING**
- Verbatim (data/curation): _"Are these the highest value keywords we're targeting each site? Is this the most important data for an admin to see to be able to make an informed decision about removing, adding, why its important?"_
- Verbatim (icons): _"These buttons have no words/context, so I have honestly no idea what they do."_
- Verbatim (overarching): _"This is kind of my over arching feedback. As an admin, if I were to be able to pop into the strategy, I should be able to understand the lay of the land and prepare for a client meeting, recommendations, etc."_
- **[8a] Right keywords + right data?** Are these the **highest-value** keywords, and is what's shown per keyword (volume/mo, KD only) the **most decision-relevant** data to decide add/remove and understand *why it matters*? (Today: auto-populated by the reconciler's opportunity ranking; per-row data = volume + KD.) — product/data-design question.
- **[8b] Unlabeled icon actions.** VERIFIED: each row uses icon-only `IconButton`s — Track (`+`/`✓`), View in Hub (`↗`), Keep/Add-to-set (bookmark), Remove (`✕`) — with hover `title`/aria-label tooltips but **no visible labels**. At a glance the admin can't tell what they do, and `✓`(=tracked) reads like done/keep. Ambiguous icons + hover-only context.
- **[8c] ⭐ NORTH STAR:** the Strategy page's job = let an admin **"pop in, understand the lay of the land, and prepare for a client meeting / recommendations."** That's the success bar the whole redesign should be judged against — *orientation + client-prep*, not a wall of controls. (Sharper restatement of the original "Strategy = decide/act + orient.")
- `ux` `data` `copy` `keystone`

**[9] Strategy → Keywords & Rankings → "Keyword Opportunities" (`KeywordOpportunities`)** — numbered AI-suggested keywords; `↗` per row + inconsistent "Interested in this one?"
- Verbatim: _"Same feedback here. Not sure what to do with this section or what these buttons do."_
- Echoes [8] / the north-star: purpose + button meaning aren't legible. VERIFIED specifics:
  - **(a)** the `↗` is "Explore in Hub" — **icon-only**, hover tooltip only, no visible label (same unlabeled-icon issue as [8b]).
  - **(b)** "Interested in this one?" is the send-to-client #6b affordance, but it shows on **only some rows** — by design it appears only when the opportunity has a **matching sendable backing rec** (matched on `targetKeyword` + `isSendable`). To the user this looks inconsistent/arbitrary with no explanation of why row 2 & 3 have it and 1, 4, 5 don't.
  - **(c)** the section doesn't say what it's **for / what to do** — only "AI-generated suggestions… validate with keyword research before acting."
- This is the "Keyword Opportunities = ask client 'interested?'" feature (#6b) that *was* built — but it's not legible as such.
- `ux` `copy`

**[10] Strategy → Keywords & Rankings tab — SECTION ORDER (`StrategyRankingsTab`)**
- Verbatim: _"The ordering of this tab probably needs to flip to: Ranking distribution / Keyword Feedback / Target Keywords / Keyword Opportunities"_
- Current order: Hub deep-link → **Site Target Keywords → Keyword Opportunities → Client Keyword Feedback → Ranking Distribution** (+ Search Intent Mix).
- Desired order: **(1) Ranking Distribution → (2) Client Keyword Feedback → (3) Site Target Keywords → (4) Keyword Opportunities.**
- Rationale (implied, ties to north-star [8c]): lead with the **orienting data** (rankings = lay of the land), then the **client signal** (feedback), then the **curated set**, then **opportunities** — orient → act.
- `layout`

_(clarifications to resolve before any solutioning)_

---

## Themes

**🔴 CORE CRITIQUE (Josh, top-level, the apex of this round):** _"making this dashboard actually useful, usable, and efficient… We've moved in the right direction, but I just don't know what to do to get it working as well as it could. I feel like we've kind of just moved things around but not really changed anything. At its core. it feels like we're being a bit unimaginative in how to actually make this useful, and I don't know how to solve for that."_
→ The redesign was **rearrangement, not reimagination.** Every round treated feedback as "move/relabel/wire a control," so we optimized the *arrangement of the same parts* and never changed the **operator's job**: today the page asks the admin to read ~195 recs + 15 keywords + 8 clusters and assemble a point of view in their head. The missing imagination = flip the job from **"operator assembles a dashboard of inputs" → "system drafts a meeting-ready point of view; operator curates + sends."** That is the same idea as the deferred **#12c keystone** (system proposes → human curates the narrative). We built the *control panel*; we never built the thing that *drafts the point of view*. **This is the real work, and it's a design/imagination problem, not a rearrangement problem.**

**Stakes + the 4 jobs (Josh, follow-up):** _"this is the CORE functionality of our platform before we write content… The recommendations that come from here are literally the most important thing we can have. And making this user experience make sense is the only way we're going to be successful… the fact that we can't figure out how to display it — or even think about it is alarming."_ This surface does **four jobs at once**, all served by ONE artifact (a curated recommendation set):
  1. **Prep for client meetings** (the north-star).
  2. **Step one / source of the client dashboard** — the admin curates here; the client gets the streamlined view (= #12c layer 3).
  3. **Where we decide the content** the client should focus on (feeds the content pipeline).
  4. **Where we decide the keywords** they should target.
→ Reframe: the Strategy page is a **production line for the curated recommendation set** — system reads the evidence (rankings/decay/cannibalization/gaps/competitor/feedback) → **drafts** the recommended moves (content + keywords, with why→result) → operator **curates** (keep/cut/edit/reorder) → output simultaneously = meeting briefing + client-dashboard feed + content direction + keyword targets. The UI today shows all the *inputs* as co-equal sections and makes the human do the synthesis; the job is to make the system do the first draft and the human curate it.

**⭐ NORTH STAR (Josh, item [8c]) — the frame for everything:** the admin Strategy page exists so an operator can **pop in cold, understand the lay of the land, and prepare for a client meeting / recommendations.** Success = orientation + client-prep, NOT a page of controls. Every item below should be judged against "does this help me walk in and get ready to talk to the client."

**Emerging pattern (Claude, across [1]–[8], to confirm at synthesis):** the redesign **built the right pieces but didn't apply them into the v3 cockpit/surfaces correctly** — config panel built but mis-placed [1]; keeper-override specced, never built [2]; sort built but not wired [3]; select-all built as a button not a checkbox + mis-placed [4]; cap-N built but not on the cockpit [5]; cluster add/suggest never built (keep-only) [6]; why→how→result built but rendered truncated/unreadable [7]; managed-set actions are unlabeled icons + unclear if it's the right data [8]. The parts exist; the **integration into a usable, orienting surface** is what's missing.

_(more themes filled in during synthesis, after the walkthrough)_
