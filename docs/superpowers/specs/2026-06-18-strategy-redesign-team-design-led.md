# Strategy Redesign (IA + Usability Layer) — Team "design-led" Spec

> **Lead discipline:** UX/UI Designer. Contested calls resolve toward the most usable, least-overwhelming
> operator experience. Where my engineer and PM teammates conflict with that mandate — or with each
> other — I decide and say why.
>
> **What this is:** the redesign-of-the-redesign. Strategy v3 (Phases 0–3, merged to staging behind
> `strategy-command-center`) built a deep recommendation **curation cockpit + lifecycle engine** but
> left the visible information architecture untouched. The operator's verdict was "nothing looks
> different; keyword stuff never moved; What Changed never moved up." This work fixes the **IA +
> usability layer**. The cockpit and lifecycle stay. We reorganize the visible page around them.
>
> **Companion contracts (read before touching lifecycle code):**
> `docs/rules/strategy-recommendations.md` ·
> `docs/superpowers/specs/2026-06-18-strategy-v3-curation-cockpit-design.md` ·
> `docs/superpowers/plans/2026-06-18-strategy-v3-curation-cockpit.md`.

---

## 1. Goal + Non-Goals

### Goal

Reduce the operator's **time-to-first-action** on the Strategy page. Today the page taxes working
memory before it delivers anything actionable: 198 strategy updates are buried at the bottom, the Act
queue renders 144 recs in one unscrollable wall, the actionable cannibalization triage is orphaned
while the passive read-only alert ships, keyword surfaces are stranded in the Overview scroll, and
Settings + ClientFeedback leak onto all four tabs. We fix the **render order, list-capping, action
co-location, and tab placement** so the page reads as a decision pipeline, not a reference library.

Three operator-stated facts drive every contested call:

1. **"Nothing looks different."** The cockpit shipped but the page still reads like a reference dump.
   Visible wins unlock operator trust — so we front-load them (Phase 1–2), not bury them behind months
   of plumbing.
2. **"So important but buried!!"** (What Changed). The single highest-signal surface we have is
   already built (`StrategyDiff.tsx`) and sits at the bottom of Overview. Promote it.
3. **The send-to-client spine is built and only partly connected.** Every phase that doesn't advance
   the operator → client value loop leaves money on the table.

### Non-Goals (explicitly out of scope this redesign)

| Cut | Why |
|---|---|
| **Per-row recommendations table** | The grounding brief marks it explicitly deferred (v3 spec §2). The whole-blob `RecommendationSet` + single-writer is adequate for IA changes. Don't let "while we're in here" pull it in. |
| **Backlinks split → own `links` page** | The `'links'` Page route exists in `src/routes.ts`, but splitting `BacklinkProfile` out of `StrategyCompetitiveTab` triggers the full route-removal checklist (`routes.ts`, `App.tsx`, `navRegistry.tsx`, nav-literal call sites, contract tests). **No operator-expressed need for it.** Keep Backlinks in Competitive; revisit as a standalone PR after the IA stabilizes. *(I am overruling the "open question" — see §4 Competitive for the design rationale: a single Competitive surface is more scannable than two thin tabs.)* |
| **Retroactive enrichment of historical recs** | We build the why/how/result **presenter** (renders existing `description`/`insight`/`estimatedGain`/`impactBand` fields). We do **not** build a new enrichment pipeline to backfill old recs. |
| **Finishing every v3 orphan** (`CurationBulkActionBar`, `DecisionQueue`, `LostQueryRecoveryCard`, `OpportunitiesList`, `RequestedKeywordTriage`) | The `index.ts:28-42` orphan list is tempting. They were deferred for a reason. Our job is IA + visibility, not completing every v3 loose end. The one orphan we DO wire is `CannibalizationTriage` (it directly replaces a passive surface that ships today). |
| **Operator keeper-override persist-across-regen** for cannibalization | Tracked as roadmap item `strategy-cannibalization-operator-keeper-override`. Out of scope. `CannibalizationTriage` already infers resolution from durable `tracked_actions`. |

---

## 2. The four global patterns (build-once-reuse, NOT per-card)

These are infrastructure, not per-surface decisions. Each is built once and applied everywhere. **The
scannable pattern is the single highest-leverage investment in the redesign** — it is only effective
if every leaf author *defaults to capped*. One leaf that renders 80 items uncapped breaks the mental
model of "this page is curated."

### Pattern 1 — Scannable lists (cap ~5 + show-more + progressive disclosure)

**Net-new (shared, P1):** `src/hooks/useShowMore.ts`.

```ts
// returns the capped slice + a labeled trigger so every list-rendering leaf shares one behavior.
export function useShowMore<T>(items: T[], initialCap = 5): {
  visible: T[];        // items.slice(0, cap)
  hasMore: boolean;    // items.length > cap
  hiddenCount: number; // items.length - cap (drives the "Show N more" label)
  showMore: () => void;
  showLess: () => void;
  expanded: boolean;
}
```

Grounding: **no shared scannable primitive exists today.** The cockpit hard-caps at
`FIX_NOW_CAP = 5` (`cockpitRowModel.ts:3`) and a few leaves cap ad-hoc (`TopicClusters.slice(0,10)`,
`IntelligenceSignals.slice(0,10)`), but `ContentGaps.tsx:64` renders **all** `sorted` items and
`SiteTargetKeywords.tsx:27` renders **all** `siteKeywords`. This is the #1 build-once-reuse miss.

**Design rules (my mandate — these are not negotiable):**

- **Cap = 5.** Not arbitrary: 5 is the point at which an operator can hold a list in working memory.
  Beyond 5, items collapse into "more things I haven't looked at."
- **The trigger shows a count:** `"Show 12 more content gaps"` not `"Show more"`. The count converts a
  wall into a manageable queue AND signals the operator has already seen the prioritized top slice —
  the curation is doing its job.
- **Compact-by-default, expand-on-demand** is the secondary disclosure layer (Pattern 2's compact row).

**Leaves that adopt `useShowMore` in P1:** `ContentGaps`, `TopicClusters`, `KeywordOpportunities`,
`SiteTargetKeywords`, `CannibalizationTriage`. The cockpit keeps its existing `FIX_NOW_CAP` curated
top-slice (already scannable) — `useShowMore` does not replace it.

### Pattern 2 — Why → How → Projected Result (every rec / gap / cluster / opportunity)

**Net-new (shared presenter, P3):** `src/components/strategy/shared/WhyHowResult.tsx` — a presentational
component that renders the three blocks consistently across rows. **The data already exists per item;
the rendering does not.**

| Block | Source field (already populated) | Visual treatment |
|---|---|---|
| **Why** (compact, line 2) | `rec.description` (clamped to one line today at `cockpitRowModel.ts:83`); `gap.rationale` / `gap.competitorProof`; `cluster.topCompetitor` / `coveragePercent` | one sentence, **surfaced — not clamped into invisibility** |
| **Why** (expanded) | full `rec.insight` / `gap.rationale` + `gap.competitorProof` | full prose with competitor evidence |
| **How** | the action itself | **a teal Button** (Fix in editor / Generate brief / Track keyword / Send to client) — **the action trigger, NOT a sentence describing it** |
| **Result** | `rec.estimatedGain` (preferred, concrete) → fallback `rec.impactBand`; `gap.volume`; cluster delta | **a blue badge** (data, never a CTA): `"Est. +340 clicks/mo"` |

**My ruling on a teammate disagreement:** the engineer is right that we surface existing fields and do
not build a new enrichment pipeline. But the result block must commit to **`estimatedGain` as a concrete
value wherever it exists, falling back to `impactBand` ONLY when the estimate is absent.** A bare
"Medium impact" with no number is zero trust signal — and the result block IS the operator-trust
element (an operator who sees "competitor evidence + est. +340 clicks" sends with confidence). The
presenter must prefer the number.

### Pattern 3 — Send-to-client = ONE universal mechanism

**Reuse the fully-built spine. Never build send per-card.** This is the line I will hold hardest, and
my engineer and PM teammates both independently demanded the same — so it is settled.

There are exactly **two legal paths**, and the redesign uses only the lighter one for new surfaces:

- **Path A — rec lifecycle (`clientStatus`), DEFAULT for new strategy sends.**
  `sendRecommendation(workspaceId, recId)` (`server/recommendation-lifecycle.ts`, exported + frozen)
  mutates `clientStatus: curated|system → sent`, routes by `REC_POLICY_REGISTRY[type].sendChannel`,
  broadcasts `RECOMMENDATIONS_UPDATED`. Already works for `keyword_gap`, `topic_cluster`,
  `content_decay`, etc. Per-rec route exists: `PATCH /api/recommendations/:ws/:recId/send`; bulk route
  exists (`POST`, one transaction, `routes/recommendations.ts:408+`).

- **Path B — `DeliverableAdapter` (bespoke client card), USE ONLY when a custom client renderer is
  genuinely needed.** Currently the only one is
  `server/domains/inbox/deliverable-adapters/cannibalization.ts` (→ `CannibalizationRenderer` in
  `src/components/client/decision-renderers.tsx`, dispatched by `DeliverableDetailModal.tsx`). It needs
  bespoke rendering because the consolidation card shows keeper + duplicates. **Keyword opportunities,
  decaying pages, and competitor sends do NOT need bespoke cards** → they route through Path A.

**The mechanism for new sends:** the **`StrategyRecommendationPayload`** type already exists and is
**unconsumed** (`shared/types/recommendations.ts:221`). A domain item (a keyword opportunity, a
decaying page without a rec) is turned into a sendable rec via this payload → minted into the rec set →
`sendRecommendation()`. **No new `ClientActionSourceType`. No new `deliverable-adapters/` file. No
6-part lockstep.**

**The bright-line tripwire for PR review:** any diff that adds a string to `ClientActionSourceType`
(`shared/types/client-actions.ts:3`, currently
`aeo_change | internal_link | redirect_proposal | content_decay | cannibalization`) for a strategy
surface is **blocked**. That union does not grow in this redesign.

**Send-to-client UX (my mandate — applies to every send button on the page):**

- **One "Send to client" teal button per actionable item.** No "Send for Review" / "Flag for Client"
  (pr-check `send-for-review-anti-pattern`).
- **Optional note is inline + collapsible, NEVER a modal.** Clicking "Send to client" expands an inline
  note field + confirm. No note needed → one press, done. Note needed → one more click. Modal overhead
  is the wrong tradeoff for this interaction. (Cannibalization's current send fires immediately with no
  note step — we *add* the inline note affordance as the universal pattern; it stays optional.)
- **Post-send state is visible on the row.** Render a muted-teal "Sent to client" badge and collapse the
  send button (the cockpit's `lifecycleTag` at `cockpitRowModel.ts:53` already does this). If the client
  has responded, render it inline: **"Client approved"** (emerald) / **"Client declined"** (red) /
  **"Discussing"** (amber) — read from `clientStatus`. This closes the loop without a trip to the Inbox.

### Pattern 4 — Consolidate Settings + Local SEO into one collapsed "Strategy Config"

**Net-new (light, P4):** a single collapsed accordion `StrategyConfig` at the **bottom of Overview**,
composing the existing `StrategySettings` (provider, page limit, business context, competitors) + Local
SEO **config** inputs (location / market). Both already exist as elements (`settingsEl`, and the config
half of `LocalSeoVisibilityPanel`).

**Two distinct calls inside this pattern (the #1 nuance):**

1. **Local SEO config** (location/market inputs) → folds INTO the collapsed Strategy Config.
2. **Local SEO visibility panel** (the *results*) → is a **placement decision**, not a config fold.
   **My ruling: the visibility panel lives in exactly ONE place — the Keyword Hub.** It is a
   universe-level read (rankings across the whole keyword set), which belongs with the Hub's "one
   surface for every keyword." Today it duplicates: it renders in **both** `KeywordStrategy.tsx:215`
   (`localSeoEl`, `mode="strategy"`) AND `KeywordHub.tsx:539`. We remove it from Strategy (behind the
   flag) and keep it in the Hub. *This overrules keeping it in Strategy — Strategy is decide/act, not a
   universe rankings dashboard.*

This also **removes the always-rendered leak**: today `localSeoEl`, `clientFeedbackCombinedEl`, and
`settingsEl` render OUTSIDE the tab container (`KeywordStrategy.tsx:388,395,396`) on every tab. The leak
comment at `:392` flags this explicitly. Consolidating + moving fixes the most obvious usability problem
on the page today.

---

## 3. Tab IA + render order (all 4 tabs)

Four tabs, each with one job. **The tab `id` literals stay exactly as they are in `KeywordStrategy.tsx`**
(`overview | content | rankings | competitive`) — only the Rankings **display label** changes to
"Keywords & Rankings". This is the `?tab=` two-halves contract (the contract test
`tests/contract/tab-deep-link-wiring.test.ts` scans for the literal ids; the receiver already reads
`searchParams.get('tab')` at `:68-79`). **Renaming the id would break the deep-link contract — we rename
the label only.**

### Tab ① Overview = decide & act

**This is the most contested render order, and I am overruling the grounding brief's draft.** The brief
suggested Orient → cockpit → (What Changed promoted above the divider). My ruling, as the usability lead:

**Render order (top → bottom):**

1. `feedbackNudgeEl` + `realLeaves.stalenessNudges` (transient nudges — keep)
2. **Orient** (`OrientZone`) — visibility score + clicks/impressions/position. Three numbers, **minimum
   chrome**. The trend sparkline is a `useShowMore`/expand item, **not default-visible**. Answers "how
   are we doing overall."
3. **What Changed** (`StrategyDiff`) — **promoted to immediately below Orient, ABOVE the cockpit.**
   Answers "what moved since I was last here." A returning operator on Tuesday needs orientation
   *relative to what shifted since Monday*, then the queue of what to do about it. **This is a decision
   pipeline: orient → what changed → what to do.** Promoting it above the *divider* (the brief's draft)
   is not enough — the divider is a psychological off-ramp; everything below it reads as safe-to-skip,
   which is exactly where What Changed got buried. **It must sit above the cockpit.**
4. **The Cockpit** (`StrategyCockpit`, flag-ON) / `ActQueue` (flag-OFF) — where the operator acts.
   Nothing separates it from the top of the page except Orient + What Changed.
   - **Intelligence Signals FOLD INTO the cockpit as rec rows** (P4). The standalone
     `intelligenceSignalsEl` is **removed**.
   - **Cannibalization, gaps, clusters appear as rec ROWS that OPEN their rich cards** — not flattened.
     A `cannibalization`/`keyword_gap`/`topic_cluster` rec row in the cockpit, when expanded/clicked,
     reveals the rich `CannibalizationTriage` / gap / cluster treatment. (The rich Content-tab surfaces
     remain the canonical home; the Overview cockpit row is the entry point.)
5. **Collapsed Strategy Config** (`StrategyConfig`, P4) — at the bottom, accordion-collapsed.

**Removed from Overview** (vs today): the "Reference & Analysis" divider and everything under it
(`cannibalization` passive alert, the buried `strategyDiff`, `siteKeywords`, `opportunities`,
`intelligenceSignalsEl`, `howItWorks`). What Changed moves up; the keyword surfaces move to Tab ②;
Signals fold into the cockpit; `StrategyHowItWorks` is **cut from inline render** → demoted to a `?`
tooltip / "About this page" collapsible in the `PageHeader` (it is an onboarding explainer, not a
weekly-use surface).

### Tab ② Keywords & Rankings (rename of "Rankings")

The big visible move. Today "Rankings" is near-empty. We make it the home of the curated keyword
working set + the keyword surfaces stranded in Overview.

**Render order:**

1. **Site Target Keywords** — the curated working set (managed: add / remove / keep, auto-replenish a
   removed slot, search-and-add, add-from-client-requests). A **true "top 10–20 we're actively
   targeting" slice, DISTINCT from the Keyword Hub's universe — NOT a mirror.** (Data model in §5.)
2. **Keyword Opportunities** — per-row "Send to client: interested in this one?" → a yes joins the target
   set. (Send via Path A.)
3. **Client Keyword Feedback log** (`ClientKeywordFeedback`) — the approved/declined history moves here
   (out of the always-rendered leak).
4. **Ranking Distribution** + **Position Movements** (the existing `StrategyRankingsTab` content).
5. **"Open the Keyword Hub"** deep-link for the full universe/research
   (`adminPath(ws, 'seo-keywords')` + `buildHubDeepLinkQuery`).

### Tab ③ Content = the money page

1. **Content Gaps** (`ContentGaps`) — managed + send-to-client + briefs **PRE-SEEDED with the gap's full
   computed context**, not a bare keyword. (Brief pre-seed fix in §5.)
2. **Topic Clusters** (`TopicClusters`) — managed set (add / remove / keep) + research-seed + why/how/
   result narrative.
3. **Decaying Pages** (`DecayingPagesCard`) — Send "should we refresh?" (Path A via `content_decay` rec).
4. **Cannibalization re-homed as the ACTIONABLE `CannibalizationTriage`** — pick-the-keeper + Send-to-
   client. (Today Overview renders the passive read-only `CannibalizationAlert`; the actionable
   `CannibalizationTriage` is orphaned. We swap them — see §4.)

### Tab ④ Competitive

1. **Share of Voice** (`ShareBar`)
2. **Competitor comparison** (`CompetitiveIntel`) — **with action / send-to-client** (Path A).
3. **Keyword gaps** (`KeywordGaps`)
4. **Backlinks** (`BacklinkProfile`) — **stays here** (not split to `links`; see Non-Goals).

---

## 4. Each surface — behavior + reuse vs net-new

| Surface | Reuse | Net-new |
|---|---|---|
| **What Changed promotion** | 100% reuse. `StrategyDiff` reads `queryKeys.admin.strategyDiff`, renders only when `hasChanges`, refetches on `strategy:updated`. Keep its **intentional brand-asymmetric amber-bordered non-SectionCard chrome** (`StrategyDiff.tsx:41` has a `pr-check-disable` line) — **do NOT "fix" it into a SectionCard.** | **Zero backend.** Pure JSX reorder in `KeywordStrategy.tsx` (move `realLeaves.strategyDiff` from `:419` to above the cockpit). Block any attempt to add a backend call — it is already wired. |
| **Scannable cockpit + leaves** | Cockpit's `FIX_NOW_CAP` curated slice stays. | `useShowMore` hook + adoption in 5 leaves (Pattern 1). |
| **Cannibalization re-home** | **~100% built.** `CannibalizationTriage.tsx` has keeper-pick (`keeperPathOf`), Fix-in-editor, Mark-resolved (records `cannibalization_resolved` outcome, inferred from durable `tracked_actions:84-94`), and Send-to-client (the `cannibalization` deliverable adapter). | **Almost nothing:** swap `CannibalizationAlert` → `CannibalizationTriage` in the new IA and move it to the **Content** tab. **Keep the `CannibalizationAlert` component** — it is still used by ContentPipeline + legacy; just stop importing it into Strategy. This is the **highest effort-to-value fix in the redesign** — I'd make it as early as the swap can ride a phase. |
| **Site Target Keywords (managed set)** | `SiteTargetKeywords.tsx` (display + per-row Track via `useTrackKeyword` + View-in-Hub). `useToggleSet(defaults, {min,max})` for add/remove/keep (`src/hooks/useToggleSet.ts`; default `min:1, max:3` — we pass an explicit higher `max`, e.g. 20). Add-from-client-requests source: `ClientKeywordFeedback` + `useKeywordFeedback` (`feedback.addRequestedKeyword`). | The **managed-set persistence** (add/remove/keep that survives regen, auto-replenish) — see §5. UI: inline search-and-add (no modal), "auto-filled" badge on replenished slots, "Client requested" inline badge. |
| **Keyword Opportunities send** | `KeywordOpportunities.tsx` (passive list). | A `StrategyRecommendationPayload` → rec mint + `sendRecommendation()` wire. Per-row "interested in this one?" send. No new source type. |
| **Content Gaps brief pre-seed** | `fixContext` navigation-state carrier (`ContentGaps.tsx:78,86` already passes `{primaryKeyword, pageType}`). | **Extend `fixContext` payload** to carry the gap's full computed context (`rationale`, `competitorProof`, `volume`, `intent`, `questionKeywords`, `serpFeatures` — all present on the `ContentGap` interface, all dropped today) **AND update the receiver** (brief generator) to consume them in the **same PR**. A half-connected `fixContext` (fields present, receiver ignores) is worse than today's no-context state — it creates false confidence. |
| **Topic Clusters managed set** | `TopicClusters.tsx` (passive list). | add/remove/keep via the durable `tracked_actions` keep-flag pattern (§5) + why/how/result via the Pattern 2 presenter + research-seed CTA. |
| **Decaying Pages send** | `DecayingPagesCard.tsx` (Refresh/Review, no send today). | Send via Path A: mint/find a `content_decay` rec for the page → `sendRecommendation()`. |
| **Competitive action/send** | `StrategyCompetitiveTab` (ShareBar + BacklinkProfile + CompetitiveIntel + KeywordGaps). | Per-row send on CompetitiveIntel via Path A. |
| **Signal fold** | Cockpit row rendering + `recCategoryMap.ts` + `useIntelligenceSignals` + `StrategySignal` (`shared/types/insights.ts`). | A `StrategySignal` → **synthetic display-only** cockpit row mapper + delete `intelligenceSignalsEl` + **fix the `Computed X ago ago` double-"ago" bug** (`IntelligenceSignals.tsx:49` — `timeAgo(..., {style:'long'})` already returns "… ago", so drop the literal " ago") **in the same PR that removes the component.** |
| **Strategy Config consolidation** | `StrategySettings` + Local SEO config inputs. | Collapsed `StrategyConfig` accordion + remove `LocalSeoVisibilityPanel` from `KeywordStrategy.tsx` (keep in `KeywordHub.tsx`). |

---

## 5. Data model — curated keyword set / managed sets / universal send

### 5.1 Curated keyword working set (the one genuine net-new persistence)

**The trap (Trap #1):** `strategy.siteKeywords` is a read-only field on the strategy blob
(`server/workspaces.ts ~166`), **rewritten wholesale on every regen.** A "keep" flag stored on the
delete-then-reinsert normalized tables (`keyword_gaps`, `topic_clusters`, `cannibalization_issues`) gets
**clobbered on the next `saveRecommendations()` cycle** — a silent regen-clobber bug operators won't
notice until they've curated twice and given up. (The `CannibalizationTriage.tsx:84` pattern — infer
durable state from `tracked_actions`, not the issue row — is the proof this bites.)

**My ruling (aligned with both teammates — settled): a dedicated durable table, NOT a column on the
blob, NOT a flag on a normalized table.**

```sql
-- migration 14x
CREATE TABLE curated_keywords (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword      TEXT NOT NULL,
  source       TEXT NOT NULL CHECK(source IN ('strategy_mint','client_request','manual_add')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  slot_order   INTEGER NOT NULL DEFAULT 0,
  added_at     TEXT NOT NULL,
  removed_at   TEXT,
  UNIQUE(workspace_id, keyword)
);
CREATE INDEX idx_curated_keywords_ws ON curated_keywords(workspace_id, status);
```

- **Survives regen** (the blob rewrite doesn't touch it).
- **`removed_at`** gives the auto-replenish signal cleanly.
- **`source`** tells the replenish logic whether to pull from `keyword_gaps` (auto-mint) or leave the
  slot for manual add. `UNIQUE(workspace_id, keyword)` prevents cross-source duplicates without a
  client-side dedup pass.

**Domain module (not a route file):** `server/domains/strategy/curated-keywords.ts` — pure functions
consumed by the strategy route:

- `getCuratedKeywords(workspaceId)` → active rows ordered by `slot_order`.
- `addCuratedKeyword(workspaceId, keyword, source)` — `UNIQUE` upsert.
- `removeCuratedKeyword(workspaceId, keyword)` → sets `status='removed'`, `removed_at=now`, then
  **`replenishSlot()`** inside the same `db.transaction()` (not fire-and-forget).
- `replenishSlot(workspaceId)` — pulls the top-scored non-curated `keyword_gaps` entry
  (`WHERE keyword NOT IN (SELECT keyword FROM curated_keywords WHERE workspace_id = ? AND status='active')`),
  inserts with `source='strategy_mint'`.
- `syncCuratedKeywordsFromStrategy(workspaceId, newSiteKeywords)` — on regen, mints slots for keywords
  that appeared in the new blob but have no row yet (additive; never deletes operator-kept rows).

**Shared contract committed before any parallel agent touches the write path** (per multi-agent rules):
the row interface + function signatures land in `shared/types/` (or a `server/domains/strategy/` typed
contract) in the **first commit of the phase**. This is the one place the redesign could produce a
silent regen-clobber, so the contract is pre-committed, not negotiated in a PR comment.

### 5.2 Managed sets for Topic Clusters + Content Gaps

Same regen-clobber problem; same solution. **Infer "keep" / "in progress" from durable `tracked_actions`**
(the `CannibalizationTriage.tsx:84` precedent), NOT a column on the delete-then-reinsert tables.

- New `tracked_actions` type values: `topic_cluster_keep`, `content_gap_keep` (migration 14y; document
  in the table constraint or `tracked_action_types` enum check).
- The component queries `tracked_actions` for the workspace and cross-references on render; regen
  rewrites `topic_clusters` / `content_gaps`, the `tracked_actions` row survives.
- **Do NOT add a `keep_flag` column to `topic_clusters` / `content_gaps`** — it works in dev, breaks
  after the first background regen.

### 5.3 Universal send — data flow (no new source type)

For a domain item that has no rec yet (keyword opportunity, decaying page):

1. Build a `StrategyRecommendationPayload` (`shared/types/recommendations.ts:221`) from the item.
2. Mint it into the rec set (or find the existing matching rec by `buildMergeKey`).
3. Call `sendRecommendation(workspaceId, recId)` → `clientStatus → sent`, routed by
   `REC_POLICY_REGISTRY[type].sendChannel`.
4. `broadcastToWorkspace(ws, WS_EVENTS.RECOMMENDATIONS_UPDATED)` + frontend `useWorkspaceEvents` handler
   invalidates `queryKeys.admin.recommendations`.

**Lifecycle-axis invariants every new reader MUST honor** (Trap #1 — the #1 historical bug):

- Any surface that **lists or counts** recs routes through **`isActiveRec(rec, now?)`**
  (`server/recommendations.ts:638`) — the single active-set predicate.
- **strike / throttle / send NEVER write `RecStatus`.** A struck rec must never become `completed`
  (reads as "✓ done" to the client). Enforced by exit-gate test `strike-never-completed`.
- New `ClientActivityType`s register in the closed union same-commit
  (`rec_sent`/`rec_approved` → CLIENT_VISIBLE; `rec_struck`/`rec_throttled` → admin-only).

### 5.4 Broadcast / handler pairs (both halves, same PR)

| Write | Event constant | Query key invalidated | Hook |
|---|---|---|---|
| `addCuratedKeyword` / `removeCuratedKeyword` | `WS_EVENTS.STRATEGY_UPDATED` (already defined, `ws-events.ts:139`) | `queryKeys.admin.strategy` (+ `keywordOpportunities` on replenish) | `useWorkspaceEvents` |
| `tracked_actions` keep-flag (clusters/gaps) | `WS_EVENTS.STRATEGY_UPDATED` | component-specific (clusters / gaps key) | `useWorkspaceEvents` |
| `sendRecommendation` (already broadcasts) | `WS_EVENTS.RECOMMENDATIONS_UPDATED` (`ws-events.ts:135`) | `queryKeys.admin.recommendations` | `useWorkspaceEvents` |

**`useWorkspaceEvents`, never `useGlobalAdminEvents`** (the latter sends no `subscribe`, so the handler
is dead code — the CLAUDE.md rule is explicit). Every significant op calls `addActivity()`.

---

## 6. `?tab=` + flag-gating + flag-OFF parity

### `?tab=` two-halves contract

- **Sender:** any `navigate(adminPath(ws, 'strategy') + '?tab=X')` keeps appending the existing literal
  ids (`overview | content | rankings | competitive`).
- **Receiver:** `KeywordStrategy.tsx:68-79` already reads `searchParams.get('tab')` and syncs on change.
  **Unchanged.**
- **Rankings rename:** change only the **`label`** in `STRATEGY_INTERIOR_TABS` (`'Rankings'` →
  `'Keywords & Rankings'`). **The `id` stays `'rankings'`** — the contract test
  `tests/contract/tab-deep-link-wiring.test.ts` scans for the literal id. Renaming the id breaks the
  deep-link contract and legacy bookmarks.

### Flag-gating

**The flag's job is narrow and already established:** `commandCenterEnabled =
useFeatureFlag('strategy-command-center')` (`KeywordStrategy.tsx:106`) currently only swaps **cockpit
(ON) vs ActQueue (OFF)** inside Overview — it is **not** a whole-page fork. **Flag-OFF today already
renders the 4-tab command-center IA.** The flag (`shared/types/feature-flags.ts:59`, default `false`,
`group: 'Strategy'`, `rolloutTarget: 'staging-validation'`) is the umbrella for all net-new admin UI in
this redesign.

**Every IA move gates behind this flag.** Concretely, each moved/removed surface is conditional on
`commandCenterEnabled`:

- What Changed promotion: `commandCenterEnabled ? <above-cockpit position> : <today's buried position>`.
- Keyword surfaces moving to Tab ②: gated.
- `ClientKeywordFeedback` + `StrategySettings` moving out of the leak into tabs / collapsed config: gated.
- `LocalSeoVisibilityPanel` removal from Strategy: gated.
- Signal fold + cannibalization swap: gated.

**Child flags:** if any phase needs finer dark-launch granularity (e.g. the managed-set write path lands
before its UI), add the child flag to `shared/types/feature-flags.ts` **before the first commit of that
phase** (`npm run verify:feature-flags` gate). Default new child flags under the `'Strategy'` group.

### Flag-OFF parity (byte-identical to today)

**Non-negotiable.** Flag-OFF must stay byte-identical to today: 4-tab IA with the **v2 ActQueue** (not
the cockpit), What Changed in its current buried position, keyword surfaces in Overview, Settings +
ClientFeedback + LocalSeo in the always-rendered zone.

- **Exit-gate test:** flag-OFF byte-identical snapshot on the **real public read**
  (`tests/integration/recommendations-public-allowlist.test.ts`); flag-ON no-admin-key-leak. **Run on
  every phase PR, not just the final one** — one unflagged move of a surface that renders on flag-OFF is
  a production surprise.
- **The leak is the trap:** `clientFeedbackCombinedEl` + `settingsEl` + `localSeoEl` render OUTSIDE the
  tabs unconditionally today. When we move them, the move is conditional on the flag; the flag-OFF branch
  keeps them exactly where they are. Deduping `LocalSeoVisibilityPanel` touches **both**
  `KeywordStrategy.tsx` AND `KeywordHub.tsx` — gate the Strategy-side removal.

---

## 7. Phasing (front-load visible wins; phase-per-PR)

**My phasing resolves the PM ↔ Engineer ordering tension.** The PM wants visible wins first (P1 What
Changed + scannable; P2 keyword rename/move; P3 send; P4 fold/cannibalization). The engineer wants the
migration (curated-keywords table) early to de-risk the regen-clobber. **My call — usability lead:** the
operator's "nothing looks different" persists until P1+P2 ship, so **visible-first wins.** But the
**cannibalization swap is so cheap and so visible (a passive surface becomes actionable for one file
swap) that it rides P1**, not P4 — this is where I overrule the PM's "P4 cannibalization." And the
curated-keywords **migration + write path lands in P2** (with the rename/move) rather than a separate
P3, so the managed-set persistence is in place the moment the keyword surfaces arrive on their new tab —
this is where I take the engineer's de-risking concern seriously without delaying the visible move.

> **Phase-per-PR, staging-first.** Never open phase N+1 until phase N is merged and CI is green on
> staging. Each phase ships a **screen**, not just a backend — the signal-fold was deferred once for
> being "backend-only plumbing"; we frame every phase as a visible change.

### Phase 1 — "The page transforms in one afternoon" (no backend)

Visible win, near-zero risk.

- Promote **What Changed** above the cockpit in Overview (JSX reorder, flag-gated).
- Build **`useShowMore`** + adopt in `ContentGaps`, `TopicClusters`, `KeywordOpportunities`,
  `SiteTargetKeywords`, `CannibalizationTriage` (caps at 5, "Show N more" label).
- **Swap `CannibalizationAlert` → `CannibalizationTriage`** and move it to the **Content** tab
  (one-file swap; keep `CannibalizationAlert` for ContentPipeline/legacy).
- Demote `StrategyHowItWorks` from inline → `?` tooltip / collapsible in the header.

**Acceptance:** What Changed renders above the cockpit (flag-ON); no leaf renders >5 items before a
"Show N more" affordance; `CannibalizationTriage` (actionable) replaces the passive alert; flag-OFF
snapshot green.

### Phase 2 — "Keywords & Rankings earns its rename" (the migration phase)

The big visible move + the one net-new persistence.

- Rename Rankings **label** → "Keywords & Rankings" (keep `id='rankings'`).
- Move **Site Target Keywords + Keyword Opportunities + ClientKeywordFeedback** out of the Overview
  scroll / always-rendered leak into this tab (flag-gated; fixes the leak).
- **Migration 14x `curated_keywords`** + `server/domains/strategy/curated-keywords.ts` write path +
  `replenishSlot` + `syncCuratedKeywordsFromStrategy` + broadcast/handler pairs. **Shared contract
  pre-committed before any parallel agent touches the write path.**
- Managed-set UI on Site Target Keywords (`useToggleSet`, inline search-and-add, "auto-filled" +
  "Client requested" badges).
- "Open the Keyword Hub" deep-link present.

**Acceptance:** Keywords & Rankings hosts the curated set with add/remove/keep + auto-replenish that
survives a regen (test: regen does not clobber kept keywords); ClientKeywordFeedback out of the leak;
Hub deep-link present; flag-OFF snapshot green.

### Phase 3 — "Send-to-client becomes a column, not an afterthought"

The monetization loop.

- Build the **`WhyHowResult`** presenter (renders existing fields; `estimatedGain` preferred,
  `impactBand` fallback).
- Wire universal send (Path A, `StrategyRecommendationPayload` → `sendRecommendation`) to **Keyword
  Opportunities** ("interested in this one?" → yes joins the target set), **Decaying Pages**, and
  **Competitive (CompetitiveIntel)**.
- Inline collapsible note + post-send/response state on every send row.
- **Brief pre-seed:** extend `ContentGaps` `fixContext` payload to carry the full computed context
  (`rationale`, `competitorProof`, `volume`, `intent`, `questionKeywords`, `serpFeatures`) **AND update
  the brief-generator receiver in the same PR.**

**Acceptance:** operator can send any keyword opportunity / decaying page / competitor insight in ≤2
clicks; every sent item shows why / action / projected outcome (concrete `estimatedGain` where it
exists); no new `ClientActionSourceType`; flag-OFF snapshot green.

### Phase 4 — "Fold signals, consolidate config" (most internally complex)

- **Signal fold:** `StrategySignal` → synthetic display-only cockpit row mapper; delete
  `intelligenceSignalsEl`; **fix the `Computed X ago ago` double-"ago" bug in the same PR.**
- **Strategy Config consolidation:** collapsed `StrategyConfig` accordion (Settings + Local SEO config);
  remove `LocalSeoVisibilityPanel` from Strategy (keep in Hub).
- Topic Clusters managed set (tracked_actions keep-flag) + why/how/result narrative + research-seed.

**Acceptance:** standalone signals card gone, signals appear as cockpit rows, double-"ago" bug gone;
config collapsed; LocalSeo renders in exactly one place (the Hub); flag-OFF snapshot green.

---

## 8. Testing + risks

### Testing

| Layer | What |
|---|---|
| **Flag-OFF parity** | `tests/integration/recommendations-public-allowlist.test.ts` (byte-identical snapshot on the real public read) — run on **every** phase PR. |
| **Deep-link contract** | `tests/contract/tab-deep-link-wiring.test.ts` (literal tab ids unchanged after the label rename). |
| **Curated-keyword regen survival** | New integration test: seed curated set → run a strategy regen → assert kept keywords survive and `slot_order` is preserved (the regen-clobber guard). Mirrors `recommendation-regen-preserves-lifecycle.test.ts`. |
| **Managed-set keep via tracked_actions** | Integration test: mark a topic cluster "keep" → regen → assert keep state survives (read from `tracked_actions`). |
| **`isActiveRec` routing** | Any new rec-listing/counting surface asserts it routes through `isActiveRec` and never writes `RecStatus` on strike/throttle/send (extends `strike-never-completed`). |
| **Send broadcast/handler pairs** | Integration test per new send surface: mutation broadcasts `RECOMMENDATIONS_UPDATED` and the frontend handler invalidates `queryKeys.admin.recommendations`. |
| **Brief pre-seed receiver** | Integration test: `ContentGaps` send → assert the brief generator receives `rationale`/`competitorProof`/etc. (guards the half-connected `fixContext` false-confidence trap). |
| **Component / a11y** | `useShowMore` unit test (cap, count label, expand/collapse); SectionCard double-pad guard on any new leaf; icon-size audit (`w-5 h-5` → `size="lg"`, NOT `md`). |

### Risks (ranked)

1. **Flag-OFF drift — the production-embarrassment risk.** `clientFeedbackCombinedEl` + `settingsEl` +
   `localSeoEl` leak outside the tabs unconditionally today. Every phase that moves a surface gates the
   move behind the flag AND verifies the snapshot. One unflagged move = a production surprise.
   *Mitigation:* snapshot test on every phase PR; the LocalSeo dedup explicitly touches both files.

2. **Curated-keyword regen-clobber — the silent-data-loss risk.** If "keep" lands on the
   delete-then-reinsert normalized tables (or as a UI-only filter on `strategy.siteKeywords`), it's
   clobbered on the next background regen and operators lose curation silently. *Mitigation:* dedicated
   `curated_keywords` table; pre-committed contract; regen-survival integration test before the UI ships.

3. **Send built per-card — the universal-mechanism violation.** Three agents will be tempted to add a
   quick `clientActions.create` per surface (or a new `ClientActionSourceType`). *Mitigation:* PR-review
   tripwire on `ClientActionSourceType` diffs; route everything through `sendRecommendation()` /
   `StrategyRecommendationPayload`.

4. **Information overload returns through the back door.** The scannable pattern only works if every leaf
   defaults to capped. One uncapped 80-item leaf breaks "this page is curated." *Mitigation:* the shared
   `useShowMore` hook makes capping mechanical; the acceptance gate is "no leaf renders >5 untruncated."

5. **Signal-fold silently re-deferring + the double-"ago" bug riding along.** v2 Task 2.2 was deferred
   once as "backend plumbing." *Mitigation:* frame P4 as a visible screen change (Overview stops
   scrolling through signal cards; the cockpit gains signal rows); fix `IntelligenceSignals.tsx:49` in
   the same PR that deletes the component — never ship the fold while the bug stays live on staging.

6. **Brief pre-seed false confidence.** A `fixContext` with the new fields but a receiver that ignores
   them is worse than today. *Mitigation:* extend payload + update receiver in one PR; integration test
   asserts the receiver reads them.

### Net-new vs reuse (one line)

Genuinely net-new: the `curated_keywords` table + domain module (the one new persistence), the
`useShowMore` hook, the `WhyHowResult` presenter, and the `StrategySignal`→synthetic-row mapper.
Everything else is reuse: the rec lifecycle + `sendRecommendation` + `StrategyRecommendationPayload`
(already declared), the orphaned-but-built `CannibalizationTriage`, the `tracked_actions` durable-state
pattern, `StrategyDiff`, `useToggleSet`, the deliverable spine, and every design-system primitive.
