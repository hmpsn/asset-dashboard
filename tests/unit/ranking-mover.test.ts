import { describe, expect, it } from 'vitest';

describe('ranking-mover module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/ranking-mover.js');
    expect(mod).toBeDefined();
  });
});
