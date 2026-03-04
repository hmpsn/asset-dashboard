import { watch } from 'chokidar';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getOptRoot, getUploadRoot, listWorkspaces } from './workspaces.js';
import { generateAltText } from './alttext.js';
import { uploadAsset } from './webflow.js';

// --- Persistent metadata ---
const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const METADATA_DIR = DATA_BASE
  ? path.join(DATA_BASE, 'metadata')
  : path.join(process.env.HOME || '', '.asset-dashboard');
const METADATA_FILE = path.join(METADATA_DIR, 'metadata.json');

interface AssetMetadata {
  fileName: string;
  workspace: string;
  type: 'asset' | 'meta';
  altText?: string;
  webflowAssetId?: string;
  webflowUrl?: string;
  uploadedAt?: string;
  originalPath?: string;
  optimizedPath?: string;
}

function loadMetadata(): Record<string, AssetMetadata> {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
    }
  } catch { /* ignore corrupt file */ }
  return {};
}

function saveMetadataEntry(key: string, entry: AssetMetadata) {
  fs.mkdirSync(METADATA_DIR, { recursive: true });
  const data = loadMetadata();
  data[key] = { ...data[key], ...entry };
  fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}

export function getMetadata(): Record<string, AssetMetadata> {
  return loadMetadata();
}

export interface QueueItem {
  id: string;
  fileName: string;
  workspace: string;
  type: 'asset' | 'meta';
  status: 'generating-alt' | 'optimizing' | 'uploading' | 'done' | 'error';
  altText?: string;
  outputPath?: string;
  error?: string;
  startedAt: number;
}

type BroadcastFn = (event: string, data: unknown) => void;

const queue: QueueItem[] = [];
const PROCESSOR = path.join(process.env.HOME || '', 'bin', 'optimize_assets.sh');

// Store alt text keyed by "workspace/baseName" so we can match across format changes
// e.g. "faros/hero-image" maps to the alt text generated from the original hero-image.jpg
const altTextCache = new Map<string, string>();

// Track queue IDs by the same key so we can update the right queue item
const queueIdCache = new Map<string, string>();

// Normalize a filename base the same way optimize_assets.sh does:
// lowercase, spaces→dashes, strip non-alphanumeric, collapse dashes
function normalizeBase(base: string): string {
  let s = base.toLowerCase();
  s = s.replace(/ /g, '-');
  s = s.replace(/[^a-z0-9_-]/g, '');
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s || 'image';
}

function cacheKey(workspace: string, fileName: string): string {
  const baseName = path.basename(fileName, path.extname(fileName));
  return `${workspace}/${normalizeBase(baseName)}`;
}

export function getQueue(): QueueItem[] {
  return queue.slice(-50);
}

function addToQueue(item: QueueItem, broadcast: BroadcastFn) {
  queue.push(item);
  if (queue.length > 100) queue.splice(0, queue.length - 100);
  broadcast('queue:update', item);
}

function updateQueueItem(id: string, updates: Partial<QueueItem>, broadcast: BroadcastFn) {
  const item = queue.find(q => q.id === id);
  if (item) {
    Object.assign(item, updates);
    broadcast('queue:update', item);
  }
}

// Phase 1: New file arrives in ~/toUpload → generate alt text from original
async function handleOriginalFile(
  filePath: string,
  workspaceFolder: string,
  type: 'asset' | 'meta',
  broadcast: BroadcastFn
) {
  const fileName = path.basename(filePath);
  const key = cacheKey(workspaceFolder, fileName);
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  queueIdCache.set(key, id);

  const item: QueueItem = {
    id,
    fileName,
    workspace: workspaceFolder,
    type,
    status: 'generating-alt',
    startedAt: Date.now(),
  };
  addToQueue(item, broadcast);

  // Generate alt text from the high-quality original
  try {
    const context = `Website workspace: "${workspaceFolder}", file: "${fileName}", category: ${type === 'meta' ? 'website meta/social images' : 'website assets'}`;
    const altText = await generateAltText(filePath, context);
    if (altText) {
      altTextCache.set(key, altText);
      updateQueueItem(id, { altText, status: 'optimizing' }, broadcast);
      console.log(`Alt text for ${fileName}: "${altText}"`);
      saveMetadataEntry(key, { fileName, workspace: workspaceFolder, type, altText, originalPath: filePath });
    } else {
      updateQueueItem(id, { status: 'optimizing' }, broadcast);
      saveMetadataEntry(key, { fileName, workspace: workspaceFolder, type, originalPath: filePath });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Alt text failed for ${fileName}:`, msg);
    updateQueueItem(id, { status: 'optimizing' }, broadcast);
  }
}

// Wait for alt text to be cached (Claude API may still be running)
async function waitForAltText(key: string, maxWaitMs = 30000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const cached = altTextCache.get(key);
    if (cached) {
      altTextCache.delete(key);
      return cached;
    }
    // If no queue item is pending for this key, no alt text is coming
    if (!queueIdCache.has(key)) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

// Phase 2: Optimized file appears in ~/Optimized → upload to Webflow with cached alt text
async function handleOptimizedFile(
  optimizedPath: string,
  workspaceFolder: string,
  type: 'asset' | 'meta',
  broadcast: BroadcastFn
) {
  const fileName = path.basename(optimizedPath);
  const key = cacheKey(workspaceFolder, fileName);

  // Look up the queue item from Phase 1, or create a new one
  let id = queueIdCache.get(key);
  if (id) {
    updateQueueItem(id, { outputPath: optimizedPath, fileName, status: 'uploading' }, broadcast);
  } else {
    // File appeared without going through Phase 1 (e.g. direct Finder drop)
    id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    addToQueue({
      id,
      fileName,
      workspace: workspaceFolder,
      type,
      status: 'uploading',
      outputPath: optimizedPath,
      startedAt: Date.now(),
    }, broadcast);
  }

  // Wait for alt text if it's still being generated
  let altText: string | undefined = altTextCache.get(key);
  if (altText) {
    altTextCache.delete(key);
  } else if (queueIdCache.has(key)) {
    console.log(`[optimized] Waiting for alt text for ${fileName}...`);
    altText = (await waitForAltText(key)) ?? undefined;
  }
  if (altText) {
    updateQueueItem(id, { altText }, broadcast);
  }
  // Clean up queue ID cache
  queueIdCache.delete(key);

  // Upload to Webflow if workspace has a site configured (case-insensitive match)
  const workspaces = listWorkspaces();
  const wsLower = workspaceFolder.toLowerCase();
  const ws = workspaces.find(w => w.folder.toLowerCase() === wsLower);

  if (ws?.webflowSiteId) {
    try {
      const result = await uploadAsset(ws.webflowSiteId, optimizedPath, fileName, altText || undefined, ws.webflowToken || undefined);
      if (result.success) {
        updateQueueItem(id, { status: 'done' }, broadcast);
        saveMetadataEntry(key, {
          fileName, workspace: workspaceFolder, type,
          altText,
          optimizedPath,
          webflowAssetId: result.assetId,
          webflowUrl: result.hostedUrl,
          uploadedAt: new Date().toISOString(),
        });
      } else {
        updateQueueItem(id, { status: 'error', error: result.error }, broadcast);
        console.error(`Webflow upload failed for ${fileName}:`, result.error);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      updateQueueItem(id, { status: 'error', error: msg }, broadcast);
      console.error(`Webflow upload error for ${fileName}:`, msg);
    }
  } else {
    updateQueueItem(id, { status: 'done' }, broadcast);
    saveMetadataEntry(key, { fileName, workspace: workspaceFolder, type, altText, optimizedPath });
  }
}

export function startWatcher(broadcast: BroadcastFn) {
  const uploadRoot = getUploadRoot();
  const optRoot = getOptRoot();

  // Watch ~/toUpload for new originals → generate alt text
  const uploadWatcher = watch(uploadRoot, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    ignored: [/(^|[/\\])\../, /\.recent_batch/, /\.tmp/, /_archive/],
  });

  uploadWatcher.on('add', async (filePath: string) => {
    const rel = path.relative(uploadRoot, filePath);
    const parts = rel.split(path.sep);
    if (parts.length < 2) return;

    const workspaceFolder = parts[0];
    if (workspaceFolder === '_unsorted' || workspaceFolder === '.tmp') return;

    const isMeta = parts.length >= 3 && parts[1] === 'meta';
    const type = isMeta ? 'meta' : 'asset';
    const key = cacheKey(workspaceFolder, path.basename(filePath));
    console.log(`[upload] Detected original: ${rel} (key: ${key})`);

    handleOriginalFile(filePath, workspaceFolder, type, broadcast);
  });

  // Watch ~/Optimized for optimized outputs → upload to Webflow
  const optWatcher = watch(optRoot, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
    ignored: [/(^|[/\\])\../, /\.recent_batch/],
  });

  optWatcher.on('add', async (filePath: string) => {
    const rel = path.relative(optRoot, filePath);
    const parts = rel.split(path.sep);
    if (parts.length < 2) return;

    const workspaceFolder = parts[0];
    if (workspaceFolder === '_unsorted') return;

    const isMeta = parts.length >= 3 && parts[1] === 'meta';
    const type = isMeta ? 'meta' : 'asset';
    const key = cacheKey(workspaceFolder, path.basename(filePath));
    console.log(`[optimized] Detected: ${rel} (key: ${key}, cached alt: ${altTextCache.has(key)})`);

    handleOptimizedFile(filePath, workspaceFolder, type, broadcast);
  });

  console.log(`Watching ${uploadRoot} for originals (alt text)...`);
  console.log(`Watching ${optRoot} for optimized files (upload)...`);
  return { uploadWatcher, optWatcher };
}

export function triggerOptimize(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(PROCESSOR, [filePath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
