/**
 * Churn prevention signals — daily background job that detects at-risk clients.
 *
 * Signals detected:
 * - no_login_14d: No client login in 14+ days
 * - chat_dropoff: Chat activity dropped significantly
 * - no_requests_30d: No requests submitted in 30+ days
 * - health_score_drop: Site health score dropped 10+ points
 * - trial_ending: Trial ending within 3 days without upgrade
 * - payment_failed: Recent payment failure
 *
 * Positive signals:
 * - traffic_up: Organic traffic up 20%+ vs previous period
 * - high_engagement: Multiple logins + chat sessions this week
 */

import fs from 'fs';
import path from 'path';
import db from './db/index.js';
import { getUploadRoot } from './data-dir.js';
import { listWorkspaces } from './workspaces.js';
import { listActivity } from './activity-log.js';
import { listClientUsers } from './client-users.js';
import { notifyTeamChurnSignal } from './email.js';

const UPLOAD_ROOT = getUploadRoot();
const MAX_SIGNALS = 200;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours

export type SignalType =
  | 'no_login_14d'
  | 'chat_dropoff'
  | 'no_requests_30d'
  | 'health_score_drop'
  | 'trial_ending'
  | 'payment_failed'
  | 'traffic_up'
  | 'high_engagement';

export type SignalSeverity = 'critical' | 'warning' | 'positive';

export interface ChurnSignal {
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: SignalType;
  severity: SignalSeverity;
  title: string;
  description: string;
  detectedAt: string;
  dismissedAt?: string;
}

// --- SQLite row shape ---

interface ChurnSignalRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  detected_at: string;
  dismissed_at: string | null;
}

function rowToSignal(row: ChurnSignalRow): ChurnSignal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    type: row.type as SignalType,
    severity: row.severity as SignalSeverity,
    title: row.title,
    description: row.description,
    detectedAt: row.detected_at,
    dismissedAt: row.dismissed_at ?? undefined,
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

interface Stmts {
  selectAll: ReturnType<typeof db.prepare>;
  selectActive: ReturnType<typeof db.prepare>;
  selectActiveByWorkspace: ReturnType<typeof db.prepare>;
  selectById: ReturnType<typeof db.prepare>;
  selectUndismissedByTypeWs: ReturnType<typeof db.prepare>;
  insert: ReturnType<typeof db.prepare>;
  dismiss: ReturnType<typeof db.prepare>;
  countAll: ReturnType<typeof db.prepare>;
  pruneOldest: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;

function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
      selectAll: db.prepare('SELECT * FROM churn_signals ORDER BY detected_at DESC'),
      selectActive: db.prepare('SELECT * FROM churn_signals WHERE dismissed_at IS NULL ORDER BY detected_at DESC'),
      selectActiveByWorkspace: db.prepare('SELECT * FROM churn_signals WHERE dismissed_at IS NULL AND workspace_id = ? ORDER BY detected_at DESC'),
      selectById: db.prepare('SELECT * FROM churn_signals WHERE id = ?'),
      selectUndismissedByTypeWs: db.prepare('SELECT * FROM churn_signals WHERE workspace_id = ? AND type = ? AND dismissed_at IS NULL LIMIT 1'),
      insert: db.prepare(`
        INSERT INTO churn_signals (id, workspace_id, workspace_name, type, severity,
          title, description, detected_at, dismissed_at)
        VALUES (@id, @workspace_id, @workspace_name, @type, @severity,
          @title, @description, @detected_at, @dismissed_at)
      `),
      dismiss: db.prepare('UPDATE churn_signals SET dismissed_at = ? WHERE id = ?'),
      countAll: db.prepare('SELECT COUNT(*) as count FROM churn_signals'),
      pruneOldest: db.prepare(`
        DELETE FROM churn_signals WHERE id IN (
          SELECT id FROM churn_signals ORDER BY detected_at ASC LIMIT ?
        )
      `),
    };
  }
  return _stmts;
}

export function listChurnSignals(workspaceId?: string): ChurnSignal[] {
  if (workspaceId) {
    const rows = stmts().selectActiveByWorkspace.all(workspaceId) as ChurnSignalRow[];
    return rows.map(rowToSignal);
  }
  const rows = stmts().selectActive.all() as ChurnSignalRow[];
  return rows.map(rowToSignal);
}

export function dismissSignal(signalId: string): boolean {
  const info = stmts().dismiss.run(new Date().toISOString(), signalId);
  return info.changes > 0;
}

function addSignal(signal: Omit<ChurnSignal, 'id' | 'detectedAt'>): ChurnSignal {
  // Dedupe: don't add if same type + workspace already exists (undismissed)
  const existing = stmts().selectUndismissedByTypeWs.get(signal.workspaceId, signal.type) as ChurnSignalRow | undefined;
  if (existing) return rowToSignal(existing);

  const entry: ChurnSignal = {
    ...signal,
    id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    detectedAt: new Date().toISOString(),
  };

  stmts().insert.run({
    id: entry.id,
    workspace_id: entry.workspaceId,
    workspace_name: entry.workspaceName,
    type: entry.type,
    severity: entry.severity,
    title: entry.title,
    description: entry.description,
    detected_at: entry.detectedAt,
    dismissed_at: entry.dismissedAt ?? null,
  });

  // Keep last 200 signals
  const { count } = stmts().countAll.get() as { count: number };
  if (count > MAX_SIGNALS) {
    stmts().pruneOldest.run(count - MAX_SIGNALS);
  }

  return entry;
}

async function runChurnCheck() {
  const workspaces = listWorkspaces();
  const now = Date.now();

  for (const ws of workspaces) {
    if (!ws.clientPortalEnabled) continue;

    const activities = listActivity(ws.id, 100);
    const clientUsers = listClientUsers(ws.id);

    // ── No Login in 14 days ──
    if (clientUsers.length > 0) {
      const lastLogin = clientUsers
        .map(u => u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0)
        .reduce((a, b) => Math.max(a, b), 0);

      if (lastLogin > 0 && now - lastLogin > 14 * 24 * 60 * 60 * 1000) {
        const daysSince = Math.floor((now - lastLogin) / (24 * 60 * 60 * 1000));
        addSignal({
          workspaceId: ws.id,
          workspaceName: ws.name,
          type: 'no_login_14d',
          severity: daysSince > 30 ? 'critical' : 'warning',
          title: `No client login in ${daysSince} days`,
          description: `${ws.name} hasn't logged into their dashboard in ${daysSince} days. Last login: ${new Date(lastLogin).toLocaleDateString()}.`,
        });
      }
    }

    // ── Chat Drop-off ──
    const chatActivities = activities.filter(a => a.type === 'chat_session');
    const recentChats = chatActivities.filter(a => now - new Date(a.createdAt).getTime() < 14 * 24 * 60 * 60 * 1000);
    const olderChats = chatActivities.filter(a => {
      const t = now - new Date(a.createdAt).getTime();
      return t >= 14 * 24 * 60 * 60 * 1000 && t < 28 * 24 * 60 * 60 * 1000;
    });
    if (olderChats.length >= 3 && recentChats.length === 0) {
      addSignal({
        workspaceId: ws.id,
        workspaceName: ws.name,
        type: 'chat_dropoff',
        severity: 'warning',
        title: 'AI advisor usage dropped off',
        description: `${ws.name} had ${olderChats.length} chat sessions in weeks 3-4 but zero in the last 2 weeks.`,
      });
    }

    // ── No Requests in 30 days ──
    const requestActivities = activities.filter(a => a.type === 'content_requested' || a.type === 'note');
    const recentRequests = requestActivities.filter(a => now - new Date(a.createdAt).getTime() < 30 * 24 * 60 * 60 * 1000);
    if (requestActivities.length > 0 && recentRequests.length === 0) {
      addSignal({
        workspaceId: ws.id,
        workspaceName: ws.name,
        type: 'no_requests_30d',
        severity: 'warning',
        title: 'No requests in 30+ days',
        description: `${ws.name} previously submitted requests but none in the last 30 days.`,
      });
    }

    // ── Health Score Drop ──
    try {
      const auditDir = path.join(UPLOAD_ROOT, ws.folder);
      const auditFiles = fs.readdirSync(auditDir).filter(f => f.startsWith('audit-') && f.endsWith('.json')).sort().reverse();
      if (auditFiles.length >= 2) {
        const latest = JSON.parse(fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf-8'));
        const previous = JSON.parse(fs.readFileSync(path.join(auditDir, auditFiles[1]), 'utf-8'));
        const latestScore = latest.audit?.siteScore ?? latest.siteScore;
        const prevScore = previous.audit?.siteScore ?? previous.siteScore;
        if (latestScore != null && prevScore != null && prevScore - latestScore >= 10) {
          addSignal({
            workspaceId: ws.id,
            workspaceName: ws.name,
            type: 'health_score_drop',
            severity: prevScore - latestScore >= 20 ? 'critical' : 'warning',
            title: `Site health dropped ${prevScore - latestScore} points`,
            description: `${ws.name} health score went from ${prevScore} to ${latestScore}. Investigate potential regressions.`,
          });
        }
      }
    } catch { /* skip audit check if files aren't readable */ }

    // ── Trial Ending ──
    if (ws.trialEndsAt) {
      const trialEnd = new Date(ws.trialEndsAt).getTime();
      const daysLeft = Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000));
      if (daysLeft > 0 && daysLeft <= 3) {
        addSignal({
          workspaceId: ws.id,
          workspaceName: ws.name,
          type: 'trial_ending',
          severity: daysLeft <= 1 ? 'critical' : 'warning',
          title: `Trial expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
          description: `${ws.name} Growth trial ends ${daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`}. No upgrade detected yet.`,
        });
      }
    }

    // ── Payment Failed ──
    const paymentFailures = activities.filter(a => a.type === 'payment_failed' && now - new Date(a.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000);
    if (paymentFailures.length > 0) {
      addSignal({
        workspaceId: ws.id,
        workspaceName: ws.name,
        type: 'payment_failed',
        severity: 'critical',
        title: 'Payment failed this week',
        description: `${ws.name} had ${paymentFailures.length} failed payment${paymentFailures.length > 1 ? 's' : ''} in the last 7 days.`,
      });
    }

    // ── Positive: High Engagement ──
    const weekActivities = activities.filter(a => now - new Date(a.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000);
    const weekChats = weekActivities.filter(a => a.type === 'chat_session').length;
    const weekLogins = clientUsers.filter(u => u.lastLoginAt && now - new Date(u.lastLoginAt).getTime() < 7 * 24 * 60 * 60 * 1000).length;
    if (weekChats >= 3 && weekLogins >= 2) {
      addSignal({
        workspaceId: ws.id,
        workspaceName: ws.name,
        type: 'high_engagement',
        severity: 'positive',
        title: 'Highly engaged this week',
        description: `${ws.name} had ${weekChats} chat sessions and ${weekLogins} active users this week.`,
      });
    }
  }

  // Send email notifications for critical signals
  const allSignals = stmts().selectAll.all() as ChurnSignalRow[];
  const criticalSignals = allSignals
    .filter(s => !s.dismissed_at && (s.severity === 'critical' || s.severity === 'warning'));
  for (const signal of criticalSignals) {
    notifyTeamChurnSignal({
      workspaceName: signal.workspace_name,
      workspaceId: signal.workspace_id,
      signalTitle: signal.title,
      signalDescription: signal.description,
      severity: signal.severity,
    });
  }

  console.log('[churn-signals] Check completed at', new Date().toISOString());
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startChurnSignalScheduler() {
  // Run immediately on startup
  runChurnCheck().catch(err => console.error('[churn-signals] Error:', err));

  // Then every 6 hours
  interval = setInterval(() => {
    runChurnCheck().catch(err => console.error('[churn-signals] Error:', err));
  }, CHECK_INTERVAL_MS);

  console.log('[churn-signals] Scheduler started (every 6h)');
}

export function stopChurnSignalScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
