import { fireEvent, render, screen } from '@testing-library/react';
import { Bell } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../../src/components/NotificationBell';
import { useNotifications } from '../../src/hooks/admin/useNotifications';
import { useBackgroundTasks } from '../../src/hooks/useBackgroundTasks';

vi.mock('../../src/hooks/admin/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: vi.fn(),
}));

const mockUseNotifications = vi.mocked(useNotifications);
const mockUseBackgroundTasks = vi.mocked(useBackgroundTasks);

describe('NotificationBell unified hub', () => {
  beforeEach(() => {
    mockUseNotifications.mockReturnValue({
      data: [
        {
          id: 'requests-ws_1',
          label: '2 new requests',
          sub: 'Workspace One',
          color: 'text-red-400/80',
          icon: Bell,
          workspaceId: 'ws_1',
          workspaceName: 'Workspace One',
          tab: 'requests',
        },
        {
          id: 'anomaly-critical-ws_1',
          label: '1 critical anomaly',
          sub: 'Workspace One',
          color: 'text-red-400/80',
          icon: Bell,
          workspaceId: 'ws_1',
          workspaceName: 'Workspace One',
          tab: 'home',
        },
      ],
    } as ReturnType<typeof useNotifications>);

    mockUseBackgroundTasks.mockReturnValue({
      jobsForWorkspace: () => [
        {
          id: 'job-1',
          type: 'seo-bulk-analyze',
          status: 'done',
          message: 'Finished analysis',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          workspaceId: 'ws_1',
          dismissed: false,
        },
      ],
      dismissJob: vi.fn(),
      cancelJob: vi.fn(),
      clearDone: vi.fn(),
    } as ReturnType<typeof useBackgroundTasks>);
  });

  it('renders actions, alerts, and system sections in one hub', () => {
    render(
      <MemoryRouter initialEntries={['/ws/ws_1/home']}>
        <NotificationBell onSelectWorkspace={vi.fn()} workspaceId="ws_1" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTitle('Notifications'));

    expect(screen.getByText('Actions Needed')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('System Events')).toBeInTheDocument();
    expect(screen.getByText('2 new requests')).toBeInTheDocument();
    expect(screen.getByText('1 critical anomaly')).toBeInTheDocument();
    expect(screen.getByText('Finished analysis')).toBeInTheDocument();
  });

  it('clears completed task rows from the unified hub', () => {
    const clearDone = vi.fn();
    mockUseBackgroundTasks.mockReturnValue({
      jobsForWorkspace: () => [
        {
          id: 'job-1',
          type: 'seo-bulk-analyze',
          status: 'done',
          message: 'Finished analysis',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          workspaceId: 'ws_1',
          dismissed: false,
        },
      ],
      dismissJob: vi.fn(),
      cancelJob: vi.fn(),
      clearDone,
    } as ReturnType<typeof useBackgroundTasks>);

    render(
      <MemoryRouter initialEntries={['/ws/ws_1/home']}>
        <NotificationBell onSelectWorkspace={vi.fn()} workspaceId="ws_1" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTitle('Notifications'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear completed' }));
    expect(clearDone).toHaveBeenCalledWith('ws_1');
  });
});
