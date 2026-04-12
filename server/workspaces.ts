import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getUploadRoot as _getUploadRoot, getOptRoot as _getOptRoot } from './data-dir.js';
import db from './db/index.js';

const UPLOAD_ROOT = _getUploadRoot();
const OPT_ROOT = _getOptRoot();

export type {
  EventGroup, EventDisplayConfig, PageKeywordMap, KeywordGapItem,
  ContentGap, QuickWin, KeywordStrategy, PageEditStatus, PageEditState,
  AudiencePersona, Workspace,
} from '../shared/types/workspace.ts';
import type { PageEditStatus, PageEditState, Workspace, KeywordStrategy } from '../shared/types/workspace.ts';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  eventDisplayConfigSchema, eventGroupSchema,
  keywordStrategySchema,
  contentPricingSchema, portalContactSchema, auditSuppressionSchema,
  publishTargetSchema, businessProfileSchema, audiencePersonaSchema, intelligenceProfileSchema,
} from './schemas/workspace-schemas.js';
import { scoringConfigOverrideSchema } from './schemas/outcome-schemas.js';
import { z } from 'zod';

// ── Brand name resolution ──

/**
 * Resolve the brand/company name for a workspace.
 * Priority: ws.name (user-set) > webflowSiteName (Webflow API name, stripped of "Copy of" prefix).
 * This prevents Webflow's internal naming ("Copy of Faros AI") from leaking into AI-generated content.
 */
export function getBrandName(ws: Pick<Workspace, 'name' | 'webflowSiteName'> | null | undefined): string {
  if (!ws) return '';
  // User-set workspace name is the canonical business/brand name
  if (ws.name) return ws.name;
  // Fallback to Webflow site name, but strip "Copy of " prefix
  if (ws.webflowSiteName) return ws.webflowSiteName.replace(/^copy\s+of\s+/i, '');
  return '';
}

// ── Prepared statements (lazy) ──

interface WorkspaceRow {
  id: string;
  name: string;
  folder: string;
  webflow_site_id: string | null;
  webflow_site_name: string | null;
  webflow_token: string | null;
  gsc_property_url: string | null;
  ga4_property_id: string | null;
  client_password: string | null;
  client_email: string | null;
  live_domain: string | null;
  event_config: string | null;
  event_groups: string | null;
  keyword_strategy: string | null;
  competitor_domains: string | null;
  competitor_last_fetched_at: string | null;
  personas: string | null;
  client_portal_enabled: number;
  seo_client_view: number;
  analytics_client_view: number;
  site_intelligence_client_view: number | null;
  auto_reports: number;
  auto_report_frequency: string | null;
  brand_voice: string | null;
  knowledge_base: string | null;
  rewrite_playbook: string | null;
  brand_logo_url: string | null;
  brand_accent_color: string | null;
  tier: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  onboarding_enabled: number;
  onboarding_completed: number;
  content_pricing: string | null;
  portal_contacts: string | null;
  audit_suppressions: string | null;
  publish_target: string | null;
  business_profile: string | null;
  seo_data_provider: string | null;
  scoring_config: string | null;
  intelligence_profile: string | null;
  business_priorities: string | null;
  custom_prompt_notes: string | null;
  created_at: string;
}

interface PageEditRow {
  workspace_id: string;
  page_id: string;
  slug: string | null;
  status: string;
  audit_issues: string | null;
  fields: string | null;
  source: string | null;
  approval_batch_id: string | null;
  content_request_id: string | null;
  work_order_id: string | null;
  recommendation_id: string | null;
  rejection_note: string | null;
  updated_at: string;
  updated_by: string | null;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  const ws: Workspace = {
    id: row.id,
    name: row.name,
    folder: row.folder,
    createdAt: row.created_at,
  };
  if (row.webflow_site_id) ws.webflowSiteId = row.webflow_site_id;
  if (row.webflow_site_name) ws.webflowSiteName = row.webflow_site_name;
  if (row.webflow_token) ws.webflowToken = row.webflow_token;
  if (row.gsc_property_url) ws.gscPropertyUrl = row.gsc_property_url;
  if (row.ga4_property_id) ws.ga4PropertyId = row.ga4_property_id;
  if (row.client_password) ws.clientPassword = row.client_password;
  if (row.client_email) ws.clientEmail = row.client_email;
  if (row.live_domain) ws.liveDomain = row.live_domain;
  if (row.event_config) ws.eventConfig = parseJsonSafeArray(row.event_config, eventDisplayConfigSchema, { workspaceId: row.id, field: 'event_config', table: 'workspaces' });
  if (row.event_groups) ws.eventGroups = parseJsonSafeArray(row.event_groups, eventGroupSchema, { workspaceId: row.id, field: 'event_groups', table: 'workspaces' });
  if (row.keyword_strategy) {
    const ks = parseJsonSafe(row.keyword_strategy, keywordStrategySchema, null, { workspaceId: row.id, field: 'keyword_strategy', table: 'workspaces' });
    ws.keywordStrategy = (ks ?? { siteKeywords: [], pageMap: [], opportunities: [], generatedAt: '' }) as unknown as KeywordStrategy;
  }
  if (row.competitor_domains) ws.competitorDomains = parseJsonSafeArray(row.competitor_domains, z.string(), { workspaceId: row.id, field: 'competitor_domains', table: 'workspaces' });
  ws.competitorLastFetchedAt = row.competitor_last_fetched_at ?? null;
  if (row.personas) ws.personas = parseJsonSafeArray(row.personas, audiencePersonaSchema, { workspaceId: row.id, field: 'personas', table: 'workspaces' });
  if (row.client_portal_enabled !== null) ws.clientPortalEnabled = !!row.client_portal_enabled;
  if (row.seo_client_view !== null) ws.seoClientView = !!row.seo_client_view;
  if (row.analytics_client_view !== null) ws.analyticsClientView = !!row.analytics_client_view;
  if (row.site_intelligence_client_view !== null) ws.siteIntelligenceClientView = !!row.site_intelligence_client_view;
  if (row.auto_reports !== null) ws.autoReports = !!row.auto_reports;
  if (row.auto_report_frequency) ws.autoReportFrequency = row.auto_report_frequency as 'weekly' | 'monthly';
  if (row.brand_voice) ws.brandVoice = row.brand_voice;
  if (row.knowledge_base) ws.knowledgeBase = row.knowledge_base;
  if (row.rewrite_playbook) ws.rewritePlaybook = row.rewrite_playbook;
  if (row.brand_logo_url) ws.brandLogoUrl = row.brand_logo_url;
  if (row.brand_accent_color) ws.brandAccentColor = row.brand_accent_color;
  if (row.tier) ws.tier = row.tier as 'free' | 'growth' | 'premium';
  if (row.trial_ends_at) ws.trialEndsAt = row.trial_ends_at;
  if (row.stripe_customer_id) ws.stripeCustomerId = row.stripe_customer_id;
  if (row.stripe_subscription_id) ws.stripeSubscriptionId = row.stripe_subscription_id;
  if (row.onboarding_enabled !== null) ws.onboardingEnabled = !!row.onboarding_enabled;
  if (row.onboarding_completed !== null) ws.onboardingCompleted = !!row.onboarding_completed;
  if (row.content_pricing) ws.contentPricing = parseJsonSafe(row.content_pricing, contentPricingSchema, { briefPrice: 0, fullPostPrice: 0, currency: 'USD' }, { workspaceId: row.id, field: 'content_pricing', table: 'workspaces' });
  if (row.portal_contacts) ws.portalContacts = parseJsonSafeArray(row.portal_contacts, portalContactSchema, { workspaceId: row.id, field: 'portal_contacts', table: 'workspaces' });
  if (row.audit_suppressions) ws.auditSuppressions = parseJsonSafeArray(row.audit_suppressions, auditSuppressionSchema, { workspaceId: row.id, field: 'audit_suppressions', table: 'workspaces' });
  if (row.publish_target) {
    const pt = parseJsonSafe(row.publish_target, publishTargetSchema, null, { workspaceId: row.id, field: 'publish_target', table: 'workspaces' });
    if (pt) ws.publishTarget = pt;
  }
  if (row.seo_data_provider) ws.seoDataProvider = row.seo_data_provider as 'semrush' | 'dataforseo';
  if (row.business_profile) {
    const bp = parseJsonSafe(row.business_profile, businessProfileSchema, null, { workspaceId: row.id, field: 'business_profile', table: 'workspaces' });
    if (bp) ws.businessProfile = bp;
  }
  if (row.scoring_config) {
    ws.scoringConfig = parseJsonSafe(row.scoring_config, scoringConfigOverrideSchema, {}, { workspaceId: row.id, field: 'scoring_config', table: 'workspaces' }) as Workspace['scoringConfig'];
  }
  if (row.intelligence_profile) {
    const ip = parseJsonSafe(row.intelligence_profile, intelligenceProfileSchema, null, { workspaceId: row.id, field: 'intelligence_profile', table: 'workspaces' });
    if (ip) ws.intelligenceProfile = ip;
  }
  // Use loose != null (not !==) so undefined (column not yet in DB before migration 049) is also excluded,
  // preserving the "undefined = enabled by default" intent until migration 049 lands in Group 3.
  if (row.site_intelligence_client_view != null) ws.siteIntelligenceClientView = !!row.site_intelligence_client_view;
  if (row.business_priorities) ws.businessPriorities = parseJsonSafeArray(row.business_priorities, z.string(), { workspaceId: row.id, field: 'business_priorities', table: 'workspaces' });
  if (row.custom_prompt_notes) ws.customPromptNotes = row.custom_prompt_notes;
  return ws;
}

/** Attach pageEditStates from the page_edit_states table. */
function attachPageStates(ws: Workspace): Workspace {
  const pageRows = stmts().listPageEditStates.all(ws.id) as PageEditRow[];
  if (pageRows.length > 0) {
    const states: Record<string, PageEditState> = {};
    for (const r of pageRows) {
      states[r.page_id] = {
        pageId: r.page_id,
        slug: r.slug ?? undefined,
        status: r.status as PageEditStatus,
        auditIssues: r.audit_issues ? parseJsonSafeArray(r.audit_issues, z.string(), { workspaceId: ws.id, field: 'audit_issues', table: 'page_edit_states' }) : undefined,
        fields: r.fields ? parseJsonSafeArray(r.fields, z.string(), { workspaceId: ws.id, field: 'fields', table: 'page_edit_states' }) : undefined,
        source: r.source as PageEditState['source'] ?? undefined,
        approvalBatchId: r.approval_batch_id ?? undefined,
        contentRequestId: r.content_request_id ?? undefined,
        workOrderId: r.work_order_id ?? undefined,
        recommendationId: r.recommendation_id ?? undefined,
        rejectionNote: r.rejection_note ?? undefined,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by as PageEditState['updatedBy'] ?? undefined,
      };
    }
    ws.pageEditStates = states;
  }
  return ws;
}

// -- Lazy prepared statements --

const stmts = createStmtCache(() => ({
  listAll: db.prepare(`SELECT * FROM workspaces`),
  getById: db.prepare<[id: string]>(`SELECT * FROM workspaces WHERE id = ?`),
  getBySiteId: db.prepare<[siteId: string]>(`SELECT * FROM workspaces WHERE webflow_site_id = ?`),
  insert: db.prepare(`
    INSERT INTO workspaces
      (id, name, folder, webflow_site_id, webflow_site_name, webflow_token,
       gsc_property_url, ga4_property_id, client_password, client_email,
       live_domain, event_config, event_groups, keyword_strategy,
       competitor_domains, personas, client_portal_enabled, seo_client_view,
       analytics_client_view, site_intelligence_client_view, auto_reports, auto_report_frequency,
       brand_voice, knowledge_base, brand_logo_url, brand_accent_color,
       tier, trial_ends_at, stripe_customer_id, stripe_subscription_id,
       onboarding_enabled, onboarding_completed, content_pricing,
       portal_contacts, audit_suppressions, custom_prompt_notes, created_at)
    VALUES
      (@id, @name, @folder, @webflow_site_id, @webflow_site_name, @webflow_token,
       @gsc_property_url, @ga4_property_id, @client_password, @client_email,
       @live_domain, @event_config, @event_groups, @keyword_strategy,
       @competitor_domains, @personas, @client_portal_enabled, @seo_client_view,
       @analytics_client_view, @site_intelligence_client_view, @auto_reports, @auto_report_frequency,
       @brand_voice, @knowledge_base, @brand_logo_url, @brand_accent_color,
       @tier, @trial_ends_at, @stripe_customer_id, @stripe_subscription_id,
       @onboarding_enabled, @onboarding_completed, @content_pricing,
       @portal_contacts, @audit_suppressions, @custom_prompt_notes, @created_at)
  `),
  deleteById: db.prepare<[id: string]>(`DELETE FROM workspaces WHERE id = ?`),
  listPageEditStates: db.prepare<[workspaceId: string]>(
    `SELECT * FROM page_edit_states WHERE workspace_id = ?`,
  ),
  getPageEditState: db.prepare<[workspaceId: string, pageId: string]>(
    `SELECT * FROM page_edit_states WHERE workspace_id = ? AND page_id = ?`,
  ),
  upsertPageEditState: db.prepare(`
    INSERT OR REPLACE INTO page_edit_states
      (workspace_id, page_id, slug, status, audit_issues, fields, source,
       approval_batch_id, content_request_id, work_order_id, recommendation_id,
       rejection_note, updated_at, updated_by)
    VALUES
      (@workspace_id, @page_id, @slug, @status, @audit_issues, @fields, @source,
       @approval_batch_id, @content_request_id, @work_order_id, @recommendation_id,
       @rejection_note, @updated_at, @updated_by)
  `),
  deletePageEditState: db.prepare<[workspaceId: string, pageId: string]>(
    `DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id = ?`,
  ),
  clearAllPageEditStates: db.prepare<[workspaceId: string]>(
    `DELETE FROM page_edit_states WHERE workspace_id = ?`,
  ),
  getPageIdBySlug: db.prepare<[workspaceId: string, slug: string]>(
    `SELECT page_id FROM page_edit_states WHERE workspace_id = ? AND slug = ?`,
  ),
  deletePageEditStatesByStatus: db.prepare<[workspaceId: string, status: string]>(
    `DELETE FROM page_edit_states WHERE workspace_id = ? AND status = ?`,
  ),
}));

// ── Helper: convert Workspace to DB params ──

function workspaceToParams(ws: Workspace) {
  return {
    id: ws.id,
    name: ws.name,
    folder: ws.folder,
    webflow_site_id: ws.webflowSiteId ?? null,
    webflow_site_name: ws.webflowSiteName ?? null,
    webflow_token: ws.webflowToken ?? null,
    gsc_property_url: ws.gscPropertyUrl ?? null,
    ga4_property_id: ws.ga4PropertyId ?? null,
    client_password: ws.clientPassword ?? null,
    client_email: ws.clientEmail ?? null,
    live_domain: ws.liveDomain ?? null,
    event_config: ws.eventConfig ? JSON.stringify(ws.eventConfig) : null,
    event_groups: ws.eventGroups ? JSON.stringify(ws.eventGroups) : null,
    keyword_strategy: ws.keywordStrategy ? JSON.stringify(ws.keywordStrategy) : null,
    competitor_domains: ws.competitorDomains ? JSON.stringify(ws.competitorDomains) : null,
    competitor_last_fetched_at: ws.competitorLastFetchedAt ?? null,
    personas: ws.personas ? JSON.stringify(ws.personas) : null,
    client_portal_enabled: ws.clientPortalEnabled === undefined ? null : (ws.clientPortalEnabled ? 1 : 0),
    seo_client_view: ws.seoClientView === undefined ? null : (ws.seoClientView ? 1 : 0),
    analytics_client_view: ws.analyticsClientView === undefined ? null : (ws.analyticsClientView ? 1 : 0),
    site_intelligence_client_view: ws.siteIntelligenceClientView === undefined ? null : (ws.siteIntelligenceClientView ? 1 : 0),
    auto_reports: ws.autoReports === undefined ? null : (ws.autoReports ? 1 : 0),
    auto_report_frequency: ws.autoReportFrequency ?? null,
    brand_voice: ws.brandVoice ?? null,
    knowledge_base: ws.knowledgeBase ?? null,
    brand_logo_url: ws.brandLogoUrl ?? null,
    brand_accent_color: ws.brandAccentColor ?? null,
    tier: ws.tier ?? 'free',
    trial_ends_at: ws.trialEndsAt ?? null,
    stripe_customer_id: ws.stripeCustomerId ?? null,
    stripe_subscription_id: ws.stripeSubscriptionId ?? null,
    onboarding_enabled: ws.onboardingEnabled === undefined ? null : (ws.onboardingEnabled ? 1 : 0),
    onboarding_completed: ws.onboardingCompleted === undefined ? null : (ws.onboardingCompleted ? 1 : 0),
    content_pricing: ws.contentPricing ? JSON.stringify(ws.contentPricing) : null,
    portal_contacts: ws.portalContacts ? JSON.stringify(ws.portalContacts) : null,
    audit_suppressions: ws.auditSuppressions ? JSON.stringify(ws.auditSuppressions) : null,
    publish_target: ws.publishTarget ? JSON.stringify(ws.publishTarget) : null,
    seo_data_provider: ws.seoDataProvider || null,
    business_profile: ws.businessProfile ? JSON.stringify(ws.businessProfile) : null,
    intelligence_profile: ws.intelligenceProfile ? JSON.stringify(ws.intelligenceProfile) : null,
    business_priorities: ws.businessPriorities ? JSON.stringify(ws.businessPriorities) : null,
    custom_prompt_notes: ws.customPromptNotes ?? null,
    created_at: ws.createdAt,
  };
}

// ── Public API (unchanged signatures) ──

/**
 * Build the client portal URL for a workspace.
 * Uses APP_URL env var (the platform's own domain) — NOT liveDomain (which is the client's website).
 * Returns undefined if APP_URL is not configured.
 */
export function getClientPortalUrl(ws: { id: string }): string | undefined {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return undefined;
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/client/${ws.id}`;
}

// Look up the token for a given siteId across all workspaces, fall back to env
export function getTokenForSite(siteId: string): string | null {
  const row = stmts().getBySiteId.get(siteId) as WorkspaceRow | undefined;
  return row?.webflow_token || process.env.WEBFLOW_API_TOKEN || null;
}

export function listWorkspaces(): Workspace[] {
  const rows = stmts().listAll.all() as WorkspaceRow[];
  return rows.map(r => attachPageStates(rowToWorkspace(r)));
}

export function createWorkspace(name: string, webflowSiteId?: string, webflowSiteName?: string): Workspace {
  const folder = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = `ws_${randomUUID()}`;

  // New workspaces start with a 14-day Growth trial
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);

  const workspace: Workspace = {
    id,
    name,
    webflowSiteId,
    webflowSiteName,
    tier: 'free',
    trialEndsAt: trialEnd.toISOString(),
    folder,
    createdAt: new Date().toISOString(),
  };

  // Create folder structure
  const uploadDir = path.join(UPLOAD_ROOT, folder);
  const metaDir = path.join(UPLOAD_ROOT, folder, 'meta');
  const optDir = path.join(OPT_ROOT, folder);
  const optMetaDir = path.join(OPT_ROOT, folder, 'meta');

  for (const dir of [uploadDir, metaDir, optDir, optMetaDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  stmts().insert.run(workspaceToParams(workspace));
  return workspace;
}

export function updateWorkspace(id: string, updates: Partial<Pick<Workspace, 'name' | 'webflowSiteId' | 'webflowSiteName' | 'webflowToken' | 'gscPropertyUrl' | 'ga4PropertyId' | 'clientPassword' | 'clientEmail' | 'liveDomain' | 'eventConfig' | 'eventGroups' | 'keywordStrategy' | 'competitorDomains' | 'competitorLastFetchedAt' | 'personas' | 'clientPortalEnabled' | 'seoClientView' | 'analyticsClientView' | 'autoReports' | 'autoReportFrequency' | 'brandVoice' | 'knowledgeBase' | 'brandLogoUrl' | 'brandAccentColor' | 'contentPricing' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'tier' | 'trialEndsAt' | 'onboardingEnabled' | 'onboardingCompleted' | 'portalContacts' | 'auditSuppressions' | 'pageEditStates' | 'publishTarget' | 'seoDataProvider' | 'businessProfile' | 'intelligenceProfile' | 'siteIntelligenceClientView' | 'businessPriorities' | 'customPromptNotes'>>): Workspace | null {
  const row = stmts().getById.get(id) as WorkspaceRow | undefined;
  if (!row) return null;

  const existing = rowToWorkspace(row);
  const merged = Object.assign(existing, updates);

  // Build dynamic UPDATE SET clause — only update columns that were provided
  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id };
  const p = workspaceToParams(merged);

  // Map of update key → column name and value from params
  const columnMap: Record<string, string> = {
    name: 'name', webflowSiteId: 'webflow_site_id', webflowSiteName: 'webflow_site_name',
    webflowToken: 'webflow_token', gscPropertyUrl: 'gsc_property_url', ga4PropertyId: 'ga4_property_id',
    clientPassword: 'client_password', clientEmail: 'client_email', liveDomain: 'live_domain',
    eventConfig: 'event_config', eventGroups: 'event_groups', keywordStrategy: 'keyword_strategy',
    competitorDomains: 'competitor_domains', competitorLastFetchedAt: 'competitor_last_fetched_at', personas: 'personas',
    clientPortalEnabled: 'client_portal_enabled', seoClientView: 'seo_client_view',
    analyticsClientView: 'analytics_client_view', siteIntelligenceClientView: 'site_intelligence_client_view', autoReports: 'auto_reports',
    autoReportFrequency: 'auto_report_frequency', brandVoice: 'brand_voice',
    knowledgeBase: 'knowledge_base', rewritePlaybook: 'rewrite_playbook', brandLogoUrl: 'brand_logo_url',
    brandAccentColor: 'brand_accent_color', contentPricing: 'content_pricing',
    stripeCustomerId: 'stripe_customer_id', stripeSubscriptionId: 'stripe_subscription_id',
    tier: 'tier', trialEndsAt: 'trial_ends_at',
    onboardingEnabled: 'onboarding_enabled', onboardingCompleted: 'onboarding_completed',
    portalContacts: 'portal_contacts', auditSuppressions: 'audit_suppressions',
    publishTarget: 'publish_target', seoDataProvider: 'seo_data_provider',
    businessProfile: 'business_profile', intelligenceProfile: 'intelligence_profile',
    businessPriorities: 'business_priorities', customPromptNotes: 'custom_prompt_notes',
  };

  const ALLOWED_COLUMNS = new Set(Object.values(columnMap));
  for (const [key, col] of Object.entries(columnMap)) {
    if (key in updates) {
      setClauses.push(`${col} = @${col}`);
      params[col] = (p as Record<string, unknown>)[col];
    }
  }
  // Safety net: verify all generated column names are in the allowlist
  for (const clause of setClauses) {
    const colName = clause.split(' = ')[0];
    if (!ALLOWED_COLUMNS.has(colName)) {
      throw new Error(`Invalid column name: ${colName}`);
    }
  }

  // Handle pageEditStates — these go to a separate table
  if (updates.pageEditStates !== undefined) {
    const states = updates.pageEditStates || {};
    // Get existing page IDs so we can detect removals
    const existingRows = stmts().listPageEditStates.all(id) as PageEditRow[];
    const existingIds = new Set(existingRows.map(r => r.page_id));
    const newIds = new Set(Object.keys(states));
    // Remove pages no longer present
    for (const pid of existingIds) {
      if (!newIds.has(pid)) {
        stmts().deletePageEditState.run(id, pid);
      }
    }
    // Upsert all current states
    for (const [pid, state] of Object.entries(states)) {
      stmts().upsertPageEditState.run({
        workspace_id: id,
        page_id: pid,
        slug: state.slug ?? null,
        status: state.status,
        audit_issues: state.auditIssues ? JSON.stringify(state.auditIssues) : null,
        fields: state.fields ? JSON.stringify(state.fields) : null,
        source: state.source ?? null,
        approval_batch_id: state.approvalBatchId ?? null,
        content_request_id: state.contentRequestId ?? null,
        work_order_id: state.workOrderId ?? null,
        recommendation_id: state.recommendationId ?? null,
        rejection_note: state.rejectionNote ?? null,
        updated_at: state.updatedAt,
        updated_by: state.updatedBy ?? null,
      });
    }
  }

  if (setClauses.length > 0) {
    const sql = `UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = @id`;
    db.prepare(sql).run(params);
  }

  return attachPageStates(rowToWorkspace(stmts().getById.get(id) as WorkspaceRow));
}

export function deleteWorkspace(id: string): boolean {
  const result = stmts().deleteById.run(id);
  return result.changes > 0;
}

export function getWorkspace(id: string): Workspace | undefined {
  const row = stmts().getById.get(id) as WorkspaceRow | undefined;
  if (!row) return undefined;
  return attachPageStates(rowToWorkspace(row));
}

export function getUploadRoot() { return UPLOAD_ROOT; }
export function getOptRoot() { return OPT_ROOT; }

/** Resolve a URL slug to a Webflow page ID via the page_edit_states table. */
export function getPageIdBySlug(workspaceId: string, slug: string): string | undefined {
  const row = stmts().getPageIdBySlug.get(workspaceId, slug) as { page_id: string } | undefined;
  if (row) return row.page_id;
  // Try with leading slash stripped
  const stripped = slug.replace(/^\//, '');
  if (stripped !== slug) {
    const row2 = stmts().getPageIdBySlug.get(workspaceId, stripped) as { page_id: string } | undefined;
    if (row2) return row2.page_id;
  }
  // Try with leading slash added
  if (!slug.startsWith('/')) {
    const withSlash = `/${slug}`;
    const row3 = stmts().getPageIdBySlug.get(workspaceId, withSlash) as { page_id: string } | undefined;
    if (row3) return row3.page_id;
  }
  return undefined;
}

// --- Unified Page Edit State helpers ---

const STATUS_PRIORITY: Record<PageEditStatus, number> = {
  clean: 0, 'issue-detected': 1, 'fix-proposed': 2, 'in-review': 3, approved: 4, rejected: 4, live: 5,
};

export function updatePageState(
  workspaceId: string,
  pageId: string,
  updates: Partial<Omit<PageEditState, 'pageId' | 'updatedAt'>>,
): PageEditState | null {
  const row = stmts().getById.get(workspaceId) as WorkspaceRow | undefined;
  if (!row) return null;

  const existingRow = stmts().getPageEditState.get(workspaceId, pageId) as PageEditRow | undefined;
  let existing: PageEditState | undefined;
  if (existingRow) {
    existing = {
      pageId: existingRow.page_id,
      slug: existingRow.slug ?? undefined,
      status: existingRow.status as PageEditStatus,
      auditIssues: existingRow.audit_issues ? parseJsonSafeArray(existingRow.audit_issues, z.string(), { workspaceId, field: 'audit_issues', table: 'page_edit_states' }) : undefined,
      fields: existingRow.fields ? parseJsonSafeArray(existingRow.fields, z.string(), { workspaceId, field: 'fields', table: 'page_edit_states' }) : undefined,
      source: existingRow.source as PageEditState['source'] ?? undefined,
      approvalBatchId: existingRow.approval_batch_id ?? undefined,
      contentRequestId: existingRow.content_request_id ?? undefined,
      workOrderId: existingRow.work_order_id ?? undefined,
      recommendationId: existingRow.recommendation_id ?? undefined,
      rejectionNote: existingRow.rejection_note ?? undefined,
      updatedAt: existingRow.updated_at,
      updatedBy: existingRow.updated_by as PageEditState['updatedBy'] ?? undefined,
    };
  }

  // Don't downgrade status unless explicitly setting to clean or rejected
  if (existing && updates.status && updates.status !== 'clean' && updates.status !== 'rejected') {
    if (STATUS_PRIORITY[existing.status] > STATUS_PRIORITY[updates.status]) {
      // Still merge non-status fields
      const { status: _s, ...rest } = updates; // eslint-disable-line @typescript-eslint/no-unused-vars
      if (Object.keys(rest).length === 0) return existing;
      updates = rest;
    }
  }

  const now = new Date().toISOString();
  const base: PageEditState = existing
    ? { ...existing }
    : { pageId, status: 'clean', updatedAt: now };
  const merged: PageEditState = Object.assign(base, updates, { pageId, updatedAt: now });

  stmts().upsertPageEditState.run({
    workspace_id: workspaceId,
    page_id: pageId,
    slug: merged.slug ?? null,
    status: merged.status,
    audit_issues: merged.auditIssues ? JSON.stringify(merged.auditIssues) : null,
    fields: merged.fields ? JSON.stringify(merged.fields) : null,
    source: merged.source ?? null,
    approval_batch_id: merged.approvalBatchId ?? null,
    content_request_id: merged.contentRequestId ?? null,
    work_order_id: merged.workOrderId ?? null,
    recommendation_id: merged.recommendationId ?? null,
    rejection_note: merged.rejectionNote ?? null,
    updated_at: merged.updatedAt,
    updated_by: merged.updatedBy ?? null,
  });

  return merged;
}

export function getPageState(workspaceId: string, pageId: string): PageEditState | undefined {
  const row = stmts().getPageEditState.get(workspaceId, pageId) as PageEditRow | undefined;
  if (!row) return undefined;
  return {
    pageId: row.page_id,
    slug: row.slug ?? undefined,
    status: row.status as PageEditStatus,
    auditIssues: row.audit_issues ? parseJsonSafeArray(row.audit_issues, z.string(), { workspaceId, field: 'audit_issues', table: 'page_edit_states' }) : undefined,
    fields: row.fields ? parseJsonSafeArray(row.fields, z.string(), { workspaceId, field: 'fields', table: 'page_edit_states' }) : undefined,
    source: row.source as PageEditState['source'] ?? undefined,
    approvalBatchId: row.approval_batch_id ?? undefined,
    contentRequestId: row.content_request_id ?? undefined,
    workOrderId: row.work_order_id ?? undefined,
    recommendationId: row.recommendation_id ?? undefined,
    rejectionNote: row.rejection_note ?? undefined,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by as PageEditState['updatedBy'] ?? undefined,
  };
}

export function getAllPageStates(workspaceId: string): Record<string, PageEditState> {
  const rows = stmts().listPageEditStates.all(workspaceId) as PageEditRow[];
  const states: Record<string, PageEditState> = {};
  for (const row of rows) {
    states[row.page_id] = {
      pageId: row.page_id,
      slug: row.slug ?? undefined,
      status: row.status as PageEditStatus,
      auditIssues: row.audit_issues ? parseJsonSafeArray(row.audit_issues, z.string(), { workspaceId, field: 'audit_issues', table: 'page_edit_states' }) : undefined,
      fields: row.fields ? parseJsonSafeArray(row.fields, z.string(), { workspaceId, field: 'fields', table: 'page_edit_states' }) : undefined,
      source: row.source as PageEditState['source'] ?? undefined,
      approvalBatchId: row.approval_batch_id ?? undefined,
      contentRequestId: row.content_request_id ?? undefined,
      workOrderId: row.work_order_id ?? undefined,
      recommendationId: row.recommendation_id ?? undefined,
      rejectionNote: row.rejection_note ?? undefined,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by as PageEditState['updatedBy'] ?? undefined,
    };
  }
  return states;
}

export function clearPageStatesByStatus(workspaceId: string, status: string): number {
  const row = stmts().getById.get(workspaceId) as WorkspaceRow | undefined;
  if (!row) return 0;
  if (status === 'all') {
    // Clear ALL page states for this workspace
    const info = stmts().clearAllPageEditStates.run(workspaceId);
    return info.changes;
  }
  const info = stmts().deletePageEditStatesByStatus.run(workspaceId, status);
  return info.changes;
}

export function clearPageState(workspaceId: string, pageId: string): boolean {
  const row = stmts().getById.get(workspaceId) as WorkspaceRow | undefined;
  if (!row) return false;
  stmts().deletePageEditState.run(workspaceId, pageId);
  return true;
}
