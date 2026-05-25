import { describe, expect, it } from 'vitest';

describe('anomaly-digest module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/anomaly-digest.js');
    expect(mod).toBeDefined();
  });
});
