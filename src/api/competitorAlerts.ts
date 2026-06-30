import { get } from './client';
import type { CompetitorAlertsResponse } from '../../shared/types/competitor-alerts';

/**
 * The Issue — Phase 6 competitor page (Lane C).
 *
 * GET the recent competitor-movement alerts (keyword gained/lost, authority change, new keyword)
 * written weekly by the competitor-monitoring cron (server/intelligence-crons.ts). Pure read; the
 * dedicated admin Competitors page surfaces them in `CompetitorAlertsPanel`.
 */
export function getCompetitorAlerts(workspaceId: string): Promise<CompetitorAlertsResponse> {
  return get<CompetitorAlertsResponse>(`/api/workspaces/${workspaceId}/competitor-alerts`);
}
