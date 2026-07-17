import type { CockpitVerdict, CockpitVerdictEvidence } from '../../shared/types/cockpit.js';
import type { AdminMoneyFrame } from '../../shared/types/outcome-tracking.js';
import type { WorkQueueClassification } from '../../shared/types/work-queue.js';

interface AuditLike {
  errors?: number;
  warnings?: number;
  siteScore?: number;
}

interface WeeklySummaryLike {
  seoUpdates: number;
  auditsRun: number;
  contentGenerated: number;
  contentPublished: number;
  requestsResolved: number;
}

interface ContentVelocityLike {
  currentMonthPublished?: number;
  trailingThreeMonthAvg?: number;
  trendPct?: number | null;
}

interface BuildCockpitVerdictInput {
  workQueue?: WorkQueueClassification | null;
  audit?: AuditLike | null;
  weeklySummary?: WeeklySummaryLike | null;
  moneyFrame?: AdminMoneyFrame | null;
  contentVelocity?: ContentVelocityLike | null;
  generatedAt?: Date;
}

function positive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function workCount(workQueue: WorkQueueClassification | null | undefined, stream: keyof WorkQueueClassification['streams']): number {
  return positive(workQueue?.streams?.[stream]);
}

function weeklyTotal(summary: WeeklySummaryLike | null | undefined): number {
  if (!summary) return 0;
  return summary.seoUpdates + summary.auditsRun + summary.contentGenerated + summary.contentPublished + summary.requestsResolved;
}

export function buildCockpitVerdict({
  workQueue,
  audit,
  weeklySummary,
  moneyFrame,
  contentVelocity,
  generatedAt = new Date(),
}: BuildCockpitVerdictInput): CockpitVerdict {
  const opt = workCount(workQueue, 'opt');
  const send = workCount(workQueue, 'send');
  const money = workCount(workQueue, 'money');
  const unclassified = workCount(workQueue, 'unclassified');
  const blockedItems = (workQueue?.items ?? []).filter((item) => item.direction === 'negative').length;
  const totalWork = opt + send + money + unclassified;
  const auditErrors = positive(audit?.errors);
  const siteScore = typeof audit?.siteScore === 'number' && Number.isFinite(audit.siteScore) ? audit.siteScore : null;
  const accomplishments = weeklyTotal(weeklySummary);
  const publishedThisMonth = positive(contentVelocity?.currentMonthPublished);

  const evidence: CockpitVerdictEvidence[] = [
    { label: 'Work queue', value: totalWork, tone: totalWork > 0 ? 'warning' : 'positive' },
    { label: 'Send-ready', value: send, tone: send > 0 ? 'positive' : 'neutral' },
    { label: 'Optimization', value: opt, tone: opt > 0 ? 'warning' : 'neutral' },
  ];

  if (siteScore != null) {
    evidence.push({
      label: 'Site health',
      value: Math.round(siteScore),
      tone: siteScore >= 80 ? 'positive' : siteScore >= 60 ? 'warning' : 'danger',
    });
  }

  if (moneyFrame) {
    evidence.push({
      label: 'Value at stake',
      value: Math.round(moneyFrame.valueAtStake),
      tone: moneyFrame.valueAtStake > 0 ? 'positive' : 'neutral',
    });
  }

  if (accomplishments > 0) {
    evidence.push({ label: 'This week', value: accomplishments, tone: 'positive' });
  }

  if (publishedThisMonth > 0) {
    evidence.push({ label: 'Published this month', value: publishedThisMonth, tone: 'positive' });
  }

  if (auditErrors > 5 || blockedItems > 2 || unclassified > 3) {
    return {
      status: 'at_risk',
      headline: 'This client needs operator attention before the next send.',
      narrative: `${blockedItems} risk signal${blockedItems === 1 ? '' : 's'} and ${unclassified} item${unclassified === 1 ? '' : 's'} not yet sorted need triage before this workspace reads as steady.`,
      generatedAt: generatedAt.toISOString(),
      evidence,
    };
  }

  if (totalWork > 0) {
    return {
      status: 'watch',
      headline: send > 0
        ? 'Client-facing work is ready to review and send.'
        : 'The cockpit has optimization work queued for this client.',
      narrative: `${send} send item${send === 1 ? '' : 's'}, ${opt} optimization item${opt === 1 ? '' : 's'}, and ${money} growth play${money === 1 ? '' : 's'} are waiting in the shared work queue.`,
      generatedAt: generatedAt.toISOString(),
      evidence,
    };
  }

  if (accomplishments > 0 || publishedThisMonth > 0) {
    return {
      status: 'on_track',
      headline: 'This client is on track with no urgent operator queue.',
      narrative: `${accomplishments} accomplishment${accomplishments === 1 ? '' : 's'} landed this week and no shared work-queue item is currently blocking the next review.`,
      generatedAt: generatedAt.toISOString(),
      evidence,
    };
  }

  return {
    status: 'establishing',
    headline: 'The cockpit is still establishing this client baseline.',
    narrative: 'Connect data sources, run the first audit, or let workspace activity accumulate before the verdict becomes actionable.',
    generatedAt: generatedAt.toISOString(),
    evidence,
  };
}
