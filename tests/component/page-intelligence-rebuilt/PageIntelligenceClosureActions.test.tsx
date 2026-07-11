import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedPage } from '../../../shared/types/page-join';
import type { KeywordStrategy, PageKeywordMap } from '../../../shared/types/workspace';
import type { ContentScore, KeywordData } from '../../../src/components/page-intelligence/pageIntelligenceTypes';

const mocks = vi.hoisted(() => ({
  page: null as unknown,
  strategy: null as unknown,
  keywordAnalyze: vi.fn(),
  persistAnalysis: vi.fn(),
  patchStrategy: vi.fn(),
  seoCopy: vi.fn(),
  rankKeywords: vi.fn(),
  addRankKeyword: vi.fn(),
  pageHtmlGet: vi.fn(),
  contentScorePost: vi.fn(),
}));

vi.mock('../../../src/hooks/admin', () => ({
  useWorkspaces: () => ({
    data: [{ id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useKeywordStrategy: () => ({
    data: { strategy: mocks.strategy },
    isLoading: false,
    isError: false,
  }),
  usePageJoin: () => ({
    pages: [mocks.page],
    strategyPages: mocks.strategy ? [mocks.page] : [],
    webflowPages: [mocks.page],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeo: () => ({
    data: { featureEnabled: false, latestSnapshots: [] },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../src/components/local-seo/LocalSeoVisibilityPanel', () => ({
  LocalSeoVisibilityPanel: () => null,
  LocalSeoVisibilityBadge: () => null,
}));

vi.mock('../../../src/api/seo', () => ({
  keywords: {
    analyze: (...args: unknown[]) => mocks.keywordAnalyze(...args),
    persistAnalysis: (...args: unknown[]) => mocks.persistAnalysis(...args),
    patchStrategy: (...args: unknown[]) => mocks.patchStrategy(...args),
    seoCopy: (...args: unknown[]) => mocks.seoCopy(...args),
  },
  rankTracking: {
    keywords: (...args: unknown[]) => mocks.rankKeywords(...args),
    addKeyword: (...args: unknown[]) => mocks.addRankKeyword(...args),
  },
}));

vi.mock('../../../src/api/client', () => ({
  get: (...args: unknown[]) => mocks.pageHtmlGet(...args),
  post: (...args: unknown[]) => mocks.contentScorePost(...args),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    jobs: [],
    startJob: vi.fn(),
    findActiveJob: vi.fn(() => undefined),
    cancelJob: vi.fn(),
  }),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

import { PageIntelligenceSurface } from '../../../src/components/page-intelligence-rebuilt/PageIntelligenceSurface';

const ANALYSIS: KeywordData = {
  primaryKeyword: 'custom sofas',
  primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: false },
  secondaryKeywords: ['made to order sofa'],
  longTailKeywords: ['custom sofas near me'],
  searchIntent: 'commercial',
  searchIntentConfidence: 0.91,
  contentGaps: ['Add delivery details'],
  competitorKeywords: ['bespoke sofas'],
  optimizationScore: 68,
  optimizationIssues: ['Missing schema markup'],
  recommendations: ['Add a buyer guide'],
  estimatedDifficulty: 'medium',
  keywordDifficulty: 44,
  monthlyVolume: 900,
  topicCluster: 'custom furniture',
};

const CONTENT_SCORE: ContentScore = {
  wordCount: 550,
  sentenceCount: 32,
  avgWordsPerSentence: 17,
  readabilityScore: 72,
  readabilityGrade: 'Easy',
  headings: { total: 5, h1: 1, h2: 4, texts: ['Custom sofas'] },
  topKeywords: [{ word: 'sofas', count: 8, density: 1.4 }],
  titleLength: 34,
  descLength: 142,
  titleOk: true,
  descOk: true,
};

function makeUnmappedPage(): UnifiedPage {
  return {
    id: 'page-unmapped',
    title: 'Unmapped Service',
    path: '/unmapped',
    slug: 'unmapped',
    source: 'static',
    analyzed: false,
  };
}

function makeMappedFixture(): { page: UnifiedPage; strategy: KeywordStrategy } {
  const pageMap: PageKeywordMap = {
    pagePath: '/services',
    pageTitle: 'Services',
    primaryKeyword: 'custom sofas',
    secondaryKeywords: ['made to order sofa'],
    searchIntent: 'commercial',
    optimizationScore: 62,
    optimizationIssues: ['Missing schema markup'],
    recommendations: ['Add a buyer guide'],
    contentGaps: ['Explain delivery timing'],
    analysisGeneratedAt: '2026-07-11T01:00:00.000Z',
    primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: true },
    longTailKeywords: ['custom sofas near me'],
    competitorKeywords: ['bespoke sofas'],
    estimatedDifficulty: 'medium',
    keywordDifficulty: 44,
    monthlyVolume: 900,
    topicCluster: 'custom furniture',
    searchIntentConfidence: 0.91,
    volume: 900,
    difficulty: 44,
  };
  return {
    page: {
      id: 'page-services',
      title: 'Services',
      path: '/services',
      slug: 'services',
      source: 'static',
      strategy: pageMap,
      analyzed: false,
    },
    strategy: {
      siteKeywords: ['custom sofas'],
      pageMap: [pageMap],
      opportunities: [],
      generatedAt: '2026-07-11T00:00:00.000Z',
    },
  };
}

function DestinationProbe() {
  const location = useLocation();
  return (
    <output data-testid="destination">
      {JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}
    </output>
  );
}

function renderSurface() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ws/ws-1/page-intelligence']}>
        <Routes>
          <Route path="/ws/:workspaceId/page-intelligence" element={<PageIntelligenceSurface workspaceId="ws-1" />} />
          <Route path="*" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function waitForSelectedPage(name: string) {
  const inventory = await screen.findByLabelText('Page inventory');
  fireEvent.click(within(inventory).getByRole('button', { name: new RegExp(name) }));
  return screen.findByRole('heading', { name, level: 2 });
}

function readDestination() {
  return JSON.parse(screen.getByTestId('destination').textContent ?? '{}') as {
    pathname: string;
    search: string;
    state: { fixContext: Record<string, unknown> };
  };
}

describe('Page Intelligence closure — actions and owning-workspace handoffs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fixture = makeMappedFixture();
    mocks.page = fixture.page;
    mocks.strategy = fixture.strategy;
    mocks.rankKeywords.mockResolvedValue([]);
    mocks.addRankKeyword.mockResolvedValue({});
    mocks.patchStrategy.mockResolvedValue({});
    mocks.seoCopy.mockResolvedValue({
      seoTitle: 'Custom Sofas Made for Your Home',
      metaDescription: 'Design a made-to-order sofa for your space.',
      h1: 'Custom Sofas for Thoughtful Interiors',
      introParagraph: 'Choose the dimensions, materials, and finish that fit your room.',
    });
    mocks.pageHtmlGet.mockResolvedValue({ text: 'Custom sofa service page' });
    mocks.keywordAnalyze.mockResolvedValue(ANALYSIS);
    mocks.contentScorePost.mockResolvedValue(CONTENT_SCORE);
    mocks.persistAnalysis.mockResolvedValue({ success: true, pagePath: '/unmapped', hasAnalysis: true });
  });

  it('runs the selected page analysis through both analysis boundaries exactly once', async () => {
    mocks.page = makeUnmappedPage();
    mocks.strategy = null;
    renderSurface();

    await waitForSelectedPage('Unmapped Service');
    expect(screen.getAllByRole('button', { name: 'Run AI analysis' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run AI analysis' }));

    await waitFor(() => expect(mocks.keywordAnalyze).toHaveBeenCalledTimes(1));
    expect(mocks.pageHtmlGet).toHaveBeenCalledTimes(1);
    expect(mocks.pageHtmlGet).toHaveBeenCalledWith('/api/webflow/page-html/site-1?path=%2Funmapped&workspaceId=ws-1');
    expect(mocks.keywordAnalyze).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      pageTitle: 'Unmapped Service',
      slug: '/unmapped',
    }));
    expect(mocks.contentScorePost).toHaveBeenCalledTimes(1);
    expect(mocks.contentScorePost).toHaveBeenCalledWith(
      '/api/webflow/content-score',
      expect.objectContaining({ pageTitle: 'Unmapped Service' }),
    );
    await waitFor(() => expect(mocks.persistAnalysis).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('custom sofas')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Track' })).toHaveLength(1);
  });

  it('edits the mapped keyword assignment through the real editing hook exactly once', async () => {
    renderSurface();
    await waitForSelectedPage('Services');

    expect(screen.getAllByRole('button', { name: 'Edit keywords' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit keywords' }));
    fireEvent.change(screen.getByDisplayValue('custom sofas'), { target: { value: 'bespoke sofas' } });
    fireEvent.change(screen.getByDisplayValue('made to order sofa'), { target: { value: 'luxury sofas, tailored sofa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.patchStrategy).toHaveBeenCalledTimes(1));
    expect(mocks.patchStrategy).toHaveBeenCalledWith('ws-1', {
      pageMap: [expect.objectContaining({
        primaryKeyword: 'bespoke sofas',
        secondaryKeywords: ['luxury sofas', 'tailored sofa'],
      })],
    });
  });

  it('renders one Track control when persisted analysis repeats the mapped primary keyword', async () => {
    renderSurface();
    await waitForSelectedPage('Services');

    expect(screen.getAllByRole('button', { name: 'Track' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    await waitFor(() => expect(mocks.addRankKeyword).toHaveBeenCalledTimes(1));
    expect(mocks.addRankKeyword).toHaveBeenCalledWith('ws-1', { query: 'custom sofas' });
    expect(await screen.findByRole('button', { name: 'Tracking' })).toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: 'Generate SEO Copy' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Generate SEO Copy' }));
    await waitFor(() => expect(mocks.seoCopy).toHaveBeenCalledTimes(1));
    expect(mocks.seoCopy).toHaveBeenCalledWith({
      pagePath: '/services',
      pageTitle: 'Services',
      workspaceId: 'ws-1',
    });
    expect(await screen.findByText('Custom Sofas Made for Your Home')).toBeInTheDocument();
  });

  it('keeps one Track home when live analysis normalizes to the mapped primary keyword', async () => {
    mocks.keywordAnalyze.mockResolvedValue({ ...ANALYSIS, primaryKeyword: 'Custom   Sofas!' });
    renderSurface();
    await waitForSelectedPage('Services');

    fireEvent.click(screen.getByRole('button', { name: 'Re-analyze' }));

    await waitFor(() => expect(mocks.persistAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      analysis: expect.objectContaining({ primaryKeyword: 'Custom   Sofas!' }),
    })));
    expect(screen.getAllByRole('button', { name: 'Track' })).toHaveLength(1);
  });

  it('keeps a distinct live-analysis primary keyword independently trackable', async () => {
    mocks.keywordAnalyze.mockResolvedValue({ ...ANALYSIS, primaryKeyword: 'bespoke sofas' });
    renderSurface();
    await waitForSelectedPage('Services');

    fireEvent.click(screen.getByRole('button', { name: 'Re-analyze' }));

    await waitFor(() => expect(mocks.persistAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      analysis: expect.objectContaining({ primaryKeyword: 'bespoke sofas' }),
    })));
    expect(screen.getAllByRole('button', { name: 'Track' })).toHaveLength(2);
  });

  it.each([
    {
      button: 'Create brief',
      pathname: '/ws/ws-1/content-pipeline',
      search: '?tab=briefs',
      fixContext: {
        targetRoute: 'content-pipeline',
        pageSlug: 'services',
        pageName: 'Services',
        primaryKeyword: 'custom sofas',
        searchIntent: 'commercial',
        optimizationScore: 62,
        optimizationIssues: ['Missing schema markup'],
        recommendations: ['Add a buyer guide'],
        contentGaps: ['Explain delivery timing'],
        autoGenerate: true,
      },
    },
    {
      button: 'Add schema',
      pathname: '/ws/ws-1/seo-schema',
      search: '',
      fixContext: {
        targetRoute: 'seo-schema',
        pageSlug: 'services',
        pageName: 'Services',
      },
    },
    {
      button: 'Fix in SEO Editor',
      pathname: '/ws/ws-1/seo-editor',
      search: '',
      fixContext: {
        targetRoute: 'seo-editor',
        pageSlug: 'services',
        pageName: 'Services',
      },
    },
  ])('renders one $button handoff and preserves its receiving route contract', async ({ button, pathname, search, fixContext }) => {
    renderSurface();
    await waitForSelectedPage('Services');

    expect(screen.getAllByRole('button', { name: button })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: button }));

    await screen.findByTestId('destination');
    expect(readDestination()).toEqual({
      pathname,
      search,
      state: { fixContext },
    });
  });
});
