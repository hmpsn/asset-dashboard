import fs from 'fs';
import path from 'path';
import { getUploadRoot } from './data-dir.js';

const UPLOAD_ROOT = getUploadRoot();
const REQUESTS_FILE = path.join(UPLOAD_ROOT, '.requests.json');

export type RequestPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RequestStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';
export type RequestCategory = 'bug' | 'content' | 'design' | 'seo' | 'feature' | 'other';

export interface RequestAttachment {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface RequestNote {
  id: string;
  author: 'client' | 'team';
  content: string;
  attachments?: RequestAttachment[];
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
  submittedBy?: string;
  pageUrl?: string;
  attachments?: RequestAttachment[];
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
  submittedBy?: string;
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
    submittedBy: data.submittedBy,
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

export function getAttachmentsDir(): string {
  const dir = path.join(UPLOAD_ROOT, '.request-attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function addAttachmentsToRequest(requestId: string, attachments: RequestAttachment[]): ClientRequest | null {
  const requests = readRequests();
  const idx = requests.findIndex(r => r.id === requestId);
  if (idx === -1) return null;
  if (!requests[idx].attachments) requests[idx].attachments = [];
  requests[idx].attachments!.push(...attachments);
  requests[idx].updatedAt = new Date().toISOString();
  writeRequests(requests);
  return requests[idx];
}

export function addNote(requestId: string, author: 'client' | 'team', content: string, attachments?: RequestAttachment[]): ClientRequest | null {
  const requests = readRequests();
  const idx = requests.findIndex(r => r.id === requestId);
  if (idx === -1) return null;
  const note: RequestNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author,
    content,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
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
