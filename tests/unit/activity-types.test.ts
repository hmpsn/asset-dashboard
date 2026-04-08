import { describe, it, expect } from 'vitest';

// Compile-time tests: if a type is removed from ActivityType, these fail at tsc time.
describe('ActivityType — public portal types', () => {
  it('accepts client_onboarding_submitted', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_onboarding_submitted';
    expect(type).toBe('client_onboarding_submitted');
  });
  it('accepts client_keyword_feedback', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_keyword_feedback';
    expect(type).toBe('client_keyword_feedback');
  });
  it('accepts client_priorities_updated', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_priorities_updated';
    expect(type).toBe('client_priorities_updated');
  });
  it('accepts client_content_gap_vote', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_content_gap_vote';
    expect(type).toBe('client_content_gap_vote');
  });
});
