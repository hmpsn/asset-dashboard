# D1 — Admin Recommendations Surface (audit #19)

> **Lane D — Wave 2 (after E2 merged)**
> Branch: `claude/core-d1-admin-recs-surface`
> Dependencies: E2 merged (InsightsEngine file ownership handoff)

---

## Problem statement

`WorkspaceHome.tsx` borrowed the client-facing `InsightsEngine` component with `tier="premium"` hardcoded (`:628`). This gave admins a filtered, tier-gated, EMV-stripped view intended for the client portal. Admins should see:

1. Full rec queue (all statuses, including dismissed)
2. Un-dismiss action (dismissed → pending backward transition)
3. Full OV breakdown per rec including `emvPerWeek` (admin-only)
4. Activity log entries on client PATCH/DELETE (admin was previously blind to client triage)

---

## Contracts

- `GET /api/recommendations/:workspaceId` — admin-only (HMAC gate), all statuses, full OV data
- `PATCH /api/recommendations/:workspaceId/:recId/undismiss` — transitions `dismissed → pending` via `validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, rec.status, 'pending')`, returns the updated rec, broadcasts + logs activity
- Activity types: `rec_status_updated` (client PATCH + admin un-dismiss), `rec_dismissed` (client DELETE)
- Query key: `queryKeys.admin.recommendations(wsId)` — separate from `queryKeys.shared.recommendations` to avoid stripping EMV

---

## Files owned

- `src/components/admin/AdminRecommendationQueue.tsx` (new)
- `src/hooks/admin/useAdminRecommendations.ts` (new)
- `src/components/WorkspaceHome.tsx` (mount swap only — replaces `InsightsEngine`/`CartProvider` with `AdminRecommendationQueue`)
- `server/routes/recommendations.ts` (addActivity on PATCH/DELETE + admin GET + undismiss PATCH)
- `server/activity-log.ts` (ActivityType additions: `rec_status_updated`, `rec_dismissed`)
- `src/lib/queryKeys.ts` (admin.recommendations key)
- `src/lib/wsInvalidation.ts` (RECOMMENDATIONS_UPDATED → invalidates admin key)
- `tests/integration/admin-recommendations-surface.test.ts` (new)

**Reads (not modified):** `server/recommendations.ts` (engine), `server/state-machines.ts` (RECOMMENDATION_TRANSITIONS already has `dismissed → pending`)

---

## State machine

`RECOMMENDATION_TRANSITIONS` (`server/state-machines.ts:100`) already contains:
```
dismissed: ['pending'],   // un-dismiss
```
No new transitions needed. The `validateTransition` call throws `InvalidTransitionError` for any illegal transition (e.g. `pending → pending`), which the un-dismiss route translates to HTTP 400.

---

## Test coverage (5 assertions)

| ID | Assertion |
|----|-----------|
| D1(a) | Client PATCH pending→in_progress writes `rec_status_updated` activity row with rec title |
| D1(b) | Client DELETE writes `rec_dismissed` activity row with rec title |
| D1(c) | Admin GET returns all statuses including dismissed; `?status=dismissed` filter works; unknown workspace → 404 |
| D1(d) | Admin PATCH undismiss (dismissed→pending) returns updated rec with `status: 'pending'`, broadcasts RECOMMENDATIONS_UPDATED, writes activity |
| D1(e) | Admin PATCH undismiss on non-dismissed rec returns 400 with `InvalidTransitionError` message |

---

## Component spec

**`AdminRecommendationQueue`** (SectionCard, noPadding):
- TabBar: `active` (pending + in_progress + completed) / `dismissed`
- Active tab: recs grouped by priority (fix_now/fix_soon/fix_later/ongoing), sorted by OV desc within group
- Each `RecRow`: expand/collapse chevron → shows description, affected pages, traffic metrics, OV breakdown bars, EMV/wk + confidence (admin-only)
- Dismissed tab: sorted most-recently-dismissed first; each row shows Un-dismiss button
- Loading: 3 `<Skeleton>` stubs
- Empty: `<EmptyState>` with `CheckCircle` icon

**Color compliance:**
- Priority badges: red (fix_now), amber (fix_soon), blue (fix_later), zinc (ongoing)
- Status badges: zinc (pending), teal (in_progress), emerald (completed)
- Data metrics (traffic/impressions): blue-400 (data law)
- EMV: `scoreColorClass(impactScore)` (score law)
- No purple, no green-400

---

## Verification commands

```
npm run typecheck
npx vite build
npx vitest run tests/integration/admin-recommendations-surface.test.ts
npx vitest run
npm run pr-check
grep -r "purple-" src/components/admin/AdminRecommendationQueue.tsx
```

---

## Salvage assessment

Prior agent left 8 dirty files across 3 categories:
- **KEEP as-is:** `server/activity-log.ts` (two new ActivityTypes), `src/lib/queryKeys.ts` (admin.recommendations key), `src/lib/wsInvalidation.ts` (RECOMMENDATIONS_UPDATED → admin key invalidation) — all correct, minimal, pattern-consistent
- **KEEP as-is:** `server/routes/recommendations.ts` — activity calls on PATCH/DELETE, admin GET, undismiss PATCH — all correct; uses `validateTransition` properly
- **KEEP as-is:** `src/components/WorkspaceHome.tsx` — clean swap: removes `InsightsEngine`/`CartProvider`, mounts `AdminRecommendationQueue` in `ErrorBoundary`
- **KEEP as-is:** `src/components/admin/AdminRecommendationQueue.tsx` — full implementation using SectionCard/TabBar/Badge/EmptyState/Skeleton/ClickableRow/Button/Icon
- **KEEP as-is:** `src/hooks/admin/useAdminRecommendations.ts` — `useAdminRecommendationSet` + `useAdminUndismissRecommendation` with proper cache invalidation
- **KEEP as-is:** `tests/integration/admin-recommendations-surface.test.ts` — covers all 5 assertions (a)–(e); uses ephemeral server pattern; proper cleanup

No files discarded. The prior agent's work is complete and correct.
