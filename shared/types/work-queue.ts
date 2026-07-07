export const WORK_QUEUE_STREAMS = ['opt', 'send', 'money', 'unclassified'] as const;

export type WorkQueueStream = typeof WORK_QUEUE_STREAMS[number];

export type WorkQueueDirection = 'positive' | 'negative' | 'neutral';

export type WorkQueueSourceType =
  | 'request'
  | 'work_order'
  | 'content_request'
  | 'content_pipeline'
  | 'rank_drop'
  | 'content_decay'
  | 'audit_error'
  | 'setup_gap'
  | 'churn_signal';

export interface WorkQueueItem {
  stream: WorkQueueStream;
  id: string;
  title: string;
  meta: string;
  impact?: string;
  direction?: WorkQueueDirection;
  clientId?: string;
  sourceType: WorkQueueSourceType;
}

export interface WorkQueueClassification {
  streams: Record<WorkQueueStream, number>;
  items: WorkQueueItem[];
}
