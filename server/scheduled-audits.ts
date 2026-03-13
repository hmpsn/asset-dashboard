import fs from 'fs';
import path from 'path';
import { listWorkspaces, getTokenForSite, getClientPortalUrl } from './workspaces.js';
import { runSeoAudit } from './seo-audit.js';
import { saveSnapshot, getLatestSnapshotBefore } from './reports.js';
import { addActivity } from './activity-log.js';
import { notifyAuditAlert, notifyClientAuditComplete } from './email.js';

import { getUploadRoot } from './data-dir.js';

const UPLOAD_ROOT = getUploadRoot();
const SCHEDULE_FILE = path.join(UPLOAD_ROOT, '.audit-schedules.json');

export interface AuditSchedule {
  workspaceId: string;
  enabled: boolean;
  intervalDays: number; // e.g. 7 = weekly, 30 = monthly
  scoreDropThreshold: number; // alert if score drops more than this
  lastRunAt?: string;
  lastScore?: number;
}

function readSchedules(): AuditSchedule[] {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
    }
  } catch { /* no file yet */ }
  return [];
}

function writeSchedules(schedules: AuditSchedule[]) {
  fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true });
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2));
}

export function getSchedule(workspaceId: string): AuditSchedule | null {
  return readSchedules().find(s => s.workspaceId === workspaceId) || null;
}

export function listSchedules(): AuditSchedule[] {
  return readSchedules();
}

export function upsertSchedule(workspaceId: string, updates: Partial<Omit<AuditSchedule, 'workspaceId'>>): AuditSchedule {
  const schedules = readSchedules();
  const idx = schedules.findIndex(s => s.workspaceId === workspaceId);
  if (idx >= 0) {
    Object.assign(schedules[idx], updates);
    writeSchedules(schedules);
    return schedules[idx];
  }
  const newSchedule: AuditSchedule = {
    workspaceId,
    enabled: updates.enabled ?? true,
    intervalDays: updates.intervalDays ?? 7,
    scoreDropThreshold: updates.scoreDropThreshold ?? 5,
    lastRunAt: updates.lastRunAt,
    lastScore: updates.lastScore,
  };
  schedules.push(newSchedule);
  writeSchedules(schedules);
  return newSchedule;
}

export function deleteSchedule(workspaceId: string): boolean {
  const schedules = readSchedules();
  const idx = schedules.findIndex(s => s.workspaceId === workspaceId);
  if (idx === -1) return false;
  schedules.splice(idx, 1);
  writeSchedules(schedules);
  return true;
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
  console.log(`[Scheduled Audit] Running for ${ws.name} (${ws.webflowSiteId})`);

  try {
    const audit = await runSeoAudit(ws.webflowSiteId, token);
    const snapshot = saveSnapshot(ws.webflowSiteId, ws.name, audit);

    // Update schedule
    const oldScore = schedule.lastScore;
    upsertSchedule(schedule.workspaceId, {
      lastRunAt: new Date().toISOString(),
      lastScore: audit.siteScore,
    });

    // Log activity
    addActivity(ws.id, 'audit_completed',
      `Scheduled audit completed — score ${audit.siteScore}`,
      `${audit.totalPages} pages, ${audit.errors} errors, ${audit.warnings} warnings`,
      { score: audit.siteScore, previousScore: snapshot.previousScore, scheduled: true });

    // Check for score drop
    if (oldScore !== undefined && oldScore > audit.siteScore) {
      const drop = oldScore - audit.siteScore;
      if (drop >= schedule.scoreDropThreshold) {
        console.log(`[Scheduled Audit] Score drop detected: ${oldScore} → ${audit.siteScore} (-${drop})`);
        sendScoreDropAlert(ws, oldScore, audit.siteScore);
      }
    }

    // Send audit completion email to client
    if (ws.clientEmail) {
      const dashUrl = getClientPortalUrl(ws);
      const allIssues: Array<{ message: string; severity: string }> = [];
      for (const p of audit.pages) {
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

      let fixedCount = 0;
      if (snapshot.previousScore != null) {
        const prev = getLatestSnapshotBefore(ws.webflowSiteId!, snapshot.id);
        if (prev) {
          const prevKeys = new Set<string>();
          for (const p of prev.audit.pages) for (const iss of p.issues) prevKeys.add(`${p.pageId}:${iss.check}`);
          const curKeys = new Set<string>();
          for (const p of audit.pages) for (const iss of p.issues) curKeys.add(`${p.pageId}:${iss.check}`);
          for (const k of prevKeys) if (!curKeys.has(k)) fixedCount++;
        }
      }

      notifyClientAuditComplete({
        clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: ws.id,
        score: audit.siteScore, previousScore: snapshot.previousScore,
        totalPages: audit.totalPages, errors: audit.errors, warnings: audit.warnings,
        topIssues, fixedCount, dashboardUrl: dashUrl,
      });
    }
  } catch (err) {
    console.error(`[Scheduled Audit] Failed for ${ws.name}:`, err);
  }
}

let checkInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (checkInterval) return;

  // Check every hour if any audits are due
  const CHECK_MS = 60 * 60 * 1000;

  const checkDue = async () => {
    const schedules = readSchedules().filter(s => s.enabled);
    const now = Date.now();

    for (const schedule of schedules) {
      const ws = listWorkspaces().find(w => w.id === schedule.workspaceId);
      if (!ws?.webflowSiteId) continue;

      const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : 0;
      const intervalMs = schedule.intervalDays * 24 * 60 * 60 * 1000;

      if (now - lastRun >= intervalMs) {
        await runScheduledAudit(schedule);
      }
    }
  };

  // Run check on startup after 30s delay, then every hour
  setTimeout(() => {
    checkDue().catch(err => console.error('[Scheduler] Error:', err));
  }, 30000);

  checkInterval = setInterval(() => {
    checkDue().catch(err => console.error('[Scheduler] Error:', err));
  }, CHECK_MS);

  console.log('[Scheduler] Audit scheduler started (checks every hour)');
}

export function stopScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
