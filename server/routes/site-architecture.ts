/**
 * Site Architecture Planner routes.
 *
 * GET /api/site-architecture/:workspaceId — build and return the full URL tree
 * GET /api/site-architecture/:workspaceId/schema-coverage — cross-reference with schema snapshot
 */
import { Router } from 'express';
import { buildSiteArchitecture, getCachedArchitecture, flattenTree } from '../site-architecture.js';
import { getSchemaSnapshot, getSchemaPlan } from '../schema-store.js';
import { getWorkspace } from '../workspaces.js';
import { getInternalLinks } from '../performance-store.js';
import type { PageLinkHealth, InternalLinkResult } from '../internal-links.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:site-architecture');
import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

router.get('/api/site-architecture/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const result = await buildSiteArchitecture(req.params.workspaceId);
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Failed to build site architecture');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// Schema coverage: cross-reference architecture tree with schema snapshot
router.get('/api/site-architecture/:workspaceId/schema-coverage', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws?.webflowSiteId) return res.status(404).json({ error: 'Workspace or site not found' });

    const arch = await getCachedArchitecture(req.params.workspaceId);
    const snapshot = getSchemaSnapshot(ws.webflowSiteId);
    const plan = getSchemaPlan(ws.webflowSiteId);

    // Build a set of paths that have schema
    const schemaPathSet = new Set<string>();
    const schemaTypeMap = new Map<string, string[]>(); // path → schema @types
    if (snapshot?.results) {
      for (const page of snapshot.results) {
        // Normalize URL to path
        try {
          const url = new URL(page.url);
          const p = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
          schemaPathSet.add(p);
          const types = page.suggestedSchemas?.map(s => s.type) || [];
          schemaTypeMap.set(p, types);
        } catch (err) { /* skip malformed URLs */ }
      }
    }

    // Build plan role map
    const roleMap = new Map<string, string>();
    if (plan?.pageRoles) {
      for (const pr of plan.pageRoles) {
        roleMap.set(pr.pagePath, pr.role);
      }
    }

    // Walk the tree and annotate each existing page
    const nodes = flattenTree(arch.tree, true);
    const existingNodes = nodes.filter(n => n.source === 'existing');

    // Load internal link health data
    const linkData = getInternalLinks(ws.webflowSiteId) as InternalLinkResult | null;
    const linkHealthMap = new Map<string, PageLinkHealth>();
    if (linkData?.pageHealth) {
      for (const ph of linkData.pageHealth) {
        const normalized = ph.path === '/' ? '/' : ph.path.replace(/\/$/, '');
        linkHealthMap.set(normalized, ph);
      }
    }

    // Walk the tree and annotate each existing page with coverage + link health + priority
    type SchemaPriority = 'critical' | 'high' | 'medium' | 'low' | 'done';

    const coverage = existingNodes.map(n => {
      const hasSchema = schemaPathSet.has(n.path);
      const lh = linkHealthMap.get(n.path);

      // Priority scoring
      let priority: SchemaPriority = 'done';
      if (!hasSchema) {
        if (lh?.isOrphan) priority = 'critical';         // orphan + no schema
        else if (lh && lh.inboundLinks < 3) priority = 'high'; // few links + no schema
        else priority = 'medium';                         // no schema but decent links
      } else if (lh && (lh.isOrphan || lh.score < 30)) {
        priority = 'low';                                 // has schema but poor links
      }

      return {
        path: n.path,
        name: n.name,
        hasSchema,
        schemaTypes: schemaTypeMap.get(n.path) || [],
        role: roleMap.get(n.path) || null,
        depth: n.depth,
        pageType: n.pageType || null,
        inboundLinks: lh?.inboundLinks ?? null,
        outboundLinks: lh?.outboundLinks ?? null,
        isOrphan: lh?.isOrphan ?? null,
        linkScore: lh?.score ?? null,
        priority,
      };
    });

    const withSchema = coverage.filter(c => c.hasSchema).length;
    const withoutSchema = coverage.filter(c => !c.hasSchema).length;
    const pct = existingNodes.length > 0 ? Math.round((withSchema / existingNodes.length) * 100) : 0;

    // Build priority queue (sorted: critical → high → medium → low, skip 'done')
    const priorityOrder: Record<SchemaPriority, number> = { critical: 0, high: 1, medium: 2, low: 3, done: 4 };
    const priorityQueue = coverage
      .filter(c => c.priority !== 'done')
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    res.json({
      totalExisting: existingNodes.length,
      withSchema,
      withoutSchema,
      coveragePct: pct,
      snapshotDate: snapshot?.createdAt || null,
      hasPlan: !!plan,
      hasLinkData: !!linkData?.pageHealth,
      pages: coverage,
      priorityQueue,
    });
  } catch (err) {
    log.error({ err }, 'Schema coverage error');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
