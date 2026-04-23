import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';

const log = createLogger('competitor-snapshot-store');

interface SnapshotRow {
  id: string;
  workspace_id: string;
  competitor_domain: string;
  snapshot_date: string;
  keyword_count: number | null;
  organic_traffic: number | null;
  top_keywords: string;
  created_at: string;
}

interface AlertRow {
  id: string;
  workspace_id: string;
  competitor_domain: string;
  alert_type: string;
  keyword: string | null;
  previous_position: number | null;
  current_position: number | null;
  position_change: number | null;
  volume: number | null;
  severity: string;
  snapshot_date: string;
  insight_id: string | null;
  created_at: string;
}

export interface CompetitorTopKeyword {
  keyword: string;
  position: number;
  volume: number;
}

export interface CompetitorSnapshot {
  id: string;
  workspaceId: string;
  competitorDomain: string;
  snapshotDate: string;
  keywordCount: number | null;
  organicTraffic: number | null;
  topKeywords: CompetitorTopKeyword[];
  createdAt: string;
}

export interface CompetitorAlert {
  id: string;
  workspaceId: string;
  competitorDomain: string;
  alertType: 'keyword_gained' | 'keyword_lost' | 'authority_change' | 'new_keyword';
  keyword?: string;
  previousPosition?: number;
  currentPosition?: number;
  positionChange?: number;
  volume?: number;
  severity: 'critical' | 'warning' | 'opportunity';
  snapshotDate: string;
  insightId?: string;
  createdAt: string;
}

const stmts = createStmtCache(() => ({
  getLatestSnapshot: db.prepare<[string, string]>(
    `SELECT * FROM competitor_snapshots WHERE workspace_id = ? AND competitor_domain = ?
     ORDER BY snapshot_date DESC LIMIT 1`,
  ),
  insertSnapshot: db.prepare(
    `INSERT INTO competitor_snapshots (id, workspace_id, competitor_domain, snapshot_date, keyword_count, organic_traffic, top_keywords)
     VALUES (@id, @workspace_id, @competitor_domain, @snapshot_date, @keyword_count, @organic_traffic, @top_keywords)`,
  ),
  insertAlert: db.prepare(
    `INSERT INTO competitor_alerts (id, workspace_id, competitor_domain, alert_type, keyword, previous_position, current_position, position_change, volume, severity, snapshot_date)
     VALUES (@id, @workspace_id, @competitor_domain, @alert_type, @keyword, @previous_position, @current_position, @position_change, @volume, @severity, @snapshot_date)`,
  ),
  listUnlinkedAlerts: db.prepare<[string]>(
    `SELECT * FROM competitor_alerts WHERE workspace_id = ? AND insight_id IS NULL
     ORDER BY created_at DESC LIMIT 50`,
  ),
  linkInsightId: db.prepare<[string, string, string]>(
    `UPDATE competitor_alerts SET insight_id = ? WHERE id = ? AND workspace_id = ?`,
  ),
  snapshotExistsForDate: db.prepare<[string, string, string]>(
    `SELECT 1 FROM competitor_snapshots WHERE workspace_id = ? AND competitor_domain = ? AND snapshot_date = ? LIMIT 1`,
  ),
}));

function rowToSnapshot(r: SnapshotRow): CompetitorSnapshot {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    competitorDomain: r.competitor_domain,
    snapshotDate: r.snapshot_date,
    keywordCount: r.keyword_count,
    organicTraffic: r.organic_traffic,
    topKeywords: parseJsonFallback<CompetitorTopKeyword[]>(r.top_keywords, []),
    createdAt: r.created_at,
  };
}

function rowToAlert(r: AlertRow): CompetitorAlert {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    competitorDomain: r.competitor_domain,
    alertType: r.alert_type as CompetitorAlert['alertType'],
    keyword: r.keyword ?? undefined,
    previousPosition: r.previous_position ?? undefined,
    currentPosition: r.current_position ?? undefined,
    positionChange: r.position_change ?? undefined,
    volume: r.volume ?? undefined,
    severity: r.severity as CompetitorAlert['severity'],
    snapshotDate: r.snapshot_date,
    insightId: r.insight_id ?? undefined,
    createdAt: r.created_at,
  };
}

export function getLatestCompetitorSnapshot(workspaceId: string, domain: string): CompetitorSnapshot | null {
  const row = stmts().getLatestSnapshot.get(workspaceId, domain) as SnapshotRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

export function snapshotExistsForDate(workspaceId: string, domain: string, date: string): boolean {
  return !!stmts().snapshotExistsForDate.get(workspaceId, domain, date);
}

export function saveCompetitorSnapshot(
  workspaceId: string,
  domain: string,
  snapshotDate: string,
  topKeywords: CompetitorTopKeyword[],
  keywordCount?: number,
  organicTraffic?: number,
): CompetitorSnapshot {
  const id = randomUUID();
  stmts().insertSnapshot.run({
    id, workspace_id: workspaceId, competitor_domain: domain,
    snapshot_date: snapshotDate,
    keyword_count: keywordCount ?? null,
    organic_traffic: organicTraffic ?? null,
    top_keywords: JSON.stringify(topKeywords),
  });
  return getLatestCompetitorSnapshot(workspaceId, domain)!;
}

export function detectCompetitorAlerts(
  workspaceId: string,
  domain: string,
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot,
  opts: { positionChangeThreshold?: number; minVolume?: number } = {},
): CompetitorAlert[] {
  const { positionChangeThreshold = 5, minVolume = 100 } = opts;
  const alerts: CompetitorAlert[] = [];
  const prevMap = new Map(previous.topKeywords.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
  const currMap = new Map(current.topKeywords.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok

  // keyword_gained, new_keyword: iterate current keywords
  for (const kw of current.topKeywords) {
    const prev = prevMap.get(kw.keyword.toLowerCase());
    if (!prev) {
      if (kw.volume >= minVolume && kw.position <= 10) {
        const severity = kw.position <= 3 ? 'critical' as const : 'warning' as const;
        const alertId = randomUUID();
        stmts().insertAlert.run({
          id: alertId, workspace_id: workspaceId, competitor_domain: domain,
          alert_type: 'new_keyword', keyword: kw.keyword,
          previous_position: null, current_position: kw.position, position_change: null,
          volume: kw.volume, severity, snapshot_date: current.snapshotDate,
        });
        alerts.push({
          id: alertId, workspaceId, competitorDomain: domain,
          alertType: 'new_keyword', keyword: kw.keyword,
          currentPosition: kw.position, volume: kw.volume, severity,
          snapshotDate: current.snapshotDate, createdAt: new Date().toISOString(),
        });
      }
      continue;
    }
    const change = prev.position - kw.position;
    if (change >= positionChangeThreshold && kw.volume >= minVolume) {
      const severity = change >= 10 ? 'critical' as const : 'warning' as const;
      const alertId = randomUUID();
      stmts().insertAlert.run({
        id: alertId, workspace_id: workspaceId, competitor_domain: domain,
        alert_type: 'keyword_gained', keyword: kw.keyword,
        previous_position: prev.position, current_position: kw.position, position_change: change,
        volume: kw.volume, severity, snapshot_date: current.snapshotDate,
      });
      alerts.push({
        id: alertId, workspaceId, competitorDomain: domain,
        alertType: 'keyword_gained', keyword: kw.keyword,
        previousPosition: prev.position, currentPosition: kw.position, positionChange: change,
        volume: kw.volume, severity, snapshotDate: current.snapshotDate,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // keyword_lost: iterate previous keywords that dropped out of current top set
  for (const prev of previous.topKeywords) {
    const curr = currMap.get(prev.keyword.toLowerCase());
    const dropped = !curr || curr.position - prev.position >= positionChangeThreshold;
    if (dropped && prev.volume >= minVolume && prev.position <= 20) {
      const severity = !curr ? 'warning' as const : (curr.position - prev.position >= 10 ? 'critical' as const : 'warning' as const);
      const alertId = randomUUID();
      stmts().insertAlert.run({
        id: alertId, workspace_id: workspaceId, competitor_domain: domain,
        alert_type: 'keyword_lost', keyword: prev.keyword,
        previous_position: prev.position, current_position: curr?.position ?? null,
        position_change: curr ? prev.position - curr.position : null,
        volume: prev.volume, severity, snapshot_date: current.snapshotDate,
      });
      alerts.push({
        id: alertId, workspaceId, competitorDomain: domain,
        alertType: 'keyword_lost', keyword: prev.keyword,
        previousPosition: prev.position, currentPosition: curr?.position,
        positionChange: curr ? prev.position - curr.position : undefined,
        volume: prev.volume, severity, snapshotDate: current.snapshotDate,
        createdAt: new Date().toISOString(),
      });
    }
  }

  log.info({ workspaceId, domain, alertCount: alerts.length }, 'Competitor alerts detected');
  return alerts;
}

export function listUnlinkedCompetitorAlerts(workspaceId: string): CompetitorAlert[] {
  const rows = stmts().listUnlinkedAlerts.all(workspaceId) as AlertRow[];
  return rows.map(rowToAlert);
}

export function linkAlertToInsight(alertId: string, insightId: string, workspaceId: string): void {
  stmts().linkInsightId.run(insightId, alertId, workspaceId);
}
