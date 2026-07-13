import {
  clearKeywordFeedback,
  readKeywordFeedbackIndex,
  readKeywordFeedbackRows,
  saveKeywordFeedbackDecision,
  type KeywordFeedbackIndex,
} from '../../keyword-feedback.js';
import type { FeedbackRow } from './types.js';

export function readFeedbackRows(workspaceId: string): FeedbackRow[] {
  return readKeywordFeedbackRows(workspaceId);
}

export function readFeedback(workspaceId: string): KeywordFeedbackIndex {
  return readKeywordFeedbackIndex(workspaceId);
}

export function deleteFeedbackByKeywordKey(workspaceId: string, keyword: string): number {
  return clearKeywordFeedback(workspaceId, keyword).existed ? 1 : 0;
}

export function upsertFeedback(
  workspaceId: string,
  keyword: string,
  status: 'approved' | 'declined' | 'requested',
  reason?: string,
): void {
  saveKeywordFeedbackDecision({
    workspaceId,
    keyword,
    status,
    reason,
    source: 'command_center',
    declinedBy: status === 'declined' ? 'admin' : null,
    // Action service owns KCC tracking/provenance mutations.
    trackApprovedKeyword: false,
  });
}
