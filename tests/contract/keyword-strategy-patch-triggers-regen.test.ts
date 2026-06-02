/**
 * Contract test: PATCH /api/webflow/keyword-strategy/:workspaceId must call
 * queueKeywordStrategyPostUpdateFollowOns after the transaction commits, so that
 * recommendations are regenerated after a strategy edit (Task 1.2 of the
 * Foundational Integrity Remediation plan).
 *
 * This is a source-level structural contract (readFileSync) — the same pattern
 * as tests/contract/keyword-strategy-follow-ons.test.ts — because the follow-on
 * fires in a 30-second detached setTimeout, making live-server timing tests
 * impractical.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('keyword-strategy PATCH triggers rec regen via follow-ons', () => {
  it('imports queueKeywordStrategyPostUpdateFollowOns from keyword-strategy-follow-ons', () => {
    const src = readFileSync('server/routes/keyword-strategy.ts', 'utf-8'); // readFile-ok — migration guard: PATCH route must import and invoke the follow-on queue so recommendation regen fires after every strategy edit.

    expect(src).toContain("from '../keyword-strategy-follow-ons.js'");
    expect(src).toContain('queueKeywordStrategyPostUpdateFollowOns');
  });

  it('calls queueKeywordStrategyPostUpdateFollowOns with workspaceId after the transaction commits', () => {
    const src = readFileSync('server/routes/keyword-strategy.ts', 'utf-8'); // readFile-ok — ordering guard: follow-on must be queued after applyPatch.immediate() returns, not inside the transaction.

    // The import line and the call site must both be present
    expect(src).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id })');

    // The call must appear AFTER applyPatch.immediate() (i.e. after the transaction commits).
    // The transaction is invoked via BEGIN IMMEDIATE (.immediate()) to avoid the WAL
    // SQLITE_BUSY_SNAPSHOT flake on read-then-write transactions.
    const applyPatchIdx = src.indexOf('applyPatch.immediate()');
    const callIdx = src.indexOf('queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id })');

    expect(applyPatchIdx, 'applyPatch.immediate() call must exist in the PATCH handler').toBeGreaterThan(0);
    expect(callIdx, 'queueKeywordStrategyPostUpdateFollowOns call must exist in the PATCH handler').toBeGreaterThan(0);
    expect(callIdx, 'follow-on must be called after the transaction commits (after applyPatch.immediate())').toBeGreaterThan(applyPatchIdx);
  });
});
