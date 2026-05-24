/**
 * Pure / structural tests for the useCopyPipeline module.
 *
 * The hooks themselves all delegate to React Query + API calls, so this file
 * tests the observable pure structure: that query-key factories referenced by
 * the hooks produce the correct shape, and that the CopySectionStatus and
 * ExportRequest types cover their documented values.
 */
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys.js';
import type {
  CopySectionStatus,
  ExportRequest,
  ExportFormat,
  ExportScope,
} from '../../../shared/types/copy-pipeline.js';

// ── Query key shape tests (mirrors what the hooks wire up) ────────────────────

describe('queryKeys used by useCopyPipeline', () => {
  const wsId = 'ws-1';
  const entryId = 'entry-1';
  const batchId = 'batch-1';

  it('copySections key includes wsId and entryId', () => {
    const key = queryKeys.admin.copySections(wsId, entryId);
    expect(key).toEqual(['admin-copy-sections', wsId, entryId]);
  });

  it('copySectionsAll key is a prefix of copySections key', () => {
    const all = queryKeys.admin.copySectionsAll(wsId);
    const specific = queryKeys.admin.copySections(wsId, entryId);
    expect(all).toEqual(['admin-copy-sections', wsId]);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('copyStatus key includes wsId and entryId', () => {
    const key = queryKeys.admin.copyStatus(wsId, entryId);
    expect(key).toEqual(['admin-copy-status', wsId, entryId]);
  });

  it('copyStatusAll key is a prefix of copyStatus key', () => {
    const all = queryKeys.admin.copyStatusAll(wsId);
    const specific = queryKeys.admin.copyStatus(wsId, entryId);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('copyMetadata key includes wsId and entryId', () => {
    const key = queryKeys.admin.copyMetadata(wsId, entryId);
    expect(key).toEqual(['admin-copy-metadata', wsId, entryId]);
  });

  it('copyMetadataAll key is a prefix of copyMetadata key', () => {
    const all = queryKeys.admin.copyMetadataAll(wsId);
    const specific = queryKeys.admin.copyMetadata(wsId, entryId);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('copyIntelligence key includes wsId', () => {
    const key = queryKeys.admin.copyIntelligence(wsId);
    expect(key).toEqual(['admin-copy-intelligence', wsId]);
  });

  it('copyPromotable key includes wsId', () => {
    const key = queryKeys.admin.copyPromotable(wsId);
    expect(key).toEqual(['admin-copy-promotable', wsId]);
  });

  it('copyBatch key includes wsId and batchId', () => {
    const key = queryKeys.admin.copyBatch(wsId, batchId);
    expect(key).toEqual(['admin-copy-batch', wsId, batchId]);
  });

  it('copyBatchAll key is a prefix of copyBatch key', () => {
    const all = queryKeys.admin.copyBatchAll(wsId);
    const specific = queryKeys.admin.copyBatch(wsId, batchId);
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('different wsIds produce different keys', () => {
    const key1 = queryKeys.admin.copySections('ws-a', entryId);
    const key2 = queryKeys.admin.copySections('ws-b', entryId);
    expect(key1).not.toEqual(key2);
  });

  it('different entryIds produce different keys', () => {
    const key1 = queryKeys.admin.copySections(wsId, 'entry-a');
    const key2 = queryKeys.admin.copySections(wsId, 'entry-b');
    expect(key1).not.toEqual(key2);
  });
});

// ── CopySectionStatus type coverage ──────────────────────────────────────────

describe('CopySectionStatus values', () => {
  const validStatuses: CopySectionStatus[] = [
    'pending',
    'draft',
    'client_review',
    'approved',
    'revision_requested',
  ];

  it('includes all expected status values', () => {
    expect(validStatuses).toHaveLength(5);
    expect(validStatuses).toContain('pending');
    expect(validStatuses).toContain('draft');
    expect(validStatuses).toContain('client_review');
    expect(validStatuses).toContain('approved');
    expect(validStatuses).toContain('revision_requested');
  });
});

// ── ExportRequest structure ───────────────────────────────────────────────────

describe('ExportRequest structure', () => {
  it('can construct a valid ExportRequest with all_entries scope', () => {
    const req: ExportRequest = {
      format: 'csv' as ExportFormat,
      scope: 'all' as ExportScope,
    };
    expect(req.format).toBe('csv');
    expect(req.scope).toBe('all');
  });

  it('can construct a selected-scope ExportRequest with entryIds', () => {
    const req: ExportRequest = {
      format: 'webflow_cms' as ExportFormat,
      scope: 'selected' as ExportScope,
      entryIds: ['e1', 'e2'],
    };
    expect(req.entryIds).toHaveLength(2);
  });
});
