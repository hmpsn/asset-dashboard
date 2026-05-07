import type { ClientSignalsSlice, ChurnSignalSummary, EngagementMetrics, IntelligenceOptions } from '../../shared/types/intelligence.js';
import type { BriefingSummary } from '../../shared/types/briefing.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';
import type { ChurnSignal } from '../churn-signals.js';
import type { ROIData } from '../roi.js';
import type { SafeClientUser } from '../../shared/types/users.js';
import type { FeedbackItem } from '../feedback.js';
import type { ClientRequest } from '../../shared/types/requests.js';
import type { SessionSummary } from '../chat-memory.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';
import { parseJsonSafeArray } from '../db/json-validation.js';
import { clientBusinessPrioritySchema, type ClientBusinessPriorityInput } from '../schemas/client-business-priorities.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('workspace-intelligence/client-signals');

const stmts = createStmtCache(() => ({
  keywordFeedbackApproved: db.prepare(
    'SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = ?',
  ),
  keywordFeedbackDeclined: db.prepare(
    'SELECT keyword, reason FROM keyword_feedback WHERE workspace_id = ? AND status = ?',
  ),
  contentGapVotes: db.prepare(
    'SELECT keyword, COUNT(*) as cnt FROM content_gap_votes WHERE workspace_id = ? GROUP BY keyword ORDER BY cnt DESC',
  ),
  clientBusinessPriorities: db.prepare(
    'SELECT priorities FROM client_business_priorities WHERE workspace_id = ?',
  ),
}));

function formatClientBusinessPriority(
  priority: ClientBusinessPriorityInput,
): string {
  if (typeof priority === 'string') return priority.trim();
  const text = priority.text.trim();
  if (!text) return '';
  const category = priority.category?.trim();
  return category ? `[${category}] ${text}` : text;
}

export async function assembleClientSignals(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<ClientSignalsSlice> {
  // Keyword feedback (DB direct — no store module)
  let keywordFeedback: ClientSignalsSlice['keywordFeedback'] = { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } };
  try {
    const approvedRows = stmts().keywordFeedbackApproved.all(workspaceId, 'approved') as { keyword: string }[];
    const rejectedRows = stmts().keywordFeedbackDeclined.all(workspaceId, 'declined') as { keyword: string; reason?: string }[];
    const total = approvedRows.length + rejectedRows.length;
    const reasons = rejectedRows.map(r => r.reason).filter(Boolean) as string[];
    const reasonCounts = new Map<string, number>();
    for (const r of reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    const topRejectionReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason]) => reason);
    keywordFeedback = {
      approved: approvedRows.map(r => r.keyword),
      rejected: rejectedRows.map(r => r.keyword),
      patterns: { approveRate: total > 0 ? approvedRows.length / total : 0, topRejectionReasons },
    };
  } catch (err) {
    log.debug({ workspaceId, err }, 'Keyword feedback table unavailable — skipping');
  }

  // Content gap votes (DB direct)
  let contentGapVotes: { topic: string; votes: number }[] = [];
  try {
    const rows = stmts().contentGapVotes.all(workspaceId) as { keyword: string; cnt: number }[];
    contentGapVotes = rows.map(r => ({ topic: r.keyword, votes: r.cnt }));
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: content gap votes table optional, degrading gracefully');
  }

  // Business priorities (DB direct)
  let businessPriorities: string[] = [];
  try {
    const row = stmts().clientBusinessPriorities.get(workspaceId) as { priorities: string } | undefined;
    if (row) {
      const priorities = parseJsonSafeArray(
        row.priorities,
        clientBusinessPrioritySchema,
        { workspaceId, field: 'priorities', table: 'client_business_priorities' },
      );
      businessPriorities = priorities
        .map(formatClientBusinessPriority)
        .filter((priority): priority is string => priority.length > 0);
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: business priorities table optional, degrading gracefully');
  }

  // Churn signals
  let churnSignals: ChurnSignalSummary[] = [];
  let churnRisk: ClientSignalsSlice['churnRisk'] = null;
  let churnFetchSucceeded = false;
  try {
    // NOTE: dynamic import required — churn-signals.ts statically imports from this module
    const { listChurnSignals } = await import('../churn-signals.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    // listChurnSignals already filters to undismissed signals via SQL (WHERE dismissed_at IS NULL)
    const signals: ChurnSignal[] = listChurnSignals(workspaceId);
    churnFetchSucceeded = true;
    churnSignals = signals.map(s => ({
      type: s.type,
      severity: s.severity,
      detectedAt: s.detectedAt,
      title: s.title,
      description: s.description,
    }));
    // ChurnSignal.severity is 'critical' | 'warning' | 'positive' — map to churnRisk levels
    const criticalCount = signals.filter(s => s.severity === 'critical').length;
    const warningCount = signals.filter(s => s.severity === 'warning').length;
    const riskSignalCount = criticalCount + warningCount;
    churnRisk = criticalCount > 0 ? 'high' : warningCount >= 2 ? 'medium' : riskSignalCount > 0 ? 'low' : null;
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId }, 'assembleClientSignals: programming error in churn-signals — check export names');
    } else {
      log.debug({ err, workspaceId }, 'assembleClientSignals: churn signals optional, degrading gracefully');
    }
    // churnFetchSucceeded stays false
  }

  // Approval patterns
  let approvalPatterns = { approvalRate: 0, avgResponseTime: null as number | null };
  try {
    const { listBatches } = await import('../approvals.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const batches: ApprovalBatch[] = listBatches(workspaceId);
    let approved = 0, total = 0;
    for (const batch of batches) {
      for (const item of batch.items ?? []) {
        total++;
        if (item.status === 'approved') approved++;
      }
    }

    // Compute avgResponseTime from batch-level timestamps.
    // Batch-level approximation: for batches where all items are approved/applied,
    // use (updatedAt - createdAt) as response time. There is no per-item resolved_at column.
    let responseTimeSum = 0;
    let resolvedBatchCount = 0;
    for (const batch of batches) {
      const items = batch.items ?? [];
      const allResolved = items.length > 0 && items.every(
        i => i.status === 'approved' || i.status === 'applied',
      );
      if (allResolved && batch.createdAt && batch.updatedAt) {
        const created = new Date(batch.createdAt).getTime();
        const updated = new Date(batch.updatedAt).getTime();
        if (updated > created) {
          responseTimeSum += updated - created;
          resolvedBatchCount++;
        }
      }
    }

    approvalPatterns = {
      approvalRate: total > 0 ? approved / total : 0,
      avgResponseTime: resolvedBatchCount > 0 ? Math.round(responseTimeSum / resolvedBatchCount) : null,
    };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: approval patterns optional, degrading gracefully');
  }

  // Engagement metrics
  let engagement: EngagementMetrics = { lastLoginAt: null, loginFrequency: 'inactive', chatSessionCount: 0, portalUsage: null };
  try {
    const { listClientUsers } = await import('../client-users.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const users: SafeClientUser[] = listClientUsers(workspaceId);
    const latestLogin = users
      .map(u => u.lastLoginAt)
      .filter((v): v is string => !!v)
      .sort()
      .reverse()[0] ?? null;

    let loginFrequency: EngagementMetrics['loginFrequency'] = 'inactive';
    if (latestLogin) {
      const daysSinceLogin = (Date.now() - new Date(latestLogin).getTime()) / (24 * 60 * 60 * 1000);
      loginFrequency = daysSinceLogin <= 2 ? 'daily' : daysSinceLogin <= 8 ? 'weekly' : daysSinceLogin <= 35 ? 'monthly' : 'inactive';
    }

    let chatSessionCount = 0;
    try {
      const { getMonthlyConversationCount } = await import('../chat-memory.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      chatSessionCount = getMonthlyConversationCount(workspaceId, 'client');
    } catch (err) {
      log.debug({ err, workspaceId }, 'assembleClientSignals: chat memory optional, degrading gracefully');
    }

    let portalUsage: EngagementMetrics['portalUsage'] = null;
    try {
      const { getClientActivitySummary, countActivityByType } = await import('../activity-log.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      // Use broad client_% activity to compute distinct active days (recentSessions) and
      // the most recent activity timestamp across all client portal interactions.
      const clientSummary = getClientActivitySummary(workspaceId, 30);
      if (clientSummary) {
        // Map distinct active days to pageViews for the EngagementMetrics type contract
        const featuresUsed: string[] = [];
        if (chatSessionCount > 0) featuresUsed.push('chat');
        // Detect dashboard engagement from client-initiated feedback actions
        const feedbackCount = countActivityByType(workspaceId, 'client_keyword_feedback', 30)
          + countActivityByType(workspaceId, 'client_content_gap_vote', 30);
        if (feedbackCount > 0) featuresUsed.push('dashboard');
        if (countActivityByType(workspaceId, 'client_priorities_updated', 30) > 0) featuresUsed.push('priorities');
        if (countActivityByType(workspaceId, 'client_onboarding_submitted', 30) > 0) featuresUsed.push('onboarding');
        portalUsage = { pageViews: clientSummary.distinctDays, featuresUsed };
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'assembleClientSignals: portal usage count optional, degrading gracefully');
    }

    engagement = {
      lastLoginAt: latestLogin,
      loginFrequency,
      chatSessionCount,
      portalUsage,
    };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: client users optional, degrading gracefully');
  }

  // ROI data
  let roi: ClientSignalsSlice['roi'] = null;
  try {
    const { computeROI } = await import('../roi.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const roiData: ROIData | null = computeROI(workspaceId);
    if (roiData) {
      roi = {
        organicValue: roiData.organicTrafficValue,
        growth: roiData.growthPercent ?? 0,
        period: 'monthly',
      };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: ROI data optional, degrading gracefully');
  }

  // Feedback items
  let feedbackItems: ClientSignalsSlice['feedbackItems'] = [];
  try {
    const { listFeedback } = await import('../feedback.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const items = listFeedback(workspaceId);
    feedbackItems = items.slice(0, 10).map((f: FeedbackItem) => ({
      id: f.id,
      type: f.type ?? 'general',
      status: f.status ?? 'new',
      createdAt: f.createdAt ?? '',
    }));
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: feedback items optional, degrading gracefully');
  }

  // Service requests
  let serviceRequests = { pending: 0, total: 0 };
  try {
    const { listRequests } = await import('../requests.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const reqs: ClientRequest[] = listRequests(workspaceId);
    serviceRequests = {
      pending: reqs.filter(r => r.status === 'new' || r.status === 'in_review').length,
      total: reqs.length,
    };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: service requests optional, degrading gracefully');
  }

  // Intent signals from client chat
  let intentSignals: ClientSignalsSlice['intentSignals'];
  try {
    const { listClientSignals, countNewSignals, countAllSignals } = await import('../client-signals-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const signals = listClientSignals(workspaceId);
    const newCount = countNewSignals(workspaceId);
    // Use countAllSignals for totalCount — listClientSignals is capped at LIMIT 100
    const totalCount = countAllSignals(workspaceId);
    intentSignals = {
      newCount,
      totalCount,
      recentTypes: signals.slice(0, 5).map(s => s.type),
    };
  } catch (err) {
    // client_signals table may not exist on older DBs — degrade gracefully
    log.debug({ err }, 'client_signals unavailable for intelligence assembly');
  }


  // Recent chat topics
  let recentChatTopics: string[] = [];
  try {
    const { listSessions } = await import('../chat-memory.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const sessions = listSessions(workspaceId, 'client');
    recentChatTopics = sessions
      .slice(0, 5)
      .map((s: SessionSummary) => s.title ?? '')
      .filter(Boolean);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: recent chat topics optional, degrading gracefully');
  }

  // Composite health score (40% churn + 30% ROI + 30% engagement)
  // Weights are normalized to available components so missing data doesn't drag the score down.
  let compositeHealthScore: number | null = null;
  {
    let totalWeight = 0;
    let weightedSum = 0;
    let components = 0;

    // Churn component (weight 0.4) — only include if churn subsystem loaded successfully
    if (churnFetchSucceeded) {
      const churnScore = churnRisk === 'high' ? 0 : churnRisk === 'medium' ? 30 : churnRisk === 'low' ? 60 : 100;
      weightedSum += churnScore * 0.4;
      totalWeight += 0.4;
      components++;
    }
    // ROI component (weight 0.3)
    if (roi) {
      const roiScore = roi.growth > 10 ? 100 : roi.growth > 0 ? 70 : roi.growth === 0 ? 40 : 0;
      weightedSum += roiScore * 0.3;
      totalWeight += 0.3;
      components++;
    }
    // Engagement component (weight 0.3)
    if (engagement.loginFrequency !== 'inactive') {
      const engagementScore = engagement.loginFrequency === 'daily' ? 100 : engagement.loginFrequency === 'weekly' ? 70 : 40;
      weightedSum += engagementScore * 0.3;
      totalWeight += 0.3;
      components++;
    }

    if (components >= 2 && totalWeight > 0) {
      compositeHealthScore = Math.round(weightedSum / totalWeight);
    }
  }

  // Latest published briefing summary — null if none published, undefined-tolerant
  // for the chat AI context. Reads from the briefing-store; degrades gracefully
  // if the table is unavailable (e.g., migration not applied).
  let latestBriefing: BriefingSummary | null = null;
  try {
    const { getLatestPublishedBriefing } = await import('../briefing-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const draft = getLatestPublishedBriefing(workspaceId);
    if (draft) {
      latestBriefing = {
        weekOf: draft.weekOf,
        publishedAt: draft.publishedAt,
        storyCount: draft.stories.length,
        hasHero: draft.stories.some((s) => s.isHeadline),
      };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: latest briefing optional, degrading gracefully');
  }

  let clientActions: ClientSignalsSlice['clientActions'];
  try {
    const { summarizeClientActions } = await import('../client-actions.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    clientActions = summarizeClientActions(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleClientSignals: client actions optional, degrading gracefully');
  }

  return {
    keywordFeedback,
    contentGapVotes,
    businessPriorities,
    approvalPatterns,
    recentChatTopics,
    churnRisk,
    churnSignals,
    roi,
    engagement,
    compositeHealthScore,
    feedbackItems,
    serviceRequests,
    intentSignals,
    latestBriefing,
    clientActions,
  };
}
