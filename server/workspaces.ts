import fs from 'fs';
import path from 'path';
import { getUploadRoot as _getUploadRoot, getOptRoot as _getOptRoot } from './data-dir.js';

const UPLOAD_ROOT = _getUploadRoot();
const OPT_ROOT = _getOptRoot();
const CONFIG_FILE = path.join(UPLOAD_ROOT, '.workspaces.json');

export interface EventGroup {
  id: string;
  name: string;
  order: number;
  color: string;
  defaultPageFilter?: string;
  allowedPages?: string[];
}

export interface EventDisplayConfig {
  eventName: string;
  displayName: string;
  pinned: boolean;
  group?: string;
}

export interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  // SEMRush enrichment
  volume?: number;
  difficulty?: number;
  cpc?: number;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

export interface KeywordGapItem {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

export interface ContentGap {
  topic: string;           // suggested content topic
  targetKeyword: string;   // primary keyword to target
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  priority: 'high' | 'medium' | 'low';
  rationale: string;       // why this content should be created
  suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
}

export interface QuickWin {
  pagePath: string;
  currentKeyword?: string;
  action: string;          // specific action to take
  estimatedImpact: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface KeywordStrategy {
  siteKeywords: string[];        // top-level target keywords for the whole site
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[]; // SEMRush data for site keywords
  pageMap: PageKeywordMap[];     // keyword assignments per page
  opportunities: string[];       // keyword gaps / untapped opportunities
  contentGaps?: ContentGap[];    // specific content pieces that should be created
  quickWins?: QuickWin[];        // low-effort, high-impact fixes
  keywordGaps?: KeywordGapItem[]; // keywords competitors rank for but we don't
  businessContext?: string;      // user-provided context (locations, services, industry)
  semrushMode?: 'quick' | 'full' | 'none'; // which SEMRush mode was used
  generatedAt: string;
}

export type PageEditStatus = 'clean' | 'issue-detected' | 'fix-proposed' | 'in-review' | 'approved' | 'rejected' | 'live';

export interface PageEditState {
  pageId: string;
  slug?: string;
  status: PageEditStatus;
  auditIssues?: string[];
  fields?: string[];
  source?: 'audit' | 'editor' | 'cms' | 'schema' | 'bulk-fix' | 'cart-fix' | 'content-delivery' | 'recommendation' | 'request-resolved';
  approvalBatchId?: string;
  contentRequestId?: string;
  workOrderId?: string;
  recommendationId?: string;
  rejectionNote?: string;
  updatedAt: string;
  updatedBy?: 'admin' | 'client' | 'system';
}

export interface Workspace {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  webflowToken?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  clientPassword?: string;
  clientEmail?: string;
  liveDomain?: string;
  eventConfig?: EventDisplayConfig[];
  eventGroups?: EventGroup[];
  keywordStrategy?: KeywordStrategy;
  competitorDomains?: string[];
  // Feature toggles
  clientPortalEnabled?: boolean;
  seoClientView?: boolean;
  analyticsClientView?: boolean;
  autoReports?: boolean;
  autoReportFrequency?: 'weekly' | 'monthly';
  // Branding
  brandVoice?: string;           // brand voice guidelines, tone description, style notes
  knowledgeBase?: string;          // business knowledge: services, capabilities, FAQs, platform info
  brandLogoUrl?: string;
  brandAccentColor?: string;
  // Monetization
  tier?: 'free' | 'growth' | 'premium';
  trialEndsAt?: string;              // ISO date — 14-day Growth trial
  stripeCustomerId?: string;         // Stripe Customer ID for subscriptions
  // Audit issue suppressions (per-page check exclusions)
  auditSuppressions?: { check: string; pageSlug: string; reason?: string; createdAt: string }[];
  // SEO edit tracking (legacy — kept for backward compat, written by updatePageState)
  seoEditTracking?: Record<string, { status: 'flagged' | 'in-review' | 'live'; updatedAt: string; fields?: string[] }>;
  // Unified page edit states (new — replaces seoEditTracking)
  pageEditStates?: Record<string, PageEditState>;
  // Content pricing (per-workspace, exposed to client portal)
  contentPricing?: {
    briefPrice: number;       // e.g. 150 (in dollars)
    fullPostPrice: number;    // e.g. 500
    currency: string;         // e.g. 'USD'
    briefLabel?: string;      // optional custom label
    fullPostLabel?: string;
    briefDescription?: string;
    fullPostDescription?: string;
  };
  folder: string;
  createdAt: string;
}

// Look up the token for a given siteId across all workspaces, fall back to env
export function getTokenForSite(siteId: string): string | null {
  const workspaces = readConfig();
  const ws = workspaces.find(w => w.webflowSiteId === siteId);
  return ws?.webflowToken || process.env.WEBFLOW_API_TOKEN || null;
}

function readConfig(): Workspace[] {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function writeConfig(workspaces: Workspace[]) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(workspaces, null, 2));
}

export function listWorkspaces(): Workspace[] {
  return readConfig();
}

export function createWorkspace(name: string, webflowSiteId?: string, webflowSiteName?: string): Workspace {
  const workspaces = readConfig();
  const folder = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = `ws_${Date.now()}`;

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

  workspaces.push(workspace);
  writeConfig(workspaces);
  return workspace;
}

export function updateWorkspace(id: string, updates: Partial<Pick<Workspace, 'name' | 'webflowSiteId' | 'webflowSiteName' | 'webflowToken' | 'gscPropertyUrl' | 'ga4PropertyId' | 'clientPassword' | 'clientEmail' | 'liveDomain' | 'eventConfig' | 'eventGroups' | 'keywordStrategy' | 'competitorDomains' | 'clientPortalEnabled' | 'seoClientView' | 'analyticsClientView' | 'autoReports' | 'autoReportFrequency' | 'brandVoice' | 'knowledgeBase' | 'brandLogoUrl' | 'brandAccentColor' | 'contentPricing' | 'stripeCustomerId' | 'tier' | 'trialEndsAt' | 'auditSuppressions' | 'seoEditTracking' | 'pageEditStates'>>): Workspace | null {
  const workspaces = readConfig();
  const idx = workspaces.findIndex(w => w.id === id);
  if (idx === -1) return null;

  Object.assign(workspaces[idx], updates);
  writeConfig(workspaces);
  return workspaces[idx];
}

export function deleteWorkspace(id: string): boolean {
  const workspaces = readConfig();
  const idx = workspaces.findIndex(w => w.id === id);
  if (idx === -1) return false;

  workspaces.splice(idx, 1);
  writeConfig(workspaces);
  return true;
}

export function getWorkspace(id: string): Workspace | undefined {
  return readConfig().find(w => w.id === id);
}

export function getUploadRoot() { return UPLOAD_ROOT; }
export function getOptRoot() { return OPT_ROOT; }

// --- Unified Page Edit State helpers ---

const STATUS_PRIORITY: Record<PageEditStatus, number> = {
  clean: 0, 'issue-detected': 1, 'fix-proposed': 2, 'in-review': 3, approved: 4, rejected: 4, live: 5,
};

// Map new statuses down to legacy seoEditTracking format
function toLegacyStatus(status: PageEditStatus): 'flagged' | 'in-review' | 'live' | null {
  switch (status) {
    case 'issue-detected': case 'fix-proposed': return 'flagged';
    case 'in-review': return 'in-review';
    case 'approved': case 'live': return 'live';
    case 'rejected': return 'flagged';
    default: return null;
  }
}

export function updatePageState(
  workspaceId: string,
  pageId: string,
  updates: Partial<Omit<PageEditState, 'pageId' | 'updatedAt'>>,
): PageEditState | null {
  const workspaces = readConfig();
  const idx = workspaces.findIndex(w => w.id === workspaceId);
  if (idx === -1) return null;

  const ws = workspaces[idx];
  const states = ws.pageEditStates || {};
  const existing = states[pageId];

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

  states[pageId] = merged;
  ws.pageEditStates = states;

  // Sync legacy seoEditTracking
  const legacy = toLegacyStatus(merged.status);
  if (legacy) {
    const tracking = ws.seoEditTracking || {};
    tracking[pageId] = { status: legacy, updatedAt: now, fields: merged.fields };
    ws.seoEditTracking = tracking;
  } else if (merged.status === 'clean') {
    // Remove from legacy tracking
    const tracking = ws.seoEditTracking || {};
    delete tracking[pageId];
    ws.seoEditTracking = tracking;
  }

  writeConfig(workspaces);
  return merged;
}

export function getPageState(workspaceId: string, pageId: string): PageEditState | undefined {
  const ws = getWorkspace(workspaceId);
  return ws?.pageEditStates?.[pageId];
}

export function getAllPageStates(workspaceId: string): Record<string, PageEditState> {
  const ws = getWorkspace(workspaceId);
  return ws?.pageEditStates || {};
}

export function clearPageState(workspaceId: string, pageId: string): boolean {
  const workspaces = readConfig();
  const idx = workspaces.findIndex(w => w.id === workspaceId);
  if (idx === -1) return false;
  const ws = workspaces[idx];
  if (ws.pageEditStates?.[pageId]) {
    delete ws.pageEditStates[pageId];
  }
  if (ws.seoEditTracking?.[pageId]) {
    delete ws.seoEditTracking[pageId];
  }
  writeConfig(workspaces);
  return true;
}
