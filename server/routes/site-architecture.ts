/**
 * Site Architecture Planner routes.
 *
 * GET /api/site-architecture/:workspaceId — build and return the full URL tree
 * GET /api/site-architecture/:workspaceId/schema-coverage — cross-reference with schema snapshot
 */
import { Router } from 'express';
import { buildSiteArchitecture, getCachedArchitecture, flattenTree } from '../site-architecture.js';
import { getSchemaSnapshot } from '../schema-store.js';
import { getWorkspace } from '../workspaces.js';
import { getSchemaPlan } from '../schema-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:site-architecture');
const router = Router();

router.get('/api/site-architecture/:workspaceId', async (req, res) => {
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
router.get('/api/site-architecture/:workspaceId/schema-coverage', async (req, res) => {
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
        } catch { /* skip malformed URLs */ }
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

    const coverage: Array<{
      path: string;
      name: string;
      hasSchema: boolean;
      schemaTypes: string[];
      role: string | null;
      depth: number;
      pageType: string | null;
    }> = existingNodes.map(n => ({
      path: n.path,
      name: n.name,
      hasSchema: schemaPathSet.has(n.path),
      schemaTypes: schemaTypeMap.get(n.path) || [],
      role: roleMap.get(n.path) || null,
      depth: n.depth,
      pageType: n.pageType || null,
    }));

    const withSchema = coverage.filter(c => c.hasSchema).length;
    const withoutSchema = coverage.filter(c => !c.hasSchema).length;
    const pct = existingNodes.length > 0 ? Math.round((withSchema / existingNodes.length) * 100) : 0;

    res.json({
      totalExisting: existingNodes.length,
      withSchema,
      withoutSchema,
      coveragePct: pct,
      snapshotDate: snapshot?.createdAt || null,
      hasPlan: !!plan,
      pages: coverage,
    });
  } catch (err) {
    log.error({ err }, 'Schema coverage error');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
