import { get } from './client';
import type { IssueLensesResponse } from '../../shared/types/strategy-issue-lenses';

/**
 * The Issue — Phase 5 four-jobs lenses (Lane C).
 *
 * GET the two ADMIN read-projections of the curated Issue rec set:
 *   - keywordTargets (job #4) — curated keyword_gap + topic_cluster recs.
 *   - contentWorkOrders (job #3) — curated content + content_refresh recs joined to their
 *     content_topic_requests for a production stage.
 *
 * Pure read; no mutations. The hook (useIssueLenses) is enabled-gated on theIssueEnabled so
 * flag-OFF makes zero calls.
 */
export function getIssueLenses(workspaceId: string): Promise<IssueLensesResponse> {
  return get<IssueLensesResponse>(`/api/workspaces/${workspaceId}/issue-lenses`);
}
