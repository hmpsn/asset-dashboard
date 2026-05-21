import { get, post } from './client';
import type {
  KeywordCommandCenterActionRequest,
  KeywordCommandCenterActionResult,
  KeywordCommandCenterDetailResponse,
  KeywordCommandCenterRowsQuery,
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center';

export const keywordCommandCenter = {
  summary: (wsId: string) =>
    get<KeywordCommandCenterSummaryResponse>(`/api/webflow/keyword-command-center/${wsId}/summary`),

  rows: (wsId: string, query: KeywordCommandCenterRowsQuery) => {
    const params = new URLSearchParams();
    if (query.filter) params.set('filter', query.filter);
    if (query.search) params.set('search', query.search);
    if (query.sort) params.set('sort', query.sort);
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
};
