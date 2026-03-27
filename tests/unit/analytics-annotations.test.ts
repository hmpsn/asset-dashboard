/**
 * Unit tests for Phase 4C — Analytics annotations/changelog.
 *
 * Tests CRUD operations for the analytics_annotations table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

describe('analytics annotations store', () => {
  let db: InstanceType<typeof Database>;
  let store: {
    createAnnotation: (opts: { workspaceId: string; date: string; label: string; category: string; createdBy?: string }) => { id: string };
    getAnnotations: (workspaceId: string, opts?: { startDate?: string; endDate?: string; category?: string }) => Array<{ id: string; workspaceId: string; date: string; label: string; category: string; createdBy: string | null; createdAt: string }>;
    deleteAnnotation: (id: string, workspaceId: string) => boolean;
    updateAnnotation: (id: string, workspaceId: string, opts: { label?: string; date?: string; category?: string }) => boolean;
  };

  const dbPath = path.join(import.meta.dirname, '.test-annotations.db');

  beforeAll(async () => {
    // Clean up any leftover test db
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }

    // We'll test the store functions with a real SQLite db
    const mod = await import('../../server/analytics-annotations.js');
    store = mod;
  });

  afterAll(() => {
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  });

  it('createAnnotation returns an id', () => {
    const result = store.createAnnotation({
      workspaceId: 'ws1',
      date: '2026-03-15',
      label: 'Launched new homepage',
      category: 'site_change',
      createdBy: 'admin',
    });
    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe('string');
  });

  it('getAnnotations returns created annotations', () => {
    const annotations = store.getAnnotations('ws1');
    expect(annotations.length).toBeGreaterThanOrEqual(1);
    const found = annotations.find(a => a.label === 'Launched new homepage');
    expect(found).toBeDefined();
    expect(found!.category).toBe('site_change');
    expect(found!.date).toBe('2026-03-15');
  });

  it('getAnnotations filters by date range', () => {
    store.createAnnotation({
      workspaceId: 'ws1',
      date: '2026-01-10',
      label: 'Old event',
      category: 'algorithm_update',
    });
    const filtered = store.getAnnotations('ws1', { startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(filtered.every(a => a.date >= '2026-03-01' && a.date <= '2026-03-31')).toBe(true);
  });

  it('getAnnotations filters by category', () => {
    const filtered = store.getAnnotations('ws1', { category: 'site_change' });
    expect(filtered.every(a => a.category === 'site_change')).toBe(true);
  });

  it('getAnnotations scopes to workspace', () => {
    store.createAnnotation({
      workspaceId: 'ws2',
      date: '2026-03-20',
      label: 'Other workspace event',
      category: 'campaign',
    });
    const ws1 = store.getAnnotations('ws1');
    expect(ws1.every(a => a.workspaceId === 'ws1')).toBe(true);
  });

  it('updateAnnotation modifies fields', () => {
    const { id } = store.createAnnotation({
      workspaceId: 'ws1',
      date: '2026-03-25',
      label: 'Original label',
      category: 'other',
    });
    const updated = store.updateAnnotation(id, 'ws1', { label: 'Updated label', category: 'campaign' });
    expect(updated).toBe(true);
    const annotations = store.getAnnotations('ws1');
    const found = annotations.find(a => a.id === id);
    expect(found!.label).toBe('Updated label');
    expect(found!.category).toBe('campaign');
  });

  it('deleteAnnotation removes the record', () => {
    const { id } = store.createAnnotation({
      workspaceId: 'ws1',
      date: '2026-03-26',
      label: 'To be deleted',
      category: 'other',
    });
    const deleted = store.deleteAnnotation(id, 'ws1');
    expect(deleted).toBe(true);
    const annotations = store.getAnnotations('ws1');
    expect(annotations.find(a => a.id === id)).toBeUndefined();
  });

  it('deleteAnnotation returns false for non-existent id', () => {
    expect(store.deleteAnnotation('non-existent-id', 'ws1')).toBe(false);
  });
});
