/**
 * jobs routes — extracted from server/index.ts
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
import { applySuppressionsToAudit, applyBulkKeywordGuards, buildSchemaContext, resolvePagePath, stripHtmlToText, stripCodeFences } from '../helpers.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { getCachedArchitecture } from '../site-architecture.js';
import {
  createJob,
  updateJob,
  getJob,
  listJobs,
  cancelJob,
  clearCompletedJobs,
  registerAbort,
  isJobCancelled,
  hasActiveJob,
} from '../jobs.js';
import { APP_PASSWORD } from '../middleware.js';
import { callOpenAI } from '../openai-helpers.js';
import { generateRecommendations, loadRecommendations } from '../recommendations.js';
import { saveSnapshot, getLatestSnapshotBefore } from '../reports.js';
import { runSalesAudit } from '../sales-audit.js';
import { saveSchemaSnapshot } from '../schema-store.js';
import { generateSchemaSuggestions } from '../schema-suggester.js';
import { runSeoAudit } from '../seo-audit.js';
import { clearSeoContextCache } from '../seo-context.js';
import {
  updateAsset,
  deleteAsset,
  updatePageSeo,
  uploadAsset,
  getSiteSubdomain,
  discoverCmsUrls,
  buildStaticPathSet,
} from '../webflow.js';
import { getWorkspacePages } from '../workspace-data.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  getClientPortalUrl,
  updatePageState,
  getBrandName,
} from '../workspaces.js';
import { getPageKeyword, upsertPageKeywordsBatch, clearAnalysisFields, countPageKeywords, countAnalyzedPages } from '../page-keywords.js';
// SEMRush imports removed — bulk analysis skips SEMRush to conserve API credits.
// Individual page analysis (frontend) still uses SEMRush via the keyword-analysis endpoint.
import { createLogger } from '../logger.js';
import { debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { getInsights } from '../analytics-insights-store.js';
import { createDiagnosticReport, markDiagnosticFailed } from '../diagnostic-store.js';
import { runDiagnostic } from '../diagnostic-orchestrator.js';
import type { AnalyticsInsight, AnomalyDigestData } from '../../shared/types/analytics.js';
import { buildWorkspaceIntelligence, invalidateIntelligenceCache, formatKeywordsForPrompt, formatPageMapForPrompt, formatForPrompt } from '../workspace-intelligence.js';
import type { default as SharpConstructor } from 'sharp';
import type * as SvgoMod from 'svgo';
import { isProgrammingError } from '../errors.js';

const log = createLogger('jobs');

const PORT = parseInt(process.env.PORT || '3001', 10);

// --- Background Job Endpoints ---
router.get('/api/jobs', (_req, res) => {
  const wsId = _req.query.workspaceId as string | undefined;
  res.json(listJobs(wsId));
});

router.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.delete('/api/jobs/completed', (_req, res) => {
  const count = clearCompletedJobs();
  res.json({ cleared: count });
});

router.delete('/api/jobs/:id', (req, res) => {
  const job = cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/api/jobs', async (req, res) => {
  const { type, params } = req.body as { type: string; params: Record<string, unknown> };
  if (!type) return res.status(400).json({ error: 'type required' });

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
                const compressRes = await fetch(`http://localhost:${PORT}/api/webflow/compress/${asset.assetId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(APP_PASSWORD ? { 'x-auth-token': APP_PASSWORD } : {}) },
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
        const { siteId: seoSiteId, pages, field, workspaceId: bwsId } = params as { siteId: string; pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string }>; field: 'title' | 'description'; workspaceId?: string };
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
                const bwsIntel = await buildWorkspaceIntelligence(bwsId || bulkWs?.id || '', { slices: bwsSlices, pagePath: page.slug ? resolvePagePath(page) : undefined });
                const kwb = formatKeywordsForPrompt(bwsIntel.seoContext);
                // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
                const bvb = bwsIntel.seoContext?.effectiveBrandVoiceBlock ?? '';

                // Fetch page content for context (best-effort)
                let contentExcerpt = '';
                if (bulkBaseUrl && page.slug) {
                  try {
                    const bulkHtmlPath = resolvePagePath(page);
                    const htmlRes = await fetch(`${bulkBaseUrl}${bulkHtmlPath}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
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

      case 'keyword-strategy': {
        const wsId = params.workspaceId as string;
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        const activeStrat = hasActiveJob('keyword-strategy', wsId);
        if (activeStrat) return res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace', jobId: activeStrat.id });
        const stratWs = getWorkspace(wsId);
        if (!stratWs) return res.status(404).json({ error: 'Workspace not found' });
        if (!stratWs.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });
        if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
        const job = createJob('keyword-strategy', { message: 'Generating keyword strategy...', workspaceId: wsId });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Fetching pages and analyzing keywords...' });
            // Call the existing strategy endpoint internally
            const stratUrl = `http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`;
            const businessContext = (params.businessContext as string) || stratWs.keywordStrategy?.businessContext || '';
            const semrushMode = (params.semrushMode as string) || 'none';
            const competitorDomains = (params.competitorDomains as string[]) || stratWs.competitorDomains || [];
            const maxPages = params.maxPages != null ? Number(params.maxPages) : undefined;
            const mode = (params.mode as string) || 'full';
            const stratRes = await fetch(stratUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(APP_PASSWORD ? { 'x-auth-token': APP_PASSWORD } : {}) },
              body: JSON.stringify({ businessContext, semrushMode, competitorDomains, maxPages, mode }),
            });
            if (!stratRes.ok) {
              const errText = await stratRes.text();
              throw new Error(`Strategy generation failed: ${errText.slice(0, 200)}`);
            }
            const stratResult = await stratRes.json();
            const pageCount = (stratResult as Record<string, unknown[]>).pageMap?.length || 0;
            updateJob(job.id, {
              status: 'done',
              result: stratResult,
              message: `Strategy complete — ${pageCount} pages mapped`,
            });
            addActivity(wsId, 'strategy_generated', 'Keyword strategy generated', `${pageCount} pages mapped with keywords and search intent`);
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: keyword-strategy job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: keyword-strategy job failed — degrading gracefully');
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Strategy generation failed' });
          }
        })();
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
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Scanning pages and generating unified schemas...' });
            const { ctx, pageKeywordMap, gscMap, ga4Map, queryPageData, insightsMap } = await buildSchemaContext(schemaSiteId, { includeAnalytics: true });
            const schemaWsId = (params.workspaceId as string) || '';
            // Enrich with architecture tree for deterministic breadcrumbs
            if (ctx.workspaceId) {
              try {
                const arch = await getCachedArchitecture(ctx.workspaceId);
                ctx._architectureTree = arch.tree;
              } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs/schemaWsId: programming error'); /* proceed without architecture */ }
            }
            // Debounced incremental save — persist partial results every 10s
            let lastSaveTime = 0;
            const SAVE_INTERVAL = 10_000;
            const result = await generateSchemaSuggestions(schemaSiteId, schemaToken, ctx, pageKeywordMap, (partial, _done, message) => {
              updateJob(job.id, { status: 'running', result: partial, message, progress: partial.length });
              const now = Date.now();
              if (partial.length > 0 && now - lastSaveTime >= SAVE_INTERVAL) {
                lastSaveTime = now;
                saveSchemaSnapshot(schemaSiteId, schemaWsId, partial);
              }
            }, () => isJobCancelled(job.id), gscMap, ga4Map, queryPageData, insightsMap);
            // Final save — always write the complete result
            if (result.length > 0) {
              saveSchemaSnapshot(schemaSiteId, schemaWsId, result);
            }
            if (isJobCancelled(job.id)) {
              updateJob(job.id, { status: 'cancelled', result, message: `Cancelled — ${result.length} pages completed before stop` });
            } else {
              updateJob(job.id, {
                status: 'done',
                result,
                message: `Done — ${result.length} page schemas generated`,
                progress: result.length,
                total: result.length,
              });
            }
            // Log to activity feed
            if (schemaWsId && result.length > 0) {
              addActivity(schemaWsId, 'schema_generated', `Schema generated for ${result.length} pages`, isJobCancelled(job.id) ? 'Partially completed (cancelled)' : 'All pages processed');
            }
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'jobs: schema-generator job failed with programming error'); // url-fetch-ok
            else log.debug({ err }, 'jobs: schema-generator job failed — degrading gracefully');
            if (!isJobCancelled(job.id)) {
              updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Schema generation failed' });
            }
          }
        })();
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

        (async () => {
          try {
            updateJob(paJob.id, { status: 'running', message: 'Discovering pages...' });

            // 1. Discover all pages (static + CMS)
            const published = await getWorkspacePages(paWsId, paSiteId);
            interface PageItem { id: string; title: string; slug: string; path: string; source: 'static' | 'cms'; seoTitle?: string; metaDesc?: string }
            const pages: PageItem[] = published.map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug || '',
              path: resolvePagePath(p),
              source: 'static' as const,
              seoTitle: p.seo?.title || undefined,
              metaDesc: p.seo?.description || undefined,
            }));

            // Discover CMS pages from sitemap
            const paWs = getWorkspace(paWsId);
            const baseUrl = await resolveBaseUrl({ liveDomain: paWs?.liveDomain, webflowSiteId: paSiteId }, paToken);
            if (baseUrl) {
              try {
                const staticPaths = buildStaticPathSet(published);
                const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 200);
                for (const cms of cmsUrls) {
                  pages.push({
                    id: `cms-${cms.path.replace(/\//g, '-')}`,
                    title: cms.pageName,
                    slug: cms.path.replace(/^\//, ''),
                    path: cms.path,
                    source: 'cms',
                  });
                }
              } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs: programming error'); /* CMS discovery failed — continue with static pages */ }
            }

            // 2. Skip already-analyzed pages (unless forceRefresh)
            const forceRefresh = !!params.forceRefresh;
            let toAnalyze: PageItem[];
            if (forceRefresh) {
              toAnalyze = pages;
              // Clear stale analysis fields from ALL page_keywords rows.
              // Keeps keyword assignments (primaryKeyword, secondaryKeywords, searchIntent, etc.)
              // but resets analysis results so removed pages don't retain stale scores.
              const cleared = clearAnalysisFields(paWsId);
              log.info({ cleared }, 'Page analysis: cleared stale analysis fields for re-analyze');
            } else {
              toAnalyze = pages.filter(p => {
                const existing = getPageKeyword(paWsId, p.path);
                return !existing?.optimizationScore || existing.optimizationScore <= 0;
              });
            }

            const total = toAnalyze.length;
            log.info({ total, skipped: pages.length - total, forceRefresh }, 'Page analysis: starting');
            updateJob(paJob.id, { message: forceRefresh ? `Re-analyzing all ${total} pages...` : `Analyzing ${total} pages (${pages.length - total} already done)...`, total, progress: 0 });

            if (total === 0) {
              updateJob(paJob.id, { status: 'done', message: `All ${pages.length} pages already analyzed`, progress: pages.length, total: pages.length });
              return;
            }

            // 3. Process pages in batches
            const BATCH = 3;
            let done = 0;
            const openaiKey = process.env.OPENAI_API_KEY;
            if (!openaiKey) {
              updateJob(paJob.id, { status: 'error', error: 'OPENAI_API_KEY not configured' });
              return;
            }

            const paSlices = ['seoContext', 'learnings'] as const;
            const paIntel = await buildWorkspaceIntelligence(paWsId, { slices: paSlices });
            const fullContext = formatForPrompt(paIntel, { verbosity: 'detailed', sections: paSlices });
            const kwMapCtx = formatPageMapForPrompt(paIntel.seoContext);

            const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; HmpsnStudioBot/1.0)' };

            // Resolve subdomain ONCE before the loop (was being called per-page — ~256 redundant API calls)
            let webflowSubdomain: string | null = null;
            try { webflowSubdomain = await getSiteSubdomain(paSiteId, paToken); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs: programming error'); /* skip */ }

            for (let i = 0; i < toAnalyze.length; i += BATCH) {
              if (isJobCancelled(paJob.id)) break;
              const batch = toAnalyze.slice(i, i + BATCH);

              // Collect results from parallel batch — persist AFTER Promise.all to avoid race condition
              const batchResults: Array<{ page: typeof batch[0]; analysis: Record<string, unknown> }> = [];

              await Promise.all(batch.map(async (page) => {
                if (isJobCancelled(paJob.id)) return;
                try {
                  // Fetch HTML from live domain
                  let html = '';
                  const urls: string[] = [];
                  if (baseUrl) urls.push(`${baseUrl.replace(/\/+$/, '')}${page.path}`);
                  if (webflowSubdomain) urls.push(`https://${webflowSubdomain}.webflow.io${page.path}`);
                  for (const url of urls) {
                    try {
                      const r = await fetch(url, { redirect: 'follow', headers: FETCH_HEADERS, signal: AbortSignal.timeout(10_000) });
                      if (r.ok) { html = await r.text(); break; }
                    } catch { /* try next */ }
                  }

                  // Extract title, meta desc, body text
                  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                  const htmlTitle = titleMatch ? titleMatch[1].trim() : undefined;
                  const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
                    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
                  const htmlMeta = metaMatch ? metaMatch[1].trim() : undefined;

                  const pageContent = stripHtmlToText(html, { maxLength: 8000 });

                  const effectiveTitle = page.seoTitle || htmlTitle || page.title;
                  const effectiveMeta = page.metaDesc || htmlMeta;

                  // SEMRush enrichment — SKIPPED during bulk analysis to conserve API credits.
                  // SEMRush data is fetched only for individual page analysis (frontend analyzePage).
                  const semrushBlock = '';

                  // Call OpenAI for keyword analysis
                  const prompt = `You are an expert SEO strategist. Analyze this web page and provide a keyword analysis.

Page title: ${page.title}
SEO title: ${effectiveTitle || '(same as page title)'}
Meta description: ${effectiveMeta || '(none)'}
URL slug: /${page.slug || ''}
Page content excerpt: ${pageContent ? pageContent.slice(0, 3000) : 'N/A'}${fullContext}${kwMapCtx}${semrushBlock}

Provide your analysis as a JSON object:
{
  "primaryKeyword": "the single best target keyword",
  "primaryKeywordPresence": { "inTitle": true/false, "inMeta": true/false, "inContent": true/false, "inSlug": true/false },
  "secondaryKeywords": ["kw1", "kw2", "kw3", "kw4", "kw5"],
  "longTailKeywords": ["phrase1", "phrase2", "phrase3"],
  "searchIntent": "informational | transactional | navigational | commercial",
  "searchIntentConfidence": 0.0-1.0,
  "contentGaps": ["gap1"],
  "competitorKeywords": ["comp kw1", "comp kw2"],
  "optimizationScore": 0-100,
  "optimizationIssues": ["issue1"],
  "recommendations": ["rec1", "rec2"],
  "estimatedDifficulty": "low | medium | high",
  "keywordDifficulty": 0-100,
  "monthlyVolume": 0,
  "topicCluster": "broader topic cluster"
}

IMPORTANT: If real SEMRush data is provided, use those EXACT numbers. Return ONLY valid JSON.`;

                  const aiResult = await callOpenAI({
                    model: 'gpt-4.1-mini',
                    messages: [{ role: 'user', content: prompt }],
                    maxTokens: 1000,
                    temperature: 0.4,
                    feature: 'keyword-analysis',
                    workspaceId: paWsId,
                  });

                  const analysis = JSON.parse(stripCodeFences(aiResult.text));
                  applyBulkKeywordGuards(analysis, semrushBlock);
                  batchResults.push({ page, analysis });
                } catch (err) {
                  log.warn({ err, page: page.path }, 'Page analysis failed for individual page');
                }
              }));

              // Persist ALL batch results via page_keywords table (single transaction)
              if (batchResults.length > 0) {
                const now = new Date().toISOString();
                const entries = batchResults.map(({ page, analysis }) => {
                  const normalized = page.path.startsWith('/') ? page.path : `/${page.path}`;
                  // Merge with existing entry if present (preserves keyword assignments)
                  const existing = getPageKeyword(paWsId, normalized);
                  return {
                    pagePath: normalized,
                    pageTitle: page.title,
                    primaryKeyword: (analysis.primaryKeyword as string) || existing?.primaryKeyword || '',
                    secondaryKeywords: (analysis.secondaryKeywords as string[])?.length ? (analysis.secondaryKeywords as string[]) : existing?.secondaryKeywords || [],
                    searchIntent: (analysis.searchIntent as string) || existing?.searchIntent,
                    optimizationIssues: (analysis.optimizationIssues as string[]) || [],
                    recommendations: (analysis.recommendations as string[]) || [],
                    contentGaps: (analysis.contentGaps as string[]) || [],
                    optimizationScore: analysis.optimizationScore as number,
                    analysisGeneratedAt: now,
                    primaryKeywordPresence: analysis.primaryKeywordPresence as { inTitle: boolean; inMeta: boolean; inContent: boolean; inSlug: boolean },
                    longTailKeywords: (analysis.longTailKeywords as string[]) || [],
                    competitorKeywords: (analysis.competitorKeywords as string[]) || [],
                    estimatedDifficulty: analysis.estimatedDifficulty as string,
                    keywordDifficulty: analysis.keywordDifficulty as number,
                    monthlyVolume: analysis.monthlyVolume as number,
                    topicCluster: analysis.topicCluster as string,
                    searchIntentConfidence: analysis.searchIntentConfidence as number,
                    // Preserve enrichment fields from existing entry
                    ...(existing?.currentPosition != null ? { currentPosition: existing.currentPosition } : {}),
                    ...(existing?.impressions != null ? { impressions: existing.impressions } : {}),
                    ...(existing?.clicks != null ? { clicks: existing.clicks } : {}),
                    ...(existing?.gscKeywords ? { gscKeywords: existing.gscKeywords } : {}),
                    ...(existing?.volume != null ? { volume: existing.volume } : {}),
                    ...(existing?.difficulty != null ? { difficulty: existing.difficulty } : {}),
                  };
                });
                upsertPageKeywordsBatch(paWsId, entries);
                log.info({ batchSize: entries.length, totalPages: countPageKeywords(paWsId), withScores: countAnalyzedPages(paWsId) }, 'Page analysis: batch persisted');
              }

              done += batch.length;
              updateJob(paJob.id, { progress: Math.min(done, total), message: `Analyzed ${Math.min(done, total)}/${total} pages...` });

              // Rate limit between batches
              if (i + BATCH < toAnalyze.length) await new Promise(r => setTimeout(r, 1500));
            }

            if (isJobCancelled(paJob.id)) {
              updateJob(paJob.id, { status: 'cancelled', message: `Cancelled — ${done} of ${total} pages analyzed` });
            } else {
              updateJob(paJob.id, { status: 'done', progress: total, total, message: `Done — ${total} pages analyzed` });
            }
            addActivity(paWsId, 'page_analysis', `Bulk page analysis completed — ${done} pages`, `${pages.length} total pages, ${total} analyzed`);
            // Bridge #5: bulk page analysis complete — clear caches
            debouncedPageAnalysisInvalidate(paWsId, () => {
              clearSeoContextCache(paWsId);
              invalidateIntelligenceCache(paWsId);
              invalidateSubCachePrefix(paWsId, 'slice:seoContext');
              invalidateSubCachePrefix(paWsId, 'slice:pageProfile');
            });
          } catch (err) {
            log.error({ err, jobId: paJob.id }, 'Page analysis job failed');
            if (!isJobCancelled(paJob.id)) {
              updateJob(paJob.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Page analysis failed' });
            }
          }
        })();
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
