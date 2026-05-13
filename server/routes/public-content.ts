/**
 * public-content routes — extracted from server/index.ts
 */
import { Router } from 'express';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { getBrief } from '../content-brief.js';
import { renderBriefHTML } from '../brief-export-html.js';
import {
  listContentRequests,
  getContentRequest,
  createContentRequest,
  updateContentRequest,
  addComment,
} from '../content-requests.js';
import { notifyTeamContentRequest, notifyTeamChangesRequested } from '../email.js';
import { getPost, updatePostField, snapshotPostVersion, getMostRecentPostVersion } from '../content-posts.js';
import { sanitizeString, validateEnum } from '../helpers.js';
import { sanitizeRichText, sanitizePlainText } from '../html-sanitize.js';
import { countHtmlWords } from '../content-posts-ai.js';
import { getPageKeyword, listPageKeywords } from '../page-keywords.js';
import { listContentGaps } from '../content-gaps.js';
import { listQuickWins } from '../quick-wins.js';
import { listKeywordGaps } from '../keyword-gaps.js';
import { listTopicClusters } from '../topic-clusters.js';
import { listCannibalizationIssues } from '../cannibalization-issues.js';
import { getClientActor, requireClientPortalAuth } from '../middleware.js';
import { getPageTrend, getQueryPageData } from '../search-console.js';
import { getWorkspace } from '../workspaces.js';
import { getTrackedKeywords, addTrackedKeyword, removeTrackedKeyword } from '../rank-tracking.js';
import { handleContentPerformance } from './content-requests.js';
import { isProgrammingError } from '../errors.js';
import { getConfiguredProvider } from '../seo-data-provider.js';
import { createLogger } from '../logger.js';
import { WS_EVENTS } from '../ws-events.js';
import { validate } from '../middleware/validate.js';
import { computeOpportunityScore } from './keyword-strategy.js';
import {
  createContentRequestSchema,
  submitContentRequestSchema,
  declineContentRequestSchema,
  requestChangesSchema,
  approveContentRequestSchema,
  upgradeContentRequestSchema,
  addCommentSchema,
  fromAuditSchema,
  addTrackedKeywordSchema,
  removeTrackedKeywordSchema,
  approvePostSchema,
  requestPostChangesSchema,
  clientPostEditSchema,
} from '../schemas/public-content.js';
import type { ContentTopicRequest, GeneratedPost } from '../../shared/types/content.js';

const log = createLogger('public-content');
const router = Router();
const ACTIVITY_COMMENT_PREVIEW_LENGTH = 200;

router.use('/api/public/:resource/:workspaceId', requireClientPortalAuth('workspaceId'));

function activityCommentPreview(content: string): string {
  return content.length > ACTIVITY_COMMENT_PREVIEW_LENGTH
    ? `${content.slice(0, ACTIVITY_COMMENT_PREVIEW_LENGTH - 3)}...`
    : content;
}

function assertClientReviewRequest(workspaceId: string, requestId: string, res: import('express').Response) {
  const existing = getContentRequest(workspaceId, requestId);
  if (!existing) {
    res.status(404).json({ error: 'Request not found' });
    return null;
  }
  if (existing.status !== 'client_review') {
    res.status(409).json({ error: 'Request is not ready for client review' });
    return null;
  }
  return existing;
}

function assertUpgradeableBriefRequest(workspaceId: string, requestId: string, res: import('express').Response) {
  const existing = getContentRequest(workspaceId, requestId);
  if (!existing) {
    res.status(404).json({ error: 'Request not found' });
    return null;
  }
  if (existing.serviceType !== 'brief_only' || existing.status !== 'approved') {
    res.status(409).json({ error: 'Only approved brief requests can be upgraded to a full post' });
    return null;
  }
  return existing;
}

function findAssociatedPostRequest(
  requests: ContentTopicRequest[],
  post: GeneratedPost,
): ContentTopicRequest | undefined {
  return requests.find(r => r.postId === post.id)
    ?? requests.find(r => !r.postId && r.briefId === post.briefId);
}

// --- Public SEO Strategy (client dashboard) ---
// seoClientView controls tab visibility in the UI; the data is always safe to return
// and is needed unconditionally by Overview insights, InsightsDigest, and AI chat context.
router.get('/api/public/seo-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const strategy = ws.keywordStrategy;
  // Reassemble pageMap from page_keywords table
  const fullPageMap = listPageKeywords(ws.id);
  // Reassemble contentGaps from content_gaps table (post-#365 normalization)
  const contentGapsList = listContentGaps(ws.id);
  const contentGaps = contentGapsList.length > 0 ? contentGapsList : (strategy?.contentGaps || []);
  // Reassemble quickWins from quick_wins table (post-#367 normalization).
  // Fallback to blob data for legacy workspaces that have not been migrated yet.
  const quickWinsList = listQuickWins(ws.id);
  const quickWins = quickWinsList.length > 0 ? quickWinsList : (strategy?.quickWins || []);
  // Reassemble keywordGaps from keyword_gaps table (post-#368 normalization).
  // Fallback to blob data for legacy workspaces that have not been migrated yet.
  const keywordGapsList = listKeywordGaps(ws.id);
  const keywordGaps = keywordGapsList.length > 0 ? keywordGapsList : (strategy?.keywordGaps || []);
  // Reassemble topicClusters and cannibalization from normalized tables.
  // Fallback to blob data for legacy workspaces that have not been migrated yet.
  const topicClustersList = listTopicClusters(ws.id);
  const topicClusters = topicClustersList.length > 0 ? topicClustersList : (strategy?.topicClusters || []);
  const cannibalizationList = listCannibalizationIssues(ws.id);
  const cannibalization = cannibalizationList.length > 0 ? cannibalizationList : (strategy?.cannibalization || []);
  if (
    !strategy
    && fullPageMap.length === 0
    && contentGaps.length === 0
    && quickWins.length === 0
    && keywordGaps.length === 0
    && topicClusters.length === 0
    && cannibalization.length === 0
  ) {
    return res.json(null);
  }
  // Return client-safe subset (no SEO data mode/provider internals)
  res.json({
    siteKeywords: strategy?.siteKeywords || [],
    siteKeywordMetrics: strategy?.siteKeywordMetrics || undefined,
    pageMap: fullPageMap.map(p => ({
      pagePath: p.pagePath,
      pageTitle: p.pageTitle,
      primaryKeyword: p.primaryKeyword,
      secondaryKeywords: p.secondaryKeywords || [],
      searchIntent: p.searchIntent,
      currentPosition: p.currentPosition,
      previousPosition: p.previousPosition,
      impressions: p.impressions,
      clicks: p.clicks,
      volume: p.volume,
      difficulty: p.difficulty,
      metricsSource: p.metricsSource,
      validated: p.validated,
      gscKeywords: p.gscKeywords || [],
    })),
    opportunities: strategy?.opportunities || [],
    contentGaps: contentGaps.map(g => ({
      topic: g.topic,
      targetKeyword: g.targetKeyword,
      intent: g.intent,
      priority: g.priority,
      rationale: g.rationale,
      suggestedPageType: g.suggestedPageType || 'blog',
      volume: g.volume,
      difficulty: g.difficulty,
      impressions: g.impressions,
      trendDirection: g.trendDirection,
      serpFeatures: g.serpFeatures,
      competitorProof: g.competitorProof,
      questionKeywords: g.questionKeywords,
      opportunityScore: g.opportunityScore ?? computeOpportunityScore(g),
    })),
    quickWins: quickWins.map(q => ({
      pagePath: q.pagePath,
      action: q.action,
      estimatedImpact: q.estimatedImpact,
      rationale: q.rationale,
    })),
    keywordGaps: keywordGaps.slice(0, 20).map(g => ({
      keyword: g.keyword,
      volume: g.volume,
      difficulty: g.difficulty,
    })),
    topicClusters: topicClusters.map(c => ({
      topic: c.topic,
      keywords: c.keywords,
      ownedCount: c.ownedCount,
      totalCount: c.totalCount,
      coveragePercent: c.coveragePercent,
      avgPosition: c.avgPosition,
      topCompetitor: c.topCompetitor,
      topCompetitorCoverage: c.topCompetitorCoverage,
      gap: c.gap,
    })),
    cannibalization: cannibalization.map(c => ({
      keyword: c.keyword,
      pages: c.pages.map(page => ({
        path: page.path,
        position: page.position,
        impressions: page.impressions,
        clicks: page.clicks,
        source: page.source,
      })),
      severity: c.severity,
      recommendation: c.recommendation,
      canonicalPath: c.canonicalPath,
      canonicalUrl: c.canonicalUrl,
      action: c.action,
    })),
    businessContext: strategy?.businessContext || '',
    generatedAt: strategy?.generatedAt ?? null,
  });
});

// --- Public Page Keywords (approval card context — NOT gated on seoClientView) ---
// Returns minimal keyword hints used to display targeting info on client approval cards,
// regardless of whether the full strategy tab is enabled for the workspace.
router.get('/api/public/page-keywords/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const entries = listPageKeywords(ws.id);
  res.json(entries.map(p => ({
    pagePath: p.pagePath,
    primaryKeyword: p.primaryKeyword,
    secondaryKeywords: p.secondaryKeywords ?? [],
  })));
});

// --- Public Content Topic Requests (client picks topics from strategy) ---
router.post('/api/public/content-request/:workspaceId', validate(createContentRequestSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const topic = sanitizeString(req.body.topic, 200);
  const targetKeyword = sanitizeString(req.body.targetKeyword, 200);
  const intent = sanitizeString(req.body.intent, 50);
  const priority = validateEnum(req.body.priority, ['low', 'medium', 'high', 'critical'], 'medium');
  const rationale = sanitizeString(req.body.rationale, 1000);
  const clientNote = sanitizeString(req.body.clientNote, 1000);
  const serviceType = validateEnum(req.body.serviceType, ['brief_only', 'full_post'], 'brief_only');
  const pageType = validateEnum(req.body.pageType, ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'], 'blog');
  const initialStatus = req.body.initialStatus === 'pending_payment' ? 'pending_payment' as const : undefined;
  const targetPageId = sanitizeString(req.body.targetPageId, 100);
  const targetPageSlug = sanitizeString(req.body.targetPageSlug, 200);
  if (!topic || !targetKeyword) return res.status(400).json({ error: 'topic and targetKeyword are required' });
  const request = createContentRequest(req.params.workspaceId, { topic, targetKeyword, intent, priority, rationale, clientNote, serviceType, pageType, initialStatus, targetPageId: targetPageId || undefined, targetPageSlug: targetPageSlug || undefined });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_requested', `${actor?.name || 'Client'} requested topic: "${topic}"`, `Keyword: "${targetKeyword}" · Priority: ${priority}`, { requestId: request.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_CREATED, { id: request.id, topic });
  notifyTeamContentRequest({ workspaceName: ws.name, workspaceId: req.params.workspaceId, topic, targetKeyword, priority, rationale: rationale || '' });
  res.json(request);
});

// Client can see their own requests (with comments and brief access for review)
router.get('/api/public/content-requests/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const requests = listContentRequests(req.params.workspaceId);
  res.json(requests.map(r => ({
    id: r.id, topic: r.topic, targetKeyword: r.targetKeyword, intent: r.intent,
    priority: r.priority, status: r.status, source: r.source,
    serviceType: r.serviceType || 'brief_only', pageType: r.pageType || 'blog', upgradedAt: r.upgradedAt,
    comments: r.comments || [], requestedAt: r.requestedAt, updatedAt: r.updatedAt,
    deliveryUrl: ['delivered', 'published'].includes(r.status) ? r.deliveryUrl : undefined,
    deliveryNotes: ['delivered', 'published'].includes(r.status) ? r.deliveryNotes : undefined,
    // Include briefId only when in client_review or later
    briefId: ['client_review', 'approved', 'changes_requested', 'in_progress', 'delivered', 'published'].includes(r.status) ? r.briefId : undefined,
    // Include postId only when post is ready for client review or beyond
    postId: ['post_review', 'delivered', 'published'].includes(r.status) || (r.status === 'changes_requested' && r.serviceType === 'full_post') ? r.postId : undefined,
    clientFeedback: r.clientFeedback,
  })));
});

// Client submits their own topic request
router.post('/api/public/content-request/:workspaceId/submit', validate(submitContentRequestSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const topic = sanitizeString(req.body.topic, 200);
  const targetKeyword = sanitizeString(req.body.targetKeyword, 200);
  const notes = sanitizeString(req.body.notes, 1000);
  const serviceType = validateEnum(req.body.serviceType, ['brief_only', 'full_post'], 'brief_only');
  const pageType = validateEnum(req.body.pageType, ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'], 'blog');
  const initialStatus = req.body.initialStatus === 'pending_payment' ? 'pending_payment' as const : undefined;
  const targetPageId = sanitizeString(req.body.targetPageId, 100);
  const targetPageSlug = sanitizeString(req.body.targetPageSlug, 200);
  if (!topic || !targetKeyword) return res.status(400).json({ error: 'topic and targetKeyword are required' });
  const request = createContentRequest(req.params.workspaceId, {
    topic, targetKeyword, intent: 'informational', priority: 'medium',
    rationale: notes || `Client-submitted topic: ${topic}`,
    clientNote: notes, source: 'client', serviceType, pageType, initialStatus,
    targetPageId: targetPageId || undefined, targetPageSlug: targetPageSlug || undefined,
  });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_requested', `${actor?.name || 'Client'} submitted topic: "${topic}"`, `Keyword: "${targetKeyword}"`, { requestId: request.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_CREATED, { id: request.id, topic });
  notifyTeamContentRequest({ workspaceName: ws.name, workspaceId: req.params.workspaceId, topic, targetKeyword, priority: 'medium', rationale: notes || '' });
  res.json(request);
});

// Client declines a recommended topic
router.post('/api/public/content-request/:workspaceId/:id/decline', validate(declineContentRequestSchema), (req, res, next) => {
  const reason = sanitizeString(req.body.reason, 1000);
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, {
      status: 'declined', declineReason: reason,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_declined', `${actor?.name || 'Client'} declined topic: "${updated.topic}"`, reason || 'No reason given', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client approves a brief
router.post('/api/public/content-request/:workspaceId/:id/approve', validate(approveContentRequestSchema), (req, res, next) => {
  if (!assertClientReviewRequest(req.params.workspaceId, req.params.id, res)) return;
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, { status: 'approved' });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'brief_approved', `${actor?.name || 'Client'} approved brief for "${updated.topic}"`, '', { requestId: updated.id, briefId: updated.briefId }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client requests changes on a brief
router.post('/api/public/content-request/:workspaceId/:id/request-changes', validate(requestChangesSchema), (req, res, next) => {
  if (!assertClientReviewRequest(req.params.workspaceId, req.params.id, res)) return;
  const feedback = sanitizeString(req.body.feedback, 2000);
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, {
      status: 'changes_requested', clientFeedback: feedback,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'changes_requested', `${actor?.name || 'Client'} requested changes on "${updated.topic}"`, feedback || '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  const wsInfo = getWorkspace(req.params.workspaceId);
  notifyTeamChangesRequested({
    workspaceName: wsInfo?.name || req.params.workspaceId,
    workspaceId: req.params.workspaceId,
    topic: updated.topic,
    targetKeyword: updated.targetKeyword,
    feedback: feedback || '',
  });
  res.json(updated);
});

// Client upgrades from brief_only to full_post
router.post('/api/public/content-request/:workspaceId/:id/upgrade', validate(upgradeContentRequestSchema), (req, res, next) => {
  if (!assertUpgradeableBriefRequest(req.params.workspaceId, req.params.id, res)) return;
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, {
      serviceType: 'full_post',
      upgradedAt: new Date().toISOString(),
      status: 'in_progress',
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_upgraded', `${actor?.name || 'Client'} upgraded "${updated.topic}" to full blog post`, '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client or team adds a comment
router.post('/api/public/content-request/:workspaceId/:id/comment', validate(addCommentSchema), (req, res) => {
  const content = sanitizeString(req.body.content, 2000);
  const author = 'client' as const; // public unauthenticated endpoint — always 'client', never trust req.body
  if (!content) return res.status(400).json({ error: 'content is required' });
  const updated = addComment(req.params.workspaceId, req.params.id, author, content);
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_request_commented', `${actor?.name || 'Client'} commented on "${updated.topic}"`, activityCommentPreview(content), { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client can view a brief (for review)
router.get('/api/public/content-brief/:workspaceId/:briefId', (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  // Return client-safe view (exclude internal fields if any)
  res.json(brief);
});

// Client can download a brief as branded HTML
router.get('/api/public/content-brief/:workspaceId/:briefId/export', (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  const html = renderBriefHTML(brief);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="brief-${brief.targetKeyword.replace(/\s+/g, '-')}.html"`);
  res.send(html);
});

router.get('/api/public/content-performance/:workspaceId', async (req, res) => {
  try {
    const data = await handleContentPerformance(req.params.workspaceId);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(err instanceof Error && msg === 'Workspace not found' ? 404 : 500).json({ error: msg });
  }
});

router.get('/api/public/content-performance/:workspaceId/:requestId/trend', async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const request = getContentRequest(req.params.workspaceId, req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.targetPageSlug || !ws.gscPropertyUrl || !ws.webflowSiteId) {
      return res.json({ trend: [] });
    }

    let siteBase = ws.gscPropertyUrl.replace(/\/$/, '');
    if (siteBase.startsWith('sc-domain:')) {
      siteBase = `https://${siteBase.replace('sc-domain:', '')}`;
    }
    const slug = request.targetPageSlug.startsWith('/') ? request.targetPageSlug : `/${request.targetPageSlug}`;
    const pageUrl = `${siteBase}${slug}`;

    const publishDate = request.updatedAt || request.requestedAt;
    const startDate = publishDate.split('T')[0];
    const endDate = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

    const trend = await getPageTrend(ws.webflowSiteId, ws.gscPropertyUrl, pageUrl, 90, { startDate, endDate });
    res.json({ trend });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// --- Pre-populate content request from audit issues ---
router.post('/api/public/content-request/:workspaceId/from-audit', validate(fromAuditSchema), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const pageSlug = sanitizeString(req.body.pageSlug, 200);
  const pageName = sanitizeString(req.body.pageName, 200);
  const issues = Array.isArray(req.body.issues) ? req.body.issues.map((i: string) => sanitizeString(i, 300)).filter(Boolean) : [];
  const wordCount = typeof req.body.wordCount === 'number' ? req.body.wordCount : undefined;

  if (!pageSlug || !pageName) return res.status(400).json({ error: 'pageSlug and pageName are required' });

  // Best-effort: fetch top GSC keywords for this page
  let topKeywords: { query: string; clicks: number; impressions: number; position: number }[] = [];
  if (ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      const qpData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90);
      const slug = pageSlug.startsWith('/') ? pageSlug : `/${pageSlug}`;
      topKeywords = qpData
        .filter(r => {
          try { return new URL(r.page).pathname.replace(/\/$/, '') === slug.replace(/\/$/, ''); } catch (err) { return false; }
        })
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 5)
        .map(r => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: r.position }));
    // url-fetch-ok: GSC lookup is best-effort external data; malformed provider URLs degrade to fallback keywords.
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'public-content: POST /api/public/content-request/:workspaceId/from-audit: programming error'); /* GSC unavailable */ }
  }

  // Also check keyword strategy for this page's target keyword
  let strategyKeyword = '';
  const kwMatch = getPageKeyword(ws.id, pageSlug);
  if (kwMatch?.primaryKeyword) strategyKeyword = kwMatch.primaryKeyword;

  // Build the target keyword: prefer strategy keyword, then top GSC query, then page name
  const targetKeyword = strategyKeyword || (topKeywords.length > 0 ? topKeywords[0].query : pageName.replace(/-/g, ' '));

  // Build rich rationale with context
  const issueList = issues.length > 0 ? `\nIssues found:\n${issues.map((i: string) => `• ${i}`).join('\n')}` : '';
  const kwList = topKeywords.length > 0
    ? `\nTop organic keywords: ${topKeywords.map(k => `"${k.query}" (${k.clicks} clicks, pos ${k.position})`).join(', ')}`
    : '';
  const wcNote = wordCount != null ? `\nCurrent word count: ${wordCount}` : '';
  const rationale = `Auto-generated from site audit for page: ${pageSlug}${wcNote}${issueList}${kwList}`;

  const topic = `Content improvement: ${pageName}`;

  const request = createContentRequest(req.params.workspaceId, {
    topic,
    targetKeyword,
    intent: 'informational',
    priority: 'high',
    rationale,
    clientNote: `This page was flagged in our site audit with content issues that could impact search performance.${wcNote}`,
    source: 'strategy',
    serviceType: 'brief_only',
    pageType: 'blog',
    targetPageSlug: pageSlug,
  });

  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_requested', `Content improvement requested for "${pageName}" (from audit)`, `Keyword: "${targetKeyword}" · ${issues.length} issues identified`, { requestId: request.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_CREATED, { id: request.id, topic });
  notifyTeamContentRequest({ workspaceName: ws.name, workspaceId: req.params.workspaceId, topic, targetKeyword, priority: 'high', rationale });

  res.json({ ...request, topKeywords });
});

// --- Public Tracked Keywords (client can view/add/remove) ---
router.get('/api/public/tracked-keywords/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json({ keywords: getTrackedKeywords(ws.id) });
});

router.post('/api/public/tracked-keywords/:workspaceId', validate(addTrackedKeywordSchema), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const keyword = sanitizeString(req.body?.keyword || '').toLowerCase().trim();
  if (!keyword || keyword.length < 2) return res.status(400).json({ error: 'Keyword must be at least 2 characters' });
  if (keyword.length > 120) return res.status(400).json({ error: 'Keyword too long' });
  const actor = getClientActor(req, ws.id);
  const existingKeywords = getTrackedKeywords(ws.id);
  const alreadyTracked = existingKeywords.some(k => k.query === keyword);
  const keywords = alreadyTracked ? existingKeywords : addTrackedKeyword(ws.id, keyword);
  res.json({ keywords });

  if (!alreadyTracked) {
    addActivity(ws.id, 'client_keyword_tracked', `"${keyword}" added to strategy keywords`, '', {}, actor ?? undefined); // client-visibility-ok: admin-only signal, not surfaced in client activity feed
    broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, { keyword });

    // Fire-and-forget: pre-warm the DataForSEO cache for this keyword so the next
    // strategy GET has volume/difficulty data available immediately.
    // Only enriches when an authenticated actor is present — prevents unauthenticated
    // callers from amplifying SEO provider spend on passwordless workspaces.
    const provider = actor ? getConfiguredProvider(ws.seoDataProvider ?? undefined) : null;
    if (provider) {
      provider.getKeywordMetrics([keyword], ws.id).catch((err: unknown) => {
        // url-fetch-ok: async keyword enrichment is best-effort provider prewarming.
        if (isProgrammingError(err)) log.warn({ err }, 'tracked-keyword enrichment: programming error');
        // Non-critical — enrichment will run again on next strategy generation
      });
    }
  }
});

router.delete('/api/public/tracked-keywords/:workspaceId', validate(removeTrackedKeywordSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const keyword = sanitizeString(req.body?.keyword || '').toLowerCase().trim();
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });
  const existingKeywords = getTrackedKeywords(ws.id);
  const wasTracked = existingKeywords.some(k => k.query === keyword);
  const keywords = wasTracked ? removeTrackedKeyword(ws.id, keyword) : existingKeywords;
  res.json({ keywords });
  if (wasTracked) {
    const actor = getClientActor(req, ws.id);
    addActivity(ws.id, 'client_keyword_removed', `"${keyword}" removed from strategy keywords`, '', {}, actor ?? undefined); // client-visibility-ok: admin-only signal, not surfaced in client activity feed
    broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, { keyword, removed: true });
  }
});

// Client reads a post (only allowed when request is in post_review status)
router.get('/api/public/content-posts/:workspaceId/:postId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // Verify the associated request is in post_review (or delivered for read-only view)
  const requests = listContentRequests(req.params.workspaceId);
  const req_ = findAssociatedPostRequest(requests, post);
  if (!req_ || !['post_review', 'changes_requested', 'delivered', 'published'].includes(req_.status)) {
    return res.status(403).json({ error: 'Post is not available for client review' });
  }

  res.json(post);
});

// Client approves a post — transitions request to 'delivered'
router.post('/api/public/content-request/:workspaceId/:id/approve-post', validate(approvePostSchema), (req, res, next) => {
  // Explicit status guard: the state machine allows in_progress → delivered, so we must
  // enforce post_review here to prevent an unauthenticated caller from bypassing review.
  const existing = getContentRequest(req.params.workspaceId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.status !== 'post_review') {
    return res.status(400).json({ error: 'Request must be in post_review status to approve the post' });
  }
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, { status: 'delivered' });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'post_approved', `${actor?.name || 'Client'} approved post for "${updated.topic}"`, '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client requests changes on a post
router.post('/api/public/content-request/:workspaceId/:id/request-post-changes', validate(requestPostChangesSchema), (req, res, next) => {
  // Explicit status guard: client_review → changes_requested is a valid state machine
  // transition (brief review phase), so we must enforce post_review here to prevent
  // post-changes feedback being applied to a brief-review request.
  const existing = getContentRequest(req.params.workspaceId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.status !== 'post_review') {
    return res.status(400).json({ error: 'Request must be in post_review status to request post changes' });
  }
  const feedback = sanitizeString(req.body.feedback, 2000);
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, {
      status: 'changes_requested', clientFeedback: feedback,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'post_changes_requested', `${actor?.name || 'Client'} requested changes on post for "${updated.topic}"`, feedback || '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  const wsInfo = getWorkspace(req.params.workspaceId);
  notifyTeamChangesRequested({
    workspaceName: wsInfo?.name || req.params.workspaceId,
    workspaceId: req.params.workspaceId,
    topic: updated.topic,
    targetKeyword: updated.targetKeyword,
    feedback: feedback || '',
  });
  res.json(updated);
});

// Client edits post content (sections, title, meta — NOT status or admin fields)
// title/metaDescription are plain text; introduction/conclusion/section.content are
// rich text (TipTap HTML) — both paths are sanitized via the shared allowlist
// rather than stripped, so client formatting (bold, italic, headings, links) survives.
router.patch('/api/public/content-posts/:workspaceId/:postId/client-edit', validate(clientPostEditSchema), (req, res, next) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // Only allow edits when request is in post_review
  const requests = listContentRequests(req.params.workspaceId);
  const associatedReq = findAssociatedPostRequest(requests, post);
  if (!associatedReq || associatedReq.status !== 'post_review') {
    return res.status(403).json({ error: 'Post is not open for editing' });
  }

  // Coalesce rapid client edits: if the newest snapshot is already a client_edit
  // from less than 60 s ago, the new edit extends the same editing session —
  // skip creating a fresh snapshot to avoid 20+ versions per rapid-edit session.
  const COALESCE_WINDOW_MS = 60_000;
  const recentVersion = getMostRecentPostVersion(req.params.workspaceId, req.params.postId);
  const shouldSnapshot = !recentVersion
    || recentVersion.trigger !== 'manual_edit'
    || recentVersion.triggerDetail !== 'client_edit'
    || (Date.now() - new Date(recentVersion.createdAt).getTime()) >= COALESCE_WINDOW_MS;

  // Snapshot before client edits so admin can see the diff
  if (shouldSnapshot) {
    snapshotPostVersion(post, 'manual_edit', 'client_edit');
  }

  const { title, metaDescription, introduction, sections, conclusion } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = sanitizePlainText(title);
  if (metaDescription !== undefined) updates.metaDescription = sanitizePlainText(metaDescription);
  if (introduction !== undefined) updates.introduction = sanitizeRichText(introduction);
  if (conclusion !== undefined) updates.conclusion = sanitizeRichText(conclusion);
  if (sections !== undefined) {
    // CRITICAL: merge client edits with existing section data by index.
    // The client only sends { index, heading, content, wordCount } — the editable fields.
    // The DB read schema (postSectionSchema) requires targetWordCount, keywords, and status.
    // If we stored the client-provided sections as-is, parseJsonSafeArray would silently
    // drop every section on the next read, destroying all post content.
    const clientSections = sections as { index: number; heading: string; content: string; wordCount: number }[];
    updates.sections = post.sections.map(existing => {
      const edit = clientSections.find(s => s.index === existing.index);
      if (!edit) return existing; // unedited section — keep as-is
      const sanitizedContent = sanitizeRichText(edit.content);
      return {
        ...existing,                           // preserves: targetWordCount, keywords, status, error
        heading: sanitizePlainText(edit.heading),
        content: sanitizedContent,
        wordCount: countHtmlWords(sanitizedContent),
      };
    });
  }

  // Recompute totalWordCount whenever content fields are updated
  const willChangeContent = sections !== undefined || introduction !== undefined || conclusion !== undefined;
  if (willChangeContent) {
    const finalIntro = updates.introduction !== undefined ? (updates.introduction as string) : post.introduction;
    const finalConclusion = updates.conclusion !== undefined ? (updates.conclusion as string) : post.conclusion;
    const finalSections = (updates.sections as { wordCount: number }[] | undefined) ?? post.sections;
    const introWords = countHtmlWords(finalIntro || '');
    const conclusionWords = countHtmlWords(finalConclusion || '');
    const sectionWords = finalSections.reduce((sum, s) => sum + (s.wordCount || 0), 0);
    updates.totalWordCount = introWords + conclusionWords + sectionWords;
  }

  let updated;
  try {
    updated = updatePostField(req.params.workspaceId, req.params.postId, updates);
  } catch (err) {
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Post not found' });

  const actor = getClientActor(req, req.params.workspaceId);
  if (shouldSnapshot) {
    addActivity(req.params.workspaceId, 'post_client_edit', `${actor?.name || 'Client'} edited post content for "${post.targetKeyword}"`, '', { postId: post.id }, actor);
  }
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: updated.id, status: updated.status });
  res.json(updated);
});

export default router;
