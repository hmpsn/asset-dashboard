import { describe, expect, it } from 'vitest';
import {
  isTerminalJobStatus,
  jobBelongsToPanel,
  jobMatchesCriteria,
  type BackgroundJob,
} from '../../src/hooks/useBackgroundTasks';

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
});
