/**
 * public-analytics routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { addActivity } from '../activity-log.js';
import {
  addMessage,
  buildConversationContext,
  getSession as getChatSession,
  generateSessionSummary,
  checkChatRateLimit,
} from '../chat-memory.js';
import {
  getGA4Overview,
  getGA4DailyTrend,
  getGA4TopPages,
  getGA4TopSources,
  getGA4DeviceBreakdown,
  getGA4Countries,
  getGA4KeyEvents,
  getGA4EventTrend,
  getGA4Conversions,
  getGA4EventsByPage,
  getGA4LandingPages,
  getGA4OrganicOverview,
  getGA4PeriodComparison,
  getGA4NewVsReturning,
} from '../google-analytics.js';
import { parseDateRange, applySuppressionsToAudit, getAuditTrafficForWorkspace } from '../helpers.js';
import { callOpenAI } from '../openai-helpers.js';
import { getLatestSnapshot } from '../reports.js';
import {
  getSearchOverview,
  getPerformanceTrend,
  getSearchDeviceBreakdown,
  getSearchCountryBreakdown,
  getSearchTypeBreakdown,
  getSearchPeriodComparison,
} from '../search-console.js';
import { buildSeoContext, buildKeywordMapContext, RICH_BLOCKS_PROMPT } from '../seo-context.js';
import { listTemplates } from '../content-templates.js';
import { listMatrices } from '../content-matrices.js';
import { incrementUsage } from '../usage-tracking.js';
import { getWorkspace, getBrandName } from '../workspaces.js';

router.get('/api/public/search-overview/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured for this workspace' });
  const days = parseInt(req.query.days as string) || 28;
  const dr = parseDateRange(req.query);
  try {
    const overview = await getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, days, {}, dr);
    res.json(overview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/performance-trend/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const trend = await getPerformanceTrend(ws.webflowSiteId, ws.gscPropertyUrl, days, parseDateRange(req.query));
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/search-devices/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    res.json(await getSearchDeviceBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, days, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/public/search-countries/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured' });
  const days = parseInt(req.query.days as string) || 28;
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    res.json(await getSearchCountryBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, days, limit, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/public/search-types/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    res.json(await getSearchTypeBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, days, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/public/search-comparison/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    res.json(await getSearchPeriodComparison(ws.webflowSiteId, ws.gscPropertyUrl, days, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/api/public/search-chat/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(400).json({ error: 'Workspace not configured' });
  const { question, context, sessionId, betaMode } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  // Rate limit check for free tier (skip in beta mode — no monetization friction)
  const tier = ws.tier || 'free';
  if (!betaMode) {
    const rl = checkChatRateLimit(ws.id, tier, sessionId);
    if (!rl.allowed) {
      return res.status(429).json({
        error: 'Chat limit reached',
        message: `You've used all ${rl.limit} free conversations this month. Upgrade to Growth for unlimited chat.`,
        used: rl.used,
        limit: rl.limit,
      });
    }
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'AI not configured' });

  try {
    // Build conversation context from memory
    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let priorContext = '';
    if (sessionId) {
      const ctx = buildConversationContext(ws.id, sessionId, 'client');
      historyMessages = ctx.historyMessages;
      priorContext = ctx.priorContext;
      // Persist the user message
      addMessage(ws.id, sessionId, 'client', 'user', question);
    }

    const hasSearch = !!(context?.search);
    const hasGA4 = !!(context?.ga4);
    const hasHealth = !!(context?.siteHealth);
    const hasStrategy = !!(context?.seoStrategy);
    const hasRankings = !!(context?.rankings);
    const hasActivity = !!(context?.recentActivity);
    const hasApprovals = !!(context?.pendingApprovals);
    const hasRequests = !!(context?.activeRequests);

    // Audit traffic intelligence for client chat
    let clientAuditTrafficSection = '';
    if (hasHealth && ws.webflowSiteId) {
      try {
        const trafficMap = await getAuditTrafficForWorkspace(ws);
        const latestAudit = getLatestSnapshot(ws.webflowSiteId);
        if (latestAudit && Object.keys(trafficMap).length > 0) {
          // Apply suppressions so client chat doesn't surface suppressed issues
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
            .slice(0, 5);
          if (pagesWithTraffic.length > 0) {
            clientAuditTrafficSection = '\n\nHIGH-TRAFFIC PAGES WITH SEO ISSUES (mention these when discussing site health — they impact real visitors):\n' +
              pagesWithTraffic.map(p => `• ${p.slug} — ${p.issues} issues | ${p.traffic!.clicks} clicks, ${p.traffic!.pageviews} pageviews`).join('\n');
          }
        }
      } catch { /* non-critical */ }
    }

    const teamName = 'hmpsn studio';

    // Pre-compute SEO context blocks for the system prompt
    const seoCtx = buildSeoContext(ws.id);
    const seoContextBlock = seoCtx.fullContext + buildKeywordMapContext(ws.id);

    // Content plan context (templates + matrices) — fetched server-side
    let contentPlanSection = '';
    try {
      const matrices = listMatrices(ws.id);
      const templates = listTemplates(ws.id);
      if (matrices.length > 0 || templates.length > 0) {
        const parts: string[] = [];
        if (matrices.length > 0) {
          const totalCells = matrices.reduce((s, m) => s + m.stats.total, 0);
          const totalPublished = matrices.reduce((s, m) => s + m.stats.published, 0);
          const totalPlanned = matrices.reduce((s, m) => s + m.stats.planned, 0);
          const totalInProgress = totalCells - totalPlanned - totalPublished;
          parts.push(`${matrices.length} content matrices with ${totalCells} planned pages (${totalPublished} published, ${totalInProgress} in progress, ${totalPlanned} planned)`);
          for (const m of matrices.slice(0, 5)) {
            parts.push(`  • "${m.name}" — ${m.stats.total} pages: ${m.stats.published} published, ${m.stats.briefGenerated + m.stats.drafted + m.stats.reviewed} in progress, ${m.stats.planned} planned`);
          }
        }
        if (templates.length > 0) {
          parts.push(`${templates.length} content templates: ${templates.slice(0, 5).map(t => `"${t.name}" (${t.pageType})`).join(', ')}`);
        }
        contentPlanSection = '\n\nCONTENT PLAN:\n' + parts.join('\n');
      }
    } catch { /* non-critical */ }

    // --- Data inventory (shared across modes) ---
    const dataInventory = `DATA YOU HAVE ACCESS TO:
${hasSearch ? '✅ **Google Search Console** — search queries, clicks, impressions, CTR, positions, top pages, search trend over time' : ''}
${context?.searchComparison ? '✅ **Search Period Comparison** — clicks, impressions, CTR, position changes vs previous period with % deltas' : ''}
${hasGA4 ? '✅ **Google Analytics 4** — users, sessions, pageviews, bounce rate, session duration, top pages, traffic sources, devices, events/conversions, countries' : ''}
${context?.ga4Comparison ? '✅ **GA4 Period Comparison** — current vs previous period deltas for users, sessions, pageviews, bounce rate' : ''}
${context?.ga4Organic ? '✅ **Organic Overview** — organic users, sessions, engagement rate, bounce rate, organic share of total traffic' : ''}
${context?.ga4NewVsReturning ? '✅ **New vs Returning Users** — segment breakdown with engagement rates' : ''}
${hasHealth ? '✅ **Site Health Audit** — site score, errors, warnings, page-level issues, score history' : ''}
${context?.siteHealthDetail ? '✅ **Audit Detail** — site-wide issues, top problem pages with specific issue descriptions' : ''}
${context?.siteHealthDetail?.cwvSummary ? '✅ **Core Web Vitals** — mobile and desktop page speed assessment (LCP, INP, CLS) with pass/fail ratings from Google' : ''}
${clientAuditTrafficSection ? '✅ **Audit Traffic Intelligence** — high-traffic pages that have SEO issues' : ''}
${contentPlanSection ? '✅ **Content Plan** — planned content templates and matrices with production status' : ''}
${hasStrategy ? '✅ **SEO Strategy** — keyword-to-page mapping, content gaps, quick wins, opportunities' : ''}
${hasRankings ? '✅ **Rank Tracking** — tracked keyword positions, clicks, impressions, position changes' : ''}
${hasActivity ? '✅ **Activity Log** — recent actions taken on the site' : ''}
${hasApprovals ? `✅ **Pending Approvals** — ${context.pendingApprovals} SEO changes awaiting client review` : ''}
${hasRequests ? '✅ **Active Requests** — open client requests with categories and statuses' : ''}
${context?.detectedAnomalies && Array.isArray(context.detectedAnomalies) && context.detectedAnomalies.length > 0 ? '✅ **Detected Anomalies** — AI-flagged significant changes in traffic, conversions, or site health. Reference these when the user asks about recent changes or drops.' : ''}
${clientAuditTrafficSection}
${contentPlanSection}
${priorContext}`;

    // --- Revenue hooks vs beta-safe recommendations ---
    const revenueSection = betaMode
      ? `RECOMMENDATIONS — When data reveals an opportunity, frame it as a collaborative next step with ${teamName}:
- **Low organic traffic share** → "A keyword strategy could unlock the organic traffic you're missing — worth discussing with ${teamName}."
- **High bounce rate on key pages** → "This page could be optimized to keep visitors engaged — ${teamName} can look into it."
- **Missing or thin content for valuable keywords** → "There's a content gap here that's costing you traffic — this is a great topic to prioritize."
- **Technical SEO issues** → "These technical issues are holding your rankings back — ${teamName} can address them."
- **No conversion tracking** → "Without proper tracking, we can't measure what's working — ${teamName} can set this up."
- **Keyword rankings dropping** → "Some of your rankings have slipped — ${teamName} can analyze why and build a recovery plan."
- **Pending approvals** → "You have SEO improvements waiting for your review — approving them will help your rankings."

IMPORTANT BETA RULES:
- NEVER mention purchasing, buying, ordering, pricing, plans, subscriptions, upgrades, or costs.
- NEVER mention content briefs, blog post purchases, or any paid deliverables as something to buy or order.
- NEVER reference plan tiers (free, growth, premium) or trial periods.
- You may mention content gaps as strategic opportunities, but frame them as topics to create — not products to purchase.
- Frame all recommendations as collaborative work with ${teamName}, not as purchasable services.`
      : `REVENUE HOOKS — When data reveals an opportunity, naturally connect it to a service:
- **Low organic traffic share** → "A keyword strategy could unlock the organic traffic you're missing — ${teamName} can build one targeted to your business."
- **High bounce rate on key pages** → "This page needs attention — ${teamName} can optimize the content and layout to keep visitors engaged."
- **Missing or thin content for valuable keywords** → "There's a content gap here that's costing you traffic — ${teamName} can create a content brief or full post to capture it."
- **Technical SEO issues (errors, warnings, broken links)** → "These technical issues are holding your rankings back — ${teamName} can run a cleanup sprint."
- **No conversion tracking / low event counts** → "Without proper tracking, we can't measure what's working — ${teamName} can set up conversion tracking so you see the full picture."
- **Keyword rankings dropping** → "Some of your rankings have slipped — ${teamName} can analyze why and build a recovery plan."
- **Pending approvals** → "You have SEO improvements waiting for your review — approving them will help your rankings."
- **Schema/structured data gaps** → "Adding structured data could get you rich snippets in search results — ${teamName} can implement the right schema types."

IMPORTANT: Revenue hooks should feel like genuine, helpful recommendations — NEVER like a sales pitch. Only mention services when the DATA supports it. The pattern is:
1. Surface the specific insight with numbers
2. Explain the business impact in plain language
3. Warm handoff: "${teamName} can help you capitalize on this" — natural, not pushy`;

    const systemPrompt = `You are the **hmpsn studio Insights Engine** — a smart, data-driven analytics advisor embedded in a client's website performance dashboard. You work alongside ${teamName} who manages this client's website. Your job is to help the client understand their data, spot opportunities, and feel confident about their website's direction.

${dataInventory}

YOUR APPROACH:
1. **Be specific and data-driven** — Always reference actual numbers, queries, pages, and percentages from the data provided. Never make up or hallucinate statistics. If data is missing, say so.
2. **Connect the dots across data sources** — The most powerful insights come from cross-referencing: a page with high impressions but low CTR AND a high bounce rate tells a very specific story. Use all available data together.
3. **Prioritize by business impact** — Lead with the 2-3 things that would move the needle most. Frame everything in terms of real outcomes: traffic, leads, revenue, visibility.
4. **Give quick wins they can act on** — Small, non-technical things like "update your Google Business Profile" or "add this topic to your blog calendar." Make sure every response includes at least one concrete next step.
5. **Remember context** — If the user references something from earlier in the conversation, use the conversation history to give a coherent, continuous response.
6. **Be honest about uncertainty** — If a trend is too early to call, or if the data doesn't clearly explain something, say so rather than speculating. "The data suggests X, but we'd want to watch this for another few weeks" is better than a false conclusion.

${revenueSection}

SEO EDUCATOR MODE — Many clients are new to SEO. When they ask "what is..." or "why does..." or "what does X mean" questions:
- Explain the concept in plain, jargon-free English first
- Then immediately connect it to THEIR data: "Your CTR is 3.2% — that means for every 100 times your pages show up in Google, about 3 people click through. The typical range is 2-5%, so you're right on track."
- Use simple analogies when helpful: "Think of impressions as people walking past your storefront window — clicks are the ones who actually come inside"
- Always end educational answers with why it matters for their business, not just the definition
- If they ask about a metric you have data for, show their actual number and whether it's good, average, or needs work
- Don't be condescending — assume they're smart but new to SEO specifically

TONE & STYLE:
- Conversational and warm, like a knowledgeable colleague — not robotic or corporate
- Confident in your analysis but not arrogant
- Use markdown formatting (bold for emphasis, numbered lists for action items, bullet points for data)
- Keep responses focused and scannable — aim for 150-300 words unless the question demands more
- When you see a genuine opportunity, show enthusiasm — "This is really promising" or "There's a great opportunity here"
${RICH_BLOCKS_PROMPT}
CRITICAL RULES:
- NEVER fabricate data or statistics that aren't in the provided context. Only reference numbers you can see.
- NEVER give step-by-step technical implementation instructions (code, meta tags, schema markup, etc.)
- NEVER suggest specific tools, plugins, or third-party services by name
- NEVER promise specific ranking improvements or timelines (e.g. "you'll be on page 1 in 3 months"). SEO results depend on many factors.
- NEVER contradict or criticize work ${teamName} has already done. If something looks off, frame it as "worth reviewing" not "this was done wrong."
- If directly asked "how do I do this?", share the general direction and what to expect, then say "${teamName} can handle the implementation and make sure it's done right."
- Be honest if the data shows problems — clients respect candor. But always pair problems with the path forward.
- When you reference pending approvals or active requests, encourage the client to take action on them.
- If strategy data includes quick wins, proactively mention them — they're pre-identified high-impact opportunities.

Site: ${getBrandName(ws)}
Date range: last ${context?.days || 28} days
${seoContextBlock}
Current data context:
${JSON.stringify(context, null, 2)}`;

    // Build messages array: system + conversation history + current question
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.slice(-10), // last 10 messages for context window management
      { role: 'user', content: question },
    ];

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages,
      temperature: 0.7,
      maxTokens: 1500,
      feature: 'client-search-chat',
      workspaceId: ws.id,
    });

    const answer = aiResult.text || 'No response generated.';

    // Persist assistant response
    if (sessionId) {
      addMessage(ws.id, sessionId, 'client', 'assistant', answer);
      const session = getChatSession(ws.id, sessionId);
      // Log first exchange to activity log so agency sees what clients ask
      if (session && session.messages.length === 2) {
        addActivity(ws.id, 'chat_session', 'Client chat: ' + question.trim().slice(0, 80), `Client started a new Insights Engine conversation`);
        incrementUsage(ws.id, 'ai_chats');
      }
      // Auto-summarize after 6+ messages
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

// --- Public GA4 Analytics API ---
router.get('/api/public/analytics-overview/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured for this workspace' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const overview = await getGA4Overview(ws.ga4PropertyId, days, parseDateRange(req.query));
    res.json(overview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-trend/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const trend = await getGA4DailyTrend(ws.ga4PropertyId, days, parseDateRange(req.query));
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-top-pages/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const pages = await getGA4TopPages(ws.ga4PropertyId, days, 200, parseDateRange(req.query));
    res.json(pages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-sources/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const sources = await getGA4TopSources(ws.ga4PropertyId, days, 10, parseDateRange(req.query));
    res.json(sources);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-devices/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const devices = await getGA4DeviceBreakdown(ws.ga4PropertyId, days, parseDateRange(req.query));
    res.json(devices);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-countries/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const countries = await getGA4Countries(ws.ga4PropertyId, days, 10, parseDateRange(req.query));
    res.json(countries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-comparison/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    res.json(await getGA4PeriodComparison(ws.ga4PropertyId, days, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/public/analytics-new-vs-returning/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    res.json(await getGA4NewVsReturning(ws.ga4PropertyId, days, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- GA4 Key Events & Conversions ---
router.get('/api/public/analytics-events/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const events = await getGA4KeyEvents(ws.ga4PropertyId, days, 20, parseDateRange(req.query));
    res.json(events);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-event-trend/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  const eventName = req.query.event as string;
  if (!eventName) return res.status(400).json({ error: 'event query param required' });
  try {
    const trend = await getGA4EventTrend(ws.ga4PropertyId, eventName, days, parseDateRange(req.query));
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/public/analytics-conversions/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const conversions = await getGA4Conversions(ws.ga4PropertyId, days, parseDateRange(req.query));
    res.json(conversions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- GA4 Event Explorer ---
router.get('/api/public/analytics-event-explorer/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  const eventName = req.query.event as string | undefined;
  const pagePath = req.query.page as string | undefined;
  try {
    const data = await getGA4EventsByPage(ws.ga4PropertyId, days, { eventName, pagePath }, parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- GA4 Phase 3: Landing Pages, Organic, Comparison, New vs Returning ---
router.get('/api/public/analytics-landing-pages/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  const organicOnly = req.query.organic === 'true';
  const limit = parseInt(req.query.limit as string) || 25;
  try {
    res.json(await getGA4LandingPages(ws.ga4PropertyId, days, limit, organicOnly, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/public/analytics-organic/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    res.json(await getGA4OrganicOverview(ws.ga4PropertyId, days, parseDateRange(req.query)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
