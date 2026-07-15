# Action Catalog — the read-only action metadata registry

> **Contract for `shared/types/action-catalog.ts`.** The catalog is a metadata
> registry, not a fourth (or fifth, sixth…) copy of the platform's action
> vocabularies. It **imports** the five source unions and **never** merges,
> widens, or redefines them. If you are about to add a new action verb or
> outcome type anywhere in the platform, read this doc before touching the
> catalog.

## What the catalog is (and is not)

`ACTION_CATALOG` (`shared/types/action-catalog.ts`) attaches presentation and
provenance metadata — `label`, `phase`, `outcomeActionType`, `clientVisible`,
an optional `note` — to every member of five existing, independently-owned
vocabularies:

| Context | Source union / const | Owning file |
|---|---|---|
| `outcome` | `ActionType` (17 members) | `shared/types/outcome-tracking.ts` |
| `recommendation` | `RecType` (15 members) | `shared/types/recommendations.ts` |
| `client_action` | `ClientActionSourceType` (5 members) | `shared/types/client-actions.ts` |
| `keyword_command_center` | `KEYWORD_COMMAND_CENTER_ACTIONS` (7 verbs) | `shared/types/keyword-command-center.ts` |
| `mcp` | wire-level action verbs (`send`/`throttle`/`strike`, `respond_client_action:*`, `decline_approval_item`, `template_generation_upgrade:*`) | `shared/types/mcp-action-schemas.ts`, `shared/types/mcp-matrix-schemas.ts` |

The catalog is modeled on `BACKGROUND_JOB_METADATA`
(`shared/types/background-jobs.ts:79`) — a `{ [K in Union]: Metadata }` mapped
type over an existing, independently-declared union. It is **not** a new
canonical vocabulary. The owning files above remain the single source of
truth for values.

**Never redefine a union inside the catalog.** `ScoringConfig =
Record<ActionType, ScoringConfigEntry>` in `shared/types/outcome-tracking.ts`
is the concrete hazard this rule protects: if the catalog ever declared its
own ActionType-shaped union instead of importing the real one, a member added
in one place and not the other would silently desync every exhaustive
`Record<ActionType, …>` registry in the codebase (ScoringConfig, the four
label maps, `DEFAULT_SCORING_CONFIG`, …). Import, never redeclare.

## Completeness is compile-time, not a checklist

Each context's catalog object is written as `satisfies Record<Union,
ActionCatalogEntry>` against the real imported type:

```ts
const OUTCOME_CATALOG = {
  insight_acted_on: { /* … */ },
  // …
} as const satisfies Record<ActionType, ActionCatalogEntry>;
```

Adding a member to `ActionType` (or any of the other four vocabularies)
without adding a matching catalog entry is a **TypeScript compile error**, not
a lint warning or a doc you can forget to update. `KeywordCommandCenterActionType`
and the MCP verbs are not TypeScript unions (they're derived from a `const`
object and inline Zod `z.enum([...])` literals respectively), so their
completeness is enforced by `tests/contract/action-catalog.test.ts` reading
the real runtime values (`Object.values(KEYWORD_COMMAND_CENTER_ACTIONS)`, the
zod schema's `.options`) instead of a `satisfies` clause.

## How to add a new action

1. **Add the member to its owning union first** — `ActionType`,
   `RecType`, `ClientActionSourceType`, `KEYWORD_COMMAND_CENTER_ACTIONS`, or a
   new MCP schema enum value. Follow that vocabulary's own contract (e.g. the
   RecType→ActionType exhaustive-switch requirement in
   `docs/rules/seo-generation-quality.md`).
2. **Add the catalog entry in the matching context object.** TypeScript will
   refuse to compile until you do, for the four `satisfies`-checked contexts.
   For `mcp`, use a stable operation namespace when a generic verb could collide
   (for example `template_generation_upgrade:accept`), add the entry to
   `MCP_CATALOG`, and update
   `tests/contract/action-catalog.test.ts` if you introduced a new schema
   the test doesn't yet read.
3. **Pick the right `phase`:**
   - `detect` — a signal or opportunity is surfaced (a recommendation is
     minted, an insight fires).
   - `decide` — a human or agent chooses among options (send, throttle,
     strike, approve, decline, track).
   - `do` — the platform or client executes the change (publish, deploy,
     refresh).
   - `prove` — the outcome is measured and recorded (a `tracked_actions` /
     `action_outcomes` row).
4. **Set `outcomeActionType` only when there is a real seam mapping.** Do not
   invent one — cross-reference the actual seam mapper (see below). Leave it
   `undefined` for actions that never produce a tracked outcome (most `mcp`
   `decide`-phase verbs).
5. **Label wording follows the R1 word classes and
   [`docs/workflows/ui-vocabulary.md`](../workflows/ui-vocabulary.md)** —
   canonical admin-facing wording, not ad hoc phrasing.
6. **MCP context is additive-only.** 83 MCP tools and long-lived
   per-workspace API keys (migration 163) depend on the wire vocabulary never
   changing shape. Never rename an existing `mcp` catalog key or the verb it
   documents — that is a breaking change to persisted integrations, out of
   scope for a catalog change and requiring its own tolerate-old/emit-new
   workstream.

## Seam mappers stay the runtime authority

The catalog's `outcomeActionType` field is **documentation, not the runtime
mapping**. Three existing seam mappers remain the sole executable authority
for RecType/ClientActionSourceType/StrategySignal → ActionType translation,
and this catalog must never replace or duplicate their logic:

- `recommendationOutcomeActionType` — `server/domains/recommendations/outcome-action-type.ts`.
  Exhaustive `switch` over `RecType` with a `never` default: adding a
  `RecType` without an explicit case is a compile error.
- `OUTCOME_ACTION_TYPE_BY_SOURCE` — `server/domains/inbox/client-action-feedback-loop.ts`.
  `Record<ClientActionSourceType, ActionType>`.
- `signalToRecType` — `server/domains/recommendations/finalization.ts`.
  Maps a `StrategySignal['type']` to a `RecType`.

Two more seams are implicit (no dedicated mapper function, but a fixed
producer relationship) and are documented as catalog metadata/notes only:

- KCC `add_to_strategy` → `strategy_keyword_added` (`server/keyword-strategy-persistence.ts`).
- Insight resolution → `insight_acted_on` (`recordInsightResolutionOutcome`,
  `server/outcome-tracking.ts`).

If you find yourself writing new mapping *logic* inside
`action-catalog.ts`, stop — that belongs in a seam mapper file, not the
catalog.

## Keep-markers are live producers, never phantom entries

`topic_cluster_keep` and `content_gap_keep` are **not** vestigial or dead
`ActionType` members. They are durable keep-markers produced by live UI paths
(`src/components/strategy/TopicClusters.tsx` and
`src/components/strategy/ContentGaps.tsx`, both via `POST
/api/outcomes/:ws/actions`) that record an operator's decision to keep a
managed-set item. They exist to keep every exhaustive
`Record<ActionType, …>` registry in the codebase (`ScoringConfig`,
`DEFAULT_SCORING_CONFIG`, the label maps, and this catalog) honestly
complete, and are pinned end-to-end by
`tests/integration/strategy-managed-set-keep.test.ts`. **Never drop them from
the catalog or any other `ActionType`-keyed registry.**

## Historical / additive-only vocabulary the catalog deliberately excludes

Some action-shaped strings exist in the codebase but are **not** catalog
members by design:

- `resolveWinTitle`'s legacy-alias switch (`server/routes/outcomes.ts`)
  tolerates historical/retired source-type spellings (`'post'`/`'content_post'`,
  `'brief'`/`'content_brief'`). These are historical vocabulary (R1 word
  class) — tolerated on read, never renamed, never added as new catalog keys.
- `notifyTeamActionApproved`'s `sourceType: 'content_post'`
  (`server/routes/public-content.ts`) is a sixth, informal, notification-only
  vocabulary — not part of any of the five governed unions. Leave it alone;
  do not fold it into `ClientActionSourceType` or the catalog.
- `client_actions.source_type = 'content_post'` seeded by
  `scripts/seed-demo-workspaces.ts` is an out-of-union bug (silently coerced
  to `'aeo_change'` at read time by `server/client-actions.ts`) fixed
  alongside this ticket's consumer-cutover PR — not a vocabulary the catalog
  should ever legitimize.

`getActionCatalogEntry()` returns `undefined` for any of the above — callers
must not assume every string used anywhere in the codebase resolves through
the catalog.

## Existing per-RecType registries the catalog references, not duplicates

Several `RecType`-keyed presentation/policy registries already exist and stay
exactly where they are — the catalog does not fold them in:

- `REC_POLICY_REGISTRY` — `server/recommendation-lifecycle.ts` (monetization
  policy, pinned by `tests/integration/competitor-send.test.ts`).
- `REC_TYPE_TO_FIX_TYPE` — `shared/types/fix-catalog.ts`.
- `REC_TYPE_ACT_CATEGORY` — `src/lib/recCategoryMap.ts`.
- `REC_TYPE_ADMIN_TAB` — `src/lib/recTypeTab.ts`.
- `REC_TYPE_ARCHETYPE` — `shared/types/strategy-archetype.ts` (contract-test
  pinned presentation grouping).

Consolidating these into the action catalog is an explicit non-goal of this
ticket (R5) — it would balloon the diff and risk client-facing churn for no
correctness gain. A later ticket may revisit consolidation.

## Consumer cutover is a separate PR

This PR (R5-PR1) is **purely additive** — the catalog has zero runtime
consumers. Re-sourcing the four duplicated `Record<ActionType, string>` label
maps (`server/routes/outcomes.ts` `WIN_FALLBACK_LABELS`,
`src/components/admin/outcomes/outcomeConstants.ts` `ACTION_TYPE_LABELS`,
`src/components/client/Briefing/WinsSurface.tsx` `ACTION_LABELS`,
`src/components/client/OutcomeSummary.tsx` `ACTION_TYPE_LABELS`) and
`CLIENT_ACTION_BADGES` (`src/lib/decision-adapters.ts`) from catalog labels is
R5-PR2 — a behavior-preserving consumption change with its own pinned-string
tests. Do not wire consumers in the same PR that introduces the catalog.

## Verification

- `npx vitest run tests/contract/action-catalog.test.ts` — completeness
  (every union member has a catalog entry), no-out-of-union-keys, required
  fields, keep-marker presence, and a fixture proof that deleting an entry is
  caught.
- `npm run typecheck` — the four `satisfies Record<Union, Entry>` clauses
  fail to compile on a missing member.
