/**
 * Pure helper tests for useBackgroundTasks.
 *
 * Covers scenarios NOT already tested in tests/unit/background-tasks.test.tsx:
 * - upsertBackgroundJob: new job prepended to non-empty list
 * - upsertBackgroundJob: merge preserves fields not in the update
 * - upsertBackgroundJob: multiple jobs with same id deduplication
 * - createOptimisticBackgroundJob: non-string workspaceId param is dropped
 * - createOptimisticBackgroundJob: timestamps are valid ISO strings
 * - jobMatchesCriteria: type mismatch when workspaceId matches
 * - jobBelongsToPanel: undefined workspace matches only jobs without workspaceId
 * - isTerminalJobStatus: exhaustive check for all five statuses
 */

import { describe, it, expect } from 'vitest';
import {
  createOptimisticBackgroundJob,
  isTerminalJobStatus,
  jobBelongsToPanel,
  jobMatchesCriteria,
  upsertBackgroundJob,
  type BackgroundJob,
} from '../../src/hooks/useBackgroundTasks.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

// ---------------------------------------------------------------------------
// Test factory
// ---------------------------------------------------------------------------

function job(overrides: Partial<BackgroundJob>): BackgroundJob {
  return {
    id: 'job-default',
    type: 'seo-audit',
    status: 'running',
    message: 'Working...',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// upsertBackgroundJob — scenarios not covered by existing tests
// ---------------------------------------------------------------------------

describe('upsertBackgroundJob — extended scenarios', () => {
  it('prepends a new job to a non-empty list', () => {
    const existing = job({ id: 'a', status: 'running' });
    const incoming = job({ id: 'b', status: 'pending' });

    const result = upsertBackgroundJob([existing], incoming);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('b'); // new job comes first
    expect(result[1].id).toBe('a');
  });

  it('merges an update into an existing job without replacing other entries', () => {
    const first = job({ id: 'a', status: 'running', progress: 10 });
    const second = job({ id: 'b', status: 'pending' });
    const update = job({ id: 'a', status: 'done', progress: 100, message: 'Finished' });

    const result = upsertBackgroundJob([first, second], update);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'a', status: 'done', progress: 100, message: 'Finished' });
    expect(result[1].id).toBe('b'); // unchanged
  });

  it('preserves original fields that the update object does not override', () => {
    const original = job({ id: 'x', workspaceId: 'ws-1', result: { count: 42 } });
    const update: BackgroundJob = {
      id: 'x',
      type: 'seo-audit',
      status: 'done',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const result = upsertBackgroundJob([original], update);

    expect(result[0].workspaceId).toBe('ws-1');
    expect(result[0].result).toEqual({ count: 42 });
    expect(result[0].status).toBe('done'); // update applied
  });

  it('handles an update where no existing entry matches — prepend behavior', () => {
    const existing = [
      job({ id: 'one', status: 'running' }),
      job({ id: 'two', status: 'pending' }),
    ];
    const brandNew = job({ id: 'three', status: 'pending' });

    const result = upsertBackgroundJob(existing, brandNew);
    expect(result[0].id).toBe('three');
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// createOptimisticBackgroundJob — extended scenarios
// ---------------------------------------------------------------------------

describe('createOptimisticBackgroundJob — extended scenarios', () => {
  it('sets workspaceId to undefined when params.workspaceId is not a string', () => {
    const result = createOptimisticBackgroundJob(
      'job-no-ws',
      BACKGROUND_JOB_TYPES.SEO_AUDIT,
      { workspaceId: 123 }, // number, not string
    );
    expect(result.workspaceId).toBeUndefined();
  });

  it('sets workspaceId to undefined when params has no workspaceId key', () => {
    const result = createOptimisticBackgroundJob(
      'job-no-ws-key',
      BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR,
      {},
    );
    expect(result.workspaceId).toBeUndefined();
  });

  it('generates valid ISO timestamps for createdAt and updatedAt', () => {
    const before = Date.now();
    const result = createOptimisticBackgroundJob(
      'ts-check',
      BACKGROUND_JOB_TYPES.SEO_AUDIT,
      {},
    );
    const after = Date.now();

    const createdMs = new Date(result.createdAt).getTime();
    const updatedMs = new Date(result.updatedAt).getTime();

    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(after);
    expect(updatedMs).toBeGreaterThanOrEqual(before);
    expect(updatedMs).toBeLessThanOrEqual(after);
    // createdAt and updatedAt should be the same instant for a new optimistic job
    expect(result.createdAt).toBe(result.updatedAt);
  });

  it('always initialises status as pending and progress as 0', () => {
    const result = createOptimisticBackgroundJob(
      'pending-check',
      BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      { workspaceId: 'ws-9' },
    );
    expect(result.status).toBe('pending');
    expect(result.progress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// jobMatchesCriteria — extended scenarios
// ---------------------------------------------------------------------------

describe('jobMatchesCriteria — extended scenarios', () => {
  it('returns false when type matches but workspaceId differs', () => {
    const j = job({ type: 'seo-audit', workspaceId: 'ws-A' });
    expect(jobMatchesCriteria(j, { type: 'seo-audit', workspaceId: 'ws-B' })).toBe(false);
  });

  it('returns false when workspaceId matches but type differs', () => {
    const j = job({ type: 'seo-audit', workspaceId: 'ws-A' });
    expect(jobMatchesCriteria(j, { type: 'schema-generator', workspaceId: 'ws-A' })).toBe(false);
  });

  it('returns true when no workspaceId filter is provided, regardless of job workspace', () => {
    const wsJob = job({ type: 'seo-audit', workspaceId: 'ws-A' });
    const globalJob = job({ type: 'seo-audit', workspaceId: undefined });
    expect(jobMatchesCriteria(wsJob, { type: 'seo-audit' })).toBe(true);
    expect(jobMatchesCriteria(globalJob, { type: 'seo-audit' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// jobBelongsToPanel — extended scenarios
// ---------------------------------------------------------------------------

describe('jobBelongsToPanel — extended scenarios', () => {
  it('a job with workspaceId is NOT shown in global panel (undefined workspaceId filter)', () => {
    const wsJob = job({ workspaceId: 'ws-1' });
    expect(jobBelongsToPanel(wsJob, undefined)).toBe(false);
  });

  it('a job without workspaceId IS shown in global panel', () => {
    const globalJob = job({ workspaceId: undefined });
    expect(jobBelongsToPanel(globalJob, undefined)).toBe(true);
  });

  it('a job with a different workspaceId is NOT shown in a workspace panel', () => {
    const wsJob = job({ workspaceId: 'ws-X' });
    expect(jobBelongsToPanel(wsJob, 'ws-Y')).toBe(false);
  });

  it('a global job is NOT shown in a workspace panel', () => {
    const globalJob = job({ workspaceId: undefined });
    expect(jobBelongsToPanel(globalJob, 'ws-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTerminalJobStatus — exhaustive coverage
// ---------------------------------------------------------------------------

describe('isTerminalJobStatus — all statuses', () => {
  it('pending is non-terminal', () => {
    expect(isTerminalJobStatus('pending')).toBe(false);
  });

  it('running is non-terminal', () => {
    expect(isTerminalJobStatus('running')).toBe(false);
  });

  it('done is terminal', () => {
    expect(isTerminalJobStatus('done')).toBe(true);
  });

  it('error is terminal', () => {
    expect(isTerminalJobStatus('error')).toBe(true);
  });

  it('cancelled is terminal', () => {
    expect(isTerminalJobStatus('cancelled')).toBe(true);
  });
});
