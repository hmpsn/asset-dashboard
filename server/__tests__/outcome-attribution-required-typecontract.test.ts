/**
 * R8-PR2 (B14) — COMPILE-TIME contract: recordAction() REQUIRES `attribution`.
 *
 * This file lives under server/__tests__ ON PURPOSE: server/__tests__ is inside the
 * `tsc -b` project scope (tsconfig.node.json includes `server`), whereas tests/ is NOT.
 * So the `@ts-expect-error` below is genuinely enforced by `npm run typecheck` — it is the
 * runtime-free half of the B14 guarantee. If a future change weakened `attribution` back to
 * optional (reintroducing the inverted `?? 'platform_executed'` trust hazard), the omitted-
 * attribution call would compile, the `@ts-expect-error` directive would become UNUSED, and
 * tsc would fail with TS2578 ("Unused '@ts-expect-error' directive"). The guard fails in both
 * directions of regression.
 *
 * There is no `describe`/`it` here on purpose — the assertion is the type-check itself. A
 * trivial runtime test keeps vitest from complaining about a suite with no tests.
 */

import { describe, it, expect } from 'vitest';
import type { RecordActionParams } from '../outcome-tracking.js';
import type { BaselineSnapshot } from '../../shared/types/outcome-tracking.js';

const BASELINE: BaselineSnapshot = { captured_at: '2026-01-01T00:00:00Z' };

// The type-level assertion. We build a params object OMITTING attribution and assign it to
// RecordActionParams — this MUST be a type error (attribution is required). We never call
// recordAction() here (omitting attribution would throw at the NOT NULL DB column at runtime);
// the point is purely the compile-time contract, verified by `npm run typecheck`.
// @ts-expect-error — attribution is REQUIRED on RecordActionParams (B14); omitting it must not typecheck
const _missingAttribution: RecordActionParams = {
  workspaceId: 'ws-typecontract',
  actionType: 'meta_updated',
  sourceType: 'insight',
  baselineSnapshot: BASELINE,
};
void _missingAttribution;

// A well-formed params object WITH attribution must typecheck cleanly (control case).
const _withAttribution: RecordActionParams = {
  workspaceId: 'ws-typecontract',
  actionType: 'meta_updated',
  sourceType: 'insight',
  baselineSnapshot: BASELINE,
  attribution: 'not_acted_on',
};
void _withAttribution;

describe('B14 attribution required — compile-time contract', () => {
  it('is enforced by the @ts-expect-error above (this runtime assertion is a placeholder)', () => {
    // The real assertion is the type error suppressed above; typecheck fails if it regresses.
    expect(_withAttribution.attribution).toBe('not_acted_on');
  });
});
