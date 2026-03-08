/**
 * Trial expiry email reminders.
 * 
 * Checks every 6 hours for workspaces with Growth trials expiring soon.
 * Sends reminder emails at day 10 (4 days left) and day 13 (1 day left).
 * Uses direct sendEmail (not queue) to ensure timely delivery.
 */

import { listWorkspaces } from './workspaces.js';
import { isEmailConfigured, sendEmail } from './email.js';
import { renderDigest, type EmailEvent } from './email-templates.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const REMINDER_DAYS = [4, 1]; // days before expiry to send reminders

let interval: ReturnType<typeof setInterval> | null = null;
// Track which reminders we've sent: `${workspaceId}:${daysRemaining}`
const sentReminders = new Set<string>();

function getDashboardUrl(ws: { id: string; liveDomain?: string }): string {
  if (ws.liveDomain) {
    const domain = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
    return `${domain}/client/${ws.id}`;
  }
  return '';
}

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
        dashboardUrl: getDashboardUrl(ws),
        data: { daysRemaining },
        createdAt: new Date().toISOString(),
      };

      const { subject, html } = renderDigest('trial_expiry_warning', [event]);

      try {
        await sendEmail(ws.clientEmail, subject, html);
        sentReminders.add(key);
        console.log(`[Trial Reminder] Sent ${daysRemaining}-day warning to ${ws.clientEmail} for "${ws.name}"`);
      } catch (err) {
        console.error(`[Trial Reminder] Failed to send:`, err);
      }

      break; // only send the most urgent reminder per workspace per check
    }
  }
}

export function startTrialReminders() {
  if (interval) return;

  // Check 90s after startup, then every 6 hours
  setTimeout(() => {
    checkTrialExpiry().catch(err => console.error('[Trial Reminder] Error:', err));
  }, 90_000);

  interval = setInterval(() => {
    checkTrialExpiry().catch(err => console.error('[Trial Reminder] Error:', err));
  }, CHECK_INTERVAL_MS);

  console.log('[Trial Reminder] Trial expiry checker started (checks every 6 hours)');
}

export function stopTrialReminders() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
