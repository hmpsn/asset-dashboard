import { describe, expect, it } from 'vitest';

describe('semrush-provider module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/providers/semrush-provider.js');
    expect(mod).toBeDefined();
  });
});
