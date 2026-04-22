// ── SEO API (audit, schema, keywords, webflow, etc.) ──────────────
import { ApiError, get, post, put, patch, del, getSafe, getOptional } from './client';
import type { SchemaSitePlan, PageRoleAssignment, CanonicalEntity } from '../../shared/types/schema-plan';
import type { LatestRank, RankHistoryEntry } from '../hooks/useClientData';
import { readNdjsonStream, readSseStream } from './streamUtils';

export interface StrategyDiff {
  previousGeneratedAt: string;
  currentGeneratedAt: string;
  newKeywords: string[];
  lostKeywords: string[];
  newGaps: string[];
  resolvedGaps: string[];
  keywordChanges: { pagePath: string; oldKeyword: string; newKeyword: string }[];
  prevSiteKeywordCount: number;
  currSiteKeywordCount: number;
}

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

// ── Schema Validation ───────────────────────────────────────────
export interface SchemaValidationResult {
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: Array<{ type: string; field: string; message: string }>;
  warnings: Array<{ type: string; field: string; message: string }>;
}

export interface SchemaValidationRecord {
  id: string;
  pageId: string;
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: Array<{ type: string; message: string }>;
  warnings: Array<{ type: string; message: string }>;
  validatedAt: string;
}

export const schemaValidation = {
  validate: (siteId: string, body: { pageId: string; schema: Record<string, unknown> }) =>
    post<SchemaValidationResult>(`/api/webflow/schema-validate/${siteId}`, body),

  getAll: (siteId: string) =>
    getSafe<SchemaValidationRecord[]>(`/api/webflow/schema-validations/${siteId}`, []),

  get: (siteId: string, pageId: string) =>
    getOptional<SchemaValidationRecord>(`/api/webflow/schema-validation/${siteId}?pageId=${encodeURIComponent(pageId)}`),
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

  strategyDiff: (wsId: string) =>
    getOptional<StrategyDiff | null>(`/api/webflow/keyword-strategy/${wsId}/diff`),

  semrushStatus: () =>
    getOptional<unknown>('/api/semrush/status'),

  providerStatus: () =>
    getOptional<{ providers: { name: string; configured: boolean }[] }>('/api/seo-providers/status'),

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

  generateAlt: (workspaceId: string, assetId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/${workspaceId}/generate-alt/${assetId}`, body),

  compress: (workspaceId: string, assetId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/webflow/${workspaceId}/compress/${assetId}`, body),

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

// ── SEO Bulk Jobs (background operations) ──────────────────────
export const seoBulkJobs = {
  bulkAnalyze: (wsId: string, body: { pages: Array<{ pageId: string; title: string; slug?: string; seoTitle?: string; seoDescription?: string }> }) =>
    post<{ jobId: string }>(`/api/seo/${wsId}/bulk-analyze`, body),

  bulkRewrite: (wsId: string, body: { siteId: string; pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string }>; field: 'title' | 'description' | 'both' }) =>
    post<{ jobId: string }>(`/api/seo/${wsId}/bulk-rewrite`, body),

  bulkAcceptFixes: (wsId: string, body: { siteId: string; fixes: Array<{ pageId: string; check: string; suggestedFix: string; message?: string; pageSlug?: string; pageName?: string }> }) =>
    post<{ jobId: string }>(`/api/seo/${wsId}/bulk-accept-fixes`, body),
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

// ── Alt-text generation (single + bulk NDJSON stream) ───────────
/**
 * Generate alt text for a single Webflow asset.
 * Wraps POST /api/webflow/generate-alt/:assetId.
 */
export function generateAltText(
  workspaceId: string,
  assetId: string,
  body: { imageUrl: string; siteId?: string },
): Promise<{ altText: string | null; updated: boolean; writeError?: string }> {
  return post<{ altText: string | null; updated: boolean; writeError?: string }>(
    `/api/webflow/${workspaceId}/generate-alt/${assetId}`,
    body,
  );
}

/**
 * NDJSON event shape emitted by the bulk alt-text stream. Exported so callers
 * can narrow on `type` in their onEvent handler when they need progress
 * counters in addition to per-asset results.
 */
export interface BulkAltTextNdjsonEvent {
  type: 'result' | 'status' | 'done';
  assetId?: string;
  altText?: string;
  message?: string;
  error?: string;
  done?: number;
  total?: number;
  updated?: boolean;
}

/**
 * Bulk-generate alt text for selected Webflow assets. Wraps
 * POST /api/webflow/:workspaceId/bulk-generate-alt, which streams NDJSON
 * results line-by-line as each image is processed.
 *
 * `onProgress` fires per successfully generated alt text (truthy altText only).
 * `onEvent` fires for every raw NDJSON event including status ticks.
 * Rejects on non-ok HTTP response or network failure.
 */
export async function bulkGenerateAltText(
  workspaceId: string,
  body: { siteId: string; assets: Array<{ assetId: string; imageUrl: string }> },
  onProgress: (assetId: string, altText: string) => void,
  onEvent?: (event: BulkAltTextNdjsonEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errBody: unknown;
    try { errBody = await res.json(); } catch { /* non-JSON error body */ }
    const msg = (errBody && typeof errBody === 'object' && 'error' in errBody)
      ? String((errBody as { error: unknown }).error)
      : res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, errBody);
  }

  if (!res.body) throw new ApiError(0, 'Streaming not supported');

  await readNdjsonStream<BulkAltTextNdjsonEvent>(res.body, (event) => {
    onEvent?.(event);
    if (event.type === 'result' && event.assetId && event.altText) {
      onProgress(event.assetId, event.altText);
    }
  });
}

/**
 * SSE event emitted by the keyword-strategy generation stream. Mirrors the
 * shape parsed in KeywordStrategy.tsx.
 */
interface KeywordStrategySseEvent {
  error?: string;
  done?: boolean;
  strategy?: unknown;
  step?: string;
  detail?: string;
  progress?: number;
  message?: string;
}

/**
 * Stream the POST /api/webflow/keyword-strategy/:workspaceId SSE endpoint.
 * Returns a cleanup function that aborts the in-flight fetch — callers
 * should invoke it on unmount.
 *
 * Parsing mirrors KeywordStrategy.tsx:156 verbatim: split buffer on '\n',
 * keep incomplete trailing line, parse `data: ` prefixed lines as JSON, and
 * forward parsed events to onEvent (the caller decides which fields to react
 * to — progress, done+strategy, or error).
 */
export function streamKeywordStrategy(
  workspaceId: string,
  body: Record<string, unknown>,
  onEvent: (event: KeywordStrategySseEvent) => void,
  onError: (err: Error) => void,
  onDone: () => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Non-streaming error response (429, 400, 500, etc.) — parse JSON body.
        let data: KeywordStrategySseEvent = {};
        try { data = await res.json() as KeywordStrategySseEvent; } catch { /* non-JSON error body */ }
        if (!res.ok || data.error) {
          onError(new Error(data.message || data.error || 'Request failed'));
          return;
        }
        onDone();
        return;
      }

      await readSseStream<KeywordStrategySseEvent>(res.body, onEvent);
      onDone();
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return () => controller.abort();
}
