import { describe, it, expect } from 'vitest';
import { eventDisplayName, isEventPinned, pinnedOutcomeNouns } from '../../src/components/client/the-issue/outcomeNoun';
import type { EventDisplayConfig } from '../../shared/types/workspace';

const cfg: EventDisplayConfig[] = [
  { eventName: 'generate_lead', displayName: 'New patients', pinned: true },
  { eventName: 'book_appointment', displayName: 'Bookings', pinned: true },
  { eventName: 'scroll_90', displayName: 'scroll_90', pinned: false },
];

describe('outcomeNoun helpers', () => {
  it('eventDisplayName returns custom displayName, falls back to de-underscored eventName', () => {
    expect(eventDisplayName(cfg, 'generate_lead')).toBe('New patients');
    expect(eventDisplayName(cfg, 'page_view')).toBe('page view');
  });
  it('isEventPinned reflects the pinned flag, false for unknown', () => {
    expect(isEventPinned(cfg, 'generate_lead')).toBe(true);
    expect(isEventPinned(cfg, 'scroll_90')).toBe(false);
    expect(isEventPinned(cfg, 'unknown')).toBe(false);
  });
  it('pinnedOutcomeNouns returns only pinned events as {eventName, label}', () => {
    expect(pinnedOutcomeNouns(cfg)).toEqual([
      { eventName: 'generate_lead', label: 'New patients' },
      { eventName: 'book_appointment', label: 'Bookings' },
    ]);
  });
  it('pinnedOutcomeNouns is empty for undefined config', () => {
    expect(pinnedOutcomeNouns(undefined)).toEqual([]);
  });
});
