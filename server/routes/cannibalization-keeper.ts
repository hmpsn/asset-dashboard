/**
 * cannibalization-keeper — dedicated router for the keeper-override endpoint.
 *
 * Mounted beside the recommendations router in server/app.ts. Kept as a small
 * dedicated router (not in routes/recommendations.ts) to avoid collision with
 * the Phase-2 hotspot (recommendations.ts is the single-owner hotspot for the
 * loop lane). Note: this deviation from the original "add a block in
 * routes/recommendations.ts" spec is documented in the Lane 1E plan notes.
 *
 * Route:
 *   PATCH /api/recommendations/:workspaceId/cannibalization/:urlSetKey/keeper
 *   Body: { keeperPath: string }
 *   Auth: requireWorkspaceAccess (admin HMAC gate)
 *
 * See: server/cannibalization-keeper-override.ts
 * See: server/db/migrations/141-cannibalization-keeper-override.sql
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { createLogger } from '../logger.js';
import { setKeeperOverride } from '../cannibalization-keeper-override.js';
import { toPageSlug } from '../../shared/page-address-utils.js';

const log = createLogger('routes:cannibalization-keeper');
const router = Router();

const keeperPatchSchema = z.object({
  keeperPath: z.string().min(1).max(2000),
});

/**
 * The urlSetKey is the order-independent cannibalizationUrlSetKey: the competing page slugs deduped,
 * sorted, and joined on '|' (see shared/page-address-utils.ts:cannibalizationUrlSetKey). The keeper
 * MUST be one of those competing slugs — picking a page outside the set is a client error. Compare
 * on the normalized slug form so '/page-a' and 'page-a' both match.
 */
function keeperIsInUrlSet(urlSetKey: string, keeperPath: string): boolean {
  const competing = urlSetKey.split('|').filter((s) => s.length > 0);
  return competing.includes(toPageSlug(keeperPath));
}

// PATCH /api/recommendations/:workspaceId/cannibalization/:urlSetKey/keeper
// Sets the operator-chosen keeper page for a cannibalization URL set.
// The urlSetKey is the order-independent cannibalizationUrlSetKey so the
// override survives regen clobbers of cannibalization_issues.
router.patch(
  '/api/recommendations/:workspaceId/cannibalization/:urlSetKey/keeper',
  requireWorkspaceAccess('workspaceId'),
  validate(keeperPatchSchema),
  (req, res) => {
    const { workspaceId, urlSetKey } = req.params;
    const { keeperPath } = req.body as z.infer<typeof keeperPatchSchema>;

    // The keeper must be one of the URL set's competing slugs — reject anything else (422).
    if (!keeperIsInUrlSet(urlSetKey, keeperPath)) {
      return res.status(422).json({ error: 'keeperPath is not one of the competing pages in this URL set' });
    }

    try {
      setKeeperOverride(workspaceId, urlSetKey, keeperPath);

      addActivity(
        workspaceId,
        'cannibalization_keeper_set',
        `Cannibalization keeper set to ${keeperPath} for URL set ${urlSetKey}`,
      );

      broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, {
        action: 'keeper_override',
        urlSetKey,
        keeperPath,
      });

      return res.json({ keeperPath, urlSetKey });
    } catch (err) {
      log.error({ err, workspaceId, urlSetKey }, 'Failed to set cannibalization keeper override');
      return res.status(500).json({ error: 'Failed to set keeper override' });
    }
  },
);

export default router;
