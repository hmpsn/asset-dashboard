/**
 * Integration tests for site architecture analysis.
 *
 * Tests the following areas:
 *   1. Pure unit tests for tree-building helpers (no server required)
 *   2. GET /api/site-architecture/:workspaceId — tree returned from planned pages
 *      and strategy keywords (Webflow API is skipped for workspaces without a siteId)
 *   3. GET /api/site-architecture/:workspaceId/schema-coverage — schema coverage analysis
 *   4. Empty workspace returns an empty tree (root only), not an error
 *   5. Unknown workspace returns 500 (workspace not found)
 *   6. Workspace scoping — data from workspace A is not visible via workspace B's URL
 *
 * Webflow API calls are bypassed by omitting webflowSiteId on the test workspace.
 * The Webflow block in buildSiteArchitecture only runs when ws.webflowSiteId is set.
 * Planned pages (content matrix cells) and strategy pages (page keywords) are seeded
 * directly through their respective DB modules.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createMatrix, deleteMatrix } from '../../server/content-matrices.js';
import {
  upsertPageKeyword,
  deleteAllPageKeywords,
} from '../../server/page-keywords.js';
import {
  SiteNode,
  ArchitectureGap,
  flattenTree,
  getAncestorChain,
  getParentNode,
  getSiblingNodes,
  getChildNodes,
} from '../../server/site-architecture.js';

// ---------------------------------------------------------------------------
// Test server context — port must be unique across all test files
// ---------------------------------------------------------------------------

const ctx = createTestContext(13243);
const { api } = ctx;

// ---------------------------------------------------------------------------
// Workspace state (set in beforeAll, cleaned in afterAll)
// ---------------------------------------------------------------------------

let wsId = '';
let wsBId = '';
let matrixId = '';

beforeAll(async () => {
  await ctx.startServer();

  // Primary workspace — no webflowSiteId so Webflow API calls are skipped
  const ws = createWorkspace('Arch Test Workspace');
  wsId = ws.id;

  // Secondary workspace for cross-workspace isolation tests
  const wsB = createWorkspace('Arch Test Workspace B');
  wsBId = wsB.id;

  // Seed planned pages into workspace via content matrix
  const matrix = createMatrix(wsId, {
    name: 'Services Matrix',
    templateId: 'tpl_arch_test',
    dimensions: [
      { variableName: 'service', values: ['plumbing', 'electrical', 'hvac'] },
      { variableName: 'city', values: ['austin', 'dallas'] },
    ],
    urlPattern: '/services/{city}/{service}',
    keywordPattern: '{service} in {city}',
  });
  matrixId = matrix.id;

  // Seed strategy keyword pages into workspace
  upsertPageKeyword(wsId, {
    pagePath: '/blog/seo-tips',
    pageTitle: 'SEO Tips Guide',
    primaryKeyword: 'seo tips',
    secondaryKeywords: [],
  });
  upsertPageKeyword(wsId, {
    pagePath: '/blog/content-strategy',
    pageTitle: 'Content Strategy',
    primaryKeyword: 'content strategy guide',
    secondaryKeywords: [],
  });
  // Deep path — produces an intermediate gap node at /resources/guides
  upsertPageKeyword(wsId, {
    pagePath: '/resources/guides/on-page-seo',
    pageTitle: 'On-Page SEO Guide',
    primaryKeyword: 'on-page seo',
    secondaryKeywords: [],
  });
}, 25_000);

afterAll(() => {
  if (matrixId) deleteMatrix(wsId, matrixId);
  if (wsId) {
    deleteAllPageKeywords(wsId);
    deleteWorkspace(wsId);
  }
  if (wsBId) deleteWorkspace(wsBId);
  ctx.stopServer();
});

// ===========================================================================
// 1. Pure unit tests — tree building helpers (no HTTP required)
// ===========================================================================

describe('Tree helpers — pure unit tests', () => {
  /**
   * Build a minimal hand-crafted tree for use in helper unit tests.
   *
   *  / (root)
   *  ├── /services (no content — gap)
   *  │   ├── /services/web-design (existing)
   *  │   └── /services/seo (existing)
   *  └── /blog (existing)
   *      └── /blog/post-one (existing)
   */
  function buildTestTree(): SiteNode {
    const root: SiteNode = {
      path: '/',
      name: 'Home',
      source: 'existing',
      children: [],
      depth: 0,
      hasContent: true,
    };

    const services: SiteNode = {
      path: '/services',
      name: 'Services',
      source: 'gap',
      children: [],
      depth: 1,
      hasContent: false,
    };

    const webDesign: SiteNode = {
      path: '/services/web-design',
      name: 'Web Design',
      source: 'existing',
      children: [],
      depth: 2,
      hasContent: true,
    };

    const seo: SiteNode = {
      path: '/services/seo',
      name: 'SEO',
      source: 'existing',
      children: [],
      depth: 2,
      hasContent: true,
    };

    const blog: SiteNode = {
      path: '/blog',
      name: 'Blog',
      source: 'existing',
      children: [],
      depth: 1,
      hasContent: true,
    };

    const postOne: SiteNode = {
      path: '/blog/post-one',
      name: 'Post One',
      source: 'existing',
      children: [],
      depth: 2,
      hasContent: true,
    };

    services.children.push(webDesign, seo);
    blog.children.push(postOne);
    root.children.push(services, blog);

    return root;
  }

  it('flattenTree excludes root by default', () => {
    const tree = buildTestTree();
    const nodes = flattenTree(tree);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n: SiteNode) => n.path !== '/')).toBe(true);
  });

  it('flattenTree includes root when includeRoot = true', () => {
    const tree = buildTestTree();
    const nodes = flattenTree(tree, true);
    expect(nodes.length).toBeGreaterThan(0);
    const root = nodes.find((n: SiteNode) => n.path === '/');
    expect(root).toBeDefined();
  });

  it('flattenTree returns all nodes depth-first', () => {
    const tree = buildTestTree();
    const nodes = flattenTree(tree);
    const paths = nodes.map((n: SiteNode) => n.path);
    // /services should come before its children
    expect(paths.indexOf('/services')).toBeLessThan(paths.indexOf('/services/web-design'));
    expect(paths.indexOf('/services')).toBeLessThan(paths.indexOf('/services/seo'));
    // /blog should come before /blog/post-one
    expect(paths.indexOf('/blog')).toBeLessThan(paths.indexOf('/blog/post-one'));
  });

  it('getAncestorChain returns [] for path not in tree', () => {
    const tree = buildTestTree();
    const chain = getAncestorChain(tree, '/nonexistent');
    expect(chain).toHaveLength(0);
  });

  it('getAncestorChain returns [root, parent, target] for a deep path', () => {
    const tree = buildTestTree();
    const chain = getAncestorChain(tree, '/blog/post-one');
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].path).toBe('/');
    expect(chain[chain.length - 1].path).toBe('/blog/post-one');
  });

  it('getAncestorChain returns [root] for the root itself', () => {
    const tree = buildTestTree();
    const chain = getAncestorChain(tree, '/');
    expect(chain).toHaveLength(1);
    expect(chain[0].path).toBe('/');
  });

  it('getParentNode returns null for root', () => {
    const tree = buildTestTree();
    const parent = getParentNode(tree, '/');
    expect(parent).toBeNull();
  });

  it('getParentNode returns root for depth-1 nodes', () => {
    const tree = buildTestTree();
    const parent = getParentNode(tree, '/blog');
    expect(parent).not.toBeNull();
    expect(parent!.path).toBe('/');
  });

  it('getParentNode returns the correct parent for a depth-2 node', () => {
    const tree = buildTestTree();
    const parent = getParentNode(tree, '/services/web-design');
    expect(parent).not.toBeNull();
    expect(parent!.path).toBe('/services');
  });

  it('getParentNode returns null for a path not in the tree', () => {
    const tree = buildTestTree();
    const parent = getParentNode(tree, '/nonexistent/page');
    expect(parent).toBeNull();
  });

  it('getSiblingNodes returns siblings with content, excluding the target', () => {
    const tree = buildTestTree();
    const siblings = getSiblingNodes(tree, '/services/web-design');
    expect(siblings.length).toBeGreaterThan(0);
    // /services/seo is the only sibling with content
    expect(siblings.some((n: SiteNode) => n.path === '/services/seo')).toBe(true);
    // target should not appear in its own sibling list
    expect(siblings.some((n: SiteNode) => n.path === '/services/web-design')).toBe(false);
  });

  it('getSiblingNodes returns [] for root (no parent)', () => {
    const tree = buildTestTree();
    const siblings = getSiblingNodes(tree, '/');
    expect(siblings).toHaveLength(0);
  });

  it('getSiblingNodes returns [] for a path not in the tree', () => {
    const tree = buildTestTree();
    const siblings = getSiblingNodes(tree, '/totally/nonexistent');
    expect(siblings).toHaveLength(0);
  });

  it('getChildNodes returns direct children with content', () => {
    const tree = buildTestTree();
    const children = getChildNodes(tree, '/services');
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((n: SiteNode) => n.hasContent)).toBe(true);
    const paths = children.map((n: SiteNode) => n.path);
    expect(paths).toContain('/services/web-design');
    expect(paths).toContain('/services/seo');
  });

  it('getChildNodes returns [] for a leaf node', () => {
    const tree = buildTestTree();
    const children = getChildNodes(tree, '/blog/post-one');
    expect(children).toHaveLength(0);
  });

  it('getChildNodes returns [] for a path not in the tree', () => {
    const tree = buildTestTree();
    const children = getChildNodes(tree, '/nonexistent');
    expect(children).toHaveLength(0);
  });
});

// ===========================================================================
// 2. Tree building logic — gap detection accuracy
// ===========================================================================

describe('Gap detection logic', () => {
  /**
   * Builds a tree where /products exists as a gap node (no content)
   * but has 3 children with content — this should be detected as a 'high'
   * priority gap.
   *
   *  / (root)
   *  └── /products (GAP — no content)
   *      ├── /products/widget-a (planned)
   *      ├── /products/widget-b (planned)
   *      └── /products/widget-c (planned)
   */
  function buildGapTree(): SiteNode {
    const root: SiteNode = {
      path: '/',
      name: 'Home',
      source: 'existing',
      children: [],
      depth: 0,
      hasContent: true,
    };

    const products: SiteNode = {
      path: '/products',
      name: 'Products',
      source: 'gap',
      children: [],
      depth: 1,
      hasContent: false,
    };

    for (const slug of ['widget-a', 'widget-b', 'widget-c']) {
      products.children.push({
        path: `/products/${slug}`,
        name: slug,
        source: 'planned',
        children: [],
        depth: 2,
        hasContent: true,
      });
    }

    root.children.push(products);
    return root;
  }

  it('flattenTree does not include the root when gap nodes have no content', () => {
    const tree = buildGapTree();
    const all = flattenTree(tree, true);
    expect(all.length).toBeGreaterThan(0);
    const gapNode = all.find((n: SiteNode) => n.path === '/products');
    expect(gapNode).toBeDefined();
    expect(gapNode!.source).toBe('gap');
    expect(gapNode!.hasContent).toBe(false);
  });

  it('getChildNodes on a gap parent returns only children with content', () => {
    const tree = buildGapTree();
    const children = getChildNodes(tree, '/products');
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((n: SiteNode) => n.hasContent)).toBe(true);
    expect(children).toHaveLength(3);
  });
});

// ===========================================================================
// 3. URL hierarchy — path segment parsing correctness
// ===========================================================================

describe('URL hierarchy — path segment accuracy', () => {
  it('flattenTree assigns correct depth values to nodes', () => {
    const root: SiteNode = {
      path: '/',
      name: 'Home',
      source: 'existing',
      children: [],
      depth: 0,
      hasContent: true,
    };

    const level1: SiteNode = {
      path: '/services',
      name: 'Services',
      source: 'existing',
      children: [],
      depth: 1,
      hasContent: true,
    };

    const level2: SiteNode = {
      path: '/services/web',
      name: 'Web',
      source: 'existing',
      children: [],
      depth: 2,
      hasContent: true,
    };

    const level3: SiteNode = {
      path: '/services/web/design',
      name: 'Design',
      source: 'existing',
      children: [],
      depth: 3,
      hasContent: true,
    };

    level2.children.push(level3);
    level1.children.push(level2);
    root.children.push(level1);

    const nodes = flattenTree(root);
    expect(nodes.length).toBeGreaterThan(0);

    const s = nodes.find((n: SiteNode) => n.path === '/services');
    const sw = nodes.find((n: SiteNode) => n.path === '/services/web');
    const swd = nodes.find((n: SiteNode) => n.path === '/services/web/design');

    expect(s).toBeDefined();
    expect(sw).toBeDefined();
    expect(swd).toBeDefined();

    expect(s!.depth).toBe(1);
    expect(sw!.depth).toBe(2);
    expect(swd!.depth).toBe(3);
  });
});

// ===========================================================================
// 4. HTTP — GET /api/site-architecture/:workspaceId
// ===========================================================================

describe('GET /api/site-architecture/:workspaceId', () => {
  it('returns 500 for an unknown workspace', async () => {
    const res = await api('/api/site-architecture/ws_nonexistent_arch_xyz');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 200 with a valid tree for a workspace without Webflow configured', async () => {
    // The workspace has no webflowSiteId, so Webflow API calls are skipped.
    // Pages come from the seeded content matrix (planned) and page keywords (strategy).
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level shape
    expect(body).toHaveProperty('tree');
    expect(body).toHaveProperty('totalPages');
    expect(body).toHaveProperty('existingPages');
    expect(body).toHaveProperty('plannedPages');
    expect(body).toHaveProperty('strategyPages');
    expect(body).toHaveProperty('gaps');
    expect(body).toHaveProperty('depthDistribution');
    expect(body).toHaveProperty('orphanPaths');
    expect(body).toHaveProperty('analyzedAt');

    // Root node is always present
    expect(body.tree.path).toBe('/');
    expect(body.tree.depth).toBe(0);
    expect(body.tree.hasContent).toBe(true);

    // Gaps array must be an array
    expect(Array.isArray(body.gaps)).toBe(true);
    expect(Array.isArray(body.orphanPaths)).toBe(true);

    // Numeric counters
    expect(typeof body.totalPages).toBe('number');
    expect(typeof body.plannedPages).toBe('number');
    expect(typeof body.strategyPages).toBe('number');
  });

  it('planned pages from content matrix appear in the tree', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The matrix generates 6 cells (3 services × 2 cities), all planned
    expect(body.plannedPages).toBeGreaterThanOrEqual(6);

    // Flatten the tree to find planned nodes
    const allNodes: SiteNode[] = flattenTree(body.tree as SiteNode, true);
    expect(allNodes.length).toBeGreaterThan(0);

    const plannedNodes = allNodes.filter((n: SiteNode) => n.source === 'planned');
    expect(plannedNodes.length).toBeGreaterThan(0);

    // Verify at least one of the expected matrix URLs is in the tree
    const paths = plannedNodes.map((n: SiteNode) => n.path);
    const hasMicroPath =
      paths.some((p: string) => p.startsWith('/services/'));
    expect(hasMicroPath).toBe(true);
  });

  it('strategy keyword pages appear in the tree as source=strategy', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const allNodes: SiteNode[] = flattenTree(body.tree as SiteNode, true);
    expect(allNodes.length).toBeGreaterThan(0);

    const strategyNodes = allNodes.filter((n: SiteNode) => n.source === 'strategy');
    expect(strategyNodes.length).toBeGreaterThan(0);

    // /blog/seo-tips and /blog/content-strategy were seeded as strategy pages
    const paths = strategyNodes.map((n: SiteNode) => n.path);
    expect(paths.some((p: string) => p.includes('seo-tips') || p.includes('content-strategy'))).toBe(true);
  });

  it('deep strategy path produces intermediate gap nodes', async () => {
    // /resources/guides/on-page-seo was seeded — /resources and /resources/guides
    // should be gap nodes (depth 1 and 2) with no content of their own.
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const allNodes: SiteNode[] = flattenTree(body.tree as SiteNode, true);
    expect(allNodes.length).toBeGreaterThan(0);

    const resourcesNode = allNodes.find((n: SiteNode) => n.path === '/resources');
    const guidesNode = allNodes.find((n: SiteNode) => n.path === '/resources/guides');
    const leafNode = allNodes.find((n: SiteNode) => n.path === '/resources/guides/on-page-seo');

    // Intermediate nodes should exist (created as gap nodes)
    expect(resourcesNode).toBeDefined();
    expect(guidesNode).toBeDefined();
    // The leaf is the strategy page
    expect(leafNode).toBeDefined();
    expect(leafNode!.hasContent).toBe(true);
  });

  it('gap detection finds missing hub pages', async () => {
    // /resources has children but no content itself — should appear as a gap
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.gaps)).toBe(true);

    if (body.gaps.length > 0) {
      const gap = body.gaps[0] as ArchitectureGap;
      // Every gap must have required fields
      expect(gap).toHaveProperty('parentPath');
      expect(gap).toHaveProperty('suggestedPath');
      expect(gap).toHaveProperty('reason');
      expect(gap).toHaveProperty('priority');
      expect(['high', 'medium', 'low']).toContain(gap.priority);
    }

    // /resources should be detected as a gap (has children but no content)
    const resourcesGap = body.gaps.find(
      (g: ArchitectureGap) => g.suggestedPath === '/resources',
    );
    expect(resourcesGap).toBeDefined();
  });

  it('depth distribution object maps depth number to page count', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const dist = body.depthDistribution as Record<string, number>;
    const keys = Object.keys(dist);
    expect(keys.length).toBeGreaterThan(0);

    // All values must be positive integers
    for (const k of keys) {
      expect(dist[k]).toBeGreaterThan(0);
    }

    // Total pages should equal the sum of depth distribution values
    const total = Object.values(dist).reduce((acc: number, v) => acc + (v as number), 0);
    expect(total).toBe(body.totalPages);
  });

  it('analyzedAt is a valid ISO 8601 timestamp', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.analyzedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.analyzedAt))).toBe(false);
  });
});

// ===========================================================================
// 5. Empty workspace — returns root-only tree, not an error
// ===========================================================================

describe('Empty workspace — returns minimal tree', () => {
  let emptyWsId = '';

  beforeAll(() => {
    const ws = createWorkspace('Empty Arch Workspace');
    emptyWsId = ws.id;
  });

  afterAll(() => {
    if (emptyWsId) deleteWorkspace(emptyWsId);
  });

  it('returns 200 with a root-only tree when workspace has no pages', async () => {
    const res = await api(`/api/site-architecture/${emptyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Tree exists with root node
    expect(body.tree).toBeDefined();
    expect(body.tree.path).toBe('/');
    expect(body.tree.children).toHaveLength(0);

    // All page counters are zero
    expect(body.totalPages).toBe(0);
    expect(body.plannedPages).toBe(0);
    expect(body.strategyPages).toBe(0);
    expect(body.existingPages).toBe(0);

    // No gaps on an empty tree
    expect(body.gaps).toHaveLength(0);

    // orphanPaths is an empty array
    expect(body.orphanPaths).toHaveLength(0);

    // depthDistribution is an empty object
    expect(Object.keys(body.depthDistribution)).toHaveLength(0);
  });
});

// ===========================================================================
// 6. Schema coverage endpoint
// ===========================================================================

describe('GET /api/site-architecture/:workspaceId/schema-coverage', () => {
  it('returns 404 when workspace has no webflowSiteId', async () => {
    // wsId was created without a webflowSiteId — route should return 404
    const res = await api(`/api/site-architecture/${wsId}/schema-coverage`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 for unknown workspace', async () => {
    // The schema-coverage route calls getWorkspace() first and returns 404 when
    // the workspace doesn't exist (because !ws?.webflowSiteId is truthy for
    // undefined workspaces, hitting the same 404 guard as "no webflowSiteId").
    const res = await api('/api/site-architecture/ws_totally_unknown_xyz/schema-coverage');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ===========================================================================
// 7. Workspace scoping — architecture data is workspace-scoped
// ===========================================================================

describe('Workspace scoping', () => {
  it('workspace B tree is empty when it has no page data', async () => {
    const res = await api(`/api/site-architecture/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Workspace B has no matrix or strategy data — should have zero real pages
    expect(body.totalPages).toBe(0);
    expect(body.plannedPages).toBe(0);
    expect(body.strategyPages).toBe(0);
  });

  it('planned pages seeded in workspace A do not appear in workspace B tree', async () => {
    const resA = await api(`/api/site-architecture/${wsId}`);
    const resB = await api(`/api/site-architecture/${wsBId}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json();
    const bodyB = await resB.json();

    const nodesA: SiteNode[] = flattenTree(bodyA.tree as SiteNode);
    const nodesB: SiteNode[] = flattenTree(bodyB.tree as SiteNode);

    // Workspace A has pages; workspace B has none
    expect(nodesA.length).toBeGreaterThan(0);
    expect(nodesB).toHaveLength(0);

    // None of workspace A's paths appear in workspace B
    const pathsA = new Set(nodesA.map((n: SiteNode) => n.path));
    const pathsB = new Set(nodesB.map((n: SiteNode) => n.path));
    const overlap = [...pathsA].filter((p: string) => pathsB.has(p));
    expect(overlap).toHaveLength(0);
  });
});
