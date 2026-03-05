import fs from 'fs';
import path from 'path';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const UPLOAD_ROOT = DATA_BASE
  ? path.join(DATA_BASE, 'uploads')
  : path.join(process.env.HOME || '', 'toUpload');

function getAnnotationsFile(workspaceId: string): string {
  const dir = path.join(UPLOAD_ROOT, workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, '.annotations.json');
}

export interface Annotation {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  description?: string;
  color?: string; // hex color
  createdAt: string;
}

function readAnnotations(workspaceId: string): Annotation[] {
  try {
    const f = getAnnotationsFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
  return [];
}

function writeAnnotations(workspaceId: string, annotations: Annotation[]) {
  fs.writeFileSync(getAnnotationsFile(workspaceId), JSON.stringify(annotations, null, 2));
}

export function listAnnotations(workspaceId: string): Annotation[] {
  return readAnnotations(workspaceId).sort((a, b) => a.date.localeCompare(b.date));
}

export function addAnnotation(workspaceId: string, date: string, label: string, description?: string, color?: string): Annotation {
  const annotations = readAnnotations(workspaceId);
  const entry: Annotation = {
    id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date,
    label,
    description,
    color: color || '#2dd4bf',
    createdAt: new Date().toISOString(),
  };
  annotations.push(entry);
  writeAnnotations(workspaceId, annotations);
  return entry;
}

export function deleteAnnotation(workspaceId: string, annotationId: string): boolean {
  const annotations = readAnnotations(workspaceId);
  const idx = annotations.findIndex(a => a.id === annotationId);
  if (idx === -1) return false;
  annotations.splice(idx, 1);
  writeAnnotations(workspaceId, annotations);
  return true;
}
