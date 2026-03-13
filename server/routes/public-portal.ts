/**
 * public-portal routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { hasClientUsers } from '../client-users.js';
import { getGA4TopPages } from '../google-analytics.js';
import { applySuppressionsToAudit } from '../helpers.js';
import { listSnapshots, getLatestSnapshot } from '../reports.js';
import { getAllGscPages } from '../search-console.js';
import { isStripeConfigured, listProducts } from '../stripe.js';
import { updateWorkspace, getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';

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
    analyticsClientView: !!ws.analyticsClientView,
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
    log.error('Error saving responses:', err);
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
  res.json({
    id: latest.id,
    createdAt: latest.createdAt,
    siteName: latest.siteName,
    logoUrl: latest.logoUrl,
    previousScore: latest.previousScore,
    audit: filtered,
    scoreHistory: history.map(h => ({ id: h.id, createdAt: h.createdAt, siteScore: h.siteScore })),
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

export default router;
