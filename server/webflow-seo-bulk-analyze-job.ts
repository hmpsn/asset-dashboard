import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { parseJsonFallback } from './db/json-validation.js';
import { isProgrammingError } from './errors.js';
import { stripCodeFences, stripHtmlToText, tryResolvePagePath } from './helpers.js';
import { updateJob, unregisterAbort, isJobCancelled } from './jobs.js';
import { createLogger } from './logger.js';
import { callAI } from './ai.js';
import { getPageKeyword, upsertPageKeyword } from './page-keywords.js';
import { resolvePersistedKeywordMetrics } from './provider-keyword-metrics.js';
import { resolveBaseUrl } from './url-helpers.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
  formatPageMapForPrompt,
  invalidateIntelligenceCache,
} from './workspace-intelligence.js';
import { getTokenForSite, type Workspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import type { SeoBulkAnalyzePage } from './schemas/seo-bulk-jobs.js';

const log = createLogger('webflow-seo-bulk-analyze-job');

interface RunSeoBulkAnalyzeJobOptions {
  jobId: string;
  workspaceId: string;
  pages: SeoBulkAnalyzePage[];
  workspace: Workspace;
  signal: AbortSignal;
}

export async function runSeoBulkAnalyzeJob({
  jobId,
  workspaceId,
  pages,
  workspace,
  signal,
}: RunSeoBulkAnalyzeJobOptions): Promise<void> {
  try {
    updateJob(jobId, { status: 'running', message: 'Building workspace context...' });

    const siteId = workspace.webflowSiteId || '';
    const token = getTokenForSite(siteId) || undefined;

    const slices = ['seoContext', 'learnings'] as const;
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices });
    const fullContext = formatForPrompt(intel, { verbosity: 'detailed', sections: slices });
    const kwMapCtx = formatPageMapForPrompt(intel.seoContext);

    const baseUrl = await resolveBaseUrl({ liveDomain: workspace.liveDomain, webflowSiteId: siteId }, token);

    let done = 0;
    let failed = 0;
    let persisted = 0;

    for (const page of pages) {
      if (isJobCancelled(jobId) || signal.aborted) break;

      try {
        const analyzePagePath = tryResolvePagePath(page);
        let pageContent = '';
        if (baseUrl && analyzePagePath) {
          try {
            const htmlRes = await fetch(`${baseUrl}${analyzePagePath}`, {
              redirect: 'follow',
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HmpsnStudioBot/1.0)' },
              signal: AbortSignal.timeout(10_000),
            });
            if (htmlRes.ok) {
              const html = await htmlRes.text();
              pageContent = stripHtmlToText(html, { maxLength: 3000 });
            }
          } catch { /* best-effort external URL fetch */ } // url-fetch-ok
        }

        const effectiveTitle = page.seoTitle || page.title;
        const effectiveMeta = page.seoDescription || '';

        const prompt = `You are an expert SEO strategist. Analyze this web page and provide a keyword analysis.

Page title: ${page.title}
SEO title: ${effectiveTitle || '(same as page title)'}
Meta description: ${effectiveMeta || '(none)'}
URL slug: ${analyzePagePath ?? '(no path)'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 3000) : 'N/A'}${fullContext}${kwMapCtx}

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

IMPORTANT: Return ONLY valid JSON.`;

        const aiResult = await callAI({
          model: 'gpt-5.4-mini',
          system: 'You are an expert SEO keyword analyst. Return valid JSON only.',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 600,
          temperature: 0.3,
          feature: 'bulk-page-analysis',
          workspaceId,
        });

        const raw = aiResult.text || '{}';
        const cleaned = stripCodeFences(raw);
        const parsed = parseJsonFallback<unknown>(cleaned, undefined);
        if (parsed === undefined) {
          log.debug({ pageId: page.pageId }, 'bulk-analyze: expected error — AI returned invalid JSON, skipping');
          failed++;
          done++;
          updateAnalyzeProgress(jobId, workspaceId, done, failed, pages.length);
          continue;
        }

        const analysis = isJsonObject(parsed) ? parsed : {};

        if (!analyzePagePath) {
          log.debug({ pageId: page.pageId }, 'bulk-analyze: skipping persist — no slug or publishedPath');
        } else {
          const existing = getPageKeyword(workspaceId, analyzePagePath);
          const resolvedPrimaryKeyword = (analysis.primaryKeyword as string) || existing?.primaryKeyword || '';
          const guardedMetrics = resolvePersistedKeywordMetrics(existing, resolvedPrimaryKeyword, null);
          upsertPageKeyword(workspaceId, {
            pagePath: analyzePagePath,
            pageTitle: existing?.pageTitle || page.title,
            primaryKeyword: resolvedPrimaryKeyword,
            secondaryKeywords: (analysis.secondaryKeywords as string[]) || existing?.secondaryKeywords || [],
            searchIntent: (analysis.searchIntent as string) || existing?.searchIntent,
            optimizationIssues: (analysis.optimizationIssues as string[]) || [],
            recommendations: (analysis.recommendations as string[]) || [],
            contentGaps: (analysis.contentGaps as string[]) || [],
            optimizationScore: analysis.optimizationScore as number | undefined,
            analysisGeneratedAt: new Date().toISOString(),
            primaryKeywordPresence: analysis.primaryKeywordPresence as { inTitle: boolean; inMeta: boolean; inContent: boolean; inSlug: boolean } | undefined,
            longTailKeywords: (analysis.longTailKeywords as string[]) || [],
            competitorKeywords: (analysis.competitorKeywords as string[]) || [],
            estimatedDifficulty: analysis.estimatedDifficulty as string | undefined,
            keywordDifficulty: guardedMetrics.keywordDifficulty,
            monthlyVolume: guardedMetrics.monthlyVolume,
            topicCluster: analysis.topicCluster as string | undefined,
            searchIntentConfidence: analysis.searchIntentConfidence as number | undefined,
            ...(existing?.currentPosition != null ? { currentPosition: existing.currentPosition } : {}),
            ...(existing?.impressions != null ? { impressions: existing.impressions } : {}),
          });
          persisted++;
        }

        done++;
      } catch (err) {
        if (isProgrammingError(err)) { // url-fetch-ok - external fetch is already isolated in its own best-effort catch
          log.warn({ err, pageId: page.pageId }, 'webflow-seo/bulk-analyze: unexpected error in page analysis');
        } else {
          log.debug({ err, pageId: page.pageId }, 'webflow-seo/bulk-analyze: page analysis error — degrading gracefully');
        }
        failed++;
        done++;
      }

      updateAnalyzeProgress(jobId, workspaceId, done, failed, pages.length);
    }

    invalidateIntelligenceCache(workspaceId);
    if (persisted > 0) {
      broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, {
        analyzed: done - failed,
        persisted,
        source: 'seo-bulk-analyze',
      });
    }

    if (signal.aborted) {
      updateJob(jobId, {
        status: 'cancelled',
        progress: done,
        message: `Cancelled after ${done} pages`,
        result: { analyzed: done - failed, failed, total: pages.length },
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
        jobId,
        operation: 'bulk-analyze',
        error: 'Cancelled',
      });
      return;
    }

    updateJob(jobId, {
      status: 'done',
      progress: done,
      message: `Analysis complete: ${done - failed}/${pages.length} pages${failed > 0 ? ` (${failed} failed)` : ''}`,
      result: { analyzed: done - failed, failed, total: pages.length },
    });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_COMPLETE, {
      jobId,
      operation: 'bulk-analyze',
      analyzed: done - failed,
      failed,
      total: pages.length,
    });

    addActivity(workspaceId, 'page_analysis',
      `Bulk page analysis: ${done - failed}/${pages.length} pages analyzed`,
      `Background job completed${failed > 0 ? ` — ${failed} failed` : ''}`,
      { analyzed: done - failed, failed, total: pages.length },
    );
  } catch (err) {
    log.error({ err }, 'bulk-analyze: job failed');
    updateJob(jobId, { status: 'error', error: String(err) });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
      jobId,
      operation: 'bulk-analyze',
      error: String(err),
    });
  } finally {
    unregisterAbort(jobId);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function updateAnalyzeProgress(
  jobId: string,
  workspaceId: string,
  done: number,
  failed: number,
  total: number,
): void {
  updateJob(jobId, {
    progress: done,
    message: `Analyzed ${done}/${total} pages${failed > 0 ? ` (${failed} failed)` : ''}...`,
  });
  broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_PROGRESS, {
    jobId,
    operation: 'bulk-analyze',
    done,
    total,
    failed,
  });
}
