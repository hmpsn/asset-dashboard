# G1 — Lost-Visibility Insight Minting (audit #9)

> Lane G, Wave 1 (PR #G1). Branch: `claude/core-g1-lost-visibility-insight`.
> Master plan: `2026-06-10-core-features-remediation-master.md` §G1.

---

## Problem

The daily lost-visibility detector (`client-discovered-queries.ts:detectLostVisibility` + `rank-tracking-scheduler.ts:77`) marks queries with `status='lost_visibility'` in the `discovered_queries` table. Today this signal feeds only the KCC admin filter chip (`keyword-command-center.ts:1122`). No `lost_visibility` `InsightType` exists, no proactive alert reaches the client, no opportunity_event is minted, and no briefing story candidate is registered.

---

## Scope

1. **Four-part InsightType registration** (CLAUDE.md lockstep rule, one commit):
   - `InsightType` union + `LostVisibilityData` interface + `InsightDataMap` entry → `shared/types/analytics.ts`
   - Zod schema → `server/schemas/insight-schemas.ts` (`lostVisibilityDataSchema` + `INSIGHT_DATA_SCHEMA_MAP` entry)
   - Admin renderer case → `src/hooks/admin/useInsightFeed.ts` (`transformToFeedInsight` switch)
   - Client renderer entry → `src/components/client/InsightsDigest.tsx` (`INSIGHT_TYPE_ICONS`, `INSIGHT_TYPE_ACTIONS`)

2. **Bridge module** (`server/bridge-lost-visibility.ts`):
   - Reads existing `getLostVisibilityCount` + `getLostVisibilityQueries` from `client-discovered-queries.ts`
   - Mints a single workspace-level `lost_visibility` insight via `upsertInsight`
   - Passes `bridgeSource: 'bridge-lost-visibility'`
   - Returns `{ modified: N }` (never manually broadcasts — infrastructure handles it)
   - Mints an `opportunity_event` (type `'rank_drop'`, keyword=null, pagePath=null, boost=35, halfLife=14) via `insertOpportunityEvent`
   - Checks `resolutionStatus !== 'resolved'` before minting (respects resolution)

3. **Signal story registration** (`server/signal-story-registry.ts`):
   - Add `lost_visibility` case to `clientInsightStories` (narrative-framed, outcome-oriented)
   - Add `lost_visibility` projector to `briefingInsightStories`

4. **Briefing template** (`server/briefing-templates/lost-visibility.ts`):
   - `buildStoryFromInsight` projector for `AnalyticsInsight<'lost_visibility'>`
   - Returns null when count < 3 (below materiality floor)
   - Voice: definite tone, cite count, no banned hedges

5. **Scheduler integration** (`server/rank-tracking-scheduler.ts`):
   - After `detectLostVisibility(ws.id, date)`, call `fireBridge('bridge-lost-visibility', ws.id, ...)`

6. **WS event constant** (`server/ws-events.ts`):
   - `INSIGHT_BRIDGE_UPDATED` already exists — the bridge infrastructure broadcasts it automatically. No new constant needed.

7. **Frontend invalidation** (`src/hooks/useWsInvalidation.ts`):
   - Already handles `INSIGHT_BRIDGE_UPDATED` → `insightFeed`, `clientInsights`, `intelligenceAll` via the registry.
   - No change needed (existing coverage confirmed in `wsInvalidation.ts:320-327`).

---

## Contracts (pre-committed by this PR — downstream G2 must include)

```typescript
// shared/types/analytics.ts

export interface LostVisibilityData extends InsightDataBase {
  /** Total queries in lost_visibility status for the workspace */
  lostCount: number;
  /** Top affected queries (up to 5) with last known position */
  topQueries: Array<{
    query: string;
    lastPosition: number | null;
    lastSeen: string;         // ISO date
    totalImpressions: number;
  }>;
  /** ISO date of the detection run */
  detectedAt: string;
}

// InsightDataMap entry:
//   lost_visibility: LostVisibilityData;
```

---

## Data flow

```
rank-tracking-scheduler (daily)
  → detectLostVisibility()         [marks rows in discovered_queries]
  → fireBridge('bridge-lost-visibility', ws.id, callback)
    → getLostVisibilityCount()     [read-only from client-discovered-queries.ts]
    → getLostVisibilityQueries()   [read-only, top-N]
    → getInsight(ws, null, 'lost_visibility')   [check resolution]
    → upsertInsight({ ..., bridgeSource: 'bridge-lost-visibility' })
    → insertOpportunityEvent({ type: 'rank_drop', boost: 35, halfLife: 14 })
    → return { modified: 1 }
  ← bridge-infrastructure auto-broadcasts INSIGHT_BRIDGE_UPDATED
  ← useWsInvalidation handles → invalidates insightFeed + clientInsights
```

---

## Test assertions

### Integration: `tests/integration/lost-visibility-bridge.test.ts`

| Test | Assertion |
|---|---|
| Seeded lost-visibility rows → insight minted | `getInsight(wsId, null, 'lost_visibility')` is defined; `data.lostCount >= 1`; `severity === 'warning'`; `impactScore > 0` |
| Correct data fields | `data.topQueries` array present, each entry has `query`, `lastSeen`, `totalImpressions` |
| Idempotent re-run | Call bridge twice → still only ONE insight row (ON CONFLICT upsert); no new rows |
| Resolution respected | Resolve the insight → re-run bridge → insight remains resolved (upsert does not overwrite `resolution_status`) |
| Opportunity event minted | `listActiveOpportunityEvents(wsId).find(e => e.type === 'rank_drop' && e.source === 'bridge-lost-visibility')` is defined |
| Zero lost-visibility → `modified: 0` | No insight row created when count is 0 |

### Unit: `tests/unit/wsInvalidationRegistry.test.ts` (extension)

| Test | Assertion |
|---|---|
| INSIGHT_BRIDGE_UPDATED admin scope → insightFeed + clientInsights + intelligenceAll | Already covered by existing test at wsInvalidation.ts:320-327 — verified in PR body |

---

## File ownership

**OWNS (modify):**
- `shared/types/analytics.ts`
- `server/schemas/insight-schemas.ts`
- `server/bridge-lost-visibility.ts` (new)
- `server/briefing-templates/lost-visibility.ts` (new)
- `server/signal-story-registry.ts` (add `lost_visibility` entries)
- `server/rank-tracking-scheduler.ts` (add `fireBridge` call)
- `src/hooks/admin/useInsightFeed.ts` (add `lost_visibility` switch case)
- `src/components/client/InsightsDigest.tsx` (add to icon + action maps)
- `server/bridge-infrastructure.ts` (add `'bridge-lost-visibility'` to `BRIDGE_SOURCES`)
- `tests/integration/lost-visibility-bridge.test.ts` (new)

**READS (do NOT modify):**
- `server/client-discovered-queries.ts` — exports used: `getLostVisibilityCount`, `getLostVisibilityQueries`
- `server/rank-tracking-scheduler.ts` — the `detectLostVisibility` call site is context-only
- `server/keyword-command-center.ts` — filter chip is the existing consumer, must not be disturbed

---

## Bridge rules compliance checklist (docs/rules/bridge-authoring.md)

- [x] Pass `bridgeSource: 'bridge-lost-visibility'` to `upsertInsight`
- [x] Use `applyScoreAdjustment()` when adjusting an existing insight's score (re-runs)
- [x] Return `{ modified: N }` — never call `broadcastToWorkspace` directly
- [x] Never call `resolveInsight()` — only check `resolutionStatus !== 'resolved'` before upserting

---

## Severity and impactScore formula

- `severity`: `'warning'` when `lostCount >= 3`, `'opportunity'` when `lostCount >= 1 && < 3`
- `impactScore`: `Math.min(100, 30 + lostCount * 2)` — floor 30, capped at 100
- `domain`: `'search'`

---

## Client framing (no purple, outcome-oriented)

Client story headline: `"${lostCount} search queries dropped off your radar"`
Narrative: `"${lostCount} queries that previously sent visitors to your site are no longer showing impressions. We're reviewing which pages to refresh to recover that visibility."`
Impact: `` `${lostCount} queries with ${totalImpressions.toLocaleString()} combined impressions at risk` ``

---

## Verification commands

```bash
npm run typecheck
npx vite build
npx vitest run tests/integration/lost-visibility-bridge.test.ts
npx vitest run tests/unit/wsInvalidationRegistry.test.ts
npx vitest run
npm run pr-check
npm run verify:feature-flags
grep -r "purple-" src/components/client/   # must be clean
```

---

## Definition of done (client-visible feature class)

- [ ] Four-part registration: type + interface + map + schema + both renderers
- [ ] Bridge mints insight + opportunity_event, idempotent, resolution-safe
- [ ] Briefing story candidate registered (story returns null below materiality floor)
- [ ] `npm run typecheck && npx vite build` green
- [ ] Full test suite green
- [ ] pr-check + feature-flags green
- [ ] No purple in client components
- [ ] Code review (requesting-code-review)
