// tests/unit/inbox-filter-values.test.ts
import { describe, it, expect } from 'vitest';

// These are the exact values that InboxTab.tsx must export after Phase 0.
// Test fails until the exports exist.
import { INBOX_FILTER_VALUES } from '../../src/components/client/InboxTab';

describe('INBOX_FILTER_VALUES', () => {
  it('contains exactly the five new filter values', () => {
    expect(INBOX_FILTER_VALUES).toEqual(
      expect.arrayContaining(['all', 'needs-action', 'seo-changes', 'content', 'completed']),
    );
    expect(INBOX_FILTER_VALUES).toHaveLength(5);
  });

  it('does not contain legacy filter values', () => {
    const legacy = ['approvals', 'requests', 'copy', 'content-plan'];
    for (const v of legacy) {
      expect(INBOX_FILTER_VALUES).not.toContain(v);
    }
  });
});
