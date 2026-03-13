/**
 * Trial expiry email reminders.
 * 
 * Checks every 6 hours for workspaces with Growth trials expiring soon.
 * Sends reminder emails at day 10 (4 days left) and day 13 (1 day left).
 * Uses direct sendEmail (not queue) to ensure timely delivery.
 */

import { listWorkspaces, getClientPortalUrl } from './workspaces.js';
import { isEmailConfigured, sendEmail } from './email.js';
import { renderDigest, type EmailEvent } from './email-templates.js';
import { createLogger } from './logger.js';

const log = createLogger('trial-reminder');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const REMINDER_DAYS = [4, 1]; // days before expiry to send reminders

let interval: ReturnType<typeof setInterval> | null = null;
// Track which reminders we've sent: `${workspaceId}:${daysRemaining}`
const sentReminders = new Set<string>();


async function checkTrialExpiry() {
  if (!isEmailConfigured()) return;

  const workspaces = listWorkspaces();
  const now = Date.now();

  for (const ws of workspaces) {
    if (!ws.trialEndsAt || !ws.clientEmail) continue;

    const trialEnd = new Date(ws.trialEndsAt).getTime();
    const msRemaining = trialEnd - now;
    if (msRemaining <= 0) continue; // already expired

    const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

    for (const reminderDay of REMINDER_DAYS) {
      if (daysRemaining > reminderDay) continue;

      const key = `${ws.id}:${reminderDay}`;
      if (sentReminders.has(key)) continue;

      // Build a single-event digest for the trial warning template
      const event: EmailEvent = {
        type: 'trial_expiry_warning',
        recipient: ws.clientEmail,
        workspaceId: ws.id,
        workspaceName: ws.name,
        dashboardUrl: getClientPortalUrl(ws) || '',
        data: { daysRemaining },
        createdAt: new Date().toISOString(),
      };

      const { subject, html } = renderDigest('trial_expiry_warning', [event]);

      try {
        await sendEmail(ws.clientEmail, subject, html);
        sentReminders.add(key);
        log.info(`Sent ${daysRemaining}-day warning to ${ws.clientEmail} for "${ws.name}"`);
      } catch (err) {
        log.error({ err: err }, `Failed to send:`);
      }

      break; // only send the most urgent reminder per workspace per check
    }
  }
}

export function startTrialReminders() {
  if (interval) return;

  // Check 90s after startup, then every 6 hours
  setTimeout(() => {
    checkTrialExpiry().catch(err => log.error({ err }, 'Error'));
  }, 90_000);

  interval = setInterval(() => {
    checkTrialExpiry().catch(err => log.error({ err }, 'Error'));
  }, CHECK_INTERVAL_MS);

  log.info('Trial expiry checker started (checks every 6 hours)');
}

export function stopTrialReminders() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
