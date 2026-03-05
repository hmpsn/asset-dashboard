import fs from 'fs';
import path from 'path';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const UPLOAD_ROOT = DATA_BASE
  ? path.join(DATA_BASE, 'uploads')
  : path.join(process.env.HOME || '', 'toUpload');
const OPT_ROOT = DATA_BASE
  ? path.join(DATA_BASE, 'optimized')
  : path.join(process.env.HOME || '', 'Optimized');
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
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
}

export interface KeywordStrategy {
  siteKeywords: string[];        // top-level target keywords for the whole site
  pageMap: PageKeywordMap[];     // keyword assignments per page
  opportunities: string[];       // keyword gaps / untapped opportunities
  businessContext?: string;      // user-provided context (locations, services, industry)
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

export function updateWorkspace(id: string, updates: Partial<Pick<Workspace, 'name' | 'webflowSiteId' | 'webflowSiteName' | 'webflowToken' | 'gscPropertyUrl' | 'ga4PropertyId' | 'clientPassword' | 'clientEmail' | 'liveDomain' | 'eventConfig' | 'eventGroups' | 'keywordStrategy'>>): Workspace | null {
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
