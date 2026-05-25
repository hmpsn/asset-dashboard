import { describe, expect, it } from 'vitest';

describe('milestone-attribution module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/milestone-attribution.js');
    expect(mod).toBeDefined();
  });
});
