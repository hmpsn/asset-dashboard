import { keywordComparisonKey } from '../../shared/keyword-normalization';

export function keywordTrackingKey(keyword: string | null | undefined): string {
  return keywordComparisonKey(keyword);
}

export function rankTrackingHistoryPath(workspaceId: string, queries: string[]): string {
  const params = new URLSearchParams();
  for (const query of queries) {
    const trimmed = query.trim();
    if (trimmed) params.append('query', trimmed);
  }
  const suffix = params.toString();
  return `/api/rank-tracking/${workspaceId}/history${suffix ? `?${suffix}` : ''}`;
}
