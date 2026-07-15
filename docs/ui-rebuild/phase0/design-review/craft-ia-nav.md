# Design Review — Information Architecture & Navigation Soundness

**Reviewer lane:** IA / navigation
**Scope:** Two-zone rail model, zone groupings, consolidations (Keywords 2→1, Site Audit 3→1), findability, depth vs breadth, growth headroom, admin/client separation, workspace switcher, global vs workspace scoping.
**Sources read:** `mockup/nav.js`, `mockup/app.js`, `mockup/workspace.js`, `mockup/palette.js`, `mockup/home.js`, `mockup/audit.js`, `mockup/keywords.js`, host HTML (`Keywords &amp; Flows Mockup.html`), `UI Rebuild Handoff Brief.html`, `Navigation Model Options.html`, `IA Consolidation Map.html`, `Surface Model.html`, and HEAD's `src/lib/navRegistry.tsx`.
**Stance:** Advisory only. No code changed.

---

## Verdict in one paragraph

The IA *thinking* in this kit is unusually good — Navigation Model Options and the Surface Model are the strongest navigation reasoning this platform has ever had written down. The problem is that the prototype does not implement the model those documents ratify, and the Handoff Brief then blesses the prototype as "the spec" without noticing. The ratified Model B two-zone rail ships with an **empty Book zone** (`nav.js` line 14: `const book = [];`), the "full front end" 18-surface map silently drops every book-scope surface, and a second document in the same kit (IA Consolidation Map) describes a *different, more radical* end-state (24→~9 destinations) that the rail also doesn't implement. Any build agent following the standing rule "match the prototype's IA — the nav model is a decision, not a sketch" will faithfully rebuild a rail that contradicts the kit's own ratified decision. These are resolvable at the document level, before a line of code — but they must be resolved, because the shell is built once and everything else hangs off it.

---

## Findings

### B1 · BLOCKER — The ratified two-zone rail is not what the prototype implements: the Book zone is empty

**Evidence.**
- `Navigation Model Options.html` §3A recommends Model B and enumerates the Book zone: "Today · Requests · Site Health ·book · Action Results ·book · Clients. Everything portfolio-wide, together," with the explicit virtue "Both scopes always in view… no mode to lose" and "the partition is visible every session, so the scope split becomes muscle memory."
- `mockup/nav.js` line 13–14: `// ── BOOK zone — across all clients ──` … `const book = [];` — declared, never populated, never rendered. The rail renders only the client zone.
- Where the book destinations actually went: **Command Center (`home`)** is reachable only by clicking the logo (`Keywords &amp; Flows Mockup.html` ~line 325, `ccLogo` click → `gotoView('home')` — an icon with a hover title, no rail label); **Inbox (`requests`)** was demoted to a footer icon button (`nav.js` lines 79–84); **book Site Health (`sitehealth`)** and **book Action Results (`outcomes`)** have *no persistent navigation affordance at all* — they are reachable only via ⌘K palette (`palette.js` NAV list) or cards inside the Command Center view (`home.js` lines 359, 363).
- The prototype's own palette disagrees with its own rail: `palette.js` lines ~49–52 catalog `home / sitehealth / outcomes / requests` under a **"Your book"** group — a group the rail never renders. The kit has already reproduced, inside one mockup, the exact three-way nav-metadata drift that HEAD's `navRegistry.tsx` (header comment, lines 1–24) was created to kill.

**Why it matters.** The Handoff Brief's House Rule 5 says "Keep the two-zone rail… The nav model is a decision, not a sketch," and Hard Stop 3 says "Never invent new IA." An agent obeying both will rebuild the rail exactly as `nav.js` renders it — one zone — and the whole documented rationale for Model B (scope always visible, roll-ups un-stranded, the seam taught by structure) is lost. Worse, the two roll-up surfaces the Navigation Model doc specifically set out to rescue ("ROLL-UP STRANDED") end up *more* stranded than at HEAD: at HEAD, `outcomes` (Action Results) is a first-class sidebar entry (`navRegistry.tsx` line 121); in the prototype it isn't in any nav at all.

**Resolution needed before fan-out:** either (a) populate the Book zone per the ratified recommendation (Today, Inbox, Site Health·book, Action Results·book), or (b) formally amend Navigation Model Options to the "chrome-edges" model the mockup actually ships (logo=home, footer=inbox+admin) and defend it. Option (a) matches the written rationale; the current state is neither.

### B2 · BLOCKER — The 18-surface map is not "the full front end": every book-scope surface is missing from the rebuild plan

**Evidence.** `UI Rebuild Handoff Brief.html` Part 2: "What 'everything' is — 18 surfaces, one refactor. The full front end, grouped exactly as the prototype's rail groups it." The listed 18 are all client-zone surfaces (Cockpit → Client portal). But the prototype itself ships **28 views** (`app.js` VIEWS, lines 3–60), and the following have no entry in the surface map and therefore no per-surface template, no data-source ledger ticket, and no definition-of-done in the fan-out plan:

| Missing view | app.js | Scope |
|---|---|---|
| Command Center (`home`) | line 4 | book |
| Inbox (`requests`) | line 24 | book |
| Site Health (`sitehealth`) | line 26 | book |
| Action Results (`outcomes`) | line 28 | book |
| Roadmap (`roadmap`) | line 52 | global |
| Business (`business`) | line 54 | global |
| Settings (`settings`) | line 56 | global |
| Workspace settings (`wsettings`) | line 58 | client |
| Onboarding / cold start (`onboard`) | line 8 | client |
| Deep diagnostic (`diagnostics`) | line 16 | client interior |

Because the map is defined as "grouped exactly as the prototype's rail groups it," B1's empty book zone propagated straight into the plan. The brief's cross-cutting section mentions the shell once, but a shell note is not a surface ticket — the Command Center and Inbox are two of the highest-frequency surfaces a solo operator will touch (the Surface Model itself calls Today "the only place cross-client work lives").

**Also unhomed:** HEAD global-admin surfaces `prospect`, `ai-usage`, `features`, `revenue`, `outcomes-overview` (Team Outcomes) — `navRegistry.tsx` lines 165–184. The IA Consolidation Map's Coverage Ledger marks them "UNTOUCHED · stays as-is," but the prototype's admin popover contains only Roadmap / Business / Settings (`nav.js` lines 74–78) and no view exists for them in the mockup. "Untouched" + "no home in the new shell" is exactly the "capability with no clear home" case the brief's own Stop & Ask rule says must be surfaced, not left implicit. (Business may be intended to absorb Revenue; nothing says so.)

### M1 · MAJOR — The kit contains two competing IA end-states, and the brief doesn't reconcile them

**Evidence.** `IA Consolidation Map.html` prescribes 24→~9 destinations: Recommendations, anomaly/competitor alerts, audit findings, dead links, image issues **fold into a single Signals stream**; SEO Editor / Schema / Page Rewriter become **actions invoked from a work order, "not cold destinations"**; Action Results and Content Perf become **Proof lenses** inside The Issue; Brand & AI "**lives with Settings**, drawn on everywhere." The prototype's rail (`nav.js` lines 17–46) does nearly none of this: Recommendations is a rail destination with a badge (line 43), SEO Editor / Schema / Page Rewriter are cold rail destinations (lines 37–39), Brand & AI sits in Optimization (line 40), and no Signals stream exists in the nav. The Handoff Brief then declares "the prototype is the spec" while shipping the Consolidation Map alongside it as kit reading.

**Why it matters.** A build agent (or a future owner session) reading the kit cannot tell whether the product's spine is "The Issue + ~9 destinations + lenses" or "an 18-item rail." These produce different shells, different routing, different component inventories. The brief's own instruction — "when they disagree, name the drift — don't silently pick one" — is the right rule; this review is naming it: **the drift is the entire consolidation thesis.** Either the Consolidation Map is the north star and the rail is a transitional state (say so, and mark which fold-ins are deferred), or the rail is the decision and the Map is aspirational (demote it out of the kit's reading list). Note the destination-count reality check below (M2): without the Map's fold-ins, the "consolidation" is nearly a no-op numerically.

### M2 · MAJOR — "Site Audit 3→1" is misleading: the absorbed surfaces remain as sibling rail destinations, and the rail is not actually shorter than HEAD

**Evidence.** `mockup/audit.js` header comment: Site Audit "Absorbs Performance (Core Web Vitals is a category) and Links (broken/internal-link issues are categories)." Yet `nav.js` lines 31–33 keep **Performance** and **Links** as separate destinations in the same "Search & Site Health" group, two rows below the "Site Audit `3→1`" badge, and `app.js` gives both full views with their own primary actions ("Re-scan," "Export redirects"). The Coverage Ledger confirms both are "kept standalone."

**Two problems.**
1. **Operator confusion + drift risk.** Core Web Vitals now renders in two places (audit CWV strip, `audit.js` `.au-cwv`; and the Performance workbench); link issues in two places. The triage-vs-workbench split *can* be sound (the audit.js comment argues it well), but the rail presents them as undifferentiated peers, and a `3→1` badge next to two still-alive siblings reads as false advertising. Nothing in the nav expresses "this one is the triage; those are the deep tools."
2. **The consolidation story oversells.** Count the client zone: 18 destinations (`nav.js`). Count HEAD's workspace-scoped registry entries: 19 (`navRegistry.tsx`). The rebuild removes Strategy, Page Intelligence, Content Perf, and Requests from the rail but adds Cockpit, Insights Engine, Competitors, AI Visibility, and Client portal. Net: −1. The genuine win is *coherence* (grouping, scope model, the spine), not reduction — the kit should claim the former and stop implying the latter, because "fewer places to look" is a promise the operator will test on day one.

### M3 · MAJOR — Inbox demoted to a footer icon, contradicting the ratified model's own placement

**Evidence.** `Navigation Model Options.html` Model B places **Requests** (with its count badge) second in the Book zone, at the top of the rail. `nav.js` lines 79–84 render Inbox as a small footer icon button beside the admin gear. It is the only badge-carrying, time-sensitive, cross-client triage surface in the shell — the client thread that the IA Consolidation Map insists is "a two-way stream, not triaged with signals" — and footers read as low-frequency utility chrome. At HEAD, `requests` is a first-class sidebar entry whose registry comment (navRegistry.tsx lines 157–160) records a hard-won lesson about *not* burying client communication. Restore it to the Book zone body (with B1) or justify the demotion explicitly.

### M4 · MAJOR — Silent workspace switching baked into the prototype's navigation flows

**Evidence.** `app.js` lines 84–97: navigating to a client-scoped view while the active client is in `health:'new'` **silently swaps the active client** to another live client (`window.hmpsnActive=live.id`) and proceeds. Similarly, `gotoView('onboard')` silently switches *to* the setup client. And `workspace.js` lines 87–89: after switching clients, you stay on your current view only if it's in a hard-coded six-item `stay` list (`cockpit, issue, keywords, pipeline, recs, portal`) — switching client while on Site Audit, Traffic, Editor, Schema, Local, Competitors, etc. bounces you to Cockpit.

**Why it matters.** The Handoff Brief marks "Flows & interactions — how a task moves screen to screen" as load-bearing spec. Taken literally, a rebuild ships a shell where clicking a nav item can change *whose data you are looking at* without an explicit act — for an agency operator, that is a wrong-client-data incident waiting to happen (sending Acme's update while believing you're on Northwind). The `stay` list inconsistency is smaller but the same genus: scope changes should be explicit, symmetric, and total (stay on the same surface for **all** scoped views, or always land on Cockpit — pick one). The kit needs a line stating these `gotoView` guards are mockup conveniences, **not** flow spec.

### M5 · MINOR — Keywords 2→1: right merge, but two different primary axes are being collapsed into one table

**Evidence.** Coverage Ledger: "Keywords ← Keyword Hub + Page Intelligence, merged." At HEAD these are different pivots: Keyword Hub is keyword-first ("lifecycle, tracking, national + local rank, handoffs" — navRegistry line 137) and Page Intelligence is **page-first** ("per-page keyword analysis, metrics, and optimization" — line 139). The mockup's unified surface (`keywords.js`) is a keyword-first table with lens tabs and a detail drawer. That serves the Hub's job well; the worked example in the Handoff Brief (Part 4) likewise describes only keyword-centric lenses (candidate/staged/recommended). Nowhere in the merged surface spec is the page-centric entry point ("show me this *page's* keywords and optimization state") explicitly preserved. The Phase-0 functionality audit will catch it if run honestly — but flag it now: a page-first pivot (page rollup lens, or a page drawer aggregating its keywords) must be a named requirement of the merge, or the 2→1 quietly becomes 2→1-minus-a-workflow. Merge itself: sound and overdue.

### M6 · MINOR — "Search & Site Health" is becoming the junk-drawer group; no rule for where the next five features go

**Evidence.** `nav.js` lines 28–35: the group holds Search & Traffic (analytics), Site Audit, Performance, Links (technical), Asset Manager (media), and **AI Visibility** — which is neither search-console data nor site health; it's a monitoring/brand-visibility surface that landed here because it's the newest feature and this is the biggest group. Six items, two-and-a-half concepts. That's the tell for growth headroom: the kit has **no stated rule for when a new capability earns a rail item versus docking into the Insights Engine as a signal source or lens.** The IA Consolidation Map actually *is* that rule ("inline for the 80%, hand off the 20%"; new detectors → the Signals stream, no new nav) — one more reason M1 must be resolved. If the Map's mechanism is adopted, headroom is excellent (next five features are mostly signal sources + lenses); if the rail-item-per-feature pattern continues, the 18-item client zone grows monotonically and the group labels dilute further.

### M7 · MINOR — Insights Engine's rail placement contradicts the Surface Model's send boundary; the spine has two names

**Evidence.** `Surface Model.html` defines the Insights Engine as the **composer** — "the client artifact you assemble and send… a draft/queue/sent lifecycle, not a dashboard," positioned *below* the send boundary and "paired with the Client Portal + Inbox." The rail (`nav.js` lines 18–21) instead places it in the top operator-overview cluster next to Cockpit, while a separate "Client-facing" group (lines 42–45) holds Recommendations + Client portal. If the Engine is the sendable artifact, the operator's mental model would place it beside the portal it sends to; if it's the operator's decision cockpit (as the IA Consolidation Map's "The Issue — THE SPINE" frames it), the top placement is right — but then the Surface Model's "composer, not a dashboard" framing is wrong. Pick one story. Relatedly, the same surface is "The Issue" throughout the Consolidation Map and "Insights Engine" in the rail/crumbs/palette — fine if the UI is consistent (it is), but kit docs should carry one name with the other as an alias, or agents will treat them as two things.

### M8 · MINOR — Dead nav ids and non-interactive breadcrumbs: four views highlight nothing in the shell

**Evidence.** `app.js` assigns `nav:'home'` (line 4), `nav:'sitehealth'` (26), `nav:'outcomes'` (28), `nav:'diagnostics'` (16), but `nav.js` renders no items with those ids — on those views, nothing in the rail or footer shows an active state (the footer only handles `requests` and the admin trio). `diagnostics` should at minimum light `issue` (it's an Insights Engine interior per its own crumb). Breadcrumbs are render-only text (`app.js` setTopbar, lines 69–80 — no click handlers), so the `{client} / Insights Engine / Deep diagnostic` trail can't be walked back up. Both are mockup-grade shortcuts; both must not survive into production. The fix for the first is structural (B1); the second is a one-line requirement: crumb segments are links.

### P1 · PRAISE — Navigation Model Options is exemplary decision hygiene; the Model B + C hybrid switcher is the right call for this business

Three genuinely distinct models, honest tradeoff lists for each (including the recommended one), a recommendation with operator-grounded rationale ("for a solo operator moving between the whole book and one client dozens of times a day, the safest rail is the one that never changes shape"), and the smart salvage of Model C's client list as the switcher popover. The switcher itself (`workspace.js` lines 27–45) is excellent: per-client health + open counts, an aggregate book roll-up (open requests / at risk / in setup) **derived from the client list, not invented** (the comment even says so), and new-client → onboarding routing (line 85) that matches the Surface Model's "cold start = onboarding, not empty" principle. Protect all of this — and then actually implement the Book zone it was designed around (B1).

### P2 · PRAISE — The Surface Model's scope×audience grid, the send boundary, and scope-in-the-URL are the strongest IA ideas in the kit

The grid (book/client × operator/client-facing) cleanly dissolves the Cockpit-vs-Insights-Engine ambiguity; the **graduation path** ("a technical fix only graduates into the Engine when it becomes a proof point — 'fixed 40 dead links → recovered $2.1k/mo' earns a place; '12 images missing alt text' does not") is exactly the right one-way valve between operator noise and client story, and directly serves the check-signing-founder persona. The deep-linking contract (`/your-book`, `/acme`, `/acme/keywords` — "the chip, breadcrumb and URL always agree") is a real upgrade over HEAD's `/ws/:workspaceId/:tab?`, which encodes no book/client scope distinction at all. Carry this into the router design verbatim.

### P3 · PRAISE — Shallow rail + deep surfaces is the right depth/breadth balance; the palette is a real safety net

One level of rail; depth lives inside surfaces as lenses, drawers, and interior views (Deep diagnostic, brief/draft workspaces) with breadcrumb trails — the right shape for an operator who lives here daily. The ⌘K palette (`palette.js`) covers the full surface catalog **plus actions** (Run Audit, Create Brief, Scan for anomalies) with recents and fuzzy match; the collapsible icon rail with hover tooltips (host HTML, lines ~326–345) handles the 18-item-zone height concern Model B's own tradeoff list flagged. One carry-over demand: HEAD's `navRegistry.tsx` exists because nav metadata triplicated across Sidebar/Palette/Breadcrumbs drifted (its header comment documents four concrete drift bugs). The mockup re-scatters nav metadata across `nav.js` / `palette.js` / `app.js` and has **already drifted** (palette advertises a "Your book" group the rail doesn't render). The production rebuild must keep a single nav registry feeding rail, palette, and crumbs — this is a solved problem at HEAD; don't unsolve it.

### P4 · PRAISE — Admin/client separation is structurally sound

The client zone's "Client-facing" cluster, the Client portal as an in-admin preview of exactly what the client sees, the gated client-dashboard decision (Handoff Brief Phase 0: "No client-facing surface is built until this is decided"), the purple=admin-AI-only law carried into the kit's four color laws, and the workspace-settings gear scoped to the active client (`nav.js` lines 112–117) — all correct, all worth protecting. The Surface Model's "no client-facing all-clients view — a client only ever sees their own workspace" line closes the one scary hole a two-scope model could open.

---

## Answers to the assigned questions, compressed

- **Two-zone rail model:** Right model, correctly reasoned — **not implemented**. The prototype ships a one-zone rail with book destinations scattered to chrome edges or missing entirely (B1). Resolve before any shell code.
- **Zone groupings:** Client-zone groups are mostly coherent; "Search & Site Health" is overloaded and already absorbing misfits (M6). The unnamed top cluster (Cockpit + Insights Engine) works; the Client-facing cluster works; the Engine's cluster assignment contradicts the Surface Model (M7).
- **Do merged surfaces overload?** Keywords 2→1: no, provided the page-first axis is preserved as an explicit requirement (M5). Site Audit 3→1: the merged *view* is well-designed (score ring → categories worst-first → one-click fixes), but the "merge" coexists with its unabsorbed donor surfaces, which is confusing and drift-prone (M2).
- **Findability:** Good within the client zone (grouping + palette + collapsed-rail tooltips). Bad for book scope: an operator cannot *see* that Command Center, book Site Health, or book Action Results exist (B1); Inbox is hidden in the footer (M3). Overlapping "what should I act on" surfaces (Cockpit streams / Engine moves / Recommendations / Signals) need their one-line distinctions stated in-product, not only in kit docs.
- **Depth vs breadth:** Right balance (P3). Make breadcrumbs interactive (M8).
- **Growth headroom:** Contingent on M1. With the Consolidation Map's signal/lens mechanism adopted, headroom is excellent; without it, the rail grows one item per feature and the groups dilute (M6).
- **Admin vs client IA:** Sound (P4).
- **Workspace switcher:** Best-in-kit component (P1); fix the silent-switch guards and the partial `stay` list (M4).
- **Global vs workspace-scoped:** The `scoped` flag + crumb prefixes + scope-in-URL contract are right (P2); the missing global/admin surfaces (Prospect, AI Usage, Features, Revenue, Team Outcomes) need declared homes (B2).

## Recommended actions (all documentation-level, pre-build)

1. **Resolve B1 in the kit:** populate the Book zone in the prototype rail per the ratified Model B (Today, Inbox, Site Health·book, Action Results·book), or formally amend Navigation Model Options. Do not let fan-out agents inherit the contradiction.
2. **Extend the surface map to the true full front end** (~28 views): add the book-scope, global/admin, onboarding, and interior surfaces with the same nine-field template (B2), and give the five unhomed HEAD admin surfaces explicit fates.
3. **Reconcile the Consolidation Map with the rail** (M1): mark each fold-in as adopted / deferred / rejected, and state the rail-item-vs-lens rule as a standing convention for future features (M6).
4. **Add a "flows that are NOT spec" note to the Handoff Brief:** silent client-switch guards and the partial `stay` list in the mockup are conveniences; production scope changes must be explicit and symmetric (M4).
5. **Name the triage/workbench relationship in the rail** for Site Audit vs Performance/Links (indent, sub-item, or copy), and drop or re-scope the `3→1` badge (M2).
6. **Carry the nav-registry pattern forward** as a hard requirement: one source of truth feeding rail, palette, and breadcrumbs, with the completeness contract test HEAD already has (P3).
7. **Add "page-first pivot preserved" to the Keywords 2→1 definition of done** (M5).
