import { startSalesReportJob } from './sales-report-background-job.js';
import { startSeoAuditBackgroundJob } from './seo-audit-background-job.js';
import { startWebflowBulkAltJob } from './webflow-bulk-alt-background-job.js';
import { startWebflowBulkCompressJob } from './webflow-bulk-compress-background-job.js';
import { startWebflowBulkSeoFixJob } from './webflow-bulk-seo-fix-background-job.js';
import { startWebflowImageCompressJob } from './webflow-image-compress-background-job.js';
import {
  hasActiveJob,
} from './jobs.js';
import {
  getBrandName,
  getTokenForSite,
  getWorkspace,
} from './workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';

type LegacyJobType =
  | typeof BACKGROUND_JOB_TYPES.SEO_AUDIT
  | typeof BACKGROUND_JOB_TYPES.COMPRESS
  | typeof BACKGROUND_JOB_TYPES.BULK_COMPRESS
  | typeof BACKGROUND_JOB_TYPES.BULK_ALT
  | typeof BACKGROUND_JOB_TYPES.BULK_SEO_FIX
  | typeof BACKGROUND_JOB_TYPES.SALES_REPORT;

interface LegacyJobContext {
  port: number;
  internalHeaders: Record<string, string>;
}

interface LegacyJobStartResponse {
  status: number;
  body: unknown;
}

type LegacyJobStarter = (params: Record<string, unknown>, context: LegacyJobContext) => LegacyJobStartResponse;

function ok(body: unknown): LegacyJobStartResponse {
  return { status: 200, body };
}

function error(status: number, body: Record<string, unknown>): LegacyJobStartResponse {
  return { status, body };
}

const LEGACY_JOB_STARTERS: Record<LegacyJobType, LegacyJobStarter> = {
  [BACKGROUND_JOB_TYPES.SEO_AUDIT]: (params) => {
    const siteId = params.siteId as string;
    if (!siteId) return error(400, { error: 'siteId required' });
    const activeAudit = hasActiveJob(BACKGROUND_JOB_TYPES.SEO_AUDIT, params.workspaceId as string);
    if (activeAudit) {
      return error(409, { error: 'An SEO audit is already running for this workspace', jobId: activeAudit.id });
    }
    const token = getTokenForSite(siteId) || undefined;
    if (!token) return error(400, { error: 'No Webflow API token configured' });
    return ok(startSeoAuditBackgroundJob({
      workspaceId: params.workspaceId as string | undefined,
      siteId,
      token,
      skipLinkCheck: params.skipLinkCheck === true,
    }));
  },

  [BACKGROUND_JOB_TYPES.COMPRESS]: (params) => {
    const { assetId, imageUrl, siteId, altText, fileName } = params as {
      assetId: string;
      imageUrl: string;
      siteId: string;
      altText?: string;
      fileName?: string;
    };
    if (!assetId || !imageUrl || !siteId) return error(400, { error: 'assetId, imageUrl, siteId required' });
    return ok(startWebflowImageCompressJob({
      workspaceId: params.workspaceId as string | undefined,
      assetId,
      imageUrl,
      siteId,
      altText,
      fileName,
    }));
  },

  [BACKGROUND_JOB_TYPES.BULK_COMPRESS]: (params, context) => {
    const { assets, siteId } = params as {
      assets: Array<{ assetId: string; imageUrl: string; altText?: string; fileName?: string; cmsUsages?: unknown[] }>;
      siteId: string;
    };
    if (!assets?.length || !siteId) return error(400, { error: 'assets and siteId required' });
    const activeBulkCompress = hasActiveJob(BACKGROUND_JOB_TYPES.BULK_COMPRESS, params.workspaceId as string);
    if (activeBulkCompress) {
      return error(409, { error: 'A bulk compression is already running', jobId: activeBulkCompress.id });
    }
    return ok(startWebflowBulkCompressJob({
      workspaceId: params.workspaceId as string | undefined,
      siteId,
      assets,
      baseUrl: `http://localhost:${context.port}`,
      headers: context.internalHeaders,
    }));
  },

  [BACKGROUND_JOB_TYPES.BULK_ALT]: (params) => {
    const { assets, siteId } = params as {
      assets: Array<{ assetId: string; imageUrl: string }>;
      siteId?: string;
    };
    if (!assets?.length) return error(400, { error: 'assets required' });
    const activeBulkAlt = hasActiveJob(BACKGROUND_JOB_TYPES.BULK_ALT, params.workspaceId as string);
    if (activeBulkAlt) {
      return error(409, { error: 'Bulk alt text generation is already running', jobId: activeBulkAlt.id });
    }
    return ok(startWebflowBulkAltJob({
      workspaceId: params.workspaceId as string | undefined,
      siteId,
      assets,
    }));
  },

  [BACKGROUND_JOB_TYPES.BULK_SEO_FIX]: (params) => {
    // Callers MUST include `publishedPath` on each page for nested Webflow pages —
    // without it, tryResolvePagePath falls back to the legacy slug path which is wrong for
    // nested routes (e.g. `/services/seo` becomes `/seo`). The live bulk-fix route
    // in routes/webflow-seo-apply.ts accepts publishedPath; any frontend caller of this
    // job type must mirror that contract.
    const {
      siteId,
      pages: rawPages,
      field,
      workspaceId,
    } = params as {
      siteId: string;
      pages: Array<{
        pageId: string;
        title: string;
        slug?: string;
        publishedPath?: string | null;
        currentSeoTitle?: string;
        currentDescription?: string;
        pageContent?: string;
      }>;
      field: 'title' | 'description';
      workspaceId?: string;
    };
    const pages = (rawPages || []).filter((page) => !page.pageId.startsWith('cms-'));
    if (!siteId || !pages.length || !field || !workspaceId) {
      return error(400, { error: 'siteId, workspaceId, pages, field required' });
    }
    const workspace = getWorkspace(workspaceId);
    if (!workspace || workspace.webflowSiteId !== siteId) {
      return error(403, { error: 'You do not have access to this workspace' });
    }
    const activeBulkSeo = hasActiveJob(BACKGROUND_JOB_TYPES.BULK_SEO_FIX, workspaceId);
    if (activeBulkSeo) {
      return error(409, { error: 'A bulk SEO fix is already running', jobId: activeBulkSeo.id });
    }
    return ok(startWebflowBulkSeoFixJob({
      workspaceId,
      siteId,
      pages,
      field,
      token: getTokenForSite(siteId) || undefined,
      liveDomain: workspace.liveDomain,
      brandName: getBrandName(workspace),
    }));
  },

  [BACKGROUND_JOB_TYPES.SALES_REPORT]: (params) => {
    const { url, maxPages } = params as { url: string; maxPages?: number };
    if (!url) return error(400, { error: 'url required' });
    const requestedMaxPages = maxPages == null ? 25 : Number(maxPages);
    if (!Number.isInteger(requestedMaxPages) || requestedMaxPages <= 0) {
      return error(400, { error: 'maxPages must be a positive integer' });
    }
    if (requestedMaxPages > 100) {
      return error(400, { error: 'maxPages must be between 1 and 100' });
    }
    return ok(startSalesReportJob(url, requestedMaxPages));
  },
};

export function startLegacyJob(
  type: string,
  params: Record<string, unknown>,
  context: LegacyJobContext,
): LegacyJobStartResponse | null {
  const starter = LEGACY_JOB_STARTERS[type as LegacyJobType];
  return starter ? starter(params, context) : null;
}
