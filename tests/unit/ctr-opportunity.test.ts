import { describe, expect, it } from 'vitest';

describe('ctr-opportunity module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/ctr-opportunity.js');
    expect(mod).toBeDefined();
  });
});
