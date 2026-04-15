import { describe, it, expect } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';

describe('Phase 3 factory entries', () => {
  it('admin.approvals matches legacy inline literal', () => {
    expect(queryKeys.admin.approvals('ws-1')).toEqual(['admin-approvals', 'ws-1']);
  });

  it('shared.features matches legacy inline literal', () => {
    expect(queryKeys.shared.features()).toEqual(['features']);
  });
});
