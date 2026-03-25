/**
 * public-content routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

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
import { notifyTeamContentRequest } from '../email.js';
import { sanitizeString, validateEnum } from '../helpers.js';
import { getPageKeyword, listPageKeywords } from '../page-keywords.js';
import { getClientActor } from '../middleware.js';
import { getPageTrend, getQueryPageData } from '../search-console.js';
import { getWorkspace } from '../workspaces.js';
import { getTrackedKeywords, addTrackedKeyword, removeTrackedKeyword } from '../rank-tracking.js';
import { handleContentPerformance } from './content-requests.js';

// --- Public SEO Strategy (client dashboard, gated behind seoClientView) ---
router.get('/api/public/seo-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.seoClientView) return res.status(403).json({ error: 'SEO strategy view is not enabled' });
  const strategy = ws.keywordStrategy;
  if (!strategy) return res.json(null);
  // Reassemble pageMap from page_keywords table
  const fullPageMap = listPageKeywords(ws.id);
  // Return client-safe subset (no semrushMode, no internal-only fields)
  res.json({
    siteKeywords: strategy.siteKeywords || [],
    siteKeywordMetrics: strategy.siteKeywordMetrics || undefined,
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
    opportunities: strategy.opportunities || [],
    contentGaps: (strategy.contentGaps || []).map(g => ({
      topic: g.topic,
      targetKeyword: g.targetKeyword,
      intent: g.intent,
      priority: g.priority,
      rationale: g.rationale,
      suggestedPageType: g.suggestedPageType || 'blog',
      volume: g.volume,
      difficulty: g.difficulty,
      impressions: g.impressions,
    })),
    quickWins: (strategy.quickWins || []).map(q => ({
      pagePath: q.pagePath,
      action: q.action,
      estimatedImpact: q.estimatedImpact,
      rationale: q.rationale,
    })),
    keywordGaps: (strategy.keywordGaps || []).slice(0, 20).map(g => ({
      keyword: g.keyword,
      volume: g.volume,
      difficulty: g.difficulty,
    })),
    businessContext: strategy.businessContext || '',
    generatedAt: strategy.generatedAt,
  });
});

// --- Public Content Topic Requests (client picks topics from strategy) ---
router.post('/api/public/content-request/:workspaceId', (req, res) => {
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
  broadcastToWorkspace(req.params.workspaceId, 'content-request:created', { id: request.id, topic });
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
    // Include briefId only when in client_review or later
    briefId: ['client_review', 'approved', 'changes_requested', 'in_progress', 'delivered'].includes(r.status) ? r.briefId : undefined,
  })));
});

// Client submits their own topic request
router.post('/api/public/content-request/:workspaceId/submit', (req, res) => {
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
  broadcastToWorkspace(req.params.workspaceId, 'content-request:created', { id: request.id, topic });
  notifyTeamContentRequest({ workspaceName: ws.name, workspaceId: req.params.workspaceId, topic, targetKeyword, priority: 'medium', rationale: notes || '' });
  res.json(request);
});

// Client declines a recommended topic
router.post('/api/public/content-request/:workspaceId/:id/decline', (req, res) => {
  const reason = sanitizeString(req.body.reason, 1000);
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, {
    status: 'declined', declineReason: reason,
  });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_declined', `${actor?.name || 'Client'} declined topic: "${updated.topic}"`, reason || 'No reason given', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, 'content-request:update', { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client approves a brief
router.post('/api/public/content-request/:workspaceId/:id/approve', (req, res) => {
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, { status: 'approved' });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'brief_approved', `${actor?.name || 'Client'} approved brief for "${updated.topic}"`, '', { requestId: updated.id, briefId: updated.briefId }, actor);
  broadcastToWorkspace(req.params.workspaceId, 'content-request:update', { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client requests changes on a brief
router.post('/api/public/content-request/:workspaceId/:id/request-changes', (req, res) => {
  const feedback = sanitizeString(req.body.feedback, 2000);
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, {
    status: 'changes_requested', clientFeedback: feedback,
  });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'changes_requested', `${actor?.name || 'Client'} requested changes on "${updated.topic}"`, feedback || '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, 'content-request:update', { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client upgrades from brief_only to full_post
router.post('/api/public/content-request/:workspaceId/:id/upgrade', (req, res) => {
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, {
    serviceType: 'full_post',
    upgradedAt: new Date().toISOString(),
  });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'content_upgraded', `${actor?.name || 'Client'} upgraded "${updated.topic}" to full blog post`, '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, 'content-request:update', { id: updated.id, status: updated.status });
  res.json(updated);
});

// Client or team adds a comment
router.post('/api/public/content-request/:workspaceId/:id/comment', (req, res) => {
  const content = sanitizeString(req.body.content, 2000);
  const author = validateEnum(req.body.author, ['client', 'team'], 'client');
  if (!content) return res.status(400).json({ error: 'content is required' });
  const updated = addComment(req.params.workspaceId, req.params.id, author, content);
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  broadcastToWorkspace(req.params.workspaceId, 'content-request:update', { id: updated.id, status: updated.status });
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
router.post('/api/public/content-request/:workspaceId/from-audit', async (req, res) => {
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
          try { return new URL(r.page).pathname.replace(/\/$/, '') === slug.replace(/\/$/, ''); } catch { return false; }
        })
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 5)
        .map(r => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: r.position }));
    } catch { /* GSC unavailable */ }
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
  broadcastToWorkspace(req.params.workspaceId, 'content-request:created', { id: request.id, topic });
  notifyTeamContentRequest({ workspaceName: ws.name, workspaceId: req.params.workspaceId, topic, targetKeyword, priority: 'high', rationale });

  res.json({ ...request, topKeywords });
});

// --- Public Content Performance (show GSC/GA4 data for published items in client dashboard) ---
router.get('/api/public/content-performance/:workspaceId', async (req, res) => {
  try {
    const data = await handleContentPerformance(req.params.workspaceId);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(err instanceof Error && msg === 'Workspace not found' ? 404 : 500).json({ error: msg });
  }
});

// --- Public Tracked Keywords (client can view/add/remove) ---
router.get('/api/public/tracked-keywords/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json({ keywords: getTrackedKeywords(ws.id) });
});

router.post('/api/public/tracked-keywords/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const keyword = sanitizeString(req.body?.keyword || '').toLowerCase().trim();
  if (!keyword || keyword.length < 2) return res.status(400).json({ error: 'Keyword must be at least 2 characters' });
  if (keyword.length > 120) return res.status(400).json({ error: 'Keyword too long' });
  const keywords = addTrackedKeyword(ws.id, keyword);
  res.json({ keywords });
});

router.delete('/api/public/tracked-keywords/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const keyword = sanitizeString(req.body?.keyword || '').toLowerCase().trim();
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });
  const keywords = removeTrackedKeyword(ws.id, keyword);
  res.json({ keywords });
});

export default router;
