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
import { applySuppressionsToAudit, buildSchemaContext } from '../helpers.js';
import { getCachedArchitecture } from '../site-architecture.js';
import {
  createJob,
  updateJob,
  getJob,
  listJobs,
  cancelJob,
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
import { buildSeoContext } from '../seo-context.js';
import {
  updateAsset,
  deleteAsset,
  updatePageSeo,
  uploadAsset,
  getSiteSubdomain,
} from '../webflow.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  getClientPortalUrl,
  updatePageState,
  getBrandName,
} from '../workspaces.js';
import { createLogger } from '../logger.js';

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
            const result = await runSeoAudit(siteId, token, params.workspaceId as string);
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
            const sharp = (await import('sharp')).default;
            const response = await fetch(imageUrl);
            const originalBuffer = Buffer.from(await response.arrayBuffer());
            const originalSize = originalBuffer.length;
            const ext = (fileName || imageUrl).split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
            let compressed: Buffer;
            let newFileName: string;
            const baseName = (fileName || 'image').replace(/\.[^.]+$/, '');

            if (ext === 'svg') {
              const svgo = await import('svgo');
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
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }

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
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Compression failed' });
          }
        })();
        break;
      }

      case 'bulk-compress': {
        const { assets, siteId } = params as { assets: Array<{ assetId: string; imageUrl: string; altText?: string; fileName?: string }>; siteId: string };
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
                  body: JSON.stringify({ imageUrl: asset.imageUrl, siteId, altText: asset.altText, fileName: asset.fileName }),
                });
                const r = await compressRes.json() as Record<string, unknown>;
                results.push({ assetId: asset.assetId, ...r });
                if (typeof r.savings === 'number') totalSaved += r.savings;
              } catch (err) {
                results.push({ assetId: asset.assetId, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Compressed ${i + 1}/${assets.length} (${Math.round(totalSaved / 1024)}KB saved)` });
            }
            updateJob(job.id, { status: 'done', result: { results, totalSaved }, progress: assets.length, message: `Done — saved ${Math.round(totalSaved / 1024)}KB total` });
          } catch (err) {
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
                // Build context from workspace keyword strategy
                const jobWsId = params.workspaceId as string | undefined;
                const jobWs = jobWsId ? getWorkspace(jobWsId) : (altSiteId ? listWorkspaces().find(w => w.webflowSiteId === altSiteId) : undefined);
                let jobAltContext = '';
                if (jobWs) {
                  const parts: string[] = [];
                  if (jobWs.brandVoice) parts.push(`Brand voice: ${jobWs.brandVoice}`);
                  if (jobWs.keywordStrategy?.siteKeywords?.length) parts.push(`Site keywords: ${jobWs.keywordStrategy.siteKeywords.slice(0, 5).join(', ')}`);
                  if (parts.length > 0) jobAltContext = parts.join('. ');
                }
                const altTextResult = await generateAltText(tmpPath, jobAltContext || undefined);
                try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
                if (altTextResult) {
                  await updateAsset(asset.assetId, { altText: altTextResult }, token);
                  results.push({ assetId: asset.assetId, altText: altTextResult, updated: true });
                } else {
                  results.push({ assetId: asset.assetId, updated: false, error: 'Generation returned null' });
                }
              } catch (err) {
                results.push({ assetId: asset.assetId, updated: false, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Generated ${i + 1}/${altAssets.length} alt texts` });
            }
            updateJob(job.id, { status: 'done', result: results, progress: altAssets.length, message: `Done — ${results.filter(r => r.updated).length}/${altAssets.length} updated` });
          } catch (err) {
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
            let bulkBaseUrl = '';
            if (bulkWs?.liveDomain) {
              bulkBaseUrl = bulkWs.liveDomain.startsWith('http') ? bulkWs.liveDomain : `https://${bulkWs.liveDomain}`;
            } else {
              try {
                const sub = await getSiteSubdomain(seoSiteId, token);
                if (sub) bulkBaseUrl = `https://${sub}.webflow.io`;
              } catch { /* best-effort */ }
            }
            const bulkBrandName = getBrandName(bulkWs);

            const results: Array<{ pageId: string; text: string; applied: boolean; error?: string }> = [];
            for (let i = 0; i < pages.length; i++) {
              const page = pages[i];
              try {
                const { keywordBlock: kwb, brandVoiceBlock: bvb } = buildSeoContext(bwsId, page.slug ? `/${page.slug}` : undefined);

                // Fetch page content for context (best-effort)
                let contentExcerpt = '';
                if (bulkBaseUrl && page.slug) {
                  try {
                    const htmlRes = await fetch(`${bulkBaseUrl}/${page.slug}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
                    if (htmlRes.ok) {
                      const html = await htmlRes.text();
                      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                      const body = bodyMatch ? bodyMatch[1] : html;
                      contentExcerpt = body
                        .replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[\s\S]*?<\/style>/gi, '')
                        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
                        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 800);
                    }
                  } catch { /* best-effort */ }
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
                  await updatePageSeo(page.pageId, seoFields, token);
                  if (bwsId) {
                    updatePageState(bwsId, page.pageId, { status: 'live', source: 'bulk-fix', fields: [field], updatedBy: 'system' });
                    recordSeoChange(bwsId, page.pageId, page.slug || '', page.title || '', [field], 'bulk-fix');
                  }
                  results.push({ pageId: page.pageId, text, applied: true });
                } else {
                  results.push({ pageId: page.pageId, text: '', applied: false, error: 'Empty AI response' });
                }
              } catch (err) {
                results.push({ pageId: page.pageId, text: '', applied: false, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Fixed ${i + 1}/${pages.length} ${field}s` });
            }
            updateJob(job.id, { status: 'done', result: { results, field }, progress: pages.length, message: `Done — ${results.filter(r => r.applied).length}/${pages.length} ${field}s updated` });
          } catch (err) {
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
            const stratRes = await fetch(stratUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(APP_PASSWORD ? { 'x-auth-token': APP_PASSWORD } : {}) },
              body: JSON.stringify({ businessContext, semrushMode, competitorDomains, maxPages }),
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
            const { ctx, pageKeywordMap } = buildSchemaContext(schemaSiteId);
            const schemaWsId = (params.workspaceId as string) || '';
            // Enrich with architecture tree for deterministic breadcrumbs
            if (ctx.workspaceId) {
              try {
                const arch = await getCachedArchitecture(ctx.workspaceId);
                ctx._architectureTree = arch.tree;
              } catch { /* proceed without architecture */ }
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
            }, () => isJobCancelled(job.id));
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
            if (!isJobCancelled(job.id)) {
              updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Schema generation failed' });
            }
          }
        })();
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown job type: ${type}` });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
