/**
 * Competitor Schema Intelligence routes (D4)
 */
import { Router } from 'express';
import { crawlCompetitorSchemas, compareSchemas } from '../competitor-schema.js';
import { getWorkspace } from '../workspaces.js';
import { getSchemaSnapshot } from '../schema-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes/competitor-schema');
import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

/**
 * GET /api/competitor-schema/:workspaceId
 * Crawl competitor domains (from workspace config), extract JSON-LD, compare coverage.
 */
router.get('/api/competitor-schema/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const domains = ws.competitorDomains;
    if (!domains || domains.length === 0) {
      return res.json({ competitors: [], comparisons: [] });
    }

    // Determine our site's schema types from the snapshot
    const ourTypes: string[] = [];
    let ourTotalPages = 0;
    let ourPagesWithSchema = 0;
    if (ws.webflowSiteId) {
      const snapshot = getSchemaSnapshot(ws.webflowSiteId);
      if (snapshot && Array.isArray(snapshot.results)) {
        ourTotalPages = snapshot.results.length;
        for (const page of snapshot.results) {
          // Collect from existingSchemas + suggestedSchemas
          const types: string[] = [...(page.existingSchemas || [])];
          if (page.suggestedSchemas) {
            for (const s of page.suggestedSchemas) {
              if (s.type && !types.includes(s.type)) types.push(s.type);
            }
          }
          if (types.length > 0) {
            ourPagesWithSchema++;
            for (const t of types) {
              if (!ourTypes.includes(t)) ourTypes.push(t);
            }
          }
        }
      }
    }

    const ourCoverage = ourTotalPages > 0 ? Math.round((ourPagesWithSchema / ourTotalPages) * 100) : 0;

    // Crawl all competitors (cached — won't re-crawl within 24h)
    const competitors = await Promise.all(
      domains.map(domain => crawlCompetitorSchemas(domain).catch(err => {
        log.warn({ domain, err }, 'Failed to crawl competitor');
        return null;
      })),
    );

    const validCompetitors = competitors.filter((c): c is NonNullable<typeof c> => c !== null);

    // Compare each competitor against our schema types
    const comparisons = validCompetitors.map(comp => {
      const comparison = compareSchemas(ourTypes, comp);
      comparison.ourCoverage = ourCoverage;
      return comparison;
    });

    res.json({ competitors: validCompetitors, comparisons });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'Competitor schema analysis failed');
    res.status(500).json({ error: `Competitor schema analysis failed: ${msg}` });
  }
});

export default router;
