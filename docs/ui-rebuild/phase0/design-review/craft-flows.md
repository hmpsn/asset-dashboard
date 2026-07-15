# Design Review — Flows, Interactions & State Design Soundness

**Reviewer scope:** core task flows end-to-end in the hi-fi prototype (`hmpsn studio Design System/mockup/*.js`), interaction consistency, state completeness, mutation feedback, and unresolved flows — measured against the kit's own contracts in `Build Conventions.html` and `States & Lifecycle Sweep.html`.

**Verdict in one line:** the *lifecycle architecture* (intake → brief → draft → review → published → graduate, plus the decay re-entry loop) is genuinely strong and worth protecting; the *governance docs* (state matrix, mutation contract) are exactly right — but the prototype itself systematically violates that mutation contract (zero confirm dialogs, almost no undo), leaves the product's single most important flow (send client update) completely undesigned, and ships four new status vocabularies that re-create the exact "pile B" fracture the States & Lifecycle Sweep diagnoses.

---

## 1. Core task flows, end-to-end

### 1.1 Keyword decision → strategy (keywords.js → strategy.js)

**BLOCKER — The flagship cross-surface action is a navigation stub, not a flow.**
The keyword detail drawer's primary CTA for discovered/targeted keywords is "Stage into Insights Engine" (`keywords.js:408`). It calls `window.stageIntoIssue()`, which is defined as `function(){ window.gotoView('issue'); }` (`strategy.js:475`). Nothing is staged: no state is carried, no move is created in `MOVES`, no toast fires, and the user lands on the Issue page with no evidence their action did anything. The keyword-decision flow — the core promise of the Keywords surface — is unresolved in the prototype. Compare `window.sendToPipeline` (`pipeline.js:1177-1185`), which does this correctly (creates a card, switches view, toasts with context): the pattern exists in the kit; this flow just never got it.

**MAJOR — Unstaging a move does not reconcile its downstream projections.**
`_toggleMove` flips `staged` and re-renders (`strategy.js:468`). But the "What each staged move becomes" section explicitly claims "Curated moves project into targets & work orders — one curation, tracked end-to-end" (`strategy.js:435`), and its data (`KTARGETS`, `WORDERS`, `strategy.js:339-349`) is static — unstaging "Publish 'small apartment furniture ideas' guide" leaves its work order sitting at "In progress" with no warning, no cascade, no orphan handling. The projection contract's hardest design question (what happens to in-flight work when curation is withdrawn?) is unanswered.

**MINOR — Stage toggle gives no mutation feedback at all.** No toast, no undo — despite being the exact "stage a keyword" worked example in Build Conventions §02 ("quiet emerald Toast 'Added to strategy' + mint Undo (5s)").

**MAJOR — "Edit POV" is dead, and so is "Send".**
The POV card promises "Draft auto-generated from your 3 staged moves · edited by you before send" (`strategy.js:408`), but the "Edit POV" button has no handler (`strategy.js:403`), and the topbar's "Send update to Acme" — the delivery step of this entire page — has no handler either (`app.js:11`). The strategy surface's output flow (compose POV → review → send to client) does not exist anywhere in the prototype. See §1.5 — this is systemic.

**PRAISE — The staleness / regeneration loop is the best-modeled async mutation in the kit.**
`_regenStrategy` (`strategy.js:473`) models the full loop: in-progress toast → delay → success toast → state change (`STALE` cleared) → re-render, driven by a contextual nudge ("Your local SEO data is newer than this strategy", `strategy.js:299-313`) with a dismiss. The "What changed" diff panel (added/retained/reassigned/retired/preserved + per-keyword "why" with deep-link CTAs, `strategy.js:315-337`) is an excellent temporal-state pattern — protect it.

**MINOR — Two async patterns coexist on the same page.** `_recomputeSignals` (`strategy.js:471`) fires "Recomputing signals…" and never completes — "Computed 2 hours ago" never updates. Right next to `_regenStrategy` which completes properly. Agents copying this page will copy both patterns.

### 1.2 Recommendation curation → client delivery (recs.js)

**PRAISE — The dual-pane "Your desk / What Acme sees" layout is the strongest interaction pattern in the kit.**
Operator action and client consequence are visible simultaneously (`recs.js:224-243`); triaging a rec updates the live client-portal preview including its empty state ("Nothing waiting on you right now", `recs.js:240`). This makes the operator's central anxiety — "what does the client actually see?" — a rendered fact instead of a guess. Protect this pattern and consider extending it to the pipeline's send-to-client actions.

**MAJOR — The flow ribbon disagrees with the surface's actual controls.**
The ribbon narrates: Generated → You triage → **Stage into Insights Engine** ("becomes a client-tracked move") → Client approves (`recs.js:214-222`). But the cards offer only Share / I'll handle it / Dismiss (`recs.js:153-157`). There is no stage action anywhere on the surface, and nothing connects an approved rec to the Insights Engine's `MOVES`. The advertised third step of the curation flow has no control.

**MAJOR — "Share with client" is one-click with no confirm; "recall" implies a reversibility that doesn't exist.**
`_recSend` flips status instantly (`recs.js:248`) — no confirm, no toast. Build Conventions §02 explicitly classes send-to-client as "destructive/irreversible → Modal confirm first… Never optimistic." And `_recUnsend` ("recall", `recs.js:252`) silently resets a sent rec to `new` — with no modeling of what recall means for a client who already saw or acted on it.

**MAJOR — "Approved by Acme · queued into Content Pipeline" is claimed but not wired.**
`_recApprove` (`recs.js:253`) sets status only; `PIECES` in pipeline.js never receives anything. The rec→pipeline handoff — the payoff of the whole curation flow — is a copy claim, not a flow.

**MINOR — Client "Discuss" button is dead** (`recs.js:197`). The client's only non-approve path in the preview has no flow (no thread, no navigation to the portal conversation model that `store.js` actually supports).

**PRAISE — The dismissed state has inline undo** (`recs.js:165`) — the only place in the flow views where the contract's undo requirement is honored.

### 1.3 Content brief → publish (pipeline.js, brief-workspace.js, draft-workspace.js)

**PRAISE — The pipeline lifecycle is the most coherent flow in the prototype.**
Intake (client request / AI idea / decay refresh) → Start → Queued → Generate brief (with generation theater + reduced-motion support, `brief-workspace.js:609-633`) → Write draft (closes brief workspace, advances stage, opens draft workspace — real flow continuity, `brief-workspace.js:652-658`) → AI review with named gates → Approve → Scheduled (Calendar) → Published (Results with 90-day read-back) → graduate to client story. The decay loop (`queueRefresh`, `pipeline.js:1108-1114`) re-enters decayed pages into the same lifecycle with the traffic loss framed as the brief's "why" and a toast deep-link back to the board. This is an operator-grade flow model; protect its shape.

**MAJOR — Review gates don't gate.**
The AI review shows human-required failures ("Factual accuracy… flagged, not auto-passed"; "One stat has no cited source", `pipeline.js:929-938`) and the copy claims "Provenance-safe. Factual accuracy and hallucination checks never auto-pass — they always route to you before a piece can go to the client" (`pipeline.js:953`, repeated `draft-workspace.js:508`). But "Approve & schedule" (`draft-workspace.js:567`), "Approve & write" (`pipeline.js:979`), and `advance()` itself (`pipeline.js:1132-1151`) never check gate state. The status pill even says "4/6 passed · 2 need you" while the enabled primary button advances anyway (`draft-workspace.js:563-567`). The trust-critical claim is enforced by nothing. If intentional as a human override, it needs explicit friction (confirm naming the failing gates); silently it's a contradiction between copy and flow.

**MAJOR — The lifecycle has no backward transitions.**
`advance()` is strictly forward. There is no way to send a review back to draft, unschedule a scheduled piece, or unpublish. The editor, by contrast, has "Request changes → back to draft" (`editor.js:1731`). Two lifecycle surfaces in the same product disagree on whether backward moves exist — and the pipeline (where a failed review most needs one) is the surface that lacks it.

**BLOCKER — Dismissing a client request is silent and unrecoverable.**
`dismissIntake` (`pipeline.js:1165-1168`) removes an intake item — which can be a *client's portal request* ("Dana asked in the portal — new collection, wants a landing piece", `pipeline.js:461`) — with no confirm, no toast, no undo, and no record. An accidental ✕ silently destroys a client-originated ask. This is precisely the "destructive → pessimistic + confirm" and "toast + undo" case the kit's own contract mandates, on the highest-trust-cost object in the intake.

**MAJOR — "Cancel plan" (billing-tier destructive) is one-click.**
`subDelete` (`pipeline.js:1099-1100`) cancels a client's paid content subscription instantly with only a post-hoc toast. No confirm, no undo.

**MAJOR — `graduate()` is a toast with no state.**
"Add to Insights Engine" (`pipeline.js:1154`) toasts "now a client story" but mutates nothing — the piece keeps its button, clicking again re-toasts, and strategy.js's `MOVES`/client spine never receive it. Same unresolved handoff as recs→pipeline: the three surfaces' connective tissue exists as toasts, not as state.

**MINOR — Keyword picker edge cases.** "First pick is the primary term" is an implicit ordering rule (`pipeline.js:1057`) — easy to get wrong with no way to re-order; Apply with an empty selection silently no-ops (`pipeline.js:1079-1085`) instead of disabling or explaining.

**MINOR — `intakeToClient` doesn't change the item's state** (`pipeline.js:1169`) — "Sent to client for topic approval" toasts, but the card stays in intake unchanged with the same buttons, so the operator can't tell it was sent, and can send twice.

**MINOR — Dead bulk controls in matrix mode:** "Generate briefs for planned" and "Send sample for approval" (`pipeline.js:749-750`) have no handlers — the matrix's entire point (cells flow into the board) has no working edge. Calendar prev/next are also dead (`pipeline.js:678`).

### 1.4 Audit → fix (audit.js, editor.js)

**PRAISE — The per-page action set is the right decision grammar.**
Each issue×page offers Accept AI fix / Send to client / Create task / Ignore (`audit.js:417-432`), with pattern-level suppression ("Ignore all /shop/*", `audit.js:446`), a visible suppression strip with Clear all (`audit.js:493-497`), inline-editable AI suggestions (`audit.js:413`), and cross-links into Asset Manager / Schema / Links (`audit.js:452-453`, `489`). The "graduation" note — "Plumbing stays plumbing until it earns a story" (`audit.js:632`) — is the right client-trust framing, consistently applied in the editor too (`editor.js:964`).

**MAJOR — Bulk-accepting AI fixes writes to the live site with no confirm, no undo, and a review step that doesn't exist.**
`bulkAccept` (`audit.js:649-652`) applies every pending AI fix — toast: "written to Webflow — review the batch before publishing" — in one click. There is no confirm before N external writes, no per-item applied/skipped/failed summary (required by the contract's bulk path), no revert for a single applied fix (`acceptFix`, `audit.js:643`), and the "review the batch" surface the toast promises doesn't exist anywhere. The topbar escalates this: "Fix all critical" (`app.js:33`) is a dead primary button implying an even bigger unconfirmed bulk write.

**MAJOR — Editor publish paths are one-click and keyboard-triggerable with no confirm.**
`publish()` (`editor.js:1687`), bulk `publish` of N selected pages (`editor.js:1694`), and the review queue's `P` key (`editor.js:1552`) all go straight to `live`. A slipped keystroke in the queue publishes a page. Pessimistic-confirm is mandated for exactly this class.

**PRAISE — The editor's review queue is a real operator-speed flow.** Keyboard shortcuts (A/S/P/R, ←/→), progress segments, skip, a completion state, and a backward transition (Request changes → draft) (`editor.js:1095-1112`, `1550-1553`, `1727-1735`). Dirty-state tracking with an "Unsaved" flag and live footer status (`editor.js:737`, `1065`) is genuine state design. Sheet mode with per-cell AI assist and keyword-match dots that deep-link to the field (`editor.js:1143-1173`) is excellent.

**MINOR — Dirty state has no navigation guard.** Unsaved edits are flagged but nothing intercepts switching pages/views; `resetTracking` clears all statuses to baseline without confirm (`editor.js:1716-1721`).

### 1.5 The missing flow: sending the client update

**BLOCKER — The product's central ritual has no designed flow anywhere in the prototype.**
"Send update to {first}" is the *primary* topbar action on six views (cockpit, issue, competitors, traffic, local, aivis — `app.js:7,11,15,31,41,51`), plus "Send ready updates" on home (`app.js:5`) and "Send book recap" on outcomes (`app.js:29`). **None has a handler.** There is no composer, no preview of what the client receives, no confirmation, no sent-state, no history (the "History" buttons are dead too). The trust spine section (`strategy.js:444-459`) renders what the client sees, and the POV card says "edited by you before send" — but edit and send are both dead ends. For a solo-founder agency whose differentiation *is* the client update, this is the highest-priority unresolved flow in the entire kit. Every other flow feeds this one; it must be designed before the build fans out, not discovered during it.

Same class of dead primary: "Track keyword" (`app.js:13`), "New piece" (`app.js:19`), "Publish all" / "Re-generate all" (schema, `app.js:45`), "Batch fix" (`app.js:27`), "Compress all oversized" (`app.js:39`), keywords drawer "Open in editor" / "SERP" (`keywords.js:409-410`), Intent/Stage filter chips (`keywords.js:342-343`). A prototype that is "the UX spec" (kit CLAUDE.md) cannot leave its primary buttons unspecified — each will be invented independently by whichever agent builds that surface.

---

## 2. Interaction consistency across views

**MAJOR — Same component, divergent keyboard behavior.** Escape closes the brief workspace (blocked during generation — nice, `brief-workspace.js:681`), draft workspace (`draft-workspace.js:693`), editor overlays, and palette — but NOT the keywords drawer, pipeline drawer, subscription drawer, keyword picker, or anything in recs (grep: Escape appears only in brief-workspace, draft-workspace, editor, palette). Five right-side drawers, two keyboard behaviors.

**MINOR — Drawer cleanup on navigation is partial.** `gotoView` force-closes leftover `kdrawer`/`pk-dr` overlays (`app.js:99`) but not `pl-draw`/`pl-dbg`/`subd` — the pipeline drawer and subscription drawer survive a view switch as orphaned overlays. The cleanup list is hand-maintained per drawer; the rebuild needs a single Drawer primitive that self-registers.

**PRAISE — Toast grammar is consistent and good.** `hmToast` (`store.js:70-82`) supports title/sub/action; mutations across pipeline, editor, audit, brief workspace consistently toast with context and frequently deep-link ("Refresh queued to board → View", "Sent to client → Portal"). Where mutations have feedback at all, it feels like one product.

**PRAISE — Cold-start coherence.** `gotoView` redirects a new client's cockpit to setup and auto-switches scoped views to a live client (`app.js:84-97`) — nobody lands on a broken empty surface for an unonboarded client. This is thoughtful cross-cutting state handling.

**PRAISE — Real cross-surface wiring exists where it matters most for content:** editor → "Create brief" → `sendToPipeline` creates a card, switches views, closes the source drawer, toasts (`editor.js:998`, `pipeline.js:1177-1185`); `store.js` gives the client thread a real two-way wire (portal action → operator inbox/cockpit). These prove the connective pattern; the failing handoffs (§1.1, §1.2 graduate/approve) just never adopted it.

**MAJOR — Four new status vocabularies, no shared envelope — the prototype re-creates the fracture its own audit diagnosed.**
The States & Lifecycle Sweep's central finding is "~40 status enums, no shared shape, colliding words" with the fix being a canonical `Lifecycle` envelope with explicit transition tables. The prototype then introduces: keywords lifecycle `discovered→targeted→published→ranking→winning` (`keywords.js:152-158`), pipeline `queued→brief→draft→review→scheduled→published` (`pipeline.js:401-408`), editor `draft→sent→approved→live` (`editor.js:674`), recs `new→internal→sent→approved→dismissed` (`recs.js:107`) — plus matrix `planned→brief→review→published` (`pipeline.js:711`). "Published" already means three different things (a keyword stage, a pipeline stage, a page status whose editor label is `live`), and "approved" two. None has a transition table; all transitions live in scattered handlers. If these ship as-is, the rebuild starts with pile B's disease pre-installed. The vocabularies themselves are mostly good — they need one envelope and a collision pass before agents fan out, exactly as the sweep prescribes.

---

## 3. State completeness (loading / empty / error / locked)

**MAJOR — The four-state matrix exists only as prose; the prototype renders one state.**
Build Conventions §01 mandates all four non-happy states per surface, with skeletons, EmptyState, inline-retry error, and purpose-built locked states. Across the eight core flow views:

- **Loading:** zero skeletons or shimmer anywhere (grep: loading/skeleton appears only in brand-modal.js, portal.js, palette.js). No flow view demonstrates what its skeleton looks like.
- **Error:** zero error/retry states (grep: retry/failed only in local-reviews.js). No view demonstrates "preserve stale data + inline retry."
- **Locked:** zero plan-gated states in the flow views.
- **Empty:** partial and inconsistent. Good: pipeline's published/health empties with forward-looking copy (`pipeline.js:767`, `828`), recs' portal empty (`recs.js:240`), intake empty (`pipeline.js:587`), brief workspace pre-generation empty (`brief-workspace.js:413`). Bad: the keywords table with a no-match query renders a bare header with nothing ("nothing matches" vs "nothing yet" undistinguished, `keywords.js:270-273`); lifecycle columns show a bare "empty" string (`keywords.js:304`); strategy has *no* empty state at all — verdict, money frame, and POV are hardcoded, so "what does the Issue page look like before the first strategy run?" is unanswered.

The `Reference Screen - Keywords.html` — "the whole system assembled… the structural target" — also renders only the populated state. Consequence: 18 surfaces × 4 states ≈ 54 unillustrated states will each be invented by an agent from one paragraph of convention prose. The single highest-leverage addition to the kit is a reference rendering of the four states for one surface (Keywords), so agents copy pixels instead of interpreting prose. (The Handoff Brief's field-5 template mitigates this only if each ticket author actually designs the states — a rendered example makes that dramatically cheaper and more consistent.)

---

## 4. Mutation feedback vs. the kit's own contract

Scorecard of `Build Conventions §02` against the prototype's implemented mutations:

| Contract clause | Prototype reality |
|---|---|
| Optimistic + toast for reversible | Mostly followed: advance, sendBrief, queueRefresh, subscription changes, editor save/send all toast with context. Stage toggle (`strategy.js:468`) and `dismissIntake` (`pipeline.js:1165`) have **no feedback at all**. |
| Pessimistic + **confirm Modal** for destructive/irreversible (delete, retire, **send-to-client**) | **Zero confirm dialogs exist in any flow view** (grep for confirm/Modal across keywords, strategy, recs, pipeline, audit, editor, brief/draft workspaces). Cancel plan, bulk publish, bulk Webflow writes, every send-to-client, queue `P`-key publish: all one-click. |
| **Undo on reversible mutations** (~5s toast action) | Delivered exactly once (recs dismissed, `recs.js:165`). `hmToast` supports an action button, so the cost of compliance is trivial — it just wasn't applied. |
| Bulk path returns per-item applied/skipped/failed summary | Bulk toasts give a single count ("12 AI fixes applied", `audit.js:652`; "Published N pages", `editor.js:1703`) with no skipped/failed breakdown; `bulkSel` silently skips manual rows with no mention (`editor.js:1691`). |

This is the most mechanizable gap in the review: the contract is written, the primitives exist, and the prototype — which agents are told is the UX spec — contradicts it on nearly every destructive path. Whichever an agent treats as authoritative, half the product will be wrong.

---

## 5. Summary of findings by severity

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **Blocker** | "Send update to client" — the product's central deliverable — has no designed flow: dead primary buttons on 6+ views, no composer/preview/confirm/history; POV "Edit" also dead | `app.js:5-51`, `strategy.js:403,408` |
| 2 | **Blocker** | Keyword→strategy staging is a navigation stub: "Stage into Insights Engine" stages nothing | `keywords.js:408`, `strategy.js:475` |
| 3 | **Blocker** | Client-originated intake requests can be dismissed silently — no confirm, no undo, no record | `pipeline.js:1165-1168`, `pipeline.js:461` |
| 4 | Major | Zero confirm dialogs across all flow views; every destructive/irreversible mutation (cancel plan, publish, bulk Webflow writes, all send-to-client) is one-click, violating Build Conventions §02 | `pipeline.js:1099`, `editor.js:1687,1694,1552`, `audit.js:649`, `recs.js:248` |
| 5 | Major | Undo promised by contract, delivered once; several mutations have no feedback at all | `recs.js:165` (only), `strategy.js:468` |
| 6 | Major | Review gates don't gate: "never auto-pass" copy vs. Approve buttons that advance past failing human-required gates with no friction | `pipeline.js:953,1132`, `draft-workspace.js:508,567` |
| 7 | Major | Pipeline lifecycle has no backward transitions (editor does — inconsistent) | `pipeline.js:1132-1151` vs `editor.js:1731` |
| 8 | Major | Cross-surface handoffs are toasts, not state: graduate→Insights, rec-approve→Pipeline, recs ribbon advertises a stage step that has no control | `pipeline.js:1154`, `recs.js:161,214-222,253` |
| 9 | Major | Unstage/recall reconciliation undesigned: unstaging a move orphans its work orders; "recall" of a sent rec silently rewinds | `strategy.js:435,468,339-349`, `recs.js:252` |
| 10 | Major | Four new status vocabularies with colliding words and no shared envelope/transition tables — re-creates the States & Lifecycle Sweep's "pile B" fracture | `keywords.js:152`, `pipeline.js:401`, `editor.js:674`, `recs.js:107` |
| 11 | Major | Four-state matrix unrendered: no loading/error/locked state exists in any core flow view; empty states inconsistent; strategy has none; reference screen shows populated only | grep results §3; `keywords.js:270-304` |
| 12 | Major | Escape/drawer behavior inconsistent across the five right-drawers; navigation cleanup covers only 2 of 4 drawer families | `brief-workspace.js:681` vs keywords/pipeline drawers; `app.js:99` |
| 13 | Minor | Bulk toasts lack per-item applied/skipped/failed; "review the batch" surface promised by toast doesn't exist | `audit.js:652`, `editor.js:1691-1705` |
| 14 | Minor | Dead controls throughout core flows: matrix bulk buttons, calendar nav, Intent/Stage filters, drawer Open-in-editor/SERP, client Discuss | `pipeline.js:678,749-750`, `keywords.js:342,409`, `recs.js:197` |
| 15 | Minor | Keyword picker: implicit first-is-primary rule, silent no-op Apply; `intakeToClient` leaves no sent-state | `pipeline.js:1057,1079,1169` |
| 16 | Minor | Editor dirty state has no navigation guard; `resetTracking` unconfirmed | `editor.js:1716` |
| 17 | **Praise** | Pipeline lifecycle + decay re-entry loop is a coherent, operator-grade flow model | `pipeline.js:1108-1114`, brief/draft workspace continuity |
| 18 | **Praise** | Dual-pane "Your desk / What Acme sees" makes client consequence visible during curation — best trust pattern in the kit | `recs.js:224-243` |
| 19 | **Praise** | Editor review queue (keyboard A/S/P/R, backward transition, dirty tracking) and sheet mode are real speed tools | `editor.js:1095-1112,1550,1727` |
| 20 | **Praise** | Regenerate-strategy async loop, "What changed" diff panel, staleness nudges — exemplary temporal state design | `strategy.js:299-337,473` |
| 21 | **Praise** | Build Conventions' state matrix + mutation contract + CI gates are precisely the right governance; the failures above are the prototype not following its own (correct) rules | `Build Conventions.html` §01-03 |
| 22 | **Praise** | Toast grammar with deep-link actions is consistent; cold-start coherence in routing; audit's per-page decision grammar with suppression management | `store.js:70`, `app.js:84-97`, `audit.js:417-497` |

---

## 6. Recommendations (ordered by leverage)

1. **Design the send-update flow before any build fan-out.** Composer (POV edit), client preview (reuse the dual-pane pattern from recs), pessimistic confirm, sent-state + history. Every surface feeds this flow; it is currently a dead button on six screens.
2. **Publish a mutation classification table with the Action Registry**: every action in the prototype classified optimistic / optimistic+undo / pessimistic+confirm, and make it field 6 of the per-surface handoff template. Then fix the prototype's four worst offenders (cancel plan, bulk publish, bulk AI-fix, dismiss intake) so agents copy compliant examples.
3. **Make review gates real transitions**: blocked `review→scheduled` while human-required gates fail, with an explicit named-override confirm. Add backward transitions (`review→draft`, unschedule) to the pipeline state machine, mirroring the editor.
4. **Adopt one `Lifecycle` envelope for the five stage vocabularies now** (keywords, pipeline, editor, recs, matrix), with explicit transition tables and a word-collision pass ("published"/"approved"/"live") — this is the States & Lifecycle Sweep's own prescription applied to the new surfaces before ~40 becomes ~45.
5. **Render the four states for the Keywords reference screen** (skeleton, nothing-yet + nothing-matches empties, error-with-stale-data, locked) so 54 unillustrated states have a pixel-level source of truth.
6. **Resolve the three phantom handoffs as state, not toasts**: stage-into-Issue creates a move; graduate creates/flags a client story; rec approval creates a pipeline card — all following the working `sendToPipeline` pattern.
7. **Specify unstage/recall reconciliation**: withdrawing a curated move must confront its in-flight work orders (block, cascade with confirm, or orphan-with-flag); recalling a sent rec must model client-visibility.
8. **Sweep every dead control**: each button in the prototype either gets a specified flow (even one sentence + target state) or is cut from the spec. A hi-fi prototype that is "the UX spec" cannot contain unspecified primaries.
9. **Unify drawer behavior in the Drawer primitive**: Escape-to-close, focus trap/return, self-registering navigation cleanup — once, in the component, not per-view.
