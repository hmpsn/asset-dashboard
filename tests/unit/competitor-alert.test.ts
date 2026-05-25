import { describe, expect, it } from 'vitest';

describe('competitor-alert module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/competitor-alert.js');
    expect(mod).toBeDefined();
  });
});
