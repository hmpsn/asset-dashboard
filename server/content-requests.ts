import fs from 'fs';
import path from 'path';
import { getUploadRoot, getDataDir } from './data-dir.js';

const UPLOAD_ROOT = getUploadRoot();
const CONTENT_REQUESTS_DIR = getDataDir('content-requests');

fs.mkdirSync(CONTENT_REQUESTS_DIR, { recursive: true });

// Old storage path: ~/toUpload/<wsId>/.content-requests.json
function getOldFile(workspaceId: string): string {
  return path.join(UPLOAD_ROOT, workspaceId, '.content-requests.json');
}

export interface ContentRequestComment {
  id: string;
  author: 'client' | 'team';
  content: string;
  createdAt: string;
}

export interface ContentTopicRequest {
  id: string;
  workspaceId: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'delivered' | 'declined';
  briefId?: string;
  clientNote?: string;
  internalNote?: string;
  declineReason?: string;
  clientFeedback?: string;
  source?: 'strategy' | 'client';
  serviceType?: 'brief_only' | 'full_post';
  upgradedAt?: string;
  comments?: ContentRequestComment[];
  requestedAt: string;
  updatedAt: string;
}

function getFile(workspaceId: string): string {
  return path.join(CONTENT_REQUESTS_DIR, `${workspaceId}.json`);
}

function read(workspaceId: string): ContentTopicRequest[] {
  // Try new path first
  try {
    const f = getFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
  // Fall back to old path
  try {
    const old = getOldFile(workspaceId);
    if (fs.existsSync(old)) {
      const data = JSON.parse(fs.readFileSync(old, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        // Migrate forward: write to new path so future reads are fast
        write(workspaceId, data);
        console.log(`[Migration] Moved ${data.length} content requests for ${workspaceId} to new path`);
        return data;
      }
    }
  } catch { /* skip */ }
  return [];
}

function write(workspaceId: string, items: ContentTopicRequest[]) {
  fs.writeFileSync(getFile(workspaceId), JSON.stringify(items, null, 2));
}

export function listContentRequests(workspaceId: string): ContentTopicRequest[] {
  return read(workspaceId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function getContentRequest(workspaceId: string, id: string): ContentTopicRequest | undefined {
  return read(workspaceId).find(r => r.id === id);
}

export function createContentRequest(
  workspaceId: string,
  data: { topic: string; targetKeyword: string; intent: string; priority: string; rationale: string; clientNote?: string; source?: 'strategy' | 'client'; serviceType?: 'brief_only' | 'full_post' }
): ContentTopicRequest {
  const items = read(workspaceId);

  // Prevent duplicate requests for the same keyword
  const existing = items.find(r => r.targetKeyword === data.targetKeyword && r.status !== 'declined');
  if (existing) return existing;

  const request: ContentTopicRequest = {
    id: `creq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    topic: data.topic,
    targetKeyword: data.targetKeyword,
    intent: data.intent,
    priority: data.priority,
    rationale: data.rationale,
    clientNote: data.clientNote,
    source: data.source || 'strategy',
    serviceType: data.serviceType || 'brief_only',
    comments: [],
    status: 'requested',
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  items.push(request);
  write(workspaceId, items);
  return request;
}

export function updateContentRequest(
  workspaceId: string,
  id: string,
  updates: Partial<Pick<ContentTopicRequest, 'status' | 'briefId' | 'internalNote' | 'declineReason' | 'clientFeedback' | 'serviceType' | 'upgradedAt'>>
): ContentTopicRequest | null {
  const items = read(workspaceId);
  const idx = items.findIndex(r => r.id === id);
  if (idx === -1) return null;
  Object.assign(items[idx], updates, { updatedAt: new Date().toISOString() });
  write(workspaceId, items);
  return items[idx];
}

export function deleteContentRequest(workspaceId: string, id: string): boolean {
  const items = read(workspaceId);
  const idx = items.findIndex(r => r.id === id);
  if (idx === -1) return false;
  items.splice(idx, 1);
  write(workspaceId, items);
  return true;
}

export function addComment(
  workspaceId: string,
  requestId: string,
  author: 'client' | 'team',
  content: string
): ContentTopicRequest | null {
  const items = read(workspaceId);
  const idx = items.findIndex(r => r.id === requestId);
  if (idx === -1) return null;
  if (!items[idx].comments) items[idx].comments = [];
  items[idx].comments!.push({
    id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author,
    content,
    createdAt: new Date().toISOString(),
  });
  items[idx].updatedAt = new Date().toISOString();
  write(workspaceId, items);
  return items[idx];
}
