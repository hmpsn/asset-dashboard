import { describe, expect, it } from 'vitest';

describe('blueprint-generator module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/blueprint-generator.js');
    expect(mod).toBeDefined();
  });
});
