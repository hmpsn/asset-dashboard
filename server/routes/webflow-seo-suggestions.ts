/**
 * Webflow SEO suggestion routes.
 *
 * @reads workspaces, seo_suggestions, webflow_api
 * @writes seo_suggestions, webflow_pages, seo_changes
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { createLogger } from '../logger.js';
import {
  dismissSuggestions,
  getSelectedSuggestions,
  getSuggestionCounts,
  listSuggestions,
  markApplied,
  selectVariation,
} from '../seo-suggestions.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { updatePageSeo } from '../webflow.js';
import { getTokenForSite, getWorkspace, updatePageState } from '../workspaces.js';

const router = Router();
const log = createLogger('webflow-seo-suggestions');

// --- SEO Suggestions: List pending suggestions ---
router.get('/api/webflow/seo-suggestions/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const field = req.query.field as 'title' | 'description' | undefined;
  const suggestions = listSuggestions(workspaceId, field);
  const counts = getSuggestionCounts(workspaceId);
  res.json({ suggestions, counts });
});

// --- SEO Suggestions: Select a variation ---
router.patch('/api/webflow/seo-suggestions/:workspaceId/:suggestionId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId, suggestionId } = req.params;
  const { selectedIndex } = req.body as { selectedIndex: number };
  if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex > 2) {
    return res.status(400).json({ error: 'selectedIndex must be 0, 1, or 2' });
  }
  const ok = selectVariation(workspaceId, suggestionId, selectedIndex);
  if (!ok) return res.status(404).json({ error: 'Suggestion not found or already applied' });
  res.json({ ok: true });
});

// --- SEO Suggestions: Apply selected suggestions to Webflow ---
router.post('/api/webflow/seo-suggestions/:workspaceId/apply', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const { suggestionIds } = req.body as { suggestionIds?: string[] };

  // Get suggestions to apply: either specific IDs or all selected.
  let toApply = getSelectedSuggestions(workspaceId);
  if (suggestionIds?.length) {
    const idSet = new Set(suggestionIds);
    toApply = toApply.filter(s => idSet.has(s.id));
  }

  if (!toApply.length) return res.status(400).json({ error: 'No suggestions with selected variations to apply' });

  const results: Array<{ pageId: string; field: string; text: string; applied: boolean; error?: string }> = [];

  for (const s of toApply) {
    try {
      const text = s.variations[s.selectedIndex!];
      if (!text) {
        results.push({ pageId: s.pageId, field: s.field, text: '', applied: false, error: 'No text at selected index' });
        continue;
      }

      const token = getTokenForSite(s.siteId) || undefined;
      const seoFields = s.field === 'description'
        ? { seo: { description: text } }
        : { seo: { title: text } };
      const seoResult = await updatePageSeo(s.pageId, seoFields, token);
      if (!seoResult.success) {
        results.push({ pageId: s.pageId, field: s.field, text: '', applied: false, error: seoResult.error });
        continue;
      }

      const ws = getWorkspace(workspaceId);
      if (ws) {
        updatePageState(ws.id, s.pageId, { status: 'live', source: 'bulk-rewrite', fields: [s.field], updatedBy: 'admin' });
        recordSeoChange(ws.id, s.pageId, s.pageSlug, s.pageTitle, [s.field], 'bulk-rewrite');
      }

      results.push({ pageId: s.pageId, field: s.field, text, applied: true });
    } catch (err) {
      results.push({ pageId: s.pageId, field: s.field, text: '', applied: false, error: String(err) });
    }
  }

  // Mark applied suggestions
  const appliedIds = results
    .map((result, index) => result.applied ? toApply[index]?.id : undefined)
    .filter(Boolean) as string[];
  if (appliedIds.length) markApplied(workspaceId, appliedIds);

  log.info(`Applied ${appliedIds.length}/${toApply.length} SEO suggestions for workspace ${workspaceId}`);
  res.json({ results, applied: appliedIds.length, total: toApply.length });
});

// --- SEO Suggestions: Dismiss suggestions ---
router.delete('/api/webflow/seo-suggestions/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const { suggestionIds } = req.body as { suggestionIds?: string[] } || {};
  const dismissed = dismissSuggestions(workspaceId, suggestionIds);
  res.json({ dismissed });
});

export default router;
