import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { callCreativeAI } from './content-posts-ai.js';
import { parseJsonFallback } from './db/json-validation.js';
import { isProgrammingError } from './errors.js';
import { findPageMapEntryForPage, matchGscUrlToPath, stripCodeFences, stripHtmlToText, tryResolvePagePath } from './helpers.js';
import { updateJob, unregisterAbort, isJobCancelled } from './jobs.js';
import { createLogger } from './logger.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { getQueryPageData } from './search-console.js';
import { saveSuggestion, type SeoSuggestion } from './seo-suggestions.js';
import { resolveBaseUrl } from './url-helpers.js';
import { enforceSeoTextLimit as enforceLimit } from './webflow-seo-rewrite-utils.js';
import {
  buildWorkspaceIntelligence,
  formatKeywordsForPrompt,
  formatKnowledgeBaseForPrompt,
  formatPersonasForPrompt,
} from './workspace-intelligence.js';
import { getBrandName, getTokenForSite, type Workspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import type { SeoBulkRewriteField, SeoBulkRewritePage } from './schemas/seo-bulk-jobs.js';

const log = createLogger('webflow-seo-bulk-rewrite-job');

interface RunSeoBulkRewriteJobOptions {
  jobId: string;
  workspaceId: string;
  siteId: string;
  pages: SeoBulkRewritePage[];
  field: SeoBulkRewriteField;
  workspace: Workspace;
  signal: AbortSignal;
}

export async function runSeoBulkRewriteJob({
  jobId,
  workspaceId,
  siteId,
  pages,
  field,
  workspace,
  signal,
}: RunSeoBulkRewriteJobOptions): Promise<void> {
  try {
    updateJob(jobId, { status: 'running', message: 'Building workspace context...' });

    const token = getTokenForSite(siteId) || undefined;
    const baseUrl = await resolveBaseUrl({ liveDomain: workspace.liveDomain, webflowSiteId: siteId }, token);

    const inlineBrandName = getBrandName(workspace);
    const isBothMode = field === 'both';
    const maxLen = field === 'description' ? 160 : 60;
    const CONCURRENCY = 3;

    let allGscData: Array<{ query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }> = [];
    if (workspace.gscPropertyUrl && workspace.webflowSiteId) {
      try {
        allGscData = await getQueryPageData(workspace.webflowSiteId, workspace.gscPropertyUrl, 28);
      } catch (err) {
        if (isProgrammingError(err)) log.warn({ err }, 'bulk-rewrite: programming error');
      }
    }

    const siblingTitles: Record<string, string[]> = {};
    for (const p of pages) {
      const siblingValues = isBothMode
        ? [p.currentSeoTitle || p.title || '', p.currentDescription || ''].filter(Boolean)
        : [field === 'title' ? (p.currentSeoTitle || p.title || '') : (p.currentDescription || '')].filter(Boolean);
      for (const val of siblingValues) {
        for (const other of pages) {
          if (other.pageId === p.pageId) continue;
          if (!siblingTitles[other.pageId]) siblingTitles[other.pageId] = [];
          if (siblingTitles[other.pageId].length < 8) {
            siblingTitles[other.pageId].push(val);
          }
        }
      }
    }

    const wsIntelRw = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    const wsRwSeo = wsIntelRw.seoContext;

    const suggestions: SeoSuggestion[] = [];
    let done = 0;
    let failed = 0;

    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      if (isJobCancelled(jobId) || signal.aborted) break;
      const batch = pages.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (page) => {
        if (isJobCancelled(jobId)) return null;

        const rwPagePath = tryResolvePagePath(page);
        const rwSeo = wsRwSeo ? { ...wsRwSeo } : undefined;
        if (rwSeo && rwPagePath && rwSeo.strategy?.pageMap?.length) {
          const kw = findPageMapEntryForPage(rwSeo.strategy.pageMap, page);
          if (kw) rwSeo.pageKeywords = kw;
        }
        const keywordBlock = formatKeywordsForPrompt(rwSeo);
        const bvBlock = rwSeo?.effectiveBrandVoiceBlock ?? '';
        const rwPersonasBlock = formatPersonasForPrompt(rwSeo?.personas ?? []);
        const rwKnowledgeBlock = formatKnowledgeBaseForPrompt(rwSeo?.knowledgeBase);

        let contentExcerpt = '';
        if (baseUrl && rwPagePath) {
          try {
            const htmlRes = await fetch(`${baseUrl}${rwPagePath}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
            if (htmlRes.ok) {
              const html = await htmlRes.text();
              contentExcerpt = stripHtmlToText(html, { maxLength: 800 });
            }
          } catch { /* best-effort external URL fetch */ } // url-fetch-ok
        }

        let gscBlock = '';
        let ctrFlag = '';
        if (allGscData.length > 0 && rwPagePath) {
          const pageQueries = allGscData
            .filter(r => matchGscUrlToPath(r.page, rwPagePath))
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 15);
          if (pageQueries.length > 0) {
            gscBlock = `\n\nREAL SEARCH QUERIES:\n${pageQueries.map(q => `- "${q.query}" (${q.impressions} impr, ${q.clicks} clicks, pos ${q.position.toFixed(1)}, CTR ${q.ctr}%)`).join('\n')}`;
            const totalImpr = pageQueries.reduce((sum, q) => sum + q.impressions, 0);
            const totalClicks = pageQueries.reduce((sum, q) => sum + q.clicks, 0);
            const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
            const avgPos = pageQueries.reduce((sum, q) => sum + q.position * q.impressions, 0) / (totalImpr || 1);
            if (totalImpr >= 50) {
              const expectedCtr = avgPos <= 3 ? 8 : avgPos <= 5 ? 5 : avgPos <= 10 ? 2.5 : 1;
              if (avgCtr < expectedCtr * 0.7) {
                ctrFlag = `\n\n⚠️ CTR UNDERPERFORMANCE: ${avgCtr.toFixed(1)}% CTR (expected ~${expectedCtr}% for position ${avgPos.toFixed(0)}).`;
              }
            }
          }
        }

        let siblingBlock = '';
        const siblings = siblingTitles[page.pageId];
        if (siblings && siblings.length > 0) {
          siblingBlock = `\n\nOTHER TITLES ON THIS SITE (differentiate):\n${siblings.map(t => `- "${t}"`).join('\n')}`;
        }

        const contentSection = contentExcerpt ? `\nPage content excerpt: ${contentExcerpt}` : '';
        const brandNote = inlineBrandName ? `\nBrand name is "${inlineBrandName}" — use this exact name.` : '';
        const locationRule = `\n- LOCATION RULE: If this page's keyword targets a city/region, use THAT location.`;
        const rwExtraContext = [rwPersonasBlock, rwKnowledgeBlock, gscBlock, ctrFlag, siblingBlock].filter(Boolean).join('');

        if (isBothMode) {
          const oldTitle = page.currentSeoTitle || '';
          const oldDesc = page.currentDescription || '';
          const prompt = `Write 3 paired SEO title + meta description sets for "${page.title}". Current title: "${oldTitle}". Current description: "${oldDesc}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}\n\nRules:\n- TITLE: 50-60 chars (NEVER exceed 60). Front-load primary keyword.\n- DESCRIPTION: 150-160 chars (NEVER exceed 160).\n- Each pair must take a different angle${locationRule}\n\nReturn ONLY a JSON array of 3 objects with "title" and "description" keys.`;
          const systemPrompt = buildSystemPrompt(workspaceId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 objects with "title" and "description" keys.');
          const aiText = await callCreativeAI({
            systemPrompt,
            userPrompt: prompt,
            maxTokens: 800,
            feature: 'seo-bulk-rewrite-both',
            workspaceId,
            json: false,
          });
          const parsed = parseJsonFallback<Array<{ title?: string; description?: string }> | null>(stripCodeFences(aiText), null);
          const pairs = Array.isArray(parsed)
            ? parsed.map((p) => ({
                title: enforceLimit(String(p.title || ''), 60),
                description: enforceLimit(String(p.description || ''), 160),
              }))
            : [];
          if (!pairs.length) return null;
          while (pairs.length < 3) pairs.push(pairs[0]);
          const titleSugg = saveSuggestion({
            workspaceId, siteId, pageId: page.pageId,
            pageTitle: page.title, pageSlug: rwPagePath || page.slug || '',
            field: 'title', currentValue: oldTitle, variations: pairs.map(p => p.title),
          });
          const descSugg = saveSuggestion({
            workspaceId, siteId, pageId: page.pageId,
            pageTitle: page.title, pageSlug: rwPagePath || page.slug || '',
            field: 'description', currentValue: oldDesc, variations: pairs.map(p => p.description),
          });
          return [titleSugg, descSugg];
        }

        const oldValue = field === 'title' ? (page.currentSeoTitle || '') : (page.currentDescription || '');
        const prompt = field === 'description'
          ? `Write 3 meta descriptions (150-160 chars) for "${page.title}". Current: "${oldValue}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}${locationRule}\nReturn ONLY a JSON array of 3 strings.`
          : `Write 3 SEO titles (50-60 chars) for "${page.title}". Current: "${oldValue}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}${locationRule}\nReturn ONLY a JSON array of 3 strings.`;
        const systemPrompt = buildSystemPrompt(workspaceId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings.');
        const aiText = await callCreativeAI({
          systemPrompt,
          userPrompt: prompt,
          maxTokens: 400,
          feature: 'seo-bulk-rewrite',
          workspaceId,
          json: false,
        });
        const parsed = parseJsonFallback<unknown>(stripCodeFences(aiText), null);
        const variations = Array.isArray(parsed)
          ? parsed.map((v) => enforceLimit(String(v), maxLen)).filter(Boolean)
          : [enforceLimit(String(parsed ?? aiText), maxLen)].filter(Boolean);
        if (!variations.length) return null;
        while (variations.length < 3) variations.push(variations[0]);
        const suggestion = saveSuggestion({
          workspaceId, siteId, pageId: page.pageId,
          pageTitle: page.title, pageSlug: rwPagePath || page.slug || '',
          field: field as 'title' | 'description', currentValue: oldValue, variations,
        });
        return [suggestion];
      }));

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          suggestions.push(...r.value);
        } else if (r.status === 'rejected') {
          failed++;
        } else if (r.status === 'fulfilled' && r.value === null) {
          failed++;
        }
        done++;
        updateJob(jobId, {
          progress: done,
          message: `Generated variations for ${done}/${pages.length} pages${failed > 0 ? ` (${failed} failed)` : ''}...`,
        });
        broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_PROGRESS, {
          jobId,
          operation: 'bulk-rewrite',
          done,
          total: pages.length,
          failed,
          field,
        });
      }
    }

    log.info(`Bulk rewrite job: ${suggestions.length} suggestions, ${failed} errors for ${pages.length} pages`);

    if (signal.aborted) {
      updateJob(jobId, {
        status: 'cancelled',
        progress: done,
        message: `Cancelled after ${done} pages`,
        result: { suggestions: suggestions.length, failed, total: pages.length, field },
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
        jobId,
        operation: 'bulk-rewrite',
        error: 'Cancelled',
      });
      return;
    }

    const generatedPages = done - failed;
    updateJob(jobId, {
      status: 'done',
      progress: done,
      message: `Generated ${suggestions.length} ${field} variations for ${generatedPages}/${pages.length} pages`,
      result: { suggestions: suggestions.length, generatedPages, failed, total: pages.length, field },
    });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_COMPLETE, {
      jobId,
      operation: 'bulk-rewrite',
      generated: suggestions.length,
      generatedPages,
      suggestions: suggestions.length,
      failed,
      total: pages.length,
      field,
    });

    addActivity(
      workspaceId,
      'seo_updated',
      `Bulk SEO rewrite: ${suggestions.length} ${field} variations for ${generatedPages}/${pages.length} pages`,
      `Background job completed${failed > 0 ? ` — ${failed} failed` : ''}`,
      { generated: generatedPages, suggestions: suggestions.length, failed, total: pages.length, field },
    );
  } catch (err) {
    log.error({ err }, 'bulk-rewrite: job failed');
    updateJob(jobId, { status: 'error', error: String(err) });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
      jobId,
      operation: 'bulk-rewrite',
      error: String(err),
    });
  } finally {
    unregisterAbort(jobId);
  }
}
