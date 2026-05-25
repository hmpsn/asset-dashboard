import { describe, expect, it } from 'vitest';

describe('ranking-opportunity module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/ranking-opportunity.js');
    expect(mod).toBeDefined();
  });
});
