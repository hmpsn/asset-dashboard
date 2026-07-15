# Design Review — Content, Copy & Comprehension Soundness

**Reviewer scope:** microcopy system, jargon per audience, number/format presentation, empty/error copy, client-facing trust posture, label consistency.
**Materials read:** `Content & Access Conventions.html`, `Terminology & Lexicon Sweep.html`, `mockup/portal.js`, `mockup/recs.js`, `mockup/cockpit.js`, `mockup/home.js`, `mockup/outcomes.js`, `mockup/requests.js`, `mockup/nav.js`; compared against `docs/workflows/ui-vocabulary.md` and `GLOSSARY.md` at HEAD.
**Posture:** advisory only. Findings ranked most-severe first within each section.

---

## Verdict in one paragraph

The content system is one of the strongest parts of this kit — the microcopy kit is concrete and enforceable, the client-portal voice is genuinely narrative and outcome-oriented (it satisfies the repo's client-framing law better than most of the shipped product does), and the provenance ladder ("agency estimate" / estimate→measured→actual) is exactly the right answer to "clients distrust unsourced numbers." But the mockups — which agents will treat as the copy spec — contradict the kit's own rules in several places: purple leaks into the client portal, the mockups use the exact empty-state phrasing the microcopy kit forbids, client-facing toasts speak raw operator jargon, the number-format contract contradicts its own example, and the primary send action drifts from the repo's canonical "Send to client" label. None of these are hard to fix; all of them will be faithfully replicated across 18 surfaces if not fixed before fan-out.

---

## BLOCKER

### B1. Purple is used in the client portal — violates the Four Laws and the kit's own hard rule

`portal.js` styles the client-facing "What's next" status dots/chips and the entire "Opportunities we spotted" section in purple:

- `portal.js:155` — `.pt-next .nd{...background:${C.purple}}` (client "What's next" bullet)
- `portal.js:158` — `.pt-next .nstat{...color:${C.purple};background:#f5f3ff}` (client status chip: "in progress", "drafting")
- `portal.js:201, 203, 207` — `.pt-recsec` header icon, rec icons, and reach chips all `C.purple`

The repo law (CLAUDE.md Four Laws: "Never use purple in any client-facing component") and the kit's own `Content & Access Conventions.html` §03 ("Purple = admin-AI, and it never reaches a client-facing view... not disabled, invisible") both prohibit this. The portal is explicitly "what the client sees" (the ribbon says so, `portal.js:495`), including a full-screen client view mode. Because this mockup is the copy/visual spec, every agent building the client surface will inherit the violation. Semantically it's also wrong: "Opportunities we spotted" IS AI-derived recommendation content being color-coded as admin-AI *in front of the client*.

**Fix:** teal for the rec CTAs/icons (they're actions), blue or neutral for status chips.

---

## MAJOR

### M1. The mockups use the microcopy kit's own forbidden empty-state phrasing

`Content & Access Conventions.html` §01 explicitly lists `"Nothing here"` under **NOT** for empty states. Yet:

- `requests.js:123` — `<div class="rq-empty">Nothing here yet.</div>`
- `home.js:282` — `Nothing here right now.`

Neither offers the required "way out" (clear filter / what fills this). Contrast with the good ones the kit also contains: `cockpit.js:174` "Nothing waiting from Acme right now.", `recs.js:240` "Nothing waiting on you right now." The spec contradicting itself in its own demo files is worse than an ordinary bug — agents copy demos, not tables.

### M2. Client-facing toasts and CTAs speak raw operator jargon

The portal's client-triggered feedback leaks the internal lexicon across the send boundary:

- `portal.js:626` — client clicks "Approve the plan" → toast: *"Logged as a proof point in Action Results."* ("proof point" and "Action Results" are operator concepts; the client has never seen either.)
- `portal.js:634-636` — client sends a request → toast: *"Now in your Requests inbox — promotable to a strategy signal."* with a go-link to the operator's Pipeline/Requests views. "Promotable", "strategy signal" = pure internal vocabulary, and the deep-link targets admin surfaces a client can't have.
- `portal.js:618` — *"added to your content pipeline as a client-requested brief"* — "brief" and "pipeline" are workbench words.

Even if these toasts are intended as operator-preview simulation feedback, the mockup doesn't distinguish preview-chrome feedback from client-visible feedback, so builders can't tell which register to use. This is precisely the "translation layer that isn't one" failure the Terminology sweep (§03) diagnoses at HEAD — being re-created in the new build.

### M3. The number/format contract contradicts its own example, and the mockups implement three different currency/count behaviors

`Content & Access Conventions.html` §02 says currency is "compact ≥ $10k" but its own example row shows `$8.9k` (below $10k) compacted. Meanwhile the mockups each roll their own formatter, with different thresholds:

- `outcomes.js:88` — `money()` compacts at ≥ $1,000 (`$3.2k`)
- `portal.js` DATA — hand-mixed: `$4,900` (full) next to `$14.2k` and `$8.9k`-style compacts
- `portal.js:333` — `fmt()` compacts *counts* at ≥ 1,000 (`184k`, `3.1k`) while the contract's "Counts" row says thousands-separated integers (`12,847`), with no stated threshold for when a count becomes a "big num"

The whole point of §02 ("ship this as shared formatter helpers, not per-component logic... One home — a shared format.ts") is defeated by the ambiguity. An agent implementing `format.ts` from this doc must guess, and two agents will guess differently.

**Fix:** resolve the ≥$10k rule vs. $8.9k example, state a compaction threshold for counts, and note that the mockups' inline formatters are NOT the spec.

### M4. Primary send action label drifts from repo canon: "Share with client" vs "Send to client"

`recs.js:154` — the primary triage CTA is **"Share with client"**. `docs/workflows/ui-vocabulary.md` is unambiguous: the canonical label is **"Send to client"** ("Do NOT invent synonyms"; enforced history: PR 1.4 retired dual send patterns; pr-check rule `send-for-review-anti-pattern`). The kit's own other surfaces use "Send" as the act verb (`home.js:187+`, `cockpit.js` `act:'Send'`), so the kit is internally inconsistent too. Same family of drift:

- `nav.js:44` — nav label **"Client portal"**; ui-vocabulary lists "portal" under DO-NOT for the client-facing dashboard ("Client Dashboard" is canonical). If the rebuild intends to *re-ratify* "portal" (it appears everywhere in the kit), that's a legitimate choice — but it must be an explicit lexicon decision, not silent drift.
- `recs.js:196` — client CTA "Approve & go" names no object (kit's own rule: "Say the object"); portal uses "Approve the plan"; recs preview subtitle says "Approve to get started". Three approve idioms across two client surfaces.

### M5. The kit prescribes an admin→client translation map and then doesn't include one

`Terminology & Lexicon Sweep.html` §05: *"Make admin→client translation a single explicit map... so the client vocabulary is designed, not emergent."* The Content & Access Conventions doc — the natural home — has a microcopy kit, a format contract, and a permissions matrix, but **no term map** (e.g. proof point → "win", staged move → "improvement", brief → "guide draft", Action Results → never shown). The mockups do perform translations (recs.js authors `whyOp` vs `cliWhy` per card — excellent), but each translation is again a one-off. This is how HEAD got the ROI/Results fork the sweep documents; the rebuild kit repeats the structural omission on day one. Also note HEAD already has locked client-copy infrastructure the kit never references: `shared/types/client-vocabulary.ts` (`CLIENT_ACTION_LABELS`, pinned by contract test) and the `evergreenCopy.ts` locked-copy pattern — the rebuild should inherit these, not re-invent.

### M6. Client-visible footer admits the portal is a curated narrative

`portal.js:594` — the footer *inside* the client card (rendered in full-screen "client view" too): *"you're seeing the curated story, not the workbench behind it."* As operator-preview chrome this sentence is great; as client-visible copy it is a trust landmine — it tells the client their numbers are a "story" that has a hidden backstage. The check-signing founder persona reads: "what are they not showing me?" The preview ribbon (`Client view — what Acme sees`) is correctly *outside* `pt-card`; this footer must move out too, or be replaced with a client-appropriate line ("Prepared for Acme Interiors by hmpsn studio · data from Google Search Console & GA4" — which would also fix the missing data-source attribution, see M7).

### M7. Client numbers have no source attribution anywhere

The portal shows impressions, clicks, positions, sessions, health scores — with deltas and sparklines — but never says where any number comes from (Google Search Console, GA4, rank tracking). The provenance chips cover *money estimates* well ("agency estimate", "projected"), but the measured metrics carry zero verifiability signal. A skeptical client can't distinguish "Google says 3,120 visits" from "the agency says 3,120 visits" — and the agency is grading its own homework either way. One quiet "source: Google Search Console" per proof section (or in the section's `sr` slot, which already exists: "this quarter") would neutralize this. Related smaller instance: `recs.js:130` claims schema "typically lifts click-through by 15–20%" — an unsourced industry statistic presented to the client as fact.

### M8. No error, loading, or locked copy is demonstrated anywhere in the mockups

Build Conventions demands four states per surface and the microcopy kit gives one-line *patterns* ("Couldn't refresh keywords. Retry" / "Keyword strategy is on the Growth plan." + path), but across every mockup view read, zero error states, zero loading states, and zero locked states are rendered. 18 surfaces × 3 undemonstrated states = ~54 pieces of copy agents will invent per-surface. Given that the demos already override the kit's table for *empty* states (M1), pattern tables demonstrably don't survive contact with builders. The reference screen should render all four states with real copy before fan-out.

---

## MINOR

### m1. Client "What's next" status chips use internal pipeline jargon
`portal.js` next-items show `briefed`, `drafting`, `review`, `proposed`, `scheduling`, `in progress` (lowercase mono chips). "Briefed" and "proposed" are agency-workflow words; "review" is ambiguous (whose review? — for north it means the *client's* review). Client statuses should be client-verbed: "we're writing it", "ready for you", "suggested".

### m2. Unlabeled number chip on client recs
`portal.js:458` — the rec title carries a bare `~2.4k/mo` chip. Per month of *what*? (Searches.) The microcopy kit says numbers carry the message, but an unlabeled unit forces the client to guess. `recs.js` handles the same number better ("could bring in ~2,200 visitors a month") — though there the derivation (4.4k/mo term → ~2,200 visits) is invisible and untagged as an estimate, unlike the portal's `basis` chip discipline.

### m3. Cockpit verdict arithmetic doesn't reconcile with its own tiles
`cockpit.js:64` — "Acme Interiors is on track — **3 things** need you today" directly above stream tiles reading 3 + 2 + 1 = **6**. An operator-facing surface, but the kit's whole trust stance is "numbers carry the message"; a headline count that disagrees with the visible queue teaches users to distrust verdict sentences. (`home.js` gets this right — "5 optimizations, 3 recommendations, 3 ways" exactly matches WORK.)

### m4. Hardcoded studio/team names in client copy
`portal.js:501` "powered by hmpsn studio", `portal.js:617/626/634` "Sent to hmpsn studio", `recs.js:238` "Suggestions from your SEO team". HEAD law: `STUDIO_NAME` constant, and "your SEO team" is on the explicit DO-NOT-hardcode list. Fine in a static mockup; must be flagged in the build conventions so it doesn't ship literal.

### m5. "Insights Engine" label vs `issue` view id
`nav.js:20` — label "Insights Engine", id `issue` (the HEAD name "The Issue" living on in the identifier). The Terminology sweep flags "The Issue" as an overloaded name (TX2); carrying the old id under the new label into the rebuild bakes in a permanent label↔identifier mismatch. Also: GLOSSARY's proposed-section intake covers thread kinds and cockpit rails but **not** "Insights Engine", "graduate", "proof point", "staged move", or "the book" — the five most load-bearing new terms (50 occurrences of "Insights Engine" across 24 mockup files). The intake should be completed before these words appear on 18 surfaces.

### m6. Kit CLAUDE.md restates the Four Laws with "mint = actions" where repo law says teal
Lexicon-level drift in the *rules themselves* — a builder cross-reading repo CLAUDE.md and kit CLAUDE.md meets two names for the action hue. One sentence of reconciliation ("mint is the rebuild token name for the teal action hue") prevents a fork.

---

## PRAISE — what is genuinely good and must be protected

### P1. The microcopy kit itself (Content & Access §01)
Verb+object buttons, "say the object", plain recoverable errors with a way out, em-dash-never-zero for nulls, "numbers carry the message", the concrete PATTERN/NOT table. This is a real, enforceable voice spec — better than most production products have. The failures above are compliance failures, not spec failures.

### P2. The client-portal voice is the best client copy in the project's history
`portal.js` reads exactly like the repo's client-framing law demands: "Found in Google" / "Visits from search" instead of impressions/clicks; rankings as `was #10 · now #4` with "3 spots"; fixes explained by consequence ("shoppers were hitting dead ends", "your pages load faster now"); the declining-client narrative ("We're defending your rankings — here's the plan") that leads with agency accountability instead of hiding the drop. The degraded leads tile is exemplary honest copy: `—` + "lead tracking connects once your form is wired up" — no fake zero, no blame, a path.

### P3. The provenance ladder is the right answer to unsourced-number distrust
"agency estimate" basis chip on the hero value (`portal.js:401`), `projected` micro-tags on move values, and the operator-side `estimate → measured → actual` chips (`home.js:46-51`) — this is a designed system for money-claim honesty, and it puts hedges *on the number itself* rather than in fine print. Extend it (M7) rather than dilute it.

### P4. Dual-register card authoring in recs.js
Every recommendation is authored twice — `whyOp` (dense, technical: "4.4k/mo informational term, opp score 85") and `cliWhy` (narrative, outcome: "People searching how to furnish small apartments aren't finding you yet") — with a live "What Acme sees" preview pane. This structurally forces the admin/client translation at the moment of writing and lets the operator see exactly what crosses the boundary. It's the mechanism M5's translation map should formalize.

### P5. Consistent "graduation" copy discipline
"Plumbing stays plumbing until it earns a story" and its variants appear coherently across `audit.js`, `assets.js`, `links.js`, `local.js`, `editor.js`, `cockpit.js`, `pipeline.js`, `outcomes.js` — one metaphor, one rule, every technical surface. This is what a governed lexicon looks like in practice; register the words (m5) and it's durable.

### P6. Governance instinct already operating
`GLOSSARY.md` at HEAD has a `## proposed` intake section snapshotting mockup vocabulary with resolving tickets — the exact "lexicon as contract" posture the Terminology sweep prescribes. Rare to see; keep it fed.

---

## Recommendations (in order)

1. **Before any client surface is built:** strip purple from `portal.js` client card (B1); move the "curated story" footer out of the client card (M6); rewrite client-triggered toasts in client vocabulary with no admin deep-links (M2).
2. **Fix the format contract before `format.ts` exists:** resolve the ≥$10k/$8.9k contradiction, add a count-compaction threshold, and mark mockup inline formatters as non-normative (M3).
3. **Add the admin→client term map to Content & Access Conventions** (proof point→win, staged move→improvement, brief→draft, Action Results→never shown, etc.), inheriting `shared/types/client-vocabulary.ts` and the locked-copy pattern rather than re-inventing (M5).
4. **Ratify or revert label drift explicitly:** "Share with client"→"Send to client" (or amend ui-vocabulary), decide "portal" vs "Client Dashboard", unify the approve-CTA idiom (M4).
5. **Demo the four states with real copy on the reference screen** — error, loading, locked, and compliant empty states — and fix the two forbidden "Nothing here" strings (M1, M8).
6. **Add source attribution to client proof sections** ("data from Google Search Console") and an estimate tag on the recs preview's derived visitor numbers (M7, m2).
7. **Complete the GLOSSARY proposed-intake** for Insights Engine, graduate, proof point, staged move, backing move, the book (m5); reconcile mint/teal naming in the kit CLAUDE.md (m6).
