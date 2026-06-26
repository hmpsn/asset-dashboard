import { addActivity } from '../../activity-log.js';
import { getWorkspace } from '../../workspaces.js';
import type { LocalSeoMarketUpdateRequest, LocalSeoReadResponse } from '../../../shared/types/local-seo.js';
import { applyLocalSeoConfigurationUpdate, setPrimaryLocalSeoMarket } from './configuration-service.js';
import { notifyLocalSeoUpdated } from './events.js';
import { getLocalSeoReadModel } from './read-service.js';

export function setPrimaryMarket(workspaceId: string, marketId: string): void {
  setPrimaryLocalSeoMarket(workspaceId, marketId);
  addActivity(
    workspaceId,
    'local_seo_updated',
    'Primary market updated',
    'Set primary market for keyword volume geo-targeting',
    { source: 'local_seo' },
  );
  notifyLocalSeoUpdated(workspaceId, {
    action: 'primary_market_updated',
    updatedAt: new Date().toISOString(),
  });
}

export function updateLocalSeoConfiguration(
  workspaceId: string,
  request: LocalSeoMarketUpdateRequest,
  featureEnabled: boolean,
): LocalSeoReadResponse | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const { updatedAt, promotedPrimaryLabel } = applyLocalSeoConfigurationUpdate(workspace, request);
  const activityDetail = promotedPrimaryLabel
    ? `Updated local SEO posture or market setup — auto-promoted "${promotedPrimaryLabel}" to primary market`
    : 'Updated local SEO posture or market setup';
  addActivity(
    workspace.id,
    'local_seo_updated',
    'Local SEO configuration updated',
    activityDetail,
    { source: 'local_seo', ...(promotedPrimaryLabel ? { promotedPrimaryLabel } : {}) },
  );
  notifyLocalSeoUpdated(workspace.id, { action: 'configuration_updated', updatedAt });
  return getLocalSeoReadModel(workspace.id, featureEnabled);
}
