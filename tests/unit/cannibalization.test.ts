import { describe, expect, it } from 'vitest';

describe('cannibalization module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/cannibalization.js');
    expect(mod).toBeDefined();
  });
});
