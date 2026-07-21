import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { generateSeoMetadataVariations } from './domains/seo-health/seo-copy-generation.js';
import { isProgrammingError } from './errors.js';
import { findPageMapEntryForPage, matchGscUrlToPath, tryResolvePagePath } from './utils/page-address.js';
import { stripHtmlToText } from './utils/text.js';
import { buildPageAssistContext } from './intelligence/page-assist-context-builder.js';
import { updateJob, unregisterAbort, isJobCancelled } from './jobs.js';
import { createLogger } from './logger.js';
import { getQueryPageData } from './search-console.js';
import { saveSuggestion, saveSuggestionPair, type SeoSuggestion } from './seo-suggestions.js';
import { resolveBaseUrl } from './url-helpers.js';
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

    const suggestions: SeoSuggestion[] = [];
    let done = 0;
    let failed = 0;
    const basePageAssist = await buildPageAssistContext(workspaceId, { includePageMap: false });
    const baseSeoContext = basePageAssist.seoContext;

    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      if (isJobCancelled(jobId) || signal.aborted) break;
      const batch = pages.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (page) => {
        if (isJobCancelled(jobId)) return null;

        const rwPagePath = tryResolvePagePath(page);
        const pageKeywords = baseSeoContext && rwPagePath && baseSeoContext.strategy?.pageMap?.length
          ? findPageMapEntryForPage(baseSeoContext.strategy.pageMap, page)
          : undefined;
        const pageAssist = await buildPageAssistContext(workspaceId, {
          pagePath: rwPagePath,
          includePageMap: false,
          baseSeoContext,
          pageKeywords,
        });

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

        let pageQueries: typeof allGscData = [];
        if (allGscData.length > 0 && rwPagePath) {
          pageQueries = allGscData
            .filter(r => matchGscUrlToPath(r.page, rwPagePath))
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 15);
        }

        const siblings = siblingTitles[page.pageId];

        const contextBlocks = [
          pageAssist.blocks.keywordBlock,
          pageAssist.blocks.personasBlock,
          pageAssist.blocks.pageProfileBlock,
        ].filter(Boolean);
        const authorityKeywords = pageKeywords ?? pageAssist.seoContext?.pageKeywords;
        const generationInput = {
          workspaceId,
          field,
          adapterHint: 'background' as const,
          signal,
          evidence: {
            pageTitle: page.title,
            currentSeoTitle: page.currentSeoTitle,
            currentDescription: page.currentDescription,
            pageContent: contentExcerpt,
            searchPerformance: pageQueries,
            siblingMetadata: siblings,
            contextBlocks,
          },
          authority: {
            primaryKeyword: authorityKeywords?.primaryKeyword,
            secondaryKeywords: authorityKeywords?.secondaryKeywords,
            searchIntent: authorityKeywords?.searchIntent,
            brandName: inlineBrandName || undefined,
            // Voice authority must reach the canonical service only through this field.
            brandVoice: pageAssist.seoContext?.effectiveBrandVoiceBlock || undefined,
            approvedEvidence: pageAssist.blocks.knowledgeBlock ? [pageAssist.blocks.knowledgeBlock] : undefined,
          },
        };

        if (isBothMode) {
          const oldTitle = page.currentSeoTitle || '';
          const oldDesc = page.currentDescription || '';
          const generated = await generateSeoMetadataVariations(generationInput);
          if (!generated || !('pairs' in generated)) return null;
          const [titleSugg, descSugg] = saveSuggestionPair({
            workspaceId, siteId, pageId: page.pageId,
            pageTitle: page.title, pageSlug: rwPagePath || page.slug || '',
            title: {
              currentValue: oldTitle,
              variations: generated.pairs.map(pair => pair.title),
            },
            description: {
              currentValue: oldDesc,
              variations: generated.pairs.map(pair => pair.description),
            },
          });
          return [titleSugg, descSugg];
        }

        const oldValue = field === 'title' ? (page.currentSeoTitle || '') : (page.currentDescription || '');
        const generated = await generateSeoMetadataVariations(generationInput);
        if (!generated || !('variations' in generated)) return null;
        const suggestion = saveSuggestion({
          workspaceId, siteId, pageId: page.pageId,
          pageTitle: page.title, pageSlug: rwPagePath || page.slug || '',
          field: field as 'title' | 'description', currentValue: oldValue, variations: generated.variations,
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
    if (generatedPages === 0 && failed > 0) {
      const errorMessage = `Bulk rewrite failed for all ${pages.length} pages`;
      updateJob(jobId, {
        status: 'error',
        progress: done,
        message: errorMessage,
        error: errorMessage,
        result: { suggestions: suggestions.length, generatedPages, failed, total: pages.length, field },
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
        jobId,
        operation: 'bulk-rewrite',
        error: errorMessage,
        failed,
        total: pages.length,
        field,
      });
      return;
    }

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
