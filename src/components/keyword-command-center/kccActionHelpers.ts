import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterBulkActionType,
  type KeywordCommandCenterRow,
} from '../../../shared/types/keyword-command-center';

export interface KeywordBulkActionSummary {
  action: KeywordCommandCenterBulkActionType;
  total: number;
  protectedCount: number;
  notTrackedCount: number;
  keywords: string[];
  requiresConfirmation: boolean;
}

export function isProtectionSensitiveBulkAction(action: KeywordCommandCenterBulkActionType): boolean {
  return action === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING
    || action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE
    || action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE;
}

export function requiresTrackedKeyword(action: KeywordCommandCenterBulkActionType): boolean {
  return action === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING
    || action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE;
}

export function summarizeBulkAction(rows: KeywordCommandCenterRow[], action: KeywordCommandCenterBulkActionType): KeywordBulkActionSummary {
  const protectedCount = isProtectionSensitiveBulkAction(action)
    ? rows.filter(row => row.isProtected).length
    : 0;
  const notTrackedCount = requiresTrackedKeyword(action)
    ? rows.filter(row => row.tracking.status === 'not_tracked').length
    : 0;

  return {
    action,
    total: rows.length,
    protectedCount,
    notTrackedCount,
    keywords: rows.map(row => row.keyword),
    requiresConfirmation: protectedCount > 0 || notTrackedCount > 0 || action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE || action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
  };
}
