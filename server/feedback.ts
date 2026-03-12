import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';

// ── Types ──

export type FeedbackType = 'bug' | 'feature' | 'general';
export type FeedbackStatus = 'new' | 'acknowledged' | 'fixed' | 'wontfix';

export interface FeedbackItem {
  id: string;
  workspaceId: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  /** Auto-captured context from client dashboard */
  context?: {
    currentTab?: string;
    browser?: string;
    screenSize?: string;
    url?: string;
    userAgent?: string;
  };
  submittedBy?: string;
  /** Admin replies */
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackReply {
  id: string;
  author: 'team' | 'client';
  content: string;
  createdAt: string;
}

// ── Storage ──

function getFeedbackDir(): string {
  return getDataDir('feedback');
}

function getFilePath(workspaceId: string): string {
  return path.join(getFeedbackDir(), `${workspaceId}.json`);
}

function readFeedback(workspaceId: string): FeedbackItem[] {
  const fp = getFilePath(workspaceId);
  try {
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    }
  } catch { /* corrupt or missing */ }
  return [];
}

function writeFeedback(workspaceId: string, items: FeedbackItem[]): void {
  const fp = getFilePath(workspaceId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(items, null, 2));
}

// ── CRUD ──

export function listFeedback(workspaceId: string): FeedbackItem[] {
  return readFeedback(workspaceId).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getFeedbackItem(workspaceId: string, id: string): FeedbackItem | undefined {
  return readFeedback(workspaceId).find(f => f.id === id);
}

export function createFeedback(workspaceId: string, data: {
  type: FeedbackType;
  title: string;
  description: string;
  context?: FeedbackItem['context'];
  submittedBy?: string;
}): FeedbackItem {
  const items = readFeedback(workspaceId);
  const item: FeedbackItem = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    type: data.type,
    title: data.title,
    description: data.description,
    status: 'new',
    context: data.context,
    submittedBy: data.submittedBy,
    replies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  items.push(item);
  writeFeedback(workspaceId, items);

  // Activity log
  addActivity(workspaceId, 'note', `Feedback: ${data.title}`, `${data.type} — ${data.description.slice(0, 120)}`, {
    feedbackId: item.id,
    feedbackType: data.type,
  });

  // Real-time broadcast to admin
  broadcastToWorkspace(workspaceId, 'feedback:new', item);

  return item;
}

export function updateFeedbackStatus(workspaceId: string, id: string, status: FeedbackStatus): FeedbackItem | null {
  const items = readFeedback(workspaceId);
  const item = items.find(f => f.id === id);
  if (!item) return null;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  writeFeedback(workspaceId, items);
  broadcastToWorkspace(workspaceId, 'feedback:update', item);
  return item;
}

export function addFeedbackReply(workspaceId: string, id: string, author: 'team' | 'client', content: string): FeedbackItem | null {
  const items = readFeedback(workspaceId);
  const item = items.find(f => f.id === id);
  if (!item) return null;
  const reply: FeedbackReply = {
    id: `fbr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author,
    content,
    createdAt: new Date().toISOString(),
  };
  item.replies.push(reply);
  item.updatedAt = new Date().toISOString();
  writeFeedback(workspaceId, items);
  broadcastToWorkspace(workspaceId, 'feedback:update', item);
  return item;
}

export function deleteFeedback(workspaceId: string, id: string): boolean {
  const items = readFeedback(workspaceId);
  const idx = items.findIndex(f => f.id === id);
  if (idx === -1) return false;
  items.splice(idx, 1);
  writeFeedback(workspaceId, items);
  return true;
}

/** List feedback across ALL workspaces (for admin command center) */
export function listAllFeedback(): FeedbackItem[] {
  const dir = getFeedbackDir();
  const all: FeedbackItem[] = [];
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const items: FeedbackItem[] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        all.push(...items);
      } catch { /* skip corrupt files */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
