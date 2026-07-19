/**
 * google routes — extracted from server/index.ts
 */
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { MODEL_ROLES } from '../model-manifest.js';

const router = Router();

import {
  getGA4Countries,
  getGA4Conversions,
  getGA4DailyTrend,
  getGA4DeviceBreakdown,
  getGA4LandingPages,
  getGA4NewVsReturning,
  getGA4OrganicOverview,
  getGA4Overview,
  getGA4PeriodComparison,
  getGA4TopPages,
  getGA4TopSources,
  listGA4Properties,
} from '../google-analytics.js';
import {
  getAuthUrl,
  exchangeCode,
  isConnected,
  disconnect,
  getGoogleCredentials,
  getGlobalAuthUrl,
  isGlobalConnected,
  disconnectGlobal,
  getGlobalToken,
  GLOBAL_KEY,
} from '../google-auth.js';
import { IS_PROD, requireClientPortalAuth } from '../middleware.js';
import { callAI } from '../ai.js';
import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchDevices,
  fetchSearchCountries,
  fetchSearchTypes,
  fetchSearchComparison,
  fetchBrandedDemandSplit,
} from '../analytics-data.js';
import {
  gscDateRange,
  listGscSites,
} from '../search-console.js';
import { extractBrandTokens } from '../competitor-brand-filter.js';
import { RICH_BLOCKS_PROMPT } from '../prompt-rich-blocks.js';
import { buildSeoPromptContext } from '../intelligence/generation-context-builders.js';
import { getWorkspace, getWorkspaceBySiteId, listWorkspaces } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { createAnnotation, getAnnotations, updateAnnotation, deleteAnnotation } from '../analytics-annotations.js';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess, requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery, sendWorkspaceAccessDenied } from '../auth.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { parsePositiveIntQuery } from '../query-param-parsers.js';
import { sanitizeProviderError, sendSanitizedProviderError } from '../provider-error-sanitizer.js';
import { parseDateRangeStrict } from '../utils/request-validation.js';
import { invalidateMonthlyDigestCache } from '../monthly-digest-cache.js';
import { clearIntelligenceCache } from '../intelligence/cache-clear.js';

const log = createLogger('google-auth');

function invalidateGoogleDependentWorkspaces(siteId?: string, explicitWorkspaceId?: string): void {
  const candidates = explicitWorkspaceId
    ? [getWorkspace(explicitWorkspaceId)].filter((ws): ws is NonNullable<typeof ws> => Boolean(ws))
    : siteId && siteId !== GLOBAL_KEY
      ? [getWorkspaceBySiteId(siteId)].filter((ws): ws is NonNullable<typeof ws> => Boolean(ws))
      : listWorkspaces().filter(ws => Boolean(ws.gscPropertyUrl || ws.ga4PropertyId));

  for (const ws of candidates) {
    invalidateMonthlyDigestCache(ws.id);
    clearIntelligenceCache(ws.id);
    broadcastToWorkspace(ws.id, WS_EVENTS.WORKSPACE_UPDATED, {
      googleConnectionChanged: true,
    });
  }
}

type AdminAnalyticsWindow = {
  days: number;
  dateRange?: import('../google-analytics.js').CustomDateRange;
};

function parseAdminAnalyticsWindow(req: Request, res: Response): AdminAnalyticsWindow | null {
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) {
    res.status(400).json({ error: 'days must be a positive integer' });
    return null;
  }
  const parsed = parseDateRangeStrict(req.query);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return null;
  }
  return { days, dateRange: parsed.dateRange };
}

function previousGscDateRange(days: number, dateRange?: import('../google-analytics.js').CustomDateRange) {
  const current = gscDateRange(days, dateRange);
  const start = new Date(`${current.startDate}T00:00:00.000Z`);
  const end = new Date(`${current.endDate}T00:00:00.000Z`);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - spanDays + 1);
  return {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate: prevEnd.toISOString().slice(0, 10),
  };
}

function stringQuery(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function workspaceBrandTokens(workspaceId: string | undefined, fallbackUrl: string): string[] {
  const tokens = new Set<string>();
  const workspace = workspaceId ? getWorkspace(workspaceId) : null;
  // Derive brand tokens only from the domain / Webflow site name / GSC property URL,
  // each run through extractBrandTokens (protocol/TLD strip + dot/hyphen split → brand
  // stem). We deliberately do NOT tokenize the human-friendly workspace.name by
  // whitespace: a name like "Acme Dental" would add the generic industry noun "dental"
  // as a brand token, and isBrandedQuery would then count a genuinely non-branded query
  // ("dental implants near me") as branded — systematically inflating the branded-demand
  // share for every workspace whose name contains an industry word. The domain is the
  // higher-signal, lower-false-positive brand source.
  for (const source of [workspace?.liveDomain, workspace?.webflowSiteName, fallbackUrl]) {
    if (!source) continue;
    for (const token of extractBrandTokens(source)) tokens.add(token);
  }
  return [...tokens];
}

function sendGoogleProviderError(
  res: import('express').Response,
  err: unknown,
  message: string,
  fallback: string,
  source: 'google' | 'gsc' | 'ga4' | 'ai' = 'google',
): void {
  log.error({ err }, message);
  sendSanitizedProviderError(res, { source, fallback });
}

const requireWorkspaceGscPropertyAccess: RequestHandler = (req, res, next) => {
  const rawWorkspaceId = req.query.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId) ? rawWorkspaceId[0] : rawWorkspaceId;
  const rawGscSiteUrl = req.query.gscSiteUrl;
  const gscSiteUrl = Array.isArray(rawGscSiteUrl) ? rawGscSiteUrl[0] : rawGscSiteUrl;

  if (typeof workspaceId !== 'string' || typeof gscSiteUrl !== 'string') {
    if (!req.user || req.user.role === 'owner') {
      next();
      return;
    }
    sendWorkspaceAccessDenied(res);
    return;
  }

  const workspace = getWorkspace(workspaceId);
  if (workspace?.gscPropertyUrl !== gscSiteUrl) {
    sendWorkspaceAccessDenied(res);
    return;
  }

  next();
};

// --- Google Search Console / GA4 ---
router.get('/api/google/status/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const creds = getGoogleCredentials();
  res.json({
    configured: !!creds,
    connected: isConnected(req.params.siteId),
  });
});

// --- Global Google Auth (configure once, use everywhere) ---
router.get('/api/google/auth-url', requireAdminAuth, (_req, res) => {
  const url = getGlobalAuthUrl();
  if (!url) return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  res.json({ url });
});

router.get('/api/google/status', requireAdminAuth, (_req, res) => {
  res.json({ connected: isGlobalConnected(), configured: !!getGoogleCredentials() });
});

router.post('/api/google/disconnect', requireAdminAuth, (_req, res) => {
  disconnectGlobal();
  invalidateGoogleDependentWorkspaces(GLOBAL_KEY);
  res.json({ success: true });
});

router.get('/api/google/gsc-sites', requireAdminAuth, async (_req, res) => {
  try {
    const token = await getGlobalToken();
    if (!token) return res.status(401).json({ error: 'Google not connected' });
    const sites = await listGscSites(GLOBAL_KEY);
    res.json(sites);
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to list global GSC sites', 'Unable to load Search Console sites. Please reconnect Google or try again.', 'gsc');
  }
});

// Legacy per-site auth (kept for backward compat)
router.get('/api/google/auth-url/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const url = getAuthUrl(req.params.siteId);
  if (!url) return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  res.json({ url });
});

router.get('/api/google/callback', async (req, res) => {
  // Google may redirect back with an error instead of a code
  const error = req.query.error as string;
  if (error) {
    log.error({ error }, 'OAuth error from Google callback');
    return res.status(400).send('Google auth error. Check your OAuth consent screen and API settings in Google Cloud Console.');
  }
  const code = req.query.code as string;
  const siteId = req.query.state as string;
  log.info(`Callback received, code=${code ? 'present' : 'missing'}, siteId=${siteId || 'missing'}`);
  if (!code || !siteId) return res.status(400).send('Missing code or state');
  const result = await exchangeCode(code, siteId);
  if (result.success) {
    invalidateGoogleDependentWorkspaces(siteId);
    // Redirect back to the app
    const redirectUrl = IS_PROD ? '/' : 'http://localhost:5173/';
    res.redirect(`${redirectUrl}?google=connected&siteId=${siteId}`);
  } else {
    log.error({ error: result.error }, 'Google OAuth code exchange failed');
    res.status(500).send(sanitizeProviderError({
      source: 'google',
      fallback: 'Google auth failed. Please reconnect Google and try again.',
    }));
  }
});

router.post('/api/google/disconnect/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), (req, res) => {
  disconnect(req.params.siteId);
  invalidateGoogleDependentWorkspaces(req.params.siteId, req.body.workspaceId);
  res.json({ success: true });
});

// GA4 Analytics
router.get('/api/google/ga4-properties', requireAdminAuth, async (_req, res) => {
  try {
    const properties = await listGA4Properties();
    res.json(properties);
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to list GA4 properties', 'Unable to load GA4 properties. Please reconnect Google or try again.', 'ga4');
  }
});

router.get('/api/google/gsc-sites/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const sites = await listGscSites(req.params.siteId);
    res.json(sites);
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to list site GSC properties', 'Unable to load Search Console sites. Please reconnect Google or try again.', 'gsc');
  }
});

router.post('/api/google/search-chat/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  const { question, context, workspaceId } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  // Look up workspace for keyword strategy context
  const wsId = workspaceId || getWorkspaceBySiteId(req.params.siteId)?.id;
  const seoPrompt = wsId ? await buildSeoPromptContext(wsId) : null;
  const fullContext = seoPrompt?.promptContext ?? '';
  const kwMapContext = seoPrompt?.pageMapContext ?? '';
  const bizCtx = seoPrompt?.intelligence.seoContext?.businessContext ?? '';

  try {
    const strategySection = (fullContext || kwMapContext || bizCtx)
      ? `\n\nKEYWORD STRATEGY CONTEXT (use this to give strategic, keyword-aware answers):${fullContext}${kwMapContext}${bizCtx ? `\nBusiness: ${bizCtx}` : ''}`
      : '';

    const systemPrompt = `You are an expert SEO analyst embedded in a search analytics dashboard. The user is a website owner or client asking about their Google Search Console data.

You have access to their real search data which is provided as context. Give specific, actionable, data-driven answers. Reference actual queries, pages, and numbers from their data. Be concise but thorough. Use markdown formatting.

When giving recommendations:
- Be specific about which queries/pages to optimize
- Explain the "why" behind recommendations
- Prioritize by potential impact
- Suggest concrete next steps
- If keyword strategy data is available, reference their target keywords and suggest alignment improvements
- Identify gaps between what they're ranking for and what they should be targeting
${strategySection}
${RICH_BLOCKS_PROMPT}
Current search data context:
${JSON.stringify(context, null, 2)}`;

    const aiResult = await callAI({
      model: MODEL_ROLES.structuredSynthesis,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
      temperature: 0.7,
      maxTokens: 1500,
      feature: 'search-chat',
      workspaceId: wsId,
    });

    res.json({ answer: aiResult.text || 'No response generated.' });
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to generate search chat answer', 'Unable to generate a search answer right now. Please try again.', 'ai');
  }
});

router.get('/api/google/search-overview/:siteId', requireWorkspaceSiteAccessFromQuery(), requireWorkspaceGscPropertyAccess, async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const window = parseAdminAnalyticsWindow(req, res);
  if (!window) return;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    const overview = await fetchSearchOverview(req.params.siteId, gscSiteUrl, window.days, window.dateRange);
    const workspaceId = stringQuery(req.query.workspaceId);
    const brandTokens = workspaceBrandTokens(workspaceId, gscSiteUrl);
    const brandedDemand = await fetchBrandedDemandSplit(
      req.params.siteId,
      gscSiteUrl,
      window.days,
      brandTokens,
      window.dateRange,
    ).catch((err) => {
      log.warn({ err, siteId: req.params.siteId, workspaceId }, 'Failed to compute branded demand split');
      return {
        status: 'error' as const,
        denominator: 'impressions' as const,
        error: 'Unable to compute branded demand split. Search overview data is still shown.',
      };
    });
    res.json({ ...overview, brandedDemand });
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch search overview', 'Unable to load Search Console overview. Please try again.', 'gsc');
  }
});

router.get('/api/google/performance-trend/:siteId', requireWorkspaceSiteAccessFromQuery(), requireWorkspaceGscPropertyAccess, async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const window = parseAdminAnalyticsWindow(req, res);
  if (!window) return;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    const trendRange = req.query.previous === 'true'
      ? previousGscDateRange(window.days, window.dateRange)
      : window.dateRange;
    const trend = await fetchPerformanceTrend(req.params.siteId, gscSiteUrl, window.days, trendRange);
    res.json(trend);
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch performance trend', 'Unable to load Search Console trend. Please try again.', 'gsc');
  }
});

router.get('/api/google/search-devices/:siteId', requireWorkspaceSiteAccessFromQuery(), requireWorkspaceGscPropertyAccess, async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const window = parseAdminAnalyticsWindow(req, res);
  if (!window) return;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchDevices(req.params.siteId, gscSiteUrl, window.days, window.dateRange));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch search devices', 'Unable to load Search Console devices. Please try again.', 'gsc');
  }
});

router.get('/api/google/search-countries/:siteId', requireWorkspaceSiteAccessFromQuery(), requireWorkspaceGscPropertyAccess, async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const window = parseAdminAnalyticsWindow(req, res);
  if (!window) return;
  const limit = parsePositiveIntQuery(req.query.limit, 20);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchCountries(req.params.siteId, gscSiteUrl, window.days, limit, window.dateRange));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch search countries', 'Unable to load Search Console countries. Please try again.', 'gsc');
  }
});

router.get('/api/google/search-types/:siteId', requireWorkspaceSiteAccessFromQuery(), requireWorkspaceGscPropertyAccess, async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const window = parseAdminAnalyticsWindow(req, res);
  if (!window) return;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchTypes(req.params.siteId, gscSiteUrl, window.days, window.dateRange));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch search types', 'Unable to load Search Console search types. Please try again.', 'gsc');
  }
});

router.get('/api/google/search-comparison/:siteId', requireWorkspaceSiteAccessFromQuery(), requireWorkspaceGscPropertyAccess, async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const window = parseAdminAnalyticsWindow(req, res);
  if (!window) return;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchComparison(req.params.siteId, gscSiteUrl, window.days, window.dateRange));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch search comparison', 'Unable to load Search Console comparison. Please try again.', 'gsc');
  }
});

// ── Admin GA4 Analytics ───────────────────────────────────────────

function getAdminGa4Property(workspaceId: string, res: import('express').Response): string | null {
  const ws = getWorkspace(workspaceId);
  if (!ws?.ga4PropertyId) {
    res.status(400).json({ error: 'GA4 not configured' });
    return null;
  }
  return ws.ga4PropertyId;
}

router.get('/api/google/analytics-overview/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4Overview(propertyId, days));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 overview', 'Unable to load GA4 overview. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-trend/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4DailyTrend(propertyId, days));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 trend', 'Unable to load GA4 trend. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-top-pages/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4TopPages(propertyId, days, 200));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 top pages', 'Unable to load GA4 top pages. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-sources/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4TopSources(propertyId, days, 10));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 sources', 'Unable to load GA4 sources. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-devices/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4DeviceBreakdown(propertyId, days));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 devices', 'Unable to load GA4 devices. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-countries/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4Countries(propertyId, days, 10));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 countries', 'Unable to load GA4 countries. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-comparison/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4PeriodComparison(propertyId, days));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 comparison', 'Unable to load GA4 comparison. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-new-vs-returning/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4NewVsReturning(propertyId, days));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 new vs returning', 'Unable to load GA4 new vs returning. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-organic/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4OrganicOverview(propertyId, days));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 organic', 'Unable to load GA4 organic overview. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-landing-pages/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  const limit = parsePositiveIntQuery(req.query.limit, 25);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  const organicOnly = req.query.organic === 'true';
  try {
    res.json(await getGA4LandingPages(propertyId, days, limit, organicOnly));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 landing pages', 'Unable to load GA4 landing pages. Please try again.', 'ga4');
  }
});

router.get('/api/google/analytics-conversions/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const propertyId = getAdminGa4Property(req.params.workspaceId, res);
  if (!propertyId) return;
  const days = parsePositiveIntQuery(req.query.days, 28);
  if (days == null) return res.status(400).json({ error: 'days must be a positive integer' });
  try {
    res.json(await getGA4Conversions(propertyId, days));
  } catch (err) {
    sendGoogleProviderError(res, err, 'Failed to fetch GA4 conversions', 'Unable to load GA4 conversions. Please try again.', 'ga4');
  }
});

// ── Analytics Annotations ─────────────────────────────────────────

const createAnnotationSchema = z.object({
  date: z.string().min(1, 'date is required'),
  label: z.string().min(1, 'label is required'),
  category: z.string().min(1, 'category is required'),
  createdBy: z.string().optional(),
  pageUrl: z.string().optional(),
});

router.get('/api/google/annotations/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { startDate, endDate, category } = req.query as { startDate?: string; endDate?: string; category?: string };
    const annotations = getAnnotations(req.params.workspaceId, { startDate, endDate, category });
    res.json(annotations);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/api/google/annotations/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createAnnotationSchema), (req, res) => {
  const { date, label, category, createdBy, pageUrl } = req.body;
  try {
    const result = createAnnotation({ workspaceId: req.params.workspaceId, date, label, category, createdBy, pageUrl });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.ANNOTATION_BRIDGE_CREATED, {
      id: result.id,
      action: 'created',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const updateAnnotationSchema = z.object({
  label: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  pageUrl: z.string().optional(),
});

router.patch('/api/google/annotations/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), validate(updateAnnotationSchema), (req, res) => {
  const { label, date, category, pageUrl } = req.body;
  try {
    const updated = updateAnnotation(req.params.id, req.params.workspaceId, { label, date, category, pageUrl });
    if (!updated) return res.status(404).json({ error: 'Annotation not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.ANNOTATION_BRIDGE_CREATED, {
      id: req.params.id,
      action: 'updated',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/api/google/annotations/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const deleted = deleteAnnotation(req.params.id, req.params.workspaceId);
    if (!deleted) return res.status(404).json({ error: 'Annotation not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.ANNOTATION_BRIDGE_CREATED, {
      id: req.params.id,
      action: 'deleted',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Analytics annotations on a separate path to avoid shadowing the existing
// /api/public/annotations/:workspaceId route in annotations.ts
router.get('/api/public/analytics-annotations/:workspaceId', requireClientPortalAuth(), (req, res) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const annotations = getAnnotations(req.params.workspaceId, { startDate, endDate });
    res.json(annotations);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
