import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIUsageSection } from '../../../src/components/AIUsageSection';
import FeatureLibrary from '../../../src/components/FeatureLibrary';

const mocks = vi.hoisted(() => ({
  featureGet: vi.fn(),
  getOptional: vi.fn(),
}));

vi.mock('../../../src/api/platform', () => ({
  features: { get: (...args: unknown[]) => mocks.featureGet(...args) },
}));

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return { ...actual, getOptional: (...args: unknown[]) => mocks.getOptional(...args) };
});

function renderQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.featureGet.mockReset();
  mocks.getOptional.mockReset();
});

describe('Global Ops Business loading composition', () => {
  it('keeps embedded Features in one skeleton composition without a duplicate page header', () => {
    mocks.featureGet.mockReturnValue(new Promise(() => {}));
    renderQuery(<FeatureLibrary embedded />);

    expect(screen.getByTestId('feature-library-loading')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Feature Library' })).not.toBeInTheDocument();
  });

  it('keeps Usage layout-preserving while the provider request is pending', () => {
    mocks.getOptional.mockReturnValue(new Promise(() => {}));
    renderQuery(<AIUsageSection compact />);

    expect(screen.getByLabelText('Loading AI usage')).toBeInTheDocument();
    expect(screen.getByText('AI Usage')).toBeInTheDocument();
  });

  it('renders a truthful Usage empty state instead of a blank panel', async () => {
    mocks.getOptional.mockResolvedValue(null);
    renderQuery(<AIUsageSection compact />);

    await waitFor(() => expect(screen.getByText('No usage in this period')).toBeInTheDocument());
  });

  it('keeps the compact date-range control reachable for provider-only usage', async () => {
    mocks.getOptional.mockResolvedValue({
      totalTokens: 0,
      estimatedCost: 0,
      daily: [],
      byFeature: [],
      dataforseo: { totalCredits: 3.25, totalCalls: 8, cachedCalls: 2 },
      dataforseoDaily: [],
    });
    renderQuery(<AIUsageSection compact />);

    expect(await screen.findByText('SEO Provider — DataForSEO')).toBeInTheDocument();
    const range = screen.getByRole('group', { name: 'Usage date range' });
    expect(within(range).getAllByRole('button')).toHaveLength(3);
    expect(within(range).getByRole('button', { name: '14d' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(range).getByRole('button', { name: '30d' }));
    await waitFor(() => expect(mocks.getOptional).toHaveBeenLastCalledWith('/api/ai/usage?days=30'));
  });

  it('renders one compact date-range control when AI and provider usage coexist', async () => {
    mocks.getOptional.mockResolvedValue({
      totalTokens: 100,
      estimatedCost: 0.05,
      daily: [{
        date: '2026-07-10',
        cost: 0.05,
        calls: 1,
        totalTokens: 100,
        openaiCost: 0.05,
        anthropicCost: 0,
        openaiTokens: 100,
        anthropicTokens: 0,
      }],
      byFeature: [],
      dataforseo: { totalCredits: 1.5, totalCalls: 3, cachedCalls: 1 },
      dataforseoDaily: [],
    });
    renderQuery(<AIUsageSection compact />);

    expect(await screen.findByText('Daily cost')).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Usage date range' })).toHaveLength(1);
  });
});
