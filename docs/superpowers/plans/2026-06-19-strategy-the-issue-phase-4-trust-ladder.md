# The Issue — Phase 4: Trust Ladder Implementation Plan

> **For agentic workers:** parallel-lane build. Pre-committed shared contracts → 3 exclusive-ownership lanes (server / frontend / tests) → controller integration → full gate → scaled adversarial review.

**Goal:** Per-archetype auto-send for the two low-risk recommendation buckets (`quick_win`, `technical`), unlocked only after the operator manually greenlights that bucket for N=3 consecutive weekly cycles. Builds on Phase 3's weekly cron.

**Spec:** `docs/superpowers/specs/2026-06-19-strategy-the-issue-design.md` §10 (trust ladder), §12 phase 4. Locked.

**Flag:** `strategy-the-issue` (existing). Flag-OFF byte-identical; the credit/auto-send paths are no-ops when the flag is off for the workspace.

---

## Locked design decisions

1. **Eligible archetypes (auto-send-capable):** `quick_win` and `technical` ONLY — the two non-monetizable, low-risk buckets (REC_POLICY_REGISTRY `monetizable:false`, no cascade complexity, `sendChannel:'rec'`). The money + judgment-heavy buckets (`authority_bet`/content, `refresh_reclaim`, `defend`/cannibalization, `local`) are NEVER auto-send — the operator always gates them. Enforced server-side: a PATCH enabling a policy for any other archetype is a 400.

2. **Trust threshold N = 3 consecutive ISO-week cycles.** A cycle "counts" for an archetype when, during that ISO week (cron's `currentWeekOfUTC`), a rec of that archetype is **sent** (manual OR auto — see streak rule). 3 consecutive counted cycles → the archetype is **earned**.

3. **Streak rule (latched-once-earned):** `consecutiveCycles` is credited at most once per ISO week per (workspace, archetype) on any send.
   - Same week as `lastCreditedWeek` → no-op (idempotent within a week).
   - `thisWeek` is exactly the ISO week after `lastCreditedWeek` (contiguous) → increment.
   - Non-contiguous (a full week was skipped) or first-ever:
     - if `consecutiveCycles >= THRESHOLD` (already **earned**) → still increment (latched — earned trust persists through quiet weeks).
     - else (still building) → reset to 1.
   - Rationale: earning auto-send requires 3 genuinely back-to-back weeks; once earned, a quiet week (nothing to send) does not revoke trust.

4. **Toggle = the reward for earned trust.** Operator can enable a policy only once its archetype is earned (`consecutiveCycles >= 3`). UI disables the toggle until earned and shows progress ("2 / 3 cycles — unlocks next cycle"). Server also rejects `enabled:true` for a not-yet-earned archetype (defence in depth).

5. **Auto-send execution (immediate, recall-based review window):** the weekly cron, after pushing the Issue (Phase 3) and stamping the week, auto-sends the **active** recs (`isActiveRec`) of every **enabled + earned + eligible** archetype via the existing single-writer `sendRecommendation` + `mirrorRecommendationToDeliverable` (identical path to a manual send). Each auto-sent rec is marked `autoSent: true`. The operator is notified (doorbell) and can **recall** any auto-sent move by striking it (a struck rec leaves the client's curated projection — `isCuratedForClient` excludes struck). The recall affordance + the weekly review IS the v1 "review window"; a deferred-staging hold is explicitly out of scope for Phase 4.

6. **Cycle credit chokepoint:** credit happens inside the single-writer `sendRecommendation` (covers every send — manual and auto — in one place; the per-week dedup absorbs multiplicity). The credit helper is flag-guarded internally so it is a complete no-op when `strategy-the-issue` is off for the workspace. Only eligible archetypes (`quick_win`/`technical`) produce a row; all others are ignored.

7. **Doorbell:** the cron writes an operator-only `strategy_autosent` activity entry. The overview `issue` block gains `autoSent: { weekOf, count }` derived from `recs.filter(r => r.autoSent && weekOf(r.sentAt) === thisWeek)`. `useNotifications` shows "N moves auto-sent this cycle — review" when `count > 0 && weekOf === currentWeek`; it clears next week naturally (mirror of the Phase 3 doorbell).

---

## Shared contracts (PRE-COMMIT before lanes — controller owns)

- **Migration `144-strategy-autosend-policy.sql`** — new table:
  ```sql
  CREATE TABLE IF NOT EXISTS strategy_autosend_policy (
    workspace_id        TEXT NOT NULL,
    archetype           TEXT NOT NULL,
    enabled             INTEGER NOT NULL DEFAULT 0,
    consecutive_cycles  INTEGER NOT NULL DEFAULT 0,
    last_credited_week  TEXT,
    updated_at          TEXT NOT NULL,
    PRIMARY KEY (workspace_id, archetype),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );
  ```
- **`shared/types/strategy-autosend.ts`** (new):
  ```ts
  import type { Archetype } from './strategy-archetype.js';
  export const AUTOSEND_ELIGIBLE_ARCHETYPES = ['quick_win', 'technical'] as const;
  export type AutoSendEligibleArchetype = typeof AUTOSEND_ELIGIBLE_ARCHETYPES[number];
  export const AUTOSEND_TRUST_THRESHOLD = 3;
  export function isAutoSendEligible(a: Archetype): a is AutoSendEligibleArchetype {
    return (AUTOSEND_ELIGIBLE_ARCHETYPES as readonly string[]).includes(a);
  }
  export interface AutoSendPolicyRow {
    archetype: AutoSendEligibleArchetype;
    enabled: boolean;
    consecutiveCycles: number;
    lastCreditedWeek: string | null;
    earned: boolean;              // consecutiveCycles >= AUTOSEND_TRUST_THRESHOLD
  }
  export interface AutoSendPolicyResponse {
    workspaceId: string;
    threshold: number;            // AUTOSEND_TRUST_THRESHOLD
    policies: AutoSendPolicyRow[]; // exactly the 2 eligible archetypes
  }
  ```
- **`shared/types/recommendations.ts`** — add `autoSent?: boolean;` (JSDoc: "Set true by the trust-ladder cron when this rec was auto-sent (not operator-sent). Carried over on regen; powers the auto-send doorbell + cockpit badge.") next to `sentAt`.
- **`server/schemas/workspace-schemas.ts`** — add `autoSent: z.boolean().optional(),` to `recommendationSchema` (lockstep with the type).
- **`server/recommendations.ts` `applyLifecycleCarryOver`** — add `if (oldRec.autoSent !== undefined) newRec.autoSent = oldRec.autoSent;`
- **WS event `STRATEGY_AUTOSEND_POLICY_UPDATED: 'strategy:autosend-policy-updated'`** — add to `server/ws-events.ts` AND `src/lib/wsEvents.ts`. Handled locally by `useAutoSendPolicy` via `useWorkspaceEvents` → list in `LOCAL_ONLY_EVENTS` (ws-invalidation-coverage test) + `KNOWN_UNHANDLED_BROADCASTS` (broadcast-handler-pairs) is NOT needed (it has a frontend consumer) — but add to `CONTEXT_BY_EVENT_KEY` in `scripts/platform-domain-event-definitions.ts` (`'analytics-intelligence'`).
- **`src/lib/queryKeys.ts`** — `admin.autoSendPolicy: (wsId) => ['admin-auto-send-policy', wsId] as const`.

---

## Lane B — Server (exclusive owner: all `server/` non-test files)

**Files:**
- Create `server/strategy-autosend-store.ts` — `createStmtCache`-backed store:
  - `getAutoSendPolicies(workspaceId): AutoSendPolicyRow[]` — returns rows for the 2 eligible archetypes, filling defaults (cycles 0, enabled false) for missing rows.
  - `setAutoSendPolicyEnabled(workspaceId, archetype, enabled): AutoSendPolicyRow` — rejects (throws typed error) if `!isAutoSendEligible(archetype)` or if `enabled && consecutiveCycles < THRESHOLD`. Upserts.
  - `creditArchetypeCycleOnSend(workspaceId, recType): void` — flag-guarded no-op when `!isFeatureEnabled('strategy-the-issue', workspaceId)`; maps recType→archetype; returns early if not eligible; applies the streak rule (§3) in a `db.transaction()`; idempotent within a week. Wrapped so it never throws into the caller.
  - `getEarnedEnabledArchetypes(workspaceId): AutoSendEligibleArchetype[]` — `enabled && consecutiveCycles >= THRESHOLD`.
- Edit `server/recommendation-lifecycle.ts` — in `sendRecommendation`, after the mutation commits, call `creditArchetypeCycleOnSend(workspaceId, rec.type)` (guarded; never throws into the send).
- Edit `server/strategy-issue-cron.ts` — after `markIssuePushedWeek` + doorbell, add `runAutoSendForWorkspace(workspaceId, weekOf)`:
  - for each archetype in `getEarnedEnabledArchetypes`, for each active rec of that archetype: `sendRecommendation` → set `autoSent=true` on the rec (re-save) → `mirrorRecommendationToDeliverable`. Collect count.
  - if count > 0: `addActivity('strategy_autosent', …, { weekOf, count, archetypes })` + `broadcastToWorkspace(RECOMMENDATIONS_UPDATED)`.
  - Idempotent: a rec already `sent` this week is skipped (it is no longer `isActiveRec`). Per-workspace mutex already held by the cron.
- Create `server/routes/auto-send-policy.ts` — `GET /api/auto-send-policy/:workspaceId` (→ `AutoSendPolicyResponse`), `PATCH /api/auto-send-policy/:workspaceId/:archetype` (body `{enabled:boolean}`, validated; on success broadcast `STRATEGY_AUTOSEND_POLICY_UPDATED` + return updated response). `requireWorkspaceAccess`. Literal routes before param routes.
- Create `server/schemas/auto-send-policy-schemas.ts` — Zod for the PATCH body + the archetype param (must be one of the 2 eligible; 400 otherwise).
- Edit `server/app.ts` — register the router.
- Edit `server/activity-log.ts` — add `'strategy_autosent'` activity type (operator-only — NOT in CLIENT_VISIBLE_TYPES).
- Edit `server/routes/workspaces.ts` — add `issue.autoSent: { weekOf, count }` to the overview summary (count from `recs.filter(r => r.autoSent && currentWeekOfUTC(new Date(r.sentAt)) === weekOf)`).

**Set `autoSent`:** the cron path is the ONLY writer of `autoSent=true`. Re-save the rec set after flipping `sendRecommendation` so `autoSent` persists.

## Lane C — Frontend (exclusive owner: all `src/` files + BRAND doc)

**Files:**
- Create `src/hooks/admin/useAutoSendPolicy.ts` — query `admin.autoSendPolicy`, PATCH mutation, `useWorkspaceEvents` handler for `STRATEGY_AUTOSEND_POLICY_UPDATED` (invalidate). Enabled-gated on the flag like `useStrategyPov`.
- Create `src/api/autoSendPolicy.ts` — typed fetch wrappers (`getAutoSendPolicy`, `setAutoSendPolicy`).
- Create `src/components/strategy/issue/TrustLadderPanel.tsx` — a `SectionCard` titled "Trust ladder" listing the 2 eligible archetypes; each row: archetype label + `Toggle` (disabled until `earned`) + progress caption (`{cycles}/{threshold} cycles` or "Auto-sends Quick wins each cycle"). Teal toggle (Law 1). No purple. Evergreen/operator copy. Mount in `KeywordStrategy.tsx` issueOverviewEl (after `BackingMovesQueue`, gated `theIssueEnabled`).
- Edit `src/hooks/admin/useNotifications.ts` — add the auto-send doorbell entry from `ws.issue?.autoSent` (`count > 0`), deep-link `seo-strategy`. Extend the `WorkspaceSummary.issue` interface with `autoSent?: { weekOf?: string|null; count?: number }`.
- Edit `BRAND_DESIGN_LANGUAGE.md` — note the TrustLadderPanel + toggle usage if any new pattern.

## Lane D — Tests (exclusive owner: all `tests/` files)

- `tests/unit/strategy-autosend-store.test.ts` — streak rule (contiguous increment, gap-reset while building, latched-once-earned through a gap, once-per-week idempotency); eligibility enforcement (ineligible archetype rejected; enabling before earned rejected); flag-OFF no-op.
- `tests/integration/strategy-autosend-cron.test.ts` — earned+enabled archetype's active recs get auto-sent (clientStatus→sent, autoSent=true) on push; not-earned or disabled → no auto-send; ineligible archetype never auto-sends; doorbell activity written; recall (strike) removes from curated set.
- `tests/integration/auto-send-policy-routes.test.ts` — GET returns 2 eligible rows; PATCH enable rejected when not earned (400); PATCH ineligible archetype 404/400; PATCH success broadcasts + returns updated.
- `tests/contract/strategy-autosend-eligibility.test.ts` — `AUTOSEND_ELIGIBLE_ARCHETYPES` ⊂ `Archetype`; the 4 excluded archetypes are never eligible; threshold is 3.
- Update `tests/contract/ws-invalidation-coverage.test.ts` LOCAL_ONLY_EVENTS + `tests/integration/broadcast-handler-pairs.test.ts` (if needed) for the new event. (Controller may pre-handle these in the contract pre-commit.)

---

## Acceptance gates (controller, post-integration)

- [ ] `npm run typecheck` clean · `npx vite build` · full `npx vitest run` green · `npx tsx scripts/pr-check.ts` 0 errors · `npm run verify:feature-flags`.
- [ ] Flag-OFF: no autosend table reads on the hot path; overview `issue.autoSent` absent/zero; cockpit byte-identical.
- [ ] Eligible-only enforced at BOTH the store and the route.
- [ ] Streak latch verified (earned survives a quiet week; building streak resets on a gap).
- [ ] Scaled adversarial review (dimensions → validate → synthesize); fix all Critical/Important; re-gate.
- [ ] FEATURE_AUDIT #525 → Phase 0–4; roadmap note; memory boundary update.
