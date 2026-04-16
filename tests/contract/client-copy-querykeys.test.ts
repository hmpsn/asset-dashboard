import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('client copy factory entries', () => {
  it('keys match legacy literals', () => {
    expect(queryKeys.client.copyEntries('ws-1')).toEqual(['client-copy-entries', 'ws-1']);
    expect(queryKeys.client.copySections('ws-1', 'entry-1')).toEqual(['client-copy-sections', 'ws-1', 'entry-1']);
    expect(queryKeys.client.copySectionsAll('ws-1')).toEqual(['client-copy-sections', 'ws-1']);
  });
  it('copySectionsAll is a prefix of copySections', () => {
    expect(queryKeys.client.copySections('ws-1', 'entry-1').slice(0, 2))
      .toEqual(queryKeys.client.copySectionsAll('ws-1'));
  });
});
