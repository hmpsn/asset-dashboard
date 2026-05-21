import { get, post, put } from './client';
import type {
  LocalSeoMarketUpdateRequest,
  LocalSeoReadResponse,
  LocalSeoRefreshRequest,
  LocalSeoRefreshStartResponse,
} from '../../shared/types/local-seo';

export const localSeo = {
  get: (workspaceId: string) =>
    get<LocalSeoReadResponse>(`/api/local-seo/${workspaceId}`),

  update: (workspaceId: string, body: LocalSeoMarketUpdateRequest) =>
    put<LocalSeoReadResponse>(`/api/local-seo/${workspaceId}`, body),

  refresh: (workspaceId: string, body: LocalSeoRefreshRequest = {}) =>
    post<LocalSeoRefreshStartResponse>(`/api/local-seo/${workspaceId}/refresh`, body),
};
