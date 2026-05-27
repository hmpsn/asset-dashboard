/**
 * tests/unit/hooks/admin-queries-c.test.tsx
 *
 * Smoke tests for a batch of simple useQuery admin hooks.
 * Runs in the `component` vitest project (jsdom environment).
 *
 * Strategy:
 *  - Mock API modules so no real fetch calls fire.
 *  - Assert enabled/disabled behaviour, loading state, and data shape.
 *  - Keep tests shallow — surface behaviour only, not business logic.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// ── Standard wrapper ────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Mock: Toast (used by useCopyPipeline, useBriefingDrafts) ────────────────

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Mock: src/api/content (useContentCalendar) ──────────────────────────────

vi.mock('../../../src/api/content', () => ({
  contentBriefs: { list: vi.fn() },
  contentPosts: { list: vi.fn() },
  contentRequests: { list: vi.fn() },
  contentMatrices: { list: vi.fn() },
  publicContent: {},
  publicPostReview: {},
  contentTemplates: {},
  contentDecay: { list: vi.fn() },
  siteArchitecture: {},
  llmsTxt: {},
  contentPlanReview: {},
}));

// ── Mock: src/api/client (useContentPipeline, useKeywordStrategy, useQueue) ─

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: vi.fn(),
  getOptional: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  postForm: vi.fn(),
  getText: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

// ── Mock: src/api/brand-engine (useCopyPipeline) ────────────────────────────

vi.mock('../../../src/api/brand-engine', () => ({
  brandscripts: { list: vi.fn() },
  discovery: { get: vi.fn() },
  voice: { get: vi.fn() },
  identity: { get: vi.fn() },
  blueprints: { list: vi.fn(), get: vi.fn() },
  blueprintEntries: { list: vi.fn() },
  blueprintVersions: { list: vi.fn() },
  copyGeneration: { generate: vi.fn(), regenerateSection: vi.fn() },
  copyReview: {
    getSections: vi.fn(),
    getStatus: vi.fn(),
    getMetadata: vi.fn(),
    sendEntryToClientReview: vi.fn(),
    updateSectionStatus: vi.fn(),
    updateSectionText: vi.fn(),
    addSuggestion: vi.fn(),
  },
  copyBatch: { start: vi.fn(), getJob: vi.fn() },
  copyExport: { export: vi.fn() },
  copyIntelligence: {
    getAll: vi.fn(),
    getPromotable: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    extract: vi.fn(),
  },
}));

// ── Mock: src/api/briefing (useBriefingDrafts) ──────────────────────────────

vi.mock('../../../src/api/briefing', () => ({
  briefingApi: {
    listDrafts: vi.fn(),
    updateStories: vi.fn(),
    approve: vi.fn(),
    publish: vi.fn(),
    skip: vi.fn(),
    generateNow: vi.fn(),
    getPublished: vi.fn(),
  },
}));

// ── Mock: src/api/seo (useKeywordStrategy — keywords.providerStatus) ─────────

vi.mock('../../../src/api/seo', () => ({
  keywords: {
    providerStatus: vi.fn(),
    analyze: vi.fn(),
    persistAnalysis: vi.fn(),
    strategy: vi.fn(),
  },
  audit: { summary: vi.fn(), detail: vi.fn(), traffic: vi.fn(), publicAudit: vi.fn() },
  auditSchedules: { get: vi.fn(), save: vi.fn(), enable: vi.fn(), disable: vi.fn() },
  reports: { history: vi.fn(), latest: vi.fn(), snapshot: vi.fn(), updateAction: vi.fn(), removeAction: vi.fn() },
  rankTracking: {},
  backlinks: {},
  webflow: {},
  seoSuggestions: {},
  contentPerformance: {},
  aeoReview: {},
  competitor: {},
  seoBulkJobs: {},
  seoChangeTracker: {},
  pageWeight: {},
}));

// ── Mock: src/api/workspaces (useKeywordStrategy — workspaces.getById) ───────

vi.mock('../../../src/api/workspaces', () => ({
  workspaces: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getSuppressions: vi.fn(),
    addSuppression: vi.fn(),
    removeSuppression: vi.fn(),
    updateClientUser: vi.fn(),
    removeClientUser: vi.fn(),
    deletePageState: vi.fn(),
  },
  publicWorkspaces: { getInfo: vi.fn() },
}));

// ── Mock: src/api/keywordCommandCenter (useKeywordCommandCenter) ─────────────

vi.mock('../../../src/api/keywordCommandCenter', () => ({
  keywordCommandCenter: {
    summary: vi.fn(),
    rows: vi.fn(),
    detail: vi.fn(),
    action: vi.fn(),
    bulkAction: vi.fn(),
  },
}));

// ── Mock: src/api/localSeo (useLocalSeo, useLocalSeoLocations) ──────────────

vi.mock('../../../src/api/localSeo', () => ({
  localSeo: {
    get: vi.fn(),
    getSummary: vi.fn(),
    getWithSnapshots: vi.fn(),
    update: vi.fn(),
    locationLookup: vi.fn(),
    refresh: vi.fn(),
    setPrimaryMarket: vi.fn(),
    listLocations: vi.fn(),
    createLocation: vi.fn(),
    updateLocation: vi.fn(),
    deleteLocation: vi.fn(),
  },
}));

// ── Mock: src/api/schema (useSchemaValidation) ───────────────────────────────

vi.mock('../../../src/api/schema', () => ({
  schemaValidation: {
    validate: vi.fn(),
    getAll: vi.fn(),
    get: vi.fn(),
    getGraph: vi.fn(),
  },
  schema: { retract: vi.fn() },
  schemaPlan: {
    get: vi.fn(),
    generate: vi.fn(),
    update: vi.fn(),
    sendToClient: vi.fn(),
    activate: vi.fn(),
    retract: vi.fn(),
  },
  schemaImpact: {},
}));

// ── Mock: src/api/outcomes (useOutcomes) ─────────────────────────────────────

vi.mock('../../../src/api/outcomes', () => ({
  outcomesApi: {
    getActions: vi.fn(),
    getAction: vi.fn(),
    getScorecard: vi.fn(),
    getTopWins: vi.fn(),
    getTimeline: vi.fn(),
    getLearnings: vi.fn(),
    getOverview: vi.fn(),
    addNote: vi.fn(),
    getPlaybooks: vi.fn(),
  },
  clientOutcomesApi: {
    getSummary: vi.fn(),
    getWins: vi.fn(),
  },
}));

// ── Import mocked modules ───────────────────────────────────────────────────

import { contentBriefs, contentPosts, contentRequests, contentMatrices } from '../../../src/api/content';
import { get } from '../../../src/api/client';
import { copyReview, copyIntelligence } from '../../../src/api/brand-engine';
import { briefingApi } from '../../../src/api/briefing';
import { keywords } from '../../../src/api/seo';
import { workspaces } from '../../../src/api/workspaces';
import { keywordCommandCenter } from '../../../src/api/keywordCommandCenter';
import { localSeo } from '../../../src/api/localSeo';
import { schemaValidation } from '../../../src/api/schema';
import { outcomesApi } from '../../../src/api/outcomes';

const mockContentBriefsList = vi.mocked(contentBriefs.list);
const mockContentPostsList = vi.mocked(contentPosts.list);
const mockContentRequestsList = vi.mocked(contentRequests.list);
const mockContentMatricesList = vi.mocked(contentMatrices.list);
const mockGet = vi.mocked(get);
const mockCopyReviewGetSections = vi.mocked(copyReview.getSections);
const mockCopyIntelligenceGetAll = vi.mocked(copyIntelligence.getAll);
const mockBriefingListDrafts = vi.mocked(briefingApi.listDrafts);
const mockKeywordsProviderStatus = vi.mocked(keywords.providerStatus);
const mockWorkspacesGetById = vi.mocked(workspaces.getById);
const mockKccSummary = vi.mocked(keywordCommandCenter.summary);
const mockKccRows = vi.mocked(keywordCommandCenter.rows);
const mockKccDetail = vi.mocked(keywordCommandCenter.detail);
const mockLocalSeoGetSummary = vi.mocked(localSeo.getSummary);
const mockLocalSeoListLocations = vi.mocked(localSeo.listLocations);
const mockSchemaValidationGetAll = vi.mocked(schemaValidation.getAll);
const mockSchemaValidationGetGraph = vi.mocked(schemaValidation.getGraph);
const mockOutcomesGetScorecard = vi.mocked(outcomesApi.getScorecard);
const mockOutcomesGetActions = vi.mocked(outcomesApi.getActions);
const mockOutcomesGetTopWins = vi.mocked(outcomesApi.getTopWins);

// ── Import hooks ────────────────────────────────────────────────────────────

import { useContentCalendar } from '../../../src/hooks/admin/useContentCalendar';
import { useContentPipeline } from '../../../src/hooks/admin/useContentPipeline';
import { useCopySections, useCopyIntelligence } from '../../../src/hooks/admin/useCopyPipeline';
import { useBriefingDrafts } from '../../../src/hooks/admin/useBriefingDrafts';
import { useKeywordStrategy } from '../../../src/hooks/admin/useKeywordStrategy';
import {
  useKeywordCommandCenterSummary,
  useKeywordCommandCenterRows,
  useKeywordCommandCenterDetail,
} from '../../../src/hooks/admin/useKeywordCommandCenter';
import { useLocalSeo } from '../../../src/hooks/admin/useLocalSeo';
import { useLocalSeoLocations } from '../../../src/hooks/admin/useLocalSeoLocations';
import { useSchemaValidations, useSchemaGraphValidation } from '../../../src/hooks/admin/useSchemaValidation';
import { useOutcomeScorecard, useOutcomeActions, useOutcomeTopWins } from '../../../src/hooks/admin/useOutcomes';
import { useQueue } from '../../../src/hooks/admin/useQueue';

// ── useContentCalendar ──────────────────────────────────────────────────────

describe('useContentCalendar', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useContentCalendar(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockContentBriefsList).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with valid workspaceId', () => {
    mockContentBriefsList.mockReturnValue(new Promise(() => {}));
    mockContentPostsList.mockResolvedValue([]);
    mockContentRequestsList.mockResolvedValue([]);
    mockContentMatricesList.mockResolvedValue([]);
    const { result } = renderHook(
      () => useContentCalendar('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns array of calendar items when APIs resolve', async () => {
    const brief = { id: 'b-1', targetKeyword: 'seo tips', suggestedTitle: 'SEO Tips Guide', createdAt: '2024-01-01T00:00:00Z' };
    mockContentBriefsList.mockResolvedValue([brief]);
    mockContentPostsList.mockResolvedValue([]);
    mockContentRequestsList.mockResolvedValue([]);
    mockContentMatricesList.mockResolvedValue([]);
    const { result } = renderHook(
      () => useContentCalendar('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data![0]).toMatchObject({ id: 'b-1', type: 'brief' });
  });
});

// ── useContentPipeline ──────────────────────────────────────────────────────

describe('useContentPipeline', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useContentPipeline(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useContentPipeline('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns summary and decay shape when APIs resolve', async () => {
    mockGet
      .mockResolvedValueOnce([]) // briefs
      .mockResolvedValueOnce([]) // posts
      .mockResolvedValueOnce([]) // matrices
      .mockResolvedValueOnce(null); // decay
    const { result } = renderHook(
      () => useContentPipeline('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.summary).toBeDefined();
    expect(result.current.data?.summary?.briefs).toBe(0);
    expect(result.current.data?.decay).toBeNull();
  });
});

// ── useCopySections ─────────────────────────────────────────────────────────

describe('useCopySections', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when wsId is empty', () => {
    const { result } = renderHook(
      () => useCopySections('', 'entry-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockCopyReviewGetSections).not.toHaveBeenCalled();
  });

  it('is disabled when entryId is empty', () => {
    const { result } = renderHook(
      () => useCopySections('ws-1', ''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockCopyReviewGetSections).not.toHaveBeenCalled();
  });

  it('returns data when API resolves', async () => {
    const sections = [{ id: 's-1', sectionKey: 'hero', copy: 'Hello world', status: 'approved' }];
    mockCopyReviewGetSections.mockResolvedValue(sections);
    const { result } = renderHook(
      () => useCopySections('ws-1', 'entry-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(sections);
  });
});

// ── useCopyIntelligence ─────────────────────────────────────────────────────

describe('useCopyIntelligence', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when wsId is empty', () => {
    const { result } = renderHook(
      () => useCopyIntelligence(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockCopyIntelligenceGetAll).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockCopyIntelligenceGetAll.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useCopyIntelligence('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns intelligence data when API resolves', async () => {
    const intelligence = [{ id: 'p-1', pattern: 'Friendly tone', active: true }];
    mockCopyIntelligenceGetAll.mockResolvedValue(intelligence);
    const { result } = renderHook(
      () => useCopyIntelligence('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(intelligence);
  });
});

// ── useBriefingDrafts ───────────────────────────────────────────────────────

describe('useBriefingDrafts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useBriefingDrafts(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockBriefingListDrafts).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockBriefingListDrafts.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useBriefingDrafts('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns drafts array when API resolves', async () => {
    const drafts = [{ id: 'd-1', workspaceId: 'ws-1', status: 'draft', stories: [] }];
    mockBriefingListDrafts.mockResolvedValue(drafts);
    const { result } = renderHook(
      () => useBriefingDrafts('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(drafts);
  });
});

// ── useKeywordStrategy ──────────────────────────────────────────────────────

describe('useKeywordStrategy', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useKeywordStrategy(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockKeywordsProviderStatus).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    mockKeywordsProviderStatus.mockResolvedValue({ providers: [] });
    mockWorkspacesGetById.mockResolvedValue(null);
    const { result } = renderHook(
      () => useKeywordStrategy('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns keyword strategy data shape when API resolves', async () => {
    mockGet.mockResolvedValue({ targetKeywords: [], pageMap: {} });
    mockKeywordsProviderStatus.mockResolvedValue({ providers: [{ name: 'semrush', configured: true }] });
    mockWorkspacesGetById.mockResolvedValue({ competitorDomains: [], seoDataProvider: 'semrush' });
    const { result } = renderHook(
      () => useKeywordStrategy('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.seoDataAvailable).toBe(true);
    expect(result.current.data?.providers).toHaveLength(1);
  });

  it('does not block core strategy render while auxiliary metadata is still loading', async () => {
    mockGet.mockResolvedValue({ targetKeywords: ['core-keyword'], pageMap: {} });
    mockKeywordsProviderStatus.mockReturnValue(new Promise(() => {}));
    mockWorkspacesGetById.mockResolvedValue({ competitorDomains: [], seoDataProvider: 'semrush' });
    const { result } = renderHook(
      () => useKeywordStrategy('ws-1'),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.strategy).toEqual({ targetKeywords: ['core-keyword'], pageMap: {} });
    expect(result.current.isAuxLoading).toBe(true);
  });
});

// ── useKeywordCommandCenterSummary ──────────────────────────────────────────

describe('useKeywordCommandCenterSummary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useKeywordCommandCenterSummary(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockKccSummary).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockKccSummary.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useKeywordCommandCenterSummary('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns summary data when API resolves', async () => {
    const summary = { totalKeywords: 42, tracked: 10, opportunities: 5 };
    mockKccSummary.mockResolvedValue(summary);
    const { result } = renderHook(
      () => useKeywordCommandCenterSummary('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(summary);
  });
});

// ── useKeywordCommandCenterRows ─────────────────────────────────────────────

describe('useKeywordCommandCenterRows', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useKeywordCommandCenterRows('', { limit: 20, offset: 0 }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockKccRows).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockKccRows.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useKeywordCommandCenterRows('ws-1', { limit: 20, offset: 0 }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns rows data when API resolves', async () => {
    const rows = { rows: [{ keyword: 'seo tips', volume: 1000 }], total: 1 };
    mockKccRows.mockResolvedValue(rows);
    const { result } = renderHook(
      () => useKeywordCommandCenterRows('ws-1', { limit: 20, offset: 0 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(rows);
  });
});

// ── useKeywordCommandCenterDetail ───────────────────────────────────────────

describe('useKeywordCommandCenterDetail', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when keyword is null', () => {
    const { result } = renderHook(
      () => useKeywordCommandCenterDetail('ws-1', null),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockKccDetail).not.toHaveBeenCalled();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useKeywordCommandCenterDetail('', 'seo tips'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockKccDetail).not.toHaveBeenCalled();
  });

  it('returns detail data when API resolves', async () => {
    const detail = { keyword: 'seo tips', volume: 1000, difficulty: 45, pages: [] };
    mockKccDetail.mockResolvedValue(detail);
    const { result } = renderHook(
      () => useKeywordCommandCenterDetail('ws-1', 'seo tips'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(detail);
  });
});

// ── useLocalSeo ─────────────────────────────────────────────────────────────

describe('useLocalSeo', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useLocalSeo(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockLocalSeoGetSummary).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled (summary mode)', () => {
    mockLocalSeoGetSummary.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useLocalSeo('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns local SEO data when API resolves', async () => {
    const localSeoData = { markets: [], locations: [] };
    mockLocalSeoGetSummary.mockResolvedValue(localSeoData);
    const { result } = renderHook(
      () => useLocalSeo('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(localSeoData);
  });
});

// ── useLocalSeoLocations ────────────────────────────────────────────────────

describe('useLocalSeoLocations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useLocalSeoLocations(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockLocalSeoListLocations).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with valid workspaceId', () => {
    mockLocalSeoListLocations.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useLocalSeoLocations('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns locations array when API resolves', async () => {
    const locations = [{ id: 'loc-1', name: 'Downtown', city: 'Austin', country: 'US' }];
    mockLocalSeoListLocations.mockResolvedValue({ locations });
    const { result } = renderHook(
      () => useLocalSeoLocations('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ locations });
  });
});

// ── useSchemaValidations ────────────────────────────────────────────────────

describe('useSchemaValidations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when siteId is undefined', () => {
    const { result } = renderHook(
      () => useSchemaValidations(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockSchemaValidationGetAll).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with valid siteId', () => {
    mockSchemaValidationGetAll.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useSchemaValidations('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns validation records when API resolves', async () => {
    const records = [{ id: 'v-1', pageId: 'p-1', status: 'valid', richResults: [], errors: [], warnings: [], validatedAt: '2024-01-01' }];
    mockSchemaValidationGetAll.mockResolvedValue(records);
    const { result } = renderHook(
      () => useSchemaValidations('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(records);
  });
});

// ── useSchemaGraphValidation ────────────────────────────────────────────────

describe('useSchemaGraphValidation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when siteId is undefined', () => {
    const { result } = renderHook(
      () => useSchemaGraphValidation(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockSchemaValidationGetGraph).not.toHaveBeenCalled();
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(
      () => useSchemaGraphValidation('site-1', 'ws-1', false),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockSchemaValidationGetGraph).not.toHaveBeenCalled();
  });

  it('returns graph data when API resolves', async () => {
    const graphData = { valid: true, errors: [], warnings: [] };
    mockSchemaValidationGetGraph.mockResolvedValue(graphData);
    const { result } = renderHook(
      () => useSchemaGraphValidation('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(graphData);
  });
});

// ── useOutcomeScorecard ─────────────────────────────────────────────────────

describe('useOutcomeScorecard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when wsId is empty', () => {
    const { result } = renderHook(
      () => useOutcomeScorecard(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockOutcomesGetScorecard).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockOutcomesGetScorecard.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useOutcomeScorecard('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns scorecard data when API resolves', async () => {
    const scorecard = { overallScore: 75, winRate: 0.6, totalActions: 20 };
    mockOutcomesGetScorecard.mockResolvedValue(scorecard);
    const { result } = renderHook(
      () => useOutcomeScorecard('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(scorecard);
  });
});

// ── useOutcomeActions ───────────────────────────────────────────────────────

describe('useOutcomeActions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when wsId is empty', () => {
    const { result } = renderHook(
      () => useOutcomeActions(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockOutcomesGetActions).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockOutcomesGetActions.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useOutcomeActions('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns actions array when API resolves', async () => {
    const actions = [{ id: 'a-1', type: 'content', status: 'measuring', score: 80 }];
    mockOutcomesGetActions.mockResolvedValue(actions);
    const { result } = renderHook(
      () => useOutcomeActions('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(actions);
  });
});

// ── useOutcomeTopWins ───────────────────────────────────────────────────────

describe('useOutcomeTopWins', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is disabled when wsId is empty', () => {
    const { result } = renderHook(
      () => useOutcomeTopWins(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockOutcomesGetTopWins).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockOutcomesGetTopWins.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useOutcomeTopWins('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns top wins when API resolves', async () => {
    const wins = [{ id: 'w-1', title: 'Traffic +30%', score: 90, achievedAt: '2024-01-15' }];
    mockOutcomesGetTopWins.mockResolvedValue(wins);
    const { result } = renderHook(
      () => useOutcomeTopWins('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(wins);
  });
});

// ── useQueue ────────────────────────────────────────────────────────────────

describe('useQueue', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enters loading state on mount', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useQueue(),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns array of queue items when API resolves', async () => {
    const items = [{ id: 'q-1', type: 'schema-generation', status: 'running', createdAt: '2024-01-01' }];
    mockGet.mockResolvedValue(items);
    const { result } = renderHook(
      () => useQueue(),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(items);
  });

  it('returns empty array when queue is empty', async () => {
    mockGet.mockResolvedValue([]);
    const { result } = renderHook(
      () => useQueue(),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});
