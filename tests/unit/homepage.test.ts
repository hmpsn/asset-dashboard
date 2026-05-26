import { describe, expect, it } from 'vitest';

describe('homepage module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/templates/homepage.js');
    expect(mod).toBeDefined();
  });
});
