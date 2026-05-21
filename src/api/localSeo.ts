import { get, post, put } from './client';
import type {
  LocalSeoLocationLookupRequest,
  LocalSeoLocationLookupResponse,
  LocalSeoMarketUpdateRequest,
  LocalSeoReadResponse,
  LocalSeoRefreshRequest,
  LocalSeoRefreshStartResponse,
} from '../../shared/types/local-seo';

export const localSeo = {
  get: (workspaceId: string, options: { includeSnapshots?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.includeSnapshots === false) params.set('includeSnapshots', 'false');
    const query = params.toString();
    return get<LocalSeoReadResponse>(`/api/local-seo/${workspaceId}${query ? `?${query}` : ''}`);
  },

  update: (workspaceId: string, body: LocalSeoMarketUpdateRequest) =>
    put<LocalSeoReadResponse>(`/api/local-seo/${workspaceId}`, body),

  locationLookup: (workspaceId: string, body: LocalSeoLocationLookupRequest) => {
    const params = new URLSearchParams({
      city: body.city,
      country: body.country,
    });
    if (body.stateOrRegion) params.set('stateOrRegion', body.stateOrRegion);
    return get<LocalSeoLocationLookupResponse>(`/api/local-seo/${workspaceId}/location-lookup?${params.toString()}`);
  },

  refresh: (workspaceId: string, body: LocalSeoRefreshRequest = {}) =>
    post<LocalSeoRefreshStartResponse>(`/api/local-seo/${workspaceId}/refresh`, body),
};
