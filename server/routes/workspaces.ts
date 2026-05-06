/**
 * workspaces routes — extracted from server/index.ts
 *
 * @reads workspaces, approvals, requests, content_requests, work_orders, content_matrices, client_signals, churn_signals, workspace_pages, page_states, client_users, audit_suppressions
 * @writes workspaces, page_states, client_users, audit_suppressions, activities, bridge_invalidation, workspace_page_cache
 */
import { Router } from 'express';

const router = Router();

import bcrypt from 'bcryptjs';
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
import { applySuppressionsToAudit } from '../helpers.js';
import { callAI } from '../ai.js';
import { parseAIJson } from '../openai-helpers.js';
import { getLatestSnapshot } from '../reports.js';
import { listRequests } from '../requests.js';
import { invalidatePageCache } from '../workspace-data.js';
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
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';
import {
  startWorkspaceContextGenerationJob,
  workspaceContextJobErrorResponse,
} from '../workspace-context-generation-job.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const log = createLogger('workspaces');

const MEMBER_RESTRICTED_WORKSPACE_FIELDS = new Set([
  'webflowSiteId',
  'webflowSiteName',
  'webflowToken',
  'liveDomain',
  'gscPropertyUrl',
  'ga4PropertyId',
  'publishTarget',
  'seoDataProvider',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'billingMode',
  'tier',
  'trialEndsAt',
]);

function hasMemberRestrictedWorkspaceUpdate(updates: Record<string, unknown>): boolean {
  return Object.keys(updates).some(key => MEMBER_RESTRICTED_WORKSPACE_FIELDS.has(key));
}

// Workspaces
function listVisibleWorkspaces(req: express.Request): Workspace[] {
  const workspaces = listWorkspaces();
  if (!req.user || req.user.role === 'owner') return workspaces;
  const allowed = new Set(req.user.workspaceIds ?? []);
  return workspaces.filter(ws => allowed.has(ws.id));
}

router.get('/api/workspaces', (req, res) => {
  const workspaces = listVisibleWorkspaces(req).map(ws => ({ ...ws, webflowToken: undefined, clientPassword: undefined, hasPassword: !!ws.clientPassword }));
  res.json(workspaces);
});

// Workspace overview: aggregated metrics for all workspaces
router.get('/api/workspace-overview', (req, res) => {
  const workspaces = listVisibleWorkspaces(req);
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
    const inProgressContentReqs = contentReqs.filter(r => ['brief_generated', 'client_review', 'approved', 'in_progress', 'post_review'].includes(r.status)).length;
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
  if (req.user && req.user.role !== 'owner' && hasMemberRestrictedWorkspaceUpdate(updates)) {
    return res.status(403).json({ error: 'Owner access is required to update workspace integration settings' });
  }
  // When unlinking, clear the token too
  if (updates.webflowSiteId === null || updates.webflowSiteId === '') {
    updates.webflowToken = '';
    updates.liveDomain = '';
  }
  // Validate billingMode to one of the typed values; reject garbage at the boundary
  // rather than relying on rowToWorkspace normalization to swallow it.
  if ('billingMode' in updates && updates.billingMode !== 'platform' && updates.billingMode !== 'external') {
    return res.status(400).json({ error: "billingMode must be 'platform' or 'external'" });
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
    } catch (err) {
      // url-fetch-ok: best-effort live domain resolution
      if (isProgrammingError(err)) log.warn({ err }, 'workspaces: PATCH /api/workspaces/:id: programming error');
    }
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

    const result = await callAI({
      model: 'gpt-5.4-mini',
      feature: 'intelligence-profile-autofill',
      workspaceId: ws.id,
      temperature: 0.3,  // low temperature for consistent JSON output
      maxTokens: 300,    // response is a small JSON object
      system: 'You are a business analyst. Based on the website context provided, infer the business profile. Respond with ONLY valid JSON — no markdown, no explanation.',
      messages: [
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

// --- Legacy aliases: BrandHub now starts these through /api/jobs; keep these routes as job-start compatibility shims. ---
// --- Auto-generate knowledge base from website crawl ---
router.post('/api/workspaces/:id/generate-knowledge-base', requireWorkspaceAccess(), async (req, res) => {
  try {
    const started = startWorkspaceContextGenerationJob(BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, req.params.id);
    res.json(started);
  } catch (err) {
    const response = workspaceContextJobErrorResponse(err);
    res.status(response.status).json(response.body);
  }
});

// --- Auto-generate brand voice from website crawl ---
router.post('/api/workspaces/:id/generate-brand-voice', requireWorkspaceAccess(), async (req, res) => {
  try {
    const started = startWorkspaceContextGenerationJob(BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, req.params.id);
    res.json(started);
  } catch (err) {
    const response = workspaceContextJobErrorResponse(err);
    res.status(response.status).json(response.body);
  }
});

// --- Auto-generate audience personas from website crawl ---
router.post('/api/workspaces/:id/generate-personas', requireWorkspaceAccess(), async (req, res) => {
  try {
    const started = startWorkspaceContextGenerationJob(BACKGROUND_JOB_TYPES.PERSONA_GENERATION, req.params.id);
    res.json(started);
  } catch (err) {
    const response = workspaceContextJobErrorResponse(err);
    res.status(response.status).json(response.body);
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
