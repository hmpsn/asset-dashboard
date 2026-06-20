// tests/unit/strategy-autosend-store.test.ts
//
// The Issue — Phase 4 trust-ladder store (server/strategy-autosend-store.ts).
//
// Covers the LOCKED streak rule + eligibility enforcement + the flag-OFF no-op:
//
//   Streak rule (latched-once-earned), credited at most once per ISO week per (workspace,archetype):
//     - same week as lastCreditedWeek            → no-op (idempotent within a week)
//     - exactly the ISO week after (contiguous)  → increment
//     - non-contiguous (a full week skipped) / first-ever:
//         · already EARNED (cycles >= 3)         → still increment (latched)
//         · still building (cycles < 3)          → reset to 1
//
//   Eligibility: creditArchetypeCycleOnSend ignores ineligible recTypes (no row written);
//     setAutoSendPolicyEnabled throws for an ineligible archetype; setAutoSendPolicyEnabled throws
//     when enabling before earned (cycles < 3).
//
//   Flag-OFF: creditArchetypeCycleOnSend is a complete no-op (no row written) when
//     `strategy-the-issue` is off for the workspace.
//
// The credit helper reads wall-clock `currentWeekOfUTC` for "this week"; to exercise the prior-week
// transitions deterministically we seed `last_credited_week` directly (to last week / two weeks ago)
// and assert the resulting `consecutive_cycles` after a credit. We never assume an injectable clock.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { currentWeekOfUTC } from '../../server/strategy-issue-cron.js';
import {
  getAutoSendPolicies,
  setAutoSendPolicyEnabled,
  creditArchetypeCycleOnSend,
  getEarnedEnabledArchetypes,
} from '../../server/strategy-autosend-store.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { AutoSendEligibleArchetype } from '../../shared/types/strategy-autosend.js';

// ── ISO-week helpers (mirror the cron's Monday anchor) ───────────────────────
const THIS_WEEK = currentWeekOfUTC();
function weekOffset(weeks: number): string {
  const d = new Date(`${THIS_WEEK}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
const LAST_WEEK = weekOffset(-1); // contiguous with this week
const TWO_WEEKS_AGO = weekOffset(-2); // a full week skipped → non-contiguous

// ── recTypes by archetype (REC_TYPE_ARCHETYPE) ───────────────────────────────
// 'strategy' → quick_win (eligible); 'technical' → technical (eligible); 'content' → authority_bet
// (INELIGIBLE — the canonical money bucket).
const QUICK_WIN_RECTYPE = 'strategy';
const TECHNICAL_RECTYPE = 'technical';
const INELIGIBLE_RECTYPE = 'content';

let seeded: SeededFullWorkspace;
let wsId = '';

/** Directly seed/overwrite a policy row so prior-week transitions are deterministic. */
function seedPolicyRow(
  archetype: AutoSendEligibleArchetype,
  cycles: number,
  lastCreditedWeek: string | null,
  enabled = false,
): void {
  db.prepare(
    `INSERT INTO strategy_autosend_policy
       (workspace_id, archetype, enabled, consecutive_cycles, last_credited_week, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, archetype) DO UPDATE SET
       enabled = excluded.enabled,
       consecutive_cycles = excluded.consecutive_cycles,
       last_credited_week = excluded.last_credited_week,
       updated_at = excluded.updated_at`,
  ).run(wsId, archetype, enabled ? 1 : 0, cycles, lastCreditedWeek, new Date().toISOString());
}

interface RawPolicyRow {
  consecutive_cycles: number;
  last_credited_week: string | null;
  enabled: number;
}
function readRow(archetype: AutoSendEligibleArchetype): RawPolicyRow | undefined {
  return db
    .prepare(
      `SELECT consecutive_cycles, last_credited_week, enabled
         FROM strategy_autosend_policy WHERE workspace_id = ? AND archetype = ?`,
    )
    .get(wsId, archetype) as RawPolicyRow | undefined;
}

beforeAll(() => {
  seeded = seedWorkspace();
  wsId = seeded.workspaceId;
});

beforeEach(() => {
  db.prepare('DELETE FROM strategy_autosend_policy WHERE workspace_id = ?').run(wsId);
  setWorkspaceFlagOverride('strategy-the-issue', wsId, true);
});

afterEach(() => {
  db.prepare('DELETE FROM strategy_autosend_policy WHERE workspace_id = ?').run(wsId);
  setWorkspaceFlagOverride('strategy-the-issue', wsId, null);
});

afterAll(() => {
  seeded.cleanup();
});

describe('getAutoSendPolicies — default shape', () => {
  it('returns exactly the 2 eligible archetypes with defaults when no rows exist', () => {
    const policies = getAutoSendPolicies(wsId);
    expect(policies.map(p => p.archetype).sort()).toEqual(['quick_win', 'technical']);
    for (const p of policies) {
      expect(p.enabled).toBe(false);
      expect(p.consecutiveCycles).toBe(0);
      expect(p.lastCreditedWeek).toBeNull();
      expect(p.earned).toBe(false);
    }
  });

  it('derives earned = (consecutiveCycles >= 3)', () => {
    seedPolicyRow('quick_win', 3, LAST_WEEK);
    seedPolicyRow('technical', 2, LAST_WEEK);
    const byArch = Object.fromEntries(getAutoSendPolicies(wsId).map(p => [p.archetype, p]));
    expect(byArch.quick_win.earned).toBe(true);
    expect(byArch.technical.earned).toBe(false);
  });
});

describe('creditArchetypeCycleOnSend — streak rule', () => {
  it('first-ever credit sets cycles=1 and stamps this week', () => {
    creditArchetypeCycleOnSend(wsId, QUICK_WIN_RECTYPE);
    const row = readRow('quick_win');
    expect(row?.consecutive_cycles).toBe(1);
    expect(row?.last_credited_week).toBe(THIS_WEEK);
  });

  it('contiguous weeks increment toward the threshold (1 → 2 → 3 earns)', () => {
    // Simulate "last week credited at cycle 1", then credit this (contiguous) week → 2.
    seedPolicyRow('quick_win', 1, LAST_WEEK);
    creditArchetypeCycleOnSend(wsId, QUICK_WIN_RECTYPE);
    expect(readRow('quick_win')?.consecutive_cycles).toBe(2);
    expect(readRow('quick_win')?.last_credited_week).toBe(THIS_WEEK);

    // Simulate "last week credited at cycle 2", then credit this (contiguous) week → 3 (earned).
    seedPolicyRow('quick_win', 2, LAST_WEEK);
    creditArchetypeCycleOnSend(wsId, QUICK_WIN_RECTYPE);
    const row = readRow('quick_win');
    expect(row?.consecutive_cycles).toBe(3);
    const earned = getAutoSendPolicies(wsId).find(p => p.archetype === 'quick_win')?.earned;
    expect(earned).toBe(true);
  });

  it('same-week credit is idempotent (no-op): cycles + lastCreditedWeek unchanged', () => {
    seedPolicyRow('quick_win', 2, THIS_WEEK);
    creditArchetypeCycleOnSend(wsId, QUICK_WIN_RECTYPE);
    const row = readRow('quick_win');
    expect(row?.consecutive_cycles).toBe(2); // unchanged — already credited this week
    expect(row?.last_credited_week).toBe(THIS_WEEK);
  });

  it('a skipped week RESETS the streak to 1 while still BUILDING (cycles < threshold)', () => {
    // cycles=2 (not yet earned), last credit two weeks ago → this week is non-contiguous → reset to 1.
    seedPolicyRow('quick_win', 2, TWO_WEEKS_AGO);
    creditArchetypeCycleOnSend(wsId, QUICK_WIN_RECTYPE);
    const row = readRow('quick_win');
    expect(row?.consecutive_cycles).toBe(1);
    expect(row?.last_credited_week).toBe(THIS_WEEK);
  });

  it('a skipped week is LATCHED once EARNED (cycles >= threshold) — still increments through the gap', () => {
    // cycles=3 (earned), last credit two weeks ago → non-contiguous but latched → increment to 4.
    seedPolicyRow('quick_win', 3, TWO_WEEKS_AGO, true);
    creditArchetypeCycleOnSend(wsId, QUICK_WIN_RECTYPE);
    const row = readRow('quick_win');
    expect(row?.consecutive_cycles).toBe(4);
    expect(row?.last_credited_week).toBe(THIS_WEEK);
    // earned stays true; the toggle the operator already enabled survives the quiet week.
    expect(row?.enabled).toBe(1);
  });

  it('credits the TECHNICAL archetype off a technical recType', () => {
    creditArchetypeCycleOnSend(wsId, TECHNICAL_RECTYPE);
    expect(readRow('technical')?.consecutive_cycles).toBe(1);
    expect(readRow('quick_win')).toBeUndefined();
  });
});

describe('creditArchetypeCycleOnSend — eligibility', () => {
  it('ignores an ineligible recType (authority_bet/content) — no row written', () => {
    creditArchetypeCycleOnSend(wsId, INELIGIBLE_RECTYPE);
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM strategy_autosend_policy WHERE workspace_id = ?')
      .get(wsId) as { n: number };
    expect(rows.n).toBe(0);
  });
});

describe('creditArchetypeCycleOnSend — flag-OFF no-op', () => {
  it('writes NO row when strategy-the-issue is OFF for the workspace', () => {
    setWorkspaceFlagOverride('strategy-the-issue', wsId, false);
    creditArchetypeCycleOnSend(wsId, QUICK_WIN_RECTYPE);
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM strategy_autosend_policy WHERE workspace_id = ?')
      .get(wsId) as { n: number };
    expect(rows.n).toBe(0);
  });
});

describe('setAutoSendPolicyEnabled — enforcement', () => {
  it('throws for an ineligible archetype', () => {
    expect(() =>
      // @ts-expect-error — an ineligible archetype is not an AutoSendEligibleArchetype.
      setAutoSendPolicyEnabled(wsId, 'authority_bet', true),
    ).toThrow();
  });

  it('throws when enabling BEFORE the archetype is earned (cycles < threshold)', () => {
    seedPolicyRow('quick_win', 2, LAST_WEEK); // not yet earned
    expect(() => setAutoSendPolicyEnabled(wsId, 'quick_win', true)).toThrow();
    // The row must NOT have been flipped on.
    expect(readRow('quick_win')?.enabled).toBe(0);
  });

  it('allows enabling once earned (cycles >= threshold) and the returned row reflects it', () => {
    seedPolicyRow('quick_win', 3, LAST_WEEK);
    const row = setAutoSendPolicyEnabled(wsId, 'quick_win', true);
    expect(row.enabled).toBe(true);
    expect(row.earned).toBe(true);
    expect(readRow('quick_win')?.enabled).toBe(1);
  });

  it('allows DISABLING an earned archetype (turning the reward back off is always permitted)', () => {
    seedPolicyRow('quick_win', 3, LAST_WEEK, true);
    const row = setAutoSendPolicyEnabled(wsId, 'quick_win', false);
    expect(row.enabled).toBe(false);
    expect(readRow('quick_win')?.enabled).toBe(0);
  });
});

describe('getEarnedEnabledArchetypes', () => {
  it('returns only archetypes that are BOTH earned (cycles >= 3) AND enabled', () => {
    seedPolicyRow('quick_win', 3, LAST_WEEK, true); // earned + enabled → included
    seedPolicyRow('technical', 3, LAST_WEEK, false); // earned but NOT enabled → excluded
    expect(getEarnedEnabledArchetypes(wsId)).toEqual(['quick_win']);
  });

  it('excludes an enabled-but-not-earned row (defence in depth)', () => {
    // This state should be unreachable via setAutoSendPolicyEnabled, but the getter must still gate.
    seedPolicyRow('quick_win', 2, LAST_WEEK, true);
    expect(getEarnedEnabledArchetypes(wsId)).toEqual([]);
  });

  it('returns [] when no policies exist', () => {
    expect(getEarnedEnabledArchetypes(wsId)).toEqual([]);
  });
});
