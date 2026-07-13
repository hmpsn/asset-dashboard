/**
 * content-requests routes — extracted from server/index.ts
 *
 * @reads content_requests, content_posts, content_matrices, page_keywords, workspaces, workspace_pages, search_console, google_analytics, content_decay
 * @writes content_requests, content_briefs, content_posts, page_states, activities
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listContentRequests,
  getContentRequest,
  updateContentRequest,
  deleteContentRequest,
} from '../content-requests.js';
import { getContentPerformanceTrend, handleContentPerformance } from '../domains/content/content-performance.js';
import { sendPostToClientForReview, PostNotFoundError } from '../domains/content/send-post-to-client.js';
import { IncompleteContentPostError } from '../domains/content/generation-integrity.js';
import { listPosts } from '../content-posts.js';
import { notifyClientBriefReady, notifyClientContentPublished, notifyClientPostReady } from '../email.js';
import { CONTENT_GENERATION_STYLES } from '../../shared/types/content.js';
import {
  getSiteSubdomain,
  discoverSitemapUrls,
} from '../webflow.js';
import { getWorkspacePages } from '../workspace-data.js';
import { buildClientInboxReviewsUrl, getWorkspace, getTokenForSite } from '../workspaces.js';
import { normalizePageUrl, resolvePagePath } from '../utils/page-address.js';
import { listPageKeywords } from '../page-keywords.js';
import { onContentRequestLive } from '../domains/content/on-content-request-live.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';
import { isProgrammingError } from '../errors.js';
import { hasActiveJob } from '../jobs.js';
import { startContentBriefGenerationJob } from '../content-brief-generation-job.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const log = createLogger('content-requests');
export { handleContentPerformance };

const updateContentRequestSchema = z.object({
  status: z.enum(['pending_payment', 'requested', 'brief_generated', 'client_review', 'approved', 'changes_requested', 'in_progress', 'post_review', 'delivered', 'published', 'declined']).optional(),
  internalNote: z.string().max(5000).optional(),
  deliveryUrl: z.string().url().optional().or(z.literal('')),
  deliveryNotes: z.string().max(5000).optional(),
  briefId: z.string().optional(),
  serviceType: z.enum(['brief_only', 'full_post']).optional(),
  upgradedAt: z.string().datetime().optional(),
  clientFeedback: z.string().max(2000).optional().or(z.literal('')),
});

const generateRequestBriefSchema = z.object({
  generationStyle: z.enum(CONTENT_GENERATION_STYLES).optional(),
}).strict();

// Admin Send Convention: a single "Send to client" action + an OPTIONAL inline note (no
// "Send for Review" / "Flag for Client" split). The note is the operator's message to the client.
const sendPostToClientSchema = z.object({
  note: z.string().max(5000).optional(),
}).strict();

// --- Internal Content Request Management ---
router.get('/api/content-requests/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listContentRequests(req.params.workspaceId));
});

router.get('/api/content-requests/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const request = getContentRequest(req.params.workspaceId, req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json(request);
});

router.patch('/api/content-requests/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), validate(updateContentRequestSchema), (req, res, next) => {
  const { status, internalNote, deliveryUrl, deliveryNotes, briefId, serviceType, upgradedAt, clientFeedback } = req.body;
  // Auto-populate postId when sending to post_review.
  // The state machine has already validated the transition by this point.
  let postIdToSet: string | undefined;
  if (status === 'post_review') {
    const existing = getContentRequest(req.params.workspaceId, req.params.id);
    if (existing?.briefId) {
      const post = listPosts(req.params.workspaceId).find(p => p.briefId === existing.briefId);
      postIdToSet = post?.id;
    }
  }
  if (status === 'post_review' && !postIdToSet) {
    return res.status(400).json({
      error: 'No generated post found for this request. Generate a post before sending to client.',
    });
  }
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, {
      status, internalNote, deliveryUrl, deliveryNotes, briefId, serviceType, upgradedAt, clientFeedback,
      ...(postIdToSet ? { postId: postIdToSet } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  // Send email when brief is sent to client review
  if (status === 'client_review') {
    const wsInfo = getWorkspace(req.params.workspaceId);
    if (wsInfo?.clientEmail) {
      const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
      const dashUrl = buildClientInboxReviewsUrl(origin, req.params.workspaceId);
      notifyClientBriefReady({ clientEmail: wsInfo.clientEmail, workspaceName: wsInfo.name, workspaceId: req.params.workspaceId, topic: updated.topic, targetKeyword: updated.targetKeyword, dashboardUrl: dashUrl });
    }
  }
  // Notify client when post is sent for their review
  if (status === 'post_review') {
    const wsInfo = getWorkspace(req.params.workspaceId);
    if (wsInfo?.clientEmail) {
      const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
      const dashUrl = buildClientInboxReviewsUrl(origin, req.params.workspaceId);
      notifyClientPostReady({
        clientEmail: wsInfo.clientEmail,
        workspaceName: wsInfo.name,
        workspaceId: req.params.workspaceId,
        topic: updated.topic,
        targetKeyword: updated.targetKeyword,
        dashboardUrl: dashUrl,
      });
    }
  }
  // When content is delivered/published and has a target page, mark the page live
  // and enqueue the debounced post-update follow-ons (recs regen + llms.txt) —
  // a new/updated live page changes the inventory the recommendation engine ranks
  // on, just like content-publish.ts and the keyword-strategy paths. Shared with
  // the MCP advance_content_status tool via onContentRequestLive so both paths
  // stay in lockstep (no-op when there's no target page; follow-on enqueue is
  // self-guarded so a failure can never abort the request update).
  if (status === 'delivered' || status === 'published') {
    onContentRequestLive(req.params.workspaceId, updated);
  }
  // Notify client when content is published
  if (status === 'published') {
    const wsInfo = getWorkspace(req.params.workspaceId);
    if (wsInfo?.clientEmail) {
      const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
      const dashUrl = buildClientInboxReviewsUrl(origin, req.params.workspaceId);
      notifyClientContentPublished({ clientEmail: wsInfo.clientEmail, workspaceName: wsInfo.name, workspaceId: req.params.workspaceId, topic: updated.topic, targetKeyword: updated.targetKeyword, dashboardUrl: dashUrl });
    }
  }
  // Activity log entry for post_review transition
  if (status === 'post_review') {
    addActivity(req.params.workspaceId, 'post_sent_for_review', `Post sent to client for review: "${updated.topic}"`, '', { requestId: updated.id });
  }
  // Activity log entry for serviceType upgrade (matches public endpoint behavior)
  if (serviceType === 'full_post') {
    addActivity(req.params.workspaceId, 'content_upgraded', `Admin upgraded "${updated.topic}" to full blog post`, '', { requestId: updated.id });
  }
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});

// Delete a content request
router.delete('/api/content-requests/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const existing = getContentRequest(req.params.workspaceId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  const deleted = deleteContentRequest(req.params.workspaceId, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Request not found' });
  addActivity(
    req.params.workspaceId,
    'content_request_deleted',
    `Content request deleted: "${existing.topic}"`,
    existing.targetKeyword ? `Keyword: "${existing.targetKeyword}"` : '',
    { requestId: existing.id },
  );
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: req.params.id, deleted: true });
  res.json({ ok: true });
});

// Send a generated post to the client for review (POST-C1). This is the SEPARATE "Send to client"
// action that creates a client-facing artifact — distinct from ContentManager's internal "Review"
// button (which only bumps GeneratedPost.status). It delegates to the shared
// sendPostToClientForReview service (find-or-create the post's content_request, transition to
// post_review, notify the client, broadcast, log activity), so the post reaches BOTH the legacy
// ContentTab/PostReviewCard surface AND the unified inbox (listClientFacingDeliverables →
// awaiting_client). Lives in the grandfathered content-requests route file, so it does not trip the
// unified-send-to-client-bespoke-route pr-check rule.
router.post(
  '/api/content-requests/:workspaceId/posts/:postId/send-to-client',
  requireWorkspaceAccess('workspaceId'),
  validate(sendPostToClientSchema),
  (req, res, next) => {
    const { workspaceId, postId } = req.params;
    const { note } = req.body as { note?: string };
    try {
      const { request } = sendPostToClientForReview(workspaceId, postId, { note, activitySource: 'admin' });
      res.json(request);
    } catch (err: unknown) {
      if (err instanceof PostNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof IncompleteContentPostError) {
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof Error && err.name === 'InvalidTransitionError') {
        return res.status(400).json({ error: err.message });
      }
      return next(err);
    }
  },
);

// --- Helper: fetch all published site pages for content brief internal linking ---
export async function getAllSitePages(ws: { id: string; webflowSiteId?: string; liveDomain?: string }): Promise<string[]> {
  const pageMap = new Map<string, string>(); // path -> "path — title"

  // 1. Keyword strategy pages from page_keywords table (indexed, have keyword context)
  const kwPages = listPageKeywords(ws.id);
  for (const p of kwPages) {
    const path = normalizePageUrl(p.pagePath);
    const label = p.primaryKeyword ? `${path} — targets: "${p.primaryKeyword}"` : path;
    pageMap.set(path.toLowerCase(), label);
  }

  // 2. Webflow API pages (static pages with titles)
  if (ws.webflowSiteId) {
    try {
      const published = await getWorkspacePages(ws.id, ws.webflowSiteId);
      for (const p of published) {
        const pagePath = resolvePagePath(p);
        const key = pagePath.toLowerCase();
        if (!pageMap.has(key)) {
          const title = p.title || p.slug || 'Home';
          pageMap.set(key, `${pagePath} — "${title}"`);
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'content-requests/getAllSitePages: programming error'); /* Webflow API unavailable */ }
  }

  // 3. Sitemap discovery (CMS pages: blog posts, case studies, etc.)
  if (ws.webflowSiteId) {
    try {
      const token = getTokenForSite(ws.webflowSiteId) || undefined;
      const subdomain = await getSiteSubdomain(ws.webflowSiteId, token);
      const baseUrl = ws.liveDomain
        ? `https://${ws.liveDomain}`
        : subdomain ? `https://${subdomain}.webflow.io` : '';
      if (baseUrl) {
        const sitemapUrls = await discoverSitemapUrls(baseUrl);
        for (const url of sitemapUrls) {
          try {
            const parsed = new URL(url);
            const pagePath = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '');
            const key = pagePath.toLowerCase();
            if (!pageMap.has(key)) {
              // Derive a readable title from the slug
              const slug = pagePath.split('/').pop() || '';
              const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              pageMap.set(key, `${pagePath} — "${title}"`);
            }
          } catch { /* skip malformed URL */ } // catch-ok
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'content-requests: programming error'); /* sitemap unavailable */ } // url-fetch-ok
  }

  return Array.from(pageMap.values());
}

// Generate a brief for a content request
router.post('/api/content-requests/:workspaceId/:id/generate-brief', requireWorkspaceAccess('workspaceId'), validate(generateRequestBriefSchema), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const request = getContentRequest(req.params.workspaceId, req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const { generationStyle } = req.body;

  try {
    {
      const activeBriefJob = hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, req.params.workspaceId);
      if (activeBriefJob) return res.status(409).json({ error: 'Content brief generation is already running for this workspace', jobId: activeBriefJob.id });
      const started = startContentBriefGenerationJob({
        source: 'request',
        workspaceId: req.params.workspaceId,
        requestId: req.params.id,
        generationStyle,
      });
      return res.json(started);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

router.get('/api/content-performance/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const data = await handleContentPerformance(req.params.workspaceId);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(err instanceof Error && msg === 'Workspace not found' ? 404 : 500).json({ error: msg });
  }
});

// Per-post GSC trend (daily clicks/impressions since publish)
router.get('/api/content-performance/:workspaceId/:requestId/trend', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const result = await getContentPerformanceTrend(req.params.workspaceId, req.params.requestId);
    if (!result) return res.status(404).json({ error: 'Published item not found' });
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
