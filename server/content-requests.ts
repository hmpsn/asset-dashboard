import fs from 'fs';
import path from 'path';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const CONTENT_REQUESTS_DIR = DATA_BASE
  ? path.join(DATA_BASE, 'content-requests')
  : path.join(process.env.HOME || '', 'toUpload', 'content-requests');

fs.mkdirSync(CONTENT_REQUESTS_DIR, { recursive: true });

export interface ContentTopicRequest {
  id: string;
  workspaceId: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: 'requested' | 'brief_generated' | 'in_progress' | 'delivered' | 'declined';
  briefId?: string;
  clientNote?: string;
  internalNote?: string;
  requestedAt: string;
  updatedAt: string;
}

function getFile(workspaceId: string): string {
  return path.join(CONTENT_REQUESTS_DIR, `${workspaceId}.json`);
}

function read(workspaceId: string): ContentTopicRequest[] {
  try {
    const f = getFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
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
  data: { topic: string; targetKeyword: string; intent: string; priority: string; rationale: string; clientNote?: string }
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
  updates: Partial<Pick<ContentTopicRequest, 'status' | 'briefId' | 'internalNote'>>
): ContentTopicRequest | null {
  const items = read(workspaceId);
  const idx = items.findIndex(r => r.id === id);
  if (idx === -1) return null;
  Object.assign(items[idx], updates, { updatedAt: new Date().toISOString() });
  write(workspaceId, items);
  return items[idx];
}
