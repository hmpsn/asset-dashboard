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
import { startDataRetentionCrons } from './data-retention.js';
import { startIntelligenceCrons, startCompetitorMonitoringCron } from './intelligence-crons.js';
import { startInsightRecomputeCron } from './insight-recompute-cron.js';
import { startRankTrackingScheduler } from './rank-tracking-scheduler.js';
import { startBriefingCron } from './briefing-cron.js';
import { startStrategyIssueCron } from './strategy-issue-cron.js';

/** Start all background schedulers and queues. */
let started = false;

export function startSchedulers() {
  if (started) return;
  started = true;
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
  startDataRetentionCrons();
  startIntelligenceCrons();
  startCompetitorMonitoringCron();
  startInsightRecomputeCron();
  startRankTrackingScheduler();
  startBriefingCron();
  startStrategyIssueCron();
}
