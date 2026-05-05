/**
 * jobs routes — extracted from server/index.ts
 *
 * @reads jobs, workspaces, snapshots, schema_snapshots, recommendations, workspace_pages, page_keywords, google_analytics, search_console, webflow_api, content_briefs
 * @writes jobs, snapshots, schema_snapshots, recommendations, webflow_assets, page_keywords, seo_changes, usage_tracking, activities, content_posts
 */
import { Router } from 'express';

const router = Router();

import fs from 'fs';
import path from 'path';
import { addActivity } from '../activity-log.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { generateAltText } from '../alttext.js';
import { getDataDir } from '../data-dir.js';
import { notifyClientRecommendationsReady, notifyClientAuditComplete } from '../email.js';
import { applySuppressionsToAudit, tryResolvePagePath, stripHtmlToText } from '../helpers.js';
import { resolveBaseUrl } from '../url-helpers.js';
import {
  createJob,
  updateJob,
  getJob,
  listJobs,
  cancelJob,
  clearCompletedJobs,
  registerAbort,
  hasActiveJob,
} from '../jobs.js';
import { APP_PASSWORD, signAdminToken } from '../middleware.js';
import { requestUserCanAccessWorkspace, sendWorkspaceAccessDenied, workspaceOwnsWebflowSite } from '../auth.js';
import { callOpenAI } from '../openai-helpers.js';
import { generateRecommendations, loadRecommendations } from '../recommendations.js';
import { getBrief } from '../content-brief.js';
import {
  createContentPostGenerationJob,
  runContentPostGenerationJob,
} from '../content-posts.js';
import {
  generateKeywordStrategy,
  hasActiveKeywordStrategyGeneration,
  KeywordStrategyGenerationError,
} from '../keyword-strategy-generation.js';
import { saveSnapshot, getLatestSnapshotBefore } from '../reports.js';
import { runSalesAudit } from '../sales-audit.js';
import { runSchemaGenerationJob } from '../schema-generation-job.js';
import { runSeoAudit } from '../seo-audit.js';
import {
  updateAsset,
  deleteAsset,
  updatePageSeo,
  uploadAsset,
} from '../webflow.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  getClientPortalUrl,
  updatePageState,
  getBrandName,
} from '../workspaces.js';
import { runPageAnalysisJob } from '../page-analysis-job.js';
import {
  startWorkspaceContextGenerationJob,
  workspaceContextJobErrorResponse,
} from '../workspace-context-generation-job.js';
import { createLogger } from '../logger.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { getInsights } from '../analytics-insights-store.js';
import { createDiagnosticReport, markDiagnosticFailed } from '../diagnostic-store.js';
import { runDiagnostic } from '../diagnostic-orchestrator.js';
import type { AnalyticsInsight, AnomalyDigestData } from '../../shared/types/analytics.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { buildWorkspaceIntelligence, formatKeywordsForPrompt } from '../workspace-intelligence.js';
import type { default as SharpConstructor } from 'sharp';
import type * as SvgoMod from 'svgo';
import { isProgrammingError } from '../errors.js';

const log = createLogger('jobs');

const PORT = parseInt(process.env.PORT || '3001', 10);

function internalAdminHeaders(): Record<string, string> {
  return APP_PASSWORD ? { 'x-auth-token': signAdminToken() } : {};
}

const keywordStrategyStepLabels: Record<string, string> = {
  discovery: 'Discovering pages',
  content: 'Fetching page content',
  search_data: 'Search Console data',
  semrush: 'Keyword intelligence',
  ai: 'AI analysis',
  enrichment: 'Enriching data',
  complete: 'Complete',
};

// --- Background Job Endpoints ---
router.get('/api/jobs', (_req, res) => {
  const wsId = _req.query.workspaceId as string | undefined;
  if (wsId && !requestUserCanAccessWorkspace(_req, wsId)) return sendWorkspaceAccessDenied(res);
  if (!wsId && _req.user && _req.user.role !== 'owner') {
    const visible = (_req.user.workspaceIds || []).flatMap(id => listJobs(id));
    const deduped = [...new Map(visible.map(job => [job.id, job])).values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json(deduped);
  }
  res.json(listJobs(wsId));
});

router.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.workspaceId && !requestUserCanAccessWorkspace(req, job.workspaceId)) return sendWorkspaceAccessDenied(res);
  res.json(job);
});

router.delete('/api/jobs/completed', (_req, res) => {
  const workspaceId = typeof _req.query.workspaceId === 'string' ? _req.query.workspaceId : undefined;
  const scope = typeof _req.query.scope === 'string' ? _req.query.scope : undefined;
  if (workspaceId) {
    if (!requestUserCanAccessWorkspace(_req, workspaceId)) return sendWorkspaceAccessDenied(res);
    const count = clearCompletedJobs({ workspaceId });
    return res.json({ cleared: count });
  }
  if (scope === 'global') {
    const count = clearCompletedJobs({ globalOnly: true });
    return res.json({ cleared: count });
  }
  if (_req.user && _req.user.role !== 'owner') return sendWorkspaceAccessDenied(res);
  const count = clearCompletedJobs();
  res.json({ cleared: count });
});

router.delete('/api/jobs/:id', (req, res) => {
  const existing = getJob(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  if (existing.workspaceId && !requestUserCanAccessWorkspace(req, existing.workspaceId)) return sendWorkspaceAccessDenied(res);
  const job = cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/api/jobs', async (req, res) => {
  const { type, params = {} } = req.body as { type: string; params?: Record<string, unknown> };
  if (!type) return res.status(400).json({ error: 'type required' });
  const requestedWorkspaceId = params?.workspaceId;
  if (typeof requestedWorkspaceId === 'string' && !requestUserCanAccessWorkspace(req, requestedWorkspaceId)) {
    return sendWorkspaceAccessDenied(res);
  }
  const requestedSiteId = params?.siteId;
  if (typeof requestedSiteId === 'string') {
    if (typeof requestedWorkspaceId === 'string') {
      if (!workspaceOwnsWebflowSite(requestedWorkspaceId, requestedSiteId)) return sendWorkspaceAccessDenied(res);
    } else if (req.user && req.user.role !== 'owner') {
      return sendWorkspaceAccessDenied(res);
    }
  }

  try {
    switch (type) {
      case 'seo-audit': {
        const siteId = params.siteId as string;
        if (!siteId) return res.status(400).json({ error: 'siteId required' });
        const activeAudit = hasActiveJob('seo-audit', params.workspaceId as string);
        if (activeAudit) return res.status(409).json({ error: 'An SEO audit is already running for this workspace', jobId: activeAudit.id });
        const token = getTokenForSite(siteId) || undefined;
        if (!token) return res.status(400).json({ error: 'No Webflow API token configured' });
        const job = createJob('seo-audit', { message: 'Running SEO audit...', workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        // Fire and forget
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Scanning pages...' });
            const result = await runSeoAudit(siteId, token, params.workspaceId as string, params.skipLinkCheck === true);
            // Auto-save snapshot so overview + client dashboard stay in sync
            const ws = getWorkspace(params.workspaceId as string);
            const siteName = getBrandName(ws) || siteId;
            const snapshot = saveSnapshot(siteId, siteName, result);
            const effectiveResult = ws?.auditSuppressions?.length ? applySuppressionsToAudit(result, ws.auditSuppressions) : result;
            if (ws) {
              addActivity(ws.id, 'audit_completed', `Site audit completed — score ${effectiveResult.siteScore}`,
                `${effectiveResult.totalPages} pages scanned, ${effectiveResult.errors} errors, ${effectiveResult.warnings} warnings`,
                { score: effectiveResult.siteScore, previousScore: snapshot.previousScore });
            }
            updateJob(job.id, { status: 'done', result: { ...result, snapshotId: snapshot.id }, message: `Audit complete — score ${effectiveResult.siteScore}` });
            // Auto-regenerate recommendations after audit
            if (ws) {
              try {
                await generateRecommendations(ws.id);
                log.info(`Auto-regenerated recommendations for ${ws.id}`);
                // Notify client that recommendations are ready
                if (ws.clientEmail) {
                  const dashUrl = getClientPortalUrl(ws);
                  const recSet = loadRecommendations(ws.id);
                  const recs = recSet?.recommendations || [];
                  if (recs.length > 0) {
                    notifyClientRecommendationsReady({ clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: ws.id, recCount: recs.length, dashboardUrl: dashUrl });
                  }
                }
              } catch (recErr) {
                log.error({ err: recErr }, 'Failed to regenerate recommendations');
              }
              // Notify client of audit completion with suppressed data
              if (ws.clientEmail) {
                const dashUrl = getClientPortalUrl(ws);
                // Collect issues from suppressed audit, sorted errors first
                const allIssues: Array<{ message: string; severity: string }> = [];
                for (const p of effectiveResult.pages) {
                  for (const iss of p.issues) {
                    if (iss.severity === 'error' || iss.severity === 'warning') {
                      allIssues.push({ message: iss.message, severity: iss.severity });
                    }
                  }
                }
                // Deduplicate by message, keep highest severity
                const seen = new Map<string, { message: string; severity: string }>();
                for (const iss of allIssues) {
                  const existing = seen.get(iss.message);
                  if (!existing || (iss.severity === 'error' && existing.severity !== 'error')) {
                    seen.set(iss.message, iss);
                  }
                }
                const uniqueIssues = [...seen.values()];
                uniqueIssues.sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
                const topIssues = uniqueIssues.slice(0, 5);

                // Compare suppressed versions for accurate fixed count
                let fixedCount = 0;
                if (snapshot.previousScore != null) {
                  const prev = getLatestSnapshotBefore(ws.webflowSiteId!, snapshot.id);
                  if (prev) {
                    const prevAudit = ws.auditSuppressions?.length
                      ? applySuppressionsToAudit(prev.audit, ws.auditSuppressions)
                      : prev.audit;
                    const prevIssueKeys = new Set<string>();
                    for (const p of prevAudit.pages) {
                      for (const iss of p.issues) prevIssueKeys.add(`${p.pageId}:${iss.check}`);
                    }
                    const curIssueKeys = new Set<string>();
                    for (const p of effectiveResult.pages) {
                      for (const iss of p.issues) curIssueKeys.add(`${p.pageId}:${iss.check}`);
                    }
                    for (const k of prevIssueKeys) {
                      if (!curIssueKeys.has(k)) fixedCount++;
                    }
                  }
                }

                notifyClientAuditComplete({
                  clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: ws.id,
                  score: effectiveResult.siteScore, previousScore: snapshot.previousScore,
                  totalPages: effectiveResult.totalPages, errors: effectiveResult.errors, warnings: effectiveResult.warnings,
                  topIssues, fixedCount, dashboardUrl: dashUrl,
                });
              }
            }
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: audit job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: audit job failed — degrading gracefully');
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Audit failed' });
          }
        })();
        break;
      }

      case 'compress': {
        const { assetId, imageUrl, siteId, altText, fileName } = params as { assetId: string; imageUrl: string; siteId: string; altText?: string; fileName?: string };
        if (!assetId || !imageUrl || !siteId) return res.status(400).json({ error: 'assetId, imageUrl, siteId required' });
        const compressToken = getTokenForSite(siteId) || undefined;
        const job = createJob('compress', { message: `Compressing ${fileName || 'image'}...`, workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running' });
            const sharp: typeof SharpConstructor = (await import('sharp')).default; // dynamic-import-ok
            const response = await fetch(imageUrl);
            const originalBuffer = Buffer.from(await response.arrayBuffer());
            const originalSize = originalBuffer.length;
            const ext = (fileName || imageUrl).split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
            let compressed: Buffer;
            let newFileName: string;
            const baseName = (fileName || 'image').replace(/\.[^.]+$/, '');

            if (ext === 'svg') {
              const svgo: typeof SvgoMod = await import('svgo'); // dynamic-import-ok
              const svgString = originalBuffer.toString('utf-8');
              const svgResult = svgo.optimize(svgString, { multipass: true, plugins: ['preset-default'] } as Parameters<typeof svgo.optimize>[1]);
              compressed = Buffer.from(svgResult.data, 'utf-8');
              newFileName = `${baseName}.svg`;
            } else if (ext === 'jpg' || ext === 'jpeg') {
              compressed = await sharp(originalBuffer).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
              newFileName = `${baseName}.jpg`;
            } else if (ext === 'png') {
              const webpBuffer = await sharp(originalBuffer).webp({ quality: 80 }).toBuffer();
              const pngBuffer = await sharp(originalBuffer).png({ compressionLevel: 9, palette: true }).toBuffer();
              if (webpBuffer.length < pngBuffer.length) { compressed = webpBuffer; newFileName = `${baseName}.webp`; }
              else { compressed = pngBuffer; newFileName = `${baseName}.png`; }
            } else {
              compressed = await sharp(originalBuffer).webp({ quality: 80 }).toBuffer();
              newFileName = `${baseName}.webp`;
            }

            const newSize = compressed.length;
            const savings = originalSize - newSize;
            const savingsPercent = Math.round((savings / originalSize) * 100);

            if (savingsPercent < 3) {
              updateJob(job.id, { status: 'done', result: { skipped: true, reason: `Already optimized (only ${savingsPercent}% savings)` }, message: 'Already optimized' });
              return;
            }

            const tmpPath = `/tmp/compressed_${Date.now()}_${newFileName}`;
            fs.writeFileSync(tmpPath, compressed);
            const uploadResult = await uploadAsset(siteId, tmpPath, newFileName, altText, compressToken);
            try { fs.unlinkSync(tmpPath); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs: programming error'); /* ignore */ }

            if (!uploadResult.success) {
              updateJob(job.id, { status: 'error', error: uploadResult.error, message: 'Upload failed' });
              return;
            }
            await deleteAsset(assetId, compressToken);
            updateJob(job.id, {
              status: 'done',
              result: { success: true, newAssetId: uploadResult.assetId, originalSize, newSize, savings, savingsPercent, newFileName },
              message: `Saved ${Math.round(savings / 1024)}KB (${savingsPercent}%)`,
            });
            const singleCompressWsId = params.workspaceId as string;
            if (singleCompressWsId) {
              addActivity(singleCompressWsId, 'images_optimized',
                `Image compressed: ${fileName || 'image'} — saved ${Math.round(savings / 1024)}KB (${savingsPercent}%)`,
                undefined,
                { originalSize, newSize, savings, savingsPercent }
              );
            }
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: compress job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: compress job failed — degrading gracefully');
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Compression failed' });
          }
        })();
        break;
      }

      case 'bulk-compress': {
        const { assets, siteId } = params as { assets: Array<{ assetId: string; imageUrl: string; altText?: string; fileName?: string; cmsUsages?: unknown[] }>; siteId: string };
        if (!assets?.length || !siteId) return res.status(400).json({ error: 'assets and siteId required' });
        const activeBulkCompress = hasActiveJob('bulk-compress', params.workspaceId as string);
        if (activeBulkCompress) return res.status(409).json({ error: 'A bulk compression is already running', jobId: activeBulkCompress.id });
        const job = createJob('bulk-compress', { message: `Compressing ${assets.length} assets...`, total: assets.length, workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', progress: 0 });
            let totalSaved = 0;
            const results: unknown[] = [];
            for (let i = 0; i < assets.length; i++) {
              const asset = assets[i];
              try {
                const compressRes = await fetch(`http://localhost:${PORT}/api/webflow/${params.workspaceId}/compress/${asset.assetId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...internalAdminHeaders() },
                  body: JSON.stringify({ imageUrl: asset.imageUrl, siteId, altText: asset.altText, fileName: asset.fileName, cmsUsages: asset.cmsUsages }),
                });
                const r = await compressRes.json() as Record<string, unknown>;
                results.push({ assetId: asset.assetId, ...r });
                if (typeof r.savings === 'number') totalSaved += r.savings;
              } catch (err) {
                log.debug({ err }, 'jobs: bulk-compress individual asset failed — skipping');
                results.push({ assetId: asset.assetId, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Compressed ${i + 1}/${assets.length} (${Math.round(totalSaved / 1024)}KB saved)` });
            }
            updateJob(job.id, { status: 'done', result: { results, totalSaved }, progress: assets.length, message: `Done — saved ${Math.round(totalSaved / 1024)}KB total` });
            const compressWsId = params.workspaceId as string;
            if (compressWsId) {
              addActivity(compressWsId, 'images_optimized',
                `Bulk compression: ${assets.length} images processed, ${Math.round(totalSaved / 1024)}KB saved`,
                undefined,
                { processed: assets.length, totalSavedBytes: totalSaved }
              );
            }
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: bulk-compress job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: bulk-compress job failed — degrading gracefully');
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Bulk compress failed' });
          }
        })();
        break;
      }

      case 'bulk-alt': {
        const { assets: altAssets, siteId: altSiteId } = params as { assets: Array<{ assetId: string; imageUrl: string }>; siteId?: string };
        if (!altAssets?.length) return res.status(400).json({ error: 'assets required' });
        const activeBulkAlt = hasActiveJob('bulk-alt', params.workspaceId as string);
        if (activeBulkAlt) return res.status(409).json({ error: 'Bulk alt text generation is already running', jobId: activeBulkAlt.id });
        const job = createJob('bulk-alt', { message: `Generating alt text for ${altAssets.length} images...`, total: altAssets.length, workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', progress: 0 });
            const token = altSiteId ? (getTokenForSite(altSiteId) || undefined) : undefined;
            // Resolve workspace + intelligence ONCE per job (not per asset) — the context doesn't change across assets.
            const jobWsId = params.workspaceId as string | undefined;
            const jobWs = jobWsId ? getWorkspace(jobWsId) : (altSiteId ? listWorkspaces().find(w => w.webflowSiteId === altSiteId) : undefined);
            let jobAltContext = '';
            if (jobWs) {
              const resolvedJobWsId = jobWsId || jobWs.id;
              const jobIntel = await buildWorkspaceIntelligence(resolvedJobWsId, { slices: ['seoContext'] });
              // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
              const bvBlock = jobIntel.seoContext?.effectiveBrandVoiceBlock ?? '';
              const parts: string[] = [];
              if (jobWs.keywordStrategy?.siteKeywords?.length) parts.push(`Site keywords: ${jobWs.keywordStrategy.siteKeywords.slice(0, 5).join(', ')}`);
              if (parts.length > 0) jobAltContext = parts.join('. ');
              if (bvBlock) jobAltContext = jobAltContext ? `${jobAltContext}${bvBlock}` : bvBlock;
            }
            const results: Array<{ assetId: string; altText?: string; updated: boolean; error?: string }> = [];
            for (let i = 0; i < altAssets.length; i++) {
              const asset = altAssets[i];
              try {
                const imgRes = await fetch(asset.imageUrl);
                if (!imgRes.ok) { results.push({ assetId: asset.assetId, updated: false, error: `Download failed: ${imgRes.status}` }); continue; }
                const buffer = Buffer.from(await imgRes.arrayBuffer());
                const imgExt = path.extname(asset.imageUrl).split('?')[0] || '.jpg';
                const tmpPath = `/tmp/bulk_alt_${Date.now()}${imgExt}`;
                fs.writeFileSync(tmpPath, buffer);
                const altTextResult = await generateAltText(tmpPath, jobAltContext || undefined);
                try { fs.unlinkSync(tmpPath); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs: programming error'); /* ignore */ }
                if (altTextResult) {
                  await updateAsset(asset.assetId, { altText: altTextResult }, token);
                  results.push({ assetId: asset.assetId, altText: altTextResult, updated: true });
                } else {
                  results.push({ assetId: asset.assetId, updated: false, error: 'Generation returned null' });
                }
              } catch (err) {
                log.debug({ err }, 'jobs: bulk-alt-text individual asset failed — skipping');
                results.push({ assetId: asset.assetId, updated: false, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Generated ${i + 1}/${altAssets.length} alt texts` });
            }
            updateJob(job.id, { status: 'done', result: results, progress: altAssets.length, message: `Done — ${results.filter(r => r.updated).length}/${altAssets.length} updated` });
            if (jobWsId) {
              addActivity(jobWsId, 'images_optimized',
                `Bulk alt text: ${results.filter(r => r.updated).length} images updated`,
                undefined,
                { updated: results.filter(r => r.updated).length, total: altAssets.length }
              );
            }
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: bulk-alt-text job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: bulk-alt-text job failed — degrading gracefully');
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Bulk alt text failed' });
          }
        })();
        break;
      }

      case 'bulk-seo-fix': {
        // Callers MUST include `publishedPath` on each page for nested Webflow pages —
        // without it, tryResolvePagePath falls back to `/${slug}` which is wrong for
        // nested routes (e.g. `/services/seo` becomes `/seo`). The live bulk-fix route
        // in routes/webflow-seo-apply.ts accepts publishedPath; any frontend caller of this
        // job type must mirror that contract.
        const { siteId: seoSiteId, pages, field, workspaceId: bwsId } = params as { siteId: string; pages: Array<{ pageId: string; title: string; slug?: string; publishedPath?: string | null; currentSeoTitle?: string; currentDescription?: string }>; field: 'title' | 'description'; workspaceId?: string };
        if (!seoSiteId || !pages?.length || !field) return res.status(400).json({ error: 'siteId, pages, field required' });
        const activeBulkSeo = hasActiveJob('bulk-seo-fix', bwsId);
        if (activeBulkSeo) return res.status(409).json({ error: 'A bulk SEO fix is already running', jobId: activeBulkSeo.id });
        const job = createJob('bulk-seo-fix', { message: `Fixing ${field}s for ${pages.length} pages...`, total: pages.length, workspaceId: bwsId });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', progress: 0 });
            const openaiKey = process.env.OPENAI_API_KEY;
            const token = getTokenForSite(seoSiteId) || undefined;
            if (!openaiKey) { updateJob(job.id, { status: 'error', error: 'OPENAI_API_KEY not configured', message: 'Missing API key' }); return; }

            // Resolve base URL for page content fetching
            const bulkWs = bwsId ? getWorkspace(bwsId) : listWorkspaces().find(w => w.webflowSiteId === seoSiteId);
            const bulkBaseUrl = await resolveBaseUrl({ liveDomain: bulkWs?.liveDomain, webflowSiteId: seoSiteId }, token);
            const bulkBrandName = getBrandName(bulkWs);

            const results: Array<{ pageId: string; text: string; applied: boolean; error?: string }> = [];
            for (let i = 0; i < pages.length; i++) {
              const page = pages[i];
              try {
                const bwsSlices = ['seoContext'] as const;
                const bulkJobPagePath = tryResolvePagePath(page);
                const bwsIntel = await buildWorkspaceIntelligence(bwsId || bulkWs?.id || '', { slices: bwsSlices, pagePath: bulkJobPagePath });
                const kwb = formatKeywordsForPrompt(bwsIntel.seoContext);
                // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
                const bvb = bwsIntel.seoContext?.effectiveBrandVoiceBlock ?? '';

                // Fetch page content for context (best-effort)
                let contentExcerpt = '';
                if (bulkBaseUrl && bulkJobPagePath) {
                  try {
                    const htmlRes = await fetch(`${bulkBaseUrl}${bulkJobPagePath}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
                    if (htmlRes.ok) {
                      const html = await htmlRes.text();
                      contentExcerpt = stripHtmlToText(html, { maxLength: 800 });
                    }
                  } catch { /* best-effort — fetch on external URL */ } // url-fetch-ok
                }
                const contentSection = contentExcerpt ? `\nPage content excerpt: ${contentExcerpt}` : '';
                const brandNote = bulkBrandName ? `\nBrand name is "${bulkBrandName}" — use this exact name, never an abbreviated version.` : '';

                const prompt = field === 'description'
                  ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${page.currentDescription || 'none'}".${contentSection}${kwb}${bvb}${brandNote}\n\nRules:\n- 150-160 characters, hard limit 160\n- Include primary keyword naturally\n- Include a call-to-action or value proposition\n- Match the brand voice if provided\nReturn ONLY the text.`
                  : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${page.currentSeoTitle || 'none'}".${contentSection}${kwb}${bvb}${brandNote}\n\nRules:\n- 50-60 characters, hard limit 60\n- Front-load the primary keyword\n- Match the brand voice if provided\nReturn ONLY the text.`;
                const aiResult = await callOpenAI({
                  model: 'gpt-4.1-mini',
                  messages: [{ role: 'user', content: prompt }],
                  maxTokens: 200,
                  temperature: 0.7,
                  feature: 'job-bulk-seo-fix',
                  workspaceId: bwsId,
                });
                let text = aiResult.text;
                text = text.replace(/^["']|["']$/g, '');
                const maxLen = field === 'description' ? 160 : 60;
                if (text.length > maxLen) { const t = text.slice(0, maxLen); const ls = t.lastIndexOf(' '); text = ls > maxLen * 0.6 ? t.slice(0, ls) : t; }
                if (text) {
                  const seoFields = field === 'description' ? { seo: { description: text } } : { seo: { title: text } };
                  const seoResult = await updatePageSeo(page.pageId, seoFields, token);
                  if (!seoResult.success) {
                    results.push({ pageId: page.pageId, text: '', applied: false, error: seoResult.error ?? 'Webflow API error' });
                  } else {
                    if (bwsId) {
                      updatePageState(bwsId, page.pageId, { status: 'live', source: 'bulk-fix', fields: [field], updatedBy: 'system' });
                      recordSeoChange(bwsId, page.pageId, page.slug || '', page.title || '', [field], 'bulk-fix');
                    }
                    results.push({ pageId: page.pageId, text, applied: true });
                  }
                } else {
                  results.push({ pageId: page.pageId, text: '', applied: false, error: 'Empty AI response' });
                }
              } catch (err) {
                log.debug({ err }, 'jobs: bulk-seo-fix individual page failed — skipping');
                results.push({ pageId: page.pageId, text: '', applied: false, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Fixed ${i + 1}/${pages.length} ${field}s` });
            }
            updateJob(job.id, { status: 'done', result: { results, field }, progress: pages.length, message: `Done — ${results.filter(r => r.applied).length}/${pages.length} ${field}s updated` });
            if (bwsId) {
              addActivity(bwsId, 'seo_updated',
                `Bulk ${field} optimization: ${results.filter(r => r.applied).length} pages updated`,
                `AI-generated ${field}s applied to ${results.filter(r => r.applied).length}/${pages.length} pages`,
                { field, pagesUpdated: results.filter(r => r.applied).length, totalPages: pages.length }
              );
            }
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: bulk-seo-fix job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: bulk-seo-fix job failed — degrading gracefully');
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Bulk SEO fix failed' });
          }
        })();
        break;
      }

      case 'sales-report': {
        const { url, maxPages } = params as { url: string; maxPages?: number };
        if (!url) return res.status(400).json({ error: 'url required' });
        const job = createJob('sales-report', { message: `Auditing ${url}...` });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Crawling site...' });
            const result = await runSalesAudit(url, maxPages || 25);
            const reportsDir = getDataDir('sales-reports');
            const reportId = `sr_${Date.now()}`;
            const reportFile = path.join(reportsDir, `${reportId}.json`);
            fs.writeFileSync(reportFile, JSON.stringify({ id: reportId, ...result, createdAt: new Date().toISOString() }));
            updateJob(job.id, { status: 'done', result: { id: reportId, ...result }, message: `Audit complete — score ${result.siteScore}` });
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: sales-report job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: sales-report job failed — degrading gracefully');
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Sales report failed' });
          }
        })();
        break;
      }

      case BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION: {
        const wsId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
        const briefId = typeof params.briefId === 'string' ? params.briefId.trim() : '';
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        if (!briefId) return res.status(400).json({ error: 'briefId required' });
        const activePostJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, wsId);
        if (activePostJob) return res.status(409).json({ error: 'Content post generation is already running for this workspace', jobId: activePostJob.id });
        const ws = getWorkspace(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });
        const brief = getBrief(wsId, briefId);
        if (!brief) return res.status(404).json({ error: 'Brief not found' });

        const started = createContentPostGenerationJob(wsId, brief);
        res.json({ jobId: started.jobId, postId: started.postId, post: started.post });
        runContentPostGenerationJob({
          workspaceId: wsId,
          brief,
          postId: started.postId,
          jobId: started.jobId,
        });
        break;
      }

      case BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION:
      case BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION:
      case BACKGROUND_JOB_TYPES.PERSONA_GENERATION: {
        const wsId = typeof params.workspaceId === 'string' ? params.workspaceId : '';
        try {
          const started = startWorkspaceContextGenerationJob(type, wsId);
          res.json(started);
        } catch (err) {
          const response = workspaceContextJobErrorResponse(err);
          res.status(response.status).json(response.body);
        }
        break;
      }

      case BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY: {
        const wsId = params.workspaceId as string;
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        const activeStrat = hasActiveJob('keyword-strategy', wsId);
        if (activeStrat) return res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace', jobId: activeStrat.id });
        if (hasActiveKeywordStrategyGeneration(wsId)) return res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace' });
        const stratWs = getWorkspace(wsId);
        if (!stratWs) return res.status(404).json({ error: 'Workspace not found' });
        if (!stratWs.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });
        if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
        const job = createJob('keyword-strategy', { message: 'Generating keyword strategy...', workspaceId: wsId });
        const jobWasCancelled = () => getJob(job.id)?.status === 'cancelled';
        // Keep the accepted job pending briefly so immediate duplicate requests
        // see the active job before worker validation failures can mark it terminal.
        setTimeout(() => {
          void (async () => {
            try {
              if (jobWasCancelled()) return;
              updateJob(job.id, { status: 'running', message: 'Fetching pages and analyzing keywords...' });
              const businessContext = (params.businessContext as string) || stratWs.keywordStrategy?.businessContext || '';
              const semrushMode = (params.semrushMode as string) || 'none';
              const competitorDomainsProvided = Array.isArray(params.competitorDomains);
              const competitorDomains = competitorDomainsProvided ? params.competitorDomains as string[] : stratWs.competitorDomains || [];
              const maxPages = params.maxPages != null ? Number(params.maxPages) : undefined;
              const mode = params.mode === 'incremental' ? 'incremental' : 'full';
              const generationResult = await generateKeywordStrategy({
                workspaceId: wsId,
                businessContext,
                semrushMode,
                competitorDomains,
                competitorDomainsProvided,
                maxPages,
                mode,
                onProgress: (evt) => {
                  const pct = Math.round(evt.progress * 100);
                  const label = keywordStrategyStepLabels[evt.step] || evt.step;
                  updateJob(job.id, {
                    message: evt.detail ? `${label}: ${evt.detail}` : label,
                    progress: pct,
                    total: 100,
                  });
                },
              });
              if (jobWasCancelled()) return;
              if (generationResult.upToDate) {
                updateJob(job.id, {
                  status: 'done',
                  result: { upToDate: true, freshPageCount: generationResult.freshPageCount ?? 0 },
                  progress: 100,
                  total: 100,
                  message: 'Strategy already up to date',
                });
                return;
              }
              const stratResult = generationResult.strategy;
              if (!stratResult) throw new Error('Strategy generation completed without a strategy result');
              const pageMap = (stratResult as { pageMap?: unknown[] }).pageMap;
              const pageCount = Array.isArray(pageMap) ? pageMap.length : 0;
              updateJob(job.id, {
                status: 'done',
                result: stratResult,
                progress: 100,
                total: 100,
                message: `Strategy complete — ${pageCount} pages mapped`,
              });
            } catch (err) {
              if (jobWasCancelled()) return;
              if (isProgrammingError(err)) log.warn({ err }, 'jobs: keyword-strategy job failed with programming error');
              else log.debug({ err }, 'jobs: keyword-strategy job failed — degrading gracefully');
              const message = err instanceof KeywordStrategyGenerationError ? err.payload.message || err.payload.error : err instanceof Error ? err.message : String(err);
              updateJob(job.id, { status: 'error', error: message, message: 'Strategy generation failed' });
            }
          })();
        }, 100);
        res.json({ jobId: job.id });
        break;
      }
      case 'schema-generator': {
        const schemaSiteId = params.siteId as string;
        if (!schemaSiteId) return res.status(400).json({ error: 'siteId required' });
        const activeSchema = hasActiveJob('schema-generator', params.workspaceId as string);
        if (activeSchema) return res.status(409).json({ error: 'Schema generation is already running for this workspace', jobId: activeSchema.id });
        const schemaToken = getTokenForSite(schemaSiteId) || undefined;
        if (!schemaToken) return res.status(400).json({ error: 'No Webflow API token configured' });
        const job = createJob('schema-generator', { message: 'Generating schemas...', workspaceId: params.workspaceId as string });
        registerAbort(job.id);
        res.json({ jobId: job.id });
        void runSchemaGenerationJob({
          jobId: job.id,
          siteId: schemaSiteId,
          token: schemaToken,
          workspaceId: (params.workspaceId as string) || '',
        });
        break;
      }

      case 'page-analysis': {
        const paSiteId = params.siteId as string;
        const paWsId = params.workspaceId as string;
        if (!paSiteId || !paWsId) return res.status(400).json({ error: 'siteId and workspaceId required' });
        const activePA = hasActiveJob('page-analysis', paWsId);
        if (activePA) return res.status(409).json({ error: 'Page analysis is already running', jobId: activePA.id });
        const paToken = getTokenForSite(paSiteId) || undefined;
        const paJob = createJob('page-analysis', { message: 'Discovering pages...', workspaceId: paWsId });
        registerAbort(paJob.id);
        res.json({ jobId: paJob.id });
        void runPageAnalysisJob({
          jobId: paJob.id,
          siteId: paSiteId,
          workspaceId: paWsId,
          token: paToken,
          forceRefresh: !!params.forceRefresh,
        });
        break;
      }

      case 'deep-diagnostic': {
        const workspaceId = params.workspaceId as string;
        const insightId = params.insightId as string;
        if (!workspaceId || !insightId) return res.status(400).json({ error: 'workspaceId and insightId required' });

        if (!isFeatureEnabled('deep-diagnostics')) return res.status(403).json({ error: 'Deep diagnostics feature not enabled' });

        const ws = getWorkspace(workspaceId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });

        const activeJob = hasActiveJob('deep-diagnostic', workspaceId);
        if (activeJob) return res.status(409).json({ error: 'A diagnostic is already running for this workspace', jobId: activeJob.id });

        const anomalyInsight = getInsights(workspaceId).find((i: AnalyticsInsight) => i.id === insightId);
        if (!anomalyInsight) return res.status(404).json({ error: 'Anomaly insight not found' });
        if (anomalyInsight.insightType !== 'anomaly_digest') return res.status(400).json({ error: 'Insight must be of type anomaly_digest' });

        const anomalyData = anomalyInsight.data as unknown as AnomalyDigestData;
        // Use anomalyData.affectedPage — anomalyInsight.pageId is the synthetic dedup key, not a real path
        const affectedPages = anomalyData.affectedPage ? [anomalyData.affectedPage] : [];

        const report = createDiagnosticReport(workspaceId, insightId, anomalyData.anomalyType, affectedPages);
        const job = createJob('deep-diagnostic', { message: 'Starting deep diagnostic...', workspaceId });
        res.json({ jobId: job.id, reportId: report.id });

        (async () => {
          try {
            await runDiagnostic({ workspaceId, insightId, reportId: report.id }, job.id);
          } catch (err) {
            log.error({ err }, 'Deep diagnostic failed');
            markDiagnosticFailed(report.id, (err as Error).message);
            updateJob(job.id, { status: 'error', message: 'Deep diagnostic failed' });
          }
        })();
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown job type: ${type}` });
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'jobs: POST /api/jobs: programming error'); // url-fetch-ok
    else log.debug({ err }, 'jobs: POST /api/jobs: degrading gracefully');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
