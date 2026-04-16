import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('copy pipeline query key factory', () => {
  it('prefix-All variants are a strict prefix of the full variant', () => {
    const ws = 'ws-1';
    const entry = 'entry-1';
    const batch = 'batch-1';
    expect(queryKeys.admin.copySections(ws, entry).slice(0, 2))
      .toEqual(queryKeys.admin.copySectionsAll(ws));
    expect(queryKeys.admin.copyStatus(ws, entry).slice(0, 2))
      .toEqual(queryKeys.admin.copyStatusAll(ws));
    expect(queryKeys.admin.copyMetadata(ws, entry).slice(0, 2))
      .toEqual(queryKeys.admin.copyMetadataAll(ws));
    expect(queryKeys.admin.copyBatch(ws, batch).slice(0, 2))
      .toEqual(queryKeys.admin.copyBatchAll(ws));
  });

  it('key strings match the legacy inline literals they replace', () => {
    const ws = 'ws-1';
    expect(queryKeys.admin.copySectionsAll(ws)[0]).toBe('admin-copy-sections');
    expect(queryKeys.admin.copyStatusAll(ws)[0]).toBe('admin-copy-status');
    expect(queryKeys.admin.copyMetadataAll(ws)[0]).toBe('admin-copy-metadata');
    expect(queryKeys.admin.copyIntelligence(ws)[0]).toBe('admin-copy-intelligence');
    expect(queryKeys.admin.copyPromotable(ws)[0]).toBe('admin-copy-promotable');
    expect(queryKeys.admin.copyBatchAll(ws)[0]).toBe('admin-copy-batch');
  });
});
