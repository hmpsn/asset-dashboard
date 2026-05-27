export const KEYWORD_FEEDBACK_STATUSES = ['approved', 'declined', 'requested'] as const;
export type KeywordFeedbackStatus = typeof KEYWORD_FEEDBACK_STATUSES[number];

export const KEYWORD_FEEDBACK_SOURCES = [
  'content_gap',
  'page_map',
  'opportunity',
  'topic_cluster',
  'keyword_gap',
] as const;
export type KeywordFeedbackSource = typeof KEYWORD_FEEDBACK_SOURCES[number];

export interface KeywordFeedbackListRow {
  keyword: string;
  status: KeywordFeedbackStatus;
  reason: string | null;
  source: KeywordFeedbackSource | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AdminKeywordFeedbackListRow extends KeywordFeedbackListRow {
  declined_by: string | null;
}

export interface KeywordFeedbackMutationResponse {
  keyword: string;
  status: KeywordFeedbackStatus;
  reason: string | null;
  source: KeywordFeedbackSource | null;
  updated_at: string | null;
}

export interface KeywordFeedbackDeleteResponse {
  deleted: string;
  existed: boolean;
  previousStatus: KeywordFeedbackStatus | null;
  source: KeywordFeedbackSource | null;
}

export interface KeywordFeedbackBulkMutationResponse {
  updated: number;
}
