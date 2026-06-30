import { del, get, getSafe, post, put } from './client';
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

// SEO Decision Engine P7 (local-gbp): admin GBP/reviews readout. Aggregates only — the server
// never returns per-review/author data. Kept local to this api module (no shared-types churn);
// `owned`/`competitors` mirror the relevant fields of the server's BusinessListingSnapshot.
export interface GbpListingAggregate {
  placeId: string;
  title?: string;
  isOwned?: boolean;
  /** Star rating; undefined = no reviews (never 0). */
  rating?: number;
  /** Review count; undefined = no reviews (never 0). */
  reviewCount?: number;
  category?: string;
  attributes: string[];
  totalPhotos?: number;
  claimed?: boolean;
}

export interface GbpReviewsReadResponse {
  owned: GbpListingAggregate | null;
  competitors: GbpListingAggregate[];
  /** 0..100 GBP completeness; null when there is no owned listing or the flag is off. */
  completenessScore: number | null;
}

const EMPTY_GBP_REVIEWS: GbpReviewsReadResponse = { owned: null, competitors: [], completenessScore: null };

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

  // SEO Decision Engine P7 (local-gbp): admin GBP/reviews readout (aggregates only). getSafe with
  // an empty fallback so a missing/disabled-flag response degrades to "nothing to show", not an error.
  gbpReviews: (workspaceId: string) =>
    getSafe<GbpReviewsReadResponse>(`/api/local-seo/${workspaceId}/gbp-reviews`, EMPTY_GBP_REVIEWS),

  // SEO Decision Engine P7 (local-gbp): trigger a GBP + reviews refresh. Returns a job id;
  // progress surfaces through useBackgroundTasks + the LOCAL_GBP_SNAPSHOTS_REFRESHED broadcast.
  refreshGbp: (workspaceId: string) =>
    post<{ jobId: string }>(`/api/local-seo/${workspaceId}/refresh-gbp`),

  setPrimaryMarket: (workspaceId: string, marketId: string) =>
    put<{ ok: boolean }>(`/api/local-seo/${workspaceId}/markets/${marketId}/set-primary`, {}),

  listLocations: async (workspaceId: string) => {
    const response = await get<LocationsResponse>(`/api/local-seo/${workspaceId}/locations`);
    return response.locations;
  },

  createLocation: (workspaceId: string, body: CreateLocationBody) =>
    post<LocationMutationResponse>(`/api/local-seo/${workspaceId}/locations`, body),

  updateLocation: (workspaceId: string, locationId: string, body: Partial<CreateLocationBody>) =>
    put<LocationMutationResponse>(`/api/local-seo/${workspaceId}/locations/${locationId}`, body),

  deleteLocation: (workspaceId: string, locationId: string) =>
    del<{ deleted: boolean; jobId: string }>(`/api/local-seo/${workspaceId}/locations/${locationId}`),
};
