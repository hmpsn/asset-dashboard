import { listWorkspaces, getClientPortalUrl } from './workspaces.js';
import { listBatches } from './approvals.js';
import { isEmailConfigured, sendEmail } from './email.js';
import { renderApprovalReminder } from './email-templates.js';
import { canSend, recordSend } from './email-throttle.js';
import { createLogger } from './logger.js';

const log = createLogger('approval-reminder');

const STALE_DAYS = 3; // remind if pending > 3 days
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // every 12 hours

let reminderInterval: ReturnType<typeof setInterval> | null = null;
const sentReminders = new Map<string, number>(); // batchId -> last reminder timestamp

async function sendApprovalReminderEmail(
  clientEmail: string,
  workspaceName: string,
  batchName: string,
  pendingCount: number,
  staleDays: number,
  dashboardUrl?: string
) {
  if (!isEmailConfigured()) return;
  const { subject, html } = renderApprovalReminder({ workspaceName, batchName, pendingCount, staleDays, dashboardUrl });
  await sendEmail(clientEmail, subject, html);
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

      const dashUrl = getClientPortalUrl(ws);

      // Throttle: respect global daily cap
      const throttle = canSend(ws.clientEmail, 'action');
      if (!throttle.allowed) {
        log.info(`Throttled approval reminder to ${ws.clientEmail}: ${throttle.reason}`);
        continue;
      }

      log.info(`Sending reminder for batch "${batch.name}" to ${ws.clientEmail} (${staleDays} days stale)`);
      try {
        await sendApprovalReminderEmail(ws.clientEmail, ws.name, batch.name, pendingItems.length, staleDays, dashUrl);
        recordSend(ws.clientEmail, 'action', 'approval_reminder', ws.id, 1);
        sentReminders.set(batch.id, now);
      } catch (err) {
        log.error({ err: err }, `Failed to send:`);
      }
    }
  }
}

export function startApprovalReminders() {
  if (reminderInterval) return;

  // Check after 60s on startup, then every 12 hours
  setTimeout(() => {
    checkStaleApprovals().catch(err => log.error({ err }, 'Error'));
  }, 60000);

  reminderInterval = setInterval(() => {
    checkStaleApprovals().catch(err => log.error({ err }, 'Error'));
  }, CHECK_INTERVAL_MS);

  log.info('Stale approval checker started (checks every 12 hours)');
}

export function stopApprovalReminders() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}
