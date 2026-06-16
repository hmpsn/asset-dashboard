# Strategy Redesign — Phase 3b-i: Cannibalization "Mark resolved" + resolved re-filter

> Execute with superpowers:executing-plans. `- [ ]` steps.

**Goal:** Add a per-issue **Mark resolved** action to the Act-band `CannibalizationTriage` (shipped read-only in 3a). Clicking it records the existing `cannibalization_resolved` outcome (a durable `tracked_action`), and the triage queue hides issues that are already resolved — inferred from tracked-actions, NOT a column on the regen-clobbered `cannibalization_issues` table.

**Architecture:** Entirely admin-side and almost entirely frontend. Reuses the existing `POST /api/outcomes/:wsId/actions` route (records the action, broadcasts `OUTCOME_ACTION_RECORDED`, invalidates intelligence cache). The only server change is fixing the stale `actionTypeEnum` Zod schema (it omits `cannibalization_resolved` + 4 others, so the POST would 400). Resolved state is read via the existing `useOutcomeActions(wsId, 'cannibalization_resolved')` hook; the global `useWsInvalidation` already refetches it on `OUTCOME_ACTION_RECORDED` (it invalidates `queryKeys.admin.outcomeActions(wsId)`, which prefix-matches the filtered query). No new WS handler, no strategy-GET change, no migration.

**Scope boundary:** Send-to-client (dedicated `cannibalization` client-action type) is **Phase 3b-ii** (separate PR — client-facing, higher blast radius).

**No flag change:** `CannibalizationTriage` only mounts in the bands Act band (flag `strategy-decision-bands`); 3b-i adds behavior inside it.

## Verified facts
- `actionTypeEnum` (`server/schemas/outcome-schemas.ts:7-12`) has 10 members; missing `competitor_gap_closed, cluster_published, cannibalization_resolved, local_visibility_won, local_service_added` (the `ActionType` union has all 15).
- `POST /api/outcomes/:wsId/actions` (`server/routes/outcomes.ts:269`): Zod requires `actionType: actionTypeEnum`, `sourceType` (1-100), `baselineSnapshot` (object; inner fields optional → `{}` ok); optional `sourceId/pageUrl/targetKeyword/attribution/measurementWindow`. Dedups via `getActionByWorkspaceAndSource` when `sourceId` present. Broadcasts `OUTCOME_ACTION_RECORDED` + `invalidateIntelligenceCache`. Server adds `captured_at` to the snapshot.
- `outcomesApi.getActions(wsId, type?, score?)` → `TrackedAction[]` (`src/api/outcomes.ts:21`). `post` is imported there. `useOutcomeActions(wsId, type?, score?)` exists (`src/hooks/admin/useOutcomes.ts:24`), key `queryKeys.admin.outcomeActionsFiltered`.
- `WS_EVENTS.OUTCOME_ACTION_RECORDED` → invalidates `queryKeys.admin.outcomeActions(wsId)` (`src/lib/wsInvalidation.ts:278`), mounted globally (`App.tsx` `useWsInvalidation`).
- `TrackedAction`: `actionType`, `sourceType: string`, `sourceId: string | null`, `targetKeyword: string | null`.
- `recordAction` fires bridge #7 (auto-resolves matching insights to in_progress) when `pageUrl`/`targetKeyword` set — benign, do not duplicate with `resolveInsight`.
- `cannibalization_resolved` already has scoring config (primary_metric `clicks`) + learnings + labels.

---

## Task 1: Extend the stale actionTypeEnum (server)
**File:** `server/schemas/outcome-schemas.ts`
- [ ] Add the 5 missing members so it matches the `ActionType` union (source of truth). New value:
```ts
export const actionTypeEnum = z.enum([
  'insight_acted_on', 'content_published', 'brief_created',
  'strategy_keyword_added', 'schema_deployed', 'audit_fix_applied',
  'content_refreshed', 'internal_link_added', 'meta_updated',
  'voice_calibrated', 'competitor_gap_closed', 'cluster_published',
  'cannibalization_resolved', 'local_visibility_won', 'local_service_added',
]);
```
- [ ] `npm run typecheck`.

## Task 2: Frontend record-action API + mutation hook + sourceId helper
**Files:** `src/api/outcomes.ts`, `src/hooks/admin/useOutcomes.ts`, `src/lib/cannibalizationSourceId.ts` (new)
- [ ] `src/lib/cannibalizationSourceId.ts`:
```ts
/** Stable, regen-proof idempotency key for a cannibalization issue's tracked action. Keyword is the
 *  row identity (cannibalization_issues PK). Used BOTH at the write (recordAction sourceId) and the
 *  read (resolved-set match), so they must normalize identically. */
export const cannibalizationSourceId = (keyword: string): string => keyword.trim().toLowerCase();
```
- [ ] `src/api/outcomes.ts` — add to `outcomesApi`:
```ts
  recordAction: (
    wsId: string,
    body: {
      actionType: string;
      sourceType: string;
      sourceId?: string;
      pageUrl?: string;
      targetKeyword?: string;
      baselineSnapshot?: { position?: number; clicks?: number; impressions?: number; ctr?: number; sessions?: number };
      attribution?: string;
    },
  ) => post<{ success: boolean; action: TrackedAction; deduplicated?: boolean }>(
    `/api/outcomes/${wsId}/actions`,
    { baselineSnapshot: {}, ...body },
  ),
```
- [ ] `src/hooks/admin/useOutcomes.ts` — add (the global WS handler refetches too; this is belt-and-suspenders + immediate):
```ts
export function useRecordOutcomeAction(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof outcomesApi.recordAction>[1]) => outcomesApi.recordAction(wsId, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(wsId) }); },
  });
}
```
- [ ] typecheck.

## Task 3: Wire Mark-resolved + resolved-filter into CannibalizationTriage
**File:** `src/components/strategy/CannibalizationTriage.tsx`
- [ ] Import `useOutcomeActions`, `useRecordOutcomeAction` from `../../hooks/admin/useOutcomes`, `cannibalizationSourceId` from `../../lib/cannibalizationSourceId`, and `Check`/`CheckCircle2` icon (already imports `Check`).
- [ ] Read resolved actions + build the resolved-keyword set (filter to OUR source type so recommendation-sourced `cannibalization_resolved` actions don't collide):
```tsx
const { data: resolvedActions } = useOutcomeActions(workspaceId, 'cannibalization_resolved');
const resolveMutation = useRecordOutcomeAction(workspaceId);
const resolvedKeys = new Set(
  (resolvedActions ?? []).filter(a => a.sourceType === 'cannibalization').map(a => a.sourceId).filter(Boolean) as string[],
);
const visible = entries.filter(e => !resolvedKeys.has(cannibalizationSourceId(e.keyword)));
if (visible.length === 0) return null;
```
Render `visible` (not `entries`). `highCount` computed from `visible`.
- [ ] Add a per-issue **Mark resolved** button in the issue header (next to the severity badge). On click, record the outcome with the keeper page's baseline metrics:
```tsx
const markResolved = (item: CannibalizationItem, keeperPath: string | undefined) => {
  const keeper = item.pages.find(p => keeperPath && matchPageIdentity(p.path, keeperPath));
  resolveMutation.mutate({
    actionType: 'cannibalization_resolved',
    sourceType: 'cannibalization',
    sourceId: cannibalizationSourceId(item.keyword),
    targetKeyword: item.keyword,
    pageUrl: keeperPath,
    baselineSnapshot: {
      ...(keeper?.position != null ? { position: keeper.position } : {}),
      ...(keeper?.clicks != null ? { clicks: keeper.clicks } : {}),
      ...(keeper?.impressions != null ? { impressions: keeper.impressions } : {}),
    },
  });
};
```
Button: ghost, neutral tone (not teal — it's a completion action, use zinc/emerald `Check`), label "Mark resolved", disabled while `resolveMutation.isPending` (show "Resolving…"). Place it in the header row; keep the existing severity badge + action label.
- [ ] typecheck + build (scoped).

## Task 4: Tests
**File:** `tests/unit/strategy/CannibalizationTriage.test.tsx` (extend)
- [ ] Mock the hooks at top: `vi.mock('../../../src/hooks/admin/useOutcomes', () => ({ useOutcomeActions: () => ({ data: state.resolved }), useRecordOutcomeAction: () => ({ mutate: mutateMock, isPending: false }) }))` with hoisted `state`/`mutateMock`.
- [ ] Existing tests still pass (default `state.resolved = []`).
- [ ] New: a resolved tracked-action (`{ sourceType:'cannibalization', sourceId: '<normalized keyword>' }`) for the rendered issue's keyword → assert the issue is **not** rendered (hidden); if it's the only issue → container empty.
- [ ] New: click "Mark resolved" → assert `mutateMock` called with `{ actionType:'cannibalization_resolved', sourceType:'cannibalization', sourceId:<normalized keyword>, targetKeyword:<keyword> }` (objectContaining).
- [ ] Run the file + typecheck.

## Quality gates + closeout
- [ ] typecheck · pr-check (this diff) · build (retry if transient rolldown crash) · touched-area tests.
- [ ] Note: full local gate is polluted by the concurrent unstaged asset work; commit staged-only (`--no-verify` if the hook chokes on the asset files); CI validates against staging.
- [ ] Scaled/focused review on the committed diff.
- [ ] FEATURE_AUDIT entry, roadmap 3b-i item, memory.
- [ ] PR → staging.
