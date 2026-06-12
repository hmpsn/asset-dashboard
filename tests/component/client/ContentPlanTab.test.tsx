import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ContentPlanTab } from '../../../src/components/client/ContentPlanTab';
import { contentPlanReview } from '../../../src/api/content';
import type { ContentMatrix } from '../../../src/components/matrix/types';

vi.mock('../../../src/api/content', () => ({
  contentPlanReview: {
    getPlans: vi.fn(),
    getPlan: vi.fn(),
    flagCell: vi.fn(),
  },
}));

vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

const mockedContentPlanReview = vi.mocked(contentPlanReview);

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderTab(setToast = vi.fn()) {
  const queryClient = makeQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContentPlanTab workspaceId="ws-content-plan" setToast={setToast} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient, setToast };
}

function makeMatrix(overrides: Partial<ContentMatrix> = {}): ContentMatrix {
  return {
    id: 'matrix-1',
    workspaceId: 'ws-content-plan',
    name: 'Spring Service Pages',
    templateId: 'template-1',
    dimensions: [
      { variableName: 'service', label: 'Service', values: ['Roof Repair'] },
      { variableName: 'city', label: 'City', values: ['Austin'] },
    ],
    urlPattern: '/{service}/{city}',
    keywordPattern: '{service} {city}',
    cells: [
      {
        id: 'cell-1',
        variableValues: { service: 'Roof Repair', city: 'Austin' },
        targetKeyword: 'roof repair austin',
        plannedUrl: '/roof-repair/austin',
        status: 'review',
      },
    ],
    stats: {
      total: 1,
      planned: 0,
      briefGenerated: 0,
      drafted: 0,
      reviewed: 1,
      published: 0,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openFlagForm() {
  await screen.findByText('Spring Service Pages');
  fireEvent.click(screen.getByText(/Roof Repair.*Austin/));
  fireEvent.click(await screen.findByRole('button', { name: /flag for changes/i }));
}

describe('ContentPlanTab flagging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedContentPlanReview.getPlans.mockResolvedValue([makeMatrix()]);
    mockedContentPlanReview.getPlan.mockResolvedValue(makeMatrix({
      cells: [
        {
          id: 'cell-1',
          variableValues: { service: 'Roof Repair', city: 'Austin' },
          targetKeyword: 'roof repair austin',
          plannedUrl: '/roof-repair/austin',
          status: 'flagged',
          clientFlag: 'Please target emergency intent instead.',
          clientFlaggedAt: '2026-06-11T10:00:00.000Z',
        },
      ],
    }));
  });

  it('shows optimistic flagged state immediately, then reconciles after success', async () => {
    const flagRequest = deferredPromise<{ ok: boolean }>();
    mockedContentPlanReview.flagCell.mockReturnValue(flagRequest.promise);
    const { setToast } = renderTab();

    await openFlagForm();
    fireEvent.change(screen.getByPlaceholderText('Describe what needs to change...'), {
      target: { value: 'Please target emergency intent instead.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));

    await waitFor(() => {
      expect(screen.getByText('Please target emergency intent instead.')).toBeInTheDocument();
      expect(mockedContentPlanReview.flagCell).toHaveBeenCalledWith(
        'ws-content-plan',
        'matrix-1',
        'cell-1',
        'Please target emergency intent instead.',
      );
    });

    await act(async () => {
      flagRequest.resolve({ ok: true });
      await flagRequest.promise;
    });

    await waitFor(() => {
      expect(mockedContentPlanReview.getPlan).toHaveBeenCalledWith('ws-content-plan', 'matrix-1');
      expect(setToast).toHaveBeenCalledWith({
        message: 'Thanks - your feedback was sent to the team.',
        type: 'success',
      });
    });
  });

  it('keeps the optimistic flagged state when the follow-up refresh fails after a successful flag', async () => {
    mockedContentPlanReview.flagCell.mockResolvedValue({ ok: true });
    mockedContentPlanReview.getPlan.mockRejectedValue(new Error('Refresh failed'));
    const { setToast } = renderTab();

    await openFlagForm();
    fireEvent.change(screen.getByPlaceholderText('Describe what needs to change...'), {
      target: { value: 'Please target emergency intent instead.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));

    await waitFor(() => {
      expect(mockedContentPlanReview.getPlan).toHaveBeenCalledWith('ws-content-plan', 'matrix-1');
      expect(screen.getByText('Please target emergency intent instead.')).toBeInTheDocument();
      expect(setToast).toHaveBeenCalledWith({
        message: 'Thanks - your feedback was sent to the team.',
        type: 'success',
      });
    });
    expect(setToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('rolls back optimistic flagged state when the API fails', async () => {
    const flagRequest = deferredPromise<{ ok: boolean }>();
    mockedContentPlanReview.flagCell.mockReturnValue(flagRequest.promise);
    const { setToast } = renderTab();

    await openFlagForm();
    fireEvent.change(screen.getByPlaceholderText('Describe what needs to change...'), {
      target: { value: 'Please target emergency intent instead.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));

    await waitFor(() => {
      expect(screen.getByText('Please target emergency intent instead.')).toBeInTheDocument();
    });

    await act(async () => {
      flagRequest.reject(new Error('Server unavailable'));
      try {
        await flagRequest.promise;
      } catch {
        // Expected rejection for rollback coverage.
      }
    });

    await waitFor(() => {
      expect(screen.queryByText('Please target emergency intent instead.')).not.toBeInTheDocument();
      expect(setToast).toHaveBeenCalledWith({ message: 'Server unavailable', type: 'error' });
    });
  });
});
