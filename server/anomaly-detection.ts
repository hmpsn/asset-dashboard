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

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUploadRoot } from './data-dir.js';
import { listWorkspaces, type Workspace } from './workspaces.js';
import { getSearchPeriodComparison } from './search-console.js';
import { getGA4PeriodComparison, getGA4Conversions } from './google-analytics.js';
import { listSnapshots } from './reports.js';
import { addActivity } from './activity-log.js';
import { callOpenAI } from './openai-helpers.js';
import { notifyAnomalyAlert } from './email.js';

const UPLOAD_ROOT = getUploadRoot();

// --- WebSocket broadcast callback ---
let _broadcast: ((workspaceId: string, event: string, data: unknown) => void) | null = null;

export function initAnomalyBroadcast(fn: (workspaceId: string, event: string, data: unknown) => void) {
  _broadcast = fn;
}
const ANOMALIES_FILE = path.join(UPLOAD_ROOT, '.anomalies.json');
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // Every 12 hours
const COMPARISON_DAYS = 28;

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

// --- File I/O ---

function readAnomalies(): Anomaly[] {
  try {
    if (fs.existsSync(ANOMALIES_FILE)) {
      return JSON.parse(fs.readFileSync(ANOMALIES_FILE, 'utf-8'));
    }
  } catch { /* no file yet */ }
  return [];
}

function writeAnomalies(anomalies: Anomaly[]) {
  fs.mkdirSync(path.dirname(ANOMALIES_FILE), { recursive: true });
  fs.writeFileSync(ANOMALIES_FILE, JSON.stringify(anomalies, null, 2));
}

// --- Public API ---

export function listAnomalies(workspaceId?: string, includeDismissed = false): Anomaly[] {
  let anomalies = readAnomalies();
  if (workspaceId) anomalies = anomalies.filter(a => a.workspaceId === workspaceId);
  if (!includeDismissed) anomalies = anomalies.filter(a => !a.dismissedAt);
  return anomalies.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

export function dismissAnomaly(id: string): boolean {
  const anomalies = readAnomalies();
  const anomaly = anomalies.find(a => a.id === id);
  if (!anomaly) return false;
  anomaly.dismissedAt = new Date().toISOString();
  writeAnomalies(anomalies);
  return true;
}

export function acknowledgeAnomaly(id: string): boolean {
  const anomalies = readAnomalies();
  const anomaly = anomalies.find(a => a.id === id);
  if (!anomaly) return false;
  anomaly.acknowledgedAt = new Date().toISOString();
  writeAnomalies(anomalies);
  return true;
}

export function clearOldAnomalies(daysOld = 60): number {
  const anomalies = readAnomalies();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const filtered = anomalies.filter(a => new Date(a.detectedAt).getTime() > cutoff);
  const removed = anomalies.length - filtered.length;
  if (removed > 0) writeAnomalies(filtered);
  return removed;
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

function alreadyDetected(anomalies: Anomaly[], workspaceId: string, type: AnomalyType, withinHours = 48): boolean {
  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;
  return anomalies.some(
    a => a.workspaceId === workspaceId && a.type === type && new Date(a.detectedAt).getTime() > cutoff && !a.dismissedAt
  );
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

async function detectForWorkspace(ws: Workspace, existing: Anomaly[]): Promise<Anomaly[]> {
  const detected: Anomaly[] = [];

  // --- GSC anomalies ---
  if (ws.gscPropertyUrl) {
    try {
      const cmp = await getSearchPeriodComparison(ws.id, ws.gscPropertyUrl, COMPARISON_DAYS);
      const { current, previous, changePercent } = cmp;

      // Traffic drop (clicks)
      if (changePercent.clicks <= THRESHOLDS.traffic_drop && !alreadyDetected(existing, ws.id, 'traffic_drop')) {
        detected.push(createAnomaly(ws, 'traffic_drop', 'clicks', current.clicks, previous.clicks, changePercent.clicks, 'gsc',
          `Search clicks dropped ${Math.abs(changePercent.clicks)}%`,
          `Clicks fell from ${previous.clicks.toLocaleString()} to ${current.clicks.toLocaleString()} (${changePercent.clicks}%) over the last ${COMPARISON_DAYS} days vs the prior period.`,
        ));
      }

      // Traffic spike (clicks)
      if (changePercent.clicks >= THRESHOLDS.traffic_spike && !alreadyDetected(existing, ws.id, 'traffic_spike')) {
        detected.push(createAnomaly(ws, 'traffic_spike', 'clicks', current.clicks, previous.clicks, changePercent.clicks, 'gsc',
          `Search clicks surged ${changePercent.clicks}%`,
          `Clicks rose from ${previous.clicks.toLocaleString()} to ${current.clicks.toLocaleString()} (+${changePercent.clicks}%) over the last ${COMPARISON_DAYS} days.`,
        ));
      }

      // Impressions drop
      if (changePercent.impressions <= THRESHOLDS.impressions_drop && !alreadyDetected(existing, ws.id, 'impressions_drop')) {
        detected.push(createAnomaly(ws, 'impressions_drop', 'impressions', current.impressions, previous.impressions, changePercent.impressions, 'gsc',
          `Search impressions dropped ${Math.abs(changePercent.impressions)}%`,
          `Impressions fell from ${previous.impressions.toLocaleString()} to ${current.impressions.toLocaleString()} — potential visibility loss.`,
        ));
      }

      // CTR drop
      if (changePercent.ctr <= THRESHOLDS.ctr_drop && !alreadyDetected(existing, ws.id, 'ctr_drop')) {
        detected.push(createAnomaly(ws, 'ctr_drop', 'ctr', current.ctr, previous.ctr, changePercent.ctr, 'gsc',
          `Click-through rate dropped to ${current.ctr}%`,
          `CTR declined from ${previous.ctr}% to ${current.ctr}% (${changePercent.ctr}%). May indicate meta title/description issues or SERP changes.`,
        ));
      }

      // Position decline (higher number = worse)
      if (changePercent.position >= THRESHOLDS.position_decline && current.position > previous.position && !alreadyDetected(existing, ws.id, 'position_decline')) {
        detected.push(createAnomaly(ws, 'position_decline', 'position', current.position, previous.position, changePercent.position, 'gsc',
          `Average position worsened to ${current.position}`,
          `Position moved from ${previous.position} to ${current.position} — rankings are slipping.`,
        ));
      }
    } catch (err) {
      console.log(`[Anomaly] GSC check failed for ${ws.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // --- GA4 anomalies ---
  if (ws.ga4PropertyId) {
    try {
      const cmp = await getGA4PeriodComparison(ws.ga4PropertyId, COMPARISON_DAYS);
      const { current, previous, changePercent } = cmp;

      // User traffic drop
      const userChangePct = changePercent.users;
      if (userChangePct <= THRESHOLDS.traffic_drop && !alreadyDetected(existing, ws.id, 'traffic_drop')) {
        // Only add if not already detected from GSC
        if (!detected.some(d => d.type === 'traffic_drop')) {
          detected.push(createAnomaly(ws, 'traffic_drop', 'users', current.totalUsers, previous.totalUsers, userChangePct, 'ga4',
            `Website users dropped ${Math.abs(userChangePct)}%`,
            `Users fell from ${previous.totalUsers.toLocaleString()} to ${current.totalUsers.toLocaleString()} (${userChangePct}%) over the last ${COMPARISON_DAYS} days.`,
          ));
        }
      }

      // User traffic spike
      if (userChangePct >= THRESHOLDS.traffic_spike && !alreadyDetected(existing, ws.id, 'traffic_spike')) {
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
      if (bounceChange > 5 && bouncePct >= THRESHOLDS.bounce_spike && !alreadyDetected(existing, ws.id, 'bounce_spike')) {
        detected.push(createAnomaly(ws, 'bounce_spike', 'bounceRate', current.bounceRate, previous.bounceRate, bouncePct, 'ga4',
          `Bounce rate spiked to ${current.bounceRate}%`,
          `Bounce rate increased from ${previous.bounceRate}% to ${current.bounceRate}% (+${bounceChange.toFixed(1)}pp). May indicate content or UX issues.`,
        ));
      }
    } catch (err) {
      console.log(`[Anomaly] GA4 check failed for ${ws.name}: ${err instanceof Error ? err.message : err}`);
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
          if (convChangePct <= THRESHOLDS.conversion_drop && !alreadyDetected(existing, ws.id, 'conversion_drop')) {
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

        if (scoreDiff <= THRESHOLDS.audit_score_drop && !alreadyDetected(existing, ws.id, 'audit_score_drop')) {
          detected.push(createAnomaly(ws, 'audit_score_drop', 'siteScore', latest.siteScore, prev.siteScore, scoreDiff, 'audit',
            `Site health score dropped ${Math.abs(scoreDiff)} points`,
            `Score went from ${prev.siteScore} to ${latest.siteScore}. Errors: ${latest.errors}, warnings: ${latest.warnings}.`,
          ));
        }

        if (scoreDiff >= THRESHOLDS.audit_score_improvement && !alreadyDetected(existing, ws.id, 'audit_score_improvement')) {
          detected.push(createAnomaly(ws, 'audit_score_improvement', 'siteScore', latest.siteScore, prev.siteScore, scoreDiff, 'audit',
            `Site health score improved ${scoreDiff} points!`,
            `Score went from ${prev.siteScore} to ${latest.siteScore}. Great progress!`,
          ));
        }
      }
    } catch (err) {
      console.log(`[Anomaly] Audit check failed for ${ws.name}: ${err instanceof Error ? err.message : err}`);
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
      model: 'gpt-4o-mini',
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

export async function runAnomalyDetection(): Promise<{ total: number; newAnomalies: number }> {
  console.log('[Anomaly] Starting anomaly detection scan...');
  const workspaces = listWorkspaces();
  const existing = readAnomalies();
  const allNew: Anomaly[] = [];

  for (const ws of workspaces) {
    // Skip workspaces without data connections
    if (!ws.gscPropertyUrl && !ws.ga4PropertyId && !ws.webflowSiteId) continue;

    try {
      const detected = await detectForWorkspace(ws, existing);
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
      }
    } catch (err) {
      console.error(`[Anomaly] Error scanning ${ws.name}:`, err);
    }
  }

  // Merge new anomalies with existing
  if (allNew.length > 0) {
    const merged = [...allNew, ...existing];
    writeAnomalies(merged);
    console.log(`[Anomaly] Detected ${allNew.length} new anomalies across ${workspaces.length} workspaces`);
  } else {
    console.log(`[Anomaly] No new anomalies detected`);
  }

  // Prune old anomalies (older than 60 days)
  clearOldAnomalies(60);

  return { total: existing.length + allNew.length, newAnomalies: allNew.length };
}

// --- Scheduler ---

let anomalyInterval: ReturnType<typeof setInterval> | null = null;

export function startAnomalyDetection() {
  if (anomalyInterval) return;

  // Run 2 minutes after startup, then every 12 hours
  setTimeout(() => {
    runAnomalyDetection().catch(err => console.error('[Anomaly] Scan error:', err));
  }, 2 * 60 * 1000);

  anomalyInterval = setInterval(() => {
    runAnomalyDetection().catch(err => console.error('[Anomaly] Scan error:', err));
  }, CHECK_INTERVAL_MS);

  console.log('[Anomaly] Detection scheduler started (every 12 hours)');
}

export function stopAnomalyDetection() {
  if (anomalyInterval) {
    clearInterval(anomalyInterval);
    anomalyInterval = null;
  }
}
