/**
 * Site Architecture Planner — builds a URL tree from existing pages + planned matrix cells.
 *
 * Combines:
 * - Webflow static pages (API)
 * - CMS pages (sitemap discovery)
 * - Content matrix planned pages (not yet published)
 * - Keyword strategy page assignments
 *
 * Returns a tree structure with gap analysis for visualization.
 */
import { buildStaticPathSet, discoverCmsUrls, getSiteSubdomain } from './webflow-pages.js';
import { getWorkspacePages } from './workspace-data.js';
import { listMatrices } from './content-matrices.js';
import { getWorkspace } from './workspaces.js';
import { listPageKeywords } from './page-keywords.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';

const log = createLogger('site-architecture');

// ── Types ──

export interface SiteNode {
  path: string;
  name: string;
  pageType?: string;
  source: 'existing' | 'planned' | 'strategy' | 'gap';
  keyword?: string;
  seoTitle?: string;
  seoDescription?: string;
  matrixId?: string;
  cellId?: string;
  children: SiteNode[];
  depth: number;
  hasContent: boolean;
}

export interface ArchitectureGap {
  parentPath: string;
  suggestedPath: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface SiteArchitectureResult {
  tree: SiteNode;
  totalPages: number;
  existingPages: number;
  plannedPages: number;
  strategyPages: number;
  gaps: ArchitectureGap[];
  depthDistribution: Record<number, number>;
  orphanPaths: string[];
  analyzedAt: string;
}

// ── Helpers ──

function pathToSegments(path: string): string[] {
  return path.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
}

function segmentToName(segment: string): string {
  return segment.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Insert a page into the tree, creating intermediate nodes as needed.
 */
function insertIntoTree(
  root: SiteNode,
  path: string,
  data: Partial<SiteNode>,
): void {
  const segments = pathToSegments(path);
  let current = root;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const currentPath = '/' + segments.slice(0, i + 1).join('/');
    const isLast = i === segments.length - 1;

    let child = current.children.find(c => c.path === currentPath);
    if (!child) {
      child = {
        path: currentPath,
        name: segmentToName(segment),
        source: isLast ? (data.source || 'existing') : 'gap',
        children: [],
        depth: i + 1,
        hasContent: isLast,
      };
      current.children.push(child);
    }

    if (isLast) {
      // Merge data into existing node — 'existing' source always wins
      child.name = data.name || child.name;
      child.pageType = data.pageType || child.pageType;
      const SOURCE_RANK: Record<string, number> = { existing: 0, planned: 1, strategy: 2, gap: 3 };
      const currentRank = SOURCE_RANK[child.source] ?? 3;
      const newRank = SOURCE_RANK[data.source || 'gap'] ?? 3;
      if (newRank < currentRank) child.source = data.source || child.source;
      child.keyword = data.keyword || child.keyword;
      child.seoTitle = data.seoTitle || child.seoTitle;
      child.seoDescription = data.seoDescription || child.seoDescription;
      child.matrixId = data.matrixId || child.matrixId;
      child.cellId = data.cellId || child.cellId;
      child.hasContent = true;
    }

    current = child;
  }
}

/**
 * Sort tree children alphabetically and recursively.
 */
function sortTree(node: SiteNode): void {
  node.children.sort((a, b) => a.path.localeCompare(b.path));
  for (const child of node.children) sortTree(child);
}

/**
 * Count nodes by source and compute depth distribution.
 */
function analyzeTree(root: SiteNode): {
  total: number;
  existing: number;
  planned: number;
  strategy: number;
  depthDist: Record<number, number>;
  orphans: string[];
} {
  let total = 0, existing = 0, planned = 0, strategy = 0;
  const depthDist: Record<number, number> = {};
  const orphans: string[] = [];

  function walk(node: SiteNode, parentHasContent: boolean) {
    if (node.depth > 0) {
      total++;
      if (node.source === 'existing') existing++;
      else if (node.source === 'planned') planned++;
      else if (node.source === 'strategy') strategy++;

      depthDist[node.depth] = (depthDist[node.depth] || 0) + 1;

      // Orphan: a page with content but whose parent directory has no content
      if (node.hasContent && !parentHasContent && node.depth > 1) {
        orphans.push(node.path);
      }
    }

    for (const child of node.children) {
      walk(child, node.hasContent);
    }
  }

  walk(root, true);
  return { total, existing, planned, strategy, depthDist, orphans };
}

/**
 * Detect gaps in the architecture — intermediate paths with no content.
 */
function detectGaps(root: SiteNode): ArchitectureGap[] {
  const gaps: ArchitectureGap[] = [];

  function walk(node: SiteNode) {
    // If this node has children but no content itself, it's a hub page gap
    if (node.depth > 0 && !node.hasContent && node.children.length > 0) {
      const childCount = node.children.filter(c => c.hasContent).length;
      gaps.push({
        parentPath: node.path.split('/').slice(0, -1).join('/') || '/',
        suggestedPath: node.path,
        reason: `${childCount} child page${childCount !== 1 ? 's' : ''} exist under ${node.path} but no hub/landing page exists at this URL`,
        priority: childCount >= 3 ? 'high' : childCount >= 2 ? 'medium' : 'low',
      });
    }

    for (const child of node.children) walk(child);
  }

  walk(root);
  return gaps;
}

// ── Tree query helpers ──

/**
 * Walk the tree and return the ancestor chain [root, ..., parent, target] for a given path.
 * Returns empty array if path not found.
 */
export function getAncestorChain(tree: SiteNode, targetPath: string): SiteNode[] {
  const chain: SiteNode[] = [];
  function walk(node: SiteNode): boolean {
    chain.push(node);
    if (node.path === targetPath) return true;
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    chain.pop();
    return false;
  }
  walk(tree);
  return chain;
}

/**
 * Find the parent of the node at targetPath in the tree.
 * Returns null if the target is the root or not found.
 */
export function getParentNode(tree: SiteNode, targetPath: string): SiteNode | null {
  function walk(node: SiteNode, parent: SiteNode | null): SiteNode | null {
    if (node.path === targetPath) return parent;
    for (const child of node.children) {
      const found = walk(child, node);
      if (found !== null) return found;
    }
    return null;
  }
  return walk(tree, null);
}

/**
 * Find the siblings of the node at targetPath (same parent, excluding the target itself).
 * Only returns siblings that have content.
 */
export function getSiblingNodes(tree: SiteNode, targetPath: string): SiteNode[] {
  const parent = getParentNode(tree, targetPath);
  if (!parent) return [];
  return parent.children.filter(c => c.path !== targetPath && c.hasContent);
}

/**
 * Find the node at parentPath and return its direct children that have content.
 * Used by D3 hub page detection and D5 relationship enrichment.
 */
export function getChildNodes(tree: SiteNode, parentPath: string): SiteNode[] {
  function find(node: SiteNode): SiteNode | null {
    if (node.path === parentPath) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  }
  const parent = find(tree);
  return parent ? parent.children.filter(c => c.hasContent) : [];
}

/**
 * Flatten the tree into a depth-first array of all nodes (excluding root if desired).
 */
export function flattenTree(tree: SiteNode, includeRoot = false): SiteNode[] {
  const nodes: SiteNode[] = [];
  function walk(node: SiteNode) {
    if (node.depth > 0 || includeRoot) nodes.push(node);
    for (const child of node.children) walk(child);
  }
  walk(tree);
  return nodes;
}

// ── Architecture cache (10-minute TTL) ──

const archCache: Map<string, { result: SiteArchitectureResult; ts: number }> = new Map();
const CACHE_TTL = 10 * 60 * 1000;

/**
 * Load architecture with caching — avoids duplicate Webflow API + sitemap calls
 * within a 10-minute window.
 */
export async function getCachedArchitecture(workspaceId: string): Promise<SiteArchitectureResult> {
  const cached = archCache.get(workspaceId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;
  const result = await buildSiteArchitecture(workspaceId);
  archCache.set(workspaceId, { result, ts: Date.now() });
  return result;
}

/** Invalidate architecture cache for a workspace (e.g. after page changes). */
export function invalidateArchitectureCache(workspaceId: string): void {
  archCache.delete(workspaceId);
}

// ── Main entry point ──

export async function buildSiteArchitecture(workspaceId: string): Promise<SiteArchitectureResult> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const root: SiteNode = {
    path: '/',
    name: ws.name || 'Home',
    source: 'existing',
    children: [],
    depth: 0,
    hasContent: true,
  };

  // 1. Existing pages from Webflow API
  if (ws.webflowSiteId) {
    try {
      const token = ws.webflowToken || process.env.WEBFLOW_API_TOKEN;
      const published = await getWorkspacePages(ws.id, ws.webflowSiteId);

      for (const p of published) {
        const pagePath = resolvePagePath(p);
        if (pagePath === '/') continue; // root already exists
        insertIntoTree(root, pagePath, {
          name: p.title || segmentToName(p.slug || ''),
          source: 'existing',
          seoTitle: p.seo?.title || undefined,
          seoDescription: p.seo?.description || undefined,
        });
      }

      // CMS pages from sitemap
      const subdomain = await getSiteSubdomain(ws.webflowSiteId, token || undefined);
      const domain = ws.liveDomain?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const baseUrl = domain ? `https://${domain}` : subdomain ? `https://${subdomain}.webflow.io` : '';

      if (baseUrl) {
        const staticPaths = buildStaticPathSet(published);
        const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 200);
        for (const cms of cmsUrls) {
          insertIntoTree(root, cms.path, {
            name: cms.pageName,
            source: 'existing',
          });
        }
      }

      log.info({ workspaceId, staticCount: published.length }, 'Loaded existing pages');
    } catch (err) {
      log.warn({ err }, 'Failed to load Webflow pages for architecture');
    }
  }

  // 2. Planned pages from content matrices (only non-published — published cells are already 'existing')
  const matrices = listMatrices(workspaceId);
  for (const matrix of matrices) {
    for (const cell of matrix.cells) {
      if (cell.plannedUrl && cell.status !== 'published') {
        const urlPath = cell.plannedUrl.startsWith('/') ? cell.plannedUrl : `/${cell.plannedUrl}`;
        insertIntoTree(root, urlPath, {
          name: cell.targetKeyword || segmentToName(urlPath.split('/').pop() || ''),
          source: 'planned',
          keyword: cell.targetKeyword,
          matrixId: matrix.id,
          cellId: cell.id,
          pageType: undefined, // could derive from template
        });
      }
    }
  }

  // 3. Strategy page assignments (keyword map)
  const kwPages = listPageKeywords(ws.id);
  if (kwPages.length > 0) {
    for (const pm of kwPages) {
      const pagePath = pm.pagePath.startsWith('/') ? pm.pagePath : `/${pm.pagePath}`;
      if (pagePath === '/') continue;
      // Only add if not already in tree as existing/planned
      const segments = pathToSegments(pagePath);
      let exists = false;
      let current = root;
      for (const seg of segments) {
        const fullPath = '/' + pathToSegments(pagePath).slice(0, segments.indexOf(seg) + 1).join('/');
        const child = current.children.find(c => c.path === fullPath);
        if (child && segments.indexOf(seg) === segments.length - 1 && child.hasContent) {
          // Already exists — just add keyword info
          if (!child.keyword) child.keyword = pm.primaryKeyword;
          exists = true;
        }
        if (child) current = child;
        else break;
      }
      if (!exists) {
        insertIntoTree(root, pagePath, {
          name: segmentToName(pagePath.split('/').pop() || ''),
          source: 'strategy',
          keyword: pm.primaryKeyword,
        });
      }
    }
  }

  // Sort and analyze
  sortTree(root);
  const analysis = analyzeTree(root);
  const gaps = detectGaps(root);

  log.info({
    workspaceId,
    total: analysis.total,
    existing: analysis.existing,
    planned: analysis.planned,
    gaps: gaps.length,
  }, 'Site architecture built');

  return {
    tree: root,
    totalPages: analysis.total,
    existingPages: analysis.existing,
    plannedPages: analysis.planned,
    strategyPages: analysis.strategy,
    gaps,
    depthDistribution: analysis.depthDist,
    orphanPaths: analysis.orphans,
    analyzedAt: new Date().toISOString(),
  };
}
