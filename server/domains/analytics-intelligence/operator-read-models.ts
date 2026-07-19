import {
  MCP_OPERATOR_BRIEF_LIMITS,
  type ClientViewData,
  type McpOperatorSourceRef,
  type PortfolioBriefData,
  type WorkspaceDecisionBriefData,
} from '../../../shared/types/mcp-operator-briefs.js';
import type {
  ChurnSignalSummary,
  IntelligenceSlice,
  OperationalSlice,
  WorkspaceIntelligence,
} from '../../../shared/types/intelligence.js';
import {
  buildClientIntelligenceView,
  clientIntelligenceSlicesForTier,
} from '../../client-insight-view-model.js';
import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';
import {
  computeEffectiveTier,
  getWorkspace,
  listWorkspaceIdentities,
} from '../../workspaces.js';
import {
  readAllOperatorPendingDecisions,
} from './operator-pending-decisions.js';

export const OPERATOR_DECISION_INTELLIGENCE_SLICES = [
  'insights',
  'contentPipeline',
  'siteHealth',
  'clientSignals',
  'operational',
] as const satisfies readonly IntelligenceSlice[];

type PendingDecision = NonNullable<OperationalSlice['pendingDecisions']>['items'][number];
type DecisionBlocker = WorkspaceDecisionBriefData['blockers'][number];
type ClientRiskSignal = WorkspaceDecisionBriefData['client_risk_signals']['items'][number];
type NextSafeAction = WorkspaceDecisionBriefData['next_safe_actions'][number];
type OperatorDecisionSlice = typeof OPERATOR_DECISION_INTELLIGENCE_SLICES[number];

export interface OperatorPortfolioWorkspaceRow {
  workspaceId: string;
  name: string;
  effectiveTier: PortfolioBriefData['workspaces'][number]['effective_tier'];
  liveDomain: string | null;
  pendingDecisions: NonNullable<OperationalSlice['pendingDecisions']>;
}

export interface OperatorWorkspaceDecisionRow {
  workspaceId: string;
  name: string;
  effectiveTier: WorkspaceDecisionBriefData['workspace']['effective_tier'];
}

const SOURCE_TYPE_ORDER: Record<PendingDecision['sourceType'], number> = {
  client_request: 0,
  approval_item: 1,
  client_action: 2,
};

function pendingSourceRef(item: PendingDecision): McpOperatorSourceRef {
  return {
    source_type: item.sourceType,
    source_id: item.sourceId,
    ...(item.parentId !== null ? { parent_id: item.parentId } : {}),
  };
}

function comparePendingDecision(a: PendingDecision, b: PendingDecision): number {
  return SOURCE_TYPE_ORDER[a.sourceType] - SOURCE_TYPE_ORDER[b.sourceType]
    || a.createdAt.localeCompare(b.createdAt)
    || a.sourceId.localeCompare(b.sourceId)
    || (a.parentId ?? '').localeCompare(b.parentId ?? '');
}

function portfolioReasonCodes(
  requests: number,
  approvals: number,
  clientActions: number,
): PortfolioBriefData['workspaces'][number]['reason_codes'] {
  const reasons: PortfolioBriefData['workspaces'][number]['reason_codes'] = [];
  if (requests > 0) reasons.push('pending_request');
  if (approvals > 0) reasons.push('pending_approval');
  if (clientActions > 0) reasons.push('pending_client_action');
  if (reasons.length === 0) reasons.push('no_pending_work');
  return reasons;
}

export function projectOperatorPortfolioBrief(
  inputRows: readonly OperatorPortfolioWorkspaceRow[],
  limit: number,
): PortfolioBriefData {
  const rows = inputRows.map((input) => {
    const items = [...input.pendingDecisions.items].sort(comparePendingDecision);
    const requests = input.pendingDecisions.counts.requests;
    const approvals = input.pendingDecisions.counts.approvals;
    const clientActions = input.pendingDecisions.counts.clientActions;

    return {
      input,
      requests,
      approvals,
      clientActions,
      total: requests + approvals + clientActions,
      drillDownIds: items
        .slice(0, MCP_OPERATOR_BRIEF_LIMITS.maxDrillDownIdsPerWorkspace)
        .map(pendingSourceRef),
    };
  });

  rows.sort((a, b) => b.requests - a.requests
    || b.approvals - a.approvals
    || b.clientActions - a.clientActions
    || a.input.name.localeCompare(b.input.name)
    || a.input.workspaceId.localeCompare(b.input.workspaceId));

  const workspaces = rows.slice(0, limit).map((row, index) => ({
    attention_rank: index + 1,
    workspace_id: row.input.workspaceId,
    name: row.input.name,
    effective_tier: row.input.effectiveTier,
    live_domain: row.input.liveDomain,
    pending: {
      approvals: row.approvals,
      requests: row.requests,
      client_actions: row.clientActions,
      total: row.total,
    },
    reason_codes: portfolioReasonCodes(row.requests, row.approvals, row.clientActions),
    drill_down_ids: row.drillDownIds,
  }));

  return {
    limit,
    returned: workspaces.length,
    total_workspaces: rows.length,
    has_more: rows.length > workspaces.length,
    workspaces,
  };
}

export function buildOperatorPortfolioBrief(limit: number): PortfolioBriefData {
  const workspaces = listWorkspaceIdentities();
  const rowsFor = (
    pendingByWorkspace: ReadonlyMap<string, NonNullable<OperationalSlice['pendingDecisions']>>,
  ): OperatorPortfolioWorkspaceRow[] => workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    name: workspace.name,
    effectiveTier: computeEffectiveTier(workspace),
    liveDomain: workspace.liveDomain ?? null,
    pendingDecisions: pendingByWorkspace.get(workspace.id) ?? {
      availability: 'available',
      total: 0,
      counts: { approvals: 0, requests: 0, clientActions: 0 },
      items: [],
    },
  }));
  const pendingByWorkspace = readAllOperatorPendingDecisions({
    selectDetailWorkspaceIds: (countsByWorkspace) => projectOperatorPortfolioBrief(
      rowsFor(countsByWorkspace),
      limit,
    ).workspaces.map((workspace) => workspace.workspace_id),
  });
  const rows = rowsFor(pendingByWorkspace);
  return projectOperatorPortfolioBrief(rows, limit);
}

function availableSlices(intel: WorkspaceIntelligence): OperatorDecisionSlice[] {
  return OPERATOR_DECISION_INTELLIGENCE_SLICES.filter((slice) => intel[slice] !== undefined);
}

function unresolvedInsights(
  intel: WorkspaceIntelligence,
  severity: 'critical' | 'warning',
): NonNullable<WorkspaceIntelligence['insights']>['all'] {
  return (intel.insights?.all ?? [])
    .filter((insight) => insight.severity === severity && insight.resolutionStatus !== 'resolved')
    .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0) || a.id.localeCompare(b.id));
}

const CHURN_SEVERITY_ORDER: Readonly<Record<string, number>> = {
  critical: 0,
  warning: 1,
};

/** Canonical order for every operator-facing churn-risk projection. */
function compareChurnSignals(a: ChurnSignalSummary, b: ChurnSignalSummary): number {
  return (CHURN_SEVERITY_ORDER[a.severity] ?? 2)
    - (CHURN_SEVERITY_ORDER[b.severity] ?? 2)
    || b.detectedAt.localeCompare(a.detectedAt)
    || a.id.localeCompare(b.id);
}

function insightSourceRefs(
  insights: NonNullable<WorkspaceIntelligence['insights']>['all'],
  limit: number,
): McpOperatorSourceRef[] {
  return insights
    .slice(0, limit)
    .map((insight) => ({ source_type: 'insight', source_id: insight.id }));
}

function blockerProjection(
  intel: WorkspaceIntelligence,
  unavailable: readonly OperatorDecisionSlice[],
  pendingDecisionsAvailable: boolean,
  churnSignalsAvailable: boolean,
  limit: number,
): DecisionBlocker[] {
  const blockers: DecisionBlocker[] = [];
  const add = (blocker: DecisionBlocker | null) => {
    if (blocker && blocker.count > 0) blockers.push(blocker);
  };

  const criticalInsights = unresolvedInsights(intel, 'critical');
  add(criticalInsights.length > 0 ? {
    reason_code: 'critical_insight',
    severity: 'critical',
    count: criticalInsights.length,
    source_refs: insightSourceRefs(criticalInsights, limit),
  } : null);

  const warningInsights = unresolvedInsights(intel, 'warning');
  add(warningInsights.length > 0 ? {
    reason_code: 'warning_insight',
    severity: 'high',
    count: warningInsights.length,
    source_refs: insightSourceRefs(warningInsights, limit),
  } : null);

  const siteHealth = intel.siteHealth;
  add(siteHealth?.auditScore != null && siteHealth.auditScore < 60 ? {
    reason_code: 'site_health_low_score', severity: 'high', count: 1, source_refs: [],
  } : null);
  add(siteHealth && siteHealth.deadLinks > 0 ? {
    reason_code: 'site_health_dead_links', severity: 'high', count: siteHealth.deadLinks, source_refs: [],
  } : null);
  add(siteHealth && siteHealth.schemaErrors > 0 ? {
    reason_code: 'site_health_schema_errors', severity: 'high', count: siteHealth.schemaErrors, source_refs: [],
  } : null);
  add(siteHealth && siteHealth.orphanPages > 0 ? {
    reason_code: 'site_health_orphan_pages', severity: 'medium', count: siteHealth.orphanPages, source_refs: [],
  } : null);
  const anomalyRefs = [...new Set(
    (siteHealth?.recentDiagnostics ?? [])
      .map((diagnostic) => diagnostic.insightId)
      .filter((id): id is string => id !== null),
  )].slice(0, limit).map((sourceId) => ({
    source_type: 'insight' as const,
    source_id: sourceId,
  }));
  add(siteHealth && (siteHealth.anomalyCount ?? 0) > 0 ? {
    reason_code: 'site_health_anomaly',
    severity: 'high',
    count: siteHealth.anomalyCount ?? 0,
    source_refs: anomalyRefs,
  } : null);

  const pipeline = intel.contentPipeline;
  add(pipeline && pipeline.requests.pending > 0 ? {
    reason_code: 'content_pending_requests', severity: 'high', count: pipeline.requests.pending, source_refs: [],
  } : null);
  add(pipeline && pipeline.seoEdits.inReview > 0 ? {
    reason_code: 'content_pending_review', severity: 'medium', count: pipeline.seoEdits.inReview, source_refs: [],
  } : null);

  const churnSignals = [...(intel.clientSignals?.churnSignals ?? [])]
    .sort(compareChurnSignals);
  const criticalRisk = churnSignals.filter((signal) => signal.severity === 'critical');
  add(criticalRisk.length > 0 ? {
    reason_code: 'client_risk_critical', severity: 'critical', count: criticalRisk.length,
    source_refs: criticalRisk.slice(0, limit).map(churnSourceRef),
  } : null);
  const warningRisk = churnSignals.filter((signal) => signal.severity === 'warning');
  add(warningRisk.length > 0 ? {
    reason_code: 'client_risk_warning', severity: 'high', count: warningRisk.length,
    source_refs: warningRisk.slice(0, limit).map(churnSourceRef),
  } : null);

  const pendingSubreadUnavailable = !pendingDecisionsAvailable
    && !unavailable.includes('operational');
  const churnSubreadUnavailable = !churnSignalsAvailable
    && !unavailable.includes('clientSignals');
  const unavailableCount = unavailable.length
    + (pendingSubreadUnavailable ? 1 : 0)
    + (churnSubreadUnavailable ? 1 : 0);
  add(unavailableCount > 0 ? {
    reason_code: 'data_unavailable', severity: 'high', count: unavailableCount, source_refs: [],
  } : null);

  const bounded = blockers.slice(0, limit);
  if (unavailableCount > 0 && !bounded.some((blocker) => blocker.reason_code === 'data_unavailable')) {
    bounded[bounded.length - 1] = blockers[blockers.length - 1]!;
  }
  return bounded;
}

function churnSourceRef(signal: ChurnSignalSummary): McpOperatorSourceRef {
  return { source_type: 'churn_signal', source_id: signal.id };
}

function clientRiskProjection(intel: WorkspaceIntelligence, limit: number): {
  total: number;
  returned: number;
  has_more: boolean;
  items: ClientRiskSignal[];
} {
  const all = (intel.clientSignals?.churnSignals ?? [])
    .filter((signal) => signal.severity === 'critical' || signal.severity === 'warning')
    .sort(compareChurnSignals);
  const items: ClientRiskSignal[] = all.slice(0, limit).map((signal) => ({
    source: churnSourceRef(signal),
    signal_type: signal.type,
    severity: signal.severity === 'critical' ? 'critical' : 'warning',
    detected_at: signal.detectedAt,
  }));
  return { total: all.length, returned: items.length, has_more: all.length > items.length, items };
}

function pendingDecisionProjection(
  pendingDecisions: OperationalSlice['pendingDecisions'],
  limit: number,
): WorkspaceDecisionBriefData['pending_decisions'] {
  const total = pendingDecisions?.total ?? 0;
  const items = (pendingDecisions?.items ?? []).slice(0, limit).map((item) => ({
    source: pendingSourceRef(item),
    label: item.label,
    priority: item.priority,
    created_at: item.createdAt,
  }));
  return {
    available: pendingDecisions?.availability === 'available',
    total,
    returned: items.length,
    has_more: total > items.length,
    items,
  };
}

function firstBlocker(
  blockers: DecisionBlocker[],
  reasonCodes: readonly DecisionBlocker['reason_code'][],
): DecisionBlocker | undefined {
  return reasonCodes
    .map((reasonCode) => blockers.find((blocker) => blocker.reason_code === reasonCode))
    .find((blocker) => blocker !== undefined);
}

function nextSafeActionProjection(
  intel: WorkspaceIntelligence,
  blockers: DecisionBlocker[],
  pendingDecisions: WorkspaceDecisionBriefData['pending_decisions'],
): NextSafeAction[] {
  const pending = pendingDecisions.items[0];
  if (pending) {
    return [{
      action_code: 'review_pending_decision',
      reason_code: pending.source.source_type,
      source_refs: [pending.source],
    }];
  }

  const criticalInsight = firstBlocker(blockers, ['critical_insight', 'warning_insight']);
  if (criticalInsight) {
    return [{
      action_code: 'inspect_priority_insight',
      reason_code: criticalInsight.reason_code,
      source_refs: criticalInsight.source_refs.slice(0, 3),
    }];
  }

  const clientRisk = firstBlocker(blockers, ['client_risk_critical', 'client_risk_warning']);
  if (clientRisk) {
    return [{
      action_code: 'inspect_client_risk',
      reason_code: clientRisk.reason_code,
      source_refs: clientRisk.source_refs.slice(0, 3),
    }];
  }

  const siteHealth = firstBlocker(blockers, [
    'site_health_low_score',
    'site_health_dead_links',
    'site_health_schema_errors',
    'site_health_orphan_pages',
    'site_health_anomaly',
  ]);
  if (siteHealth) {
    return [{
      action_code: 'inspect_site_health',
      reason_code: siteHealth.reason_code,
      source_refs: [],
    }];
  }

  const contentQueue = firstBlocker(blockers, ['content_pending_requests', 'content_pending_review']);
  if (contentQueue) {
    return [{
      action_code: 'review_content_queue',
      reason_code: contentQueue.reason_code,
      source_refs: [],
    }];
  }

  if ((intel.operational?.pendingJobs ?? 0) > 0) {
    return [{
      action_code: 'wait_for_running_job',
      reason_code: 'pending_job',
      source_refs: [],
    }];
  }

  const unavailable = firstBlocker(blockers, ['data_unavailable']);
  if (unavailable) {
    return [{
      action_code: 'inspect_data_availability',
      reason_code: unavailable.reason_code,
      source_refs: [],
    }];
  }

  return [{ action_code: 'no_action_required', reason_code: 'queues_clear', source_refs: [] }];
}

export async function buildOperatorWorkspaceDecisionBrief(
  workspaceId: string,
  queueLimit: number,
): Promise<WorkspaceDecisionBriefData | null> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const intel = await buildWorkspaceIntelligence(workspaceId, {
    slices: OPERATOR_DECISION_INTELLIGENCE_SLICES,
  });
  return projectOperatorWorkspaceDecisionBrief({
    workspaceId: workspace.id,
    name: workspace.name,
    effectiveTier: computeEffectiveTier(workspace),
  }, intel, queueLimit);
}

export function projectOperatorWorkspaceDecisionBrief(
  workspace: OperatorWorkspaceDecisionRow,
  intel: WorkspaceIntelligence,
  queueLimit: number,
): WorkspaceDecisionBriefData {
  const available = availableSlices(intel);
  const unavailable = OPERATOR_DECISION_INTELLIGENCE_SLICES.filter(
    (slice) => !available.includes(slice),
  );
  const pendingDecisionsAvailable = intel.operational?.pendingDecisions?.availability === 'available';
  const churnSignalsAvailable = intel.clientSignals?.churnSignalsAvailability === 'available';
  const blockers = blockerProjection(
    intel,
    unavailable,
    pendingDecisionsAvailable,
    churnSignalsAvailable,
    queueLimit,
  );
  const pendingDecisions = pendingDecisionProjection(intel.operational?.pendingDecisions, queueLimit);
  const clientRiskSignals = clientRiskProjection(intel, queueLimit);

  return {
    workspace: {
      workspace_id: workspace.workspaceId,
      name: workspace.name,
      effective_tier: workspace.effectiveTier,
    },
    queue_limit: queueLimit,
    slice_availability: {
      requested: [...OPERATOR_DECISION_INTELLIGENCE_SLICES],
      available,
      unavailable,
    },
    blockers,
    pending_decisions: pendingDecisions,
    client_risk_signals: clientRiskSignals,
    next_safe_actions: nextSafeActionProjection(intel, blockers, pendingDecisions),
  };
}

export async function buildOperatorClientView(workspaceId: string): Promise<ClientViewData | null> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const tier = computeEffectiveTier(workspace);
  const slices = clientIntelligenceSlicesForTier(tier);
  const intel = await buildWorkspaceIntelligence(workspace.id, { slices });
  return buildClientIntelligenceView(intel, tier);
}
