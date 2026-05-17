/**
 * Webflow SEO live apply routes.
 *
 * @reads workspaces, page_keywords, workspace_intelligence, webflow_api
 * @writes page_edit_states, seo_changes, activities, webflow_api
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { tryResolvePagePath, normalizePageUrl } from '../helpers.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { updatePageSeo } from '../webflow.js';
import {
  getTokenForSite,
  getWorkspace,
  updatePageState,
} from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';

const router = Router();

// --- Bulk AI SEO Fix ---
router.post('/api/webflow/seo-bulk-fix/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), (_req, res) => {
  res.status(409).json({
    error: 'Synchronous bulk SEO fixes are retired. Start a bulk-seo-fix background job via /api/jobs.',
    supportedJobType: 'bulk-seo-fix',
  });
});

// --- Bulk Pattern Apply (instant text transforms, no AI) ---
router.post('/api/webflow/seo-pattern-apply/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  const { pages: rawPages, field, action, text: patternText, workspaceId } = req.body as {
    pages: Array<{ pageId: string; title: string; slug?: string; publishedPath?: string | null; currentValue: string }>;
    field: 'title' | 'description';
    action: 'append' | 'prepend' | 'replace';
    text: string;
    workspaceId?: string;
  };
  // Strip synthetic CMS IDs at the boundary — they are not real Webflow page IDs
  const pages = (rawPages || []).filter(p => !p.pageId.startsWith('cms-'));
  if (!pages?.length || !field || !action || !patternText || !workspaceId) {
    return res.status(400).json({ error: 'workspaceId, pages, field, action, text required' });
  }

  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;
  const ws = getWorkspace(workspaceId);
  if (!ws || ws.webflowSiteId !== siteId) {
    return res.status(403).json({ error: 'You do not have access to this workspace' });
  }
  const maxLen = field === 'description' ? 160 : 60;

  const results: Array<{ pageId: string; oldValue: string; newValue: string; applied: boolean; error?: string }> = [];

  for (const page of pages) {
    try {
      let newValue: string;
      if (action === 'append') {
        newValue = `${page.currentValue} ${patternText}`.trim();
      } else if (action === 'prepend') {
        newValue = `${patternText} ${page.currentValue}`.trim();
      } else {
        newValue = patternText;
      }

      // Truncate if over limit
      if (newValue.length > maxLen) {
        const truncated = newValue.slice(0, maxLen);
        const lastSpace = truncated.lastIndexOf(' ');
        newValue = lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
      }

      const seoFields = field === 'description'
        ? { seo: { description: newValue } }
        : { seo: { title: newValue } };
      const seoResult = await updatePageSeo(page.pageId, seoFields, token);
      if (!seoResult.success) {
        results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue: '', applied: false, error: seoResult.error });
        continue;
      }

      if (ws) {
        updatePageState(ws.id, page.pageId, { status: 'live', source: 'pattern-apply', fields: [field], updatedBy: 'admin' });
        const seoChangePagePath = tryResolvePagePath(page) || (page.slug ? normalizePageUrl(page.slug) : '');
        recordSeoChange(ws.id, page.pageId, seoChangePagePath, page.title || '', [field], 'pattern-apply');
      }
      results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue, applied: true });
    } catch (err) {
      results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue: '', applied: false, error: String(err) });
    }
  }

  if (ws) {
    const appliedPageIds = results.filter(r => r.applied).map(r => r.pageId);
    if (appliedPageIds.length > 0) {
      broadcastToWorkspace(ws.id, WS_EVENTS.PAGE_STATE_UPDATED, {
        pageIds: appliedPageIds,
        fields: [field],
        source: 'pattern-apply',
      });
      addActivity(ws.id, 'seo_updated',
        `Bulk ${field} pattern applied: ${appliedPageIds.length} pages updated`,
        `Pattern ${action} applied to ${appliedPageIds.length}/${pages.length} pages`,
        { field, action, pagesUpdated: appliedPageIds.length, totalPages: pages.length }
      );
    }
  }

  res.json({ results, field, action });
});

export default router;
