import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BlueprintDetail } from '../../../src/components/brand/BlueprintDetail';
import type { SiteBlueprint } from '../../../shared/types/page-strategy';

const useBlueprintMock = vi.fn();
const useFeatureFlagMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
    useMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    }),
  };
});

vi.mock('../../../src/hooks/admin/useBlueprints', () => ({
  useBlueprint: (...args: unknown[]) => useBlueprintMock(...args),
}));

vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...args),
}));

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../../../src/hooks/admin/useCopyPipeline', () => ({
  useCopyStatus: () => ({ data: null }),
  useGenerateCopy: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
}));

function renderBlueprintDetail(onBack: () => void) {
  return render(
    <MemoryRouter>
      <BlueprintDetail workspaceId="ws-risk" blueprintId="bp-1" onBack={onBack} />
    </MemoryRouter>,
  );
}

function sampleBlueprint(): SiteBlueprint {
  return {
    id: 'bp-1',
    workspaceId: 'ws-risk',
    name: 'Core Pages Blueprint',
    version: 2,
    status: 'draft',
    entries: [],
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
  };
}

describe('BlueprintDetail', () => {
  beforeEach(() => {
    useBlueprintMock.mockReset();
    useFeatureFlagMock.mockReset();
    invalidateQueriesMock.mockReset();

    useFeatureFlagMock.mockReturnValue(false);
    useBlueprintMock.mockReturnValue({
      data: sampleBlueprint(),
      isLoading: false,
      isError: false,
    });
  });

  it('renders loading state while blueprint is fetching', () => {
    useBlueprintMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    renderBlueprintDetail(vi.fn());

    expect(screen.getByText('Loading blueprint...')).toBeInTheDocument();
  });

  it('renders error state and back action when blueprint load fails', () => {
    const onBack = vi.fn();
    useBlueprintMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderBlueprintDetail(onBack);

    expect(screen.getByText('Blueprint not found or failed to load.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to blueprints/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders pages tab with empty in-scope message for a valid blueprint', () => {
    renderBlueprintDetail(vi.fn());

    expect(screen.getByText('Core Pages Blueprint')).toBeInTheDocument();
    expect(screen.getByText('No pages in scope yet. Add one above.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Copy Pipeline' })).not.toBeInTheDocument();
  });
});
