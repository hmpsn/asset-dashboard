/**
 * public-portal routes — extracted from server/index.ts
 *
 * @reads workspaces, snapshots, keyword_feedback, client_business_priorities, content_gap_votes, copy_sections, briefing_store, recommendations, stripe_products, search_console, google_analytics
 * @writes workspaces, keyword_feedback, rank_tracking_config, client_business_priorities, content_gap_votes, copy_sections, client_suggestions, activities, intelligence_cache
 */
import { Router, type RequestHandler } from 'express';

const router = Router();

import { validate, z } from '../middleware/validate.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { hasClientUsers, verifyClientToken } from '../client-users.js';
import { requireAuthenticatedClientPortalAuth, requireClientPortalAuth, verifyClientSession } from '../middleware.js';

import { getLatestSnapshotBefore } from '../reports.js';
import { getEffectiveAudit, getLatestEffectiveSnapshot, listEffectiveSnapshotSummaries } from '../audit-snapshot-views.js';
import { getAuditTrafficForWorkspace } from '../audit-traffic.js';
import { isStripeConfigured, listProducts } from '../stripe.js';
import { updateWorkspace, getWorkspace, computeEffectiveTier } from '../workspaces.js';
import { buildBriefingClientView } from '../briefing-client-projection.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { parseJsonSafeArray } from '../db/json-validation.js';
import { addActivity } from '../activity-log.js';
import { debouncedStrategyInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { getBookingUrl } from '../studio-config.js';
import { listBlueprints } from '../page-strategy.js';
import {
  clearKeywordFeedback,
  listPublicKeywordFeedback,
  notifyKeywordFeedbackChanged,
  saveBulkKeywordFeedback,
  saveKeywordFeedback,
} from '../keyword-feedback.js';
import { getSection, getSectionsForEntry, getEntryCopyStatus, updateSectionStatus, addClientSuggestion } from '../copy-review.js';
import {
  CLIENT_BUSINESS_PRIORITIES_MARKER,
  clientBusinessPrioritiesBodySchema,
  clientBusinessPrioritySchema,
  type ClientBusinessPrioritiesBody,
} from '../schemas/client-business-priorities.js';
import {
  bulkKeywordFeedbackSchema,
  contentGapVoteSchema,
  keywordFeedbackSchema,
  type BulkKeywordFeedbackBody,
  type ContentGapVoteBody,
  type KeywordFeedbackBody,
} from '../schemas/keyword-feedback.js';
import { isProgrammingError } from '../errors.js';
import { normalizeSocialProfiles } from '../social-profiles.js';
import { computeTrialState } from '../billing/trial-state.js';
import { toPublicWorkspaceView } from '../serializers/client-safe.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { getVoiceProfile } from '../voice-calibration.js';
import type {
  BusinessPrioritiesConflictResponse,
  BusinessPrioritiesResponse,
  BusinessPrioritiesSaveResponse,
} from '../../shared/types/business-priorities.js';

const log = createLogger('public-portal');

const requireClientStrategyMutationAuth: RequestHandler = (req, res, next) => {
  const wsId = req.params.workspaceId;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const clientPayload = clientUserToken ? verifyClientToken(clientUserToken) : null;
  const hasClientUserAuth = clientPayload?.workspaceId === wsId;
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.locals.clientEmail = clientPayload?.email;
  next();
};

// --- Public Client Dashboard API (no auth required) ---
router.get('/api/public/workspace/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal is disabled for this workspace' });
  res.json(toPublicWorkspaceView(ws, {
    stripeEnabled: isStripeConfigured(),
    hasClientUsers: hasClientUsers(req.params.id),
    bookingUrl: getBookingUrl() ?? null,
  }));
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

    // 5. Update workspace — route brand voice through authority chain
    const voiceProfile = getVoiceProfile(req.params.id);
    const voiceProfileIsAuthoritative = voiceProfile?.status === 'calibrated';
    const updates: Record<string, unknown> = {
      knowledgeBase: voiceProfileIsAuthoritative
        ? `${mergedKb}\n\n--- Brand Voice (from onboarding) ---\n${onboardingVoice}`
        : mergedKb,
      personas,
      competitorDomains: competitorDomains.length > 0 ? competitorDomains : ws.competitorDomains,
      onboardingCompleted: true,
    };
    if (!voiceProfileIsAuthoritative) {
      updates.brandVoice = mergedVoice;
    } else {
      log.info({ workspaceId: req.params.id }, 'Voice profile is calibrated — onboarding brand voice data folded into knowledgeBase instead of brandVoice');
    }
    updateWorkspace(req.params.id, updates);

    // client-visibility-ok: onboarding completion is internal audit history, not client timeline content.
    addActivity(wsId, 'client_onboarding_submitted', 'Client completed onboarding questionnaire', 'Via client portal');
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

  const effectiveTier = computeEffectiveTier(ws);
  const trialState = computeTrialState(ws);

  res.json({
    tier: effectiveTier,
    baseTier: ws.tier || 'free',
    isTrial: trialState.isTrial,
    trialDaysRemaining: trialState.trialDaysRemaining,
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
      if (key.startsWith('brief_') && typeof pricing.briefPrice === 'number') priceMap[key].price = pricing.briefPrice;
    }
    if (priceMap['post_polished'] && typeof pricing.fullPostPrice === 'number') priceMap['post_polished'].price = pricing.fullPostPrice;
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
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const latest = getLatestEffectiveSnapshot(ws.webflowSiteId, ws.auditSuppressions || []);
  if (!latest) return res.json(null);
  const filtered = latest.audit;
  res.json({
    id: latest.id,
    createdAt: latest.createdAt,
    siteScore: filtered.siteScore,
    totalPages: filtered.totalPages,
    errors: filtered.errors,
    warnings: filtered.warnings,
    infos: filtered.infos,
    previousScore: latest.previousScore,
  });
});

router.get('/api/public/audit-detail/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const latest = getLatestEffectiveSnapshot(ws.webflowSiteId, ws.auditSuppressions || []);
  if (!latest) return res.json(null);
  const filtered = latest.audit;
  const history = listEffectiveSnapshotSummaries(ws.webflowSiteId, ws.auditSuppressions || []);
  const previousScore = latest.previousScore;

  // Compute audit diff against the previous snapshot (what changed since last audit)
  let auditDiff: { resolved: number; newIssues: number } | undefined;
  if (previousScore != null) {
    const prev = getLatestSnapshotBefore(ws.webflowSiteId, latest.id);
    if (prev) {
      const prevFiltered = getEffectiveAudit(prev.audit, ws.auditSuppressions || []);
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
    previousScore,
    audit: filtered,
    scoreHistory: history.map(h => ({ id: h.id, createdAt: h.createdAt, siteScore: h.siteScore, errors: h.errors, warnings: h.warnings })),
    auditDiff,
  });
});

// Client lists their fix orders (public, no auth needed — filtered to fix category only)
// Client-facing audit traffic map. requireAuthenticatedClientPortalAuth so
// passwordless workspaces also require real auth — see global gate caveat
// in server/app.ts:262.
router.get('/api/public/audit-traffic/:workspaceId', requireAuthenticatedClientPortalAuth(), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'workspace not found' });
    const trafficMap = await getAuditTrafficForWorkspace(ws);
    res.json(trafficMap);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'public-portal: GET /api/public/audit-traffic/:workspaceId: programming error'); // url-fetch-ok
    else log.debug({ err }, 'public-portal: audit-traffic endpoint failed — degrading gracefully');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Client Keyword Feedback ──────────────────────────

// Client: list their keyword feedback
router.get('/api/public/keyword-feedback/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json(listPublicKeywordFeedback(ws.id));
});

// Client: submit keyword feedback (approve/decline)
router.post('/api/public/keyword-feedback/:workspaceId', requireClientStrategyMutationAuth, validate(keywordFeedbackSchema), (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keyword, status, reason, source } = req.body as KeywordFeedbackBody;
  const declinedBy = typeof res.locals.clientEmail === 'string' ? res.locals.clientEmail : 'client';

  const { response, trackedKeyword } = saveKeywordFeedback({
    workspaceId: ws.id,
    keyword,
    status,
    reason,
    source,
    declinedBy,
  });

  if (trackedKeyword) {
    broadcastToWorkspace(ws.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
      keyword: trackedKeyword,
      action: 'feedback_approved',
      source: 'client_feedback',
    });
  }

  log.info(`Client keyword feedback: "${response.keyword}" → ${status} for workspace ${ws.id}`);
  notifyKeywordFeedbackChanged(ws.id, {
    keyword: response.keyword,
    status: response.status,
    source: response.source,
  });
  // client-visibility-ok: this activity is for internal audit history, not client timeline display.
  addActivity(wsId, 'client_keyword_feedback', `Client gave ${status} feedback on keyword: ${response.keyword}`, 'Via client portal');
  res.json(response);
});

// Client: bulk feedback
router.post('/api/public/keyword-feedback/:workspaceId/bulk', requireClientStrategyMutationAuth, validate(bulkKeywordFeedbackSchema), (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keywords } = req.body as BulkKeywordFeedbackBody;
  const declinedBy = typeof res.locals.clientEmail === 'string' ? res.locals.clientEmail : 'client';
  const { response, trackedKeywords } = saveBulkKeywordFeedback({
    workspaceId: ws.id,
    keywords,
    declinedBy,
  });
  log.info(`Client bulk keyword feedback: ${keywords.length} keywords for workspace ${ws.id}`);
  notifyKeywordFeedbackChanged(ws.id, { updated: response.updated });
  if (trackedKeywords.length > 0) {
    broadcastToWorkspace(ws.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
      action: 'feedback_bulk_approved',
      source: 'client_feedback',
      keywords: trackedKeywords,
      count: trackedKeywords.length,
    });
  }
  // client-visibility-ok: this activity is for internal audit history, not client timeline display.
  addActivity(wsId, 'client_keyword_feedback', `Client gave bulk keyword feedback (${keywords.length} keywords)`, 'Via client portal');
  res.json(response);
});

// Client: remove keyword feedback so a previously removed/restored keyword returns to neutral.
// broadcast-ok: notifyKeywordFeedbackChanged broadcasts strategy/signal invalidation after real feedback deletes.
router.delete('/api/public/keyword-feedback/:workspaceId', (req, res) => {
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

  const rawKeyword =
    typeof req.query.keyword === 'string'
      ? req.query.keyword
      : typeof req.body?.keyword === 'string'
        ? req.body.keyword
        : '';
  const keyword = keywordComparisonKey(rawKeyword);
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  const result = clearKeywordFeedback(ws.id, keyword);
  if (!result.existed) return res.json(result);

  log.info(`Client keyword feedback removed: "${keyword}" for workspace ${ws.id} (was ${result.previousStatus})`);
  notifyKeywordFeedbackChanged(ws.id, {
    keyword: result.deleted,
    status: 'cleared',
    previousStatus: result.previousStatus,
    source: result.source,
  });
  // client-visibility-ok: this activity is for internal audit history, not client timeline display.
  addActivity(wsId, 'client_keyword_feedback', `Client removed keyword feedback: ${keyword} (was ${result.previousStatus})`, 'Via client portal');
  res.json(result);
});

// ── Client Business Priorities ──────────────────────────
// Clients can share their business priorities which get injected into future strategy generations

interface ClientBusinessPrioritiesRow {
  priorities: string;
  updated_at: string;
}

function normalizeClientBusinessPrioritiesRow(
  wsId: string,
  row: ClientBusinessPrioritiesRow | undefined,
): BusinessPrioritiesResponse {
  if (!row) return { priorities: [], updatedAt: null };
  const priorities = parseJsonSafeArray(
    row.priorities,
    clientBusinessPrioritySchema,
    { workspaceId: wsId, field: 'priorities', table: 'client_business_priorities' },
  ).map(priority => {
    if (typeof priority === 'string') {
      return { text: priority.trim(), category: 'other' };
    }
    return {
      text: priority.text.trim(),
      category: priority.category?.trim() || 'other',
    };
  }).filter(priority => priority.text.length > 0);
  return { priorities, updatedAt: row.updated_at };
}

router.get('/api/public/business-priorities/:workspaceId', (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const row = db.prepare('SELECT priorities, updated_at FROM client_business_priorities WHERE workspace_id = ?').get(wsId) as ClientBusinessPrioritiesRow | undefined;
  res.json(normalizeClientBusinessPrioritiesRow(wsId, row));
});

router.post('/api/public/business-priorities/:workspaceId', requireClientStrategyMutationAuth, validate(clientBusinessPrioritiesBodySchema), (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { priorities, expectedUpdatedAt } = req.body as ClientBusinessPrioritiesBody;
  const existingRow = db.prepare('SELECT priorities, updated_at FROM client_business_priorities WHERE workspace_id = ?').get(wsId) as ClientBusinessPrioritiesRow | undefined;
  const existing = normalizeClientBusinessPrioritiesRow(wsId, existingRow);
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== existing.updatedAt) {
    const response: BusinessPrioritiesConflictResponse = {
      error: 'Business priorities changed. Please refresh and try again.',
      priorities: existing.priorities,
      updatedAt: existing.updatedAt,
    };
    return res.status(409).json(response);
  }
  const clean = priorities.map(p => ({
    text: p.text,
    category: p.category,
  }));
  const updatedAt = new Date().toISOString();

  // Upsert into db
  db.prepare(`
    INSERT INTO client_business_priorities (workspace_id, priorities, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      priorities = excluded.priorities,
      updated_at = excluded.updated_at
  `).run(wsId, JSON.stringify(clean), updatedAt);

  // Also inject a summary into workspace businessContext so it's available for AI prompts
  if (ws.keywordStrategy) {
    const existingContext = ws.keywordStrategy.businessContext || '';
    const base = existingContext.includes(CLIENT_BUSINESS_PRIORITIES_MARKER)
      ? existingContext.split(CLIENT_BUSINESS_PRIORITIES_MARKER)[0]
      : existingContext;
    const priorityText = clean.map(p => `[${p.category}] ${p.text}`).join('; ');
    const businessContext = priorityText
      ? `${base}${CLIENT_BUSINESS_PRIORITIES_MARKER}${priorityText}`
      : base;

    updateWorkspace(wsId, { keywordStrategy: { ...ws.keywordStrategy, businessContext } });
  }
  // Bridge #3: business priorities updated — immediate flush + debounced
  // defense-in-depth. Priorities are also read directly by clientSignals, so
  // this must run even before a workspace has a keywordStrategy blob.
  invalidateIntelligenceCache(wsId);
  debouncedStrategyInvalidate(wsId, () => {
    invalidateIntelligenceCache(wsId);
    invalidateSubCachePrefix(wsId, 'slice:seoContext');
    invalidateSubCachePrefix(wsId, 'slice:clientSignals');
  });

  log.info(`Client submitted ${clean.length} business priorities for workspace ${wsId}`);
  broadcastToWorkspace(wsId, WS_EVENTS.STRATEGY_UPDATED, { businessPriorities: clean });
  // client-visibility-ok: business-priority edits are internal strategy signals, not client timeline content.
  addActivity(wsId, 'client_priorities_updated', `Client updated business priorities (${clean.length} items)`, 'Via client portal');
  const response: BusinessPrioritiesSaveResponse = { saved: clean.length, priorities: clean, updatedAt };
  res.json(response);
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
  socialProfiles: z.array(z.string().url().or(z.literal(''))).max(10).optional(),
  openingHours: z.string().max(500).optional(),
  foundedDate: z.string().max(20).optional(),
  numberOfEmployees: z.string().max(50).optional(),
});

router.patch('/api/public/workspaces/:id/business-profile', (req, res) => {
  const wsId = req.params.id;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const hasClientUserAuth = clientUserToken && (verifyClientToken(clientUserToken)?.workspaceId === wsId);
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const parsed = clientBusinessProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
  }

  const existing = getWorkspace(wsId);
  if (!existing) return res.status(404).json({ error: 'Workspace not found' });
  const existingProfile = existing.businessProfile ?? {};
  const normalizedSocialProfiles = normalizeSocialProfiles(parsed.data.socialProfiles);
  const mergedProfile = {
    ...existingProfile,
    ...parsed.data,
    ...(normalizedSocialProfiles !== undefined ? { socialProfiles: normalizedSocialProfiles } : {}),
    // Deep-merge address sub-object so partial address PATCHes don't wipe sibling fields
    ...(parsed.data.address !== undefined
      ? { address: { ...(existingProfile.address ?? {}), ...parsed.data.address } }
      : {}),
  };
  const ws = updateWorkspace(wsId, { businessProfile: mergedProfile });
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // businessProfile feeds into workspace-intelligence.ts (base.businessProfile → AI prompts).
  // Flush caches immediately so AI chat/strategy use the updated data.
  invalidateIntelligenceCache(wsId);
  broadcastToWorkspace(wsId, WS_EVENTS.WORKSPACE_UPDATED, { businessProfile: ws.businessProfile });
  // client-visibility-ok: business-profile edits are internal audit history, not client timeline content.
  addActivity(wsId, 'client_profile_updated', 'Client updated business profile', 'Via client portal');
  log.info(`Client updated business profile for workspace ${wsId}`);
  res.json({ businessProfile: ws.businessProfile });
});

// ── Content Gap Voting ──────────────────────────
// Clients can upvote content gaps to signal priority

router.post('/api/public/content-gap-vote/:workspaceId', requireClientStrategyMutationAuth, validate(contentGapVoteSchema), (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { keyword, vote } = req.body as ContentGapVoteBody;
  const kw = keywordComparisonKey(keyword);

  // The two write paths below (DELETE for "clear" + INSERT/UPDATE for
  // "set") are mutually exclusive — only one runs per request — but the
  // multi-step-txn rule scans by line proximity and can't know that.
  // Wrapping the if/else in a single db.transaction() satisfies the rule
  // AND adds defence-in-depth: any future expansion of either branch
  // (e.g. an audit-log INSERT) inherits atomicity automatically.
  const recordVote = db.transaction(() => {
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
      `).run(wsId, kw, vote, typeof res.locals.clientEmail === 'string' ? res.locals.clientEmail : 'client');
    }
  });
  recordVote();

  broadcastToWorkspace(wsId, WS_EVENTS.STRATEGY_UPDATED, { keyword: kw, vote });
  // client-visibility-ok: this activity is for internal audit history, not client timeline display.
  addActivity(wsId, 'client_content_gap_vote', `Client voted ${vote} on keyword: ${kw}`, 'Via client portal');
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

// ── Client Copy Review ──────────────────────────
// Lets clients review, approve, and suggest edits on generated copy.

/** Strip internal-only fields (aiReasoning, steeringHistory, qualityFlags, workspaceId) from a CopySection before returning to client. */
function toClientSection(s: { id: string; entryId: string; sectionPlanItemId: string; generatedCopy: string | null; status: string; aiAnnotation: string | null; clientSuggestions: unknown; version: number; createdAt: string; updatedAt: string }) {
  return {
    id: s.id,
    entryId: s.entryId,
    sectionPlanItemId: s.sectionPlanItemId,
    generatedCopy: s.generatedCopy,
    status: s.status,
    aiAnnotation: s.aiAnnotation,
    clientSuggestions: s.clientSuggestions,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

const copySuggestionSchema = z.object({
  originalText: z.string().trim().min(1, 'originalText is required').max(5000),
  suggestedText: z.string().trim().min(1, 'suggestedText is required').max(5000),
}).strict();

const requireClientCopyReviewAuth: RequestHandler = (req, res, next) => {
  const wsId = req.params.workspaceId;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const hasClientUserAuth = clientUserToken && verifyClientToken(clientUserToken)?.workspaceId === wsId;
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// List blueprint entries with their copy status
router.get('/api/public/copy/:workspaceId/entries', requireClientPortalAuth(), (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal is disabled for this workspace' });

  const blueprints = listBlueprints(wsId);
  const entries: { id: string; name: string; pageType: string; blueprintId: string; blueprintName: string; copyStatus: ReturnType<typeof getEntryCopyStatus> }[] = [];
  for (const bp of blueprints) {
    if (!bp.entries) continue;
    for (const entry of bp.entries) {
      const copyStatus = getEntryCopyStatus(entry.id, wsId);
      // Only include entries that have sections actually visible to the client
      if (copyStatus.clientReviewSections > 0 || copyStatus.approvedSections > 0) {
        entries.push({
          id: entry.id,
          name: entry.name,
          pageType: entry.pageType,
          blueprintId: bp.id,
          blueprintName: bp.name,
          copyStatus,
        });
      }
    }
  }

  res.json({ entries });
});

// Get sections for an entry (only client_review or approved — no drafts)
router.get('/api/public/copy/:workspaceId/entry/:entryId/sections', requireClientPortalAuth(), (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal is disabled for this workspace' });

  const sections = getSectionsForEntry(req.params.entryId, wsId);
  // Only return sections visible to clients (in review or approved)
  const clientVisible = sections
    .filter(s => s.status === 'client_review' || s.status === 'approved')
    .map(s => ({
      id: s.id,
      entryId: s.entryId,
      sectionPlanItemId: s.sectionPlanItemId,
      generatedCopy: s.generatedCopy,
      status: s.status,
      aiAnnotation: s.aiAnnotation,
      // Omit aiReasoning — internal only
      clientSuggestions: s.clientSuggestions,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

  res.json({ sections: clientVisible });
});

// Client approves a section
router.post('/api/public/copy/:workspaceId/section/:sectionId/approve', requireClientCopyReviewAuth, (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal is disabled for this workspace' });

  const { sectionId } = req.params;

  // Pre-check: only client_review sections can be approved via the client portal.
  // The general state machine allows draft→approved (for admin use), but the
  // client portal must enforce the agency-sends-for-review workflow.
  const existing = getSection(sectionId, wsId);
  if (!existing || existing.status !== 'client_review') {
    return res.status(400).json({ error: 'Could not approve section. It may not be in a reviewable state.' });
  }

  const section = updateSectionStatus(sectionId, wsId, 'approved');
  if (!section) {
    return res.status(400).json({ error: 'Could not approve section. It may not be in a reviewable state.' });
  }

  broadcastToWorkspace(wsId, WS_EVENTS.COPY_SECTION_UPDATED, { sectionId, status: section.status });
  // client-visibility-ok: copy review actions update the copy UI directly; activity is internal audit history.
  addActivity(wsId, 'copy_approved', `Client approved copy section`, 'Via client portal');
  log.info({ wsId, sectionId }, 'Client approved copy section');
  // Strip internal-only fields before returning to client
  res.json({ section: toClientSection(section) });
});

// Client suggests an edit on a section
router.post('/api/public/copy/:workspaceId/section/:sectionId/suggest', requireClientCopyReviewAuth, validate(copySuggestionSchema), (req, res) => {
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal is disabled for this workspace' });

  const { sectionId } = req.params;
  const { originalText, suggestedText } = req.body;

  // Only client_review sections accept suggestions via the client portal
  const existing = getSection(sectionId, wsId);
  if (!existing || existing.status !== 'client_review') {
    return res.status(400).json({ error: 'Section is not in a reviewable state.' });
  }

  const section = addClientSuggestion(sectionId, wsId, {
    originalText,
    suggestedText,
  });
  if (!section) {
    return res.status(400).json({ error: 'Could not add suggestion. Section not found.' });
  }

  broadcastToWorkspace(wsId, WS_EVENTS.COPY_SECTION_UPDATED, { sectionId, status: section.status });
  // client-visibility-ok: copy review actions update the copy UI directly; activity is internal audit history.
  addActivity(wsId, 'copy_suggestion_added', `Client suggested copy edit`, 'Via client portal');
  log.info({ wsId, sectionId }, 'Client suggested copy edit');
  // Strip internal-only fields before returning to client
  res.json({ section: toClientSection(section) });
});

// ── Client Briefing (Phase 1b) ────────────────────────────────────────────
// GET /api/public/briefing/:workspaceId — latest published briefing for the
// client portal. Tier-gated: free → 402. Returns { briefing: null } when no
// briefing has been published yet (paid tier with cron not yet run).
//
// admin-only fields (sourceMetadata, adminNote) are intentionally stripped —
// only weekOf, publishedAt, and the BriefingStory[] array reach the client.
// Enrichment logic lives in server/briefing-client-projection.ts.
router.get('/api/public/briefing/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) {
    return res.status(403).json({ error: 'Client portal is disabled for this workspace' });
  }

  // Trial-aware effective tier — shared helper used by /workspace/:id and /tier/:id too.
  if (computeEffectiveTier(ws) === 'free') {
    return res.status(402).json({ error: 'Briefing requires Growth or Premium tier' });
  }

  const briefing = buildBriefingClientView(ws.id);
  res.json({ briefing });
});

export default router;
