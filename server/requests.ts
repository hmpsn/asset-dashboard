import fs from 'fs';
import path from 'path';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const UPLOAD_ROOT = DATA_BASE
  ? path.join(DATA_BASE, 'uploads')
  : path.join(process.env.HOME || '', 'toUpload');
const REQUESTS_FILE = path.join(UPLOAD_ROOT, '.requests.json');

export type RequestPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RequestStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';
export type RequestCategory = 'bug' | 'content' | 'design' | 'seo' | 'feature' | 'other';

export interface RequestNote {
  id: string;
  author: 'client' | 'team';
  content: string;
  createdAt: string;
}

export interface ClientRequest {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  category: RequestCategory;
  priority: RequestPriority;
  status: RequestStatus;
  pageUrl?: string;
  notes: RequestNote[];
  createdAt: string;
  updatedAt: string;
}

function readRequests(): ClientRequest[] {
  try {
    if (fs.existsSync(REQUESTS_FILE)) {
      return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf-8'));
    }
  } catch { /* no file yet */ }
  return [];
}

function writeRequests(requests: ClientRequest[]) {
  fs.mkdirSync(path.dirname(REQUESTS_FILE), { recursive: true });
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));
}

export function listRequests(workspaceId?: string): ClientRequest[] {
  const all = readRequests();
  if (workspaceId) return all.filter(r => r.workspaceId === workspaceId);
  return all;
}

export function getRequest(id: string): ClientRequest | undefined {
  return readRequests().find(r => r.id === id);
}

export function createRequest(workspaceId: string, data: {
  title: string;
  description: string;
  category: RequestCategory;
  priority?: RequestPriority;
  pageUrl?: string;
}): ClientRequest {
  const requests = readRequests();
  const now = new Date().toISOString();
  const request: ClientRequest = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    title: data.title,
    description: data.description,
    category: data.category,
    priority: data.priority || 'medium',
    status: 'new',
    pageUrl: data.pageUrl,
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
  requests.push(request);
  writeRequests(requests);
  return request;
}

export function updateRequest(id: string, updates: Partial<Pick<ClientRequest, 'status' | 'priority' | 'category'>>): ClientRequest | null {
  const requests = readRequests();
  const idx = requests.findIndex(r => r.id === id);
  if (idx === -1) return null;
  Object.assign(requests[idx], updates, { updatedAt: new Date().toISOString() });
  writeRequests(requests);
  return requests[idx];
}

export function addNote(requestId: string, author: 'client' | 'team', content: string): ClientRequest | null {
  const requests = readRequests();
  const idx = requests.findIndex(r => r.id === requestId);
  if (idx === -1) return null;
  const note: RequestNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author,
    content,
    createdAt: new Date().toISOString(),
  };
  requests[idx].notes.push(note);
  requests[idx].updatedAt = new Date().toISOString();
  writeRequests(requests);
  return requests[idx];
}

export function deleteRequest(id: string): boolean {
  const requests = readRequests();
  const idx = requests.findIndex(r => r.id === id);
  if (idx === -1) return false;
  requests.splice(idx, 1);
  writeRequests(requests);
  return true;
}
