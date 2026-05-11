import { describe, it, expect } from 'vitest';
import { INBOX_FILTER_VALUES, LEGACY_FILTER_MAP, isInboxFilter } from '../../src/components/client/InboxTab';

describe('INBOX_FILTER_VALUES', () => {
  it('contains exactly the four active filter values', () => {
    expect(INBOX_FILTER_VALUES).toEqual(
      expect.arrayContaining(['all', 'decisions', 'reviews', 'conversations']),
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

  it('contains exactly the 5 backward-compat URL alias keys', () => {
    // Phase 2B complete: intermediate filter names (needs-action, seo-changes, content)
    // have been removed — ActionQueueStrip now emits final InboxFilter values directly.
    // Only URL alias params remain for external URL backward-compat.
    const expectedKeys = ['approvals', 'requests', 'copy', 'content-plan', 'completed'];
    for (const k of expectedKeys) {
      expect(LEGACY_FILTER_MAP).toHaveProperty(k);
    }
    // Intermediate keys must be absent
    expect(LEGACY_FILTER_MAP).not.toHaveProperty('needs-action');
    expect(LEGACY_FILTER_MAP).not.toHaveProperty('seo-changes');
    expect(LEGACY_FILTER_MAP).not.toHaveProperty('content');
    expect(Object.keys(LEGACY_FILTER_MAP)).toHaveLength(5);
  });
});

describe('isInboxFilter', () => {
  it('returns true for valid InboxFilter values', () => {
    for (const v of INBOX_FILTER_VALUES) {
      expect(isInboxFilter(v)).toBe(true);
    }
  });

  it('returns false for null', () => {
    expect(isInboxFilter(null)).toBe(false);
  });

  it('returns false for legacy values not in InboxFilter', () => {
    expect(isInboxFilter('approvals')).toBe(false);
    expect(isInboxFilter('content-plan')).toBe(false);
    expect(isInboxFilter('completed')).toBe(false);
  });

  it('returns false for arbitrary strings', () => {
    expect(isInboxFilter('garbage')).toBe(false);
    expect(isInboxFilter('')).toBe(false);
  });
});
