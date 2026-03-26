// ── SEO API (audit, schema, keywords, webflow, etc.) ──────────────
import { get, post, put, patch, del, getSafe, getOptional } from './client';
import type { SchemaSitePlan, PageRoleAssignment, CanonicalEntity } from '../../shared/types/schema-plan';
import type { LatestRank, RankHistoryEntry } from '../hooks/useClientData';

// ── Audit ───────────────────────────────────────────────────────
export const audit = {
  summary: (wsId: string) =>
    getOptional<unknown>(`/api/public/audit-summary/${wsId}`),

  detail: (wsId: string) =>
    getOptional<unknown>(`/api/public/audit-detail/${wsId}`),

  traffic: (siteId: string) =>
    getSafe<Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>>(`/api/audit-traffic/${siteId}`, {}),

  publicAudit: (wsId: string) =>
    getOptional<unknown>(`/api/public/audit/${wsId}`),
};

// ── Audit schedules ─────────────────────────────────────────────
export const auditSchedules = {
  get: (wsId: string) =>
    getOptional<unknown>(`/api/audit-schedules/${wsId}`),

  save: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/audit-schedules/${wsId}`, body),

  enable: (wsId: string) =>
    put<unknown>(`/api/audit-schedules/${wsId}`, { enabled: true }),
};

// ── Reports / snapshots ─────────────────────────────────────────
export const reports = {
  history: (siteId: string) =>
    getSafe<unknown[]>(`/api/reports/${siteId}/history`, []),

  latest: (siteId: string) =>
    getOptional<unknown>(`/api/reports/${siteId}/latest`),

  snapshot: (siteId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/reports/${siteId}/snapshot`, body),

  updateAction: (snapshotId: string, actionId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/reports/snapshot/${snapshotId}/actions/${actionId}`, body),

  removeAction: (snapshotId: string, actionId: string) =>
    del(`/api/reports/snapshot/${snapshotId}/actions/${actionId}`),
};

// ── Schema ──────────────────────────────────────────────────────
export const schema = {
  suggestions: (wsId: string) =>
    get<unknown>(`/api/schema/${wsId}`),

  generate: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/schema/${wsId}/generate`, body),

  save: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/schema/${wsId}/save`, body),

  apply: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/schema/${wsId}/apply`, body),

  validate: (wsId: string) =>
    get<unknown>(`/api/schema/${wsId}/validate`),

  pagePreview: (wsId: string, pageId: string) =>
    get<unknown>(`/api/schema/${wsId}/page/${pageId}`),

  remove: (wsId: string, pageId: string) =>
    del(`/api/schema/${wsId}/${pageId}`),

  retract: (wsId: string, pageId: string) =>
    del(`/api/webflow/schema-retract/${wsId}/${pageId}`),

  bulkGenerate: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/schema/${wsId}/bulk-generate`, body),

  deployHistory: (wsId: string) =>
    getSafe<unknown[]>(`/api/schema/${wsId}/deploy-history`, []),
};

// ── Schema Site Plan ────────────────────────────────────────────
export const schemaPlan = {
  get: (siteId: string) =>
    getOptional<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}`),

  generate: (siteId: string) =>
    post<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}`),

  update: (siteId: string, pageRoles: PageRoleAssignment[], canonicalEntities?: CanonicalEntity[]) =>
    put<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}`, { pageRoles, canonicalEntities }),

  sendToClient: (siteId: string) =>
    post<{ plan: SchemaSitePlan }>(`/api/webflow/schema-plan/${siteId}/send-to-client`),

  activate: (siteId: string) =>
    post<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}/activate`),

  retract: (siteId: string) =>
    del(`/api/webflow/schema-plan/${siteId}`),
};

// ── Keywords / Strategy ─────────────────────────────────────────
export const keywords = {
  analyze: (body: Record<string, unknown>) =>
    post<unknown>('/api/webflow/keyword-analysis', body),

  persistAnalysis: (body: { workspaceId: string; pagePath: string; analysis: Record<string, unknown> }) =>
    post<{ success: boolean; pagePath: string; hasAnalysis: boolean }>('/api/webflow/keyword-analysis/persist', body),

  strategy: (wsId: string) =>
    getOptional<unknown>(`/api/public/seo-strategy/${wsId}`),

  updateStrategy: (wsId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/webflow/keyword-strategy/${wsId}`, body),

  webflowStrategy: (wsId: string) =>
    get<unknown>(`/api/webflow/keyword-strategy/${wsId}`),

  generateStrategy: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/keyword-strategy/${wsId}`, body),

  patchStrategy: (wsId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/webflow/keyword-strategy/${wsId}`, body),

  semrushStatus: () =>
    getOptional<unknown>('/api/semrush/status'),

  discoverCompetitors: (wsId: string) =>
    get<{ competitors: Array<{ domain: string; relevance: number; commonKeywords: number; organicKeywords: number; organicTraffic: number }> }>(`/api/semrush/discover-competitors/${wsId}`),

  saveCompetitors: (wsId: string, domains: string[]) =>
    post<{ saved: number }>(`/api/semrush/competitors/${wsId}`, { domains }),

  seoCopy: (body: Record<string, unknown>) =>
    post<unknown>('/api/webflow/seo-copy', body),
};

// ── Rank tracking ───────────────────────────────────────────────
export const rankTracking = {
  keywords: (wsId: string) =>
    get<Array<{ query: string; pinned?: boolean; addedAt?: string }>>(`/api/rank-tracking/${wsId}/keywords`),

  latest: (wsId: string) =>
    getSafe<LatestRank[]>(`/api/rank-tracking/${wsId}/latest`, []),

  history: (wsId: string) =>
    getSafe<RankHistoryEntry[]>(`/api/public/rank-tracking/${wsId}/history`, []),

  addKeyword: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/rank-tracking/${wsId}/keywords`, body),

  removeKeyword: (wsId: string, query: string) =>
    del(`/api/rank-tracking/${wsId}/keywords/${encodeURIComponent(query)}`),

  togglePin: (wsId: string, query: string) =>
    patch<unknown>(`/api/rank-tracking/${wsId}/keywords/${encodeURIComponent(query)}/pin`, {}),

  snapshot: (wsId: string) =>
    post<unknown>(`/api/rank-tracking/${wsId}/snapshot`),

  publicLatest: (wsId: string) =>
    getSafe<LatestRank[]>(`/api/public/rank-tracking/${wsId}/latest`, []),
};

// ── Backlinks ────────────────────────────────────────────────────
export const backlinks = {
  get: (wsId: string) =>
    getOptional<unknown>(`/api/backlinks/${wsId}`),
};

// ── Webflow ─────────────────────────────────────────────────────
export const webflow = {
  sites: (token: string) =>
    get<unknown[]>(`/api/webflow/sites?token=${encodeURIComponent(token)}`),

  pages: (siteId: string) =>
    get<unknown[]>(`/api/webflow/pages/${siteId}`),

  pageHtml: (siteId: string, path: string) =>
    get<unknown>(`/api/webflow/page-html/${siteId}?path=${encodeURIComponent(path)}`),

  updatePageSeo: (pageId: string, body: Record<string, unknown>) =>
    put<unknown>(`/api/webflow/pages/${pageId}/seo`, body),

  publish: (siteId: string) =>
    post<unknown>(`/api/webflow/publish/${siteId}`),

  bulkFix: (siteId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/seo-bulk-fix/${siteId}`, body),

  assets: (siteId: string) =>
    get<unknown[]>(`/api/webflow/assets/${siteId}`),

  updateAsset: (assetId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/webflow/assets/${assetId}`, body),

  removeAsset: (assetId: string, siteId: string) =>
    del(`/api/webflow/assets/${assetId}?siteId=${siteId}`),

  generateAlt: (assetId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/generate-alt/${assetId}`, body),

  compress: (assetId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/compress/${assetId}`, body),

  rename: (assetId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/webflow/rename/${assetId}`, body),

  organizePreview: (siteId: string) =>
    get<unknown>(`/api/webflow/organize-preview/${siteId}`),

  organizeExecute: (siteId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/organize-execute/${siteId}`, body),

  auditAssets: (siteId: string) =>
    get<unknown>(`/api/webflow/audit/${siteId}`),

  linkCheckDomains: (siteId: string) =>
    get<unknown[]>(`/api/webflow/link-check-domains/${siteId}`),

  linkCheck: (siteId: string, domain?: string) =>
    get<unknown>(`/api/webflow/link-check/${siteId}${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`),

  linkCheckSnapshot: (siteId: string) =>
    get<unknown>(`/api/webflow/link-check-snapshot/${siteId}`),

  cmsCollections: (siteId: string) =>
    get<unknown[]>(`/api/webflow/cms/collections/${siteId}`),

  cmsItems: (collectionId: string) =>
    get<unknown[]>(`/api/webflow/cms/items/${collectionId}`),

  updateCmsItem: (collectionId: string, itemId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/webflow/cms/items/${collectionId}/${itemId}`, body),

  internalLinks: (siteId: string) =>
    get<unknown>(`/api/webflow/internal-links/${siteId}`),

  internalLinksAnalyze: (siteId: string) =>
    post<unknown>(`/api/webflow/internal-links/${siteId}/analyze`),

  internalLinksWithParams: (siteId: string, workspaceId?: string) =>
    get<unknown>(`/api/webflow/internal-links/${siteId}${workspaceId ? `?workspaceId=${workspaceId}` : ''}`),

  internalLinksSnapshot: (siteId: string) =>
    getOptional<unknown>(`/api/webflow/internal-links-snapshot/${siteId}`),
};

// ── SEO Suggestions (persistent bulk rewrite variations) ────────
export interface SeoSuggestionClient {
  id: string;
  workspaceId: string;
  siteId: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: 'title' | 'description';
  currentValue: string;
  variations: string[];
  selectedIndex: number | null;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

export const seoSuggestions = {
  list: (wsId: string, field?: 'title' | 'description') =>
    get<{ suggestions: SeoSuggestionClient[]; counts: { pending: number; selected: number; total: number } }>(
      `/api/webflow/seo-suggestions/${wsId}${field ? `?field=${field}` : ''}`
    ),

  select: (wsId: string, suggestionId: string, selectedIndex: number) =>
    patch<{ ok: boolean }>(`/api/webflow/seo-suggestions/${wsId}/${suggestionId}`, { selectedIndex }),

  apply: (wsId: string, suggestionIds?: string[]) =>
    post<{ results: Array<{ pageId: string; field: string; text: string; applied: boolean; error?: string }>; applied: number; total: number }>(
      `/api/webflow/seo-suggestions/${wsId}/apply`,
      { suggestionIds }
    ),

  dismiss: (wsId: string, suggestionIds?: string[]) =>
    del(`/api/webflow/seo-suggestions/${wsId}`, { suggestionIds }),
};

// ── Content performance ─────────────────────────────────────────
export const contentPerformance = {
  get: (wsId: string, days?: number) =>
    get<unknown>(`/api/content-performance/${wsId}${days ? `?days=${days}` : ''}`),

  publicGet: (wsId: string) =>
    getOptional<unknown>(`/api/public/content-performance/${wsId}`),

  refresh: (wsId: string) =>
    post<unknown>(`/api/content-performance/${wsId}/refresh`),

  trend: (wsId: string, requestId: string) =>
    get<unknown>(`/api/content-performance/${wsId}/${requestId}/trend`),
};

// ── AEO Review ──────────────────────────────────────────────────
export const aeoReview = {
  get: (wsId: string) =>
    getOptional<unknown>(`/api/aeo-review/${wsId}`),

  analyze: (wsId: string) =>
    post<unknown>(`/api/aeo-review/${wsId}/analyze`),

  pageDetail: (wsId: string, path: string) =>
    get<unknown>(`/api/aeo-review/${wsId}/page?path=${encodeURIComponent(path)}`),

  siteReview: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/aeo-review/${wsId}/site`, body),

  pageReview: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/aeo-review/${wsId}/page`, body),
};

// ── Competitor analysis ─────────────────────────────────────────
export const competitor = {
  compare: (body: Record<string, unknown>) =>
    post<unknown>('/api/competitor-compare', body),

  snapshot: (myUrl: string, competitorUrl: string) =>
    getOptional<unknown>(`/api/competitor-compare-snapshot?myUrl=${encodeURIComponent(myUrl)}&competitorUrl=${encodeURIComponent(competitorUrl)}`),

  latest: (myUrl: string) =>
    getOptional<unknown>(`/api/competitor-compare-latest?myUrl=${encodeURIComponent(myUrl)}`),
};

// ── SEO change tracker ──────────────────────────────────────────
export const seoChangeTracker = {
  get: (wsId: string) =>
    getSafe<unknown[]>(`/api/seo-changes/${wsId}`, []),

  impact: (wsId: string) =>
    getSafe<unknown[]>(`/api/seo-change-impact/${wsId}`, []),
};

// ── Schema impact tracking ──────────────────────────────────────
export interface SchemaDeploymentImpact {
  change: {
    id: string;
    pageSlug: string;
    pageTitle: string;
    fields: string[];
    source: string;
    changedAt: string;
  };
  before: { clicks: number; impressions: number; ctr: number; position: number } | null;
  after: { clicks: number; impressions: number; ctr: number; position: number } | null;
  daysSinceChange: number;
  tooRecent: boolean;
}

export interface SchemaImpactData {
  totalDeployments: number;
  pagesWithData: number;
  tooRecent: number;
  avgClicksDelta: number | null;
  avgImpressionsDelta: number | null;
  avgCtrDelta: number | null;
  avgPositionDelta: number | null;
  deployments: SchemaDeploymentImpact[];
}

export const schemaImpact = {
  get: (wsId: string) =>
    get<SchemaImpactData>(`/api/schema-impact/${wsId}`),
};

// ── Page weight ─────────────────────────────────────────────────
export const pageWeight = {
  get: (wsId: string) =>
    getOptional<unknown>(`/api/pagespeed/${wsId}`),

  analyze: (wsId: string) =>
    post<unknown>(`/api/pagespeed/${wsId}/analyze`),

  webflowPageWeight: (siteId: string) =>
    get<unknown>(`/api/webflow/page-weight/${siteId}`),

  webflowPageWeightSnapshot: (siteId: string) =>
    getOptional<unknown>(`/api/webflow/page-weight-snapshot/${siteId}`),

  pagespeedBulk: (siteId: string, strategy: string, maxPages?: number) =>
    get<unknown>(`/api/webflow/pagespeed/${siteId}?strategy=${strategy}&maxPages=${maxPages ?? 3}`),

  pagespeedSingle: (siteId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/pagespeed-single/${siteId}`, body),

  pagespeedSnapshot: (siteId: string) =>
    getOptional<unknown>(`/api/webflow/pagespeed-snapshot/${siteId}`),
};
