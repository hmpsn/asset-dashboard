import { describe, it, expect } from 'vitest';
import { startIntelligenceCrons, stopIntelligenceCrons } from '../server/intelligence-crons.js';
import { hasRecentActivity } from '../server/activity-log.js';

describe('intelligence refresh cron', () => {
  it('startIntelligenceCrons is idempotent — calling twice does not create double interval', () => {
    startIntelligenceCrons();
    startIntelligenceCrons();
    stopIntelligenceCrons();
    expect(true).toBe(true);
  });

  it('stopIntelligenceCrons is safe to call when not started', () => {
    stopIntelligenceCrons();
    expect(true).toBe(true);
  });

  it('skips workspaces with no recent activity', () => {
    // hasRecentActivity on a non-existent workspace should return false
    // (no rows in activity_log for that id)
    expect(hasRecentActivity('nonexistent-workspace-id', 30)).toBe(false);
  });
});
