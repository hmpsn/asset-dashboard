import { describe, expect, it } from 'vitest';

describe('freshness-alert module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/freshness-alert.js');
    expect(mod).toBeDefined();
  });
});
