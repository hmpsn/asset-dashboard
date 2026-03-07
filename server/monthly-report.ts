import { listWorkspaces, getUploadRoot, type Workspace } from './workspaces.js';
import { getLatestSnapshot } from './reports.js';
import { listActivity } from './activity-log.js';
import { listRequests } from './requests.js';
import { listBatches } from './approvals.js';
import { isEmailConfigured, sendEmail } from './email.js';
import { renderMonthlyReport } from './email-templates.js';
import fs from 'fs';
import path from 'path';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // check every 6 hours
let reportInterval: ReturnType<typeof setInterval> | null = null;

// ── Persist sent-report timestamps to disk (survives restarts/deploys) ──
const SENT_FILE = path.join(getUploadRoot(), '.report-sent.json');

function loadSentReports(): Record<string, string> {
  try {
    if (fs.existsSync(SENT_FILE)) return JSON.parse(fs.readFileSync(SENT_FILE, 'utf-8'));
  } catch { /* fresh */ }
  return {};
}

function saveSentReports(data: Record<string, string>) {
  try { fs.writeFileSync(SENT_FILE, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ISO week number for weekly frequency
function currentWeek(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function currentPeriod(frequency: 'weekly' | 'monthly'): string {
  return frequency === 'weekly' ? currentWeek() : currentMonth();
}

interface MonthlyData {
  workspace: Workspace;
  siteScore?: number;
  previousScore?: number;
  totalPages?: number;
  errors?: number;
  warnings?: number;
  requestsCompleted: number;
  requestsOpen: number;
  approvalsApplied: number;
  approvalsPending: number;
  activityCount: number;
  topActivities: { title: string; createdAt: string }[];
}

function gatherMonthlyData(ws: Workspace): MonthlyData {
  const snapshot = ws.webflowSiteId ? getLatestSnapshot(ws.webflowSiteId) : null;
  const requests = listRequests(ws.id);
  const batches = listBatches(ws.id);
  const activities = listActivity(ws.id, 30);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const recentRequests = requests.filter(r => new Date(r.createdAt) >= monthStart);
  const completedThisMonth = recentRequests.filter(r => r.status === 'completed' || r.status === 'closed').length;
  const openRequests = requests.filter(r => r.status === 'new' || r.status === 'in_review' || r.status === 'in_progress').length;

  const appliedBatches = batches.filter(b => b.status === 'applied').length;
  const pendingBatches = batches.filter(b => b.status === 'pending' || b.status === 'partial').length;

  return {
    workspace: ws,
    siteScore: snapshot?.audit.siteScore,
    previousScore: snapshot?.previousScore,
    totalPages: snapshot?.audit.totalPages,
    errors: snapshot?.audit.errors,
    warnings: snapshot?.audit.warnings,
    requestsCompleted: completedThisMonth,
    requestsOpen: openRequests,
    approvalsApplied: appliedBatches,
    approvalsPending: pendingBatches,
    activityCount: activities.length,
    topActivities: activities.slice(0, 5).map(a => ({ title: a.title, createdAt: a.createdAt })),
  };
}

export function generateReportHTML(data: MonthlyData): string {
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const { html } = renderMonthlyReport({
    workspaceName: data.workspace.name,
    monthName,
    siteScore: data.siteScore,
    previousScore: data.previousScore,
    totalPages: data.totalPages,
    errors: data.errors,
    warnings: data.warnings,
    requestsCompleted: data.requestsCompleted,
    requestsOpen: data.requestsOpen,
    approvalsApplied: data.approvalsApplied,
    approvalsPending: data.approvalsPending,
    activityCount: data.activityCount,
    topActivities: data.topActivities,
  });
  return html;
}

async function sendMonthlyReportEmail(ws: Workspace, data: MonthlyData) {
  if (!isEmailConfigured() || !ws.clientEmail) return;

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const { subject, html } = renderMonthlyReport({
    workspaceName: ws.name,
    monthName,
    siteScore: data.siteScore,
    previousScore: data.previousScore,
    totalPages: data.totalPages,
    errors: data.errors,
    warnings: data.warnings,
    requestsCompleted: data.requestsCompleted,
    requestsOpen: data.requestsOpen,
    approvalsApplied: data.approvalsApplied,
    approvalsPending: data.approvalsPending,
    activityCount: data.activityCount,
    topActivities: data.topActivities,
  });
  await sendEmail(ws.clientEmail, subject, html);
}

async function checkAndSendReports() {
  const workspaces = listWorkspaces();
  const sent = loadSentReports();
  let changed = false;

  for (const ws of workspaces) {
    // Must have autoReports enabled AND a client email configured
    if (!ws.autoReports) continue;
    if (!ws.clientEmail) continue;

    const freq = ws.autoReportFrequency || 'monthly';
    const period = currentPeriod(freq);

    // Already sent for this period
    if (sent[ws.id] === period) continue;

    const data = gatherMonthlyData(ws);
    console.log(`[Auto Report] Generating ${freq} report for ${ws.name} (${period})`);

    try {
      await sendMonthlyReportEmail(ws, data);
      sent[ws.id] = period;
      changed = true;
      console.log(`[Auto Report] Sent to ${ws.clientEmail}`);
    } catch (err) {
      console.error(`[Auto Report] Failed for ${ws.name}:`, err);
    }
  }

  if (changed) saveSentReports(sent);
}

export function startMonthlyReports() {
  if (reportInterval) return;

  // Check after 5 min on startup (avoids re-send during rapid restart cycles), then every 6 hours
  setTimeout(() => {
    checkAndSendReports().catch(err => console.error('[Auto Report] Error:', err));
  }, 5 * 60 * 1000);

  reportInterval = setInterval(() => {
    checkAndSendReports().catch(err => console.error('[Auto Report] Error:', err));
  }, CHECK_INTERVAL_MS);

  console.log('[Auto Report] Report scheduler started (checks every 6 hours)');
}

export function stopMonthlyReports() {
  if (reportInterval) {
    clearInterval(reportInterval);
    reportInterval = null;
  }
}

// Manual trigger: generate + send report for a workspace now
export async function triggerMonthlyReport(workspaceId: string): Promise<{ sent: boolean; html: string }> {
  const ws = listWorkspaces().find(w => w.id === workspaceId);
  if (!ws) throw new Error('Workspace not found');
  const data = gatherMonthlyData(ws);
  const html = generateReportHTML(data);
  if (ws.clientEmail && isEmailConfigured()) {
    await sendMonthlyReportEmail(ws, data);
    return { sent: true, html };
  }
  return { sent: false, html };
}
