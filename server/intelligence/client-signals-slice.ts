import type {
  ClientCompositeHealthBreakdown,
  ClientSignalsSlice,
  ChurnSignalSummary,
  EngagementMetrics,
  IntelligenceOptions,
} from '../../shared/types/intelligence.js';
import type { BriefingSummary } from '../../shared/types/briefing.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';
import type { ChurnSignal } from '../churn-signals.js';
import type { ROIData } from '../roi.js';
import type { SafeClientUser } from '../../shared/types/users.js';
import type { ClientRequest } from '../../shared/types/requests.js';
import type { SessionSummary } from '../chat-memory.js';
import { createLogger } from '../logger.js';
import { buildKeywordFeedbackSignals } from '../keyword-feedback.js';
import { listContentGapVoteSignals } from '../content-gap-votes.js';
import {
  buildEffectiveBusinessPriorities,
  getRawClientBusinessPriorities,
} from './business-priorities-source.js';
import { readOptionalSlicePart } from './optional-slice-part.js';
import { loadRecommendations } from '../recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

const log = createLogger('workspace-intelligence/client-signals');

const COMPOSITE_HEALTH_WEIGHTS = {
  retention: 40,
  roi: 30,
  engagement: 30,
} as const;

function describeRetentionScore(score: number): string {
  if (score >= 90) return 'Relationship signals are steady, so this part of the score stays strong.';
  if (score >= 60) return 'Recent relationship signals are mostly steady, with one area to strengthen.';
  if (score >= 30) return 'Recent relationship signals show a few areas to strengthen before confidence improves.';
  return 'Recent relationship signals need attention before this part of the score can recover.';
}

function describeRoiScore(growth: number): string {
  if (growth > 10) return 'Organic value is growing strongly compared with the prior period.';
  if (growth > 0) return 'Organic value is trending up compared with the prior period.';
  if (growth === 0) return 'Organic value is holding steady compared with the prior period.';
  return 'Organic value is below the prior period, which lowers this part of the score.';
}

function describeEngagementScore(loginFrequency: EngagementMetrics['loginFrequency']): string {
  if (loginFrequency === 'daily') return 'Recent portal activity is strong.';
  if (loginFrequency === 'weekly') return 'Recent portal activity is steady.';
  return 'Recent portal activity is light, so this part of the score has room to improve.';
}

function normalizeBreakdownWeights(
  rows: ClientCompositeHealthBreakdown['rows'],
): ClientCompositeHealthBreakdown['rows'] {
  const totalRawWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalRawWeight <= 0) return rows;

  const weightedRows = rows.map((row, index) => {
    const exact = (row.weight / totalRawWeight) * 100;
    const floor = Math.floor(exact);
    return { row, index, floor, remainder: exact - floor };
  });
  const remaining = 100 - weightedRows.reduce((sum, item) => sum + item.floor, 0);
  const extraIndexes = new Set(
    [...weightedRows]
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .slice(0, remaining)
      .map(item => item.index),
  );

  return weightedRows.map(({ row, index, floor }) => ({
    ...row,
    weight: floor + (extraIndexes.has(index) ? 1 : 0),
  }));
}

export async function assembleClientSignals(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<ClientSignalsSlice> {
  const keywordFeedback = await readOptionalSlicePart<
    ClientSignalsSlice['keywordFeedback']
  >(
    'assembleClientSignals: keyword feedback',
    workspaceId,
    {
      approved: [],
      rejected: [],
      patterns: { approveRate: 0, topRejectionReasons: [] },
    },
    () => buildKeywordFeedbackSignals(workspaceId),
    {
      logger: log,
      debugMessage: 'Keyword feedback table unavailable — skipping',
    },
  );

  const contentGapVotes = await readOptionalSlicePart<
    Array<{ topic: string; votes: number }>
  >(
    'assembleClientSignals: content gap votes table',
    workspaceId,
    [],
    () => listContentGapVoteSignals(workspaceId),
    { logger: log },
  );

  // Business priorities.
  // `businessPriorities` is the RAW client-only list (read-only legacy field).
  // `effectiveBusinessPriorities` is the authority-resolved representation that merges
  // the client store (client_business_priorities, 021) with the admin store
  // (workspaces.business_priorities, 048) — precedence: client first, admin as supplement.
  // Both reads live in business-priorities-source.ts so there is no external format helper
  // that could bypass the authority chain (CLAUDE.md "Authority-layered fields").
  const businessPriorityData = await readOptionalSlicePart<{
    businessPriorities: string[];
    effectiveBusinessPriorities: string[];
  }>(
    'assembleClientSignals: business priorities',
    workspaceId,
    { businessPriorities: [], effectiveBusinessPriorities: [] },
    () => ({
      businessPriorities: getRawClientBusinessPriorities(workspaceId),
      effectiveBusinessPriorities:
        buildEffectiveBusinessPriorities(workspaceId),
    }),
    { logger: log },
  );
  const { businessPriorities, effectiveBusinessPriorities } =
    businessPriorityData;

  // Churn signals
  let churnSignals: ChurnSignalSummary[] = [];
  let churnRisk: ClientSignalsSlice['churnRisk'] = null;
  let churnFetchSucceeded = false;
  const churnData = await readOptionalSlicePart<{
    churnFetchSucceeded: boolean;
    churnRisk: ClientSignalsSlice['churnRisk'];
    churnSignals: ChurnSignalSummary[];
  }>(
    'assembleClientSignals: churn signals',
    workspaceId,
    {
      churnFetchSucceeded: false,
      churnRisk: null,
      churnSignals: [],
    },
    async () => {
      // NOTE: dynamic import required — churn-signals.ts statically imports from this module
      const { listChurnSignals } = await import('../churn-signals.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      // listChurnSignals already filters to undismissed signals via SQL (WHERE dismissed_at IS NULL)
      const signals: ChurnSignal[] = listChurnSignals(workspaceId);
      const criticalCount = signals.filter(
        (s) => s.severity === 'critical',
      ).length;
      const warningCount = signals.filter(
        (s) => s.severity === 'warning',
      ).length;
      const riskSignalCount = criticalCount + warningCount;
      return {
        churnFetchSucceeded: true,
        churnSignals: signals.map((s) => ({
          id: s.id,
          type: s.type,
          severity: s.severity,
          detectedAt: s.detectedAt,
          title: s.title,
          description: s.description,
        })),
        churnRisk:
          criticalCount > 0
            ? 'high'
            : warningCount >= 2
              ? 'medium'
              : riskSignalCount > 0
                ? 'low'
                : null,
      };
    },
    {
      logger: log,
      warnProgrammingErrors: true,
      warnMessage:
        'assembleClientSignals: programming error in churn-signals — check export names',
    },
  );
  churnSignals = churnData.churnSignals;
  churnRisk = churnData.churnRisk;
  churnFetchSucceeded = churnData.churnFetchSucceeded;

  // Approval patterns
  const approvalPatterns = await readOptionalSlicePart(
    'assembleClientSignals: approval patterns',
    workspaceId,
    { approvalRate: 0, avgResponseTime: null as number | null },
    async () => {
      const { listBatches } = await import('../approvals.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const batches: ApprovalBatch[] = listBatches(workspaceId);
      let approved = 0,
        total = 0;
      for (const batch of batches) {
        for (const item of batch.items ?? []) {
          total++;
          if (item.status === 'approved' || item.status === 'applied')
            approved++;
        }
      }

      // Compute avgResponseTime from batch-level timestamps.
      // Batch-level approximation: for batches where all items are approved/applied,
      // use (updatedAt - createdAt) as response time. There is no per-item resolved_at column.
      let responseTimeSum = 0;
      let resolvedBatchCount = 0;
      for (const batch of batches) {
        const items = batch.items ?? [];
        const allResolved =
          items.length > 0 &&
          items.every((i) => i.status === 'approved' || i.status === 'applied');
        if (allResolved && batch.createdAt && batch.updatedAt) {
          const created = new Date(batch.createdAt).getTime();
          const updated = new Date(batch.updatedAt).getTime();
          if (updated > created) {
            responseTimeSum += updated - created;
            resolvedBatchCount++;
          }
        }
      }

      return {
        approvalRate: total > 0 ? approved / total : 0,
        avgResponseTime:
          resolvedBatchCount > 0
            ? Math.round(responseTimeSum / resolvedBatchCount)
            : null,
      };
    },
    { logger: log },
  );

  // Engagement metrics
  const engagement = await readOptionalSlicePart<EngagementMetrics>(
    'assembleClientSignals: client users',
    workspaceId,
    {
      lastLoginAt: null,
      loginFrequency: 'inactive',
      chatSessionCount: 0,
      portalUsage: null,
    },
    async () => {
      const { listClientUsers } = await import('../client-users.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const users: SafeClientUser[] = listClientUsers(workspaceId);
      const latestLogin =
        users
          .map((u) => u.lastLoginAt)
          .filter((v): v is string => !!v)
          .sort()
          .reverse()[0] ?? null;

      let loginFrequency: EngagementMetrics['loginFrequency'] = 'inactive';
      if (latestLogin) {
        const daysSinceLogin =
          (Date.now() - new Date(latestLogin).getTime()) /
          (24 * 60 * 60 * 1000);
        loginFrequency =
          daysSinceLogin <= 2
            ? 'daily'
            : daysSinceLogin <= 8
              ? 'weekly'
              : daysSinceLogin <= 35
                ? 'monthly'
                : 'inactive';
      }

      const chatSessionCount = await readOptionalSlicePart(
        'assembleClientSignals: chat memory',
        workspaceId,
        0,
        async () => {
          const { getMonthlyConversationCount } =
            await import('../chat-memory.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
          return getMonthlyConversationCount(workspaceId, 'client');
        },
        { logger: log },
      );

      const portalUsage = await readOptionalSlicePart<
        EngagementMetrics['portalUsage']
      >(
        'assembleClientSignals: portal usage count',
        workspaceId,
        null,
        async () => {
          const { getClientActivitySummary, countActivityByType } =
            await import('../activity-log.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
          // Use broad client_% activity to compute distinct active days (recentSessions) and
          // the most recent activity timestamp across all client portal interactions.
          const clientSummary = getClientActivitySummary(workspaceId, 30);
          if (!clientSummary) return null;
          const featuresUsed: string[] = [];
          if (chatSessionCount > 0) featuresUsed.push('chat');
          const feedbackCount =
            countActivityByType(workspaceId, 'client_keyword_feedback', 30) +
            countActivityByType(workspaceId, 'client_content_gap_vote', 30);
          if (feedbackCount > 0) featuresUsed.push('dashboard');
          if (
            countActivityByType(workspaceId, 'client_priorities_updated', 30) >
            0
          )
            featuresUsed.push('priorities');
          if (
            countActivityByType(
              workspaceId,
              'client_onboarding_submitted',
              30,
            ) > 0
          )
            featuresUsed.push('onboarding');
          const clientActionCount =
            countActivityByType(workspaceId, 'client_action_approved', 30) +
            countActivityByType(
              workspaceId,
              'client_action_changes_requested',
              30,
            );
          if (clientActionCount > 0) featuresUsed.push('decisions');
          const contentReviewCount =
            countActivityByType(workspaceId, 'post_approved', 30) +
            countActivityByType(workspaceId, 'post_changes_requested', 30) +
            countActivityByType(workspaceId, 'post_client_edit', 30);
          if (contentReviewCount > 0) featuresUsed.push('content_review');
          return { pageViews: clientSummary.distinctDays, featuresUsed };
        },
        { logger: log },
      );

      return {
        lastLoginAt: latestLogin,
        loginFrequency,
        chatSessionCount,
        portalUsage,
      };
    },
    { logger: log },
  );

  // ROI data
  const roi = await readOptionalSlicePart<ClientSignalsSlice['roi']>(
    'assembleClientSignals: ROI data',
    workspaceId,
    null,
    async () => {
      const { computeROI } = await import('../roi.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const roiData: ROIData | null = computeROI(workspaceId);
      if (roiData) {
        return {
          organicValue: roiData.organicTrafficValue,
          growth: roiData.growthPercent ?? 0,
          period: 'monthly',
        };
      }
      return null;
    },
    { logger: log },
  );

  // Service requests
  const serviceRequests = await readOptionalSlicePart(
    'assembleClientSignals: service requests',
    workspaceId,
    { pending: 0, total: 0 },
    async () => {
      const { listRequests } = await import('../requests.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const reqs: ClientRequest[] = listRequests(workspaceId);
      return {
        pending: reqs.filter(
          (r) => r.status === 'new' || r.status === 'in_review',
        ).length,
        total: reqs.length,
      };
    },
    { logger: log },
  );

  // Intent signals from client chat
  const intentSignals = await readOptionalSlicePart<
    ClientSignalsSlice['intentSignals']
  >(
    'assembleClientSignals: intent signals',
    workspaceId,
    undefined,
    async () => {
      const { listClientSignals, countNewSignals, countAllSignals } =
        await import('../client-signals-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const signals = listClientSignals(workspaceId);
      const newCount = countNewSignals(workspaceId);
      const totalCount = countAllSignals(workspaceId);
      return {
        newCount,
        totalCount,
        recentTypes: signals.slice(0, 5).map((s) => s.type),
      };
    },
    {
      logger: log,
      debugMessage: 'client_signals unavailable for intelligence assembly',
      logContext: (err) => ({ err }),
    },
  );

  const recentChatTopics = await readOptionalSlicePart<string[]>(
    'assembleClientSignals: recent chat topics',
    workspaceId,
    [],
    async () => {
      const { listSessions } = await import('../chat-memory.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const sessions = listSessions(workspaceId, 'client');
      return sessions
        .slice(0, 5)
        .map((s: SessionSummary) => s.title ?? '')
        .filter(Boolean);
    },
    { logger: log },
  );

  // Composite health score (40% churn + 30% ROI + 30% engagement)
  // Weights are normalized to available components so missing data doesn't drag the score down.
  let compositeHealthScore: number | null = null;
  let compositeHealthBreakdown: ClientCompositeHealthBreakdown | null = null;
  {
    let totalWeight = 0;
    let weightedSum = 0;
    let components = 0;
    const rows: ClientCompositeHealthBreakdown['rows'] = [];

    // Churn component (weight 0.4) — only include if churn subsystem loaded successfully
    if (churnFetchSucceeded) {
      const churnScore =
        churnRisk === 'high'
          ? 0
          : churnRisk === 'medium'
            ? 30
            : churnRisk === 'low'
              ? 60
              : 100;
      weightedSum += churnScore * 0.4;
      totalWeight += 0.4;
      components++;
      rows.push({
        id: 'retention',
        label: 'Retention signals',
        score: churnScore,
        weight: COMPOSITE_HEALTH_WEIGHTS.retention,
        description: describeRetentionScore(churnScore),
      });
    }
    // ROI component (weight 0.3)
    if (roi) {
      const roiScore =
        roi.growth > 10 ? 100 : roi.growth > 0 ? 70 : roi.growth === 0 ? 40 : 0;
      weightedSum += roiScore * 0.3;
      totalWeight += 0.3;
      components++;
      rows.push({
        id: 'roi',
        label: 'ROI momentum',
        score: roiScore,
        weight: COMPOSITE_HEALTH_WEIGHTS.roi,
        description: describeRoiScore(roi.growth),
      });
    }
    // Engagement component (weight 0.3)
    if (engagement.loginFrequency !== 'inactive') {
      const engagementScore =
        engagement.loginFrequency === 'daily'
          ? 100
          : engagement.loginFrequency === 'weekly'
            ? 70
            : 40;
      weightedSum += engagementScore * 0.3;
      totalWeight += 0.3;
      components++;
      rows.push({
        id: 'engagement',
        label: 'Portal engagement',
        score: engagementScore,
        weight: COMPOSITE_HEALTH_WEIGHTS.engagement,
        description: describeEngagementScore(engagement.loginFrequency),
      });
    }

    if (components >= 2 && totalWeight > 0) {
      compositeHealthScore = Math.round(weightedSum / totalWeight);
      compositeHealthBreakdown = { rows: normalizeBreakdownWeights(rows) };
    }
  }

  // Latest published briefing summary — null if none published, undefined-tolerant
  // for the chat AI context. Reads from the briefing-store; degrades gracefully
  // if the table is unavailable (e.g., migration not applied).
  const latestBriefing = await readOptionalSlicePart<BriefingSummary | null>(
    'assembleClientSignals: latest briefing',
    workspaceId,
    null,
    async () => {
      const { getLatestPublishedBriefing } =
        await import('../briefing-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const draft = getLatestPublishedBriefing(workspaceId);
      if (draft) {
        return {
          weekOf: draft.weekOf,
          publishedAt: draft.publishedAt,
          storyCount: draft.stories.length,
          hasHero: draft.stories.some((s) => s.isHeadline),
        };
      }
      return null;
    },
    { logger: log },
  );

  const clientActions = await readOptionalSlicePart<
    ClientSignalsSlice['clientActions']
  >(
    'assembleClientSignals: client actions',
    workspaceId,
    undefined,
    async () => {
      const { summarizeClientActions } = await import('../client-actions.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      return summarizeClientActions(workspaceId);
    },
    { logger: log },
  );

  // Strategy v3 (spec §7.5, data-flow rule #6) — the client's responses to SENT curated recs.
  // Counts derive from Recommendation.clientStatus across the rec set; surfaced so AdminChat/
  // strategy "see the loop". Degrades to undefined if the rec set is unavailable.
  const recResponses = await readOptionalSlicePart<ClientSignalsSlice['recResponses']>(
    'assembleClientSignals: rec responses',
    workspaceId,
    undefined,
    () => {
      const set = loadRecommendations(workspaceId);
      const recs: Recommendation[] = set?.recommendations ?? [];
      const responded = recs.filter(
        (r) =>
          r.clientStatus === 'approved' ||
          r.clientStatus === 'declined' ||
          r.clientStatus === 'discussing',
      );
      // Returns a zeroed shape (not undefined) when there are no responses so consumers
      // can render "0 responses" rather than treating it as "no data".
      // respondedAt = updatedAt: the single-writer bumps updatedAt on every clientStatus
      // mutation, so it is the correct "when the client responded" proxy (Recommendation has no
      // dedicated response-timestamp). sentAt is when the rec was SENT, not when it was answered.
      const recentResponses = [...responded]
        .sort(
          (a, b) =>
            Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt),
        )
        .slice(0, 5)
        .map((r) => ({
          title: r.title,
          clientStatus: r.clientStatus ?? 'sent',
          respondedAt: r.updatedAt ?? r.createdAt,
        }));
      return {
        approved: responded.filter((r) => r.clientStatus === 'approved').length,
        declined: responded.filter((r) => r.clientStatus === 'declined').length,
        discussing: responded.filter((r) => r.clientStatus === 'discussing').length,
        recentResponses,
      };
    },
    { logger: log },
  );

  return {
    keywordFeedback,
    contentGapVotes,
    businessPriorities,
    effectiveBusinessPriorities,
    approvalPatterns,
    recentChatTopics,
    churnRisk,
    churnSignals,
    roi,
    engagement,
    compositeHealthScore,
    compositeHealthBreakdown,
    serviceRequests,
    intentSignals,
    latestBriefing,
    clientActions,
    recResponses,
  };
}
