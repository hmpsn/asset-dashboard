/**
 * ai routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { addActivity } from '../activity-log.js';
import {
  addMessage,
  buildConversationContext,
  getSession as getChatSession,
  generateSessionSummary,
} from '../chat-memory.js';
import { applySuppressionsToAudit, getAuditTrafficForWorkspace } from '../helpers.js';
import {
  callOpenAI,
  getTokenUsage,
  getUsageByDay,
  getUsageByFeature,
} from '../openai-helpers.js';
import { getLatestSnapshot } from '../reports.js';
import { getSemrushUsage, getSemrushByDay } from '../semrush.js';
import {
  buildSeoContext,
  buildKeywordMapContext,
  buildKnowledgeBase,
  RICH_BLOCKS_PROMPT,
} from '../seo-context.js';
import { getWorkspace } from '../workspaces.js';
import { checkAIContext } from '../ai-context-check.js';

// ── Admin AI Chat (auth-gated, internal analyst persona) ──
router.post('/api/admin-chat', async (req, res) => {
  const { workspaceId, question, context, sessionId } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(400).json({ error: 'Workspace not found' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  const { keywordBlock, brandVoiceBlock, businessContext: bizCtx } = buildSeoContext(workspaceId);
  const kwMapContext = buildKeywordMapContext(workspaceId);

  try {
    // Build conversation context from memory
    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let priorContext = '';
    if (sessionId) {
      const ctx = buildConversationContext(ws.id, sessionId, 'admin');
      historyMessages = ctx.historyMessages;
      priorContext = ctx.priorContext;
      addMessage(ws.id, sessionId, 'admin', 'user', question);
    }

    const strategySection = (keywordBlock || kwMapContext || bizCtx)
      ? `\n\nKEYWORD STRATEGY CONTEXT:\n${keywordBlock}${kwMapContext}${bizCtx ? `\nBusiness: ${bizCtx}` : ''}${brandVoiceBlock}`
      : '';

    const dataSources = [];
    if (context?.search) dataSources.push('Google Search Console (queries, clicks, impressions, CTR, positions, trend)');
    if (context?.ga4) dataSources.push('Google Analytics 4 (users, sessions, bounce rate, events, conversions, sources, devices)');
    if (context?.comparison) dataSources.push('GA4 Period Comparison (current vs previous period deltas)');
    if (context?.organic) dataSources.push('GA4 Organic Overview (organic users, engagement, bounce, share of total)');
    if (context?.newVsReturning) dataSources.push('New vs Returning Users (segment breakdown, engagement rates)');
    if (context?.landingPages) dataSources.push('Landing Pages (sessions, bounce, conversions by entry page)');
    if (context?.conversions) dataSources.push('Key Events/Conversions (event counts, user counts, rates)');
    if (context?.siteHealth) dataSources.push('Site Health Audit (score, errors, warnings, page issues)');
    if (context?.rankings) dataSources.push('Rank Tracking (keyword positions, changes over time)');
    if (context?.detectedAnomalies && Array.isArray(context.detectedAnomalies) && context.detectedAnomalies.length > 0) dataSources.push('Detected Anomalies (AI-flagged significant changes in traffic, conversions, or site health)');

    // Audit traffic intelligence: cross-reference audit errors with real traffic
    let auditTrafficSection = '';
    if (context?.siteHealth && ws.webflowSiteId) {
      try {
        const trafficMap = await getAuditTrafficForWorkspace(ws);
        const latestAudit = getLatestSnapshot(ws.webflowSiteId);
        if (latestAudit && Object.keys(trafficMap).length > 0) {
          // Apply suppressions so chat doesn't recommend fixing suppressed issues
          const filteredAudit = applySuppressionsToAudit(latestAudit.audit, ws.auditSuppressions || []);
          const pagesWithTraffic = filteredAudit.pages
            .filter(p => p.issues.length > 0)
            .map(p => {
              const slug = p.slug.startsWith('/') ? p.slug : `/${p.slug}`;
              const traffic = trafficMap[slug] || trafficMap[p.slug];
              return { page: p.page, slug, issues: p.issues.length, score: p.score, traffic };
            })
            .filter(p => p.traffic && (p.traffic.clicks > 0 || p.traffic.pageviews > 0))
            .sort((a, b) => ((b.traffic?.clicks || 0) + (b.traffic?.pageviews || 0)) - ((a.traffic?.clicks || 0) + (a.traffic?.pageviews || 0)))
            .slice(0, 8);
          if (pagesWithTraffic.length > 0) {
            dataSources.push('Audit Traffic Intelligence (high-traffic pages with SEO errors)');
            auditTrafficSection = '\n\nHIGH-TRAFFIC PAGES WITH SEO ISSUES (prioritize these — they get real visitors):\n' +
              pagesWithTraffic.map(p => `• ${p.slug} — ${p.issues} issues, score ${p.score} | ${p.traffic!.clicks} clicks, ${p.traffic!.pageviews} pageviews`).join('\n');
          }
        }
      } catch { /* non-critical, skip */ }
    }

    const systemPrompt = `You are an expert internal analytics analyst for **${ws.webflowSiteName || ws.name}**. You're embedded in the admin dashboard of hmpsn studio's platform. The user is a team member managing this client's website — give them unfiltered, technical, data-driven analysis.

AVAILABLE DATA:
${dataSources.map(d => `• ${d}`).join('\n')}
${strategySection}
${auditTrafficSection}
${priorContext}

YOUR ROLE:
1. **Deep technical analysis** — Cross-reference data sources to surface non-obvious insights. A page ranking #8 with high impressions + high bounce + no conversion tracking tells a multi-layered story.
2. **Actionable recommendations** — Be specific: "Rewrite the meta description for /services to include 'free consultation' — it has 2.4K impressions at 1.2% CTR" not "improve your CTR."
3. **Prioritize by ROI** — Time is limited. Lead with changes that have the biggest impact relative to effort.
4. **Flag risks** — Dropping rankings, rising bounce rates, audit score declining, stale content — surface these proactively.
5. **Client communication suggestions** — When you spot something the client should know about, suggest how to frame it: "You could tell the client: 'Your contact form submissions are up 40% — the landing page updates are paying off.'"
6. **Remember context** — Use conversation history for coherent multi-turn analysis. Build on prior discussion points.

TONE:
- Direct, technical, no fluff — you're talking to a peer, not a client
- Use markdown: tables for comparisons, bold for emphasis, code blocks for URLs/paths
- Numbers first, narrative second
- 200-400 words unless the question demands more
${RICH_BLOCKS_PROMPT}
Site: ${ws.webflowSiteName || ws.name}
Date range: last ${context?.days || 28} days
${buildKnowledgeBase(workspaceId)}
Full data context:
${JSON.stringify(context, null, 2)}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.slice(-10),
      { role: 'user', content: question },
    ];

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages,
      temperature: 0.6,
      maxTokens: 2000,
      feature: 'admin-chat',
      workspaceId: ws.id,
    });

    const answer = aiResult.text || 'No response generated.';

    // Persist assistant response + auto-summarize
    if (sessionId) {
      addMessage(ws.id, sessionId, 'admin', 'assistant', answer);
      const session = getChatSession(ws.id, sessionId);
      // Log first admin chat exchange to activity
      if (session && session.messages.length === 2) {
        addActivity(ws.id, 'chat_session', 'Admin chat: ' + question.trim().slice(0, 80), `Admin started a new Insights conversation`);
      }
      if (session && session.messages.length >= 6 && !session.summary) {
        generateSessionSummary(ws.id, sessionId).catch(() => {});
      }
    }

    res.json({ answer, sessionId: sessionId || undefined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- AI Context Completeness ---
router.get('/api/ai/context/:workspaceId', (req, res) => {
  res.json(checkAIContext(req.params.workspaceId));
});

// --- AI Token Usage Tracking ---
router.get('/api/ai/usage', (req, res) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  const since = req.query.since as string | undefined;
  const days = parseInt(req.query.days as string || '30', 10);
  const summary = getTokenUsage(workspaceId, since);
  const daily = getUsageByDay(workspaceId, days);
  const byFeature = getUsageByFeature(workspaceId, since);
  const semrush = getSemrushUsage(workspaceId, since);
  const semrushDaily = getSemrushByDay(workspaceId, days);
  res.json({ ...summary, daily, byFeature, semrush, semrushDaily });
});

export default router;
