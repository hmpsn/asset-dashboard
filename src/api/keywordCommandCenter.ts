import { del, get, post } from './client';
import type {
  KeywordCommandCenterActionRequest,
  KeywordCommandCenterActionResult,
  KeywordCommandCenterBulkActionRequest,
  KeywordCommandCenterBulkActionResult,
  KeywordCommandCenterDetailResponse,
  KeywordCommandCenterRowsQuery,
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center';
import type { TrackedKeyword } from '../../shared/types/rank-tracking';

export interface KeywordHardDeleteResult {
  ok: true;
  keyword: string;
  trackedKeywords: TrackedKeyword[];
}

export const keywordCommandCenter = {
  summary: (wsId: string) =>
    get<KeywordCommandCenterSummaryResponse>(`/api/webflow/keyword-command-center/${wsId}/summary`),

  rows: (wsId: string, query: KeywordCommandCenterRowsQuery) => {
    const params = new URLSearchParams();
    if (query.filter) params.set('filter', query.filter);
    if (query.search) params.set('search', query.search);
    if (query.sort) params.set('sort', query.sort);
    if (query.direction) params.set('direction', query.direction);
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    const suffix = params.toString();
    return get<KeywordCommandCenterRowsResponse>(
      `/api/webflow/keyword-command-center/${wsId}/rows${suffix ? `?${suffix}` : ''}`,
    );
  },

  detail: (wsId: string, keyword: string) => {
    const params = new URLSearchParams({ keyword });
    return get<KeywordCommandCenterDetailResponse>(`/api/webflow/keyword-command-center/${wsId}/detail?${params.toString()}`);
  },

  action: (wsId: string, body: KeywordCommandCenterActionRequest) =>
    post<KeywordCommandCenterActionResult>(`/api/webflow/keyword-command-center/${wsId}/actions`, body),

  bulkAction: (wsId: string, body: KeywordCommandCenterBulkActionRequest) =>
    post<KeywordCommandCenterBulkActionResult>(`/api/webflow/keyword-command-center/${wsId}/actions/bulk`, body),

  // Hard delete — its OWN channel (never a lifecycle action). `force` overrides the
  // eligibility guard (pinned / client / gap provenance) — the UI only sends it from a
  // separate confirm path; the default Hub Delete affordance never sets it.
  deleteHard: (wsId: string, keyword: string, opts: { force?: boolean } = {}) =>
    del<KeywordHardDeleteResult>(
      `/api/webflow/keyword-command-center/${wsId}/keywords/${encodeURIComponent(keyword)}${opts.force ? '?force=true' : ''}`,
    ),
};
