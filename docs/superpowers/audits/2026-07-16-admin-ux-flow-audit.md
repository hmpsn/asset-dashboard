# Admin UX-Flow & Ease-of-Use Audit

> **ADVISORY ONLY. No code was changed. Every finding is input to an owner decision.**
>
> Date: 2026-07-16 (evening) · Tree audited: `staging @ 66fef654f` (includes the trust-landmine sweep #1564–#1566)
> Owner's questions: does each page's **flow** make sense (actions at the top)? Where is the UX strange, disjointed, or overly complex on dense surfaces (Keywords, Insights Engine, Brand & AI)? How do we make the platform easier and more intuitive?
>
> Method: instrumented real-browser walk of every rebuilt surface at 1440×900 on the **live DB** (Expero — 5.9K keywords, 766-URL audit, 99 active recommendations; plus a live redirect scan run to measure Links populated) capturing fold-depth, action positions, and first-primary-action distance → four focused judges (Engine flow, scroll-canyon containment, cross-surface conventions, journey click-costs) grounded in that dataset + the component code + the 2026-07-16 rebuild audit. Full structured outputs in the companion `.verdicts.json`; raw dataset in §2.

---

## 1. HEADLINE

**Three structural results, all measured rather than felt:**

**1a. The Insights Engine is the platform's one true action-inversion — and its own parity contract says this moment requires a revisit.** The page is 3.4 folds deep with **1 of 19 in-page actions above the fold**; the first primary verb ("Stage for issue") sits at y≈1750 and the operator tools at y≈2940 — the literal bottom, exactly as the owner described. Decisively: `engine-contract.md:135` records the owner-approved circle-back trigger *"revisit if the single spine makes a required review/action materially harder to find"* — this dataset is that trigger firing. And the cheapest fix is half-built already: `ENGINE_LENSES` defines six labeled anchors with a working `?lens=` scroll+focus receiver, but **no UI ever renders the senders** — the jump-nav exists as dead vocabulary.

**1b. Four scroll canyons, two in-house cures.** Site Audit (47.2 folds / 42,486px), Schema (38.2 folds, 541 buttons), Search & Traffic (35.7 folds — the 500-row GSC table), and Media (27.4 folds, **1,583 buttons in the DOM**) all render unbounded collections into page flow. Meanwhile SEO Editor (1.1 folds for 536 targets) and Page Intelligence (1.0 fold containing 791 actions) already ship the correct **bounded-workbench idiom**: pinned verdict+toolbar, one contained scrolling collection, nothing below it. Links, re-measured after a live 613-redirect scan, also contains correctly. The fix is applying an existing house pattern, not inventing one.

**1c. The platform's best conventions already exist internally — what's missing is enforcement.** Every ease-of-use failure found has a working counter-example on a sibling surface (containment, window-labeled aggregates, teach-with-CTA empty states, top-loaded toolbars). The durable fix is a small set of **measurable usability budgets** with named enforcement homes (§5), so "easy to use" stops depending on which surface an agent happened to build.

## 2. The instrumentation dataset

| Surface | Folds deep | In-page actions | Above fold | First primary action |
|---|---:|---:|---:|---|
| Cockpit | 1.3 | 18 | 16 | verdict-first; healthy |
| **Insights Engine** | **3.4** | 19 | **1** | **"Stage for issue" @1750** |
| Keywords | 3.9 | 22 | 19 | "Add" @87 — top-loaded; depth is table content |
| Brand & AI | 2.3 | 20 | 9 | readiness cards @267 double as nav; healthy |
| **Search & Traffic** | **35.7** | 57 | 13 | canyon: uncapped 500-row GSC detail table |
| Content Pipeline | 1.0 | 8 | 8 | healthy (light data — see §8) |
| **Site Audit** | **47.2** | 24 | 18 | toolbar healthy; unbounded issue list below |
| SEO Editor | 1.1 | 12 | 12 | **the good pattern** (bounded worksheet) |
| Competitors | 1.0 | 3 | 3 | setup state (see §8) |
| Links (populated, live scan) | 1.0 | 6 | 6 | **contains 613 redirects correctly — not a canyon** |
| **Schema** | **38.2** | **541** | 10 | canyon: 766-row page table unbounded |
| **Media** | **27.4** | **1,583** | 43 | canyon: asset grid unbounded |
| Page Intelligence | 1.0 | 791 | 19 | **the good pattern** (master/detail internal scroll) |
| Diagnostics | 5.6 | 22 | 4 | long report page; acceptable for its class |

Plus: ⌘K palette is **navigation-only** (zero action verbs) and lists debug workspaces beside real clients; Outcomes still leads with a data-entry form above its readback tabs; Global Settings opens on a ~30-chip domain wall.

## 3. Insights Engine — the flow fix (owner decision, pre-authorized by the contract)

- **Quick win (small):** render the missing jump-nav senders — a compact anchor row (Changes · Signals · POV · Moves · Operations) in the existing opening Toolbar, sticky, each button calling the already-built `state.setLens(id)`; the scroll+focus receiver at `EngineSurface.tsx:500-513` does the rest. Zero new state; pays down the dead `ENGINE_LENSES` vocabulary; arguably contract-consistent rather than a contract change. Tradeoff: navigation aid only — fold 1 stays verb-free.
- **Option A (recommended, medium):** actions-forward reorder. Keep the protected opening (eyebrow → StrategyDiff → verdict hero → value frame) byte-identical; move the **work block** (CurationMeter + NeedsAttentionStrip + BackingMovesQueue + projections) directly after the value frame (puts "Stage for issue" at ~fold 1–1.5); pair the POV editor with the ClientTrustSpinePreview as one "compose the issue" band (also removes the duplicate-narrative dead zone — the preview currently re-renders the hero's exact verdict/value ~1 fold later); fold StanceBar + Signals + LostQuery into one collapsed "Evidence behind this issue" disclosure (auto-open on `?lens=signals`, the pattern Operations already uses); Operations stays last per the V5 exception. The judge's full option set (incl. a sticky work-rail variant) is in the verdicts file.
- Also: the post-sweep topbar helper "0 staged — stage moves below to send" correctly names the dependency — the reorder gives that signpost a road.

## 4. Scroll canyons — one "bounded workbench" convention, four calibers

Ratify the skeleton the platform already ships twice: **pinned verdict + toolbar (flex-none), exactly one contained collection region (`min-h-0 flex-1 overflow-auto`), nothing rendered beneath the collection.** Optionally extract as a `WorkbenchFrame` layout primitive (sibling of PageContainer/Toolbar).

| Surface | Caliber | Shape |
|---|---|---|
| Site Audit | pure containment | pinned compact hero + category cards (they already act as filters) + utility/bulk band; issues list becomes the contained region |
| Schema | containment + in-region search/filter + row cap | pinned readiness strip + workflow strip + bulk band; 766-row table contained with search (the audit's drawer-per-page scale finding) |
| Search & Traffic | cap + expander (report caliber — keep narrative page scroll) | Detail table capped at ~25 rows + in-table text filter + truthful "Show all N" expander |
| Media | containment + load-more batching + card DOM diet | grid contained under the existing toolbar; 1,583-button DOM is also a perf win |

## 5. Usability budgets (the enforcement layer — proposed for ratification)

Eight measurable budgets, each with a named home (pr-check rule, contract test, or the PR-readiness checklist — full mapping in the verdicts file):

1. **Primary action ≤ 1 fold** on representative data.
2. **Collections are contained** — no unbounded list in page flow (the workbench skeleton).
3. **One idiom per pattern** — Guide, date-range, filters, drawers (Guide currently ships 3 ways).
4. **Every empty state teaches** — names + links its next action (judge count: **54 of 87 empty states are actionless**; six name a destination without linking it; Competitors' teach-with-CTA is the house pattern to copy).
5. **Every aggregate states its window** (the sweep fixed the falsehoods; this budgets the convention).
6. **One name per destination** — sidebar = breadcrumb = ⌘K (move the sidebar's label overrides into the registry; owner picks the winner per contested pair).
7. **Actions say what they do** (ratified by the sweep; keep as a review gate).
8. **Jargon must survive the say-it-aloud test** — e.g. "Backing moves live" → "Moves in progress"; full replacement list in the verdicts, registered via ui-vocabulary + lexicon in the same commit.

## 6. Journeys — the "re-find tax"

Five of six daily journeys are 3–5 clicks on paper but pay a hidden tax at cross-surface hops: Cockpit handoffs drop **item identity** when landing on unbounded pages (open "31 SEO errors" → land at the top of a 47-fold list); Requests opens on a fixed tab with no unanswered-first ordering and **no nav badge anywhere** telling you a client replied; the Engine journey ricochets (top helper → scroll 2 folds → stage → scroll back). Top fixes: carry item identity through every queue hop (the `?lens=`/`?item=` receivers exist — extend the two-halves deep-link contract to Cockpit senders); give Requests a recency-first landing + a pending-replies badge on its nav item (and a labeled nav home — carried from the first audit); move the Outcomes record-work form below/behind its readback. **⌘K:** relabel its navigate-only rows honestly and add the top-10 action verbs (Run Site Audit, Re-scan links, Regenerate strategy, Refresh context, New piece, Record published work, Open drawer-for-selected, etc. — dispatch list in the verdicts).

## 7. Dense-trio diet

- **Keywords:** collapse 5 lenses → 2 (Rankings + Lifecycle); Opportunities is already just a column preset — make it a "Columns: Full | Triage" Segmented; Pages/Clusters become a Group-by control (validated against the code; matches the deferred DEF-kw read-model work rather than fighting it). Surface "Client keyword feedback" above the table or as a badge — it's invisible at y≈3411.
- **Engine:** §3.
- **Brand & AI:** structurally healthy (2.3 folds, cards-as-nav); its remaining issues are the sweep-adjacent wiring items from the first audit, not flow.

## 8. Data-coverage statement (what was measured vs code-judged)

All canyon/inversion findings rest on **real production-shaped data**. Measured live: Cockpit, Engine, Keywords, Search & Traffic, Site Audit, Schema, Media, SEO Editor, Brand & AI, Page Intelligence, Diagnostics, Roadmap, Settings, and Links (after running a real redirect scan — 613 redirects, contained correctly). **Code-judged only** (no live data possible locally): Competitors populated (needs DataForSEO credentials; covered by component fixtures only), Performance populated (bounded by design), Pipeline board/Cockpit queue **under load** (even the seeded demo workspaces are light). Meta-recommendation: extend `seed:demo` with one **loaded demo workspace** (50+ board cards, 10+ queue items, scan artifacts) so future UX audits and flag-ON smokes can measure under load.

## 9. Ranked queue (advisory; includes carried-over items from the 2026-07-16 rebuild audit)

**Small / high leverage:** Engine jump-nav senders · Search & Traffic table cap+expander · empty-state repair sweep (6 dead-end states first) · vocabulary pass · nav-naming closure (owner picks names) · ⌘K honesty relabel · Outcomes form demotion · Cockpit handoffs carry item identity.
**Medium:** Engine Option A reorder (owner circle-back) · Site Audit + Schema + Media containment (+ optional WorkbenchFrame primitive) · usability-budgets ratification + enforcement wiring · Keywords lens diet · Requests inbox spine (badge + recency landing) · ⌘K action verbs · loaded demo workspace.
**Carried from the rebuild audit (§6 items 4+):** AI-visibility flag-ON home · anomaly-stream flag-ON home · `workspaces[0]` chrome consequences · Site Audit per-page repair rows (the journeys judge re-confirmed it inside J2) · book-level Cockpit at `/` · SEO Editor unified bulk send.

---
*Synthesized 2026-07-16 from the instrumented walk + 4 flow judges (~700K tokens). Advisory only — the owner decides. Companion: `2026-07-16-admin-ux-flow-audit.verdicts.json`, incl. the full Engine option set, per-canyon prescriptions, all 8 budget definitions with enforcement homes, journey step-by-steps, and the ⌘K verb dispatch list.*
