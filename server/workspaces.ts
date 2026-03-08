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

  const workspace: Workspace = {
    id,
    name,
    webflowSiteId,
    webflowSiteName,
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

export function updateWorkspace(id: string, updates: Partial<Pick<Workspace, 'name' | 'webflowSiteId' | 'webflowSiteName' | 'webflowToken' | 'gscPropertyUrl' | 'ga4PropertyId' | 'clientPassword' | 'clientEmail' | 'liveDomain' | 'eventConfig' | 'eventGroups' | 'keywordStrategy' | 'competitorDomains' | 'clientPortalEnabled' | 'seoClientView' | 'analyticsClientView' | 'autoReports' | 'autoReportFrequency' | 'brandVoice' | 'knowledgeBase' | 'brandLogoUrl' | 'brandAccentColor' | 'contentPricing' | 'stripeCustomerId'>>): Workspace | null {
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
