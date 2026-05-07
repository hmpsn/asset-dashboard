import { describe, expect, it } from 'vitest';
import {
  createOptimisticBackgroundJob,
  isTerminalJobStatus,
  jobBelongsToPanel,
  jobMatchesCriteria,
  upsertBackgroundJob,
  type BackgroundJob,
} from '../../src/hooks/useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';

function job(overrides: Partial<BackgroundJob>): BackgroundJob {
  return {
    id: 'job-1',
    type: 'schema-generator',
    status: 'running',
    message: 'Working...',
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('background task helpers', () => {
  it('matches jobs by type and optional workspace', () => {
    const workspaceJob = job({ workspaceId: 'ws-1' });

    expect(jobMatchesCriteria(workspaceJob, { type: 'schema-generator' })).toBe(true);
    expect(jobMatchesCriteria(workspaceJob, { type: 'schema-generator', workspaceId: 'ws-1' })).toBe(true);
    expect(jobMatchesCriteria(workspaceJob, { type: 'schema-generator', workspaceId: 'ws-2' })).toBe(false);
    expect(jobMatchesCriteria(workspaceJob, { type: 'page-analysis', workspaceId: 'ws-1' })).toBe(false);
  });

  it('scopes the floating task panel to the current workspace or global surface', () => {
    const globalJob = job({ workspaceId: undefined });
    const workspaceJob = job({ workspaceId: 'ws-1' });

    expect(jobBelongsToPanel(globalJob, undefined)).toBe(true);
    expect(jobBelongsToPanel(workspaceJob, undefined)).toBe(false);
    expect(jobBelongsToPanel(workspaceJob, 'ws-1')).toBe(true);
    expect(jobBelongsToPanel(globalJob, 'ws-1')).toBe(false);
    expect(jobBelongsToPanel(workspaceJob, 'ws-2')).toBe(false);
  });

  it('treats done, error, and cancelled jobs as terminal', () => {
    expect(isTerminalJobStatus('pending')).toBe(false);
    expect(isTerminalJobStatus('running')).toBe(false);
    expect(isTerminalJobStatus('done')).toBe(true);
    expect(isTerminalJobStatus('error')).toBe(true);
    expect(isTerminalJobStatus('cancelled')).toBe(true);
  });

  it('creates a workspace-scoped optimistic job for immediate panel visibility', () => {
    const optimistic = createOptimisticBackgroundJob(
      'job-audit-1',
      BACKGROUND_JOB_TYPES.SEO_AUDIT,
      { workspaceId: 'ws-1' },
    );

    expect(optimistic).toMatchObject({
      id: 'job-audit-1',
      type: BACKGROUND_JOB_TYPES.SEO_AUDIT,
      status: 'pending',
      progress: 0,
      message: 'Starting SEO Audit...',
      workspaceId: 'ws-1',
    });
  });

  it('upserts websocket or hydrated job updates without losing local entries', () => {
    const initial = job({ id: 'job-audit-1', type: BACKGROUND_JOB_TYPES.SEO_AUDIT, status: 'pending', workspaceId: 'ws-1' });
    const updated = job({ id: 'job-audit-1', type: BACKGROUND_JOB_TYPES.SEO_AUDIT, status: 'running', message: 'Scanning pages...', workspaceId: 'ws-1' });
    const other = job({ id: 'job-other', type: BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, status: 'running', workspaceId: 'ws-1' });

    expect(upsertBackgroundJob([], initial)).toEqual([initial]);
    expect(upsertBackgroundJob([initial, other], updated)).toEqual([
      { ...initial, ...updated },
      other,
    ]);
  });
});
