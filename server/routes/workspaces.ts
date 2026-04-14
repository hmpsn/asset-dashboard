/**
 * workspaces routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import bcrypt from 'bcryptjs';
import type * as WebScraper from '../web-scraper.js';
import type * as OpenAIHelpers from '../openai-helpers.js';
import express from 'express';
import { listBatches } from '../approvals.js';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import { broadcast, broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS, ADMIN_EVENTS } from '../ws-events.js';
import {
  listClientUsers,
  createClientUser,
  updateClientUser,
  changeClientPassword,
  deleteClientUser,
} from '../client-users.js';
import { listContentRequests } from '../content-requests.js';
import { notifyClientWelcome } from '../email.js';
import { applySuppressionsToAudit, resolvePagePath } from '../helpers.js';
import { callOpenAI, parseAIJson } from '../openai-helpers.js';
import { getLatestSnapshot } from '../reports.js';
import { listRequests } from '../requests.js';
import {
  getSiteSubdomain,
  discoverSitemapUrls,
} from '../webflow.js';
import { getWorkspacePages, invalidatePageCache } from '../workspace-data.js';
import { debouncedSettingsCascade, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { listWorkOrders } from '../work-orders.js';
import { listMatrices } from '../content-matrices.js';
import { listChurnSignals } from '../churn-signals.js';
import { listClientSignals } from '../client-signals-store.js';
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getWorkspace,
  getTokenForSite,
  updatePageState,
  getPageState,
  getAllPageStates,
  clearPageState,
  clearPageStatesByStatus,
} from '../workspaces.js';
import { clearSeoContextCache } from '../seo-context.js';
import { invalidateIntelligenceCache, buildWorkspaceIntelligence, formatKeywordsForPrompt } from '../workspace-intelligence.js';
import type { Workspace } from '../workspaces.js';
import type { ScrapedPage } from '../web-scraper.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('workspaces');

// Workspaces
router.get('/api/workspaces', (_req, res) => {
  const workspaces = listWorkspaces().map(ws => ({ ...ws, webflowToken: undefined, clientPassword: undefined, hasPassword: !!ws.clientPassword }));
  res.json(workspaces);
});

// Workspace overview: aggregated metrics for all workspaces
router.get('/api/workspace-overview', (_req, res) => {
  const workspaces = listWorkspaces();
  const overview = workspaces.map(ws => {
    // Audit
    let audit: { score: number; totalPages: number; errors: number; warnings: number; previousScore?: number; lastAuditDate?: string } | null = null;
    if (ws.webflowSiteId) {
      const snap = getLatestSnapshot(ws.webflowSiteId);
      if (snap) {
        const filtered = applySuppressionsToAudit(snap.audit, ws.auditSuppressions || []);
        audit = {
          score: filtered.siteScore,
          totalPages: filtered.totalPages,
          errors: filtered.errors,
          warnings: filtered.warnings,
          previousScore: snap.previousScore,
          lastAuditDate: snap.createdAt,
        };
      }
    }
    // Requests
    const reqs = listRequests(ws.id);
    const reqNew = reqs.filter(r => r.status === 'new').length;
    const reqActive = reqs.filter(r => r.status === 'in_review' || r.status === 'in_progress').length;
    const reqTotal = reqs.length;
    const latestReq = reqs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    // Approvals
    const batches = listBatches(ws.id);
    const pendingApprovals = batches.reduce((sum, b) => sum + b.items.filter((i: { status: string }) => i.status === 'pending').length, 0);
    const totalApprovalItems = batches.reduce((sum, b) => sum + b.items.length, 0);
    // Content requests (from client portal)
    const contentReqs = listContentRequests(ws.id);
    const pendingContentReqs = contentReqs.filter(r => r.status === 'requested').length;
    const inProgressContentReqs = contentReqs.filter(r => ['brief_generated', 'client_review', 'approved', 'in_progress'].includes(r.status)).length;
    const deliveredContentReqs = contentReqs.filter(r => r.status === 'delivered' || r.status === 'published').length;

    // Work orders
    const workOrders = listWorkOrders(ws.id);
    const pendingWorkOrders = workOrders.filter(o => o.status === 'pending' || o.status === 'in_progress').length;

    // Content plan review/flagged cells
    const matrices = listMatrices(ws.id);
    const reviewCells = matrices.reduce((sum, m) => sum + (m.cells || []).filter((c: { status?: string }) => c.status === 'review' || c.status === 'flagged').length, 0);

    // Page edit states summary
    const allStates = getAllPageStates(ws.id);
    const stateVals = Object.values(allStates);
    const pageStates = {
      issueDetected: stateVals.filter((s: { status: string }) => s.status === 'issue-detected').length,
      inReview: stateVals.filter((s: { status: string }) => s.status === 'in-review').length,
      approved: stateVals.filter((s: { status: string }) => s.status === 'approved').length,
      rejected: stateVals.filter((s: { status: string }) => s.status === 'rejected').length,
      live: stateVals.filter((s: { status: string }) => s.status === 'live').length,
      total: stateVals.length,
    };

    // Churn signals
    let churnCritical = 0;
    let churnWarning = 0;
    try {
      const signals = listChurnSignals(ws.id);
      churnCritical = signals.filter(s => s.severity === 'critical').length;
      churnWarning = signals.filter(s => s.severity === 'warning').length;
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspaces: programming error'); /* non-critical */ }

    // Client signals (new = unreviewed)
    let clientSignalsNew = 0;
    try {
      clientSignalsNew = listClientSignals(ws.id).filter(s => s.status === 'new').length;
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspaces: programming error'); /* non-critical */ }

    const trialEnd = ws.trialEndsAt ? new Date(ws.trialEndsAt) : null;
    const isTrial = trialEnd ? trialEnd > new Date() : false;
    const trialDaysRemaining = isTrial && trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : undefined;

    return {
      id: ws.id,
      name: ws.name,
      webflowSiteId: ws.webflowSiteId || null,
      webflowSiteName: ws.webflowSiteName || null,
      hasGsc: !!ws.gscPropertyUrl,
      hasGa4: !!ws.ga4PropertyId,
      hasPassword: !!ws.clientPassword,
      tier: ws.tier || 'free',
      isTrial,
      trialDaysRemaining,
      audit,
      requests: { total: reqTotal, new: reqNew, active: reqActive, latestDate: latestReq?.updatedAt || null },
      approvals: { pending: pendingApprovals, total: totalApprovalItems },
      contentRequests: { pending: pendingContentReqs, inProgress: inProgressContentReqs, delivered: deliveredContentReqs, total: contentReqs.length },
      workOrders: { pending: pendingWorkOrders, total: workOrders.length },
      contentPlan: { review: reviewCells },
      churnSignals: { critical: churnCritical, warning: churnWarning },
      clientSignals: { new: clientSignalsNew },
      pageStates,
    };
  });
  res.json(overview);
});

router.get('/api/workspaces/:id', requireWorkspaceAccess(), (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const safe = { ...ws, webflowToken: undefined, clientPassword: undefined, hasPassword: !!ws.clientPassword };
  res.json(safe);
});

const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  webflowSiteId: z.string().optional(),
  webflowSiteName: z.string().optional(),
});

router.post('/api/workspaces', validate(createWorkspaceSchema), (req, res) => {
  const { name, webflowSiteId, webflowSiteName } = req.body;
  const ws = createWorkspace(name, webflowSiteId, webflowSiteName);
  broadcast(ADMIN_EVENTS.WORKSPACE_CREATED, ws);
  res.json(ws);
});

router.patch('/api/workspaces/:id', requireWorkspaceAccess(), async (req, res) => {
  const updates = { ...req.body };
  // When unlinking, clear the token too
  if (updates.webflowSiteId === null || updates.webflowSiteId === '') {
    updates.webflowToken = '';
    updates.liveDomain = '';
  }
  // Hash clientPassword with bcrypt before saving (empty string = remove password)
  if (typeof updates.clientPassword === 'string') {
    updates.clientPassword = updates.clientPassword
      ? await bcrypt.hash(updates.clientPassword, 12)
      : '';
  }
  // Auto-resolve live domain when linking a site
  if (updates.webflowSiteId && updates.webflowSiteId !== '') {
    try {
      const token = updates.webflowToken || getTokenForSite(updates.webflowSiteId) || process.env.WEBFLOW_API_TOKEN || '';
      if (token) {
        const domRes = await fetch(`https://api.webflow.com/v2/sites/${updates.webflowSiteId}/custom_domains`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (domRes.ok) {
          const domData = await domRes.json() as { customDomains?: { url?: string }[] };
          const domains = domData.customDomains || [];
          if (domains.length > 0 && domains[0].url) {
            const d = domains[0].url;
            updates.liveDomain = d.startsWith('http') ? d : `https://${d}`;
          }
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspaces: PATCH /api/workspaces/:id: programming error'); /* best-effort live domain resolution */ }
  }
  const ws = updateWorkspace(req.params.id, updates);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  clearSeoContextCache(req.params.id); // Invalidate cached AI context
  invalidateIntelligenceCache(req.params.id);
  // Bridge #11: debounced cascade — re-invalidates intelligence cache 2s later to catch any
  // cache repopulation that occurred between the immediate clear above and this deferred pass.
  debouncedSettingsCascade(req.params.id, () => {
    invalidateIntelligenceCache(req.params.id);
    invalidatePageCache(req.params.id);
    invalidateSubCachePrefix(req.params.id, 'slice:'); // Invalidate ALL slice caches on settings change
  });
  // Strip token from response to avoid leaking to frontend
  const safe = { ...ws, webflowToken: undefined, clientPassword: undefined, hasPassword: !!ws.clientPassword };
  broadcast(WS_EVENTS.WORKSPACE_UPDATED, safe);
  broadcastToWorkspace(req.params.id, WS_EVENTS.WORKSPACE_UPDATED, safe);
  res.json(safe);
});

router.delete('/api/workspaces/:id', requireWorkspaceAccess(), (req, res) => {
  const ok = deleteWorkspace(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcast(ADMIN_EVENTS.WORKSPACE_DELETED, { id: req.params.id });
  res.json({ ok: true });
});

// --- Shared: scrape website pages for AI analysis ---
async function scrapeWorkspaceSite(ws: Workspace): Promise<{ scraped: ScrapedPage[]; pagesSummary: string }> {
  const { scrapeUrls }: typeof WebScraper = await import('../web-scraper.js'); // dynamic-import-ok

  const token = getTokenForSite(ws.webflowSiteId!) || undefined;
  const subdomain = await getSiteSubdomain(ws.webflowSiteId!, token);
  const baseUrl = ws.liveDomain
    ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`)
    : subdomain ? `https://${subdomain}.webflow.io` : '';
  if (!baseUrl) throw new Error('Could not determine site URL');

  const published = await getWorkspacePages(ws.id, ws.webflowSiteId!);

  const priorityPatterns = [
    /^\/?$/, /about/i, /who-we-are/i, /our-story/i, /team/i,
    /service/i, /solution/i, /what-we-do/i, /offer/i,
    /work/i, /portfolio/i, /case-stud/i, /project/i, /client/i,
    /contact/i, /location/i, /blog/i, /insight/i, /resource/i,
  ];

  const prioritized: string[] = [];
  const rest: string[] = [];

  for (const p of published) {
    const pagePath = resolvePagePath(p);
    const url = baseUrl + pagePath;
    if (priorityPatterns.some(pat => pat.test(pagePath))) prioritized.push(url);
    else rest.push(url);
  }

  try {
    const sitemapUrls = await discoverSitemapUrls(baseUrl);
    for (const url of sitemapUrls) {
      try {
        const pagePath = new URL(url).pathname;
        if (!prioritized.includes(url) && !rest.includes(url)) {
          if (priorityPatterns.some(pat => pat.test(pagePath))) prioritized.push(url);
          else rest.push(url);
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspaces: programming error'); /* skip */ }
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspaces: programming error'); /* sitemap unavailable */ }

  const urlsToScrape = [...prioritized.slice(0, 12), ...rest.slice(0, 3)];
  if (urlsToScrape.length === 0) throw new Error('No pages found to scrape');

  const scraped = await scrapeUrls(urlsToScrape, 3);
  if (scraped.length === 0) throw new Error('Could not scrape any pages');

  const pagesSummary = scraped.map(p => {
    const headingsStr = p.headings.slice(0, 10).map(h => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
    return `--- PAGE: ${p.url} ---\nTitle: ${p.title}\nDescription: ${p.metaDescription}\nHeadings:\n${headingsStr}\nContent excerpt:\n${p.bodyText.slice(0, 1500)}`;
  }).join('\n\n');

  return { scraped, pagesSummary };
}

// --- Business Profile (verified business data for schema generation) ---
const businessProfileSchema = z.object({
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  address: z.object({
    street: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    zip: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
  }).optional(),
  socialProfiles: z.array(z.string().url()).max(10).optional(),
  openingHours: z.string().max(500).optional(),
  foundedDate: z.string().max(20).optional(),
  numberOfEmployees: z.string().max(50).optional(),
});

router.put('/api/workspaces/:id/business-profile', requireWorkspaceAccess(), validate(businessProfileSchema), (req, res) => {
  const ws = updateWorkspace(req.params.id, { businessProfile: req.body });
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  broadcastToWorkspace(req.params.id, WS_EVENTS.WORKSPACE_UPDATED, { businessProfile: ws.businessProfile });
  res.json({ businessProfile: ws.businessProfile });
});

// --- Intelligence Profile (structured business intelligence: industry, goals, target audience) ---
const intelligenceProfileSchema = z.object({
  industry: z.string().max(200).optional(),
  goals: z.array(z.string().max(500)).max(20).optional(),
  targetAudience: z.string().max(2000).optional(),
});

router.put('/api/workspaces/:id/intelligence-profile', requireWorkspaceAccess(), validate(intelligenceProfileSchema), (req, res) => {
  const ws = updateWorkspace(req.params.id, { intelligenceProfile: req.body });
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  invalidateIntelligenceCache(req.params.id);
  broadcastToWorkspace(req.params.id, WS_EVENTS.WORKSPACE_UPDATED, { intelligenceProfile: ws.intelligenceProfile });
  res.json({ intelligenceProfile: ws.intelligenceProfile });
});

router.post('/api/workspaces/:id/intelligence-profile/autofill', requireWorkspaceAccess(), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    // Fetch seoContext slice for keyword/strategy context.
    // businessProfile is intentionally NOT requested here — that's what we're generating.
    const intel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
    const seoCtx = intel.seoContext;

    const siteName = ws.name || 'this website';
    const keywordBlock = seoCtx ? formatKeywordsForPrompt(seoCtx) : '';
    const bizContext = seoCtx?.businessContext ?? '';
    const contentGapTopics = seoCtx?.strategy?.contentGaps?.slice(0, 5).map(g => g.topic).join(', ') ?? '';

    const contextParts: string[] = [`Site name: ${siteName}`];
    if (keywordBlock) contextParts.push(`Target keywords:\n${keywordBlock}`);
    if (bizContext) contextParts.push(`Business context: ${bizContext}`);
    if (contentGapTopics) contextParts.push(`Content topics: ${contentGapTopics}`);

    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      feature: 'intelligence-profile-autofill',
      workspaceId: ws.id,
      temperature: 0.3,  // low temperature for consistent JSON output
      maxTokens: 300,    // response is a small JSON object
      messages: [
        {
          role: 'system',
          content: 'You are a business analyst. Based on the website context provided, infer the business profile. Respond with ONLY valid JSON — no markdown, no explanation.',
        },
        {
          role: 'user',
          content: `Based on this website context, suggest a business intelligence profile:\n\n${contextParts.join('\n\n')}\n\nRespond with JSON: {"industry": "string", "goals": ["string", ...], "targetAudience": "string"}`,
        },
      ],
    });

    // parseAIJson strips markdown fences (```json ... ```) that LLMs occasionally emit
    // even when instructed not to. parseJsonFallback does bare JSON.parse and silently
    // returns {} on fenced output, leaving the frontend fields blank with no error shown.
    let suggestion: { industry?: string; goals?: string[]; targetAudience?: string } = {};
    try { suggestion = parseAIJson(result.text); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspaces: programming error'); /* malformed — fall through to empty fields */ }

    return res.json({
      industry: typeof suggestion.industry === 'string' ? suggestion.industry : '',
      goals: Array.isArray(suggestion.goals) ? suggestion.goals.filter((g: unknown) => typeof g === 'string') : [],
      targetAudience: typeof suggestion.targetAudience === 'string' ? suggestion.targetAudience : '',
    });
  } catch (err) {
    log.error({ err }, 'Intelligence profile autofill failed');
    return res.status(500).json({ error: 'Auto-fill failed — try again or fill manually' });
  }
});

// --- Auto-generate knowledge base from website crawl ---
router.post('/api/workspaces/:id/generate-knowledge-base', requireWorkspaceAccess(), async (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });

  try {
    const { scraped, pagesSummary } = await scrapeWorkspaceSite(ws);

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a business analyst. Given scraped website content, extract a structured knowledge base that an AI content writer and chatbot can use to understand this business. Be specific and factual — only include information that is clearly stated or strongly implied on the website.`,
        },
        {
          role: 'user',
          content: `Analyze the following website content and produce a structured business knowledge base.

${pagesSummary}

Generate a knowledge base in this exact format (fill in what you find, leave sections empty with "Not found on website" if the information isn't available):

BUSINESS OVERVIEW:
- Company name: [name]
- Industry: [industry/vertical]
- Location: [city, state/country if mentioned]
- Business type: [agency, SaaS, local service, e-commerce, etc.]
- Years in business: [if mentioned]
- Team size: [if mentioned]

SERVICES & OFFERINGS:
[List each service/product with a 1-sentence description]

TARGET AUDIENCE:
- Primary audience: [who they serve]
- Industries served: [list industries/verticals mentioned]
- Company sizes: [SMB, enterprise, etc. if mentioned]

DIFFERENTIATORS & VALUE PROPS:
[List what makes them unique — awards, methodology, technology, guarantees, etc.]

CASE STUDIES & RESULTS:
[List any specific client work, results, metrics, or testimonials mentioned. Include client names, industries, and outcomes with real numbers if available.]

BRAND VOICE & TONE:
[Describe the writing style observed across the site — formal/casual, technical/approachable, etc.]

KEY TOPICS & EXPERTISE:
[List the main topics, technologies, or domains they demonstrate expertise in]

IMPORTANT DETAILS:
[Any other relevant business information — certifications, partnerships, tools used, process descriptions, pricing model, etc.]

Be concise but specific. Use bullet points. Only include information actually found on the website — never fabricate.`,
        },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      feature: 'knowledge-base-gen',
      workspaceId: ws.id,
      timeoutMs: 90_000,
    });

    res.json({ knowledgeBase: aiResult.text, pagesScraped: scraped.length });
  } catch (err) {
    log.error({ err: err }, 'Operation failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate knowledge base' });
  }
});

// --- Auto-generate brand voice from website crawl ---
router.post('/api/workspaces/:id/generate-brand-voice', requireWorkspaceAccess(), async (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });

  try {
    const { scraped, pagesSummary } = await scrapeWorkspaceSite(ws);

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a brand strategist and copywriting expert. Given scraped website content, analyze the writing style, tone, and voice patterns used across the site. Be specific and evidence-based — only describe patterns you actually observe in the content.`,
        },
        {
          role: 'user',
          content: `Analyze the following website content and produce a comprehensive brand voice guide that an AI content writer can follow to match this brand's writing style.

${pagesSummary}

Generate a brand voice guide covering these areas:

TONE & PERSONALITY:
- Overall tone: [e.g. professional, casual, authoritative, friendly, etc.]
- Personality traits: [3-5 adjectives that describe the brand's character]
- Formality level: [formal / semi-formal / casual / conversational]

WRITING STYLE:
- Sentence structure: [short & punchy / long & detailed / mixed]
- Vocabulary level: [technical jargon / industry terms / plain language / mix]
- Person/perspective: [first person "we" / second person "you" / third person]
- Active vs passive voice: [preference observed]

MESSAGING PATTERNS:
- How they describe their services: [direct claims / benefit-led / story-driven]
- How they address the reader: [as a peer / as an expert to client / as a helper]
- CTAs and persuasion style: [soft / direct / urgency-driven / value-led]
- Common phrases or language patterns: [list any recurring phrases, slogans, or distinctive word choices]

DO's:
[5-8 specific writing guidelines based on what the brand does well]

DON'Ts:
[5-8 things to avoid based on what's absent or contrary to the brand's style]

EXAMPLE PHRASES:
[5-10 short phrases or sentences lifted directly from the site that exemplify the brand voice]

Be specific and actionable. An AI writer should be able to follow this guide to produce copy that sounds like it belongs on this website.`,
        },
      ],
      maxTokens: 2000,
      temperature: 0.4,
      feature: 'brand-voice-gen',
      workspaceId: ws.id,
      timeoutMs: 90_000,
    });

    try {
      if (!getActionBySource('brand_voice', req.params.id)) recordAction({ // recordAction-ok: req.params.id is workspaceId (workspaces route)
        workspaceId: req.params.id,
        actionType: 'voice_calibrated',
        sourceType: 'brand_voice',
        sourceId: req.params.id,
        pageUrl: null,
        targetKeyword: null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome action for brand voice update');
    }

    res.json({ brandVoice: aiResult.text, pagesScraped: scraped.length });
  } catch (err) {
    log.error({ err: err }, 'Operation failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate brand voice' });
  }
});

// --- Auto-generate audience personas from website crawl ---
router.post('/api/workspaces/:id/generate-personas', requireWorkspaceAccess(), async (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });

  try {
    const { scraped, pagesSummary } = await scrapeWorkspaceSite(ws);

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a marketing strategist. Given scraped website content, identify the distinct audience segments this business targets. Be specific and evidence-based — only identify personas that are clearly implied by the website's messaging, services, case studies, or content.`,
        },
        {
          role: 'user',
          content: `Analyze the following website content and identify 2-5 distinct audience personas this business targets.

${pagesSummary}

Return ONLY a valid JSON array of persona objects. No markdown, no explanation — just the JSON array.

Each persona object must have exactly these fields:
{
  "name": "Short persona name (e.g. 'Marketing Director', 'Small Business Owner')",
  "description": "1-2 sentence description of who this person is",
  "painPoints": ["pain point 1", "pain point 2", "pain point 3"],
  "goals": ["goal 1", "goal 2", "goal 3"],
  "objections": ["likely objection 1", "likely objection 2"],
  "preferredContentFormat": "e.g. case studies, how-to guides, comparison articles",
  "buyingStage": "awareness" or "consideration" or "decision"
}

Rules:
- Identify 2-5 personas based on evidence from the website (who the services target, case study clients, language used)
- Each persona should be distinct — different roles, industries, or needs
- Pain points, goals, and objections should be specific to THIS business's offerings
- If buying stage isn't clear, default to "consideration"
- ONLY return the JSON array, nothing else`,
        },
      ],
      maxTokens: 2500,
      temperature: 0.4,
      feature: 'personas-gen',
      workspaceId: ws.id,
      timeoutMs: 90_000,
    });

    // Parse the AI response as JSON
    let personas;
    try {
      const { parseAIJson }: typeof OpenAIHelpers = await import('../openai-helpers.js'); // dynamic-import-ok
      personas = parseAIJson<Array<{
        name: string; description: string; painPoints: string[]; goals: string[];
        objections: string[]; preferredContentFormat?: string; buyingStage?: string;
      }>>(aiResult.text);
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'workspaces: programming error');
      return res.status(500).json({ error: 'AI returned invalid JSON — try again' });
    }

    if (!Array.isArray(personas) || personas.length === 0) {
      return res.status(500).json({ error: 'AI did not return valid personas — try again' });
    }

    // Add IDs and normalize
    const normalized = personas.slice(0, 5).map((p, i) => ({
      id: `persona_${Date.now()}_${i}`,
      name: p.name || `Persona ${i + 1}`,
      description: p.description || '',
      painPoints: Array.isArray(p.painPoints) ? p.painPoints : [],
      goals: Array.isArray(p.goals) ? p.goals : [],
      objections: Array.isArray(p.objections) ? p.objections : [],
      preferredContentFormat: p.preferredContentFormat || undefined,
      buyingStage: (['awareness', 'consideration', 'decision'].includes(p.buyingStage || '') ? p.buyingStage : 'consideration') as 'awareness' | 'consideration' | 'decision',
    }));

    res.json({ personas: normalized, pagesScraped: scraped.length });
  } catch (err) {
    log.error({ err: err }, 'Operation failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate personas' });
  }
});

// --- Audit Issue Suppressions ---
router.get('/api/workspaces/:id/audit-suppressions', requireWorkspaceAccess(), (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  res.json(ws.auditSuppressions || []);
});

const auditSuppressionSchema = z.object({
  check: z.string().min(1, 'check is required'),
  pageSlug: z.string().optional(),
  pagePattern: z.string().optional(),
  reason: z.string().max(500).optional(),
}).refine(d => d.pageSlug || d.pagePattern, { message: 'pageSlug or pagePattern is required' });

router.post('/api/workspaces/:id/audit-suppressions', requireWorkspaceAccess(), validate(auditSuppressionSchema), (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const { check, pageSlug, pagePattern, reason } = req.body;
  const suppressions = ws.auditSuppressions || [];
  // Deduplicate: check for existing exact or pattern match
  if (pagePattern) {
    if (suppressions.some(s => s.check === check && s.pagePattern === pagePattern)) {
      return res.json({ ok: true, suppressions });
    }
    suppressions.push({ check, pageSlug: pageSlug || `[pattern] ${pagePattern}`, pagePattern, reason: reason || undefined, createdAt: new Date().toISOString() });
  } else {
    if (suppressions.some(s => s.check === check && s.pageSlug === pageSlug && !s.pagePattern)) {
      return res.json({ ok: true, suppressions });
    }
    suppressions.push({ check, pageSlug, reason: reason || undefined, createdAt: new Date().toISOString() });
  }
  updateWorkspace(req.params.id, { auditSuppressions: suppressions });
  res.json({ ok: true, suppressions });
});

router.delete('/api/workspaces/:id/audit-suppressions', requireWorkspaceAccess(), validate(auditSuppressionSchema), (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const { check, pageSlug, pagePattern } = req.body;
  const suppressions = (ws.auditSuppressions || []).filter(s => {
    if (pagePattern) return !(s.check === check && s.pagePattern === pagePattern);
    return !(s.check === check && s.pageSlug === pageSlug && !s.pagePattern);
  });
  updateWorkspace(req.params.id, { auditSuppressions: suppressions });
  res.json({ ok: true, suppressions });
});

const pageStateUpdateSchema = z.object({
  status: z.enum(['clean', 'issue-detected', 'fix-proposed', 'in-review', 'approved', 'rejected', 'live']).optional(),
  fields: z.array(z.string()).optional(),
  auditIssues: z.array(z.string()).optional(),
  source: z.string().optional(),
  approvalBatchId: z.string().optional(),
  contentRequestId: z.string().optional(),
  workOrderId: z.string().optional(),
  rejectionNote: z.string().max(2000).optional(),
  updatedBy: z.string().optional(),
});

const createClientUserSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(200),
  role: z.enum(['client_owner', 'client_member']).optional().default('client_member'),
});

const updateClientUserSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().optional(),
  role: z.enum(['client_owner', 'client_member']).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
});

// --- Unified Page Edit States ---
// GET all page states for a workspace (admin)
router.get('/api/workspaces/:id/page-states', requireWorkspaceAccess(), (req, res) => {
  res.json(getAllPageStates(req.params.id));
});

// GET single page state (admin)
router.get('/api/workspaces/:id/page-states/:pageId', requireWorkspaceAccess(), (req, res) => {
  const state = getPageState(req.params.id, req.params.pageId);
  if (!state) return res.status(404).json({ error: 'No state for this page' });
  res.json(state);
});

// PATCH: update page state (admin)
router.patch('/api/workspaces/:id/page-states/:pageId', requireWorkspaceAccess(), validate(pageStateUpdateSchema), (req, res) => {
  const result = updatePageState(req.params.id, req.params.pageId, req.body);
  if (!result) return res.status(404).json({ error: 'Workspace not found' });
  res.json(result);
});

// DELETE: clear page state (admin)
router.delete('/api/workspaces/:id/page-states/:pageId', requireWorkspaceAccess(), (req, res) => {
  const ok = clearPageState(req.params.id, req.params.pageId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// POST: bulk clear page states by status (admin)
router.post('/api/workspaces/:id/page-states/clear', requireWorkspaceAccess(), validate(z.object({
  status: z.string().min(1, 'status is required'),
})), (req, res) => {
  const { status } = req.body;
  const cleared = clearPageStatesByStatus(req.params.id, status);
  res.json({ ok: true, cleared });
});

// --- Admin: Client User Management (requires internal auth) ---

// List client users for a workspace
router.get('/api/workspaces/:id/client-users', requireWorkspaceAccess(), (_req, res) => {
  res.json(listClientUsers(_req.params.id));
});

// Create/invite a client user
router.post('/api/workspaces/:id/client-users', requireWorkspaceAccess(), express.json(), validate(createClientUserSchema), async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const invitedBy = req.user?.id;
    const user = await createClientUser(email, password, name, req.params.id, role || 'client_member', invitedBy);
    // Send welcome email to the new client user
    const ws = getWorkspace(req.params.id);
    if (ws) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const dashboardUrl = `${baseUrl}/client/${req.params.id}`;
      notifyClientWelcome({ clientEmail: email, clientName: name, workspaceName: ws.name, workspaceId: req.params.id, dashboardUrl });
    }
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update a client user
router.patch('/api/workspaces/:id/client-users/:userId', requireWorkspaceAccess(), express.json(), validate(updateClientUserSchema), async (req, res) => {
  // NOTE: `requireWorkspaceAccess()` only verifies the caller can access the
  // workspace in `:id`. It does NOT verify that `:userId` belongs to `:id` —
  // that's enforced inside `updateClientUser` by passing `req.params.id` as
  // the expected workspace. Same pattern for the password change + DELETE
  // handlers below. See PR #168 staging-hardening flag (cross-workspace authz).
  try {
    const { name, email, role, avatarUrl } = req.body;
    const user = await updateClientUser(req.params.userId, req.params.id, { name, email, role, avatarUrl });
    if (!user) return res.status(404).json({ error: 'Client user not found' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Change client user password
router.post('/api/workspaces/:id/client-users/:userId/password', requireWorkspaceAccess(), express.json(), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const ok = await changeClientPassword(req.params.userId, req.params.id, password);
    if (!ok) return res.status(404).json({ error: 'Client user not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete a client user
router.delete('/api/workspaces/:id/client-users/:userId', requireWorkspaceAccess(), (req, res) => {
  const ok = deleteClientUser(req.params.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Client user not found' });
  res.json({ ok: true });
});

export default router;
