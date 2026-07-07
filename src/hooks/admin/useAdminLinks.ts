// @ds-rebuilt
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { redirects } from '../../api/misc';
import { webflow } from '../../api/seo';
import { siteArchitecture } from '../../api/content';
import { clientActions } from '../../api/clientActions';
import type { ClientAction } from '../../../shared/types/client-actions';
import type { InternalLinkResult } from '../../../shared/types/internal-links';

export interface RedirectHop {
  url: string;
  status: number;
}

export interface RedirectChain {
  originalUrl: string;
  hops: RedirectHop[];
  finalUrl: string;
  totalHops: number;
  isLoop: boolean;
  foundOn: string[];
  type: 'internal' | 'external';
}

export interface PageStatus {
  url: string;
  path: string;
  title: string;
  status: number | 'error';
  statusText: string;
  redirectsTo?: string;
  recommendedTarget?: string;
  recommendedReason?: string;
  source: 'static' | 'cms' | 'gsc';
  clicks?: number;
  impressions?: number;
  matchScore?: number;
}

export interface RedirectScanResult {
  chains: RedirectChain[];
  pageStatuses: PageStatus[];
  summary: {
    totalPages: number;
    healthy: number;
    redirecting: number;
    notFound: number;
    errors: number;
    chainsDetected: number;
    longestChain: number;
  };
  scannedAt: string;
}

export interface RedirectSnapshot {
  result?: RedirectScanResult;
  createdAt?: string;
}

export interface DeadLink {
  url: string;
  status: number | 'timeout' | 'error';
  statusText: string;
  foundOn: string;
  foundOnSlug: string;
  anchorText: string;
  type: 'internal' | 'external';
}

export interface LinkCheckResult {
  totalLinks: number;
  deadLinks: DeadLink[];
  redirects: DeadLink[];
  healthy: number;
  checkedAt: string;
  crawledDomain?: string;
}

export interface LinkCheckSnapshot {
  result?: LinkCheckResult;
  createdAt?: string;
}

export interface SiteDomainInfo {
  staging: string;
  customDomains: string[];
  defaultDomain: string;
}

export type SchemaPriority = 'critical' | 'high' | 'medium' | 'low' | 'done';

export interface SchemaCoveragePage {
  path: string;
  name: string;
  hasSchema: boolean;
  schemaTypes: string[];
  role: string | null;
  depth: number;
  pageType: string | null;
  inboundLinks: number | null;
  outboundLinks: number | null;
  isOrphan: boolean | null;
  linkScore: number | null;
  priority: SchemaPriority;
}

export interface PriorityQueueItem {
  path: string;
  name: string;
  hasSchema: boolean;
  schemaTypes: string[];
  priority: SchemaPriority;
  inboundLinks: number | null;
  isOrphan: boolean | null;
  linkScore: number | null;
}

export interface SchemaCoverageData {
  totalExisting: number;
  withSchema: number;
  withoutSchema: number;
  coveragePct: number;
  snapshotDate: string | null;
  hasPlan: boolean;
  hasLinkData: boolean;
  pages: SchemaCoveragePage[];
  priorityQueue: PriorityQueueItem[];
}

export interface SiteNode {
  path: string;
  name: string;
  pageType?: string;
  source: 'existing' | 'planned' | 'strategy' | 'gap';
  keyword?: string;
  seoTitle?: string;
  seoDescription?: string;
  matrixId?: string;
  cellId?: string;
  children: SiteNode[];
  depth: number;
  hasContent: boolean;
}

export interface ArchitectureGap {
  parentPath: string;
  suggestedPath: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface SiteArchitectureResult {
  tree: SiteNode;
  totalPages: number;
  existingPages: number;
  plannedPages: number;
  strategyPages: number;
  gaps: ArchitectureGap[];
  depthDistribution: Record<number, number>;
  orphanPaths: string[];
  analyzedAt: string;
}

export interface RedirectProposalInput {
  sourceId: string;
  title: string;
  summary: string;
  priority: ClientAction['priority'];
  clientNote?: string;
  payload: ClientAction['payload'];
}

export interface InternalLinksClientInput {
  sourceId: string;
  title: string;
  summary: string;
  priority: ClientAction['priority'];
  clientNote?: string;
  payload: ClientAction['payload'];
}

const ADMIN_LINKS_QUERY_KEYS = {
  all: ['admin-links'] as const,
  workspace: (workspaceId: string) => [...ADMIN_LINKS_QUERY_KEYS.all, workspaceId] as const,
  redirectSnapshot: (siteId: string, workspaceId?: string) =>
    [...ADMIN_LINKS_QUERY_KEYS.all, 'redirect-snapshot', workspaceId ?? 'no-workspace', siteId] as const,
  internalLinksSnapshot: (siteId: string, workspaceId?: string) =>
    [...ADMIN_LINKS_QUERY_KEYS.all, 'internal-links-snapshot', workspaceId ?? 'no-workspace', siteId] as const,
  linkCheckDomains: (siteId: string, workspaceId?: string) =>
    [...ADMIN_LINKS_QUERY_KEYS.all, 'link-check-domains', workspaceId ?? 'no-workspace', siteId] as const,
  linkCheckSnapshot: (siteId: string, workspaceId?: string) =>
    [...ADMIN_LINKS_QUERY_KEYS.all, 'link-check-snapshot', workspaceId ?? 'no-workspace', siteId] as const,
  siteArchitecture: (workspaceId: string) =>
    [...ADMIN_LINKS_QUERY_KEYS.workspace(workspaceId), 'site-architecture'] as const,
  schemaCoverage: (workspaceId: string) =>
    [...ADMIN_LINKS_QUERY_KEYS.workspace(workspaceId), 'schema-coverage'] as const,
};

export const adminLinksQueryKeys = ADMIN_LINKS_QUERY_KEYS;

export function useRedirectSnapshot(siteId: string | undefined, workspaceId?: string) {
  return useQuery({
    queryKey: ADMIN_LINKS_QUERY_KEYS.redirectSnapshot(siteId ?? 'missing-site', workspaceId),
    queryFn: () => redirects.snapshot(siteId ?? '', workspaceId) as Promise<RedirectSnapshot | null>,
    enabled: !!siteId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRedirectScan(siteId: string | undefined, workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!siteId) throw new Error('A Webflow site is required before scanning redirects.');
      const result = await redirects.scan(siteId, workspaceId) as RedirectScanResult & { error?: string };
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      if (!siteId) return;
      queryClient.setQueryData<RedirectSnapshot>(
        ADMIN_LINKS_QUERY_KEYS.redirectSnapshot(siteId, workspaceId),
        { result, createdAt: result.scannedAt },
      );
    },
  });
}

export function useInternalLinksSnapshot(siteId: string | undefined, workspaceId?: string) {
  return useQuery({
    queryKey: ADMIN_LINKS_QUERY_KEYS.internalLinksSnapshot(siteId ?? 'missing-site', workspaceId),
    queryFn: async () => {
      const snapshot = await webflow.internalLinksSnapshot(siteId ?? '', workspaceId) as { result?: InternalLinkResult } | null;
      return snapshot?.result ?? null;
    },
    enabled: !!siteId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAnalyzeInternalLinks(siteId: string | undefined, workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!siteId) throw new Error('A Webflow site is required before analyzing internal links.');
      const result = await webflow.internalLinksWithParams(siteId, workspaceId) as InternalLinkResult & { error?: string };
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      if (!siteId) return;
      queryClient.setQueryData(ADMIN_LINKS_QUERY_KEYS.internalLinksSnapshot(siteId, workspaceId), result);
    },
  });
}

export function useLinkCheckDomains(siteId: string | undefined, workspaceId?: string) {
  return useQuery({
    queryKey: ADMIN_LINKS_QUERY_KEYS.linkCheckDomains(siteId ?? 'missing-site', workspaceId),
    // The API client types linkCheckDomains as Promise<unknown[]>, but the endpoint returns
    // a SiteDomainInfo object (staging/customDomains/defaultDomain) — widen through unknown.
    queryFn: () => webflow.linkCheckDomains(siteId ?? '', workspaceId) as unknown as Promise<SiteDomainInfo>,
    enabled: !!siteId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useLinkCheckSnapshot(siteId: string | undefined, workspaceId?: string) {
  return useQuery({
    queryKey: ADMIN_LINKS_QUERY_KEYS.linkCheckSnapshot(siteId ?? 'missing-site', workspaceId),
    queryFn: () => webflow.linkCheckSnapshot(siteId ?? '', workspaceId) as Promise<LinkCheckSnapshot | null>,
    enabled: !!siteId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRunLinkCheck(siteId: string | undefined, workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (domain?: string) => {
      if (!siteId) throw new Error('A Webflow site is required before running a link check.');
      return webflow.linkCheck(siteId, domain, workspaceId) as Promise<LinkCheckResult>;
    },
    onSuccess: (result) => {
      if (!siteId) return;
      queryClient.setQueryData<LinkCheckSnapshot>(
        ADMIN_LINKS_QUERY_KEYS.linkCheckSnapshot(siteId, workspaceId),
        { result, createdAt: result.checkedAt },
      );
    },
  });
}

export function useSiteArchitecture(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ADMIN_LINKS_QUERY_KEYS.siteArchitecture(workspaceId ?? 'missing-workspace'),
    queryFn: () => siteArchitecture.get(workspaceId ?? '') as Promise<SiteArchitectureResult>,
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSchemaCoverage(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ADMIN_LINKS_QUERY_KEYS.schemaCoverage(workspaceId ?? 'missing-workspace'),
    queryFn: () => siteArchitecture.schemaCoverage(workspaceId ?? '') as Promise<SchemaCoverageData>,
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSendRedirectProposal(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (body: RedirectProposalInput) => {
      if (!workspaceId) throw new Error('A workspace is required before sending redirect proposals.');
      return clientActions.create(workspaceId, {
        sourceType: 'redirect_proposal',
        ...body,
      });
    },
  });
}

export function useSendInternalLinks(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (body: InternalLinksClientInput) => {
      if (!workspaceId) throw new Error('A workspace is required before sending internal-link recommendations.');
      return clientActions.create(workspaceId, {
        sourceType: 'internal_link',
        ...body,
      });
    },
  });
}
