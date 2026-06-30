/**
 * Lane D / Task D-PROVENANCE — the integrity-critical D6 graduation matrix for
 * `selectOutcomeProvenance(ws, periodFormCount)` (server/the-issue-outcome.ts).
 *
 * D6 (owner-ratified): the platform must NEVER claim "measured" the instant the flag flips, before
 * the operator has instrumented + pinned real typed events. `measured_action` is earned ONLY when:
 *   - the `the-issue-client-measured-capture` flag is ON, AND
 *   - the workspace has CONFIRMED typed setup (`conversionTrackingConfirmedAt` set AND ≥1 pinned
 *     event carrying an `outcomeType`), OR ≥1 captured form_submission in the period
 *       (`periodFormCount > 0`).
 * In EVERY other case it returns `estimate_ga4`. It NEVER returns `actual_reconciled` at P1a (P3).
 *
 * This is a true unit test: it calls `selectOutcomeProvenance` DIRECTLY (the other P1a suites only
 * exercise it transitively through `computeROI`). It seeds real workspace rows + per-workspace flag
 * overrides because the selector calls `isFeatureEnabled(flag, ws.id)` internally. Each scenario
 * uses its OWN workspace so the per-workspace flag override is unambiguous and isolated.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { selectOutcomeProvenance } from '../../server/the-issue-outcome.js';
import type { EventDisplayConfig } from '../../shared/types/workspace.js';

const FLAG = 'the-issue-client-measured-capture';

const typedPinned: EventDisplayConfig = {
  eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill',
};
const untypedPinned: EventDisplayConfig = {
  eventName: 'form_submit', displayName: 'Form fills', pinned: true, // no outcomeType
};

const teardowns: Array<() => void> = [];
afterEach(() => {
  while (teardowns.length) teardowns.pop()!();
});

/**
 * Seed an isolated workspace, set the measured-capture flag override, apply the P1a config under
 * test, and return the freshly-read Workspace (the selector reads `eventConfig` +
 * `conversionTrackingConfirmedAt` off the row). Registers its own teardown.
 */
function makeWorkspace(opts: {
  flagOn: boolean;
  confirmedAt?: string | null;
  eventConfig?: EventDisplayConfig[];
}): ReturnType<typeof getWorkspace> {
  const s = seedWorkspace();
  teardowns.push(() => {
    setWorkspaceFlagOverride(FLAG, s.workspaceId, null);
    s.cleanup();
  });
  setWorkspaceFlagOverride(FLAG, s.workspaceId, opts.flagOn);
  updateWorkspace(s.workspaceId, {
    eventConfig: opts.eventConfig ?? [],
    // undefined leaves it unset (unconfirmed); a string sets it (confirmed).
    ...(opts.confirmedAt !== undefined ? { conversionTrackingConfirmedAt: opts.confirmedAt ?? undefined } : {}),
  });
  return getWorkspace(s.workspaceId);
}

const NOW = new Date().toISOString();

describe('selectOutcomeProvenance — D6 graduation matrix', () => {
  it('FLAG OFF, even with confirmed typed setup AND captured leads → estimate_ga4 (the flag gate beats everything)', () => {
    const ws = makeWorkspace({ flagOn: false, confirmedAt: NOW, eventConfig: [typedPinned] })!;
    // periodFormCount > 0 too — the flag still dominates.
    expect(selectOutcomeProvenance(ws, 5)).toBe('estimate_ga4');
  });

  it('FLAG ON + confirmedAt set + a pinned TYPED event + 0 captured leads → measured_action', () => {
    const ws = makeWorkspace({ flagOn: true, confirmedAt: NOW, eventConfig: [typedPinned] })!;
    expect(selectOutcomeProvenance(ws, 0)).toBe('measured_action');
  });

  it('FLAG ON but setup NOT confirmed (no confirmedAt) + 0 captured leads → estimate_ga4 (no false "measured" claim — the load-bearing honesty case)', () => {
    const ws = makeWorkspace({ flagOn: true, confirmedAt: null, eventConfig: [typedPinned] })!;
    expect(selectOutcomeProvenance(ws, 0)).toBe('estimate_ga4');
  });

  it('FLAG ON + confirmedAt set but NO pinned typed event (only an UNTYPED pinned event) + 0 captured leads → estimate_ga4 (both halves of the AND are required)', () => {
    const ws = makeWorkspace({ flagOn: true, confirmedAt: NOW, eventConfig: [untypedPinned] })!;
    expect(selectOutcomeProvenance(ws, 0)).toBe('estimate_ga4');
  });

  it('FLAG ON + a pinned TYPED event but confirmedAt NOT set + 0 captured leads → estimate_ga4 (confirmation timestamp is required, not just a typed pin)', () => {
    const ws = makeWorkspace({ flagOn: true, confirmedAt: null, eventConfig: [typedPinned] })!;
    expect(selectOutcomeProvenance(ws, 0)).toBe('estimate_ga4');
  });

  it('FLAG ON + NO pinned events at all + 0 captured leads → estimate_ga4', () => {
    const ws = makeWorkspace({ flagOn: true, confirmedAt: null, eventConfig: [] })!;
    expect(selectOutcomeProvenance(ws, 0)).toBe('estimate_ga4');
  });

  it('FLAG ON + setup UNconfirmed but ≥1 captured form_submission this period (periodFormCount > 0) → measured_action (the captured-leads OR branch)', () => {
    const ws = makeWorkspace({ flagOn: true, confirmedAt: null, eventConfig: [] })!;
    expect(selectOutcomeProvenance(ws, 1)).toBe('measured_action');
  });

  it('FLAG ON + confirmed typed setup AND captured leads → measured_action (both conditions satisfied)', () => {
    const ws = makeWorkspace({ flagOn: true, confirmedAt: NOW, eventConfig: [typedPinned] })!;
    expect(selectOutcomeProvenance(ws, 3)).toBe('measured_action');
  });

  it('NEVER returns actual_reconciled at P1a, in any combination of inputs', () => {
    const combos: Array<{ flagOn: boolean; confirmedAt: string | null; eventConfig: EventDisplayConfig[]; count: number }> = [
      { flagOn: false, confirmedAt: null, eventConfig: [], count: 0 },
      { flagOn: false, confirmedAt: NOW, eventConfig: [typedPinned], count: 9 },
      { flagOn: true, confirmedAt: null, eventConfig: [], count: 0 },
      { flagOn: true, confirmedAt: NOW, eventConfig: [typedPinned], count: 0 },
      { flagOn: true, confirmedAt: null, eventConfig: [untypedPinned], count: 4 },
    ];
    for (const c of combos) {
      const ws = makeWorkspace({ flagOn: c.flagOn, confirmedAt: c.confirmedAt, eventConfig: c.eventConfig })!;
      expect(selectOutcomeProvenance(ws, c.count)).not.toBe('actual_reconciled');
    }
  });
});
