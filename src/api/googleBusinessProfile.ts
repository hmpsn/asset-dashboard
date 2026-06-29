import { get, post, put } from './client';
import type {
  GbpAccountSummary,
  GbpConnectionSafe,
  GbpLocationSummary,
  GbpSyncResponse,
  WorkspaceGbpMappingRead,
  WorkspaceGbpMappingsUpdateRequest,
} from '../../shared/types/google-business-profile';

export const googleBusinessProfile = {
  status: () =>
    get<GbpConnectionSafe>('/api/google-business-profile/status'),

  authUrl: (workspaceId?: string, returnTo?: string) => {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (returnTo) params.set('returnTo', returnTo);
    const query = params.toString();
    return get<{ url: string }>(`/api/google-business-profile/auth-url${query ? `?${query}` : ''}`);
  },

  sync: (workspaceId?: string) => {
    const query = workspaceId ? `?${new URLSearchParams({ workspaceId }).toString()}` : '';
    return post<GbpSyncResponse>(`/api/google-business-profile/sync${query}`);
  },

  disconnect: (workspaceId?: string) => {
    const query = workspaceId ? `?${new URLSearchParams({ workspaceId }).toString()}` : '';
    return post<GbpConnectionSafe>(`/api/google-business-profile/disconnect${query}`);
  },

  accounts: () =>
    get<GbpAccountSummary[]>('/api/google-business-profile/accounts'),

  locations: () =>
    get<GbpLocationSummary[]>('/api/google-business-profile/locations'),

  workspaceMappings: (workspaceId: string) =>
    get<WorkspaceGbpMappingRead>(`/api/google-business-profile/workspaces/${workspaceId}/mappings`),

  updateWorkspaceMappings: (workspaceId: string, body: WorkspaceGbpMappingsUpdateRequest) =>
    put<WorkspaceGbpMappingRead>(`/api/google-business-profile/workspaces/${workspaceId}/mappings`, body),
};
