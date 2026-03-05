import { listWorkspaces, type Workspace } from './workspaces.js';
import { getLatestSnapshot } from './reports.js';
import { listActivity } from './activity-log.js';
import { listRequests } from './requests.js';
import { listBatches } from './approvals.js';
import { isEmailConfigured } from './email.js';
import nodemailer from 'nodemailer';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily check
let reportInterval: ReturnType<typeof setInterval> | null = null;

// Track when we last sent a report per workspace
const sentReports = new Map<string, string>(); // wsId -> 'YYYY-MM'

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
  const scoreColor = (data.siteScore ?? 0) >= 80 ? '#34d399' : (data.siteScore ?? 0) >= 60 ? '#fbbf24' : '#f87171';
  const scoreDelta = data.previousScore != null && data.siteScore != null
    ? data.siteScore - data.previousScore : null;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#0f1219;border-radius:16px;overflow:hidden;">
      <!-- Header -->
      <div style="padding:32px 24px 16px;text-align:center;">
        <div style="color:#2dd4bf;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Monthly Report</div>
        <h1 style="color:#fff;font-size:22px;margin:0;">${data.workspace.name}</h1>
        <div style="color:#71717a;font-size:13px;margin-top:4px;">${monthName}</div>
      </div>

      ${data.siteScore != null ? `
      <!-- Site Score -->
      <div style="padding:16px 24px;text-align:center;">
        <div style="display:inline-block;width:100px;height:100px;border-radius:50%;border:6px solid ${scoreColor};position:relative;line-height:88px;text-align:center;">
          <span style="font-size:32px;font-weight:700;color:${scoreColor};">${data.siteScore}</span>
        </div>
        <div style="color:#a1a1aa;font-size:12px;margin-top:8px;">Site Health Score</div>
        ${scoreDelta != null ? `<div style="color:${scoreDelta >= 0 ? '#34d399' : '#f87171'};font-size:13px;margin-top:2px;">${scoreDelta >= 0 ? '↑' : '↓'} ${Math.abs(scoreDelta)} from last audit</div>` : ''}
        ${data.totalPages ? `<div style="color:#71717a;font-size:11px;margin-top:2px;">${data.totalPages} pages · ${data.errors ?? 0} errors · ${data.warnings ?? 0} warnings</div>` : ''}
      </div>` : ''}

      <!-- Metrics Grid -->
      <div style="padding:0 24px 24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:12px;text-align:center;background:#18181b;border-radius:8px 0 0 0;">
              <div style="font-size:24px;font-weight:700;color:#60a5fa;">${data.requestsCompleted}</div>
              <div style="font-size:10px;color:#71717a;margin-top:2px;">Requests Completed</div>
            </td>
            <td style="padding:12px;text-align:center;background:#18181b;border-radius:0 8px 0 0;">
              <div style="font-size:24px;font-weight:700;color:#fbbf24;">${data.requestsOpen}</div>
              <div style="font-size:10px;color:#71717a;margin-top:2px;">Open Requests</div>
            </td>
          </tr>
          <tr>
            <td style="padding:12px;text-align:center;background:#18181b;border-radius:0 0 0 8px;">
              <div style="font-size:24px;font-weight:700;color:#34d399;">${data.approvalsApplied}</div>
              <div style="font-size:10px;color:#71717a;margin-top:2px;">Approvals Applied</div>
            </td>
            <td style="padding:12px;text-align:center;background:#18181b;border-radius:0 0 8px 0;">
              <div style="font-size:24px;font-weight:700;color:#a78bfa;">${data.activityCount}</div>
              <div style="font-size:10px;color:#71717a;margin-top:2px;">Activities This Month</div>
            </td>
          </tr>
        </table>
      </div>

      ${data.topActivities.length > 0 ? `
      <!-- Recent Activity -->
      <div style="padding:0 24px 24px;">
        <div style="color:#a1a1aa;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Recent Activity</div>
        ${data.topActivities.map(a => `
        <div style="padding:8px 12px;margin-bottom:4px;background:#18181b;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#d4d4d8;font-size:12px;">${a.title}</span>
          <span style="color:#52525b;font-size:10px;">${new Date(a.createdAt).toLocaleDateString()}</span>
        </div>`).join('')}
      </div>` : ''}

      ${data.approvalsPending > 0 ? `
      <!-- CTA -->
      <div style="padding:0 24px 24px;text-align:center;">
        <div style="background:#fbbf2415;border:1px solid #fbbf2430;border-radius:8px;padding:12px;">
          <span style="color:#fbbf24;font-size:12px;">⚠️ ${data.approvalsPending} approval batch${data.approvalsPending > 1 ? 'es' : ''} awaiting your review</span>
        </div>
      </div>` : ''}

      <!-- Footer -->
      <div style="padding:16px 24px;border-top:1px solid #27272a;text-align:center;">
        <div style="color:#52525b;font-size:10px;">Automated monthly summary from your web team's dashboard</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function sendMonthlyReport(ws: Workspace, data: MonthlyData) {
  if (!isEmailConfigured() || !ws.clientEmail) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: ws.clientEmail,
    subject: `📊 Monthly Report — ${ws.name} (${monthName})`,
    html: generateReportHTML(data),
  });
}

async function checkAndSendReports() {
  const month = currentMonth();
  const workspaces = listWorkspaces();

  for (const ws of workspaces) {
    if (!ws.clientEmail) continue;
    if (sentReports.get(ws.id) === month) continue;

    // Only send on or after the 1st of the month
    const now = new Date();
    if (now.getDate() < 1) continue; // safety

    const data = gatherMonthlyData(ws);
    console.log(`[Monthly Report] Generating report for ${ws.name} (${month})`);

    try {
      await sendMonthlyReport(ws, data);
      sentReports.set(ws.id, month);
      console.log(`[Monthly Report] Sent to ${ws.clientEmail}`);
    } catch (err) {
      console.error(`[Monthly Report] Failed for ${ws.name}:`, err);
    }
  }
}

export function startMonthlyReports() {
  if (reportInterval) return;

  // Check after 2 min on startup, then daily
  setTimeout(() => {
    checkAndSendReports().catch(err => console.error('[Monthly Report] Error:', err));
  }, 120000);

  reportInterval = setInterval(() => {
    checkAndSendReports().catch(err => console.error('[Monthly Report] Error:', err));
  }, CHECK_INTERVAL_MS);

  console.log('[Monthly Report] Report generator started (checks daily)');
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
    await sendMonthlyReport(ws, data);
    return { sent: true, html };
  }
  return { sent: false, html };
}
