import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from '../../src/components/CommandPalette';
import { adminPath } from '../../src/routes';
import type { Workspace } from '../../src/components/WorkspaceSelector';

const navigateMock = vi.fn();
const useFeatureFlagMock = vi.fn();
const anomalyScanMock = vi.fn();
const auditEnableMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...args),
}));

vi.mock('../../src/api', () => ({
  anomalies: {
    scan: (...args: unknown[]) => anomalyScanMock(...args),
  },
  auditSchedules: {
    enable: (...args: unknown[]) => auditEnableMock(...args),
  },
}));

const ws: Workspace = {
  id: 'ws-1',
  name: 'Acme Workspace',
  folder: 'acme-workspace',
  createdAt: '2026-05-16T00:00:00.000Z',
};

describe('CommandPalette', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    anomalyScanMock.mockReset();
    auditEnableMock.mockReset();
    useFeatureFlagMock.mockReset();
    useFeatureFlagMock.mockReturnValue(false);
    localStorage.clear();
  });

  it('is closed by default', () => {
    render(
      <CommandPalette
        workspaces={[ws]}
        selectedWorkspace={ws}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.queryByPlaceholderText('Search tools, workspaces, actions...')).not.toBeInTheDocument();
  });

  it('opens with cmd/ctrl + k and shows no-results message for unmatched query', () => {
    render(
      <CommandPalette
        workspaces={[ws]}
        selectedWorkspace={ws}
        onSelectWorkspace={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'zzzz-no-match' } });
    expect(screen.getByText('No results for "zzzz-no-match"')).toBeInTheDocument();
  });

  it('selects a workspace item when clicked', () => {
    const onSelectWorkspace = vi.fn();

    render(
      <CommandPalette
        workspaces={[ws]}
        selectedWorkspace={ws}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.click(screen.getByText('Acme Workspace'));

    expect(onSelectWorkspace).toHaveBeenCalledWith(ws);
    expect(navigateMock).toHaveBeenCalledWith(adminPath('ws-1'));
  });
});
