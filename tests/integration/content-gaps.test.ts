/**
 * PR 1 Task 1.1 — content_gaps.cpc column round-trip.
 *
 * Exercises replaceAllContentGaps / listContentGaps directly (no HTTP server;
 * no port needed). Requires the migration 127-content-gap-cpc.sql to have run
 * so the `cpc` column exists before the test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllContentGaps, listContentGaps } from '../../server/content-gaps.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`cpc-round-trip-test-${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

describe('content_gaps cpc round-trip', () => {
  it('persists + reads ContentGap.cpc', () => {
    replaceAllContentGaps(workspaceId, [
      {
        topic: 't',
        targetKeyword: 'dental implants',
        intent: 'commercial',
        priority: 'high',
        rationale: 'r',
        volume: 1000,
        difficulty: 40,
        cpc: 12,
      },
    ]);
    const gap = listContentGaps(workspaceId).find(g => g.targetKeyword === 'dental implants');
    expect(gap).toBeDefined();
    expect(gap!.cpc).toBe(12);
    deleteWorkspace(workspaceId);
    workspaceId = '';
  });
});
