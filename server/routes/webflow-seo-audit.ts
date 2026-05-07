/**
 * Webflow SEO audit route.
 *
 * @reads workspaces, webflow_api
 * @writes workspaces, analytics_insights
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { createLogger } from '../logger.js';
import { runSeoAudit } from '../seo-audit.js';
import { handleOnDemandSeoAuditResult } from '../webflow-seo-audit-bridges.js';
import {
  getTokenForSite,
  getWorkspace,
  listWorkspaces,
} from '../workspaces.js';

const router = Router();
const log = createLogger('webflow-seo-audit-route');

router.get('/api/webflow/seo-audit/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    if (!token) {
      log.error({ detail: req.params.siteId }, 'SEO audit: No token available for site');
      return res.status(500).json({ error: 'No Webflow API token configured. Please link a workspace to this site in Settings, or set WEBFLOW_API_TOKEN environment variable.' });
    }
    const skipLinkCheck = req.query.skipLinkCheck === 'true';
    const result = await runSeoAudit(req.params.siteId, token, req.query.workspaceId as string | undefined, skipLinkCheck);
    // Auto-flag pages with issues for edit tracking
    const auditWsId = req.query.workspaceId as string | undefined;
    const auditWs = auditWsId ? getWorkspace(auditWsId) : listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (auditWs) {
      handleOnDemandSeoAuditResult(auditWs, result);
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'SEO audit error');
    res.status(500).json({ error: `SEO audit failed: ${msg}` });
  }
});

export default router;
