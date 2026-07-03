# UI Rebuild Kit — Neutral Digest of the Proposed Platform

> Written for the persona-panel review. This is a *description*, not an endorsement. Every claim
> is grounded in a file inside `hmpsn studio Design System/` (paths given per section). Sample
> copy and numbers quoted below are the prototype's placeholder fixtures, reproduced so the panel
> can judge tone — they are not real data.

---

## 1. What the kit is

- **Source of truth for UX**: a working hi-fi prototype — `Keywords &amp; Flows Mockup.html` (the
  shell) + 41 JS view modules in `mockup/`. Vanilla JS, per-view injected CSS, hardcoded fixture
  data for 3 live demo clients (Acme Interiors / furniture, Northwind Kitchens, Bay Street Dental)
  plus one "new" client (Lumen Eyecare) used for the cold-start flow (`mockup/workspace.js`).
- **Operating manual**: `UI Rebuild Handoff Brief.html` — declares the prototype "the spec" for
  IA, flows, states, and component/hierarchy choices, and "indicative only" for copy, data,
  spacing, and one-off CSS. Mandates a Phase-0 additive-only functionality audit ("re-presentation,
  not a reduction"; losing a capability is a hard stop), a client-dashboard decision gate before
  any client-facing build, then ledgers → pilot Keywords → fan out → CI gates per surface.
- **Design system**: 59 components, dark default + shipped light theme, tokens-only styling,
  DIN Pro (headings/numerals/chrome) + Inter (body), Font Awesome Sharp icons. Four laws of color
  restated as: **mint = actions, blue = data, emerald = success, purple = admin-AI only** (note:
  the current platform's law #1 is *teal*; the kit's is *mint* — a deliberate palette shift).
- **Surface map**: 18 surfaces in five rail groups (brief, Part 2). The prototype actually ships
  more than 18 views — book-level views (Command Center, Inbox, Site Health, Action Results),
  admin views (Roadmap, Business, Settings, Workspace Settings), and non-registry drill-ins
  (Onboarding, Deep Diagnostics, Draft/Brief workspaces) sit outside the 18-surface map.

## 2. Navigation model (`mockup/nav.js`, `app.js`, `workspace.js`, `palette.js`)

"Model B — two-zone rail": a permanent **BOOK zone** (all-clients) above a **CLIENT zone** headed
by the active client's avatar+name, which doubles as the in-rail client switcher. As shipped:

- **The BOOK zone array is empty** (`nav.js` line 14: `const book = [];`). The book-level views
  exist (`home` "Command Center", `sitehealth`, `outcomes`) but have **no rail entries** — they are
  reachable only via the logo click, the ⌘K palette (grouped under "Your book"), or cross-links
  inside the Command Center. Inbox (`requests`) lives in a bottom utility bar with an unread badge;
  a gear popover there holds the admin menu (Roadmap · Business · Settings).
- **CLIENT zone groups** (colored group headers): *(ungrouped)* Cockpit, Insights Engine ·
  **Strategy & Content** Keywords `2→1`, Competitors, Content Pipeline, Local Presence ·
  **Search & Site Health** Search & Traffic, Site Audit `3→1`, Performance, Links, Asset Manager,
  AI Visibility · **Optimization** SEO Editor, Schema, Page Rewriter, Brand & AI ·
  **Client-facing** Recommendations (badge), Client portal. The client-zone header's gear opens
  per-workspace settings.
- **Consolidations**: Keywords is marked `2→1` (absorbs the old keyword-picking + keyword-rec
  screens; the view header says it "Replaces Keyword Hub · Page Intelligence"). Site Audit is
  marked `3→1` and its header comment says it "absorbs Performance … and Links" — **yet
  Performance and Links still ship as separate rail destinations** in the same prototype
  (`audit.js` comment vs `nav.js` items). The consolidation story is internally inconsistent.
- **Cold start coherence** (`app.js`): a client with `health:'new'` cannot open scoped views —
  the cockpit redirects to Onboarding, and navigating to Insights/Keywords/Pipeline/etc. silently
  switches you to a live client.
- **Command palette** (`palette.js`): ⌘K fuzzy jump across all surfaces + workspaces + actions,
  with persisted recents.
- **Group colors**: nav groups are tinted (blue, cyan, **purple for the whole Optimization group**,
  yellow for Client-facing). Purple as a nav-group tint sits oddly against "purple = admin-AI only."

## 3. The organizing concepts (recurring across views)

1. **Trust spine — VERDICT → VALUE → PROOF.** Every client-facing narrative opens with a
   plain-English verdict sentence, then a dollar band, then measurable proof.
2. **The graduation rule.** Technical fixes/wins "stay in the cockpit" (or Site Audit, Links,
   Assets, Local, AI Visibility) and only *graduate* into the Insights Engine when they become a
   provable client story ("recovered $1.1k/mo from dead links"). Nearly every workbench view ends
   with a graduation bridge.
3. **Provenance ladder.** Money figures carry `estimate → measured → actual` chips; client-facing
   dollar heroes carry an "agency estimate"/"projected" basis badge.
4. **Three work streams.** Operator work is triaged as *Optimizations* (fix), *To send* (client
   comms), *Monetization* (grow the account) — the home and cockpit are organized around them.
5. **The send boundary.** Dark operator workbenches above; the light, curated client microsite
   below. Client-visible content is always explicitly staged/sent, previewed in-place ("What Acme
   sees").
6. **Promotable requests.** A shared thread store (`store.js`) wires portal replies → operator
   Inbox/cockpit; a client *request* can be promoted into a strategy signal that appears as a
   backing move in the Insights Engine.

---

## 4. FULL DETAIL — the six priority operator surfaces

### 4.1 Cockpit (`mockup/cockpit.js`) — "Today, scoped to one client"

Landing view when you pick a client. Layout top-to-bottom:

- **Eyebrow** (`Client cockpit · Acme Interiors · Today, scoped to one`), then a **verdict header**:
  an H1 sentence ("Acme Interiors is on track — 3 things need you today.") + a sub-paragraph with
  mint-highlighted phrases naming the specific items (ready update, draft awaiting review, a rank
  slip with a dollar consequence).
- **Three stream tiles** (Optimizations / To send / Monetization) with counts; clicking routes to
  Insights Engine or Recommendations.
- **Left column — the client's work queue**: rows grouped by stream; each row = client avatar,
  title, meta ("rank anomaly · needs a content refresh"), an impact figure with direction coloring
  and a provenance chip ("-$1,500/mo · estimate"), and an action button (Send / Fix / Propose)
  that navigates to Recommendations or Insights Engine. A small "was: Today, filtered" annotation
  records what the section replaces.
- **Right rail, four cards**:
  - *From {client}* — live portal replies (Request / Instruction / Approved kinds) read from the
    shared store; requests carry a **"Promote to signal"** button (toast → becomes an Insights
    Engine backing move). Empty state: "Nothing waiting from Acme right now."
  - *Technicals & optimization* — severity-tagged technical items (dead links, missing alt text,
    FAQ schema) each with a **Fix** button; a "stays here" monospace badge and a yellow footnote
    restating the graduation rule. (Note: every Fix button navigates to the Content Pipeline,
    including link fixes.)
  - *Keyword position* — mini rank board (term, #position, 7-day move) linking to Keywords.
  - *Content in flight* — a Brief → Drafting → Your review → Ready dot-meter linking to Pipeline,
    plus a "1 draft ready for your review" card (or "No drafts waiting.").

States shown: per-client data variants (on-track vs at-risk verdicts), empty from-client rail,
null review card. No loading/error states. All data hardcoded per client.

### 4.2 Keywords (`mockup/keywords.js`) — the flagship 2→1 consolidation

- **Header**: "Keywords — One surface for every keyword — rankings, opportunities, pages, and
  lifecycle. The data layer beneath *Insights Engine*. Replaces *Keyword Hub · Page Intelligence*."
  Top-bar actions: Export, **+ Track keyword**.
- **Four summary stats**: tracked count, average position (+delta), Winning (top 5), and
  High-opportunity ("worth ~9.6k visits").
- **Five lens tabs** with counts (sticky): **Rankings · Opportunities · Pages · Clusters ·
  Lifecycle** — one dataset, five projections:
  - *Rankings*: table — keyword (+intent chip: commercial/informational/transactional/local,
    volume), big rank number, Δ7d pill, 7-point sparkline, ranking page URL (or "no page yet").
  - *Opportunities*: table — opp score, est. traffic gain, opportunity bar, and a suggested fix
    class (needs page / on-page fix / refresh).
  - *Pages / Clusters*: group blocks per URL or cluster with avg rank + opportunity traffic;
    pages with multiple terms get an orange **"N terms compete here"** cannibalization flag.
  - *Lifecycle*: a 5-column kanban — Discovered → Targeted → Published → Ranking → Winning.
- **Toolbar**: live search input; **Intent and Stage filter chips are visual only (no handler)**.
- **Row → detail drawer** (right slide-over): term + intent/stage/volume chips; three metric
  tiles (rank, opp score, difficulty); three sections mirroring the lenses (Rankings / Opportunity
  incl. "Recommended move" / Pages incl. cannibalization + cluster); CTA pair — **"Stage into
  Insights Engine"** (for discovered/targeted) or "Open in editor", plus "SERP". Local-intent terms
  get a cross-link: "Local ranking & GBP health live in Local Presence."
- **Client keyword feedback panel** (below the table): client-requested terms with **"Add to
  Strategy"**, client-declined terms *with their stated reasons* ("Off-brand — we position as
  premium, not discount."), and an approved count. Empty state provided.

### 4.3 Insights Engine (`mockup/strategy.js`) — the strategy spine (was "The Issue")

The per-client strategy narrative surface. Top-bar actions: Strategy inputs, History, **Send
update to {client-first-name}**. Layout top-to-bottom:

- **Staleness nudges** (dismissible, per client): "generated without keyword volume validation"
  (CTA → Strategy inputs) or "your local SEO data is newer than this strategy" (CTA → Regenerate,
  which runs a fake 1.5s regeneration).
- **"What changed" collapsible diff panel**: N updates since {date}; summary cells
  Added / Retained / Reassigned / Retired / Preserved; "Why these matter" cards each with a reason
  sentence and a CTA (Create brief → Pipeline, Refresh page → Editor, Watch); chip groups for
  new/removed keywords, new/resolved content gaps; keyword→page reassignment rows.
- **Verdict hero**: an editorial H1 ("Acme is invisible for the 'small-space furniture' demand
  it's built to win.") + supporting paragraph. Tagged "replaces the old Strategy landing".
- **Money frame**: hero tile "Pipeline value at stake **$14,200/mo**" with an **"Agency estimate"**
  basis chip and the arithmetic spelled out ("≈ 9,600 missed visits × 2.1% × $705 avg order");
  three stat tiles (Recovered so far, Backing moves live 3/4, Avg position).
- **POV block**: the plain-language client narrative, quoted, with mint highlights; footer
  "Draft auto-generated from your 3 staged moves · edited by you before send" + **Edit POV**.
- **Effort stance bar**: one horizontal band — Win demand 46% / Protect 26% / Technical 18% /
  Local 10%.
- **Signals the engine is watching**: momentum / content-gap / misalignment rows, each keyword +
  a one-sentence read; "Computed 2 hours ago · Recompute now".
- **Lost visibility**: queries that dropped out of search with "was #N" and impressions at risk;
  a **"Create recovery content"** CTA that toasts them into the pipeline.
- **Backing moves**: recommendation rows grouped by *archetype* ("Win high-intent demand",
  "Protect what we're winning", "Fix technical drag"), each with a dollar value and a
  **Stage / Staged** toggle; anomaly moves carry a **"Run deep diagnostic"** button (→ the
  Diagnostics drill-in). A portal request promoted from the cockpit appears here under
  "From a client request".
- **"What each staged move becomes"**: lens tabs projecting staged moves into *Keyword targets*
  (deep-link → Keywords) and *Content work orders* (status chips Queued / In progress / Awaiting
  client; deep-link → Pipeline).
- **Client trust-spine preview**: an embedded light microsite frame showing what the client sees —
  verdict, "$4,900/mo pipeline recovered (of $14.2k targeted)" hero, page-one terms, guides
  published.

### 4.4 Recommendations (`mockup/recs.js`) — the triage desk + client preview

- **Header** copy: "Every recommendation lands in one queue. You decide what stays on your desk
  and what goes to the client — as a plain-language proposal they can approve in one tap."
  Top-bar action: "Auto-share rules".
- **Flow ribbon**: Generated (audits · anomalies · opportunities) → You triage (keep, share,
  dismiss) → **Stage into Insights Engine** (becomes a client-tracked move) → Client approves
  (work order → pipeline).
- **Left panel — "Your desk"**: flat card list. Each card: category badge (Opportunity / Anomaly /
  Site audit / Content), status ("Needs triage" / "Handling internally" / "Sent to client" /
  "Client approved" / Dismissed), operator-language title + why ("4.4k/mo informational term, opp
  score 85, no page currently targets it"), impact + effort chips, and a three-action footer:
  **Share with client** (primary) / **I'll handle it** / dismiss. Sent cards show "Waiting on Acme
  to approve · recall"; approved show "queued into Content Pipeline"; internal shows "client won't
  see this"; dismissed shows undo.
- **Right panel — "What Acme sees"** (sticky): a faux-browser client portal preview. Every shared
  rec is re-authored in client language (title "A new guide could bring in ~2,200 visitors a
  month", benefit paragraph, an impact chip, **"Approve & go" / "Discuss"** buttons; approved state
  "You approved this — the team is on it."). Empty state: "Nothing waiting on you right now."
- The dual-language pattern (operator jargon left, client plain-speech right, same underlying rec)
  is the core idea of the surface. Data is 4 hardcoded recs; no filters, search, history, or
  pagination.

### 4.5 Content Pipeline (`mockup/pipeline.js` + `brief-workspace.js` + `draft-workspace.js`)

The largest module (~1,200 lines + two full-page workspaces). Header: capacity meter + 4 modes.

- **Capacity meter / content subscription**: a ring showing "3/4 posts this month · Growth plan";
  click → a **subscription drawer** (mirrors `ContentSubscriptions.tsx`): active plan (price,
  posts/mo, topic source, progress, renewal), Pause/Resume, "Mark post delivered", Cancel (with
  history), and plan cards — Starter $600 (2/mo), Growth $1,200 (4/mo), Scale $2,400 (8/mo) — plus
  a topic-source select (strategy gaps / AI recommended / manual). A "No content plan" empty state
  offers "Set up plan".
- **Modes** (with counts): **Board · Calendar · Published · Content Health**.
  - **Board**: an **Intake strip** (collapsed by default) — items waiting to start, sourced from
    client requests, decay refreshes, and AI suggestions, each with **Start** / **Send to client**
    (topic approval) / dismiss. Below, a 4-column kanban of the *work* stages only — Queued /
    Brief / Draft / In review (Scheduled lives in Calendar; Published in Published). Cards show a
    source badge (Strategy / Client / AI / Refresh / Matrix), title, primary keyword + page type,
    stage detail (brief ready vs "awaiting client"; draft % with progress bar; "AI review 4/6 ·
    2 need you"), and a single stage-advance CTA: *Generate brief → Write draft → Run AI review →
    Approve → Publish now*.
  - **Calendar**: July month grid with ○ scheduled / ● published events.
  - **Published**: a results read-back, not a to-do — roll-up stats (pieces live, clicks
    recovered/mo, avg position gain, "wins to graduate") and per-piece cards: verdict badge
    (Win / Early / Flat), clicks-since-publish sparkline, position #from→#to, impressions,
    engagement, and **"Add to Insights"** graduation on wins. Empty state written to the same
    philosophy ("reads as results, not a to-do").
  - **Content Health**: decay list — published pages losing traffic (−38%, was→now clicks/mo,
    a stated reason) with **"Queue refresh"**, which inserts a board card whose brief "why" is the
    traffic loss. Framed as "the maintenance loop."
- **Detail drawer** (for scheduled/published; queued/brief and draft/review open the full-page
  Brief/Draft workspaces instead): stage strip; target keywords (primary + supporting) with an
  **Edit → keyword picker** overlay explicitly "Live from the Keywords surface · filtered to open
  opportunities"; brief outline + suggested title/meta with char counts; an E-E-A-T & checklist
  block; for review pieces an **AI review — 6 gates** panel (factual accuracy, brand voice,
  internal links, no hallucinations, meta, word count) where **factual-accuracy and hallucination
  gates never auto-pass** — they always route to a human ("Provenance-safe" note); stage-aware
  footers (Send brief to client / Nudge / Approve & write / graduate).
- **Matrix/templates mode exists in code but is unreachable**: `render()` has a templates-strip +
  matrix branch (template × variables grid, e.g. 3 room types × 3 audiences = 9 pages, "Generate
  briefs for planned", "Send sample for approval") and cards can carry a `matrix` source badge —
  but the mode switcher has no Matrix button, so no click path reaches it.
- Cross-entry: Keywords drawer and the strategy view can push items into the pipeline
  (`window.sendToPipeline`), and portal "Yes — write this" greenlights land here too.

### 4.6 Client portal (`mockup/portal.js`) — the light client microsite (admin-embedded preview)

Rendered inside the dark app as a framed preview ("Client view — what Dana sees") with an **Open
full screen** mode that hides the admin chrome entirely. Light theme by design. Layout:

- **Branded header**: client logo block + name + domain; "powered by hmpsn studio" mark.
- **HOOK — "Since your last visit"**: eyebrow with last-visit timestamp; a verdict H1 that flips
  on trajectory ("You're climbing — traffic's up 34% this quarter." vs "We're defending your
  rankings — here's the plan."); a lede naming specific changes; "since" chips (now #4 for X,
  +28% visits, 3 improvements shipped).
- **VALUE band**: hero tile "Revenue recovered **$4,900/mo** · of $14.2k/mo targeted" with an
  **"agency estimate"** badge (label flips to "Revenue protected" for defending clients); new
  page-one rankings; guides published ("1 awaiting your OK").
- **PROOF section** ("01 · The proof — the numbers behind that value"), two columns:
  - Left: *Found in Google* (impressions) and *Visits from search* (clicks) vitals with delta
    chips + sparklines; *Where you're climbing* rank-gain rows ("was #24 · now #12"); *Your search
    traffic* 12-month area chart; *What we did this month* — move rows each with a plain-language
    what/why and a value ("+$1,500/mo · PROJECTED", or non-dollar "recovered"/"-0.4s").
  - Right: *Site health* ring (94/100) + humanized fix list ("Fixed 3 broken links — shoppers were
    hitting dead ends"); *What's next* (in-progress items with status pills); *Opportunities we
    spotted* — content recs with reach ("~2.4k/mo") and a one-tap **"Yes — write this"** that files
    a client-requested brief into the operator's pipeline; a **bonus leads tile** ("18 enquiries
    from search") shown *only when provable* — the unproven variant renders a dash + "lead
    tracking connects once your form is wired up"; *Your conversation* — Approve the plan /
    Request a change buttons, message thread (agency + client, approvals rendered green), and a
    compose box. All client actions write into the shared store and surface on the operator side.
- **Footer**: "you're seeing the curated story, not the workbench behind it."
- Notably: the portal is one scrolling page — no tabs, no history, no deep-dive navigation.

### 4.7 Client Dashboard Mockup (`Client Dashboard Mockup.html`) — the *other* client-facing design

A separate standalone mockup (Bayview Dental, "Growth plan", persistent **"Ask your strategist"**
button) with a **five-tab shell: Overview · Performance · Deep Dive · Inbox (badge 6) · Brand**.
**Only Overview is built; the other four tabs are explicit placeholders** ("Building this next —
the Overview sets the pattern") each with a one-paragraph intent statement (Performance = merged
search+analytics with plain-language reads; Deep Dive = keyword plan/rankings/page map; Inbox =
decisions/reviews/conversations with status; Brand = voice/audience/trust signals).

The Overview is a denser, more transactional take than `portal.js`:

- **0 · "Your turn" strip**: approval/brief chips + a stale chip ("3 pages — 9d pending") jumping
  to Inbox.
- **1 · Hero band**: "What your SEO is worth — **~$18,400/mo · 4.6× your retainer**", momentum
  line, "59 new-patient actions this month, up from 21", a calls/forms/bookings breakdown, an
  estimate-methodology disclosure, a "Curated by your strategist" byline, and an expandable
  **"Why this is the move we'd make first"** panel with Demand/Gap/Intent evidence bars. Beside it,
  a proof card: 6-month actions bar-sparkline + calls/form fills/bookings split + "Names available
  with call & CRM tracking — ask your strategist to connect it."
- **Export**: "Share this as a one-pager" (PDF) row.
- **2 · Your content plan**: three recommended moves, each with an *est. added value* tag
  (≈ $2,900/mo), a confidence chip (High/Medium), and actions — **Request this** ("your strategist
  scopes and confirms before any work or charge"), **Let's talk**, *See the details*, plus
   relevant / not-relevant feedback buttons that "tune what we recommend next". A sidebar "Also on
  your plan" lists in-flight items linking to Deep Dive.
- **3 · What you're getting back**: an ROI ledger (organic traffic value $14,800/mo, equivalent ad
  spend $21,300/mo, new-patient value captured $3,600/mo, *your monthly investment $4,000/mo*);
  top pages by value; **named recent leads** ("Sarah K. — called from 'emergency dentist' page",
  marked "Only you can see this"); "Keywords you asked for — now climbing" (#18→#6).
- **4 · What's working**: shipped wins with Win/Strong-win badges and value attributions, and a
  90-day scorecard (win rate 68%, strong wins 41%, 37 scored, 9 in measurement, per-category win
  rates).
- **5 · Loop footer**: "Ask your strategist" — greenlit-moves status line, canned questions, and a
  free-text ask box.
- **6 · "Under the hood"** (collapsed): the raw stat bar (visitors, clicks, impressions, avg
  position, site health, conversions), a competitor stack-up ("They have 3× your Google
  reviews"), and a methodology disclaimer ("not a promise of future revenue").

**The kit therefore contains two distinct client-facing designs** — the portal microsite
(`portal.js`, story-first, single page) and this dashboard (tabbed, ROI-ledger-first, with named
leads and self-serve purchasing gestures). The handoff brief's Phase-0 gate explicitly requires an
owner decision between building new vs evolving the existing client dashboard before any
client-facing surface is built.

---

## 5. The remaining views, one paragraph each (`mockup/*.js`)

**Command Center / home** — the unscoped operator home ("Today: 5 optimizations to ship, 3
recommendations to send, and 3 ways to grow revenue."). Replaces the old 9-stat home + four triage
systems with one cross-client work queue organized by the three streams, stream tiles + filters,
a "From your clients" rail, content-in-flight, drafts for review, and "Across your book" cards
linking to Site Health and Action Results. Reached via the logo, not the rail.

**Onboarding / Cold Start (`onboard.js`)** — "a new client's cockpit isn't a broken dashboard —
it's the setup flow": connect GA4 → Search Console → Webflow, each connection "unlocks" more of
the workbench, ending in first audit + strategy. Auto-shown for `health:'new'` clients.

**Inbox / Requests (`requests.js`)** — book-wide operator side of the two-way thread ("What your
clients sent back."). Rows typed request / instruction / approval; requests are promotable to
strategy signals; reads the shared store live. Small (~9KB) relative to its centrality.

**Site Health (book) (`sitehealth.js`)** — cross-client technical roll-up ("Every client's
plumbing, in one place") with a by-client grid and batch-fix framing for systemic issues (e.g.
missing alt text across the book); restates the graduation rule at book scale.

**Action Results / Outcomes (`outcomes.js`)** — the "Prove" lens at book scale: what the work
delivered across all clients, winners vs laggards, recent wins, graduated proof points; emerald
value coloring throughout. Feeds the "Send book recap" top-bar action.

**Search & Traffic (`traffic.js`)** — per-client reporting blending GSC, GA4, and rank tracking:
verdict headline ("Organic is up"), traffic chart, queries/pages tabs, sources/devices, and a
bottom bridge — "N wins here are worth telling" → stage as proof points in the Insights Engine.

**Site Audit (`audit.js`)** — one health score with a verdict sentence, categories worst-first,
critical-issue counts, AI-fixable issue batches ("N AI-fixable issues across titles…"), Core Web
Vitals as a category, suppressions, audit history, per-issue fix paths. Header comment claims it
absorbs Performance + Links (the `3→1` badge), though both remain separate views.

**Performance (`performance.js`)** — two tabs mirroring the existing product: Page Weight
(per-page image weight → deep-links heavy pages to Asset Manager) and Page Speed
(Lighthouse + CWV). The "detect" half of the media loop.

**Links (`links.js`)** — the link workshop, three tabs: Redirects (AI-suggested 301s from 404s,
export CSV for Webflow), Internal Links (opportunities + orphan pages), Dead Links (full checker).
Fix here what Site Audit detects; recovered traffic graduates.

**Asset Manager (`assets.js`)** — the media workshop: browse Webflow assets, compress oversized
images (with claimed savings), AI alt text, smart rename, unused-file cleanup, single or bulk;
"Fixes the source, not the symptom." Writes back to Webflow per its framing.

**Local Presence (`local.js`)** — map-pack + GBP view: geo-grid local rank, profile health &
completeness, reviews summary, competitor share, revenue proxy figures; connection states
(Connected / Reconnect needed). Same graduation rule.

**Local Reviews (`local-reviews.js`)** — a governed review-reply pipeline: AI drafts → agency
edits → *client approves* → publish to Google via a background job that can fail/retry; also
teaches the two data tiers (scraped star aggregate vs connected-GBP review stream).

**Local Market Setup (`local-setup.js`)** — a configuration drawer (posture, configured/suggested
markets with DataForSEO location matching, keyword-refresh budget, canonical-locations shortcut);
explicitly does not publish content.

**SEO Editor (`editor.js`, 128KB — the biggest module)** — rebuilt as a volume QA workbench:
(1) list + multi-select + sticky bulk bar with inline title edit, (2) persistent master–detail
split replacing the old slide-over, (3) a keyboard review queue (A/R/S/P, ←→) to clear approval
stacks. Keeps Static/CMS/Manual write sources, publish gating, read-only manual URLs, SERP
preview, on-page element scoring ("Well optimized / Getting there / Needs work").

**Schema (`schema.js`)** — mirrors the existing 5-step flow (Scan → Review → Edit → Publish →
Validate), one JSON-LD @graph per page, per-page type selection, completeness, bulk publish to
Webflow, send-to-client; the landing spot for Site Audit's "missing schema" issues.

**Page Rewriter (`rewrite.js`)** — two-pane workspace: AI rewrite chat (left) driven by playbook
instructions against a live page, editable document (right) with formatting toolbar, apply
sections, publish. A comparatively thin sketch.

**Brand & AI (`brand.js` + `brand-modal.js` + `brand-flows.js`)** — reframed as "the context every
AI action reads *before it writes*": nine legacy tabs collapse into four groups (Voice &
Messaging · Knowledge · Audience · Business Facts & Trust) plus an Overview cockpit reading
completeness, and a "How this context is used" map (briefs/posts, rewrites, chatbots,
schema/local). One canonical generator modal (Generate → Refine → Edit → Approve → Export) shared
by all deliverables, plus four bespoke flows (Discovery, Brandscript, E-E-A-T, Locations). The
AI-visibility monitor moved out to Search & Site Health.

**AI Visibility (`aivis.js`)** — "when a buyer asks ChatGPT/Perplexity/Gemini/AI Overview for a
recommendation, does the client get named, or a competitor?" Live AI Answer Monitor, per-model
citation tracking, strengths/weaknesses narratives, "AI Search Ready" readiness — gains graduate
only once they show as real referral sessions or branded demand.

**llms.txt generator (`llmstxt.js`)** — inside AI Visibility: generates `llms.txt` +
`llms-full.txt` as a background job with color-coded freshness (<24h green, <72h amber).

**Competitors (`competitors.js`)** — per-client competitive intel mirroring the current page:
alerts panel, share of voice, head-to-head, keyword gaps, backlink profile; orange as the
competitor hue.

**Deep Diagnostics (`diagnostics.js`)** — a non-registry drill-in (no nav item) entered from a
regression card: a 30–60s "gathering" theater, then at-a-glance strip → ranked root causes →
remediation plan → evidence accordion.

**Roadmap / Business / Settings / Workspace Settings** — admin bucket. Roadmap: sprint/backlog
board + shipping-velocity chart. Business: sub-tabs Revenue (Stripe), Usage (AI cost/tokens),
Features (sales catalog), Prospects (sales SEO report). Settings: Google/Webflow connections,
API keys, platform health, storage monitor + prune, booking link, feature flags, MCP keys,
Stripe. Workspace Settings (the rail gear): per-client connections, client-dashboard config,
strategy inputs, automation schedules, contacts, archive.

**Draft & Brief workspaces (`draft-workspace.js`, `brief-workspace.js`)** — full-page surfaces
replacing the drawer for content-heavy stages: brief authoring (queued/brief) and long-form
reading/review (draft/review), reading data through `PipelineView.pieceData()`.

**Support cast** — `store.js` (localStorage-backed client-thread store wiring portal → operator),
`workspace.js` (client list + switcher popover + scope chip), `palette.js` (⌘K), `icons.js`.

---

## 6. What is placeholder (do not read as real)

- **All copy, names, and numbers** are fixtures: three demo clients with hand-authored narratives,
  dollar figures ($14,200/mo at stake, $18,400/mo worth, 4.6× retainer), rank moves, review gates.
  The brief itself forbids shipping any of it.
- **Most mutations are toasts**: send-to-client, graduate, nudge, view-live, recompute, regenerate,
  exports, "Batch fix", "Fix all critical", matrix generation — visual confirmations with no state
  behind them beyond the demo stores.
- **Inert controls**: Keywords' Intent/Stage filter chips; several top-bar actions (History,
  This week, Export variants); calendar prev/next; "Auto-share rules"; "Auto-reply rules".
- **States coverage is partial**: populated + some empty states are designed throughout; loading
  skeletons, error states, and permissioned/locked states are essentially absent from the
  prototype (the brief *mandates* all four per surface but the mockups do not demonstrate them).
- **Client Dashboard Mockup**: 4 of 5 tabs are explicit "building this next" placeholders.
- Pricing shown (content plans $600/$1,200/$2,400; retainer $4,000/mo) is illustrative.

## 7. Which views feel thinner / less resolved

Relative resolution varies a lot:

- **Deeply resolved**: Pipeline (+ its two full-page workspaces), SEO Editor (128KB), Insights
  Engine, Portal, Cockpit, Keywords, Brand hub (with its own audit + coverage-ledger docs).
- **Mid**: Traffic, Audit, Local (+ reviews/setup), AI Visibility, Links, Assets, Home.
- **Thin**: **Recommendations** (a 4-item flat list — no filters, search, volume handling, or
  history, despite being the client-facing money surface), **Requests/Inbox** (smallest core
  view), **Page Rewriter** (a sketch), **Performance**, **Sitehealth (book)**, **Outcomes (book)**,
  **Roadmap/Business** (admin bucket), **llms.txt**. The **Client Dashboard Mockup** is
  one-tab-of-five. The Pipeline **matrix mode is built but unreachable** (no mode button), so its
  bulk-planning story is undemonstrated in actual navigation.

## 8. Observed internal tensions (recorded neutrally, for the panel)

1. **Two client-facing designs coexist** (portal.js story microsite vs the tabbed Client Dashboard
   Mockup) with different information architectures, value framings (recovered-$ story vs
   ROI-vs-retainer ledger), and interaction models (approve/reply vs request-and-buy). The brief
   gates the build on resolving this; the kit does not resolve it.
2. **Consolidation claims vs shipped nav**: Site Audit is badged `3→1` and documented as absorbing
   Performance and Links, yet both remain separate rail destinations with their own views.
3. **The BOOK zone is declared but empty** — the cross-client views the Surface Model leans on
   (Command Center, Site Health, Action Results) have no rail presence; discoverability rests on
   the logo click and ⌘K.
4. **Color-law frictions inside the prototype**: purple tints the whole Optimization nav group and
   several admin view eyebrows while the law reserves purple for admin-AI; the action hue is now
   *mint* where the platform's current canon says *teal*; Site Audit's nav icon is `plus`.
5. **Aggressive dollarization**: nearly every surface leads with revenue estimates ("agency
   estimate" / "projected" chips are consistently present, but the arithmetic — visits × CVR ×
   AOV — is the headline nearly everywhere, including client-facing hero positions).
6. **Some routing shortcuts**: cockpit technical "Fix" buttons all route to the Content Pipeline
   regardless of issue type; stream tiles route send→Recommendations and both opt/money→Insights
   Engine.
7. **Scope of the prototype exceeds the 18-surface map** (book views, admin bucket, drill-ins,
   workspaces) — the functionality-audit mandate applies to more surface area than the map names.
