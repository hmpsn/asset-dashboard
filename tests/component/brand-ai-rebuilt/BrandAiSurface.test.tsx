// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandAiSurface } from '../../../src/components/brand-ai-rebuilt/BrandAiSurface';
import { ToastProvider } from '../../../src/components/Toast';
import { queryKeys } from '../../../src/lib/queryKeys';
import { expectNoA11yViolations } from '../a11y';

const workspaceGetByIdMock = vi.fn();
const featureFlagsListMock = vi.fn();

vi.mock('../../../src/api', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api')>('../../../src/api');
  return {
    ...actual,
    workspaces: {
      ...actual.workspaces,
      getById: (...args: unknown[]) => workspaceGetByIdMock(...args),
    },
  };
});

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: (...args: unknown[]) => featureFlagsListMock(...args),
    },
  };
});

vi.mock('../../../src/components/BrandHub', () => ({
  BrandHub: ({
    workspaceId,
    webflowSiteId,
    chromeless,
    activeTab,
  }: {
    workspaceId: string;
    webflowSiteId?: string;
    chromeless?: boolean;
    activeTab?: string;
  }) => (
    <div data-testid="legacy-context-panel">
      {!chromeless && (
        <>
          <h1>Brand & AI Context</h1>
          <div role="tablist" aria-label="Legacy BrandHub tabs">
            <button type="button" role="tab">Context</button>
          </div>
        </>
      )}
      <span data-testid="legacy-brandhub-active-tab">{activeTab ?? 'uncontrolled'}</span>
      Legacy context panel {workspaceId} {webflowSiteId}
    </div>
  ),
}));

vi.mock('../../../src/components/brand/BrandOverviewTab', () => ({
  BrandOverviewTab: ({ personasCount }: { personasCount: number }) => (
    <div data-testid="legacy-overview-panel">Legacy overview panel {personasCount}</div>
  ),
}));

vi.mock('../../../src/components/brand/BrandscriptTab', () => ({
  BrandscriptTab: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="legacy-brandscript-panel">Legacy brandscript panel {workspaceId}</div>
  ),
}));

vi.mock('../../../src/components/brand/DiscoveryTab', () => ({
  DiscoveryTab: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="legacy-discovery-panel">Legacy discovery panel {workspaceId}</div>
  ),
}));

vi.mock('../../../src/components/brand/VoiceTab', () => ({
  VoiceTab: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="legacy-voice-panel">Legacy voice panel {workspaceId}</div>
  ),
}));

vi.mock('../../../src/components/brand/IdentityTab', () => ({
  IdentityTab: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="legacy-identity-panel">Legacy identity panel {workspaceId}</div>
  ),
}));

vi.mock('../../../src/components/settings/BusinessFootprintTab', () => ({
  BusinessFootprintTab: ({ legacySection }: { legacySection?: string | null }) => (
    <div data-testid="legacy-business-footprint-panel">
      Legacy business footprint panel {legacySection ?? 'none'}
    </div>
  ),
}));

vi.mock('../../../src/components/settings/EeatAssetsTab', () => ({
  EeatAssetsTab: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="legacy-eeat-assets-panel">Legacy E-E-A-T assets panel {workspaceId}</div>
  ),
}));

vi.mock('../../../src/components/settings/IntelligenceProfileTab', () => ({
  IntelligenceProfileTab: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="legacy-intelligence-profile-panel">Legacy intelligence profile panel {workspaceId}</div>
  ),
}));

const workspace = {
  id: 'ws-brand-ai',
  name: 'Acme Dental',
  createdAt: '2026-07-01T12:00:00.000Z',
  updatedAt: '2026-07-06T12:00:00.000Z',
  webflowSiteId: 'site-1',
  liveDomain: 'acme.example',
  brandVoice: 'Warm and precise.',
  knowledgeBase: 'Dental services and trust proof.',
  personas: [
    {
      id: 'p1',
      name: 'Anxious parent',
      description: 'Needs clear reassurance.',
      painPoints: ['Cost uncertainty'],
      goals: ['Book confidently'],
      objections: ['Will this hurt?'],
      preferredContentFormat: 'FAQs',
      buyingStage: 'consideration',
    },
  ],
  businessProfile: {
    email: 'hello@acme.example',
    phone: '555-0100',
    address: { city: 'Austin', state: 'TX' },
  },
  keywordStrategy: { businessContext: 'Family dental clinic.' },
  intelligenceProfile: {
    industry: 'Dental',
    goals: ['Book consults'],
    targetAudience: 'Families',
  },
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

function createQueryClient(seedFlag = true): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  if (seedFlag) {
    client.setQueryData(queryKeys.shared.featureFlags(), { 'ui-rebuild-shell': true });
  }
  return client;
}

function renderSurface(path: string, client = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <BrandAiSurface workspaceId="ws-brand-ai" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BrandAiSurface rebuilt cockpit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceGetByIdMock.mockResolvedValue(workspace);
    featureFlagsListMock.mockResolvedValue({ 'ui-rebuild-shell': true });
  });

  it('uses the real feature flag hook through loading(default) to loaded(true)', async () => {
    let resolveFlags: (value: { 'ui-rebuild-shell': boolean }) => void = () => {};
    featureFlagsListMock.mockReturnValue(new Promise((resolve) => {
      resolveFlags = resolve;
    }));

    const { container } = renderSurface('/ws/ws-brand-ai/brand', createQueryClient(false));

    expect(container.querySelector('[data-rebuild-flag="default"]')).toBeInTheDocument();

    resolveFlags({ 'ui-rebuild-shell': true });

    await waitFor(() => {
      expect(container.querySelector('[data-rebuild-flag="on"]')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Brand & AI' })).toBeInTheDocument();
  });

  it('receives runtime ?tab= params and renders the matching carry-over panel', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=brandscript');

    await screen.findByTestId('legacy-brandscript-panel');
    expect(screen.getByRole('radio', { name: 'Brandscript' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('HEAD StoryBrand template carries 8 sections.')).toBeInTheDocument();
  });

  it('preserves a legacy business-profile alias and forwards the focus receiver', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=business-profile&focus=business-profile-section');

    await screen.findByTestId('legacy-business-footprint-panel');
    expect(screen.getByRole('radio', { name: 'Business Footprint' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('legacy-business-footprint-panel')).toHaveTextContent('business-profile');
  });

  it('switches cockpit lenses through validated URL state without a new group param', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=overview');

    await screen.findByTestId('legacy-overview-panel');
    fireEvent.click(screen.getByRole('radio', { name: 'Discovery' }));

    expect(await screen.findByTestId('legacy-discovery-panel')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Discovery' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: 'group' })).not.toBeInTheDocument();
  });

  it('renders the context lens as a chromeless BrandHub leaf with no nested tab shell', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=context');

    await screen.findByTestId('legacy-context-panel');

    expect(screen.getByTestId('legacy-brandhub-active-tab')).toHaveTextContent('context');
    expect(screen.getAllByRole('heading', { name: 'Brand & AI' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Brand & AI Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Legacy BrandHub tabs' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
  });

  it('does not open a duplicate-panel drill-in from the active lens summary', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=voice');

    await screen.findByTestId('legacy-voice-panel');

    expect(screen.getByText('Voice Calibration')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Voice Calibration' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-voice-panel')).toHaveLength(1);
  });

  it.each([
    ['overview', 'legacy-overview-panel'],
    ['context', 'legacy-context-panel'],
    ['brandscript', 'legacy-brandscript-panel'],
    ['discovery', 'legacy-discovery-panel'],
    ['voice', 'legacy-voice-panel'],
    ['identity', 'legacy-identity-panel'],
    ['business-footprint', 'legacy-business-footprint-panel'],
    ['eeat-assets', 'legacy-eeat-assets-panel'],
    ['intelligence-profile', 'legacy-intelligence-profile-panel'],
  ])('mounts the %s lens panel exactly once', async (tab, testId) => {
    renderSurface(`/ws/ws-brand-ai/brand?tab=${tab}`);

    await screen.findByTestId(testId);

    expect(screen.getAllByTestId(testId)).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('meets the rebuilt a11y floor after the loaded cockpit settles', async () => {
    const { container } = renderSurface('/ws/ws-brand-ai/brand?tab=identity');

    await screen.findByTestId('legacy-identity-panel');
    await expectNoA11yViolations(container);
  }, 15_000);
});
