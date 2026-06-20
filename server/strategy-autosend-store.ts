/**
 * The Issue — Phase 4 trust-ladder store.
 *
 * Per-archetype auto-send policy for the two low-risk recommendation buckets (`quick_win`,
 * `technical`). The operator EARNS auto-send for a bucket by manually greenlighting it for N=3
 * consecutive ISO-week cycles; once earned + enabled, the weekly cron auto-sends that bucket's
 * active recs.
 *
 * One row per (workspace, archetype). Mirrors server/strategy-pov-store.ts: lazy prepared
 * statements via createStmtCache, ON CONFLICT upsert, mappers at the read boundary.
 *
 * Streak rule (§3, latched-once-earned), credited at most once per ISO week per (workspace,
 * archetype) on any send:
 *   - same week as lastCreditedWeek                          → no-op (idempotent within a week)
 *   - thisWeek is exactly the ISO week after lastCreditedWeek → increment (contiguous)
 *   - non-contiguous (a full week skipped) or first-ever:
 *       · already earned (consecutiveCycles >= THRESHOLD)    → still increment (latched)
 *       · still building                                     → reset to 1
 *
 * Eligibility (`quick_win`/`technical` only) is enforced HERE (store) AND at the route — a PATCH
 * enabling any other archetype is rejected. The toggle (`enabled`) is the reward: it can only be
 * set true once the archetype is earned; the store rejects enabling a not-yet-earned archetype.
 *
 * NO module-eval import of ./strategy-issue-cron (the cron imports THIS store for auto-send — a
 * top-level `currentWeekOfUTC` import would create an eval-time cycle). The Monday-anchor math is
 * replicated locally (kept byte-equivalent to currentWeekOfUTC) with a 7-day-add contiguity helper.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { isFeatureEnabled } from './feature-flags.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { recArchetype } from '../shared/types/strategy-archetype.js';
import {
  AUTOSEND_ELIGIBLE_ARCHETYPES,
  AUTOSEND_TRUST_THRESHOLD,
  isAutoSendEligible,
  type AutoSendEligibleArchetype,
  type AutoSendPolicyRow,
} from '../shared/types/strategy-autosend.js';
import type { RecType } from '../shared/types/recommendations.js';
import type { Archetype } from '../shared/types/strategy-archetype.js';
import { createLogger } from './logger.js';

const log = createLogger('strategy-autosend-store');

// ── Time helpers (local — no cron import, avoid eval-time cycle) ──────────────

/**
 * ISO date (YYYY-MM-DD) of the Monday anchoring the week containing `d`. Byte-equivalent to
 * strategy-issue-cron.ts `currentWeekOfUTC` — replicated locally so this store never imports the
 * cron at module-eval (the cron imports this store for auto-send → that would be a cycle).
 */
function weekOfUTC(d = new Date()): string {
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7; // Sunday(0) → 6 days back to its Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

/**
 * True when `cur` (a YYYY-MM-DD Monday) is exactly the ISO week immediately after `prev` (also a
 * YYYY-MM-DD Monday) — i.e. cur is exactly 7 days after prev. Both inputs are Monday anchors from
 * weekOfUTC, so a simple 7-day add over the UTC epoch is exact (no DST in UTC).
 */
function isPrevIsoWeek(prev: string, cur: string): boolean {
  const prevMs = Date.parse(`${prev}T00:00:00.000Z`);
  const curMs = Date.parse(`${cur}T00:00:00.000Z`);
  if (Number.isNaN(prevMs) || Number.isNaN(curMs)) return false;
  return curMs - prevMs === 7 * 86_400_000;
}

// ── Row mapping ──────────────────────────────────────────────────────────────

interface AutoSendRow {
  workspace_id: string;
  archetype: string;
  enabled: number;
  consecutive_cycles: number;
  last_credited_week: string | null;
  updated_at: string;
}

function rowToPolicy(archetype: AutoSendEligibleArchetype, row: AutoSendRow | undefined): AutoSendPolicyRow {
  const consecutiveCycles = row?.consecutive_cycles ?? 0;
  return {
    archetype,
    enabled: row ? row.enabled === 1 : false,
    consecutiveCycles,
    lastCreditedWeek: row?.last_credited_week ?? null,
    earned: consecutiveCycles >= AUTOSEND_TRUST_THRESHOLD,
  };
}

// ── Prepared statements ──────────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  get: db.prepare(
    `SELECT * FROM strategy_autosend_policy WHERE workspace_id = ? AND archetype = ?`,
  ),
  upsertEnabled: db.prepare(`
    INSERT INTO strategy_autosend_policy
      (workspace_id, archetype, enabled, consecutive_cycles, last_credited_week, updated_at)
    VALUES
      (@workspace_id, @archetype, @enabled, 0, NULL, @updated_at)
    ON CONFLICT(workspace_id, archetype) DO UPDATE SET
      enabled    = excluded.enabled,
      updated_at = excluded.updated_at
  `),
  upsertCredit: db.prepare(`
    INSERT INTO strategy_autosend_policy
      (workspace_id, archetype, enabled, consecutive_cycles, last_credited_week, updated_at)
    VALUES
      (@workspace_id, @archetype, 0, @consecutive_cycles, @last_credited_week, @updated_at)
    ON CONFLICT(workspace_id, archetype) DO UPDATE SET
      consecutive_cycles = excluded.consecutive_cycles,
      last_credited_week = excluded.last_credited_week,
      updated_at         = excluded.updated_at
  `),
}));

// ── Typed error ──────────────────────────────────────────────────────────────

export type AutoSendPolicyErrorCode = 'not_eligible' | 'not_earned';

/** Thrown by setAutoSendPolicyEnabled — the route maps `.code` to a 400 {error}. */
export class AutoSendPolicyError extends Error {
  readonly code: AutoSendPolicyErrorCode;
  constructor(code: AutoSendPolicyErrorCode, message: string) {
    super(message);
    this.name = 'AutoSendPolicyError';
    this.code = code;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Return one row per eligible archetype (`quick_win`, `technical`), in AUTOSEND_ELIGIBLE_ARCHETYPES
 * order, filling defaults (enabled:false, consecutiveCycles:0, lastCreditedWeek:null) for archetypes
 * with no stored row. `earned` is derived (consecutiveCycles >= AUTOSEND_TRUST_THRESHOLD).
 */
export function getAutoSendPolicies(workspaceId: string): AutoSendPolicyRow[] {
  return AUTOSEND_ELIGIBLE_ARCHETYPES.map((archetype) => {
    const row = stmts().get.get(workspaceId, archetype) as AutoSendRow | undefined;
    return rowToPolicy(archetype, row);
  });
}

/**
 * Enabled + earned eligible archetypes — the set the cron auto-sends for. An archetype is included
 * iff it is enabled AND consecutiveCycles >= AUTOSEND_TRUST_THRESHOLD (defence in depth: even if a
 * stale enabled row survives a credit reset, the earned gate excludes it).
 */
export function getEarnedEnabledArchetypes(workspaceId: string): AutoSendEligibleArchetype[] {
  return getAutoSendPolicies(workspaceId)
    .filter((p) => p.enabled && p.consecutiveCycles >= AUTOSEND_TRUST_THRESHOLD)
    .map((p) => p.archetype);
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Set the operator opt-in (`enabled`) for an eligible archetype. Rejects (throws AutoSendPolicyError):
 *   - `not_eligible` — the archetype is not auto-send-eligible (never quick_win/technical).
 *   - `not_earned`   — enabling (`enabled === true`) before the archetype is earned (cycles < THRESHOLD).
 * Disabling is always allowed (even when not earned, so a future eligibility change can't strand a
 * stuck-on policy). Upserts `updated_at`. Returns the updated (re-read) policy row.
 */
export function setAutoSendPolicyEnabled(
  workspaceId: string,
  archetype: Archetype,
  enabled: boolean,
): AutoSendPolicyRow {
  if (!isAutoSendEligible(archetype)) {
    throw new AutoSendPolicyError('not_eligible', `Archetype "${archetype}" is not auto-send-eligible`);
  }
  // Eligible from here — narrow to AutoSendEligibleArchetype.
  const eligible: AutoSendEligibleArchetype = archetype;

  if (enabled) {
    const current = rowToPolicy(eligible, stmts().get.get(workspaceId, eligible) as AutoSendRow | undefined);
    if (current.consecutiveCycles < AUTOSEND_TRUST_THRESHOLD) {
      throw new AutoSendPolicyError(
        'not_earned',
        `Auto-send for "${eligible}" is not earned yet (${current.consecutiveCycles}/${AUTOSEND_TRUST_THRESHOLD} cycles)`,
      );
    }
  }

  stmts().upsertEnabled.run({
    workspace_id: workspaceId,
    archetype: eligible,
    enabled: enabled ? 1 : 0,
    updated_at: new Date().toISOString(),
  });

  return rowToPolicy(eligible, stmts().get.get(workspaceId, eligible) as AutoSendRow | undefined);
}

/**
 * Credit one ISO-week cycle for the archetype of `recType` on a SEND (manual or auto — this is the
 * single chokepoint inside sendRecommendation). Full no-op when the flag is off for the workspace.
 * Maps recType→archetype; returns early when the archetype is not eligible. Applies the streak rule
 * (§3) atomically and idempotently within a week. NEVER throws into the caller — a credit failure is
 * logged and swallowed so it can never break a live send.
 */
export function creditArchetypeCycleOnSend(workspaceId: string, recType: RecType): void {
  try {
    // Flag-guarded — a complete no-op when The Issue is off for this workspace (no table read/write).
    if (!isFeatureEnabled('strategy-the-issue', workspaceId)) return;

    const archetype = recArchetype(recType);
    if (!isAutoSendEligible(archetype)) return;
    const eligible: AutoSendEligibleArchetype = archetype;

    const thisWeek = weekOfUTC();

    const apply = db.transaction((): boolean => {
      const row = stmts().get.get(workspaceId, eligible) as AutoSendRow | undefined;
      const prev = row?.last_credited_week ?? null;
      const cycles = row?.consecutive_cycles ?? 0;

      // Same week → already credited this week → idempotent no-op.
      if (prev === thisWeek) return false;

      let nextCycles: number;
      if (prev !== null && isPrevIsoWeek(prev, thisWeek)) {
        // Contiguous week → advance the streak.
        nextCycles = cycles + 1;
      } else if (cycles >= AUTOSEND_TRUST_THRESHOLD) {
        // Non-contiguous (gap) or first-ever, but ALREADY earned → latched, keep advancing.
        nextCycles = cycles + 1;
      } else {
        // Non-contiguous (gap) or first-ever, still building → reset to this single counted week.
        nextCycles = 1;
      }

      stmts().upsertCredit.run({
        workspace_id: workspaceId,
        archetype: eligible,
        consecutive_cycles: nextCycles,
        last_credited_week: thisWeek,
        updated_at: new Date().toISOString(),
      });
      return true;
    });
    const changed = apply();

    // Broadcast-after-mutation: the streak counter (consecutiveCycles / earned) drives the operator's
    // TrustLadderPanel, so a crediting send — manual OR the cron's auto-send — must refresh it. Skipped
    // on the same-week no-op (changed === false). Fired AFTER the txn commits; never throws into the
    // send (the whole fn is wrapped). Flag-OFF already returned above, so this stays silent then.
    if (changed) {
      broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_AUTOSEND_POLICY_UPDATED, { archetype: eligible });
    }
  } catch (err) {
    log.error({ err, workspaceId, recType }, 'creditArchetypeCycleOnSend failed (swallowed)');
  }
}
