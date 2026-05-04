import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskPanel } from '../../src/components/TaskPanel';
import type { BackgroundJob } from '../../src/hooks/useBackgroundTasks';

const mocks = vi.hoisted(() => ({
  jobsForWorkspace: vi.fn(),
  dismissJob: vi.fn(),
  cancelJob: vi.fn(),
  clearDone: vi.fn(),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    jobsForWorkspace: mocks.jobsForWorkspace,
    dismissJob: mocks.dismissJob,
    cancelJob: mocks.cancelJob,
    clearDone: mocks.clearDone,
  }),
}));

function job(overrides: Partial<BackgroundJob>): BackgroundJob {
  return {
    id: 'job-1',
    type: 'page-analysis',
    status: 'running',
    progress: 1,
    total: 3,
    message: 'Working...',
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

function renderTaskPanel(workspaceId = 'ws-1') {
  return render(
    <MemoryRouter initialEntries={[`/ws/${workspaceId}`]}>
      <TaskPanel workspaceId={workspaceId} />
    </MemoryRouter>
  );
}

function renderTaskPanelFromRoute(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <TaskPanel />
    </MemoryRouter>
  );
}

describe('TaskPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders shared labels for feature-specific job types', () => {
    mocks.jobsForWorkspace.mockReturnValue([
      job({ id: 'job-seo-rewrite', type: 'seo-bulk-rewrite', message: 'Rewriting pages...' }),
    ]);

    renderTaskPanel();
    fireEvent.click(screen.getByRole('button', { name: /1 task running/i }));

    expect(screen.getByText('Bulk SEO Rewrite')).toBeInTheDocument();
    expect(screen.getByText('Rewriting pages...')).toBeInTheDocument();
  });

  it('only shows stop controls for abort-aware jobs', () => {
    mocks.jobsForWorkspace.mockReturnValue([
      job({ id: 'job-audit', type: 'seo-audit', message: 'Scanning...', progress: undefined, total: undefined }),
      job({ id: 'job-page-analysis', type: 'page-analysis', message: 'Analyzing...' }),
    ]);

    renderTaskPanel();
    fireEvent.click(screen.getByRole('button', { name: /2 tasks running/i }));

    expect(screen.queryByRole('button', { name: 'Stop SEO Audit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop Page Analysis' })).toBeInTheDocument();
  });

  it('clears completed jobs only for the visible workspace panel', () => {
    mocks.jobsForWorkspace.mockReturnValue([
      job({ id: 'job-done', type: 'schema-generator', status: 'done', message: 'Done' }),
    ]);

    renderTaskPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(mocks.clearDone).toHaveBeenCalledWith('ws-1');
  });

  it('derives workspace scope from the current router location', () => {
    mocks.jobsForWorkspace.mockReturnValue([
      job({ id: 'job-route', type: 'schema-generator', status: 'done', message: 'Done', workspaceId: 'ws-route' }),
    ]);

    renderTaskPanelFromRoute('/ws/ws-route/schema');

    expect(mocks.jobsForWorkspace).toHaveBeenCalledWith('ws-route');
  });
});
