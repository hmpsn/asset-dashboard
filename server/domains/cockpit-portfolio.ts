import type { Workspace } from '../../shared/types/workspace.js';
import type {
  CockpitPortfolioRollup,
  CockpitPortfolioVerdictTotals,
  CockpitPortfolioWorkspaceRow,
} from '../../shared/types/cockpit-portfolio.js';
import type { CockpitVerdictStatus } from '../../shared/types/cockpit.js';
import type { WorkQueueClassification, WorkQueueStream } from '../../shared/types/work-queue.js';
import { WORK_QUEUE_STREAMS } from '../../shared/types/work-queue.js';
import { listActivity } from '../activity-log.js';
import { getLatestEffectiveSnapshot } from '../audit-snapshot-views.js';
import { listChurnSignals } from '../churn-signals.js';
import { loadDecayAnalysis } from '../content-decay.js';
import { listMatrices } from '../content-matrices.js';
import { getContentVelocityTrend } from '../content-posts.js';
import { listContentRequests } from '../content-requests.js';
import { createLogger } from '../logger.js';
import { loadAdminMoneyFrame } from '../money-frame-store.js';
import { getLatestRanks } from '../rank-tracking.js';
import { listRequests } from '../requests.js';
import { listWorkOrders } from '../work-orders.js';
import { buildCockpitVerdict } from './cockpit-verdict.js';
import { classifyWorkQueue } from './work-queue.js';

const log = createLogger('cockpit-portfolio');

const VERDICT_ATTENTION_PRIORITY: Record<CockpitVerdictStatus, number> = {
  at_risk: 4,
  watch: 3,
  establishing: 2,
  on_track: 1,
};

const MONEY_TOTAL_REASON = 'Workspace money frames can use different attribution bases and measurement windows, so a book total is not yet reconcilable.';

export interface CockpitPortfolioWorkspaceInput {
  workspaceId: string;
  workspaceName: string;
  workQueue: WorkQueueClassification;
  verdict: CockpitPortfolioWorkspaceRow['verdict'];
}

interface BuildCockpitPortfolioOptions {
  generatedAt?: Date;
}

interface WeeklySummary {
  seoUpdates: number;
  auditsRun: number;
  contentGenerated: number;
  contentPublished: number;
  requestsResolved: number;
}

function safeRead<T>(workspaceId: string, source: string, read: () => T, fallback: T): T {
  try {
    return read();
  } catch (err) {
    log.warn({ err, workspaceId, source }, 'cockpit portfolio partial fetch failed');
    return fallback;
  }
}

function weeklySummaryFor(
  activity: Array<{ type: string; createdAt: string }>,
  generatedAt: Date,
): WeeklySummary | null {
  const sevenDaysAgo = new Date(generatedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentActivity = activity.filter(entry => new Date(entry.createdAt) >= sevenDaysAgo);
  const summary: WeeklySummary = {
    seoUpdates: recentActivity.filter(entry => entry.type === 'seo_updated' || entry.type === 'approval_applied').length,
    auditsRun: recentActivity.filter(entry => entry.type === 'audit_completed').length,
    contentGenerated: recentActivity.filter(entry => entry.type === 'brief_generated' || entry.type === 'post_generated').length,
    contentPublished: recentActivity.filter(entry => entry.type === 'content_published').length,
    requestsResolved: recentActivity.filter(entry => entry.type === 'request_resolved').length,
  };
  return Object.values(summary).some(count => count > 0) ? summary : null;
}

function emptyStreams(): Record<WorkQueueStream, number> {
  return { opt: 0, send: 0, money: 0, unclassified: 0 };
}

function emptyVerdicts(): CockpitPortfolioVerdictTotals {
  return { at_risk: 0, watch: 0, establishing: 0, on_track: 0 };
}

function attentionFacts(input: CockpitPortfolioWorkspaceInput) {
  return {
    negativeItemCount: input.workQueue.items.filter(item => item.direction === 'negative').length,
    unclassifiedItemCount: input.workQueue.streams.unclassified,
    totalItemCount: input.workQueue.items.length,
  };
}

function compareAttention(a: CockpitPortfolioWorkspaceInput, b: CockpitPortfolioWorkspaceInput): number {
  const verdictDelta = VERDICT_ATTENTION_PRIORITY[b.verdict.status] - VERDICT_ATTENTION_PRIORITY[a.verdict.status];
  if (verdictDelta !== 0) return verdictDelta;

  const aFacts = attentionFacts(a);
  const bFacts = attentionFacts(b);
  const negativeDelta = bFacts.negativeItemCount - aFacts.negativeItemCount;
  if (negativeDelta !== 0) return negativeDelta;
  const unclassifiedDelta = bFacts.unclassifiedItemCount - aFacts.unclassifiedItemCount;
  if (unclassifiedDelta !== 0) return unclassifiedDelta;
  const totalDelta = bFacts.totalItemCount - aFacts.totalItemCount;
  if (totalDelta !== 0) return totalDelta;

  return a.workspaceName.localeCompare(b.workspaceName) || a.workspaceId.localeCompare(b.workspaceId);
}

export function buildCockpitPortfolioRollup(
  inputs: CockpitPortfolioWorkspaceInput[],
  options: BuildCockpitPortfolioOptions = {},
): CockpitPortfolioRollup {
  const generatedAt = options.generatedAt ?? new Date();
  const ranked = [...inputs].sort(compareAttention);
  const streams = emptyStreams();
  const verdicts = emptyVerdicts();

  for (const input of ranked) {
    for (const stream of WORK_QUEUE_STREAMS) streams[stream] += input.workQueue.streams[stream];
    verdicts[input.verdict.status] += 1;
  }

  const workspaces = ranked.map((input, index): CockpitPortfolioWorkspaceRow => {
    const facts = attentionFacts(input);
    return {
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      attention: {
        rank: index + 1,
        needsAttention: input.verdict.status !== 'on_track',
        ...facts,
      },
      workQueue: input.workQueue,
      verdict: input.verdict,
    };
  });

  return {
    generatedAt: generatedAt.toISOString(),
    workspaces,
    totals: {
      workspaces: { status: 'reconciled', value: workspaces.length },
      attentionNeeded: {
        status: 'reconciled',
        value: workspaces.filter(row => row.attention.needsAttention).length,
      },
      workQueue: {
        status: 'reconciled',
        value: {
          itemCount: workspaces.reduce((sum, row) => sum + row.workQueue.items.length, 0),
          streams,
        },
      },
      verdicts: { status: 'reconciled', value: verdicts },
      valueAtStake: {
        status: 'not_yet_reconcilable',
        value: null,
        reason: MONEY_TOTAL_REASON,
      },
      recoveredSoFar: {
        status: 'not_yet_reconcilable',
        value: null,
        reason: MONEY_TOTAL_REASON,
      },
    },
  };
}

export function assembleCockpitPortfolioWorkspace(
  workspace: Workspace,
  generatedAt: Date,
): CockpitPortfolioWorkspaceInput {
  const workspaceId = workspace.id;
  const ranks = safeRead(workspaceId, 'rank tracking', () => getLatestRanks(workspaceId), []);
  const requests = safeRead(workspaceId, 'requests', () => listRequests(workspaceId), []);
  const contentRequests = safeRead(workspaceId, 'content requests', () => listContentRequests(workspaceId), []);
  const activity = safeRead(workspaceId, 'activity', () => listActivity(workspaceId), []);
  const churnSignals = safeRead(workspaceId, 'churn signals', () => listChurnSignals(workspaceId), []);
  const workOrders = safeRead(workspaceId, 'work orders', () => listWorkOrders(workspaceId), []);
  const matrices = safeRead(workspaceId, 'content matrices', () => listMatrices(workspaceId), []);
  const contentVelocity = safeRead(workspaceId, 'content velocity', () => getContentVelocityTrend(workspaceId), null);
  const contentDecay = safeRead(workspaceId, 'content decay', () => loadDecayAnalysis(workspaceId)?.summary ?? null, null);
  const moneyFrame = safeRead(workspaceId, 'money frame', () => loadAdminMoneyFrame(workspaceId), null);
  const audit = safeRead(workspaceId, 'audit snapshot', () => {
    const snapshot = workspace.webflowSiteId
      ? getLatestEffectiveSnapshot(workspace.webflowSiteId, workspace.auditSuppressions || [])
      : null;
    return snapshot
      ? {
        errors: snapshot.audit.errors,
        warnings: snapshot.audit.warnings,
        siteScore: snapshot.audit.siteScore,
      }
      : null;
  }, null);

  const allCells = matrices.flatMap(matrix => matrix.cells || []);
  const contentPipeline = {
    reviewCells: allCells.filter(cell => cell.status === 'review' || cell.status === 'flagged').length,
  };
  const workQueue = classifyWorkQueue({
    clientId: workspaceId,
    requests,
    workOrders,
    contentRequests,
    ranks,
    contentPipeline,
    contentDecay,
    audit,
    churnSignals,
    setup: {
      webflowSiteId: workspace.webflowSiteId,
      gscPropertyUrl: workspace.gscPropertyUrl,
      ga4PropertyId: workspace.ga4PropertyId,
      includeGaps: true,
    },
  });
  const verdict = buildCockpitVerdict({
    workQueue,
    audit,
    weeklySummary: weeklySummaryFor(activity, generatedAt),
    moneyFrame,
    contentVelocity,
    generatedAt,
  });

  return {
    workspaceId,
    workspaceName: workspace.name,
    workQueue,
    verdict,
  };
}

export function buildCockpitPortfolio(
  workspaces: Workspace[],
  options: BuildCockpitPortfolioOptions = {},
): CockpitPortfolioRollup {
  const generatedAt = options.generatedAt ?? new Date();
  const inputs = workspaces.map(workspace => assembleCockpitPortfolioWorkspace(workspace, generatedAt));
  return buildCockpitPortfolioRollup(inputs, { generatedAt });
}
