import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
});
