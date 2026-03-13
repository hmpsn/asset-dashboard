/**
 * Asset audit & page weight routes — extracted from webflow.ts
 */
import { Router } from 'express';
import { savePageWeight, getPageWeight } from '../performance-store.js';
import {
  listAssets,
  scanAssetUsage,
} from '../webflow.js';
import { getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow-audit');

const router = Router();

// --- Asset Audit ---
router.get('/api/webflow/audit/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const [assets, usageMap] = await Promise.all([
      listAssets(req.params.siteId, token),
      scanAssetUsage(req.params.siteId, token),
    ]);

    const issues: Array<{
      assetId: string;
      fileName: string;
      url?: string;
      fileSize: number;
      issues: string[];
      usedIn: string[];
    }> = [];

    // Pre-compute duplicate detection: group by file size
    const sizeGroups = new Map<number, typeof assets>();
    for (const asset of assets) {
      if (asset.size > 0) {
        const group = sizeGroups.get(asset.size) || [];
        group.push(asset);
        sizeGroups.set(asset.size, group);
      }
    }
    const duplicateIds = new Set<string>();
    for (const group of sizeGroups.values()) {
      if (group.length < 2) continue;
      const normalize = (n: string) => (n || '').replace(/\.[^.]+$/, '').replace(/[-_\s]+/g, '').toLowerCase();
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = normalize(group[i].displayName || group[i].originalFileName || '');
          const b = normalize(group[j].displayName || group[j].originalFileName || '');
          if (a === b || group[i].size === group[j].size) {
            duplicateIds.add(group[i].id);
            duplicateIds.add(group[j].id);
          }
        }
      }
    }

    // Pre-compute alt text quality: collect all alt texts to find duplicates
    const altTextCounts = new Map<string, number>();
    for (const asset of assets) {
      const alt = (asset.altText || '').trim().toLowerCase();
      if (alt) altTextCounts.set(alt, (altTextCounts.get(alt) || 0) + 1);
    }

    for (const asset of assets) {
      const assetIssues: string[] = [];
      const name = asset.displayName || asset.originalFileName || '';
      const ext = name.split('.').pop()?.toLowerCase();
      const alt = (asset.altText || '').trim();

      if (!alt) {
        assetIssues.push('missing-alt');
      } else {
        const altLower = alt.toLowerCase();
        const nameBase = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toLowerCase();
        if (alt.length < 10) {
          assetIssues.push('low-quality-alt');
        } else if (altLower.startsWith('image of') || altLower.startsWith('an image of') || altLower.startsWith('photo of')) {
          assetIssues.push('low-quality-alt');
        } else if (altLower === nameBase || altLower.replace(/\s+/g, '') === nameBase.replace(/\s+/g, '')) {
          assetIssues.push('low-quality-alt');
        } else if ((altTextCounts.get(altLower) || 0) > 1) {
          assetIssues.push('duplicate-alt');
        }
      }

      if (asset.size > 500 * 1024) {
        assetIssues.push('oversized');
      }
      if (ext === 'png' && asset.size > 100 * 1024) {
        assetIssues.push('unoptimized-png');
      }
      if (ext === 'bmp' || ext === 'tiff' || ext === 'tif') {
        assetIssues.push('legacy-format');
      }
      if (duplicateIds.has(asset.id)) {
        assetIssues.push('duplicate');
      }

      const usedIn: string[] = [];
      if (usageMap.has(asset.id)) usedIn.push(...usageMap.get(asset.id)!);
      for (const [key, refs] of usageMap.entries()) {
        if (key.includes(asset.id)) {
          for (const r of refs) {
            if (!usedIn.includes(r)) usedIn.push(r);
          }
        }
      }

      if (usedIn.length === 0) {
        assetIssues.push('unused');
      }

      if (assetIssues.length > 0 || usedIn.length === 0) {
        issues.push({
          assetId: asset.id,
          fileName: name,
          url: asset.hostedUrl || asset.url,
          fileSize: asset.size || 0,
          issues: assetIssues,
          usedIn: [...new Set(usedIn)],
        });
      }
    }

    res.json({
      totalAssets: assets.length,
      issueCount: issues.length,
      missingAlt: issues.filter(i => i.issues.includes('missing-alt')).length,
      oversized: issues.filter(i => i.issues.includes('oversized')).length,
      unused: issues.filter(i => i.issues.includes('unused')).length,
      duplicates: issues.filter(i => i.issues.includes('duplicate')).length,
      lowQualityAlt: issues.filter(i => i.issues.includes('low-quality-alt')).length,
      duplicateAlt: issues.filter(i => i.issues.includes('duplicate-alt')).length,
      issues,
    });
  } catch (e) {
    log.error({ err: e }, 'Audit error');
    res.status(500).json({ error: 'Audit failed' });
  }
});

// --- Page Weight Dashboard ---
router.get('/api/webflow/page-weight/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const [assets, usageMap] = await Promise.all([
      listAssets(req.params.siteId, token),
      scanAssetUsage(req.params.siteId, token),
    ]);

    const assetById = new Map(assets.map(a => [a.id, a]));

    const pageAssets = new Map<string, Set<string>>();
    for (const [assetId, refs] of usageMap.entries()) {
      for (const ref of refs) {
        if (!pageAssets.has(ref)) pageAssets.set(ref, new Set());
        pageAssets.get(ref)!.add(assetId);
      }
    }

    const pages: Array<{
      page: string;
      totalSize: number;
      assetCount: number;
      assets: Array<{ id: string; name: string; size: number; contentType: string }>;
    }> = [];

    for (const [page, assetIds] of pageAssets.entries()) {
      let totalSize = 0;
      const pageAssetList: Array<{ id: string; name: string; size: number; contentType: string }> = [];
      for (const id of assetIds) {
        const asset = assetById.get(id);
        if (asset) {
          totalSize += asset.size || 0;
          pageAssetList.push({
            id: asset.id,
            name: asset.displayName || asset.originalFileName || '',
            size: asset.size || 0,
            contentType: asset.contentType || '',
          });
        }
      }
      pageAssetList.sort((a, b) => b.size - a.size);
      pages.push({ page, totalSize, assetCount: pageAssetList.length, assets: pageAssetList });
    }

    pages.sort((a, b) => b.totalSize - a.totalSize);

    const result = {
      totalPages: pages.length,
      totalAssetSize: assets.reduce((sum, a) => sum + (a.size || 0), 0),
      pages,
    };
    savePageWeight(req.params.siteId, result);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Page weight analysis failed' });
  }
});

// Load last saved page weight snapshot
router.get('/api/webflow/page-weight-snapshot/:siteId', (req, res) => {
  const snapshot = getPageWeight(req.params.siteId);
  res.json(snapshot);
});

export default router;
