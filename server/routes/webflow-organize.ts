/**
 * Asset organization & rename routes — extracted from webflow.ts
 */
import { Router } from 'express';
import {
  listAssets,
  scanAssetUsage,
  listPages,
  listAssetFolders,
  createAssetFolder,
  moveAssetToFolder,
  getSiteSubdomain,
  updateAsset,
} from '../webflow.js';
import { getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow-organize');

const router = Router();

// --- Organize Assets into Folders ---

// Preview: builds a plan of which assets go into which folders
router.get('/api/webflow/organize-preview/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No token for site' });

  try {
    // 1. Fetch assets and existing folders
    const [assets, existingFolders] = await Promise.all([
      listAssets(siteId, token),
      listAssetFolders(siteId, token),
    ]);

    // 2. Scan usage: which assets appear on which pages
    const usage = await scanAssetUsage(siteId, token);

    // Build assetId → page titles mapping
    const assetPageMap = new Map<string, string[]>();
    for (const [assetId, refs] of usage.entries()) {
      const pageTitles = refs.filter(r => r.startsWith('page:')).map(r => r.slice(5));
      if (pageTitles.length > 0) assetPageMap.set(assetId, pageTitles);
    }

    // 2b. Detect OG/meta image assets from published HTML
    const ogAssetIds = new Set<string>();
    const allAssetIds = new Set(assets.map(a => a.id));
    try {
      const subdomain = await getSiteSubdomain(siteId, token);
      if (subdomain) {
        const baseUrl = `https://${subdomain}.webflow.io`;
        const pages = await listPages(siteId, token);
        const pageUrls = [
          baseUrl,
          ...pages.filter(p => p.slug && p.slug !== 'index' && !p.draft && !p.archived).map(p => `${baseUrl}/${p.slug}`),
        ];
        for (let i = 0; i < pageUrls.length; i += 10) {
          await Promise.allSettled(pageUrls.slice(i, i + 10).map(async (url) => {
            try {
              const r = await fetch(url, { redirect: 'follow' });
              if (!r.ok) return;
              const html = await r.text();
              const ogMatches = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/gi) || [];
              for (const tag of ogMatches) {
                const m = tag.match(/content=["']([^"']+)["']/i);
                if (!m) continue;
                for (const id of allAssetIds) { if (m[1].includes(id)) ogAssetIds.add(id); }
              }
            } catch { /* skip */ }
          }));
        }
      }
    } catch { /* proceed without OG detection */ }

    // 3. Build the organization plan
    const existingFolderNames = new Set(existingFolders.map(f => f.displayName));
    const plan: {
      foldersToCreate: string[];
      moves: Array<{ assetId: string; assetName: string; targetFolder: string; currentFolder?: string }>;
      summary: { totalAssets: number; assetsToMove: number; foldersToCreate: number; alreadyOrganized: number; unused: number; shared: number; ogImages: number };
    } = {
      foldersToCreate: [],
      moves: [],
      summary: { totalAssets: assets.length, assetsToMove: 0, foldersToCreate: 0, alreadyOrganized: 0, unused: 0, shared: 0, ogImages: 0 },
    };

    const foldersNeeded = new Set<string>();

    for (const asset of assets) {
      const pageTitles = assetPageMap.get(asset.id);

      if (asset.parentFolder) {
        plan.summary.alreadyOrganized++;
        continue;
      }

      let targetFolder: string;
      if (ogAssetIds.has(asset.id)) {
        targetFolder = '_Social / OG Images';
        plan.summary.ogImages++;
      } else if (!pageTitles || pageTitles.length === 0) {
        targetFolder = '_Unused Assets';
        plan.summary.unused++;
      } else if (pageTitles.length > 1) {
        targetFolder = '_Shared Assets';
        plan.summary.shared++;
      } else {
        targetFolder = pageTitles[0];
      }

      foldersNeeded.add(targetFolder);
      plan.moves.push({
        assetId: asset.id,
        assetName: asset.displayName || asset.originalFileName || asset.id,
        targetFolder,
        currentFolder: undefined,
      });
    }

    // Determine which folders need to be created
    for (const folder of foldersNeeded) {
      if (!existingFolderNames.has(folder)) {
        plan.foldersToCreate.push(folder);
      }
    }

    plan.summary.assetsToMove = plan.moves.length;
    plan.summary.foldersToCreate = plan.foldersToCreate.length;

    res.json(plan);
  } catch (err) {
    log.error({ err: err }, 'Organize preview error');
    res.status(500).json({ error: 'Failed to build organization plan' });
  }
});

// Execute: creates folders and moves assets according to a plan
router.post('/api/webflow/organize-execute/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const { moves, foldersToCreate } = req.body as {
    moves: Array<{ assetId: string; assetName: string; targetFolder: string }>;
    foldersToCreate: string[];
  };
  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No token for site' });
  if (!moves?.length) return res.status(400).json({ error: 'No moves to execute' });

  try {
    // 1. Get existing folders to avoid duplicates
    const existingFolders = await listAssetFolders(siteId, token);
    const folderNameToId = new Map(existingFolders.map(f => [f.displayName, f.id]));

    // 2. Create any new folders needed
    const createResults: Array<{ folder: string; success: boolean; error?: string }> = [];
    for (const folderName of (foldersToCreate || [])) {
      if (folderNameToId.has(folderName)) {
        createResults.push({ folder: folderName, success: true });
        continue;
      }
      const result = await createAssetFolder(siteId, folderName, undefined, token);
      if (result.success && result.folderId) {
        folderNameToId.set(folderName, result.folderId);
        createResults.push({ folder: folderName, success: true });
      } else {
        createResults.push({ folder: folderName, success: false, error: result.error });
      }
    }

    // 3. Move assets into their target folders
    const moveResults: Array<{ assetId: string; assetName: string; targetFolder: string; success: boolean; error?: string }> = [];
    for (const move of moves) {
      const folderId = folderNameToId.get(move.targetFolder);
      if (!folderId) {
        moveResults.push({ ...move, success: false, error: `Folder "${move.targetFolder}" not found` });
        continue;
      }
      const result = await moveAssetToFolder(move.assetId, folderId, token);
      moveResults.push({ ...move, success: result.success, error: result.error });
    }

    const successCount = moveResults.filter(r => r.success).length;
    const failCount = moveResults.filter(r => !r.success).length;

    res.json({
      success: true,
      foldersCreated: createResults,
      moveResults,
      summary: { moved: successCount, failed: failCount, total: moves.length },
    });
  } catch (err) {
    log.error({ err: err }, 'Organize execute error');
    res.status(500).json({ error: 'Failed to execute organization plan' });
  }
});

// --- Rename Asset ---
router.patch('/api/webflow/rename/:assetId', async (req, res) => {
  const { displayName, siteId } = req.body;
  if (!displayName) return res.status(400).json({ error: 'displayName required' });

  try {
    const token = siteId ? getTokenForSite(siteId) : null;
    const result = await updateAsset(req.params.assetId, { displayName }, token || undefined);
    res.json(result);
  } catch (e) {
    log.error({ err: e }, 'Rename error');
    res.status(500).json({ error: 'Failed to rename asset' });
  }
});

export default router;
