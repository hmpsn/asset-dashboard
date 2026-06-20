/**
 * The Issue — Phase 6 competitor page: competitor-alerts API contract.
 *
 * A clean shared shape for GET /api/workspaces/:workspaceId/competitor-alerts, decoupled from the
 * server `CompetitorAlert` store interface (server/competitor-snapshot-store.ts) so the wire shape
 * is explicit and the optional store numerics are normalized to `| null`. The alerts are written
 * weekly by the competitor-monitoring cron (server/intelligence-crons.ts) and, before Phase 6, had
 * no UI — the dedicated Competitors page surfaces them.
 */

export type CompetitorAlertType =
  | 'keyword_gained'
  | 'keyword_lost'
  | 'authority_change'
  | 'new_keyword';

export type CompetitorAlertSeverity = 'critical' | 'warning' | 'opportunity';

/** One competitor-movement alert as served to the admin Competitors page. */
export interface CompetitorAlertView {
  id: string;
  competitorDomain: string;
  alertType: CompetitorAlertType;
  keyword: string | null;
  previousPosition: number | null;
  currentPosition: number | null;
  positionChange: number | null;
  volume: number | null;
  severity: CompetitorAlertSeverity;
  snapshotDate: string;
  createdAt: string;
}

/** GET /api/workspaces/:workspaceId/competitor-alerts response. */
export interface CompetitorAlertsResponse {
  workspaceId: string;
  alerts: CompetitorAlertView[];
}
