import { listWorkspaces, getClientPortalUrl } from './workspaces.js';
import { listBatches } from './approvals.js';
import { isEmailConfigured, sendEmail } from './email.js';
import { renderApprovalReminder } from './email-templates.js';
import { canSend, recordSend } from './email-throttle.js';
import { createLogger } from './logger.js';
import { getReminderSentAt, upsertReminder, deleteReminder, pruneReminders } from './sent-reminders-db.js';

const log = createLogger('approval-reminder');

const STALE_DAYS = 3; // remind if pending > 3 days
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // every 12 hours

let reminderInterval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

async function sendApprovalReminderEmail(
  clientEmail: string,
  workspaceName: string,
  batchName: string,
  pendingCount: number,
  staleDays: number,
  dashboardUrl?: string
): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const { subject, html } = renderApprovalReminder({ workspaceName, batchName, pendingCount, staleDays, dashboardUrl });
  await sendEmail(clientEmail, subject, html);
  return true;
}

export async function checkStaleApprovals() {
  if (!isEmailConfigured()) {
    pruneReminders('-7 days');
    return;
  }

  const workspaces = listWorkspaces();
  const now = Date.now();

  for (const ws of workspaces) {
    if (!ws.clientEmail) continue;

    const batches = listBatches(ws.id);
    for (const batch of batches) {
      const key = `approval:${batch.id}`;

      if (batch.status === 'applied') {
        deleteReminder(key);
        continue;
      }

      const pendingItems = batch.items.filter(i => i.status === 'pending');
      if (pendingItems.length === 0) continue;

      const createdAt = new Date(batch.createdAt).getTime();
      const staleDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
      if (staleDays < STALE_DAYS) continue;

      // Don't re-send reminder within 3 days
      const lastSentAt = getReminderSentAt(key);
      if (lastSentAt) {
        const lastSentMs = new Date(lastSentAt).getTime();
        if (now - lastSentMs < 3 * 24 * 60 * 60 * 1000) continue;
      }

      const dashUrl = getClientPortalUrl(ws);

      // Throttle: respect global daily cap
      const throttle = canSend(ws.clientEmail, 'action');
      if (!throttle.allowed) {
        log.info(`Throttled approval reminder to ${ws.clientEmail}: ${throttle.reason}`);
        continue;
      }

      log.info(`Sending reminder for batch "${batch.name}" to ${ws.clientEmail} (${staleDays} days stale)`);
      try {
        const sent = await sendApprovalReminderEmail(ws.clientEmail, ws.name, batch.name, pendingItems.length, staleDays, dashUrl);
        if (!sent) continue;
        recordSend(ws.clientEmail, 'action', 'approval_reminder', ws.id, 1);
        upsertReminder(key);
      } catch (err) {
        log.error({ err: err }, `Failed to send:`);
      }
    }
  }

  // Prune entries older than 7 days
  pruneReminders('-7 days');
}

export function startApprovalReminders() {
  if (reminderInterval) return;

  // Check after 60s on startup, then every 12 hours
  startupTimeout = setTimeout(() => {
    checkStaleApprovals().catch(err => log.error({ err }, 'Error'));
  }, 60000);
  startupTimeout.unref?.();

  reminderInterval = setInterval(() => {
    checkStaleApprovals().catch(err => log.error({ err }, 'Error'));
  }, CHECK_INTERVAL_MS);
  reminderInterval.unref?.();

  log.info('Stale approval checker started (checks every 12 hours)');
}

export function stopApprovalReminders() {
  if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}
