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
import { getUploadRoot } from './data-dir.js';
import { listWorkspaces } from './workspaces.js';
import { listActivity } from './activity-log.js';
import { listClientUsers } from './client-users.js';

const UPLOAD_ROOT = getUploadRoot();
const SIGNALS_FILE = path.join(UPLOAD_ROOT, '.churn-signals.json');
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

function readSignals(): ChurnSignal[] {
  try {
    if (fs.existsSync(SIGNALS_FILE)) {
      return JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf-8'));
    }
  } catch { /* no file yet */ }
  return [];
}

function writeSignals(signals: ChurnSignal[]) {
  fs.mkdirSync(path.dirname(SIGNALS_FILE), { recursive: true });
  fs.writeFileSync(SIGNALS_FILE, JSON.stringify(signals, null, 2));
}

export function listChurnSignals(workspaceId?: string): ChurnSignal[] {
  const all = readSignals();
  const active = all.filter(s => !s.dismissedAt);
  if (workspaceId) return active.filter(s => s.workspaceId === workspaceId);
  return active;
}

export function dismissSignal(signalId: string): boolean {
  const signals = readSignals();
  const signal = signals.find(s => s.id === signalId);
  if (!signal) return false;
  signal.dismissedAt = new Date().toISOString();
  writeSignals(signals);
  return true;
}

function addSignal(signal: Omit<ChurnSignal, 'id' | 'detectedAt'>): ChurnSignal {
  const signals = readSignals();
  // Dedupe: don't add if same type + workspace already exists (undismissed)
  const existing = signals.find(s => s.workspaceId === signal.workspaceId && s.type === signal.type && !s.dismissedAt);
  if (existing) return existing;

  const entry: ChurnSignal = {
    ...signal,
    id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    detectedAt: new Date().toISOString(),
  };
  signals.push(entry);
  // Keep last 200 signals
  if (signals.length > 200) signals.splice(0, signals.length - 200);
  writeSignals(signals);
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
    // Check audit data for score drop
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
            description: `${ws.name} health score went from ${prevScore} → ${latestScore}. Investigate potential regressions.`,
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
