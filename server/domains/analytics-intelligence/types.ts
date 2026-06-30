import type { InsightSeverity } from '../../../shared/types/analytics.js';

export interface ComputedInsight<T> {
  pageId: string | null;
  insightType: string;
  data: T;
  severity: InsightSeverity;
}
