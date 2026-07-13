// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleasedBrandDeliverableType } from '../../../shared/types/brand-engine';
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
  BrandscriptTab: ({
    workspaceId,
    focusFirstExisting,
    onClearFocus,
  }: {
    workspaceId: string;
    focusFirstExisting?: boolean;
    onClearFocus?: () => void;
  }) => (
    <div data-testid="legacy-brandscript-panel" data-focus={focusFirstExisting ? 'existing' : 'library'}>
      Legacy brandscript panel {workspaceId}
      {focusFirstExisting && <button type="button" onClick={onClearFocus}>View all brandscripts</button>}
    </div>
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
  IdentityTab: ({
    workspaceId,
    focusType,
    onClearFocus,
  }: {
    workspaceId: string;
    focusType?: ReleasedBrandDeliverableType | null;
    onClearFocus?: () => void;
  }) => (
    <div data-testid="legacy-identity-panel" data-focus={focusType ?? 'library'}>
      Legacy identity panel {workspaceId}
      {focusType && <button type="button" onClick={onClearFocus}>View all brand identity</button>}
    </div>
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
            <LocationProbe />
          </main>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="brand-ai-location-search">{location.search}</output>;
}

function currentSearchParams(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('brand-ai-location-search').textContent ?? '');
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
    expect(screen.getByText('Brand & AI · Acme Dental')).toBeInTheDocument();
  });

  it('shows refresh success when the workspace refetch result succeeds', async () => {
    renderSurface('/ws/ws-brand-ai/brand');

    await screen.findByText('Read by every AI action');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh context' }));

    expect(await screen.findByText('Brand AI data refreshed')).toBeInTheDocument();
  });

  it('reports a resolved React Query error instead of false refresh success', async () => {
    workspaceGetByIdMock
      .mockResolvedValueOnce(workspace)
      .mockRejectedValueOnce(new Error('brand context unavailable'));
    renderSurface('/ws/ws-brand-ai/brand');

    await screen.findByText('Read by every AI action');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh context' }));

    expect(await screen.findByText('brand context unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Brand AI data refreshed')).not.toBeInTheDocument();
  });

  it('renders the prototype grouped context layout with no modal or legacy child panel on overview', async () => {
    renderSurface('/ws/ws-brand-ai/brand');

    await screen.findByText('Read by every AI action');

    expect(screen.getByRole('heading', { name: 'Brand & AI' })).toHaveClass('sr-only');
    expect(screen.getByTestId('brand-ai-opening-eyebrow')).toHaveClass('eyebrow', 'text-[var(--purple)]');
    expect(screen.getByTestId('brand-ai-rebuilt-surface')).toHaveClass('max-w-[var(--page-max)]', 'lg:px-2', '2xl:px-5');
    expect(screen.getByText(/The context the platform reads/).closest('p')).toHaveClass('max-w-2xl');
    expect(screen.getByTestId('brand-ai-topbar-actions-fallback')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refresh context' })).toHaveLength(1);
    expect(screen.getAllByText('Voice & Messaging').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Knowledge').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Audience').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Business Facts & Trust').length).toBeGreaterThan(0);
    expect(screen.getByText('How this context is used')).toBeInTheDocument();
    expect(screen.getByText('Brand voice & style')).toBeInTheDocument();
    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expect(screen.getByText('Business footprint')).toBeInTheDocument();
    expect(screen.getByText('Brand voice & style')).toHaveClass('t-ui');
    expect(screen.getByText('Warm and precise.')).toHaveClass('t-caption-sm', 'line-clamp-2', 'leading-snug');
    expect(screen.getByText('Warm and precise.')).not.toHaveClass('block');
    expect(screen.getByText('Content briefs & posts').closest('p')).toHaveClass('t-caption-sm');
    expect(screen.getByText('How this context is used')).toHaveClass('t-body');
    expect(screen.getByText('How this context is used').closest('[class*="rounded"]')).toHaveClass('[&>div:first-child>div>span:last-child]:![font-size:var(--type-ui-size)]', '[&>div:first-child>div>span:last-child]:!font-bold');
    expect(document.querySelector('#brand-context-voice .t-stat-sm')).toHaveClass('t-stat-sm', 'font-extrabold');
    const usageCard = screen.getByText('How this context is used').closest('[class*="rounded"]');
    const movedCard = screen.getByText('Also on this client').closest('[class*="rounded"]');
    expect(usageCard).not.toBeNull();
    expect(movedCard).not.toBeNull();
    const generateLauncher = within(usageCard as HTMLElement).getByRole('button', { name: 'Generate from website' });
    expect(generateLauncher).toBeInTheDocument();
    expect(generateLauncher.querySelector('.t-caption-sm')).toHaveClass('leading-snug');
    expect(generateLauncher).toHaveTextContent('Generate from website opens Discovery for Acme Dental — review sources before they become reusable context.');
    expect(within(movedCard as HTMLElement).queryByRole('button', { name: 'Generate from website' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Generate from website' })).toHaveLength(1);
    expect(screen.getAllByRole('meter', { name: 'Voice & Messaging completeness' })[0].firstElementChild).toHaveStyle({ background: '#f87171' });
    expect(screen.getAllByText('Needs setup').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.getByTestId('brand-ai-configured-count')).toHaveTextContent('7/11');
    expect(screen.getByText('inputs configured')).toBeInTheDocument();
    expect(screen.getByTestId('brand-context-cockpit-content')).toHaveClass('gap-5', 'px-4', 'py-5');
    expect(screen.queryByText('context complete')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs a little more context')).not.toBeInTheDocument();
    expect(screen.getAllByText('Brand identity generators')).toHaveLength(4);
    expect(screen.getByText('7 generators')).toBeInTheDocument();
    expect(screen.getByText('2 generators')).toBeInTheDocument();
    expect(screen.getByText('5 generators')).toBeInTheDocument();
    expect(screen.getByText('3 generators')).toBeInTheDocument();
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

  it('derives readable overview prose from Markdown-backed source context', async () => {
    workspaceGetByIdMock.mockResolvedValue({
      ...workspace,
      brandVoice: '**Warm and precise.** --- ### Tone & Personality - **Friendly**',
    });

    renderSurface('/ws/ws-brand-ai/brand');

    const excerpt = await screen.findByText(/Warm and precise.*Tone & Personality.*Friendly/);
    expect(excerpt).toHaveTextContent('Warm and precise. · Tone & Personality Friendly');
    expect(excerpt).not.toHaveTextContent(/\*\*|###|---/);
  });

  it('opens Brandscript in a modal from a runtime ?tab= param', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=brandscript');

    expect(await screen.findByRole('dialog', { name: 'Brandscript' })).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-brandscript-panel')).toHaveAttribute('data-focus', 'library');
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

    const identityDialog = await screen.findByRole('dialog', { name: 'Brand identity' });
    expect(identityDialog).toHaveClass('max-w-[42.5rem]');
    expect(identityDialog).not.toHaveClass('max-w-[48rem]');
    expect(identityDialog).not.toHaveClass('max-w-[64rem]');
    expect(screen.getByText('Generate, refine, approve, edit, and export brand deliverables.')).toHaveClass('t-body');
    expect(screen.queryByText('Generator workflow')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Brand identity generator steps')).not.toBeInTheDocument();
    expect(await screen.findByTestId('legacy-identity-panel')).toHaveAttribute('data-focus', 'library');
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

  it('uses compact modal context without synthetic workflow cards for bespoke flows', async () => {
    const cases = [
      {
        path: '/ws/ws-brand-ai/brand?tab=discovery',
        dialog: 'Discovery intake',
        frame: 'Discovery intake workflow',
        panel: 'legacy-discovery-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=brandscript',
        dialog: 'Brandscript',
        frame: 'Brandscript workflow',
        panel: 'legacy-brandscript-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=eeat-assets',
        dialog: 'Trust evidence',
        frame: 'Trust evidence workflow',
        panel: 'legacy-eeat-assets-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=business-profile&focus=locations-section',
        dialog: 'Business facts',
        frame: 'Business facts workflow',
        panel: 'legacy-business-footprint-panel',
      },
    ] as const;

    for (const testCase of cases) {
      const { unmount } = renderSurface(testCase.path);

      const dialog = await screen.findByRole('dialog', { name: testCase.dialog });
      expect(dialog).toHaveClass('max-w-[42.5rem]');
      expect(screen.queryByLabelText(testCase.frame)).not.toBeInTheDocument();
      expect(await screen.findByTestId(testCase.panel)).toBeInTheDocument();
      expect(screen.getAllByTestId(testCase.panel)).toHaveLength(1);

      unmount();
    }
  });

  it('uses compact modal context without synthetic workflow cards for carried editors', async () => {
    const cases = [
      {
        path: '/ws/ws-brand-ai/brand?tab=context',
        dialog: 'Context editors',
        frame: 'Context editors workflow',
        panel: 'legacy-context-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=voice',
        dialog: 'Voice calibration',
        frame: 'Voice calibration workflow',
        panel: 'legacy-voice-panel',
      },
      {
        path: '/ws/ws-brand-ai/brand?tab=intelligence-profile',
        dialog: 'Strategy intelligence',
        frame: 'Strategy intelligence workflow',
        panel: 'legacy-intelligence-profile-panel',
      },
    ] as const;

    for (const testCase of cases) {
      const { unmount } = renderSurface(testCase.path);

      const dialog = await screen.findByRole('dialog', { name: testCase.dialog });
      expect(dialog).toHaveClass('max-w-[42.5rem]');
      expect(screen.queryByLabelText(testCase.frame)).not.toBeInTheDocument();
      expect(await screen.findByTestId(testCase.panel)).toBeInTheDocument();
      expect(screen.getAllByTestId(testCase.panel)).toHaveLength(1);

      unmount();
    }
  });

  it('maps all 17 unique prototype generators to focused real Identity receivers', async () => {
    const generators: Array<{ label: string; type: ReleasedBrandDeliverableType }> = [
      { label: 'Tagline', type: 'tagline' },
      { label: 'Voice Guidelines', type: 'voice_guidelines' },
      { label: 'Brand Archetypes', type: 'archetypes' },
      { label: 'Personality Traits', type: 'personality_traits' },
      { label: 'Messaging Pillars', type: 'messaging_pillars' },
      { label: 'Differentiators', type: 'differentiators' },
      { label: 'Tone Examples', type: 'tone_examples' },
      { label: 'Elevator Pitch', type: 'elevator_pitch' },
      { label: 'Brand Story', type: 'brand_story' },
      { label: 'Positioning Matrix', type: 'positioning_matrix' },
      { label: 'Customer Personas', type: 'personas' },
      { label: 'Customer Journey', type: 'customer_journey' },
      { label: 'Objection Handling', type: 'objection_handling' },
      { label: 'Emotional Triggers', type: 'emotional_triggers' },
      { label: 'Mission Statement', type: 'mission' },
      { label: 'Vision Statement', type: 'vision' },
      { label: 'Core Values', type: 'values' },
    ];
    renderSurface('/ws/ws-brand-ai/brand');

    await screen.findByText('Read by every AI action');
    for (const disclosure of screen.getAllByText('Brand identity generators')) fireEvent.click(disclosure);

    const expectedByGroup: Record<string, ReleasedBrandDeliverableType[]> = {
      voice: ['tagline', 'voice_guidelines', 'archetypes', 'personality_traits', 'messaging_pillars', 'differentiators', 'tone_examples'],
      knowledge: ['elevator_pitch', 'brand_story'],
      audience: ['positioning_matrix', 'personas', 'customer_journey', 'objection_handling', 'emotional_triggers'],
      facts: ['mission', 'vision', 'values'],
    };
    for (const [group, types] of Object.entries(expectedByGroup)) {
      const groupSection = document.querySelector(`#brand-context-${group}`);
      expect(groupSection).not.toBeNull();
      expect(Array.from(groupSection!.querySelectorAll('[data-brand-generator]')).map((row) => row.getAttribute('data-brand-generator'))).toEqual(types);
    }

    const generatorButtons = generators.map(({ label }) => screen.getByRole('button', { name: new RegExp(label, 'i') }));
    expect(generatorButtons).toHaveLength(17);
    expect(new Set(generatorButtons).size).toBe(17);

    for (const [index, generator] of generators.entries()) {
      fireEvent.click(generatorButtons[index]);
      await waitFor(() => {
        expect(screen.getByTestId('legacy-identity-panel')).toHaveAttribute('data-focus', generator.type);
      });
      expect(currentSearchParams().get('tab')).toBe('identity');
      expect(currentSearchParams().get('focus')).toBe(generator.type);
    }

    expect(await screen.findByRole('dialog', { name: 'Brand identity' })).toBeInTheDocument();
    expect(screen.queryByText('Generator workflow')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-identity-panel')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'View all brand identity' }));
    await waitFor(() => {
      expect(screen.getByTestId('legacy-identity-panel')).toHaveAttribute('data-focus', 'library');
    });
    expect(currentSearchParams().get('tab')).toBe('identity');
    expect(currentSearchParams().get('focus')).toBeNull();
  });

  it('falls back to the full Identity library for an invalid focus value', async () => {
    renderSurface('/ws/ws-brand-ai/brand?tab=identity&focus=not-a-deliverable');

    expect(await screen.findByRole('dialog', { name: 'Brand identity' })).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-identity-panel')).toHaveAttribute('data-focus', 'library');
    expect(screen.getAllByTestId('legacy-identity-panel')).toHaveLength(1);
  });

  it('focuses the current real Brandscript only from its overview row', async () => {
    renderSurface('/ws/ws-brand-ai/brand');

    await screen.findByText('Read by every AI action');
    const brandscriptRow = screen.getByText('Brandscript').closest('button');
    expect(brandscriptRow).not.toBeNull();
    fireEvent.click(brandscriptRow!);

    expect(await screen.findByRole('dialog', { name: 'Brandscript' })).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-brandscript-panel')).toHaveAttribute('data-focus', 'existing');
    expect(currentSearchParams().get('tab')).toBe('brandscript');
    expect(currentSearchParams().get('focus')).toBe('existing-brandscript');

    fireEvent.click(screen.getByRole('button', { name: 'View all brandscripts' }));
    await waitFor(() => {
      expect(screen.getByTestId('legacy-brandscript-panel')).toHaveAttribute('data-focus', 'library');
    });
    expect(currentSearchParams().get('tab')).toBe('brandscript');
    expect(currentSearchParams().get('focus')).toBeNull();
  });

  it('keeps the real Generate from website launcher in the rail and opens Discovery', async () => {
    renderSurface('/ws/ws-brand-ai/brand');

    const launcher = await screen.findByRole('button', { name: 'Generate from website' });
    fireEvent.click(launcher);

    expect(await screen.findByRole('dialog', { name: 'Discovery intake' })).toBeInTheDocument();
    expect(await screen.findByTestId('legacy-discovery-panel')).toBeInTheDocument();
    expect(currentSearchParams().get('tab')).toBe('discovery');
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
    expect(screen.getByRole('heading', { name: 'Brand & AI' })).toHaveClass('sr-only');
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
