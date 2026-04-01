import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { listWorkspaces, getTokenForSite, getClientPortalUrl } from './workspaces.js';
import { runSeoAudit } from './seo-audit.js';
import { saveSnapshot, getLatestSnapshotBefore } from './reports.js';
import { addActivity } from './activity-log.js';
import { notifyAuditAlert, notifyClientAuditComplete } from './email.js';
import { applySuppressionsToAudit } from './helpers.js';
import { createLogger } from './logger.js';
import { fireBridge } from './bridge-infrastructure.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('scheduled-audit');

export interface AuditSchedule {
  workspaceId: string;
  enabled: boolean;
  intervalDays: number; // e.g. 7 = weekly, 30 = monthly
  scoreDropThreshold: number; // alert if score drops more than this
  lastRunAt?: string;
  lastScore?: number;
}

// --- SQLite row shape ---

interface AuditScheduleRow {
  workspace_id: string;
  enabled: number;
  interval_days: number;
  score_drop_threshold: number;
  last_run_at: string | null;
  last_score: number | null;
}

function rowToSchedule(row: AuditScheduleRow): AuditSchedule {
  return {
    workspaceId: row.workspace_id,
    enabled: row.enabled === 1,
    intervalDays: row.interval_days,
    scoreDropThreshold: row.score_drop_threshold,
    lastRunAt: row.last_run_at ?? undefined,
    lastScore: row.last_score ?? undefined,
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

const stmts = createStmtCache(() => ({
  selectAll: db.prepare('SELECT * FROM audit_schedules'),
  selectById: db.prepare('SELECT * FROM audit_schedules WHERE workspace_id = ?'),
  upsert: db.prepare(`
        INSERT INTO audit_schedules (workspace_id, enabled, interval_days, score_drop_threshold,
          last_run_at, last_score)
        VALUES (@workspace_id, @enabled, @interval_days, @score_drop_threshold,
          @last_run_at, @last_score)
        ON CONFLICT(workspace_id) DO UPDATE SET
          enabled = @enabled, interval_days = @interval_days,
          score_drop_threshold = @score_drop_threshold,
          last_run_at = @last_run_at, last_score = @last_score
      `),
  deleteById: db.prepare('DELETE FROM audit_schedules WHERE workspace_id = ?'),
}));

export function getSchedule(workspaceId: string): AuditSchedule | null {
  const row = stmts().selectById.get(workspaceId) as AuditScheduleRow | undefined;
  return row ? rowToSchedule(row) : null;
}

export function listSchedules(): AuditSchedule[] {
  const rows = stmts().selectAll.all() as AuditScheduleRow[];
  return rows.map(rowToSchedule);
}

export function upsertSchedule(workspaceId: string, updates: Partial<Omit<AuditSchedule, 'workspaceId'>>): AuditSchedule {
  const existing = getSchedule(workspaceId);
  const merged: AuditSchedule = {
    workspaceId,
    enabled: updates.enabled ?? existing?.enabled ?? true,
    intervalDays: updates.intervalDays ?? existing?.intervalDays ?? 7,
    scoreDropThreshold: updates.scoreDropThreshold ?? existing?.scoreDropThreshold ?? 5,
    lastRunAt: updates.lastRunAt ?? existing?.lastRunAt,
    lastScore: updates.lastScore ?? existing?.lastScore,
  };

  stmts().upsert.run({
    workspace_id: merged.workspaceId,
    enabled: merged.enabled ? 1 : 0,
    interval_days: merged.intervalDays,
    score_drop_threshold: merged.scoreDropThreshold,
    last_run_at: merged.lastRunAt ?? null,
    last_score: merged.lastScore ?? null,
  });

  return merged;
}

export function deleteSchedule(workspaceId: string): boolean {
  const info = stmts().deleteById.run(workspaceId);
  return info.changes > 0;
}

function sendScoreDropAlert(ws: { name: string; id: string }, oldScore: number, newScore: number) {
  notifyAuditAlert({
    workspaceName: ws.name,
    workspaceId: ws.id,
    siteName: ws.name,
    score: newScore,
    previousScore: oldScore,
  });
}

async function runScheduledAudit(schedule: AuditSchedule) {
  const ws = listWorkspaces().find(w => w.id === schedule.workspaceId);
  if (!ws?.webflowSiteId) return;

  const token = getTokenForSite(ws.webflowSiteId) || undefined;
  log.info(`Running for ${ws.name} (${ws.webflowSiteId})`);

  try {
    const audit = await runSeoAudit(ws.webflowSiteId, token);
    const snapshot = saveSnapshot(ws.webflowSiteId, ws.name, audit);

    // Apply suppressions so all client-facing numbers match the dashboard
    const effectiveAudit = ws.auditSuppressions?.length
      ? applySuppressionsToAudit(audit, ws.auditSuppressions)
      : audit;

    // Update schedule with suppressed score
    const oldScore = schedule.lastScore;
    upsertSchedule(schedule.workspaceId, {
      lastRunAt: new Date().toISOString(),
      lastScore: effectiveAudit.siteScore,
    });

    // Log activity with suppressed numbers
    addActivity(ws.id, 'audit_completed',
      `Scheduled audit completed — score ${effectiveAudit.siteScore}`,
      `${effectiveAudit.totalPages} pages, ${effectiveAudit.errors} errors, ${effectiveAudit.warnings} warnings`,
      { score: effectiveAudit.siteScore, previousScore: snapshot.previousScore, scheduled: true });

    // ── Bridge #12: Audit → page_health insights ──────────────────────
    fireBridge('bridge-audit-page-health', ws.id, async () => {
      const { upsertInsight, getInsights } = await import('./analytics-insights-store.js');
      const existing = getInsights(ws.id);

      // Map critical/warning audit issues to page_health insights
      const criticalPages = effectiveAudit.pages
        .filter(p => p.issues?.some(i => i.severity === 'error' || i.severity === 'warning'));

      for (const page of criticalPages.slice(0, 20)) { // Cap at 20 to avoid flooding
        const pageIssues = page.issues.filter(i => i.severity === 'error' || i.severity === 'warning');
        if (pageIssues.length === 0) continue;

        // Deduplicate: skip if identical page_health insight exists
        const existingForPage = existing.find(
          i => i.insightType === 'page_health' && i.pageId === page.pageId && i.resolutionStatus !== 'resolved',
        );
        if (existingForPage) continue;

        upsertInsight({
          workspaceId: ws.id,
          insightType: 'page_health',
          pageId: page.pageId,
          pageTitle: page.page,
          severity: pageIssues.some(i => i.severity === 'error') ? 'critical' : 'warning',
          data: {
            title: `Audit: ${pageIssues.length} issue(s) on ${page.page || page.pageId}`,
            description: pageIssues.map(i => i.message).join('; '),
            issueCount: pageIssues.length,
            source: 'bridge_12_audit_page_health',
          },
          impactScore: pageIssues.some(i => i.severity === 'error') ? 80 : 50,
          resolutionSource: 'bridge_12_audit_page_health',
        });
      }

      broadcastToWorkspace(ws.id, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, {
        bridge: 'bridge_12_audit_page_health',
      });
    });

    // ── Bridge #15: Audit → site_health insights ──────────────────────
    fireBridge('bridge-audit-site-health', ws.id, async () => {
      const { upsertInsight } = await import('./analytics-insights-store.js');

      // Create site-level insight from aggregate audit findings
      const totalIssues = effectiveAudit.errors + effectiveAudit.warnings;
      const score = effectiveAudit.siteScore;
      if (totalIssues > 0 && score < 70) {
        upsertInsight({
          workspaceId: ws.id,
          insightType: 'page_health',
          pageId: null,
          severity: score < 50 ? 'critical' : 'warning',
          data: {
            title: `Site health: ${totalIssues} issues, score ${score}/100`,
            description: `Audit found ${totalIssues} total issues across the site. Overall health score: ${score}/100.`,
            totalIssues,
            siteScore: score,
            source: 'bridge_15_audit_site_health',
          },
          impactScore: Math.max(0, 100 - score),
          resolutionSource: 'bridge_15_audit_site_health',
        });

        broadcastToWorkspace(ws.id, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, {
          bridge: 'bridge_15_audit_site_health',
        });
      }
    });

    // Check for score drop using suppressed score
    if (oldScore !== undefined && oldScore > effectiveAudit.siteScore) {
      const drop = oldScore - effectiveAudit.siteScore;
      if (drop >= schedule.scoreDropThreshold) {
        log.info(`Score drop detected: ${oldScore} -> ${effectiveAudit.siteScore} (-${drop})`);
        sendScoreDropAlert(ws, oldScore, effectiveAudit.siteScore);
      }
    }

    // Send audit completion email to client using suppressed data
    if (ws.clientEmail) {
      const dashUrl = getClientPortalUrl(ws);
      const allIssues: Array<{ message: string; severity: string }> = [];
      for (const p of effectiveAudit.pages) {
        for (const iss of p.issues) {
          if (iss.severity === 'error' || iss.severity === 'warning') {
            allIssues.push({ message: iss.message, severity: iss.severity });
          }
        }
      }
      const seen = new Map<string, { message: string; severity: string }>();
      for (const iss of allIssues) {
        const existing = seen.get(iss.message);
        if (!existing || (iss.severity === 'error' && existing.severity !== 'error')) {
          seen.set(iss.message, iss);
        }
      }
      const uniqueIssues = [...seen.values()];
      uniqueIssues.sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
      const topIssues = uniqueIssues.slice(0, 5);

      // Compare suppressed versions for accurate fixed count
      let fixedCount = 0;
      if (snapshot.previousScore != null) {
        const prev = getLatestSnapshotBefore(ws.webflowSiteId!, snapshot.id);
        if (prev) {
          const prevAudit = ws.auditSuppressions?.length
            ? applySuppressionsToAudit(prev.audit, ws.auditSuppressions)
            : prev.audit;
          const prevKeys = new Set<string>();
          for (const p of prevAudit.pages) for (const iss of p.issues) prevKeys.add(`${p.pageId}:${iss.check}`);
          const curKeys = new Set<string>();
          for (const p of effectiveAudit.pages) for (const iss of p.issues) curKeys.add(`${p.pageId}:${iss.check}`);
          for (const k of prevKeys) if (!curKeys.has(k)) fixedCount++;
        }
      }

      notifyClientAuditComplete({
        clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: ws.id,
        score: effectiveAudit.siteScore, previousScore: snapshot.previousScore,
        totalPages: effectiveAudit.totalPages, errors: effectiveAudit.errors, warnings: effectiveAudit.warnings,
        topIssues, fixedCount, dashboardUrl: dashUrl,
      });
    }
  } catch (err) {
    log.error({ err: err }, `Failed for ${ws.name}:`);
  }
}

const runningAudits = new Set<string>();

let checkInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (checkInterval) return;

  // Check every hour if any audits are due
  const CHECK_MS = 60 * 60 * 1000;

  const checkDue = async () => {
    const schedules = listSchedules().filter(s => s.enabled);
    const now = Date.now();

    for (const schedule of schedules) {
      const ws = listWorkspaces().find(w => w.id === schedule.workspaceId);
      if (!ws?.webflowSiteId) continue;

      const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : 0;
      const intervalMs = schedule.intervalDays * 24 * 60 * 60 * 1000;

      if (now - lastRun >= intervalMs) {
        if (runningAudits.has(schedule.workspaceId)) continue;
        runningAudits.add(schedule.workspaceId);
        try {
          await runScheduledAudit(schedule);
        } finally {
          runningAudits.delete(schedule.workspaceId);
        }
      }
    }
  };

  // Run check on startup after 30s delay, then every hour
  setTimeout(() => {
    checkDue().catch(err => log.error({ err }, 'Error'));
  }, 30000);

  checkInterval = setInterval(() => {
    checkDue().catch(err => log.error({ err }, 'Error'));
  }, CHECK_MS);

  log.info('Audit scheduler started (checks every hour)');
}

export function stopScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
