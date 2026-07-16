// @ds-rebuilt
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pageWeight, webflow } from '../../api/seo';

export type PageWeightSourceFilter = 'all' | 'page' | 'cms' | 'css';
export type PageSpeedStrategy = 'mobile' | 'desktop';

export interface PageAsset {
  id: string;
  name: string;
  size: number;
  contentType: string;
}

export interface PageWeightPage {
  page: string;
  totalSize: number;
  assetCount: number;
  assets: PageAsset[];
}

export interface PageWeightResult {
  totalPages: number;
  totalAssetSize: number;
  pages: PageWeightPage[];
}

export interface PerformanceSnapshot<T> {
  siteId: string;
  createdAt: string;
  result: T;
}

export interface CoreWebVitals {
  LCP: number | null;
  FID: number | null;
  CLS: number | null;
  FCP: number | null;
  INP: number | null;
  SI: number | null;
  TBT: number | null;
  TTI: number | null;
}

export interface PageSpeedOpportunity {
  id: string;
  title: string;
  description: string;
  savings: string | null;
  score: number;
}

export interface PageSpeedDiagnostic {
  id: string;
  title: string;
  description: string;
  displayValue?: string;
}

export interface PageSpeedResult {
  url: string;
  page: string;
  strategy: PageSpeedStrategy;
  score: number;
  vitals: CoreWebVitals;
  opportunities: PageSpeedOpportunity[];
  diagnostics: PageSpeedDiagnostic[];
  fetchedAt: string;
  fieldDataAvailable?: boolean;
}

export interface SiteSpeedResult {
  siteId: string;
  strategy: PageSpeedStrategy;
  pages: PageSpeedResult[];
  averageScore: number;
  averageVitals: CoreWebVitals;
  testedAt: string;
}

export interface WebflowPageOption {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
}

export interface PageSpeedSingleInput {
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  strategy: PageSpeedStrategy;
}

export interface PageSpeedBulkInput {
  strategy: PageSpeedStrategy;
  maxPages: number;
}

const adminPerformanceKeys = {
  all: (workspaceId: string) => ['admin-performance', workspaceId] as const,
  pages: (workspaceId: string, siteId: string) => [...adminPerformanceKeys.all(workspaceId), 'pages', siteId] as const,
  pageWeightSnapshot: (workspaceId: string, siteId: string) => [...adminPerformanceKeys.all(workspaceId), 'page-weight-snapshot', siteId] as const,
  pageSpeedSnapshot: (workspaceId: string, siteId: string, strategy: PageSpeedStrategy) => (
    [...adminPerformanceKeys.all(workspaceId), 'pagespeed-snapshot', siteId, strategy] as const
  ),
};

function asPageWeightResult(value: unknown): PageWeightResult {
  return value as PageWeightResult;
}

function asPageWeightSnapshot(value: unknown): PerformanceSnapshot<PageWeightResult> | null {
  return value as PerformanceSnapshot<PageWeightResult> | null;
}

function asPageSpeedSnapshot(value: unknown): PerformanceSnapshot<SiteSpeedResult> | null {
  return value as PerformanceSnapshot<SiteSpeedResult> | null;
}

function asSiteSpeedResult(value: unknown): SiteSpeedResult {
  const result = value as SiteSpeedResult;
  if (result.pages.length === 0) throw new Error('No pages could be tested');
  return result;
}

function asPageSpeedResult(value: unknown): PageSpeedResult {
  return value as PageSpeedResult;
}

function isWebflowPageOption(value: unknown): value is WebflowPageOption {
  if (!value || typeof value !== 'object') return false;
  const row = value as { id?: unknown; title?: unknown; slug?: unknown };
  return typeof row.id === 'string' && typeof row.title === 'string' && typeof row.slug === 'string';
}

export function useAdminPageWeightSnapshot(workspaceId: string, siteId: string | undefined) {
  return useQuery({
    queryKey: adminPerformanceKeys.pageWeightSnapshot(workspaceId, siteId ?? 'missing-site'),
    queryFn: async () => asPageWeightSnapshot(await pageWeight.webflowPageWeightSnapshot(siteId ?? '', workspaceId)),
    enabled: !!workspaceId && !!siteId,
    staleTime: 60_000,
  });
}

export function useAdminPageWeightScan(workspaceId: string, siteId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => asPageWeightResult(await pageWeight.webflowPageWeight(siteId ?? '', workspaceId)),
    onSuccess: (result) => {
      if (!siteId) return;
      queryClient.setQueryData<PerformanceSnapshot<PageWeightResult>>(
        adminPerformanceKeys.pageWeightSnapshot(workspaceId, siteId),
        { siteId, createdAt: new Date().toISOString(), result },
      );
      queryClient.invalidateQueries({ queryKey: adminPerformanceKeys.all(workspaceId) });
    },
  });
}

export function useAdminPerformancePages(workspaceId: string, siteId: string | undefined) {
  return useQuery({
    queryKey: adminPerformanceKeys.pages(workspaceId, siteId ?? 'missing-site'),
    queryFn: async () => {
      const rows = await webflow.pages(siteId ?? '', workspaceId);
      return rows
        .filter(isWebflowPageOption)
        .filter((page) => !page.title.toLowerCase().includes('password'));
    },
    enabled: !!workspaceId && !!siteId,
    staleTime: 5 * 60_000,
  });
}

export function useAdminPageSpeedSnapshot(
  workspaceId: string,
  siteId: string | undefined,
  strategy: PageSpeedStrategy,
) {
  return useQuery({
    queryKey: adminPerformanceKeys.pageSpeedSnapshot(workspaceId, siteId ?? 'missing-site', strategy),
    queryFn: async () => asPageSpeedSnapshot(await pageWeight.pagespeedSnapshot(siteId ?? '', workspaceId, strategy)),
    enabled: !!workspaceId && !!siteId,
    staleTime: 60_000,
  });
}

export function useAdminPageSpeedBulk(workspaceId: string, siteId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ strategy, maxPages }: PageSpeedBulkInput) => (
      asSiteSpeedResult(await pageWeight.pagespeedBulk(siteId ?? '', strategy, maxPages, workspaceId))
    ),
    onSuccess: (result, variables) => {
      if (!siteId || result.pages.length === 0) return;
      queryClient.setQueryData<PerformanceSnapshot<SiteSpeedResult>>(
        adminPerformanceKeys.pageSpeedSnapshot(workspaceId, siteId, variables.strategy),
        { siteId, createdAt: new Date().toISOString(), result },
      );
      queryClient.invalidateQueries({ queryKey: adminPerformanceKeys.all(workspaceId) });
    },
  });
}

export function useAdminPageSpeedSingle(workspaceId: string, siteId: string | undefined) {
  return useMutation({
    mutationFn: async (input: PageSpeedSingleInput) => (
      // pagespeedSingle's body param is a generic Record<string, unknown>; a typed interface
      // without an index signature is not directly assignable, so widen at the call site.
      asPageSpeedResult(await pageWeight.pagespeedSingle(siteId ?? '', input as unknown as Record<string, unknown>, workspaceId))
    ),
  });
}
