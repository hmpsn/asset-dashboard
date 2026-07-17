import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE,
  KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY,
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterAssignment,
  type KeywordCommandCenterFeedbackState,
  type KeywordCommandCenterLocalSeoState,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterSourceLabel,
  type KeywordCommandCenterStatus,
} from '../../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type TrackedKeyword,
} from '../../../shared/types/rank-tracking.js';
import type { KeywordGapItem } from '../../../shared/types/workspace.js';
import type { TrackedKeywordIdentityMetadata } from '../../../shared/types/keyword-identity.js';
import type { KeywordStrategyExplanation } from '../../../shared/types/keyword-strategy-ux.js';
import type { DraftRow, FeedbackRow } from './types.js';

export function feedbackState(row: FeedbackRow): KeywordCommandCenterFeedbackState | undefined {
  if (row.status !== 'approved' && row.status !== 'declined' && row.status !== 'requested') return undefined;
  return {
    status: row.status,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function ensureRow(rows: Map<string, DraftRow>, keyword: string): DraftRow | null {
  const normalizedKeyword = keywordComparisonKey(keyword);
  if (!normalizedKeyword) return null;
  const existing = rows.get(normalizedKeyword);
  if (existing) return existing;
  const row: DraftRow = {
    keyword: keyword.trim(),
    normalizedKeyword,
    sourceLabels: [],
    metrics: {},
  };
  rows.set(normalizedKeyword, row);
  return row;
}

export function assignmentPriority(role: KeywordCommandCenterAssignment['role'] | undefined): number {
  if (role === 'page_keyword') return 4;
  if (role === 'content_gap') return 3;
  if (role === 'site_keyword') return 2;
  if (role === 'raw_evidence') return 1;
  return 0;
}

export function setAssignment(row: DraftRow, assignment: KeywordCommandCenterAssignment): void {
  if (assignmentPriority(assignment.role) >= assignmentPriority(row.assignment?.role)) {
    row.assignment = assignment;
  }
}

export function sourceFromExplanation(explanation: KeywordStrategyExplanation): KeywordCommandCenterSourceLabel {
  if (explanation.role === 'page_keyword') {
    return { kind: 'page_assignment', label: 'Page assignment', detail: explanation.pageTitle ?? explanation.pagePath };
  }
  if (explanation.role === 'content_gap') {
    return { kind: 'content_gap', label: 'Content opportunity', detail: explanation.nextAction.detail };
  }
  if (explanation.role === 'competitor_gap') {
    return { kind: 'raw_evidence', label: 'Raw provider evidence', detail: explanation.sourceEvidence[0] ?? 'Provider keyword gap' };
  }
  return { kind: 'strategy', label: 'Strategy keyword', detail: explanation.surfaceLabel };
}

export function sourceFromKeywordGap(gap: KeywordGapItem): KeywordCommandCenterSourceLabel {
  return {
    kind: 'raw_evidence',
    label: 'Raw provider evidence',
    detail: `${gap.competitorDomain} ranks #${gap.competitorPosition}`,
  };
}

export function isInactiveTracking(keyword: TrackedKeyword): boolean {
  return (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE;
}

export function protectedReason(
  keyword: (TrackedKeyword & TrackedKeywordIdentityMetadata) | undefined,
): string | undefined {
  if (!keyword) return undefined;
  if (keyword.pinned) return 'Pinned keyword';
  if (keyword.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED) return 'Client-requested keyword';
  if (keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL) return 'Manual keyword';
  // Wave 3d-ii (Decision B): any gap-provenanced approval (sourceGapKey present) is
  // hard-protected — a client approved it off a content/keyword gap surface, so it
  // must never be auto-deprecated regardless of its current source label.
  if (keyword.sourceGapKey || keyword.sourceGapKeyV2) return 'Gap-approved keyword';
  return undefined;
}

/**
 * Friendly label for the addSource `detail` field. Avoids displaying the raw
 * "unknown" enum value as if it were real provenance.
 */
export function trackingSourceDetail(source: TrackedKeyword['source'] | undefined): string | undefined {
  if (!source || source === TRACKED_KEYWORD_SOURCE.UNKNOWN) return undefined;
  return source.replace(/_/g, ' ');
}

export function lifecycleStatus(row: DraftRow): KeywordCommandCenterStatus {
  if (row.feedback?.status === 'declined') return KEYWORD_COMMAND_CENTER_STATUS.DECLINED;
  if (row.tracking && isInactiveTracking(row.tracking)) return KEYWORD_COMMAND_CENTER_STATUS.RETIRED;
  if (row.feedback?.status === 'approved') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.feedback?.status === 'requested') return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  if (row.explanation && row.explanation.role !== 'competitor_gap') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.assignment && row.assignment.role !== 'raw_evidence') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  // Wave 3d-ii: classify "In Strategy" off the decoupled ownership flag, NOT the
  // source enum. row.tracking carries strategyOwned via mergeTrackedKeywordProvenance
  // (the table-bearing read); a client-approved keyword that is not strategy-owned is
  // no longer mis-labelled In Strategy.
  if (row.tracking?.strategyOwned === true) {
    return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  }
  if (row.tracking && (row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return KEYWORD_COMMAND_CENTER_STATUS.TRACKED;
  }
  if (row.explanation?.rawEvidenceOnly || row.rawEvidenceOnly) return KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE;
  if (row.rank) return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  if (row.localCandidate) return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  return KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE;
}

export function statusLabel(status: KeywordCommandCenterStatus): string {
  switch (status) {
    case KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY: return 'In Strategy';
    case KEYWORD_COMMAND_CENTER_STATUS.TRACKED: return 'Tracked';
    case KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW: return 'Needs Review';
    case KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE: return 'Seen in search';
    case KEYWORD_COMMAND_CENTER_STATUS.DECLINED: return 'Declined';
    case KEYWORD_COMMAND_CENTER_STATUS.RETIRED: return 'Retired';
  }
}

export function localPriority(
  visibility: LocalSeoKeywordVisibilitySummary | undefined,
  activeMarketCount: number,
): Pick<KeywordCommandCenterLocalSeoState, 'priority' | 'priorityLabel'> {
  if (activeMarketCount === 0) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP, priorityLabel: 'Needs setup' };
  }
  if (!visibility) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE, priorityLabel: 'Ready to check' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND, priorityLabel: 'Defend' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH || visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE, priorityLabel: 'Investigate' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY, priorityLabel: 'High opportunity' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE && visibility.localPackPresent) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY, priorityLabel: 'High opportunity' };
  }
  return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.LOW_PRIORITY, priorityLabel: 'Low priority' };
}

export function buildLocalSeoState(
  row: DraftRow,
  status: KeywordCommandCenterStatus,
  visibility: LocalSeoKeywordVisibilitySummary | undefined,
  activeMarketCount: number,
): KeywordCommandCenterLocalSeoState | undefined {
  if (!row.localCandidate && !visibility) return undefined;
  const selected = status === KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY
    || status === KEYWORD_COMMAND_CENTER_STATUS.TRACKED
    || row.localCandidate?.selected === true;
  const checked = Boolean(visibility);
  const lifecycle = selected
    ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED
    : checked
      ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED
      : row.rawEvidenceOnly
        ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.RAW_EVIDENCE
        : row.localCandidate
          ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE
          : KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.NOT_CHECKED;
  const { priority, priorityLabel } = localPriority(visibility, activeMarketCount);
  const lifecycleLabel = lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED
    ? checked ? 'Selected · checked' : 'Selected · not checked'
    : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED
      ? 'Checked locally'
      : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.RAW_EVIDENCE
        ? 'Seen in search'
        : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE
          ? 'Local candidate'
          : 'Not checked';
  const detail = activeMarketCount === 0
    ? 'Configure a local market before checking this keyword.'
    : visibility?.detail
      ?? row.localCandidate?.detail
      ?? 'Candidate is ready for local-pack visibility checking.';
  return {
    lifecycle,
    lifecycleLabel,
    priority,
    priorityLabel,
    detail,
    checked,
    marketLabel: visibility?.marketLabel,
    sourceLabels: row.localCandidate ? [row.localCandidate.sourceLabel] : ['Stored local visibility'],
    localPackPresent: visibility?.localPackPresent,
    businessMatchConfidence: visibility?.businessMatchConfidence,
    visibility,
  };
}

export function buildNextActions(
  row: DraftRow,
  status: KeywordCommandCenterStatus,
  isProtected: boolean,
  protection?: string,
  localSeoState?: KeywordCommandCenterLocalSeoState,
): KeywordCommandCenterNextAction[] {
  const keyword = row.keyword;
  const actions: KeywordCommandCenterNextAction[] = [];
  if (status === KEYWORD_COMMAND_CENTER_STATUS.DECLINED || status === KEYWORD_COMMAND_CENTER_STATUS.RETIRED) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
      label: 'Restore',
      detail: 'Reactivate this keyword in the operating loop without deleting history.',
      tone: 'teal',
      keyword,
    });
    return actions;
  }

  if (localSeoState) {
    actions.push({
      type: 'check_local_visibility',
      label: localSeoState.checked ? 'Refresh local' : 'Check locally',
      detail: 'Run a local-pack visibility refresh for this keyword through the background job system.',
      tone: 'teal',
      keyword,
      disabled: localSeoState.priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP,
      disabledReason: localSeoState.priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP
        ? 'Configure a local market before checking local visibility.'
        : undefined,
    });
  }

  if (row.feedback?.status === 'requested' || status === KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      label: 'Add to strategy',
      detail: 'Approve this keyword into the strategy operating loop without publishing anything.',
      tone: 'teal',
      keyword,
    });
  }

  if (!row.tracking || (row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) {
    actions.push({
      type: row.rawEvidenceOnly || row.explanation?.rawEvidenceOnly
        ? KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
        : KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
      label: row.rawEvidenceOnly || row.explanation?.rawEvidenceOnly ? 'Promote evidence' : 'Track keyword',
      detail: 'Add this keyword to active rank tracking so it can be measured intentionally.',
      tone: 'teal',
      keyword,
    });
  } else {
    actions.push({
      type: 'view_rankings',
      label: 'View rankings',
      detail: 'Open the national-rank history in the Keyword Hub drawer for this keyword.',
      tone: 'blue',
      keyword,
      targetTab: 'seo-keywords',
    });
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      label: 'Pause tracking',
      detail: 'Hide this keyword from active tracking while preserving rank history.',
      tone: 'amber',
      keyword,
      disabledReason: isProtected ? `${protection} requires confirmation before pausing.` : undefined,
    });
  }

  if (row.explanation?.role === 'content_gap' || row.assignment?.role === 'content_gap') {
    actions.push({
      type: 'generate_brief',
      label: 'Generate brief',
      detail: 'Open the content planning flow with this keyword as context. Nothing is published automatically.',
      tone: 'teal',
      keyword,
      targetTab: 'content-pipeline',
    });
  }
  const pagePath = row.explanation?.role === 'page_keyword' ? row.explanation.pagePath : row.assignment?.role === 'page_keyword' ? row.assignment.pagePath : undefined;
  if (pagePath) {
    actions.push({
      type: 'review_page',
      label: 'Review page',
      detail: 'Open Page Intelligence for the mapped page before making changes.',
      tone: 'teal',
      keyword,
      pagePath,
      targetTab: 'page-intelligence',
    });
  }

  actions.push({
    type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
    label: 'Decline',
    detail: 'Suppress this keyword from future strategy and recommendation consideration.',
    tone: 'red',
    keyword,
    disabledReason: isProtected ? `${protection} requires confirmation before decline.` : undefined,
  });

  if (row.tracking) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      label: 'Retire',
      detail: 'Remove from active strategy-owned tracking without deleting rank history.',
      tone: 'red',
      keyword,
      disabledReason: isProtected ? `${protection} requires confirmation before retirement.` : undefined,
    });
  }
  return actions;
}
