/**
 * public-portal routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { validate, z } from '../middleware/validate.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { hasClientUsers, verifyClientToken } from '../client-users.js';
import { getGA4TopPages } from '../google-analytics.js';
import { applySuppressionsToAudit } from '../helpers.js';
import { verifyClientSession } from '../middleware.js';
import { listSnapshots, getLatestSnapshot, getLatestSnapshotBefore } from '../reports.js';
import { getAllGscPages } from '../search-console.js';
import { isStripeConfigured, listProducts } from '../stripe.js';
import { updateWorkspace, getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { addActivity } from '../activity-log.js';
import { debouncedStrategyInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { clearSeoContextCache } from '../seo-context.js';

const log = createLogger('public-portal');

// --- Public Client Dashboard API (no auth required) ---
router.get('/api/public/workspace/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal is disabled for this workspace' });
  // Only expose safe fields for client view
  res.json({
    id: ws.id,
    name: ws.name,
    webflowSiteId: ws.webflowSiteId,
    webflowSiteName: ws.webflowSiteName,
    gscPropertyUrl: ws.gscPropertyUrl,
    ga4PropertyId: ws.ga4PropertyId,
    liveDomain: ws.liveDomain,
    eventConfig: ws.eventConfig || [],
    eventGroups: ws.eventGroups || [],
    requiresPassword: !!ws.clientPassword,
    // Feature toggles
    clientPortalEnabled: ws.clientPortalEnabled != null ? !!ws.clientPortalEnabled : true,
    seoClientView: !!ws.seoClientView,
    analyticsClientView: ws.analyticsClientView != null ? !!ws.analyticsClientView : true,
    siteIntelligenceClientView: ws.siteIntelligenceClientView != null ? !!ws.siteIntelligenceClientView : true,
    // Business profile — safe to expose to client portal
    businessProfile: ws.businessProfile || null,
    autoReports: !!ws.autoReports,
    // Branding
    brandLogoUrl: ws.brandLogoUrl || '',
    brandAccentColor: ws.brandAccentColor || '',
    // Content pricing
    contentPricing: ws.contentPricing || null,
    // Monetization — trial-resolved tier
    tier: (() => {
      let t = ws.tier || 'free';
      if (t === 'free' && ws.trialEndsAt && new Date(ws.trialEndsAt) > new Date()) t = 'growth';
      return t;
    })(),
    baseTier: ws.tier || 'free',
    isTrial: (ws.tier || 'free') === 'free' && !!ws.trialEndsAt && new Date(ws.trialEndsAt) > new Date(),
    trialDaysRemaining: ws.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(ws.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0,
    trialEndsAt: ws.trialEndsAt || null,
    stripeEnabled: isStripeConfigured(),
    // Onboarding
    onboardingEnabled: ws.onboardingEnabled ?? false,
    onboardingCompleted: ws.onboardingCompleted ?? false,
    // Auth mode
    hasClientUsers: hasClientUsers(req.params.id),
  });
});

// Public onboarding questionnaire submission — transforms responses into KB, brand voice, personas
router.post('/api/public/onboarding/:id', async (req, res) => {
  try {
    const ws = getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    // Require a valid client session or client user JWT
    const wsId = req.params.id;
    const sessionToken = req.cookies?.[`client_session_${wsId}`];
    const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
    const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
    const hasClientUserAuth = clientUserToken && verifyClientToken(clientUserToken)?.workspaceId === wsId;
    if (!hasSession && !hasClientUserAuth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { business, audience, brand, competitors } = req.body;

    // 1. Build knowledge base from business info
    const kbParts: string[] = [];
    if (business?.businessName) kbParts.push(`Business Name: ${business.businessName}`);
    if (business?.industry) kbParts.push(`Industry: ${business.industry}`);
    if (business?.description) kbParts.push(`About: ${business.description}`);
    if (business?.services) kbParts.push(`Key Services/Products:\n${business.services}`);
    if (business?.locations) kbParts.push(`Service Locations: ${business.locations}`);
    if (business?.differentiators) kbParts.push(`Differentiators: ${business.differentiators}`);
    if (business?.website) kbParts.push(`Website: ${business.website}`);
    if (competitors?.competitors) kbParts.push(`Competitors:\n${competitors.competitors}`);
    if (competitors?.whatTheyDoBetter) kbParts.push(`Competitor Strengths: ${competitors.whatTheyDoBetter}`);
    if (competitors?.whatYouDoBetter) kbParts.push(`Our Advantages: ${competitors.whatYouDoBetter}`);

    // Merge with existing knowledge base (don't overwrite)
    const existingKb = ws.knowledgeBase || '';
    const onboardingKb = kbParts.join('\n\n');
    const mergedKb = existingKb
      ? `${existingKb}\n\n--- Client Onboarding Responses ---\n${onboardingKb}`
      : onboardingKb;

    // 2. Build brand voice from brand info
    const voiceParts: string[] = [];
    if (brand?.personality?.length) voiceParts.push(`Brand Personality: ${brand.personality.join(', ')}`);
    if (brand?.tone) voiceParts.push(`Tone: ${brand.tone}`);
    if (brand?.avoidWords) voiceParts.push(`Words to Avoid: ${brand.avoidWords}`);
    if (brand?.contentFormats?.length) voiceParts.push(`Preferred Content Formats: ${brand.contentFormats.join(', ')}`);
    if (brand?.existingExamples) voiceParts.push(`Reference Examples:\n${brand.existingExamples}`);

    const existingVoice = ws.brandVoice || '';
    const onboardingVoice = voiceParts.join('\n');
    const mergedVoice = existingVoice
      ? `${existingVoice}\n\n--- Client Onboarding Responses ---\n${onboardingVoice}`
      : onboardingVoice;

    // 3. Build personas from audience info
    const personas = [...(ws.personas || [])];
    if (audience?.primaryAudience || audience?.painPoints || audience?.goals) {
      const primaryPersona = {
        id: `persona_onboard_${Date.now()}`,
        name: audience.primaryAudience?.split(/[,.\n]/)[0]?.trim()?.slice(0, 60) || 'Primary Audience',
        description: audience.primaryAudience || '',
        painPoints: audience.painPoints ? audience.painPoints.split('\n').map((s: string) => s.trim()).filter(Boolean) : [],
        goals: audience.goals ? audience.goals.split('\n').map((s: string) => s.trim()).filter(Boolean) : [],
        objections: audience.objections ? audience.objections.split('\n').map((s: string) => s.trim()).filter(Boolean) : [],
        preferredContentFormat: brand?.contentFormats?.join(', ') || undefined,
        buyingStage: (audience.buyingStage === 'mixed' ? undefined : audience.buyingStage) as 'awareness' | 'consideration' | 'decision' | undefined,
      };
      personas.push(primaryPersona);
    }
    if (audience?.secondaryAudience) {
      const secondaryPersona = {
        id: `persona_onboard2_${Date.now()}`,
        name: audience.secondaryAudience.split(/[,.\n]/)[0]?.trim()?.slice(0, 60) || 'Secondary Audience',
        description: audience.secondaryAudience,
        painPoints: [] as string[],
        goals: [] as string[],
        objections: [] as string[],
      };
      personas.push(secondaryPersona);
    }

    // 4. Save competitor domains if provided
    const competitorDomains = [...(ws.competitorDomains || [])];
    if (competitors?.competitors) {
      const urls = competitors.competitors.split('\n')
        .map((line: string) => {
          const match = line.match(/https?:\/\/([^/\s]+)/);
          return match ? match[1].replace(/^www\./, '') : null;
        })
        .filter(Boolean) as string[];
      for (const d of urls) {
        if (!competitorDomains.includes(d)) competitorDomains.push(d);
      }
    }

    // 5. Update workspace
    updateWorkspace(req.params.id, {
      knowledgeBase: mergedKb,
      brandVoice: mergedVoice,
      personas,
      competitorDomains: competitorDomains.length > 0 ? competitorDomains : ws.competitorDomains,
      onboardingCompleted: true,
    });

    res.json({ ok: true, message: 'Onboarding responses saved successfully' });
  } catch (err) {
    log.error({ err: err }, 'Error saving responses');
    res.status(500).json({ error: 'Failed to save onboarding responses' });
  }
});

// Public tier endpoint — returns effective tier for a workspace
router.get('/api/public/tier/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  let effectiveTier = ws.tier || 'free';
  // If in trial period, treat as growth
  if (effectiveTier === 'free' && ws.trialEndsAt) {
    const trialEnd = new Date(ws.trialEndsAt);
    if (trialEnd > new Date()) effectiveTier = 'growth';
  }

  const trialDaysRemaining = ws.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(ws.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  res.json({
    tier: effectiveTier,
    baseTier: ws.tier || 'free',
    isTrial: effectiveTier === 'growth' && (ws.tier || 'free') === 'free' && trialDaysRemaining > 0,
    trialDaysRemaining,
    trialEndsAt: ws.trialEndsAt || null,
  });
});

// Public pricing endpoint — returns product prices for a workspace
router.get('/api/public/pricing/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const products = listProducts();
  const pricing = ws.contentPricing;
  // Merge per-workspace overrides on top of Stripe product config
  const priceMap: Record<string, { displayName: string; price: number; category: string; enabled: boolean }> = {};
  for (const p of products) {
    priceMap[p.type] = { displayName: p.displayName, price: p.priceUsd, category: p.category, enabled: !!p.stripePriceId };
  }
  // Apply workspace content pricing overrides for brief/post
  if (pricing) {
    for (const key of Object.keys(priceMap)) {
      if (key.startsWith('brief_') && pricing.briefPrice) priceMap[key].price = pricing.briefPrice;
    }
    if (priceMap['post_polished'] && pricing.fullPostPrice) priceMap['post_polished'].price = pricing.fullPostPrice;
  }
  // Bundle definitions
  const bundles = [
    { id: 'content_starter', name: 'Content Starter', monthlyPrice: 500, includes: ['2 content briefs', '1 polished blog post'], savings: 'Save ~15% vs individual pricing' },
    { id: 'content_engine', name: 'Content Engine', monthlyPrice: 1500, includes: ['4 content briefs', '3 polished blog posts', '1 keyword strategy refresh'], savings: 'Save ~25% vs individual pricing' },
    { id: 'full_service', name: 'Full Service SEO', monthlyPrice: 3500, includes: ['Unlimited briefs', '6 polished blog posts', 'Full keyword strategy', 'Schema site-wide', 'Monthly audit'], savings: 'Best value — all-inclusive' },
  ];
  res.json({ products: priceMap, bundles, currency: pricing?.currency || 'USD', stripeEnabled: isStripeConfigured() });
});

router.get('/api/public/audit-summary/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const latest = getLatestSnapshot(ws.webflowSiteId);
  if (!latest) return res.json(null);
  // Apply suppressions so scores exclude suppressed issues
  const filtered = applySuppressionsToAudit(latest.audit, ws.auditSuppressions || []);
  res.json({
    id: latest.id,
    createdAt: latest.createdAt,
    siteScore: filtered.siteScore,
    totalPages: filtered.totalPages,
    errors: filtered.errors,
    warnings: filtered.warnings,
    previousScore: latest.previousScore,
  });
});

router.get('/api/public/audit-detail/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const latest = getLatestSnapshot(ws.webflowSiteId);
  if (!latest) return res.json(null);
  // Apply suppressions so client sees filtered issues and recalculated scores
  const filtered = applySuppressionsToAudit(latest.audit, ws.auditSuppressions || []);
  const history = listSnapshots(ws.webflowSiteId);

  // Compute audit diff against the previous snapshot (what changed since last audit)
  let auditDiff: { resolved: number; newIssues: number } | undefined;
  if (latest.previousScore != null) {
    const prev = getLatestSnapshotBefore(ws.webflowSiteId, latest.id);
    if (prev) {
      const prevFiltered = applySuppressionsToAudit(prev.audit, ws.auditSuppressions || []);
      // Build issue key sets: "check::slug" for each page issue
      const prevKeys = new Set<string>();
      for (const page of prevFiltered.pages) {
        for (const issue of page.issues) prevKeys.add(`${issue.check}::${page.slug}`);
      }
      const currKeys = new Set<string>();
      for (const page of filtered.pages) {
        for (const issue of page.issues) currKeys.add(`${issue.check}::${page.slug}`);
      }
      const resolved = [...prevKeys].filter(k => !currKeys.has(k)).length;
      const newIssues = [...currKeys].filter(k => !prevKeys.has(k)).length;
      auditDiff = { resolved, newIssues };
    }
  }

  res.json({
    id: latest.id,
    createdAt: latest.createdAt,
    siteName: latest.siteName,
    logoUrl: latest.logoUrl,
    previousScore: latest.previousScore,
    audit: filtered,
    scoreHistory: history.map(h => ({ id: h.id, createdAt: h.createdAt, siteScore: h.siteScore })),
    auditDiff,
  });
});

// Client lists their fix orders (public, no auth needed — filtered to fix category only)
// Client-facing audit traffic map (public, by workspaceId)
router.get('/api/public/audit-traffic/:workspaceId', async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.json({});

    const trafficMap: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }> = {};

    if (ws.gscPropertyUrl) {
      try {
        const gscPages = await getAllGscPages(ws.id, ws.gscPropertyUrl, 28);
        for (const p of gscPages) {
          try {
            const pagePath = new URL(p.page).pathname;
            if (!trafficMap[pagePath]) trafficMap[pagePath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
            trafficMap[pagePath].clicks += p.clicks;
            trafficMap[pagePath].impressions += p.impressions;
          } catch { /* skip malformed URLs */ }
        }
      } catch { /* GSC unavailable */ }
    }

    if (ws.ga4PropertyId) {
      try {
        const ga4Pages = await getGA4TopPages(ws.ga4PropertyId, 28, 500);
        for (const p of ga4Pages) {
          const pagePath = p.path.startsWith('/') ? p.path : `/${p.path}`;
          if (!trafficMap[pagePath]) trafficMap[pagePath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
          trafficMap[pagePath].pageviews += p.pageviews;
          trafficMap[pagePath].sessions += p.users;
        }
      } catch { /* GA4 unavailable */ }
    }

    res.json(trafficMap);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Client Keyword Feedback ──────────────────────────

// Client: list their keyword feedback
router.get('/api/public/keyword-feedback/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const rows = db.prepare('SELECT keyword, status, reason, source, created_at, updated_at FROM keyword_feedback WHERE workspace_id = ? ORDER BY updated_at DESC').all(ws.id);
  res.json(rows);
});

// Client: submit keyword feedback (approve/decline)
router.post('/api/public/keyword-feedback/:workspaceId', (req, res) => {
  const wsId = req.params.workspaceId;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const clientPayload = clientUserToken ? verifyClientToken(clientUserToken) : null;
  const hasClientUserAuth = clientPayload?.workspaceId === wsId;
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keyword, status, reason, source } = req.body;
  if (!keyword || !status || !['approved', 'declined', 'requested'].includes(status)) {
    return res.status(400).json({ error: 'keyword and status (approved|declined|requested) required' });
  }
  const kw = keyword.toLowerCase().trim();
  const declinedBy = clientPayload?.email || 'client';

  db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `).run(ws.id, kw, status, reason || null, source || 'content_gap', declinedBy);

  log.info(`Client keyword feedback: "${kw}" → ${status} for workspace ${ws.id}`);
  res.json({ keyword: kw, status, reason: reason || null });
});

// Client: bulk feedback
router.post('/api/public/keyword-feedback/:workspaceId/bulk', (req, res) => {
  const wsId = req.params.workspaceId;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const clientPayload = clientUserToken ? verifyClientToken(clientUserToken) : null;
  const hasClientUserAuth = clientPayload?.workspaceId === wsId;
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keywords } = req.body;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: 'keywords array required' });
  }
  const declinedBy = clientPayload?.email || 'client';

  const stmt = db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `);

  const insert = db.transaction((items: { keyword: string; status: string; reason?: string; source?: string }[]) => {
    for (const item of items) {
      if (!item.keyword || !['approved', 'declined', 'requested'].includes(item.status)) continue;
      stmt.run(ws.id, item.keyword.toLowerCase().trim(), item.status, item.reason || null, item.source || 'content_gap', declinedBy);
    }
  });
  insert(keywords);
  log.info(`Client bulk keyword feedback: ${keywords.length} keywords for workspace ${ws.id}`);
  res.json({ updated: keywords.length });
});

// ── Client Business Priorities ──────────────────────────
// Clients can share their business priorities which get injected into future strategy generations

router.get('/api/public/business-priorities/:workspaceId', (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // Load from db
  const row = db.prepare('SELECT priorities, updated_at FROM client_business_priorities WHERE workspace_id = ?').get(wsId) as { priorities: string; updated_at: string } | undefined;
  if (!row) return res.json({ priorities: [], updatedAt: null });

  const priorities = parseJsonFallback(row.priorities, []);
  res.json({ priorities, updatedAt: row.updated_at });
});

router.post('/api/public/business-priorities/:workspaceId', (req, res) => {
  const wsId = req.params.workspaceId;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const clientPayload = clientUserToken ? verifyClientToken(clientUserToken) : null;
  const hasClientUserAuth = clientPayload?.workspaceId === wsId;
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { priorities } = req.body as { priorities: { text: string; category: string }[] };
  if (!Array.isArray(priorities)) return res.status(400).json({ error: 'priorities must be an array' });

  // Validate and sanitize
  const clean = priorities
    .filter(p => p.text && typeof p.text === 'string')
    .slice(0, 10) // Max 10 priorities
    .map(p => ({
      text: p.text.trim().slice(0, 500),
      category: ['growth', 'brand', 'product', 'audience', 'competitive', 'other'].includes(p.category) ? p.category : 'other',
    }));

  // Upsert into db
  db.prepare(`
    INSERT INTO client_business_priorities (workspace_id, priorities, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(workspace_id) DO UPDATE SET
      priorities = excluded.priorities,
      updated_at = datetime('now')
  `).run(wsId, JSON.stringify(clean));

  // Also inject a summary into workspace businessContext so it's available for AI prompts
  if (clean.length > 0) {
    const priorityText = clean.map(p => `[${p.category}] ${p.text}`).join('; ');
    const existingContext = ws.keywordStrategy?.businessContext || '';
    const marker = '\n--- CLIENT PRIORITIES ---\n';
    const base = existingContext.includes(marker)
      ? existingContext.split(marker)[0]
      : existingContext;
    const newContext = `${base}${marker}${priorityText}`;

    if (ws.keywordStrategy) {
      updateWorkspace(wsId, { keywordStrategy: { ...ws.keywordStrategy, businessContext: newContext } });
      // Bridge #3: business priorities updated — immediate flush + debounced defense-in-depth
      clearSeoContextCache(wsId);
      invalidateIntelligenceCache(wsId);
      debouncedStrategyInvalidate(wsId, () => {
        invalidateIntelligenceCache(wsId);
        invalidateSubCachePrefix(wsId, 'slice:seoContext');
      });
    }
  }

  log.info(`Client submitted ${clean.length} business priorities for workspace ${wsId}`);
  res.json({ saved: clean.length });
});

// ── Business Profile (client-facing PATCH) ─────────────────────
// Allows client portal users to update their verified business data

const clientBusinessProfileSchema = z.object({
  phone: z.string().max(30).optional(),
  email: z.string().email().or(z.literal('')).optional(),
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

router.patch('/api/public/workspaces/:id/business-profile', validate(clientBusinessProfileSchema), (req, res) => {
  const wsId = req.params.id;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const hasClientUserAuth = clientUserToken && (verifyClientToken(clientUserToken)?.workspaceId === wsId);
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const existing = getWorkspace(wsId);
  if (!existing) return res.status(404).json({ error: 'Workspace not found' });
  const existingProfile = existing.businessProfile ?? {};
  const mergedProfile = {
    ...existingProfile,
    ...req.body,
    // Deep-merge address sub-object so partial address PATCHes don't wipe sibling fields
    ...(req.body.address !== undefined
      ? { address: { ...(existingProfile.address ?? {}), ...req.body.address } }
      : {}),
  };
  const ws = updateWorkspace(wsId, { businessProfile: mergedProfile });
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  broadcastToWorkspace(wsId, 'workspace:updated', { businessProfile: ws.businessProfile });
  addActivity(wsId, 'client_profile_updated', 'Client updated business profile', 'Via client portal');
  log.info(`Client updated business profile for workspace ${wsId}`);
  res.json({ businessProfile: ws.businessProfile });
});

// ── Content Gap Voting ──────────────────────────
// Clients can upvote content gaps to signal priority

router.post('/api/public/content-gap-vote/:workspaceId', (req, res) => {
  const wsId = req.params.workspaceId;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const clientPayload = clientUserToken ? verifyClientToken(clientUserToken) : null;
  const hasClientUserAuth = clientPayload?.workspaceId === wsId;
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { keyword, vote } = req.body as { keyword: string; vote: 'up' | 'down' | 'none' };
  if (!keyword || !['up', 'down', 'none'].includes(vote)) {
    return res.status(400).json({ error: 'keyword and vote (up/down/none) required' });
  }

  const kw = keyword.toLowerCase().trim();

  if (vote === 'none') {
    db.prepare('DELETE FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?').run(wsId, kw);
  } else {
    db.prepare(`
      INSERT INTO content_gap_votes (workspace_id, keyword, vote, voted_by, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(workspace_id, keyword) DO UPDATE SET
        vote = excluded.vote,
        voted_by = excluded.voted_by,
        updated_at = datetime('now')
    `).run(wsId, kw, vote, clientPayload?.email || 'client');
  }

  res.json({ ok: true });
});

router.get('/api/public/content-gap-votes/:workspaceId', (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const rows = db.prepare('SELECT keyword, vote FROM content_gap_votes WHERE workspace_id = ?').all(wsId) as { keyword: string; vote: string }[];
  const votes: Record<string, string> = {};
  for (const r of rows) votes[r.keyword] = r.vote;
  res.json({ votes });
});

export default router;
