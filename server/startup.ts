import { initEmailQueue } from './email.js';
import { startThrottleCleanup } from './email-throttle.js';
import { startScheduler } from './scheduled-audits.js';
import { startApprovalReminders } from './approval-reminders.js';
import { startMonthlyReports } from './monthly-report.js';
import { startBackupScheduler } from './backup.js';
import { clearTestModeCustomerIds } from './stripe.js';
import { startTrialReminders } from './trial-reminders.js';
import { startChurnSignalScheduler } from './churn-signals.js';
import { startAnomalyDetection } from './anomaly-detection.js';
import { startOutcomeCrons } from './outcome-crons.js';

/** Start all background schedulers and queues. */
export function startSchedulers() {
  initEmailQueue();
  startThrottleCleanup();
  startScheduler();
  startApprovalReminders();
  startMonthlyReports();
  startBackupScheduler();
  clearTestModeCustomerIds();
  startTrialReminders();
  startChurnSignalScheduler();
  startAnomalyDetection();
  startOutcomeCrons();
}
