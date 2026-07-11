// @ds-rebuilt
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessLens } from '../../../src/components/global-ops-rebuilt/BusinessLens';
import { ToastProvider } from '../../../src/components/Toast';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  aiUsageProps: vi.fn(),
  featureLibraryProps: vi.fn(),
}));

vi.mock('../../../src/hooks/admin/useWorkspaces', () => ({
  useCreateWorkspace: () => ({ mutate: mocks.createWorkspace, isPending: false }),
}));

vi.mock('../../../src/components/RevenueDashboard', () => ({
  RevenueDashboard: () => (
    <div data-testid="revenue-panel">
      <button type="button">Purge All</button>
      <button type="button">Delete payment</button>
    </div>
  ),
}));

vi.mock('../../../src/components/AIUsageSection', () => ({
  AIUsageSection: (props: { compact?: boolean }) => {
    mocks.aiUsageProps(props);
    return (
      <div data-testid="ai-usage-panel">
        <button type="button">7d</button>
        <button type="button">14d</button>
        <button type="button">30d</button>
      </div>
    );
  },
}));

vi.mock('../../../src/components/FeatureLibrary', () => ({
  default: (props: { embedded?: boolean }) => {
    mocks.featureLibraryProps(props);
    return (
      <div data-testid="features-panel">
        <label htmlFor="feature-search">Search features</label>
        <input id="feature-search" />
        <button type="button">By Pain Point</button>
      </div>
    );
  },
}));

vi.mock('../../../src/components/SalesReport', () => ({
  SalesReport: () => (
    <div data-testid="prospects-panel">
      <button type="button">Run Report</button>
      <button type="button">Client Report</button>
      <button type="button">Onboard as Client</button>
    </div>
  ),
}));

function renderBusiness(ui: ReactElement, initialEntry = '/revenue') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.createWorkspace.mockReset();
  mocks.aiUsageProps.mockReset();
  mocks.featureLibraryProps.mockReset();
  window.location.hash = '';
});

describe('Global Ops Business visual composition', () => {
  it('uses the measured source frame, compact header, and icon-led source tab order', async () => {
    const { container } = renderBusiness(<BusinessLens />, '/revenue');

    const canvas = screen.getByTestId('business-rebuilt');
    expect(canvas).toHaveClass('max-w-[1080px]', 'sm:px-[30px]');
    expect(screen.getByRole('heading', { level: 1, name: 'Business' })).toHaveClass('t-h2', '!font-bold');
    expect(screen.getByText('Revenue, AI usage, the feature library, and prospect reports')).toBeInTheDocument();

    const tray = screen.getByTestId('business-tab-tray');
    const tabs = within(tray).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Revenue', 'Usage', 'Features', 'Prospects']);
    expect(tabs[0].querySelector('.fa-trophy')).not.toBeNull();
    expect(tabs[1].querySelector('.fa-gauge')).not.toBeNull();
    expect(tabs[2].querySelector('.fa-layer-group')).not.toBeNull();
    expect(tabs[3].querySelector('.fa-user')).not.toBeNull();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('data-business-panel', 'revenue');
    expect(panel).toHaveAttribute('aria-labelledby', 'business-tab-revenue');
    expect(screen.getAllByRole('button', { name: 'Purge All' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete payment' })).toHaveLength(1);
    expect(screen.queryByText('Unified business view')).not.toBeInTheDocument();
    expect(screen.queryByText('Live operations')).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('changes panels with one exact capability home and preserves keyboard navigation', () => {
    renderBusiness(<BusinessLens />, '/revenue');
    const tabs = within(screen.getByTestId('business-tab-tray')).getAllByRole('tab');

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    expect(screen.getByTestId('revenue-panel')).toBeInTheDocument();

    fireEvent.keyDown(tabs[1], { key: 'Enter' });
    expect(screen.getByTestId('business-rebuilt')).toHaveAttribute('data-active-tab', 'ai-usage');
    expect(screen.getAllByTestId('ai-usage-panel')).toHaveLength(1);
    expect(mocks.aiUsageProps).toHaveBeenCalledWith(expect.objectContaining({ compact: true }));
    expect(screen.queryByTestId('revenue-panel')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '14d' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Features' }));
    expect(screen.getAllByTestId('features-panel')).toHaveLength(1);
    expect(mocks.featureLibraryProps).toHaveBeenCalledWith(expect.objectContaining({ embedded: true }));
    expect(screen.getAllByRole('textbox', { name: 'Search features' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Prospects' }));
    expect(screen.getAllByTestId('prospects-panel')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Run Report' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Client Report' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Onboard as Client' })).toHaveLength(1);
  });

  it.each([
    ['/revenue', 'revenue', 'revenue-panel'],
    ['/ai-usage', 'ai-usage', 'ai-usage-panel'],
    ['/features', 'features', 'features-panel'],
    ['/prospect', 'prospects', 'prospects-panel'],
  ])('keeps the %s route alias initialized to %s', (route, activeTab, panelTestId) => {
    renderBusiness(<BusinessLens />, route);
    expect(screen.getByTestId('business-rebuilt')).toHaveAttribute('data-active-tab', activeTab);
    expect(screen.getAllByTestId(panelTestId)).toHaveLength(1);
  });

  it('keeps validated query initialization and the page-default invalid fallback', () => {
    renderBusiness(<BusinessLens defaultTab="ai-usage" />, '/ai-usage?tab=unknown');
    expect(screen.getByTestId('business-rebuilt')).toHaveAttribute('data-active-tab', 'ai-usage');
    expect(screen.getByTestId('business-invalid-tab-fallback')).toHaveTextContent('Business opened AI Usage');
  });

  it('keeps the prospect report onboarding handoff compact and connected to the real workspace mutation', async () => {
    window.location.hash = '#new-workspace?url=https%3A%2F%2Fcedar-and-co.com%2Fservices';
    mocks.createWorkspace.mockImplementation((_payload, options) => options.onSuccess());

    renderBusiness(<BusinessLens />, '/revenue');

    await waitFor(() => expect(screen.getByTestId('business-rebuilt')).toHaveAttribute('data-active-tab', 'prospects'));
    expect(screen.getByText('Create workspace from prospect')).toBeInTheDocument();
    expect(screen.getByText('cedar-and-co.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Workspace name')).toHaveValue('Cedar And Co');

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(mocks.createWorkspace).toHaveBeenCalledWith(
      { name: 'Cedar And Co' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.queryByText('Create workspace from prospect')).not.toBeInTheDocument());
  });
});
