import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { callCreativeAI } from './content-posts-ai.js';
import { isProgrammingError } from './errors.js';
import { findPageMapEntryForPage, normalizePageUrl, tryResolvePagePath } from './utils/page-address.js';
import { stripHtmlToText } from './utils/text.js';
import { buildSeoPromptBlocks } from './intelligence/generation-context-builders.js';
import {
  createJob, updateJob, } from './jobs.js';
import { createLogger } from './logger.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { resolveRecommendationsForPageIds } from './domains/recommendations/resolution-service.js';
import { recordSeoChange } from './seo-change-tracker.js';
import { resolveBaseUrl } from './url-helpers.js';
import {
  updatePageSeo, } from './webflow.js';
import {
  updatePageState, } from './workspaces.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('webflow-bulk-seo-fix-background-job');

export interface BulkSeoFixPageInput {
  pageId: string;
  title: string;
  slug?: string;
  publishedPath?: string | null;
  currentSeoTitle?: string;
  currentDescription?: string;
  pageContent?: string;
}

export interface StartWebflowBulkSeoFixJobParams {
  workspaceId: string;
  siteId: string;
  pages: BulkSeoFixPageInput[];
  field: 'title' | 'description';
  token?: string;
  liveDomain?: string | null;
  brandName?: string;
}

export interface StartedWebflowBulkSeoFixJob {
  jobId: string;
}

export function startWebflowBulkSeoFixJob(
  params: StartWebflowBulkSeoFixJobParams,
): StartedWebflowBulkSeoFixJob {
  const {
    workspaceId,
    siteId,
    pages,
    field,
    token,
    liveDomain,
    brandName,
  } = params;
  const job = createJob(BACKGROUND_JOB_TYPES.BULK_SEO_FIX, {
    message: `Fixing ${field}s for ${pages.length} pages...`,
    total: pages.length,
    workspaceId,
  });

  void (async () => {
    try {
      updateJob(job.id, { status: 'running', progress: 0 });

      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        updateJob(job.id, {
          status: 'error',
          error: 'OPENAI_API_KEY not configured',
          message: 'Missing API key',
        });
        return;
      }

      const bulkBaseUrl = await resolveBaseUrl({ liveDomain, webflowSiteId: siteId }, token);
      const bulkBrandName = brandName || '';
      const intelligence = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
      const seoContext = intelligence.seoContext;
      const results: Array<{ pageId: string; text: string; applied: boolean; error?: string }> = [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        try {
          const pagePath = tryResolvePagePath(page);
          const pageSeo = seoContext ? { ...seoContext } : undefined;
          if (pageSeo?.strategy?.pageMap?.length) {
            const pageKeywords = findPageMapEntryForPage(pageSeo.strategy.pageMap, page);
            if (pageKeywords) pageSeo.pageKeywords = pageKeywords;
          }
          const seoBlocks = buildSeoPromptBlocks(pageSeo, { includePageMap: false });
          const kwb = seoBlocks.keywordBlock;
          const bvb = seoBlocks.brandVoiceBlock;
          const personasBlock = seoBlocks.personasBlock;
          const knowledgeBlock = seoBlocks.knowledgeBlock;

          let contentExcerpt = page.pageContent || '';
          if (!contentExcerpt && bulkBaseUrl && pagePath) {
            try {
              const htmlRes = await fetch(`${bulkBaseUrl}${pagePath}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
              if (htmlRes.ok) {
                const html = await htmlRes.text();
                contentExcerpt = stripHtmlToText(html, { maxLength: 800 });
              }
            } catch { /* best-effort — fetch on external URL */ } // url-fetch-ok
          }
          const contentSection = contentExcerpt ? `\nPage content excerpt: ${contentExcerpt}` : '';
          const brandNote = bulkBrandName ? `\nBrand name is "${bulkBrandName}" — use this exact name, never an abbreviated version.` : '';
          const locationRule = `\n- LOCATION RULE: If this page's primary keyword targets a specific city/region, ALWAYS use THAT location.`;
          const extraContext = [personasBlock, knowledgeBlock].filter(Boolean).join('');

          const prompt = field === 'description'
            ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${page.currentDescription || 'none'}".${contentSection}${kwb}${bvb}${extraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 160 characters\n- Use specific details from the knowledge base — mention real services, outcomes, or differentiators\n- Write to the target persona's pain points if personas are provided\n- Include primary keyword naturally${locationRule}\nReturn ONLY the text.`
            : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${page.currentSeoTitle || 'none'}".${contentSection}${kwb}${bvb}${extraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 60 characters\n- Front-load the primary keyword\n- Use specific language from the knowledge base, not generic filler${locationRule}\nReturn ONLY the text.`;
          const aiText = await callCreativeAI({
            systemPrompt: buildSystemPrompt(workspaceId, 'You are an elite SEO copywriter. Return ONLY the requested text — no quotes, no explanation, no markdown.'),
            userPrompt: prompt,
            maxTokens: 150,
            feature: 'job-bulk-seo-fix',
            workspaceId,
          });
          let text = aiText.replace(/^["']|["']$/g, '');
          const maxLen = field === 'description' ? 160 : 60;
          if (text.length > maxLen) {
            const truncated = text.slice(0, maxLen);
            const lastSpace = truncated.lastIndexOf(' ');
            text = lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
          }

          if (!text) {
            results.push({ pageId: page.pageId, text: '', applied: false, error: 'Empty AI response' });
          } else {
            const seoFields = field === 'description' ? { seo: { description: text } } : { seo: { title: text } };
            const seoResult = await updatePageSeo(page.pageId, seoFields, token);
            if (!seoResult.success) {
              results.push({ pageId: page.pageId, text: '', applied: false, error: seoResult.error ?? 'Webflow API error' });
            } else {
              const seoChangePagePath = pagePath || (page.slug ? normalizePageUrl(page.slug) : '');
              updatePageState(workspaceId, page.pageId, {
                status: 'live',
                source: 'bulk-fix',
                fields: [field],
                updatedBy: 'system',
                ...(seoChangePagePath ? { slug: seoChangePagePath } : {}),
              });
              recordSeoChange(workspaceId, page.pageId, seoChangePagePath, page.title || '', [field], 'bulk-fix');
              results.push({ pageId: page.pageId, text, applied: true });
            }
          }
        } catch (err) {
          log.debug({ err }, 'bulk-seo-fix background job individual page failed — skipping');
          results.push({ pageId: page.pageId, text: '', applied: false, error: String(err) });
        }

        updateJob(job.id, {
          progress: i + 1,
          message: `Fixed ${i + 1}/${pages.length} ${field}s`,
        });
      }

      const appliedResults = results.filter((result) => result.applied);
      updateJob(job.id, {
        status: 'done',
        result: { results, field },
        progress: pages.length,
        message: `Done — ${appliedResults.length}/${pages.length} ${field}s updated`,
      });

      const appliedPageIds = appliedResults.map((result) => result.pageId);
      if (appliedPageIds.length > 0) {
        broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
          pageIds: appliedPageIds,
          fields: [field],
          source: 'bulk-fix',
        });
        invalidateIntelligenceCache(workspaceId);
        try {
          resolveRecommendationsForPageIds(workspaceId, appliedPageIds); // rec-refresh-ok
        } catch (err) {
          log.warn({ err, jobId: job.id }, 'Failed to resolve recommendations after bulk-seo-fix');
        }
      }

      addActivity(
        workspaceId,
        'seo_updated',
        `Bulk ${field} optimization: ${appliedResults.length} pages updated`,
        `AI-generated ${field}s applied to ${appliedResults.length}/${pages.length} pages`,
        { field, pagesUpdated: appliedResults.length, totalPages: pages.length, pageIds: appliedPageIds },
      );
    } catch (err) {
      if (isProgrammingError(err)) { // url-fetch-ok
        log.warn({ err }, 'bulk-seo-fix background job failed with programming error');
      } else {
        log.debug({ err }, 'bulk-seo-fix background job failed — degrading gracefully');
      }
      updateJob(job.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        message: 'Bulk SEO fix failed',
      });
    }
  })();

  return { jobId: job.id };
}
