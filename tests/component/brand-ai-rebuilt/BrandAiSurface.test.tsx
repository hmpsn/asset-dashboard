// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
          <main>
            <BrandAiSurface workspaceId="ws-brand-ai" />
          </main>
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

  it('renders the prototype grouped context layout with no modal or legacy child panel on overview', async () => {
    renderSurface('/ws/ws-brand-ai/brand');

    await screen.findByText('Read by every AI action');

    expect(screen.getAllByText('Voice & Messaging').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Knowledge').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Audience').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Business Facts & Trust').length).toBeGreaterThan(0);
    expect(screen.getByText('How this context is used')).toBeInTheDocument();
    expect(screen.getByText('Brand voice & style')).toBeInTheDocument();
    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expect(screen.getByText('Business footprint')).toBeInTheDocument();
    expect(screen.getByText('Brand voice & style')).toHaveClass('t-ui');
    expect(screen.getByText('Warm and precise.')).toHaveClass('t-body');
    expect(screen.getByText('Content briefs & posts').closest('p')).toHaveClass('t-body');
    expect(screen.getByText('Generation drafts empty fields for Acme Dental; operators review before anything becomes source context.')).toHaveClass('t-body');
    expect(screen.getAllByText('Brand identity generators')).toHaveLength(1);
    expect(screen.getByText('7 generators')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Brand AI view controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Brandscript' })).not.toBeInTheDocument();
    expect(screen.queryByText('Work areas')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI readiness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-overview-panel')).not.toBeInTheDocument();

    const internalPhrases = [
      'T1 carry-over',
      'Route tab',
      'URL state',
      'Mounted below',
      'Legacy aliases',
      'Carry-over contract',
      'carried-over',
      'existing route tab contract',
    ];

    for (const phrase of internalPhrases) {
      expect(screen.queryByText(new RegExp(phrase, 'i'))).not.toBeInTheDocument();
    }
  });

  it('opens Brandscript in a modal from a runtime ?tab= param', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=brandscript');

    expect(await screen.findByRole('dialog', { name: 'Brandscript' })).toBeInTheDocument();
    await screen.findByTestId('legacy-brandscript-panel');
    expect(screen.getByText('StoryBrand framework and section editing stay available here.')).toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-brandscript-panel')).toHaveLength(1);
  });

  it('opens E-E-A-T assets and brand identity in modal workflows exactly once', async () => {
    const { unmount } = renderSurface('/ws/ws-brand-ai/brand?tab=eeat-assets');

    expect(await screen.findByRole('dialog', { name: 'Trust evidence' })).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-eeat-assets-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-eeat-assets-panel')).toHaveLength(1);

    unmount();

    renderSurface('/ws/ws-brand-ai/brand?tab=identity');

    expect(await screen.findByRole('dialog', { name: 'Brand identity' })).toBeInTheDocument();
    expect(screen.getByText('Generator workflow')).toBeInTheDocument();
    expect(screen.getByText('Review and approve deliverables before they become reusable AI context.')).toBeInTheDocument();
    expect(screen.getByText('Generate, refine, approve, edit, and export brand deliverables.')).toHaveClass('t-body');
    expect(screen.getByText('Review and approve deliverables before they become reusable AI context.')).toHaveClass('t-body');
    const generatorSteps = screen.getByLabelText('Brand identity generator steps');
    for (const step of ['Generate', 'Refine', 'Edit', 'Approve', 'Export']) {
      expect(within(generatorSteps).getByText(step)).toBeInTheDocument();
    }
    expect(await screen.findByTestId('legacy-identity-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-identity-panel')).toHaveLength(1);
  });

  it('preserves legacy business-footprint aliases and forwards focus receivers inside the modal', async () => {
    const { unmount } = renderSurface('/ws/ws-brand-ai/brand?tab=business-profile&focus=business-profile-section');

    expect(await screen.findByRole('dialog', { name: 'Business facts' })).toBeInTheDocument();
    await screen.findByTestId('legacy-business-footprint-panel');
    expect(screen.getByTestId('legacy-business-footprint-panel')).toHaveTextContent('business-profile');
    expect(screen.getAllByTestId('legacy-business-footprint-panel')).toHaveLength(1);

    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    unmount();

    renderSurface('/ws/ws-brand-ai/brand?tab=locations&focus=locations-section');

    expect(await screen.findByRole('dialog', { name: 'Business facts' })).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-business-footprint-panel')).toHaveTextContent('locations');
    expect(screen.getAllByTestId('legacy-business-footprint-panel')).toHaveLength(1);
  });

  it('opens workflow modals from overview rows without a top tab strip', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=overview');

    await screen.findByText('Read by every AI action');
    const discoveryRow = screen.getByText('Discovery').closest('button');
    expect(discoveryRow).not.toBeNull();
    fireEvent.click(discoveryRow!);

    expect(await screen.findByRole('dialog', { name: 'Discovery intake' })).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-discovery-panel')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Brand AI view controls' })).not.toBeInTheDocument();
  });

  it('renders prototype workflow context for bespoke modal flows before carried panels', async () => {
    const cases = [
      {
        path: '/ws/ws-brand-ai/brand?tab=discovery',
        dialog: 'Discovery intake',
        frame: 'Discovery intake workflow',
        copy: ['Source of truth', 'Uploaded documents', 'Founder interview', 'Regenerate Knowledge Base'],
        panel: 'legacy-discovery-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=brandscript',
        dialog: 'Brandscript',
        frame: 'Brandscript workflow',
        copy: ['Seven-part narrative', 'Hero', 'Problem', 'Guide', 'Failure'],
        panel: 'legacy-brandscript-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=eeat-assets',
        dialog: 'Trust evidence',
        frame: 'Trust evidence workflow',
        copy: ['E-E-A-T signals', 'Experience', 'Expertise', 'Authority', 'Trust'],
        panel: 'legacy-eeat-assets-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=business-profile&focus=locations-section',
        dialog: 'Business facts',
        frame: 'Business facts workflow',
        copy: ['Locations & service areas', 'Primary location', 'Service areas', 'Review detected geos'],
        panel: 'legacy-business-footprint-panel',
      },
    ] as const;

    for (const testCase of cases) {
      const { unmount } = renderSurface(testCase.path);

      expect(await screen.findByRole('dialog', { name: testCase.dialog })).toBeInTheDocument();
      const frame = await screen.findByLabelText(testCase.frame);
      for (const text of testCase.copy) {
        expect(within(frame).getByText(text)).toBeInTheDocument();
      }
      expect(await screen.findByTestId(testCase.panel)).toBeInTheDocument();
      expect(screen.getAllByTestId(testCase.panel)).toHaveLength(1);

      unmount();
    }
  });

  it('renders prototype workflow context for context, voice, and strategy intelligence modals', async () => {
    const cases = [
      {
        path: '/ws/ws-brand-ai/brand?tab=context',
        dialog: 'Context editors',
        frame: 'Context editors workflow',
        copy: ['Reusable AI context', 'Voice & style', 'Knowledge base', 'Personas', 'Page guidance'],
        panel: 'legacy-context-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=voice',
        dialog: 'Voice calibration',
        frame: 'Voice calibration workflow',
        copy: ['Voice DNA calibration', 'Samples', 'Guardrails', 'Similarity review', 'Approve for generation'],
        panel: 'legacy-voice-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=intelligence-profile',
        dialog: 'Strategy intelligence',
        frame: 'Strategy intelligence workflow',
        copy: ['Strategy inputs', 'Industry', 'Goals', 'Audience', 'Business priorities'],
        panel: 'legacy-intelligence-profile-panel',
      },
    ] as const;

    for (const testCase of cases) {
      const { unmount } = renderSurface(testCase.path);

      expect(await screen.findByRole('dialog', { name: testCase.dialog })).toBeInTheDocument();
      const frame = await screen.findByLabelText(testCase.frame);
      for (const text of testCase.copy) {
        expect(within(frame).getByText(text)).toBeInTheDocument();
      }
      expect(await screen.findByTestId(testCase.panel)).toBeInTheDocument();
      expect(screen.getAllByTestId(testCase.panel)).toHaveLength(1);

      unmount();
    }
  });

  it('opens Brand identity from the Voice & Messaging generator disclosure', async () => {
    renderSurface('/ws/ws-brand-ai/brand');

    await screen.findByText('Read by every AI action');
    fireEvent.click(screen.getByText('Brand identity generators'));
    fireEvent.click(screen.getByRole('button', { name: /Tagline/i }));

    expect(await screen.findByRole('dialog', { name: 'Brand identity' })).toBeInTheDocument();
    expect(screen.getByText('Generator workflow')).toBeInTheDocument();
    const generatorSteps = screen.getByLabelText('Brand identity generator steps');
    expect(within(generatorSteps).getByText('Generate')).toBeInTheDocument();
    expect(within(generatorSteps).getByText('Export')).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-identity-panel')).toBeInTheDocument();
  });

  it('closes a workflow modal back to the overview state', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=brandscript');

    expect(await screen.findByRole('dialog', { name: 'Brandscript' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Read by every AI action')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-brandscript-panel')).not.toBeInTheDocument();
  });

  it('renders the context lens as a chromeless BrandHub leaf with no nested tab shell', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=context');

    expect(await screen.findByRole('dialog', { name: 'Context editors' })).toBeInTheDocument();
    await screen.findByTestId('legacy-context-panel');

    expect(screen.getByTestId('legacy-brandhub-active-tab')).toHaveTextContent('context');
    expect(screen.getAllByRole('heading', { name: 'Brand & AI' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Brand & AI Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Legacy BrandHub tabs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('does not mount duplicate panels inside modal workflows', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=voice');

    expect(await screen.findByRole('dialog', { name: 'Voice calibration' })).toBeInTheDocument();
    await screen.findByTestId('legacy-voice-panel');

    expect(screen.getByText('Shape voice DNA, samples, guardrails, and calibration sessions.')).toBeInTheDocument();
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
  ])('mounts the %s workflow panel exactly once when open', async (tab, testId) => {
    renderSurface(`/ws/ws-brand-ai/brand?tab=${tab}`);

    if (tab === 'overview') {
      await screen.findByText('Read by every AI action');
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } else {
      await screen.findByTestId(testId);
      expect(screen.getAllByTestId(testId)).toHaveLength(1);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }
  });

  it('meets the rebuilt a11y floor after the loaded cockpit settles', async () => {
    const { baseElement } = renderSurface('/ws/ws-brand-ai/brand?tab=identity');

    expect(await screen.findByRole('dialog', { name: 'Brand identity' })).toBeInTheDocument();
    await screen.findByTestId('legacy-identity-panel');
    await expectNoA11yViolations(baseElement);
  }, 15_000);
});
