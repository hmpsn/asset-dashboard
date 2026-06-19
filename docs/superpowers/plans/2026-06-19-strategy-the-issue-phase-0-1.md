# The Issue — Phase 0 + Phase 1 Implementation Plan (admin cockpit)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the admin Strategy "Issue" cockpit — a system-drafted, operator-curated point of view + archetype-grouped backing-moves queue (keep/cut/park/send + cannibalization keeper-override) — behind the `strategy-the-issue` flag, byte-identical when OFF.

**Architecture:** Composition over the existing curation engine. Phase 0 pre-commits every cross-lane shared contract (flag, types, predicate, maps, AI op, WS events, migrations) as one small additive PR. Phase 1 then builds five concurrent lanes against those frozen contracts + a single-owner orchestrator branch in `KeywordStrategy.tsx`. No curation backend is rewritten — `recommendation-lifecycle.ts` (5 verbs), `isActiveRec`, `applyLifecycleCarryOver`, the atomic bulk route, and `meeting-brief-generator` are reused/cloned.

**Tech Stack:** React 19 + Vite + Tailwind 4 (tokens via `src/tokens.css`, `.t-*` utilities, `src/components/ui` primitives), Express + TypeScript, SQLite (better-sqlite3, migrations), Zod, React Query, Vitest + Playwright.

**Source of truth:** spec `docs/superpowers/specs/2026-06-19-strategy-the-issue-design.md`; verified scope `docs/superpowers/audits/2026-06-19-strategy-the-issue-audit.md`. Every file below appears in the audit. Do not introduce files not justified there.

---

## Decisions (resolving audit §9 open questions — locked for this plan)

1. **`RecType` has 15 members** (verified `shared/types/recommendations.ts`). Archetype/stance maps + exhaustiveness tests cover **15**.
2. **POV persistence** = a NEW `strategy_pov` table/store (NOT `meeting_briefs`): the rec set it reads is the *inverse* (curated/sent vs top-active), and it carries a versioned editable override. Migration number = next free after the content-request migration (current max is 139; this plan creates 140 then 141 — confirm `ls server/db/migrations | tail` at write time and use the next integers).
3. **`normalizeRecommendation` is DROPPED for now.** The client feed reads the public rec projection + the already-working content-request/deliverable projections; recs do not enter the unified Inbox Decisions section in this scope. (Removes a MEDIUM.)
4. **Act-on endpoint** = `POST /api/public/recommendations/:ws/:recId/act-on`; fix the stale `state-machines.ts` comment referencing `/respond` in the same commit it's first touched (Phase 2).
5. **`OverviewTab` precedence:** when both `client-briefing-v2` and `strategy-the-issue` are ON, `strategy-the-issue` wins (Phase 2).
6. **Phase 0 ships as its own PR** (additive contracts, flag OFF, zero behavior change) → merge to staging → Phase 1 branches off updated staging.

## Branch / PR strategy

- Base all implementation branches off **`staging`** (per CLAUDE.md staging-first), not `strategy-redesign-phase-4` (which holds the planning docs).
- Phase 0 branch: `the-issue/phase-0-contracts` → PR into `staging`.
- Phase 1 branch: `the-issue/phase-1-cockpit` (off staging after P0 merges) → PR into `staging`.
- Every PR: local gates green → `scaled-code-review` (fix Critical/Important) → push → CI green → merge. Surface to owner before any `staging → main`.

---

# PHASE 0 — Shared contracts (one PR, sequential, single owner)

> Every item is touched by ≥2 Phase-1 lanes. All additive; flag is OFF so behavior is unchanged. Gate: `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags`.

### Task 0.1: Register the `strategy-the-issue` feature flag

**Files:**
- Modify: `shared/types/feature-flags.ts` (FEATURE_FLAGS map + `FEATURE_FLAG_CATALOG` entry under the `Strategy` group + `FEATURE_FLAG_GROUPS`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/contract/feature-flag-the-issue.test.ts
import { describe, it, expect } from 'vitest'
import { FEATURE_FLAGS, FEATURE_FLAG_CATALOG } from '../../shared/types/feature-flags.js'
describe('strategy-the-issue flag', () => {
  it('is registered, default OFF, in the Strategy group', () => {
    expect(FEATURE_FLAGS['strategy-the-issue']).toBe(false)
    const entry = FEATURE_FLAG_CATALOG.find(f => f.key === 'strategy-the-issue')
    expect(entry).toBeTruthy()
    expect(entry!.group).toBe('Strategy')
    expect(entry!.lifecycle).toBe('active')
  })
})
```

- [ ] **Step 2: Run it; expect FAIL** — `npx vitest run tests/contract/feature-flag-the-issue.test.ts` → fails (key undefined).
- [ ] **Step 3: Add the flag** in all THREE locations (read the existing `strategy-command-center` entry as the template; copy its `rolloutTarget: 'staging-validation'`, `owner: 'analytics-intelligence'`, `lifecycle: 'active'`; `description`: "The Issue — system-drafted curated POV cockpit + V2 client feed"). The import-time `assertFeatureFlagGroupingConsistency()` throws if a location is missed.
- [ ] **Step 4: Run test + `npm run verify:feature-flags`** → PASS.
- [ ] **Step 5: Commit** — `git add shared/types/feature-flags.ts tests/contract/feature-flag-the-issue.test.ts && git commit -m "feat(the-issue): register strategy-the-issue feature flag (P0)"`

### Task 0.2: `Archetype` contract + exhaustive map

**Files:**
- Create: `shared/types/strategy-archetype.ts`
- Test: `tests/contract/strategy-archetype-exhaustiveness.test.ts`

- [ ] **Step 1: Write the failing exhaustiveness test**

```ts
import { describe, it, expect } from 'vitest'
import { REC_TYPE_ARCHETYPE, ARCHETYPE_ORDER } from '../../shared/types/strategy-archetype.js'
const REC_TYPES = ['technical','content','content_refresh','schema','metadata','performance','accessibility','strategy','aeo','keyword_gap','topic_cluster','cannibalization','local_visibility','local_service_gap','competitor'] as const
describe('archetype map', () => {
  it('maps all 15 RecTypes to a known archetype', () => {
    for (const t of REC_TYPES) {
      expect(ARCHETYPE_ORDER).toContain(REC_TYPE_ARCHETYPE[t])
    }
    expect(Object.keys(REC_TYPE_ARCHETYPE).sort()).toEqual([...REC_TYPES].sort())
  })
})
```

- [ ] **Step 2: Run; expect FAIL** (module missing).
- [ ] **Step 3: Create the contract** (locked 6-bucket assignment):

```ts
import type { RecType } from './recommendations.js'
export type Archetype = 'authority_bet' | 'refresh_reclaim' | 'defend' | 'quick_win' | 'technical' | 'local'
export const ARCHETYPE_ORDER: Archetype[] = ['authority_bet','refresh_reclaim','defend','quick_win','technical','local']
export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  authority_bet: 'New authority bets', refresh_reclaim: 'Refresh & reclaim', defend: 'Defend cannibalized',
  quick_win: 'Quick wins', technical: 'Technical fixes', local: 'Local',
}
export const REC_TYPE_ARCHETYPE = {
  content: 'authority_bet', keyword_gap: 'authority_bet', topic_cluster: 'authority_bet',
  content_refresh: 'refresh_reclaim',
  cannibalization: 'defend', competitor: 'defend',
  strategy: 'quick_win', aeo: 'quick_win',
  technical: 'technical', metadata: 'technical', schema: 'technical', performance: 'technical', accessibility: 'technical',
  local_visibility: 'local', local_service_gap: 'local',
} satisfies Record<RecType, Archetype>
// Create/refresh/defend headline verbs (MarketMuse-style count). 'technical'/'local' are counted separately.
export const ARCHETYPE_HEADLINE_VERB: Record<Archetype, 'create' | 'refresh' | 'defend' | 'other'> = {
  authority_bet: 'create', refresh_reclaim: 'refresh', defend: 'defend', quick_win: 'create', technical: 'other', local: 'other',
}
```

- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(the-issue): archetype contract + exhaustive RecType map (P0)"`

### Task 0.3: `isCuratedForClient` predicate

**Files:**
- Modify: `server/recommendations.ts` (co-locate next to `isActiveRec`, export it)
- Test: `tests/unit/is-curated-for-client.test.ts`

- [ ] **Step 1: Failing test** — assert `isCuratedForClient` returns true for `clientStatus` in `{sent, approved, discussing}`, false for `system`/`curated`/`declined` and for `lifecycle: 'struck'`.

```ts
import { isCuratedForClient } from '../../server/recommendations.js'
// build minimal Recommendation fixtures via tests/fixtures helpers
it('treats sent/approved/discussing (and not struck) as curated', () => {
  expect(isCuratedForClient({ clientStatus: 'sent', lifecycle: 'active' } as any)).toBe(true)
  expect(isCuratedForClient({ clientStatus: 'system', lifecycle: 'active' } as any)).toBe(false)
  expect(isCuratedForClient({ clientStatus: 'sent', lifecycle: 'struck' } as any)).toBe(false)
})
```

- [ ] **Step 2: Run; FAIL.**
- [ ] **Step 3: Implement** beside `isActiveRec`:

```ts
/** The client-curated set: what the operator has sent and what the client is engaging. */
export function isCuratedForClient(rec: Recommendation): boolean {
  if (rec.lifecycle === 'struck') return false
  return rec.clientStatus === 'sent' || rec.clientStatus === 'approved' || rec.clientStatus === 'discussing'
}
```

- [ ] **Step 4: Run; PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(the-issue): isCuratedForClient predicate (P0)"`

### Task 0.4: `DELIVERABLE_TYPES += 'recommendation'`

**Files:**
- Modify: `shared/types/client-deliverable.ts` (`DELIVERABLE_TYPES` const + payload Zod enum + `DELIVERABLE_TYPE_BADGES` if present)
- Test: `tests/contract/deliverable-types.test.ts`

- [ ] **Step 1: Failing test** — `expect(DELIVERABLE_TYPES).toContain('recommendation')`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** add `'recommendation'` to the const + the Zod enum + a badge entry (teal, "Recommendation"). Read the existing `cannibalization`/`content_request` entries as templates.
- [ ] **Step 4: PASS** + `npx tsc -b --noEmit` (the adapter-coverage type may now require an adapter — that lands in Phase 2; if the every-active-type lockstep test fails here, mark `'recommendation'` adapter as `pending` per the file's existing pending pattern, or gate the coverage test to Phase 2 — DO NOT stub a fake adapter).
- [ ] **Step 5: Commit** — `git commit -m "feat(the-issue): add recommendation deliverable type (P0)"`

### Task 0.5: Migration 140 — content-request rec linkage (lockstep)

**Files:**
- Create: `server/db/migrations/140-content-request-rec-linkage.sql`
- Modify: `server/content-requests.ts` (row interface, `rowToRequest`, insert stmt, `createContentRequest` signature), `shared/types/content.ts` (`ContentTopicRequest` type)
- Test: `tests/integration/content-request-rec-linkage.test.ts`

- [ ] **Step 1: Failing integration test** — create a content request with `recommendationId` + `strategyCardContext`; read it back; assert both round-trip.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Migration SQL** — `ALTER TABLE content_topic_requests ADD COLUMN recommendation_id TEXT; ALTER TABLE content_topic_requests ADD COLUMN strategy_card_context TEXT;` (JSON TEXT, parsed at read via `parseJsonSafe`). Then lockstep: add `recommendationId?: string` + `strategyCardContext?: StrategyCardContext` to the row interface + `ContentTopicRequest` type; extend `rowToRequest` (parse JSON safely) + the insert stmt + `createContentRequest(opts)` to accept/persist them (optional, default null).
- [ ] **Step 4: Run `npm run db:migrate` then the test; PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(the-issue): content-request rec linkage migration 140 (P0)"`

### Task 0.6: `StrategyPov` shared type + `strategy-pov` AI op + WS event + query keys

**Files:**
- Create: `shared/types/strategy-pov.ts`
- Modify: `server/ai-operation-registry.ts`, `server/ws-events.ts`, `src/lib/queryKeys.ts`

- [ ] **Step 1:** Create `shared/types/strategy-pov.ts`:

```ts
/** The drafted point of view. Resolved = operator override fields ∪ AI draft fields. */
export interface StrategyPov {
  situation: string            // narrated status (admin variant carries dateline; client variant evergreen)
  leadMoveRecId: string | null // the #1 backing rec the lead sentence refers to
  leadSentence: string
  wins: string[]
  flags: string[]
  version: number              // bumps on operator edit; cache busts on change
  generatedAt: string
  editedAt: string | null
}
export interface StrategyPovAIOutput {            // what the model returns (no version/timestamps)
  situation: string; leadSentence: string; wins: string[]; flags: string[]
}
```

- [ ] **Step 2:** `server/ai-operation-registry.ts` — clone the `'meeting-brief'` entry as `'strategy-pov'` (`outputMode: 'json'`, `researchMode: 'forbidden'`, `executionMode: 'sync-only'`, model `gpt-5.4`, temp 0.3).
- [ ] **Step 3:** `server/ws-events.ts` — add `STRATEGY_POV_GENERATED: 'strategy:pov:generated'` to `WS_EVENTS`.
- [ ] **Step 4:** `src/lib/queryKeys.ts` — add `admin.strategyPov(workspaceId)`, `client.theIssue(workspaceId)`, `client.recResponses(workspaceId)`.
- [ ] **Step 5: typecheck + commit** — `git commit -m "feat(the-issue): StrategyPov type + strategy-pov op + WS event + query keys (P0)"`

### Task 0.7: `ContentGapAudience += 'issue'`

**Files:**
- Modify: `src/components/shared/ContentGapRow.tsx` (`ContentGapAudience` union + the per-audience CHROME/copy map)

- [ ] **Step 1:** add `'issue'` to the union and a CHROME entry (no `$`/pricing copy; "Act on this" / "See the details"). Read the existing `'strategy-tab'` entry as the template.
- [ ] **Step 2: typecheck** (exhaustive switch will force the new case) + a render test mounting `ContentGapRow` with `audience="issue"` showing no price.
- [ ] **Step 3: Commit** — `git commit -m "feat(the-issue): ContentGapRow 'issue' audience (P0)"`

### Task 0.8: Phase 0 PR

- [ ] Full local gates (`typecheck`, `vite build`, `vitest run`, `pr-check`, `verify:feature-flags`, `verify:coverage-ratchet`).
- [ ] `scaled-code-review` on the Phase 0 diff; fix Critical/Important.
- [ ] Push `the-issue/phase-0-contracts` → PR into `staging` → wait for CI green → merge.

---

# PHASE 1 — Admin Issue cockpit (one PR; 5 concurrent lanes + single-owner integration)

> Branch `the-issue/phase-1-cockpit` off updated `staging`. Lanes own exclusive files (audit §5). The orchestrator edit in `KeywordStrategy.tsx` is the integration step — never parallelized. Controller commits per lane; subagents never run git.

## Lane 1A — Archetype consumer + stance derivation + StanceBar (model: Haiku→Sonnet)

**Files:** Create `src/lib/recArchetypeMap.ts`, `src/lib/recStance.ts`, `src/components/strategy/issue/StanceBar.tsx`. Test: `tests/unit/rec-stance.test.ts`.

- [ ] **Step 1: Failing test for stance derivation**

```ts
import { deriveStance } from '../../src/lib/recStance'
it('counts archetypes + cut/parked from the active+lifecycle set', () => {
  const recs = [
    { type:'content', lifecycle:'active', clientStatus:'system' },
    { type:'content_refresh', lifecycle:'active', clientStatus:'system' },
    { type:'cannibalization', lifecycle:'throttled', clientStatus:'system' },
    { type:'schema', lifecycle:'struck', clientStatus:'system' },
  ] as any
  const s = deriveStance(recs)
  expect(s.byArchetype.authority_bet).toBe(1)
  expect(s.byArchetype.refresh_reclaim).toBe(1)
  expect(s.parked).toBe(1)
  expect(s.cut).toBe(1)
})
```

- [ ] **Step 2: FAIL.**
- [ ] **Step 3:** `recArchetypeMap.ts` re-exports `REC_TYPE_ARCHETYPE`/labels/order from the shared type + `recArchetype(type)` helper. `recStance.ts` `deriveStance(recs)` → `{ byArchetype: Record<Archetype,number>, cut: number, parked: number, createRefreshDefend: {create,refresh,defend} }` (active counts by archetype; `cut` = `lifecycle==='struck'`; `parked` = `'throttled'`; create/refresh/defend via `ARCHETYPE_HEADLINE_VERB`).
- [ ] **Step 4: PASS.**
- [ ] **Step 5:** `StanceBar.tsx` — proportional segmented bar (per-archetype accent fills from tokens; legend with counts; cut/parked as a muted trailing note). Tokens only, `.t-caption-sm` labels (add `--brand-text-muted`). Render test asserts segment count == archetypes with >0.
- [ ] **Step 6: Commit** — `git commit -m "feat(the-issue): archetype consumer + stance derivation + StanceBar (P1-1A)"`

## Lane 1B — strategy-POV engine + store + routes (model: Sonnet; sequential internal: schema→store+migration→generator→route)

**Files:** Create `server/db/migrations/141-strategy-pov.sql`, `server/strategy-pov-store.ts`, `server/schemas/strategy-pov-schemas.ts`, `server/strategy-pov-generator.ts`, `server/routes/strategy-pov.ts`. Tests: `tests/unit/strategy-pov-hash.test.ts`, `tests/integration/strategy-pov-routes.test.ts`.

- [ ] **Step 1: Migration + store (lockstep)** — `141-strategy-pov.sql`: `strategy_pov (workspace_id TEXT PRIMARY KEY, pov_json TEXT, prompt_hash TEXT, version INTEGER, generated_at TEXT, edited_at TEXT)`. Store mirrors `meeting-brief-store.ts` (`createStmtCache`, `rowToPov` via `parseJsonSafe(strategyPovSchema)`, ON CONFLICT upsert; `getStrategyPovHash`, `saveStrategyPov`, `bumpStrategyPovVersion`).
- [ ] **Step 2: Zod schema** in `strategy-pov-schemas.ts` matching `StrategyPov` (all fields; `leadMoveRecId` nullable). Cross-reference field names against `shared/types/strategy-pov.ts`.
- [ ] **Step 3: Failing hash-completeness unit test** — `buildStrategyPovHash` must change when ANY of: curated rec id-set, each curated rec's `clientStatus`, each `lifecycle`, the prose-edit version, or a regenerate nonce changes. Assert a flip in each dimension changes the hash; identical inputs = identical hash.
- [ ] **Step 4: Generator** `strategy-pov-generator.ts` — `generateStrategyPov(workspaceId, { variant: 'admin'|'client' })`: read slices via `buildWorkspaceIntelligence` (reuse `BRIEF_SLICES`), build the curated set via `loadRecommendations` filtered by `isCuratedForClient` (NOT `topRecommendationId`), call `buildStrategyPovPrompt` (clone `buildBriefPrompt`, re-pointed at the curated set; two variants — admin keeps dateline, client evergreen), `callAI({ operation: 'strategy-pov' })` with `StrategyPovAIOutput` Zod validation + retry-on-bad-JSON (clone meeting-brief). Hash-cache: throw `POV_UNCHANGED` when `buildStrategyPovHash === getStrategyPovHash`.
- [ ] **Step 5: Routes** `routes/strategy-pov.ts` (`requireWorkspaceAccess`, admin): `GET /:ws` (resolved POV: override fields ∪ draft), `POST /:ws/generate` (catch `POV_UNCHANGED` → 200 cached, clone meeting-brief route), `PATCH /:ws` (operator edit → `bumpStrategyPovVersion`, broadcast `STRATEGY_POV_GENERATED` + `invalidateIntelligenceCache`), `POST /:ws/regenerate` (force). Mount the router in `server/app.ts` beside the meeting-brief route.
- [ ] **Step 6: Integration test** — generate → GET returns POV; PATCH a field → GET returns the edited value (override beats draft) + version bumped; second generate with no change → `POV_UNCHANGED`/200.
- [ ] **Step 7: Commits** (per sub-step) ending `git commit -m "feat(the-issue): strategy-POV engine + store + routes (P1-1B)"`

## Lane 1C — DraftedPovEditor + useStrategyPov (model: Opus — the signature interaction)

**Files:** Create `src/components/strategy/issue/DraftedPovEditor.tsx`, `src/hooks/admin/useStrategyPov.ts`. Test: `tests/component/drafted-pov-editor.test.tsx`.

- [ ] **Step 1:** `useStrategyPov(workspaceId)` — React Query: `useQuery` GET, `useMutation` PATCH (optimistic) + regenerate; query key `queryKeys.admin.strategyPov`; `useWorkspaceEvents` invalidates on `STRATEGY_POV_GENERATED`.
- [ ] **Step 2: Failing component test** — render `DraftedPovEditor` with a POV whose `leadSentence` references rec `r1`; simulate the queue's `onCut('r1')`; assert the lead sentence is removed/struck from the rendered prose (the cut→sentence-removal contract).
- [ ] **Step 3: Implement** — editable prose (situation / lead sentence / wins / flags), inline edit (contentEditable or textarea-on-click) → debounced PATCH. Each sentence carries its originating rec id (the §4 P0 cut→sentence contract); expose an imperative/prop `struckRecIds` so a cut backing card removes its sentence live. Tokens + `.t-*`; no new tokens. This is a NEW component (no editable-prose primitive exists — audit §7).
- [ ] **Step 4: PASS** + a real loading→loaded transition test (Rules-of-Hooks; flag read unconditional before early returns).
- [ ] **Step 5: Commit** — `git commit -m "feat(the-issue): DraftedPovEditor + useStrategyPov (P1-1C)"`

## Lane 1D — BackingMovesQueue (model: Sonnet)

**Files:** Create `src/components/strategy/issue/BackingMovesQueue.tsx`; Modify `src/components/strategy/StrategyCockpit.tsx` (ADDITIVE props `groupBy?: 'archetype'`, `shortlistCap?: number` — default off = byte-identical). Test: `tests/component/backing-moves-queue.test.tsx` + flag-OFF snapshot.

- [ ] **Step 1: Failing test** — `StrategyCockpit` with no new props renders byte-identically to today (snapshot); with `groupBy="archetype"` it renders archetype group headers in `ARCHETYPE_ORDER` and caps each group at `shortlistCap` with a "show the rest" affordance.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — `BackingMovesQueue` wraps `StrategyCockpit`'s row model (`cockpitRowModel.ts`), grouping by `recArchetype`, shortlisting per group, reusing `CockpitRow` + the existing keep/cut/park/send verbs (`useRecommendationLifecycle`/`useRecBulkMutation`) and `CurationBulkActionBar` verbatim. Wire `onCut(recId)` to bubble to the POV editor (Lane 1C contract). Add only additive props to `StrategyCockpit`.
- [ ] **Step 4: PASS** + flag-OFF parity snapshot unchanged.
- [ ] **Step 5: Commit** — `git commit -m "feat(the-issue): BackingMovesQueue archetype grouping + cap (P1-1D)"`

## Lane 1E — Cannibalization keeper-override (model: Sonnet)

**Files:** Create `server/db/migrations/142-cannibalization-keeper-override.sql`, `server/cannibalization-keeper-override.ts`, route block in `server/routes/recommendations.ts` (this file is the Phase-2 hotspot — for Phase 1 add ONLY the keeper-override block, clearly fenced), `src/hooks/admin/useKeeperOverride.ts`, `src/components/strategy/issue/KeeperSelector.tsx`. Tests: `tests/integration/keeper-override.test.ts`.

- [ ] **Step 1: Failing integration test** — set a keeper override for a `cannibalizationUrlSetKey`; run a `generateRecommendations` regen (which delete-reinserts `cannibalization_issues`); assert the override SURVIVES and overrides `keeperPathOf` at read.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Store** — `142-*.sql`: `cannibalization_keeper_override (workspace_id TEXT, url_set_key TEXT, keeper_path TEXT, created_at TEXT, PRIMARY KEY (workspace_id, url_set_key))` — keyed on the order-independent `cannibalizationUrlSetKey`, NOT on the clobbered `cannibalization_issues` row. `server/cannibalization-keeper-override.ts` (`createStmtCache`): `getKeeperOverride`, `setKeeperOverride`, `clearKeeperOverride` (all `workspace_id`-scoped).
- [ ] **Step 4: Endpoint + read merge** — `PATCH /api/recommendations/:ws/cannibalization/:urlSetKey/keeper` (`requireWorkspaceAccess`, body `{ keeperPath }` validated, `addActivity`, `broadcastToWorkspace`); merge override at the render/read boundary so `keeperPathOf` is the fallback when no override exists.
- [ ] **Step 5: Frontend** — `useKeeperOverride` (mutation + `useWorkspaceEvents` invalidate); `KeeperSelector.tsx` — radio/segmented page picker (page path + position + impressions; selected = keeper) feeding into `CannibalizationTriage`'s card. NEW component (audit §7).
- [ ] **Step 6: PASS** (incl. the regen-survival test).
- [ ] **Step 7: Commit** — `git commit -m "feat(the-issue): cannibalization operator keeper-override (P1-1E)"`

## Integration (single owner, AFTER 1A–1E land) — model: Opus

**Files:** Modify `src/components/KeywordStrategy.tsx` (third composed branch), Create `src/components/strategy/issue/IssueHeader.tsx`. Test: `tests/component/the-issue-flag-parity.test.tsx`.

- [ ] **Step 1: Failing parity test** — with `strategy-the-issue` OFF, the Overview render is byte-identical to the command-center layout (mirror the parity approach from commit `a6ca7b5ae`). With ON, the cockpit renders: `IssueHeader` (config chrome + Preview-as-client toggle + Send-issue) → `StanceBar` → `DraftedPovEditor` → `BackingMovesQueue` (archetype) → existing supporting surfaces (`OrientZone`, competitor/keywords/content, `NeedsAttentionStrip`).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — add `const theIssueEnabled = commandCenterEnabled && useFeatureFlag('strategy-the-issue')` (read unconditionally, top of component, before early returns — Rules-of-Hooks). Add the third branch that composes the issue elements; leave the existing flag-ON/OFF branches untouched. `IssueHeader.tsx` reuses `PageHeader` + `Toggle` + the existing `StrategyConfigPanel` mounted as page chrome (resolves walkthrough [1]) + the existing "Send issue" via the atomic bulk route.
- [ ] **Step 4: PASS** — parity OFF, full cockpit ON.
- [ ] **Step 5: Commit** — `git commit -m "feat(the-issue): mount Issue cockpit behind flag in orchestrator (P1-integration)"`

## Lane 1F — Prevention (model: Sonnet; single owner of `pr-check.ts`)

**Files:** Modify `scripts/pr-check.ts` (CHECKS) + `npm run rules:generate`. Tests as listed.

- [ ] Add pr-check rules from audit §8 that apply to Phase 1: archetype-map exhaustiveness customCheck; (the client/loop rules land in Phase 2). Run `npm run rules:generate` (single owner; CI fails on drift).
- [ ] Add the contract test `strategy-archetype-exhaustiveness` (already in 0.2) to coverage; add the flag-OFF byte-identical guard test.
- [ ] **Commit** — `git commit -m "chore(the-issue): pr-check archetype exhaustiveness + parity guard (P1-1F)"`

## Phase 1 PR

- [ ] Diff-review the full batch; grep for duplicate logic across lanes; full `npx vitest run` (NEVER two concurrently — deterministic-port EADDRINUSE); `typecheck`, `vite build`, `pr-check`, `verify:feature-flags`, `verify:coverage-ratchet`.
- [ ] **Real-browser DOM probe** of the cockpit (flag ON) — the design-system batch needs the 5th verification layer (collapsed-grid/undefined-token regressions pass typecheck+build+pr-check).
- [ ] `scaled-code-review` (multi-agent, fixture-masked-bug lens) on the Phase 1 diff; fix all Critical/Important.
- [ ] Push `the-issue/phase-1-cockpit` → PR into `staging` → CI green → merge. Verify on staging. Surface before any `staging → main`.

---

## Self-review (run before execution)

- **Spec coverage (Phase 0/1 portion):** flag ✓ (0.1); archetype/stance/StanceBar ✓ (0.2,1A); drafted POV editable + cut→sentence ✓ (0.6,1B,1C); backing-moves keep/cut/park/send + cap ✓ (1D); keeper-override ✓ (1E); config-as-chrome + preview + send-issue ✓ (integration); byte-identical OFF ✓ (integration,1F). Client surface, loop closure, pushed cron, lenses, competitor page → later phases (out of this plan, by design).
- **Placeholders:** none — every net-new logic step shows code or a precise template citation (file:line in the audit); clone-pattern steps name the exact template.
- **Type consistency:** `REC_TYPE_ARCHETYPE`/`Archetype`/`ARCHETYPE_ORDER` (0.2) consumed by `recStance` (1A) + `BackingMovesQueue` (1D); `StrategyPov`/`StrategyPovAIOutput` (0.6) used by store/generator/routes/hook (1B,1C); `isCuratedForClient` (0.3) used by the generator (1B); `strategy-pov` op (0.6) used by the generator (1B). Migration numbers 140 (content-request) then 141 (pov) then 142 (keeper) — confirm next-free at write time.
- **Parallelization safety:** every cross-lane symbol is frozen in Phase 0; `routes/recommendations.ts` touched in P1 only by Lane 1E (fenced block) and is the single-owner hotspot reserved for Phase 2's loop work.
