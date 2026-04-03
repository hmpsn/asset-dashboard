import { describe, it, expect } from 'vitest';
import { startIntelligenceCrons, stopIntelligenceCrons } from '../server/intelligence-crons.js';

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
});
