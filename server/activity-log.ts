import fs from 'fs';
import path from 'path';
import { getUploadRoot } from './data-dir.js';

const UPLOAD_ROOT = getUploadRoot();
const LOG_FILE = path.join(UPLOAD_ROOT, '.activity-log.json');

export type ActivityType =
  | 'audit_completed'
  | 'request_resolved'
  | 'approval_applied'
  | 'seo_updated'
  | 'images_optimized'
  | 'links_fixed'
  | 'content_updated'
  | 'content_requested'
  | 'content_declined'
  | 'brief_generated'
  | 'brief_approved'
  | 'changes_requested'
  | 'content_upgraded'
  | 'schema_generated'
  | 'schema_published'
  | 'redirects_scanned'
  | 'strategy_generated'
  | 'rank_snapshot'
  | 'chat_session'
  | 'payment_received'
  | 'payment_failed'
  | 'fix_completed'
  | 'note';

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  type: ActivityType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  actorName?: string;
  createdAt: string;
}

function readLog(): ActivityEntry[] {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    }
  } catch { /* no file yet */ }
  return [];
}

function writeLog(entries: ActivityEntry[]) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

export function addActivity(workspaceId: string, type: ActivityType, title: string, description?: string, metadata?: Record<string, unknown>, actor?: { id?: string; name?: string }): ActivityEntry {
  const entries = readLog();
  const entry: ActivityEntry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    type,
    title,
    description,
    metadata,
    actorId: actor?.id,
    actorName: actor?.name,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  // Keep last 500 entries max
  if (entries.length > 500) entries.splice(0, entries.length - 500);
  writeLog(entries);
  return entry;
}

export function listActivity(workspaceId?: string, limit = 50): ActivityEntry[] {
  const all = readLog();
  const filtered = workspaceId ? all.filter(e => e.workspaceId === workspaceId) : all;
  return filtered.slice(-limit).reverse();
}

export function deleteActivity(id: string): boolean {
  const entries = readLog();
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  writeLog(entries);
  return true;
}
