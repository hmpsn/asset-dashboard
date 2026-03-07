/**
 * Persistent storage for redirect scan results.
 * Saves per-site redirect snapshots to DATA_DIR/redirects/ so they survive deploys.
 */
import fs from 'fs';
import path from 'path';
import type { RedirectScanResult } from './redirect-scanner.js';

import { getDataDir } from './data-dir.js';

const REDIRECTS_DIR = getDataDir('redirects');

export interface RedirectSnapshot {
  id: string;
  siteId: string;
  createdAt: string;
  result: RedirectScanResult;
}

function ensureDir() {
  fs.mkdirSync(REDIRECTS_DIR, { recursive: true });
}

function snapshotPath(siteId: string): string {
  return path.join(REDIRECTS_DIR, `${siteId}.json`);
}

export function saveRedirectSnapshot(siteId: string, result: RedirectScanResult): RedirectSnapshot {
  ensureDir();
  const snapshot: RedirectSnapshot = {
    id: `redirect-${siteId}-${Date.now()}`,
    siteId,
    createdAt: new Date().toISOString(),
    result,
  };
  fs.writeFileSync(snapshotPath(siteId), JSON.stringify(snapshot, null, 2));
  console.log(`[redirect-store] Saved redirect scan for site ${siteId} (${result.summary.totalPages} pages)`);
  return snapshot;
}

export function getRedirectSnapshot(siteId: string): RedirectSnapshot | null {
  const fp = snapshotPath(siteId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return null;
  }
}
