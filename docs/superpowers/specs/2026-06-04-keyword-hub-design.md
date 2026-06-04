# Keyword Hub — Design Spec (Wave 4)

**Date:** 2026-06-04
**Status:** Design — pending owner review (then → `writing-plans`)
**Predecessor:** the keyword-surface data-model consolidation (Waves 1–3e, 13 PRs) is merged. This wave is the *visible* payoff: the UX consolidation the data-model work unlocked.

---

## 1. Goal

> **A user can follow any keyword's full journey — from the strategy gap that proposed it → the decision to track it → its live rank → why anything was retired — in one place, without jumping between surfaces.**

This is the owner's **G2 (fix UI/UX)** + **G3 (clarify Keywords↔RankTracker)** goals made concrete. The data-model work (`sourceGapKey` provenance, `strategy_owned` ownership, normalized tables) is the foundation; this wave surfaces it.

### The problem today (verified)
A keyword appears in **three admin surfaces, three shapes**, that don't talk to each other:
- **Strategy** (`KeywordStrategy.tsx`) — keyword as a binary ✓/✗ "tracked" icon. No rank, no link to ranks.
- **Keyword Command Center** (`KeywordCommandCenter.tsx`) — the richest view (lifecycle, source, "Where It Came From"), admin-only — but its "Rank Tracker" button dumps you on the *unfiltered* list.
- **Rank Tracker** (`RankTracker.tsx`) — live rank + a coarse "Strategy/Client" badge, **no back-link** to the keyword's origin.

Concrete failures: every cross-surface jump lands on an unfiltered list (no keyword identity in the URL); `sourceGapKey` renders in **zero** components; there is **no "why was this retired" affordance anywhere** (`replacedBy`/`deprecatedAt` have zero render sites); the client Search tab carries a hardcoded caption explaining "tracked keywords" vs "all queries" confusion; and system-retired vs client-declined look identical.

---

## 2. The Design (approved in brainstorming)

**One keyword-first Hub** — *"the Rank Tracker grows up into the Keyword Hub."* The Command Center and the standalone Rank Tracker fuse into a single admin surface. The list keeps the Rank-Tracker table the owner likes (the canonical `KeywordTable` primitive); the lifecycle states you jump between today become **segments of that one list**; every row opens into the keyword's **full journey**.

### Decisions locked
- **Plan stays upstream.** The *generation* work — content gaps, topic clusters, cannibalization, "generate strategy" — remains the **Strategy** surface. Strategy *proposes* keywords; the Hub owns each keyword's *life*. Strategy deep-links into the Hub per-keyword.
- **Admin-first.** Build the admin Hub (where the three-surface confusion is worst). A client-facing read-only "your keywords" view is a **fast follow** (out of scope here).
- **Remove = Retire (soft) by default; Delete (hard) is separate + confirmed.** Reconciles the KCC's soft `retire` (status→`deprecated`, restorable) with the Rank Tracker's hard `removeTrackedKeyword`. Retire is the primary, auditable "remove"; a distinct, red, confirmed **"Delete permanently"** stays available for genuine mistakes (manual/client keywords).
- **Local keywords are an annotation layer in the Hub** — a segment + filter + market dimension — not a separate keyword manager. (This is the explicit product contract, `docs/rules/local-seo-visibility.md:9,62,64`.)

### 2a. The unified list
Built on the canonical `KeywordTable`/`RankTable` primitive (`src/components/shared/RankTable.tsx`, the Wave-2 consolidation) — which already supports interactive column-sort, multi-select, expand, `showLocalSeo`, density. Neither KCC nor RankTracker uses it yet; unifying onto it IS the consolidation.
- **Segments** (the KCC lifecycle filters as pills): `All · In Strategy · Tracked · Needs Review · Retired` + a **`Local`** segment (with the local sub-states behind it: visible / possible / not-visible / not-checked / provider-degraded). Sourced from `KEYWORD_COMMAND_CENTER_FILTERS`.
- **Search** (debounced, keyword + page) and **interactive column sort** (position / change / clicks / volume / difficulty / date) — the Hub *adds* interactive sort that today's Rank Tracker lacks entirely.
- **Multi-select + bulk action bar** (`KeywordBulkActionBar`): the five bulk-capable actions.
- **Columns:** keyword · source badge · national position · Δ · clicks · **📍 Local** (roll-up, e.g. "3/4 markets") · trend sparkline · row action menu.

### 2b. The keyword journey drawer (the deep-dive)
Expanding a row (or opening the drawer — evolving `KeywordDetailDrawer`) shows the keyword's full story:
1. **Origin** — the provenance we built: "From content gap *X*" (`sourceGapKey`) / "Client requested" / "Manual" + a **"View in Strategy →"** deep-link.
2. **Tracking decision** — tracked-since, `strategyOwned` ("auto-managed by strategy refreshes"), pinned.
3. **National rank** — Search Console position, Δ, clicks/impressions, 90-day sparkline (the Rank-Tracker data).
4. **Local visibility** (when applicable) — **per-market** pack rank/visibility (Austin #2, Round Rock #1, Cedar Park not-visible…), driven by `local_visibility_snapshots` / the `markets[]` array. A genuinely different metric from national position — shown as its own layer.
5. **Lifecycle** — Active, or if retired: **why** + what replaced it (`deprecatedAt` / `replacedBy`) — the affordance that has zero render sites today.
6. **Actions** — the lifecycle-aware action set (below).

### 2c. The action model
Inherits the KCC's lifecycle action set (the contractual owner of keyword lifecycle), surfaced as a per-row menu, the drawer, and the bulk bar:
- `add_to_strategy` (= **"move to strategy"**) · `track` · `promote_evidence` · `pause` · `retire` (soft) · `decline` · `restore` · `Delete permanently` (hard, confirmed, separated).
- **Lifecycle-aware:** a retired row offers only Restore; a needs-review row offers Add-to-strategy; etc.
- **Bulk:** `add_to_strategy, track, pause, retire, decline` on multi-selected keywords.
- All actions broadcast (`RANK_TRACKING_UPDATED` + `STRATEGY_UPDATED`/`INTELLIGENCE_SIGNALS_UPDATED` where relevant), run in a transaction, log activity, and honor the protected-keyword guard (pinned / `CLIENT_REQUESTED` / `MANUAL` / `sourceGapKey`).

**Improvement to fold in (code we're touching):** keyword lifecycle is **not** under `validateTransition` like every other entity (the KCC enforces valid-from states imperatively). Add a keyword transition map to `server/state-machines.ts` so the Hub's actions are declaratively safe — closes a real gap.

---

## 3. Architecture & data flow

- **Build on `KeywordTable`.** The Hub list is `KeywordTable` configured with segments/search/sort/selection/local. This consolidates three divergent renderers (the KCC `KeywordRow` grid, the RankTracker hand-rolled grid, the legacy RankTable wrappers) onto one primitive.
- **Data source.** The Hub reads the existing KCC bundle (`buildKeywordCommandCenterModel` — already carries lifecycle, `sourceGapKey`, local annotations, ranks via the merged shape). **One addition:** expose `strategyOwned` on the emitted tracking row (it's currently server-internal) so the drawer can show "auto-managed." National rank + local visibility are already on the KCC row (`localSeo` summary + the rank snapshot join).
- **Navigation / deep-links.** The Hub becomes the home for keyword work. Cross-links carry keyword identity in the URL (`?q=` / `?tab=segment`) and honor the **`?tab=` two-halves contract** (the receiver reads `useSearchParams` — KCC violates this today). Strategy rows deep-link to the keyword in the Hub; the Hub's "View in Strategy" deep-links back to the originating gap.
- **Surface retirement.** The standalone **Rank Tracker** Page folds into the Hub; the **Keywords** (KCC) nav becomes the **Keyword Hub**. Retiring/renaming a `Page` value touches seven files — follow `docs/rules/route-removal-checklist.md`; keep old routes as redirects during rollout.
- **Broadcasts.** Existing tracking hooks already listen on `RANK_TRACKING_UPDATED` + `STRATEGY_UPDATED`; the Hub reuses them. Any new cross-system write needs both halves (`broadcastToWorkspace` + `useWorkspaceEvents`).

---

## 4. Phasing (flag-gated, phase-per-PR)

This is the biggest visual change in the consolidation, so it ships **dark behind a `<FeatureFlag>`** (add the flag to `shared/types/feature-flags.ts` before the first commit) and incrementally, one phase per PR, never serving a half-built Hub to production:

- **P0 — Shell + flag + table migration.** Add the flag; migrate KCC (and the Rank Tracker view) onto the canonical `KeywordTable` (behavior-preserving) so they share one renderer. Expose `strategyOwned` on the tracking row.
- **P1 — Unified list.** Segments (incl. Local) + search + interactive sort + multi-select on the Hub list, behind the flag.
- **P2 — Journey drawer.** Origin/provenance (`sourceGapKey`), tracking (`strategyOwned`), national rank, per-market local visibility, lifecycle + **why-retired** (`replacedBy`/`deprecatedAt`).
- **P3 — Action model.** Lifecycle actions + bulk in the Hub; the retire-soft / delete-hard reconciliation; add the keyword state-machine (`validateTransition`).
- **P4 — Deep-links + nav.** Strategy↔Hub keyword-targeted deep-links; `?tab=` two-halves wiring; fold the Rank Tracker nav into the Hub (route redirects per the checklist).
- **P5 — Cutover.** Flip the flag; retire the old standalone surfaces.
- **Fast follow (separate effort):** client-facing read-only Hub.

---

## 5. Out of scope
- The **client-facing** Hub (read-only) — fast follow.
- **Geo-grid** local tracking — `docs/rules/local-seo-visibility.md:74` defers it; the Hub uses the existing explicit-markets model.
- Redesigning the **Strategy** generation surface — it stays as-is upstream (only gains keyword-targeted deep-links into the Hub).
- The **plan analytics** (topic clusters, cannibalization) stay on Strategy.

---

## 6. Risks & required care
1. **Surface retirement is high-touch** — retiring/renaming the Rank Tracker + KCC `Page` values hits seven files each; do it last (P4/P5) with redirects, behind the flag.
2. **`retire` (soft) vs `removeTrackedKeyword` (hard) divergence** — the Hub must present one coherent "remove" model; the hard delete stays explicit + confirmed, never default.
3. **`strategyOwned` exposure** — it's stripped from `getTrackedKeywords`/public by design; the Hub reads it via the admin KCC bundle, never the public read path (keep it admin-only).
4. **Local = annotation, not a second manager** — honor the contract; the Hub annotates rows + a Local segment; market *setup* stays its own surface.
5. **`?tab=` two-halves contract** — every new deep-link's receiver must read `useSearchParams` (enforced by `tests/contract/tab-deep-link-wiring.test.ts` + pr-check).

---

## 7. Design-system constraints
- **Four Laws of Color:** teal = actions (track/pin/move); blue = data (position/clicks); emerald = success (rank ▲ / locally visible); amber/red = warnings (retire/decline/▼); **never purple in client-facing** (admin Hub may, but keep it minimal). No `violet`/`indigo`/`rose`/`pink`/`text-green-400`.
- **Primitives:** `KeywordTable`, `StatusBadge` (`keyword-command-center` domain), `Badge`, `SectionCard`, `EmptyState` (action-oriented), `TierGate`, `ConfirmDialog` (the Delete gate), `positionColor()`/`scoreColor()`. Never hand-roll.
- **Testing:** each phase ships with tests; the deep-link two-halves contract test; the action/lifecycle guards; integration tests covering the real read path; `scaled-code-review` since this spans modules + (if parallelized) agents.

---

## 8. Definition of done (per phase)
`npm run typecheck && npx vite build && npx vitest run` green; `npx tsx scripts/pr-check.ts` zero errors; `BRAND_DESIGN_LANGUAGE.md` updated for UI changes; `FEATURE_AUDIT.md` updated; the flag remains OFF in production until P5; adversarial review before each merge; CI green on `staging` before the next phase.
