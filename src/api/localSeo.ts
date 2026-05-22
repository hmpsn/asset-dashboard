import { del, get, post, put } from './client';
import type {
  ClientLocation,
  LocalSeoLocationLookupRequest,
  LocalSeoLocationLookupResponse,
  LocalSeoMarketUpdateRequest,
  LocalSeoReadResponse,
  LocalSeoRefreshRequest,
  LocalSeoRefreshStartResponse,
} from '../../shared/types/local-seo';

export interface CreateLocationBody {
  name: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  stateOrRegion?: string;
  country?: string;
  isPrimary?: boolean;
  status?: ClientLocation['status'];
  gbpPlaceId?: string;
}

interface LocationsResponse {
  locations: ClientLocation[];
}

interface LocationMutationResponse {
  location: ClientLocation;
  jobId?: string;
}

export const localSeo = {
  get: (workspaceId: string, options: { includeSnapshots?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.includeSnapshots === false) params.set('includeSnapshots', 'false');
    const query = params.toString();
    return get<LocalSeoReadResponse>(`/api/local-seo/${workspaceId}${query ? `?${query}` : ''}`);
  },

  getSummary: (workspaceId: string) =>
    localSeo.get(workspaceId, { includeSnapshots: false }),

  getWithSnapshots: (workspaceId: string) =>
    localSeo.get(workspaceId, { includeSnapshots: true }),

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

  listLocations: async (workspaceId: string) => {
    const response = await get<LocationsResponse>(`/api/local-seo/${workspaceId}/locations`);
    return response.locations;
  },

  createLocation: async (workspaceId: string, body: CreateLocationBody) => {
    const response = await post<LocationMutationResponse>(`/api/local-seo/${workspaceId}/locations`, body);
    return response.location;
  },

  updateLocation: async (workspaceId: string, locationId: string, body: Partial<CreateLocationBody>) => {
    const response = await put<LocationMutationResponse>(`/api/local-seo/${workspaceId}/locations/${locationId}`, body);
    return response.location;
  },

  deleteLocation: async (workspaceId: string, locationId: string) => {
    await del(`/api/local-seo/${workspaceId}/locations/${locationId}`);
  },
};
