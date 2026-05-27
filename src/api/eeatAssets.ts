import { del, get, patch, post } from './client';
import type { EeatAsset, EeatAssetMetadata, EeatAssetType } from '../../shared/types/eeat-assets';

export interface CreateEeatAssetBody {
  type: EeatAssetType;
  title: string;
  url?: string;
  content?: string;
  metadata?: EeatAssetMetadata;
}

export interface UpdateEeatAssetBody {
  type?: EeatAssetType;
  title?: string;
  url?: string;
  content?: string;
  metadata?: EeatAssetMetadata;
}

export const eeatAssetsApi = {
  list: (workspaceId: string) =>
    get<EeatAsset[]>(`/api/workspaces/${workspaceId}/eeat-assets`),

  getById: (workspaceId: string, assetId: string) =>
    get<EeatAsset>(`/api/workspaces/${workspaceId}/eeat-assets/${assetId}`),

  create: (workspaceId: string, body: CreateEeatAssetBody) =>
    post<EeatAsset>(`/api/workspaces/${workspaceId}/eeat-assets`, body),

  update: (workspaceId: string, assetId: string, body: UpdateEeatAssetBody) =>
    patch<EeatAsset>(`/api/workspaces/${workspaceId}/eeat-assets/${assetId}`, body),

  remove: (workspaceId: string, assetId: string) =>
    del<{ ok: true }>(`/api/workspaces/${workspaceId}/eeat-assets/${assetId}`),
};
