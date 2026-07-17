import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FEATURE_FLAGS, type FeatureFlagKey } from '../../../shared/types/feature-flags';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  aiVisibility: vi.fn(),
}));

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: () => mocks.featureFlagsList(),
    },
  };
});

vi.mock('../../../src/api/seo', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/seo')>('../../../src/api/seo');
  return {
    ...actual,
    rankTracking: {
      ...actual.rankTracking,
      aiVisibility: () => mocks.aiVisibility(),
    },
  };
});

import { useRebuildShellEnabled } from '../../../src/components/layout/RebuiltAppChrome';
import { REBUILT_SURFACES } from '../../../src/components/layout/rebuiltSurfaces';

function AiVisibilityRegistryReceiver() {
  const rebuildEnabled = useRebuildShellEnabled();
  const RebuiltSurface = REBUILT_SURFACES['ai-visibility'];

  if (!rebuildEnabled || !RebuiltSurface) {
    return <div data-testid="legacy-keywords-home">AI visibility remains in Keywords</div>;
  }

  return (
    <Suspense fallback={<div role="status">Opening AI Visibility…</div>}>
      <RebuiltSurface workspaceId="ws-1" />
    </Suspense>
  );
}

describe('AI Visibility rebuilt-shell flag transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aiVisibility.mockResolvedValue({ latest: null, trend: [], competitors: [], sourceDomains: [] });
  });

  it('mounts the registry-owned surface after the real flag query transitions loading to ON', async () => {
    let resolveFlags!: (flags: Record<FeatureFlagKey, boolean>) => void;
    mocks.featureFlagsList.mockReturnValue(new Promise<Record<FeatureFlagKey, boolean>>((resolve) => {
      resolveFlags = resolve;
    }));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/ws/ws-1/ai-visibility']}>
          <AiVisibilityRegistryReceiver />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('legacy-keywords-home')).toBeInTheDocument();

    await act(async () => {
      resolveFlags({ ...FEATURE_FLAGS, 'ui-rebuild-shell': true });
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: 'AI Visibility', level: 2 })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-keywords-home')).not.toBeInTheDocument();
  });
});
