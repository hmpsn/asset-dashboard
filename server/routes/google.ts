/**
 * google routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { listGA4Properties } from '../google-analytics.js';
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
import { IS_PROD } from '../middleware.js';
import { callOpenAI } from '../openai-helpers.js';
import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchDevices,
  fetchSearchCountries,
  fetchSearchTypes,
  fetchSearchComparison,
} from '../analytics-data.js';
import {
  listGscSites,
} from '../search-console.js';
import { RICH_BLOCKS_PROMPT } from '../seo-context.js';
import { buildWorkspaceIntelligence, formatForPrompt, formatPageMapForPrompt } from '../workspace-intelligence.js';
import { listWorkspaces } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { createAnnotation, getAnnotations, updateAnnotation, deleteAnnotation } from '../analytics-annotations.js';
import { validate, z } from '../middleware/validate.js';

const log = createLogger('google-auth');

// --- Google Search Console / GA4 ---
router.get('/api/google/status/:siteId', (req, res) => {
  const creds = getGoogleCredentials();
  res.json({
    configured: !!creds,
    connected: isConnected(req.params.siteId),
  });
});

// --- Global Google Auth (configure once, use everywhere) ---
router.get('/api/google/auth-url', (_req, res) => {
  const url = getGlobalAuthUrl();
  if (!url) return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  res.json({ url });
});

router.get('/api/google/status', (_req, res) => {
  res.json({ connected: isGlobalConnected(), configured: !!getGoogleCredentials() });
});

router.post('/api/google/disconnect', (_req, res) => {
  disconnectGlobal();
  res.json({ success: true });
});

router.get('/api/google/gsc-sites', async (_req, res) => {
  try {
    const token = await getGlobalToken();
    if (!token) return res.status(401).json({ error: 'Google not connected' });
    const sites = await listGscSites(GLOBAL_KEY);
    res.json(sites);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Legacy per-site auth (kept for backward compat)
router.get('/api/google/auth-url/:siteId', (req, res) => {
  const url = getAuthUrl(req.params.siteId);
  if (!url) return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  res.json({ url });
});

router.get('/api/google/callback', async (req, res) => {
  // Google may redirect back with an error instead of a code
  const error = req.query.error as string;
  if (error) {
    log.error(`OAuth error from Google: ${error}`);
    return res.status(400).send(`Google auth error: ${error}. Check your OAuth consent screen and API settings in Google Cloud Console.`);
  }
  const code = req.query.code as string;
  const siteId = req.query.state as string;
  log.info(`Callback received, code=${code ? 'present' : 'missing'}, siteId=${siteId || 'missing'}`);
  if (!code || !siteId) return res.status(400).send('Missing code or state');
  const result = await exchangeCode(code, siteId);
  if (result.success) {
    // Redirect back to the app
    const redirectUrl = IS_PROD ? '/' : 'http://localhost:5173/';
    res.redirect(`${redirectUrl}?google=connected&siteId=${siteId}`);
  } else {
    res.status(500).send(`Google auth failed: ${result.error}`);
  }
});

router.post('/api/google/disconnect/:siteId', (req, res) => {
  disconnect(req.params.siteId);
  res.json({ success: true });
});

// GA4 Analytics
router.get('/api/google/ga4-properties', async (_req, res) => {
  try {
    const properties = await listGA4Properties();
    res.json(properties);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/google/gsc-sites/:siteId', async (req, res) => {
  try {
    const sites = await listGscSites(req.params.siteId);
    res.json(sites);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post('/api/google/search-chat/:siteId', async (req, res) => {
  const { question, context, workspaceId } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  // Look up workspace for keyword strategy context
  const wsId = workspaceId || listWorkspaces().find(w => w.webflowSiteId === req.params.siteId)?.id;
  const slices = ['seoContext', 'learnings'] as const;
  const intel = wsId ? await buildWorkspaceIntelligence(wsId, { slices }) : null;
  const fullContext = intel ? formatForPrompt(intel, { verbosity: 'detailed', sections: slices }) : '';
  const kwMapContext = intel ? formatPageMapForPrompt(intel.seoContext) : '';
  const bizCtx = intel?.seoContext?.businessContext ?? '';

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

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.7,
      maxTokens: 1500,
      feature: 'search-chat',
      workspaceId: wsId,
    });

    res.json({ answer: aiResult.text || 'No response generated.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/google/search-overview/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    const overview = await fetchSearchOverview(req.params.siteId, gscSiteUrl, days);
    res.json(overview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/google/performance-trend/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    const trend = await fetchPerformanceTrend(req.params.siteId, gscSiteUrl, days);
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/google/search-devices/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchDevices(req.params.siteId, gscSiteUrl, days));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/google/search-countries/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  const limit = parseInt(req.query.limit as string) || 20;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchCountries(req.params.siteId, gscSiteUrl, days, limit));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/google/search-types/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchTypes(req.params.siteId, gscSiteUrl, days));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/google/search-comparison/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    res.json(await fetchSearchComparison(req.params.siteId, gscSiteUrl, days));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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

router.get('/api/google/annotations/:workspaceId', (req, res) => {
  try {
    const { startDate, endDate, category } = req.query as { startDate?: string; endDate?: string; category?: string };
    const annotations = getAnnotations(req.params.workspaceId, { startDate, endDate, category });
    res.json(annotations);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/api/google/annotations/:workspaceId', validate(createAnnotationSchema), (req, res) => {
  const { date, label, category, createdBy, pageUrl } = req.body;
  try {
    const result = createAnnotation({ workspaceId: req.params.workspaceId, date, label, category, createdBy, pageUrl });
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

router.patch('/api/google/annotations/:workspaceId/:id', validate(updateAnnotationSchema), (req, res) => {
  const { label, date, category, pageUrl } = req.body;
  try {
    const updated = updateAnnotation(req.params.id, req.params.workspaceId, { label, date, category, pageUrl });
    if (!updated) return res.status(404).json({ error: 'Annotation not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/api/google/annotations/:workspaceId/:id', (req, res) => {
  try {
    const deleted = deleteAnnotation(req.params.id, req.params.workspaceId);
    if (!deleted) return res.status(404).json({ error: 'Annotation not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Analytics annotations on a separate path to avoid shadowing the existing
// /api/public/annotations/:workspaceId route in annotations.ts
router.get('/api/public/analytics-annotations/:workspaceId', (req, res) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const annotations = getAnnotations(req.params.workspaceId, { startDate, endDate });
    res.json(annotations);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
