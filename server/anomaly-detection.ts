/**
 * AI Anomaly Detection — periodic background job that compares current vs previous
 * period data from GSC, GA4, and audit snapshots to flag significant changes.
 *
 * Anomaly types:
 * - traffic_drop: Clicks or users dropped significantly
 * - traffic_spike: Clicks or users spiked significantly (positive)
 * - impressions_drop: Impressions dropped (visibility loss)
 * - ctr_drop: CTR declined meaningfully
 * - position_decline: Average position worsened
 * - bounce_spike: Bounce rate increased significantly
 * - audit_score_drop: Site health score dropped
 * - audit_score_improvement: Site health score improved (positive)
 * - conversion_drop: Conversions or key events dropped
 */

import crypto from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { listWorkspaces, type Workspace } from './workspaces.js';
import { getSearchPeriodComparison } from './search-console.js';
import { getGA4PeriodComparison, getGA4Conversions } from './google-analytics.js';
import { listSnapshots } from './reports.js';
import { addActivity } from './activity-log.js';
import { callOpenAI } from './openai-helpers.js';
import { notifyAnomalyAlert } from './email.js';
import { createLogger } from './logger.js';
import { upsertAnomalyDigestInsight, getInsight } from './analytics-insights-store.js';
import { debouncedAnomalyBoost } from './bridge-infrastructure.js';
import { computeImpactScore } from './insight-enrichment.js';
import type { AnomalyDigestData, InsightSeverity, InsightDomain } from '../shared/types/analytics.js';

const log = createLogger('anomaly');

// --- WebSocket broadcast callback ---
let _broadcast: ((workspaceId: string, event: string, data: unknown) => void) | null = null;

export function initAnomalyBroadcast(fn: (workspaceId: string, event: string, data: unknown) => void) {
  _broadcast = fn;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // Every 12 hours
const MIN_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // Skip startup scan if last scan < 6h ago
const COMPARISON_DAYS = 28;

// --- Minimum traffic floors — skip anomalies on low-volume pages to reduce noise ---
const MIN_CLICKS = 200;        // previous period clicks must be ≥200 to trigger click anomaly
const MIN_IMPRESSIONS = 2000;  // previous period impressions must be ≥2000 to trigger impression anomaly

// --- Thresholds (% change that triggers an anomaly) ---
const THRESHOLDS = {
  traffic_drop: -20,       // clicks or users down 20%+
  traffic_spike: 30,       // clicks or users up 30%+
  impressions_drop: -25,   // visibility loss
  ctr_drop: -15,           // CTR decline
  position_decline: 15,    // position worsened 15%+ (higher = worse)
  bounce_spike: 20,        // bounce rate increase
  audit_score_drop: -8,    // absolute points drop
  audit_score_improvement: 8, // absolute points gain
  conversion_drop: -25,    // conversions down
};

export type AnomalyType =
  | 'traffic_drop'
  | 'traffic_spike'
  | 'impressions_drop'
  | 'ctr_drop'
  | 'position_decline'
  | 'bounce_spike'
  | 'audit_score_drop'
  | 'audit_score_improvement'
  | 'conversion_drop';

export type AnomalySeverity = 'critical' | 'warning' | 'positive';

export interface Anomaly {
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  previousValue: number;
  changePct: number;
  aiSummary?: string;
  detectedAt: string;
  dismissedAt?: string;
  acknowledgedAt?: string;
  source: 'gsc' | 'ga4' | 'audit';
}

// --- SQLite row shape ---

interface AnomalyRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  metric: string;
  current_value: number;
  previous_value: number;
  change_pct: number;
  ai_summary: string | null;
  detected_at: string;
  dismissed_at: string | null;
  acknowledged_at: string | null;
  source: string;
}

function rowToAnomaly(row: AnomalyRow): Anomaly {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    type: row.type as AnomalyType,
    severity: row.severity as AnomalySeverity,
    title: row.title,
    description: row.description,
    metric: row.metric,
    currentValue: row.current_value,
    previousValue: row.previous_value,
    changePct: row.change_pct,
    aiSummary: row.ai_summary ?? undefined,
    detectedAt: row.detected_at,
    dismissedAt: row.dismissed_at ?? undefined,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    source: row.source as Anomaly['source'],
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

const stmts = createStmtCache(() => ({
  selectAll: db.prepare('SELECT * FROM anomalies ORDER BY detected_at DESC'),
  selectByWorkspace: db.prepare('SELECT * FROM anomalies WHERE workspace_id = ? ORDER BY detected_at DESC'),
  selectActiveByWorkspace: db.prepare('SELECT * FROM anomalies WHERE workspace_id = ? AND dismissed_at IS NULL ORDER BY detected_at DESC'),
  selectById: db.prepare('SELECT * FROM anomalies WHERE id = ?'),
  insert: db.prepare(`
        INSERT INTO anomalies (id, workspace_id, workspace_name, type, severity,
          title, description, metric, current_value, previous_value, change_pct,
          ai_summary, detected_at, dismissed_at, acknowledged_at, source)
        VALUES (@id, @workspace_id, @workspace_name, @type, @severity,
          @title, @description, @metric, @current_value, @previous_value, @change_pct,
          @ai_summary, @detected_at, @dismissed_at, @acknowledged_at, @source)
      `),
  dismiss: db.prepare('UPDATE anomalies SET dismissed_at = ? WHERE id = ?'),
  acknowledge: db.prepare('UPDATE anomalies SET acknowledged_at = ? WHERE id = ?'),
  deleteOlderThan: db.prepare('DELETE FROM anomalies WHERE detected_at < ?'),
  recentUndismissed: db.prepare(`
        SELECT * FROM anomalies
        WHERE workspace_id = ? AND type = ? AND dismissed_at IS NULL AND detected_at > ?
        LIMIT 1
      `),
  getLastScan: db.prepare(`SELECT detected_at FROM anomalies ORDER BY detected_at DESC LIMIT 1`),
  setLastScan: db.prepare(`
        INSERT OR REPLACE INTO anomalies (id, workspace_id, workspace_name, type, severity,
          title, description, metric, current_value, previous_value, change_pct,
          ai_summary, detected_at, dismissed_at, acknowledged_at, source)
        VALUES ('__last_scan__', '__system__', 'System', 'traffic_drop', 'warning',
          'Last scan marker', '', 'last_scan', 0, 0, 0,
          NULL, ?, 'system', NULL, 'gsc')
      `),
}));

/** Get the timestamp of the last successful anomaly scan */
function getLastScanTime(): Date | null {
  const row = stmts().getLastScan.get() as { detected_at: string } | undefined;
  return row ? new Date(row.detected_at) : null;
}

/** Record that a scan just completed */
function recordScanTime(): void {
  stmts().setLastScan.run(new Date().toISOString());
}

// --- Public API ---

export function listAnomalies(workspaceId?: string, includeDismissed = false): Anomaly[] {
  let rows: AnomalyRow[];
  if (workspaceId) {
    rows = includeDismissed
      ? stmts().selectByWorkspace.all(workspaceId) as AnomalyRow[]
      : stmts().selectActiveByWorkspace.all(workspaceId) as AnomalyRow[];
  } else {
    rows = stmts().selectAll.all() as AnomalyRow[];
    if (!includeDismissed) rows = rows.filter(r => !r.dismissed_at);
  }
  // Filter out internal scan marker row
  return rows.filter(r => r.id !== '__last_scan__').map(rowToAnomaly);
}

export function dismissAnomaly(id: string): boolean {
  const info = stmts().dismiss.run(new Date().toISOString(), id);
  return info.changes > 0;
}

export function acknowledgeAnomaly(id: string): boolean {
  const info = stmts().acknowledge.run(new Date().toISOString(), id);
  return info.changes > 0;
}

export function clearOldAnomalies(daysOld = 60): number {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const info = stmts().deleteOlderThan.run(cutoff);
  return info.changes;
}

// --- Detection helpers ---

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

function severityFor(type: AnomalyType): AnomalySeverity {
  if (type === 'traffic_spike' || type === 'audit_score_improvement') return 'positive';
  if (type === 'traffic_drop' || type === 'audit_score_drop' || type === 'conversion_drop') return 'critical';
  return 'warning';
}

function alreadyDetected(workspaceId: string, type: AnomalyType, withinHours = 48): boolean {
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
  const row = stmts().recentUndismissed.get(workspaceId, type, cutoff) as AnomalyRow | undefined;
  return !!row;
}

function createAnomaly(
  ws: Workspace,
  type: AnomalyType,
  metric: string,
  current: number,
  previous: number,
  changePct: number,
  source: 'gsc' | 'ga4' | 'audit',
  title: string,
  description: string,
): Anomaly {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    workspaceId: ws.id,
    workspaceName: ws.name,
    type,
    severity: severityFor(type),
    title,
    description,
    metric,
    currentValue: current,
    previousValue: previous,
    changePct,
    detectedAt: new Date().toISOString(),
    source,
  };
}

// --- Core detection for a single workspace ---

async function detectForWorkspace(ws: Workspace): Promise<Anomaly[]> {
  const detected: Anomaly[] = [];

  // --- GSC anomalies ---
  if (ws.gscPropertyUrl) {
    try {
      const cmp = await getSearchPeriodComparison(ws.id, ws.gscPropertyUrl, COMPARISON_DAYS);
      const { current, previous, changePercent } = cmp;

      // Traffic drop (clicks)
      if (changePercent.clicks <= THRESHOLDS.traffic_drop && previous.clicks >= MIN_CLICKS && !alreadyDetected(ws.id, 'traffic_drop')) {
        detected.push(createAnomaly(ws, 'traffic_drop', 'clicks', current.clicks, previous.clicks, changePercent.clicks, 'gsc',
          `Search clicks dropped ${Math.abs(changePercent.clicks)}%`,
          `Clicks fell from ${previous.clicks.toLocaleString()} to ${current.clicks.toLocaleString()} (${changePercent.clicks}%) over the last ${COMPARISON_DAYS} days vs the prior period.`,
        ));
      }

      // Traffic spike (clicks)
      if (changePercent.clicks >= THRESHOLDS.traffic_spike && previous.clicks >= MIN_CLICKS && !alreadyDetected(ws.id, 'traffic_spike')) {
        detected.push(createAnomaly(ws, 'traffic_spike', 'clicks', current.clicks, previous.clicks, changePercent.clicks, 'gsc',
          `Search clicks surged ${changePercent.clicks}%`,
          `Clicks rose from ${previous.clicks.toLocaleString()} to ${current.clicks.toLocaleString()} (+${changePercent.clicks}%) over the last ${COMPARISON_DAYS} days.`,
        ));
      }

      // Impressions drop
      if (changePercent.impressions <= THRESHOLDS.impressions_drop && previous.impressions >= MIN_IMPRESSIONS && !alreadyDetected(ws.id, 'impressions_drop')) {
        detected.push(createAnomaly(ws, 'impressions_drop', 'impressions', current.impressions, previous.impressions, changePercent.impressions, 'gsc',
          `Search impressions dropped ${Math.abs(changePercent.impressions)}%`,
          `Impressions fell from ${previous.impressions.toLocaleString()} to ${current.impressions.toLocaleString()} — potential visibility loss.`,
        ));
      }

      // CTR drop
      if (changePercent.ctr <= THRESHOLDS.ctr_drop && !alreadyDetected(ws.id, 'ctr_drop')) {
        detected.push(createAnomaly(ws, 'ctr_drop', 'ctr', current.ctr, previous.ctr, changePercent.ctr, 'gsc',
          `Click-through rate dropped to ${current.ctr}%`,
          `CTR declined from ${previous.ctr}% to ${current.ctr}% (${changePercent.ctr}%). May indicate meta title/description issues or SERP changes.`,
        ));
      }

      // Position decline (higher number = worse)
      if (changePercent.position >= THRESHOLDS.position_decline && current.position > previous.position && !alreadyDetected(ws.id, 'position_decline')) {
        detected.push(createAnomaly(ws, 'position_decline', 'position', current.position, previous.position, changePercent.position, 'gsc',
          `Average position worsened to ${current.position}`,
          `Position moved from ${previous.position} to ${current.position} — rankings are slipping.`,
        ));
      }
    } catch (err) {
      log.info(`GSC check failed for ${ws.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // --- GA4 anomalies ---
  if (ws.ga4PropertyId) {
    try {
      const cmp = await getGA4PeriodComparison(ws.ga4PropertyId, COMPARISON_DAYS);
      const { current, previous, changePercent } = cmp;

      // User traffic drop
      const userChangePct = changePercent.users;
      if (userChangePct <= THRESHOLDS.traffic_drop && !alreadyDetected(ws.id, 'traffic_drop')) {
        // Only add if not already detected from GSC
        if (!detected.some(d => d.type === 'traffic_drop')) {
          detected.push(createAnomaly(ws, 'traffic_drop', 'users', current.totalUsers, previous.totalUsers, userChangePct, 'ga4',
            `Website users dropped ${Math.abs(userChangePct)}%`,
            `Users fell from ${previous.totalUsers.toLocaleString()} to ${current.totalUsers.toLocaleString()} (${userChangePct}%) over the last ${COMPARISON_DAYS} days.`,
          ));
        }
      }

      // User traffic spike
      if (userChangePct >= THRESHOLDS.traffic_spike && !alreadyDetected(ws.id, 'traffic_spike')) {
        if (!detected.some(d => d.type === 'traffic_spike')) {
          detected.push(createAnomaly(ws, 'traffic_spike', 'users', current.totalUsers, previous.totalUsers, userChangePct, 'ga4',
            `Website users surged ${userChangePct}%`,
            `Users rose from ${previous.totalUsers.toLocaleString()} to ${current.totalUsers.toLocaleString()} (+${userChangePct}%) over the last ${COMPARISON_DAYS} days.`,
          ));
        }
      }

      // Bounce rate spike
      const bounceChange = current.bounceRate - previous.bounceRate;
      const bouncePct = previous.bounceRate > 0 ? pctChange(current.bounceRate, previous.bounceRate) : 0;
      if (bounceChange > 5 && bouncePct >= THRESHOLDS.bounce_spike && !alreadyDetected(ws.id, 'bounce_spike')) {
        detected.push(createAnomaly(ws, 'bounce_spike', 'bounceRate', current.bounceRate, previous.bounceRate, bouncePct, 'ga4',
          `Bounce rate spiked to ${current.bounceRate}%`,
          `Bounce rate increased from ${previous.bounceRate}% to ${current.bounceRate}% (+${bounceChange.toFixed(1)}pp). May indicate content or UX issues.`,
        ));
      }
    } catch (err) {
      log.info(`GA4 check failed for ${ws.name}: ${err instanceof Error ? err.message : err}`);
    }

    // Conversion drop
    try {
      const convs = await getGA4Conversions(ws.ga4PropertyId, COMPARISON_DAYS);
      if (convs.length > 0) {
        const totalCurrent = convs.reduce((s, c) => s + c.conversions, 0);
        // Get previous period conversions
        const prevStart = new Date();
        prevStart.setDate(prevStart.getDate() - COMPARISON_DAYS * 2 - 1);
        const prevEnd = new Date();
        prevEnd.setDate(prevEnd.getDate() - COMPARISON_DAYS - 1);
        const fmt = (d: Date) => d.toISOString().split('T')[0];
        const prevConvs = await getGA4Conversions(ws.ga4PropertyId, COMPARISON_DAYS, {
          startDate: fmt(prevStart),
          endDate: fmt(prevEnd),
        });
        const totalPrev = prevConvs.reduce((s, c) => s + c.conversions, 0);
        if (totalPrev > 5) { // Only flag if there were meaningful conversions before
          const convChangePct = pctChange(totalCurrent, totalPrev);
          if (convChangePct <= THRESHOLDS.conversion_drop && !alreadyDetected(ws.id, 'conversion_drop')) {
            detected.push(createAnomaly(ws, 'conversion_drop', 'conversions', totalCurrent, totalPrev, convChangePct, 'ga4',
              `Conversions dropped ${Math.abs(convChangePct)}%`,
              `Key events fell from ${totalPrev} to ${totalCurrent} (${convChangePct}%). Check if tracking is intact and landing pages are performing.`,
            ));
          }
        }
      }
    } catch {
      // Conversions not set up or API unavailable — skip
    }
  }

  // --- Audit score anomalies ---
  if (ws.webflowSiteId) {
    try {
      const snapshots = listSnapshots(ws.webflowSiteId);
      if (snapshots.length >= 2) {
        const latest = snapshots[0];
        const prev = snapshots[1];
        const scoreDiff = latest.siteScore - prev.siteScore;

        if (scoreDiff <= THRESHOLDS.audit_score_drop && !alreadyDetected(ws.id, 'audit_score_drop')) {
          detected.push(createAnomaly(ws, 'audit_score_drop', 'siteScore', latest.siteScore, prev.siteScore, scoreDiff, 'audit',
            `Site health score dropped ${Math.abs(scoreDiff)} points`,
            `Score went from ${prev.siteScore} to ${latest.siteScore}. Errors: ${latest.errors}, warnings: ${latest.warnings}.`,
          ));
        }

        if (scoreDiff >= THRESHOLDS.audit_score_improvement && !alreadyDetected(ws.id, 'audit_score_improvement')) {
          detected.push(createAnomaly(ws, 'audit_score_improvement', 'siteScore', latest.siteScore, prev.siteScore, scoreDiff, 'audit',
            `Site health score improved ${scoreDiff} points!`,
            `Score went from ${prev.siteScore} to ${latest.siteScore}. Great progress!`,
          ));
        }
      }
    } catch (err) {
      log.info(`Audit check failed for ${ws.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return detected;
}

// --- AI summary generation ---

async function generateAiSummary(anomalies: Anomaly[], workspaceName: string): Promise<string | undefined> {
  if (anomalies.length === 0) return undefined;
  try {
    const details = anomalies.map(a =>
      `[${a.severity.toUpperCase()}] ${a.title} — ${a.description} (source: ${a.source})`
    ).join('\n');

    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: `You are an SEO analyst. Given the detected anomalies for a website, write a brief 2-3 sentence executive summary that highlights the most important changes and suggests what to investigate first. Be specific and actionable. Don't repeat every anomaly — focus on the story.`,
        },
        {
          role: 'user',
          content: `Website: ${workspaceName}\n\nDetected anomalies:\n${details}`,
        },
      ],
      maxTokens: 200,
      temperature: 0.5,
      feature: 'anomaly-summary',
    });
    return result.text;
  } catch {
    return undefined;
  }
}

// --- Main scan function ---

export async function runAnomalyDetection(force = false): Promise<{ total: number; newAnomalies: number }> {
  // Skip if last scan was too recent (prevents spam on frequent deploys)
  if (!force) {
    const lastScan = getLastScanTime();
    if (lastScan && (Date.now() - lastScan.getTime()) < MIN_SCAN_INTERVAL_MS) {
      const hoursAgo = ((Date.now() - lastScan.getTime()) / (60 * 60 * 1000)).toFixed(1);
      log.info(`Skipping anomaly scan — last scan was ${hoursAgo}h ago (minimum interval: ${MIN_SCAN_INTERVAL_MS / (60 * 60 * 1000)}h)`);
      return { total: 0, newAnomalies: 0 };
    }
  }
  log.info('Starting anomaly detection scan...');
  const workspaces = listWorkspaces();
  const existingCount = (stmts().selectAll.all() as AnomalyRow[]).length;
  const allNew: Anomaly[] = [];

  for (const ws of workspaces) {
    // Skip workspaces without data connections
    if (!ws.gscPropertyUrl && !ws.ga4PropertyId && !ws.webflowSiteId) continue;

    try {
      const detected = await detectForWorkspace(ws);
      if (detected.length > 0) {
        // Generate AI summary for this workspace's anomalies
        const summary = await generateAiSummary(detected, ws.name);
        if (summary) {
          detected.forEach(a => { a.aiSummary = summary; });
        }

        // Log activity for critical/warning anomalies
        const critical = detected.filter(a => a.severity === 'critical');
        const warnings = detected.filter(a => a.severity === 'warning');
        const positive = detected.filter(a => a.severity === 'positive');

        if (critical.length > 0 || warnings.length > 0) {
          addActivity(ws.id, 'anomaly_detected',
            `${critical.length + warnings.length} anomal${critical.length + warnings.length === 1 ? 'y' : 'ies'} detected`,
            summary || detected.map(a => a.title).join('; '),
            { anomalyCount: detected.length, critical: critical.length, warnings: warnings.length }
          );

          // Email notification for critical/warning anomalies
          notifyAnomalyAlert({
            workspaceName: ws.name,
            workspaceId: ws.id,
            anomalies: [...critical, ...warnings].map(a => ({
              title: a.title, description: a.description, severity: a.severity, source: a.source, changePct: a.changePct,
            })),
            aiSummary: summary || undefined,
            clientEmail: ws.clientEmail,
          });
        }

        if (positive.length > 0) {
          addActivity(ws.id, 'anomaly_positive',
            `Positive trend detected: ${positive[0].title}`,
            positive.map(a => a.title).join('; '),
          );
        }

        // Insert new anomalies into DB
        for (const a of detected) {
          stmts().insert.run({
            id: a.id,
            workspace_id: a.workspaceId,
            workspace_name: a.workspaceName,
            type: a.type,
            severity: a.severity,
            title: a.title,
            description: a.description,
            metric: a.metric,
            current_value: a.currentValue,
            previous_value: a.previousValue,
            change_pct: a.changePct,
            ai_summary: a.aiSummary ?? null,
            detected_at: a.detectedAt,
            dismissed_at: a.dismissedAt ?? null,
            acknowledged_at: a.acknowledgedAt ?? null,
            source: a.source,
          });
        }

        allNew.push(...detected);

        // Broadcast to connected clients
        if (_broadcast) {
          _broadcast(ws.id, 'anomalies:update', {
            count: detected.length,
            critical: critical.length,
            warnings: warnings.length,
            positive: positive.length,
          });
        }

        // ── Write anomaly digest insights (deduped via unique index) ──
        for (const a of detected) {
          try {
            const severityMap: Record<string, InsightSeverity> = {
              critical: 'critical',
              warning: 'warning',
              positive: 'positive',
            };
            const insightSeverity: InsightSeverity = severityMap[a.severity] ?? 'opportunity';

            // Map anomaly type to insight domain — must match classifyDomain() in insight-enrichment.ts
            let domain: InsightDomain = 'cross';
            if (a.type.includes('traffic') || a.type.includes('bounce') || a.type.includes('conversion')) {
              domain = 'traffic';
            } else if (a.type.includes('impression') || a.type.includes('position') || a.type.includes('ctr')) {
              domain = 'search';
            }

            // Preserve firstDetected from existing insight for accurate duration tracking
            const dedupKey = `anomaly:${a.type}:${a.metric}`;
            const existing = getInsight(a.workspaceId, dedupKey, 'anomaly_digest');
            const existingData = existing?.data as AnomalyDigestData | undefined;
            const firstDetected = existingData?.firstDetected ?? a.detectedAt;
            const durationDays = Math.max(1, Math.ceil(
              (Date.now() - new Date(firstDetected).getTime()) / 86400000,
            ));

            const digestData: AnomalyDigestData = {
              anomalyType: a.type,
              metric: a.metric,
              currentValue: a.currentValue,
              expectedValue: a.previousValue,
              deviationPercent: a.changePct,
              durationDays,
              firstDetected,
              severity: a.severity,
            };

            const impactScore = computeImpactScore(insightSeverity, digestData as unknown as Record<string, unknown>);

            upsertAnomalyDigestInsight({
              workspaceId: a.workspaceId,
              anomalyType: a.type,
              metric: a.metric,
              data: digestData,
              severity: insightSeverity,
              domain,
              impactScore,
            });
          } catch (digestErr) {
            log.warn({ err: digestErr, anomalyId: a.id }, 'Failed to upsert anomaly digest insight');
          }
        }

        // ── Bridge #10: Anomaly → boost existing insight severity ──────────
        // When anomalies are detected for pages that already have insights,
        // boost those insights' impact scores to surface them faster.
        debouncedAnomalyBoost(ws.id, async () => {
          const { getInsights: fetchInsights, upsertInsight: updateInsight } = await import('./analytics-insights-store.js');
          const allInsights = fetchInsights(ws.id);

          // Anomaly detection is workspace-level (no per-page granularity in the Anomaly interface).
          // Boost all non-resolved insights when fresh anomalies exist for this workspace.
          const recentAnomalies = listAnomalies(ws.id, false)
            .filter(a => !a.dismissedAt && Date.now() - new Date(a.detectedAt).getTime() < 24 * 60 * 60 * 1000);

          if (recentAnomalies.length === 0) return;

          for (const insight of allInsights) {
            if (insight.resolutionStatus === 'resolved') continue;
            const boosted = Math.min(100, (insight.impactScore ?? 50) + 10);
            if (boosted !== insight.impactScore) {
              updateInsight({
                workspaceId: insight.workspaceId,
                pageId: insight.pageId,
                insightType: insight.insightType,
                data: insight.data,
                severity: insight.severity,
                pageTitle: insight.pageTitle,
                strategyKeyword: insight.strategyKeyword,
                strategyAlignment: insight.strategyAlignment,
                auditIssues: insight.auditIssues,
                pipelineStatus: insight.pipelineStatus,
                anomalyLinked: true,
                impactScore: boosted,
                domain: insight.domain,
                resolutionSource: 'bridge_10_anomaly_boost',
              });
            }
          }

          const { broadcastToWorkspace: bc } = await import('./broadcast.js');
          const { WS_EVENTS: events } = await import('./ws-events.js');
          bc(ws.id, events.INSIGHT_BRIDGE_UPDATED, { bridge: 'bridge_10_anomaly_boost' });
        });
      }
    } catch (err) {
      log.error({ err: err }, `Error scanning ${ws.name}:`);
    }
  }

  if (allNew.length > 0) {
    log.info(`Detected ${allNew.length} new anomalies across ${workspaces.length} workspaces`);
  } else {
    log.info(`No new anomalies detected`);
  }

  // Prune old anomalies (older than 60 days)
  clearOldAnomalies(60);

  // Record scan completion time
  recordScanTime();

  return { total: existingCount + allNew.length, newAnomalies: allNew.length };
}

// --- Scheduler ---

let anomalyInterval: ReturnType<typeof setInterval> | null = null;

export function startAnomalyDetection() {
  if (anomalyInterval) return;

  // Run 2 minutes after startup, then every 12 hours
  setTimeout(() => {
    runAnomalyDetection().catch(err => log.error({ err }, 'Scan error'));
  }, 2 * 60 * 1000);

  anomalyInterval = setInterval(() => {
    runAnomalyDetection().catch(err => log.error({ err }, 'Scan error'));
  }, CHECK_INTERVAL_MS);

  log.info('Detection scheduler started (every 12 hours)');
}

export function stopAnomalyDetection() {
  if (anomalyInterval) {
    clearInterval(anomalyInterval);
    anomalyInterval = null;
  }
}
