/**
 * Persistent storage for schema generation results.
 * Saves per-site schema snapshots to DATA_DIR/schemas/ so they survive deploys.
 */
import fs from 'fs';
import path from 'path';
import type { SchemaPageSuggestion } from './schema-suggester.js';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const SCHEMAS_DIR = DATA_BASE
  ? path.join(DATA_BASE, 'schemas')
  : path.join(process.env.HOME || '', '.asset-dashboard', 'schemas');

export interface SchemaSnapshot {
  id: string;
  siteId: string;
  workspaceId: string;
  createdAt: string;
  results: SchemaPageSuggestion[];
  pageCount: number;
}

function ensureDir() {
  fs.mkdirSync(SCHEMAS_DIR, { recursive: true });
}

function snapshotPath(siteId: string): string {
  return path.join(SCHEMAS_DIR, `${siteId}.json`);
}

export function saveSchemaSnapshot(siteId: string, workspaceId: string, results: SchemaPageSuggestion[]): SchemaSnapshot {
  ensureDir();
  const snapshot: SchemaSnapshot = {
    id: `schema-${siteId}-${Date.now()}`,
    siteId,
    workspaceId,
    createdAt: new Date().toISOString(),
    results,
    pageCount: results.length,
  };
  fs.writeFileSync(snapshotPath(siteId), JSON.stringify(snapshot, null, 2));
  console.log(`[schema-store] Saved ${results.length} page schemas for site ${siteId}`);
  return snapshot;
}

export function getSchemaSnapshot(siteId: string): SchemaSnapshot | null {
  const fp = snapshotPath(siteId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return null;
  }
}
