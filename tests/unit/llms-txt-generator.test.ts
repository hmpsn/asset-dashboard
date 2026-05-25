import { describe, expect, it } from 'vitest';

describe('llms-txt-generator module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/llms-txt-generator.js');
    expect(mod).toBeDefined();
  });
});
