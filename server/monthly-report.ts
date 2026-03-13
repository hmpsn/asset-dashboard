import { listWorkspaces, getUploadRoot, type Workspace } from './workspaces.js';
import { applySuppressionsToAudit } from './helpers.js';
import { getLatestSnapshot } from './reports.js';
import { listActivity } from './activity-log.js';
import { listRequests } from './requests.js';
import { listBatches } from './approvals.js';
import { isEmailConfigured, sendEmail } from './email.js';
import { renderMonthlyReport } from './email-templates.js';
import { getSearchPeriodComparison } from './search-console.js';
import { getGA4PeriodComparison } from './google-analytics.js';
import { listSessions } from './chat-memory.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDir } from './data-dir.js';

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

interface TrafficComparison {
  clicks?: { current: number; previous: number; changePct: number };
  impressions?: { current: number; previous: number; changePct: number };
  users?: { current: number; previous: number; changePct: number };
  sessions?: { current: number; previous: number; changePct: number };
  pageviews?: { current: number; previous: number; changePct: number };
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
  traffic?: TrafficComparison;
  chatTopics?: { title: string; summary: string }[];
}

async function gatherMonthlyData(ws: Workspace): Promise<MonthlyData> {
  const rawSnapshot = ws.webflowSiteId ? getLatestSnapshot(ws.webflowSiteId) : null;
  const snapshot = rawSnapshot && ws.auditSuppressions?.length
    ? { ...rawSnapshot, audit: applySuppressionsToAudit(rawSnapshot.audit, ws.auditSuppressions) }
    : rawSnapshot;
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

  // Fetch period comparison data from GSC + GA4
  const traffic: TrafficComparison = {};
  const days = 28;

  if (ws.gscPropertyUrl) {
    try {
      const cmp = await getSearchPeriodComparison(ws.id, ws.gscPropertyUrl, days);
      traffic.clicks = { current: cmp.current.clicks, previous: cmp.previous.clicks, changePct: cmp.changePercent.clicks };
      traffic.impressions = { current: cmp.current.impressions, previous: cmp.previous.impressions, changePct: cmp.changePercent.impressions };
    } catch { /* GSC unavailable */ }
  }

  if (ws.ga4PropertyId) {
    try {
      const cmp = await getGA4PeriodComparison(ws.ga4PropertyId, days);
      traffic.users = { current: cmp.current.totalUsers, previous: cmp.previous.totalUsers, changePct: cmp.changePercent.users };
      traffic.sessions = { current: cmp.current.totalSessions, previous: cmp.previous.totalSessions, changePct: cmp.changePercent.sessions };
      traffic.pageviews = { current: cmp.current.totalPageviews, previous: cmp.previous.totalPageviews, changePct: cmp.changePercent.pageviews };
    } catch { /* GA4 unavailable */ }
  }

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
    traffic: Object.keys(traffic).length > 0 ? traffic : undefined,
    chatTopics: (() => {
      try {
        const sessions = listSessions(ws.id, 'client');
        const recent = sessions
          .filter(s => s.summary && new Date(s.updatedAt) >= monthStart)
          .slice(0, 5)
          .map(s => ({ title: s.title, summary: s.summary! }));
        return recent.length > 0 ? recent : undefined;
      } catch { return undefined; }
    })(),
  };
}

export function generateReportHTML(data: MonthlyData): string {
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const ws = data.workspace;
  const trialEnd = ws.trialEndsAt ? new Date(ws.trialEndsAt) : null;
  const isTrial = trialEnd ? trialEnd > new Date() : false;
  const trialDaysRemaining = isTrial && trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : undefined;
  const { html } = renderMonthlyReport({
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
    traffic: data.traffic,
    chatTopics: data.chatTopics,
    isTrial,
    trialDaysRemaining,
  });
  return html;
}

async function sendMonthlyReportEmail(ws: Workspace, data: MonthlyData) {
  if (!isEmailConfigured() || !ws.clientEmail) return;

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const trialEnd = ws.trialEndsAt ? new Date(ws.trialEndsAt) : null;
  const isTrial = trialEnd ? trialEnd > new Date() : false;
  const trialDaysRemaining = isTrial && trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : undefined;
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
    traffic: data.traffic,
    chatTopics: data.chatTopics,
    isTrial,
    trialDaysRemaining,
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

    const data = await gatherMonthlyData(ws);
    console.log(`[Auto Report] Generating ${freq} report for ${ws.name} (${period})`);

    try {
      const html = generateReportHTML(data);
      saveMonthlyReport(ws.id, ws.name, html, data);
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
export async function triggerMonthlyReport(workspaceId: string): Promise<{ sent: boolean; html: string; reportId?: string }> {
  const ws = listWorkspaces().find(w => w.id === workspaceId);
  if (!ws) throw new Error('Workspace not found');
  const data = await gatherMonthlyData(ws);
  const html = generateReportHTML(data);
  // Persist the report for shareable permalink
  const reportId = saveMonthlyReport(workspaceId, ws.name, html, data);
  if (ws.clientEmail && isEmailConfigured()) {
    await sendMonthlyReportEmail(ws, data);
    return { sent: true, html, reportId };
  }
  return { sent: false, html, reportId };
}

// ── Monthly Report Persistence ──

const MONTHLY_REPORTS_DIR = getDataDir('monthly-reports');

export interface SavedMonthlyReport {
  id: string;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  period: string;
  siteScore?: number;
  previousScore?: number;
  totalPages?: number;
  errors?: number;
  warnings?: number;
  trafficHighlights?: {
    clicks?: { current: number; changePct: number };
    impressions?: { current: number; changePct: number };
    users?: { current: number; changePct: number };
  };
}

function wsReportDir(workspaceId: string): string {
  const dir = path.join(MONTHLY_REPORTS_DIR, workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveMonthlyReport(workspaceId: string, workspaceName: string, html: string, data: MonthlyData): string {
  const id = `mr_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date();
  const period = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const meta: SavedMonthlyReport = {
    id,
    workspaceId,
    workspaceName,
    createdAt: now.toISOString(),
    period,
    siteScore: data.siteScore,
    previousScore: data.previousScore,
    totalPages: data.totalPages,
    errors: data.errors,
    warnings: data.warnings,
    trafficHighlights: data.traffic ? {
      clicks: data.traffic.clicks ? { current: data.traffic.clicks.current, changePct: data.traffic.clicks.changePct } : undefined,
      impressions: data.traffic.impressions ? { current: data.traffic.impressions.current, changePct: data.traffic.impressions.changePct } : undefined,
      users: data.traffic.users ? { current: data.traffic.users.current, changePct: data.traffic.users.changePct } : undefined,
    } : undefined,
  };

  const dir = wsReportDir(workspaceId);
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, `${id}.html`), html);
  return id;
}

export function getMonthlyReportHTML(reportId: string): string | null {
  if (!fs.existsSync(MONTHLY_REPORTS_DIR)) return null;
  const wsDirs = fs.readdirSync(MONTHLY_REPORTS_DIR);
  for (const wsDir of wsDirs) {
    const htmlPath = path.join(MONTHLY_REPORTS_DIR, wsDir, `${reportId}.html`);
    if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, 'utf-8');
  }
  return null;
}

export function listMonthlyReports(workspaceId: string): SavedMonthlyReport[] {
  const dir = path.join(MONTHLY_REPORTS_DIR, workspaceId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const reports: SavedMonthlyReport[] = [];
  for (const file of files) {
    try {
      reports.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
    } catch { /* skip corrupt */ }
  }
  return reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
