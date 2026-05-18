/**
 * Webflow SEO suggestion routes.
 *
 * @reads workspaces, seo_suggestions, webflow_api
 * @writes seo_suggestions, webflow_pages, seo_changes
 */
import { Router } from 'express';

import { addActivity } from '../activity-log.js';
import { requireWorkspaceAccess } from '../auth.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { createLogger } from '../logger.js';
import {
  dismissSuggestions,
  getPendingSuggestion,
  getSelectedSuggestions,
  getSuggestionCounts,
  listPendingSuggestionsByIds,
  listSuggestions,
  markApplied,
  selectVariation,
} from '../seo-suggestions.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { updatePageSeo } from '../webflow.js';
import { getTokenForSite, getWorkspace, updatePageState } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';
import { normalizePageUrl } from '../helpers.js';

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
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 2) {
    return res.status(400).json({ error: 'selectedIndex must be 0, 1, or 2' });
  }
  const suggestion = getPendingSuggestion(workspaceId, suggestionId);
  const ok = selectVariation(workspaceId, suggestionId, selectedIndex);
  if (!ok) return res.status(404).json({ error: 'Suggestion not found or already applied' });
  if (suggestion) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
      pageId: suggestion.pageId,
      fields: [suggestion.field],
      source: 'seo-suggestion-selected',
    });
    addActivity(
      workspaceId,
      'seo_updated',
      `Selected SEO ${suggestion.field} variation`,
      `Selected variation ${selectedIndex + 1} for ${suggestion.pageTitle || suggestion.pageSlug || suggestion.pageId}`,
      {
        suggestionId,
        pageId: suggestion.pageId,
        field: suggestion.field,
        selectedIndex,
      },
    );
  }
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
        recordSeoChange(ws.id, s.pageId, normalizePageUrl(s.pageSlug), s.pageTitle, [s.field], 'bulk-rewrite');
      }

      results.push({ pageId: s.pageId, field: s.field, text, applied: true });
    } catch (err) {
      results.push({ pageId: s.pageId, field: s.field, text: '', applied: false, error: String(err) });
    }
  }

  // Mark by result index, not pageId: title + description suggestions can share
  // the same pageId, and each applied result must map back to its own row.
  const appliedIds = results
    .map((result, index) => result.applied ? toApply[index]?.id : undefined)
    .filter(Boolean) as string[];
  if (appliedIds.length) markApplied(workspaceId, appliedIds);
  if (appliedIds.length) {
    const appliedResults = results.filter(result => result.applied);
    const pageIds = Array.from(new Set(appliedResults.map(result => result.pageId)));
    const fields = Array.from(new Set(appliedResults.map(result => result.field)));
    broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds,
      fields,
      source: 'seo-suggestions',
    });
    addActivity(
      workspaceId,
      'seo_updated',
      `Applied ${appliedIds.length} SEO ${appliedIds.length === 1 ? 'suggestion' : 'suggestions'}`,
      `Updated ${pageIds.length} ${pageIds.length === 1 ? 'page' : 'pages'} from selected SEO suggestions`,
      { applied: appliedIds.length, total: toApply.length, pageIds, fields },
    );
  }

  log.info(`Applied ${appliedIds.length}/${toApply.length} SEO suggestions for workspace ${workspaceId}`);
  res.json({ results, applied: appliedIds.length, total: toApply.length });
});

// --- SEO Suggestions: Dismiss suggestions ---
router.delete('/api/webflow/seo-suggestions/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const { suggestionIds } = req.body as { suggestionIds?: string[] } || {};
  const pendingBefore = listPendingSuggestionsByIds(workspaceId, suggestionIds);
  const dismissed = dismissSuggestions(workspaceId, suggestionIds);
  if (dismissed > 0) {
    const affected = pendingBefore;
    const pageIds = Array.from(new Set(affected.map(s => s.pageId)));
    const fields = Array.from(new Set(affected.map(s => s.field)));
    broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds,
      fields,
      source: 'seo-suggestions-dismissed',
    });
    addActivity(
      workspaceId,
      'seo_updated',
      `Dismissed ${dismissed} SEO ${dismissed === 1 ? 'suggestion' : 'suggestions'}`,
      suggestionIds?.length
        ? `Dismissed selected SEO suggestions for ${pageIds.length} ${pageIds.length === 1 ? 'page' : 'pages'}`
        : `Dismissed all pending SEO suggestions for ${pageIds.length} ${pageIds.length === 1 ? 'page' : 'pages'}`,
      {
        dismissed,
        pageIds,
        fields,
        suggestionIds: affected.map(s => s.id),
      },
    );
  }
  res.json({ dismissed });
});

export default router;
