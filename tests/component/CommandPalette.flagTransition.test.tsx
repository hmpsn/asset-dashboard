import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../../src/components/CommandPalette';
import type { Workspace } from '../../src/components/WorkspaceSelector';
import { FEATURE_FLAGS, type FeatureFlagKey } from '../../shared/types/feature-flags';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  startJob: vi.fn(),
  toast: vi.fn(),
  anomalyScan: vi.fn(),
}));

vi.mock('../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/misc')>('../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: () => mocks.featureFlagsList(),
    },
  };
});

vi.mock('../../src/api', () => ({
  anomalies: { scan: (...args: unknown[]) => mocks.anomalyScan(...args) },
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ startJob: mocks.startJob }),
}));

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const workspace: Workspace = {
  id: 'ws-palette-transition',
  name: 'Palette Transition',
  folder: 'palette-transition',
  createdAt: '2026-07-11T00:00:00.000Z',
  webflowSiteId: 'site-palette-transition',
};

describe('CommandPalette — real rebuilt-shell flag transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('moves from legacy navigation to rebuilt navigation when the real flag query resolves ON', async () => {
    let resolveFlags!: (flags: Record<FeatureFlagKey, boolean>) => void;
    mocks.featureFlagsList.mockReturnValue(new Promise<Record<FeatureFlagKey, boolean>>((resolve) => {
      resolveFlags = resolve;
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CommandPalette
            workspaces={[workspace]}
            selectedWorkspace={workspace}
            onSelectWorkspace={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Content Perf')).toBeInTheDocument();
    expect(screen.queryByText('Cockpit')).not.toBeInTheDocument();

    await act(async () => {
      resolveFlags({ ...FEATURE_FLAGS, 'ui-rebuild-shell': true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('Cockpit')).toBeInTheDocument();
    });
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByText('Content Perf')).not.toBeInTheDocument();
    expect(screen.getByText('Pipeline')).toBeInTheDocument();
  });
});
