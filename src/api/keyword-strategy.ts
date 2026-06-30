import { get, post } from './client';
import type { ActiveStrategyKeyword } from '../../shared/types/strategy-keyword-set';

export interface KeywordSetResponse {
  keywords: ActiveStrategyKeyword[];
}

export interface AddKeywordResponse {
  keyword: ActiveStrategyKeyword;
}

/** GET the active managed set (removedAt IS NULL), ordered by slotOrder. */
export function getStrategyKeywordSet(workspaceId: string): Promise<KeywordSetResponse> {
  return get<KeywordSetResponse>(`/api/webflow/keyword-strategy/${workspaceId}/keyword-set`);
}

/** POST add a keyword to the managed set (client_request | manual_add). */
export function addStrategyKeywordApi(
  workspaceId: string,
  keyword: string,
  source: 'client_request' | 'manual_add',
): Promise<AddKeywordResponse> {
  return post<AddKeywordResponse>(
    `/api/webflow/keyword-strategy/${workspaceId}/keyword-set`,
    { keyword, source },
  );
}

/** POST keep a keyword (stamps keptAt — survives regen AND tracked-keywords clobber). */
export function keepStrategyKeywordApi(
  workspaceId: string,
  keyword: string,
): Promise<KeywordSetResponse> {
  return post<KeywordSetResponse>(
    `/api/webflow/keyword-strategy/${workspaceId}/keyword-set/keep`,
    { keyword },
  );
}

/** POST soft-remove a keyword (sets removedAt; excluded from replenish). */
export function removeStrategyKeywordApi(
  workspaceId: string,
  keyword: string,
): Promise<KeywordSetResponse> {
  return post<KeywordSetResponse>(
    `/api/webflow/keyword-strategy/${workspaceId}/keyword-set/remove`,
    { keyword },
  );
}
