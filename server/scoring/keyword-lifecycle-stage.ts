import {
  KEYWORD_COMMAND_CENTER_STATUS,
  KEYWORD_LIFECYCLE_STAGES,
  type KeywordCommandCenterRow,
  type KeywordLifecycleStage,
} from '../../shared/types/keyword-command-center.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import { normalizePageUrl } from '../utils/page-address.js';

function normalizedPagePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return normalizePageUrl(path).toLowerCase();
}

function assignedPagePath(row: KeywordCommandCenterRow): string | undefined {
  return row.tracking.pagePath ?? row.assignment?.pagePath;
}

function isInStrategySource(row: KeywordCommandCenterRow): boolean {
  return row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY
    || row.tracking.strategyOwned === true
    || row.tracking.source === TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY
    || row.tracking.source === TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD
    || row.tracking.source === TRACKED_KEYWORD_SOURCE.CONTENT_GAP
    || row.feedback?.status === 'approved';
}

export function deriveLifecycleStage(
  row: KeywordCommandCenterRow,
  publishedPagePaths: Set<string>,
): KeywordLifecycleStage {
  const position = row.metrics.currentPosition;
  if (position != null && position <= 3) return KEYWORD_LIFECYCLE_STAGES.WINNING;
  if (position != null && position <= 20) return KEYWORD_LIFECYCLE_STAGES.RANKING;

  const pagePath = normalizedPagePath(assignedPagePath(row));
  if (pagePath && publishedPagePaths.has(pagePath)) {
    return KEYWORD_LIFECYCLE_STAGES.PUBLISHED;
  }

  if (pagePath && isInStrategySource(row)) {
    return KEYWORD_LIFECYCLE_STAGES.TARGETED;
  }

  return KEYWORD_LIFECYCLE_STAGES.DISCOVERED;
}
