import type { EeatAssetsSlice } from '../../shared/types/intelligence.js';
import { EEAT_ASSET_TYPE } from '../../shared/types/eeat-assets.js';
import { listEeatAssets } from '../eeat-assets.js';
import { createLogger } from '../logger.js';

const log = createLogger('workspace-intelligence/eeat-assets');

function renderTrustSignalsBlock(slice: EeatAssetsSlice): string {
  if (slice.availability === 'no_data') {
    return 'No E-E-A-T asset inventory has been configured for this workspace.';
  }

  const lines: string[] = [];
  lines.push(`E-E-A-T asset inventory: ${slice.assets.length} total assets across ${slice.byType.length} categories.`);
  lines.push('Use concrete assets below when recommending trust evidence:');
  for (const asset of slice.assets.slice(0, 12)) {
    const urlPart = asset.url ? ` (${asset.url})` : '';
    lines.push(`- [${asset.type}] ${asset.title}${urlPart}`);
  }
  if (slice.assets.length > 12) {
    lines.push(`- ...and ${slice.assets.length - 12} additional assets`);
  }
  return lines.join('\n');
}

export async function assembleEeatAssets(workspaceId: string): Promise<EeatAssetsSlice> {
  try {
    const assets = listEeatAssets(workspaceId);
    const orderedTypes = [
      EEAT_ASSET_TYPE.TESTIMONIAL,
      EEAT_ASSET_TYPE.CASE_STUDY,
      EEAT_ASSET_TYPE.CREDENTIAL,
      EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
      EEAT_ASSET_TYPE.TEAM_BIO,
      EEAT_ASSET_TYPE.AWARD,
      EEAT_ASSET_TYPE.RESEARCH,
      EEAT_ASSET_TYPE.CLIENT_LOGO,
    ] as const;
    const byType = orderedTypes
      .map((type) => ({ type, count: assets.filter(asset => asset.type === type).length }))
      .filter(entry => entry.count > 0);

    const availability: EeatAssetsSlice['availability'] = assets.length > 0 ? 'ready' : 'no_data';
    const slice: EeatAssetsSlice = {
      availability,
      assets,
      byType,
      effectiveTrustSignalsBlock: '',
    };
    slice.effectiveTrustSignalsBlock = renderTrustSignalsBlock(slice);
    return slice;
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleEeatAssets: failed, degrading gracefully');
    return {
      availability: 'no_data',
      assets: [],
      byType: [],
      effectiveTrustSignalsBlock: 'E-E-A-T asset inventory is unavailable due to a read error.',
    };
  }
}
