import { listWorkspaces } from './workspaces.js';
import { listBatches } from './approvals.js';
import { isEmailConfigured } from './email.js';
import nodemailer from 'nodemailer';

const STALE_DAYS = 3; // remind if pending > 3 days
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // every 12 hours

let reminderInterval: ReturnType<typeof setInterval> | null = null;
const sentReminders = new Map<string, number>(); // batchId -> last reminder timestamp

async function sendApprovalReminder(
  clientEmail: string,
  workspaceName: string,
  batchName: string,
  pendingCount: number,
  staleDays: number,
  dashboardUrl?: string
) {
  if (!isEmailConfigured()) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: clientEmail,
    subject: `Reminder: ${pendingCount} SEO changes awaiting your approval — ${workspaceName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#2dd4bf;margin-bottom:8px;">Approval Reminder</h2>
        <p style="color:#444;">You have <strong>${pendingCount} SEO changes</strong> in <strong>"${batchName}"</strong> that have been waiting for your review for <strong>${staleDays} days</strong>.</p>
        <p style="color:#666;font-size:14px;">Approving these changes lets your web team push updates live on your site.</p>
        ${dashboardUrl ? `<a href="${dashboardUrl}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#2dd4bf;color:#0f1219;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review Changes</a>` : ''}
        <p style="color:#999;font-size:11px;margin-top:24px;">This is an automated reminder from your web team's dashboard.</p>
      </div>
    `,
  });
}

async function checkStaleApprovals() {
  const workspaces = listWorkspaces();
  const now = Date.now();

  for (const ws of workspaces) {
    if (!ws.clientEmail) continue;

    const batches = listBatches(ws.id);
    for (const batch of batches) {
      if (batch.status === 'applied') continue;

      const pendingItems = batch.items.filter(i => i.status === 'pending');
      if (pendingItems.length === 0) continue;

      const createdAt = new Date(batch.createdAt).getTime();
      const staleDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
      if (staleDays < STALE_DAYS) continue;

      // Don't re-send reminder within 3 days
      const lastSent = sentReminders.get(batch.id) || 0;
      if (now - lastSent < 3 * 24 * 60 * 60 * 1000) continue;

      const dashUrl = ws.liveDomain
        ? `${ws.liveDomain.startsWith('http') ? '' : 'https://'}${ws.liveDomain}/client/${ws.id}`
        : undefined;

      console.log(`[Approval Reminder] Sending reminder for batch "${batch.name}" to ${ws.clientEmail} (${staleDays} days stale)`);
      try {
        await sendApprovalReminder(ws.clientEmail, ws.name, batch.name, pendingItems.length, staleDays, dashUrl);
        sentReminders.set(batch.id, now);
      } catch (err) {
        console.error(`[Approval Reminder] Failed to send:`, err);
      }
    }
  }
}

export function startApprovalReminders() {
  if (reminderInterval) return;

  // Check after 60s on startup, then every 12 hours
  setTimeout(() => {
    checkStaleApprovals().catch(err => console.error('[Approval Reminder] Error:', err));
  }, 60000);

  reminderInterval = setInterval(() => {
    checkStaleApprovals().catch(err => console.error('[Approval Reminder] Error:', err));
  }, CHECK_INTERVAL_MS);

  console.log('[Approval Reminder] Stale approval checker started (checks every 12 hours)');
}

export function stopApprovalReminders() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}
