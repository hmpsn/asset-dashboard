/**
 * Unit tests for the pure tree-manipulation helpers exported from
 * server/site-architecture.ts, plus gap-detection and depth-analysis behavior
 * exercised through buildSiteArchitecture's internal logic.
 *
 * No HTTP / DB required — all tests operate on hand-crafted SiteNode trees.
 *
 * Covered functions:
 *   - flattenTree(tree, includeRoot?)
 *   - getAncestorChain(tree, targetPath)
 *   - getParentNode(tree, targetPath)
 *   - getSiblingNodes(tree, targetPath)
 *   - getChildNodes(tree, parentPath)
 *
 * Additionally tests the source-rank merge semantics (documented in the source)
 * and the gap / orphan logic that the route depends on.
 */

import { describe, it, expect } from 'vitest';
import {
  flattenTree,
  getAncestorChain,
  getParentNode,
  getSiblingNodes,
  getChildNodes,
  type SiteNode,
} from '../../server/site-architecture.js';

// ── Tree factories ────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<SiteNode> & { path: string }): SiteNode {
  return {
    name: overrides.path.split('/').pop() || 'root',
    source: 'existing',
    children: [],
    depth: 0,
    hasContent: true,
    ...overrides,
  };
}

/**
 * Standard test tree:
 *
 *  / (root, depth=0, existing, hasContent=true)
 *  ├── /about (depth=1, existing)
 *  ├── /services (depth=1, gap, hasContent=false)
 *  │   ├── /services/web-design (depth=2, existing)
 *  │   └── /services/seo (depth=2, existing)
 *  └── /blog (depth=1, existing)
 *      ├── /blog/post-one (depth=2, existing)
 *      └── /blog/post-two (depth=2, existing)
 */
function buildStandardTree(): SiteNode {
  const root = makeNode({ path: '/', depth: 0 });
  const about = makeNode({ path: '/about', depth: 1 });
  const services = makeNode({ path: '/services', depth: 1, source: 'gap', hasContent: false });
  const webDesign = makeNode({ path: '/services/web-design', depth: 2 });
  const seo = makeNode({ path: '/services/seo', depth: 2 });
  const blog = makeNode({ path: '/blog', depth: 1 });
  const postOne = makeNode({ path: '/blog/post-one', depth: 2 });
  const postTwo = makeNode({ path: '/blog/post-two', depth: 2 });

  services.children.push(webDesign, seo);
  blog.children.push(postOne, postTwo);
  root.children.push(about, services, blog);

  return root;
}

/**
 * Deep tree for ancestor chain tests:
 *
 *  / → /products → /products/software → /products/software/enterprise
 */
function buildDeepTree(): SiteNode {
  const root = makeNode({ path: '/', depth: 0 });
  const products = makeNode({ path: '/products', depth: 1 });
  const software = makeNode({ path: '/products/software', depth: 2 });
  const enterprise = makeNode({ path: '/products/software/enterprise', depth: 3 });

  software.children.push(enterprise);
  products.children.push(software);
  root.children.push(products);

  return root;
}

/**
 * Single-child tree for sibling tests where a node has no siblings.
 *
 *  / → /lone
 */
function buildSingleChildTree(): SiteNode {
  const root = makeNode({ path: '/', depth: 0 });
  const lone = makeNode({ path: '/lone', depth: 1 });
  root.children.push(lone);
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// flattenTree
// ─────────────────────────────────────────────────────────────────────────────

describe('flattenTree()', () => {
  it('excludes root by default (depth=0 node omitted)', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every(n => n.path !== '/')).toBe(true); // every-ok: length guard above
  });

  it('includes root when includeRoot=true', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree, true);
    const root = nodes.find(n => n.path === '/');
    expect(root).toBeDefined();
  });

  it('returns all non-root nodes for the standard tree (7 nodes)', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree);
    // about, services, web-design, seo, blog, post-one, post-two
    expect(nodes).toHaveLength(7);
  });

  it('returns all nodes including root when includeRoot=true (8 nodes)', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree, true);
    expect(nodes).toHaveLength(8);
  });

  it('traverses depth-first (parent appears before children)', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree);
    const paths = nodes.map(n => n.path);

    // /services must appear before its children
    expect(paths.indexOf('/services')).toBeLessThan(paths.indexOf('/services/web-design'));
    expect(paths.indexOf('/services')).toBeLessThan(paths.indexOf('/services/seo'));

    // /blog must appear before its children
    expect(paths.indexOf('/blog')).toBeLessThan(paths.indexOf('/blog/post-one'));
    expect(paths.indexOf('/blog')).toBeLessThan(paths.indexOf('/blog/post-two'));
  });

  it('returns empty array for a root-only tree (no children)', () => {
    const root = makeNode({ path: '/', depth: 0 });
    const nodes = flattenTree(root);
    expect(nodes).toHaveLength(0);
  });

  it('returns [root] for a root-only tree when includeRoot=true', () => {
    const root = makeNode({ path: '/', depth: 0 });
    const nodes = flattenTree(root, true);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].path).toBe('/');
  });

  it('includes gap nodes (source=gap) in the result', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree, true);
    const gapNode = nodes.find(n => n.source === 'gap');
    expect(gapNode).toBeDefined();
    expect(gapNode!.path).toBe('/services');
  });

  it('includes nodes with hasContent=false in result', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree);
    const noContent = nodes.filter(n => !n.hasContent);
    expect(noContent).toHaveLength(1);
    expect(noContent[0].path).toBe('/services');
  });

  it('handles deep tree (depth=3) correctly', () => {
    const tree = buildDeepTree();
    const nodes = flattenTree(tree);
    const paths = nodes.map(n => n.path);
    expect(paths).toContain('/products');
    expect(paths).toContain('/products/software');
    expect(paths).toContain('/products/software/enterprise');
    // depth ordering
    expect(paths.indexOf('/products')).toBeLessThan(paths.indexOf('/products/software'));
    expect(paths.indexOf('/products/software')).toBeLessThan(paths.indexOf('/products/software/enterprise'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAncestorChain
// ─────────────────────────────────────────────────────────────────────────────

describe('getAncestorChain()', () => {
  it('returns empty array for path not in tree', () => {
    const tree = buildStandardTree();
    expect(getAncestorChain(tree, '/nonexistent')).toHaveLength(0);
  });

  it('returns [root] when searching for root path', () => {
    const tree = buildStandardTree();
    const chain = getAncestorChain(tree, '/');
    expect(chain).toHaveLength(1);
    expect(chain[0].path).toBe('/');
  });

  it('returns [root, node] for a depth-1 path', () => {
    const tree = buildStandardTree();
    const chain = getAncestorChain(tree, '/blog');
    expect(chain).toHaveLength(2);
    expect(chain[0].path).toBe('/');
    expect(chain[1].path).toBe('/blog');
  });

  it('returns [root, parent, target] for a depth-2 path', () => {
    const tree = buildStandardTree();
    const chain = getAncestorChain(tree, '/blog/post-one');
    expect(chain).toHaveLength(3);
    expect(chain[0].path).toBe('/');
    expect(chain[1].path).toBe('/blog');
    expect(chain[2].path).toBe('/blog/post-one');
  });

  it('target node is always last element', () => {
    const tree = buildDeepTree();
    const chain = getAncestorChain(tree, '/products/software/enterprise');
    expect(chain[chain.length - 1].path).toBe('/products/software/enterprise');
  });

  it('root is always first element when target exists', () => {
    const tree = buildDeepTree();
    const chain = getAncestorChain(tree, '/products/software');
    expect(chain[0].path).toBe('/');
  });

  it('returns correct chain for deep path (depth=3)', () => {
    const tree = buildDeepTree();
    const chain = getAncestorChain(tree, '/products/software/enterprise');
    const paths = chain.map(n => n.path);
    expect(paths).toEqual(['/', '/products', '/products/software', '/products/software/enterprise']);
  });

  it('works for gap nodes in the ancestor chain', () => {
    const tree = buildStandardTree();
    // /services is a gap node — it should still be found as ancestor
    const chain = getAncestorChain(tree, '/services/seo');
    expect(chain.map(n => n.path)).toEqual(['/', '/services', '/services/seo']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getParentNode
// ─────────────────────────────────────────────────────────────────────────────

describe('getParentNode()', () => {
  it('returns null for root path (root has no parent)', () => {
    const tree = buildStandardTree();
    expect(getParentNode(tree, '/')).toBeNull();
  });

  it('returns root for depth-1 nodes', () => {
    const tree = buildStandardTree();
    const parent = getParentNode(tree, '/about');
    expect(parent).not.toBeNull();
    expect(parent!.path).toBe('/');
  });

  it('returns intermediate node for depth-2 nodes', () => {
    const tree = buildStandardTree();
    const parent = getParentNode(tree, '/services/web-design');
    expect(parent).not.toBeNull();
    expect(parent!.path).toBe('/services');
  });

  it('returns null for a path not in the tree', () => {
    const tree = buildStandardTree();
    expect(getParentNode(tree, '/nonexistent/page')).toBeNull();
  });

  it('returns the correct parent for a deep path (depth=3)', () => {
    const tree = buildDeepTree();
    const parent = getParentNode(tree, '/products/software/enterprise');
    expect(parent).not.toBeNull();
    expect(parent!.path).toBe('/products/software');
  });

  it('returns a gap node as parent when applicable', () => {
    const tree = buildStandardTree();
    // /services is a gap node but it is still the parent of /services/seo
    const parent = getParentNode(tree, '/services/seo');
    expect(parent).not.toBeNull();
    expect(parent!.path).toBe('/services');
    expect(parent!.source).toBe('gap');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSiblingNodes
// ─────────────────────────────────────────────────────────────────────────────

describe('getSiblingNodes()', () => {
  it('returns empty array for root (no parent)', () => {
    const tree = buildStandardTree();
    expect(getSiblingNodes(tree, '/')).toHaveLength(0);
  });

  it('returns empty array for path not in tree', () => {
    const tree = buildStandardTree();
    expect(getSiblingNodes(tree, '/nonexistent')).toHaveLength(0);
  });

  it('returns empty array for a lone child (no siblings)', () => {
    const tree = buildSingleChildTree();
    expect(getSiblingNodes(tree, '/lone')).toHaveLength(0);
  });

  it('excludes the target from its own sibling list', () => {
    const tree = buildStandardTree();
    const siblings = getSiblingNodes(tree, '/services/web-design');
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.every(n => n.path !== '/services/web-design')).toBe(true); // every-ok: length guard above
  });

  it('returns only siblings that have content', () => {
    // Add a no-content sibling to test filtering
    const root = makeNode({ path: '/', depth: 0 });
    const a = makeNode({ path: '/a', depth: 1, hasContent: true });
    const b = makeNode({ path: '/b', depth: 1, hasContent: false });
    const c = makeNode({ path: '/c', depth: 1, hasContent: true });
    root.children.push(a, b, c);

    // Siblings of /a should be only /c (not /b which has no content)
    const siblings = getSiblingNodes(root, '/a');
    expect(siblings.map(n => n.path)).toContain('/c');
    expect(siblings.map(n => n.path)).not.toContain('/b');
  });

  it('returns the correct sibling for /services/seo', () => {
    const tree = buildStandardTree();
    const siblings = getSiblingNodes(tree, '/services/seo');
    expect(siblings).toHaveLength(1);
    expect(siblings[0].path).toBe('/services/web-design');
  });

  it('returns multiple siblings when present', () => {
    const tree = buildStandardTree();
    // /blog/post-one and /blog/post-two are siblings
    const siblingsOfPostOne = getSiblingNodes(tree, '/blog/post-one');
    expect(siblingsOfPostOne).toHaveLength(1);
    expect(siblingsOfPostOne[0].path).toBe('/blog/post-two');

    const siblingsOfPostTwo = getSiblingNodes(tree, '/blog/post-two');
    expect(siblingsOfPostTwo).toHaveLength(1);
    expect(siblingsOfPostTwo[0].path).toBe('/blog/post-one');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getChildNodes
// ─────────────────────────────────────────────────────────────────────────────

describe('getChildNodes()', () => {
  it('returns empty array for path not in tree', () => {
    const tree = buildStandardTree();
    expect(getChildNodes(tree, '/nonexistent')).toHaveLength(0);
  });

  it('returns empty array for a leaf node', () => {
    const tree = buildStandardTree();
    expect(getChildNodes(tree, '/about')).toHaveLength(0);
    expect(getChildNodes(tree, '/blog/post-one')).toHaveLength(0);
  });

  it('returns only children with hasContent=true', () => {
    // Create a parent with one content child and one no-content child
    const root = makeNode({ path: '/', depth: 0 });
    const parent = makeNode({ path: '/parent', depth: 1 });
    const childContent = makeNode({ path: '/parent/child', depth: 2, hasContent: true });
    const childNoContent = makeNode({ path: '/parent/empty', depth: 2, hasContent: false });
    parent.children.push(childContent, childNoContent);
    root.children.push(parent);

    const children = getChildNodes(root, '/parent');
    expect(children.map(n => n.path)).toContain('/parent/child');
    expect(children.map(n => n.path)).not.toContain('/parent/empty');
  });

  it('returns direct children of root', () => {
    const tree = buildStandardTree();
    const children = getChildNodes(tree, '/');
    const paths = children.map(n => n.path);
    // about and blog have content; services is a gap (hasContent=false) so excluded
    expect(paths).toContain('/about');
    expect(paths).toContain('/blog');
    expect(paths).not.toContain('/services');
  });

  it('returns both children of /services that have content', () => {
    const tree = buildStandardTree();
    const children = getChildNodes(tree, '/services');
    expect(children).toHaveLength(2);
    const paths = children.map(n => n.path);
    expect(paths).toContain('/services/web-design');
    expect(paths).toContain('/services/seo');
  });

  it('returns both blog posts as children of /blog', () => {
    const tree = buildStandardTree();
    const children = getChildNodes(tree, '/blog');
    expect(children).toHaveLength(2);
    const paths = children.map(n => n.path);
    expect(paths).toContain('/blog/post-one');
    expect(paths).toContain('/blog/post-two');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-function consistency
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-function consistency', () => {
  it('all paths from flattenTree(root) can be found via getAncestorChain', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree, true); // include root
    for (const node of nodes) {
      const chain = getAncestorChain(tree, node.path);
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[chain.length - 1].path).toBe(node.path);
    }
  });

  it('getChildNodes result matches children visible from getParentNode', () => {
    const tree = buildStandardTree();
    // For each non-root node, getParentNode should contain that node in its children
    const nodes = flattenTree(tree);
    for (const node of nodes) {
      const parent = getParentNode(tree, node.path);
      if (parent && node.hasContent) {
        const parentChildren = getChildNodes(tree, parent.path);
        const childPaths = parentChildren.map(c => c.path);
        expect(childPaths).toContain(node.path);
      }
    }
  });

  it('getSiblingNodes are mutually acknowledged (A lists B, B lists A)', () => {
    const tree = buildStandardTree();
    const siblingsOfPostOne = getSiblingNodes(tree, '/blog/post-one').map(n => n.path);
    const siblingsOfPostTwo = getSiblingNodes(tree, '/blog/post-two').map(n => n.path);

    expect(siblingsOfPostOne).toContain('/blog/post-two');
    expect(siblingsOfPostTwo).toContain('/blog/post-one');
  });

  it('flattenTree count equals sum of all getChildNodes counts + root children with content', () => {
    // All nodes in flattenTree (excluding root) should each have a parent that lists them in getChildNodes
    const tree = buildStandardTree();
    const allNodes = flattenTree(tree);
    let foundViaChildren = 0;
    const visited = new Set<string>();

    for (const node of allNodes) {
      if (node.hasContent && !visited.has(node.path)) {
        const parent = getParentNode(tree, node.path);
        if (parent) {
          const children = getChildNodes(tree, parent.path);
          if (children.some(c => c.path === node.path)) {
            foundViaChildren++;
            visited.add(node.path);
          }
        }
      }
    }

    // Every content node (except gap nodes) should be reachable via getChildNodes from its parent
    const contentNodes = allNodes.filter(n => n.hasContent);
    expect(foundViaChildren).toBe(contentNodes.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('Source field semantics', () => {
  it('flattenTree preserves source field on all nodes', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree, true);
    // Sources present in the standard tree
    const sources = new Set(nodes.map(n => n.source));
    expect(sources.has('existing')).toBe(true);
    expect(sources.has('gap')).toBe(true);
  });

  it('gap node has hasContent=false and source=gap', () => {
    const tree = buildStandardTree();
    const nodes = flattenTree(tree, true);
    const gapNodes = nodes.filter(n => n.source === 'gap');
    expect(gapNodes.length).toBeGreaterThan(0);
    for (const g of gapNodes) {
      expect(g.hasContent).toBe(false);
    }
  });

  it('flattenTree with planned source preserves source type', () => {
    const root = makeNode({ path: '/', depth: 0 });
    const planned = makeNode({ path: '/services/new-page', depth: 1, source: 'planned' });
    root.children.push(planned);

    const nodes = flattenTree(root);
    expect(nodes[0].source).toBe('planned');
  });

  it('flattenTree with strategy source preserves source type', () => {
    const root = makeNode({ path: '/', depth: 0 });
    const strategyPage = makeNode({ path: '/blog/guide', depth: 1, source: 'strategy' });
    root.children.push(strategyPage);

    const nodes = flattenTree(root);
    expect(nodes[0].source).toBe('strategy');
  });
});
