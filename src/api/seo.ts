// ── SEO API (audit, schema, keywords, webflow, etc.) ──────────────
import { get, post, put, patch, del, getSafe, getOptional } from './client';

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

  bulkGenerate: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/schema/${wsId}/bulk-generate`, body),

  deployHistory: (wsId: string) =>
    getSafe<unknown[]>(`/api/schema/${wsId}/deploy-history`, []),
};

// ── Keywords / Strategy ─────────────────────────────────────────
export const keywords = {
  analyze: (body: Record<string, unknown>) =>
    post<unknown>('/api/keyword-analysis', body),

  strategy: (wsId: string) =>
    getOptional<unknown>(`/api/public/seo-strategy/${wsId}`),

  updateStrategy: (wsId: string, body: Record<string, unknown>) =>
    patch<unknown>(`/api/keyword-strategy/${wsId}`, body),
};

// ── Rank tracking ───────────────────────────────────────────────
export const rankTracking = {
  keywords: (wsId: string) =>
    get<unknown[]>(`/api/rank-tracking/${wsId}/keywords`),

  latest: (wsId: string) =>
    getSafe<unknown[]>(`/api/rank-tracking/${wsId}/latest`, []),

  history: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/rank-tracking/${wsId}/history`, []),

  addKeyword: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/rank-tracking/${wsId}/keywords`, body),

  removeKeyword: (wsId: string, query: string) =>
    del(`/api/rank-tracking/${wsId}/keywords/${encodeURIComponent(query)}`),

  togglePin: (wsId: string, query: string) =>
    patch<unknown>(`/api/rank-tracking/${wsId}/keywords/${encodeURIComponent(query)}/pin`, {}),

  snapshot: (wsId: string) =>
    post<unknown>(`/api/rank-tracking/${wsId}/snapshot`),

  publicLatest: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/rank-tracking/${wsId}/latest`, []),
};

// ── Webflow ─────────────────────────────────────────────────────
export const webflow = {
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
};

// ── Content performance ─────────────────────────────────────────
export const contentPerformance = {
  get: (wsId: string, days: number) =>
    get<unknown>(`/api/content-performance/${wsId}?days=${days}`),

  refresh: (wsId: string) =>
    post<unknown>(`/api/content-performance/${wsId}/refresh`),
};

// ── AEO Review ──────────────────────────────────────────────────
export const aeoReview = {
  get: (wsId: string) =>
    getOptional<unknown>(`/api/aeo-review/${wsId}`),

  analyze: (wsId: string) =>
    post<unknown>(`/api/aeo-review/${wsId}/analyze`),

  pageDetail: (wsId: string, path: string) =>
    get<unknown>(`/api/aeo-review/${wsId}/page?path=${encodeURIComponent(path)}`),
};

// ── Competitor analysis ─────────────────────────────────────────
export const competitor = {
  analyze: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/competitor-analysis/${wsId}`, body),

  history: (wsId: string) =>
    getSafe<unknown[]>(`/api/competitor-analysis/${wsId}/history`, []),
};

// ── SEO change tracker ──────────────────────────────────────────
export const seoChangeTracker = {
  get: (wsId: string) =>
    getSafe<unknown[]>(`/api/seo-changes/${wsId}`, []),

  impact: (wsId: string) =>
    getSafe<unknown[]>(`/api/seo-changes/${wsId}/impact`, []),
};

// ── Page weight ─────────────────────────────────────────────────
export const pageWeight = {
  get: (wsId: string) =>
    getOptional<unknown>(`/api/pagespeed/${wsId}`),

  analyze: (wsId: string) =>
    post<unknown>(`/api/pagespeed/${wsId}/analyze`),
};
