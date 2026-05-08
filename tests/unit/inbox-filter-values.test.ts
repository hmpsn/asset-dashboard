import { describe, it, expect } from 'vitest';
import { INBOX_FILTER_VALUES, LEGACY_FILTER_MAP } from '../../src/components/client/InboxTab';

describe('INBOX_FILTER_VALUES', () => {
  it('contains exactly the four active filter values', () => {
    expect(INBOX_FILTER_VALUES).toEqual(
      expect.arrayContaining(['all', 'needs-action', 'seo-changes', 'content']),
    );
    expect(INBOX_FILTER_VALUES).toHaveLength(4);
  });

  it('does not contain legacy or mode-only values', () => {
    const excluded = ['approvals', 'requests', 'copy', 'content-plan', 'completed'];
    for (const v of excluded) {
      expect(INBOX_FILTER_VALUES).not.toContain(v);
    }
  });
});

describe('LEGACY_FILTER_MAP', () => {
  it('maps every legacy key to a valid canonical InboxFilter value', () => {
    for (const [, target] of Object.entries(LEGACY_FILTER_MAP)) {
      expect(INBOX_FILTER_VALUES).toContain(target);
    }
  });

  it('contains all 5 legacy keys including completed', () => {
    const expectedKeys = ['approvals', 'requests', 'copy', 'content-plan', 'completed'];
    for (const k of expectedKeys) {
      expect(LEGACY_FILTER_MAP).toHaveProperty(k);
    }
  });
});
