import { describe, expect, it } from 'vitest';

describe('ai-context-check module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/ai-context-check.js');
    expect(mod).toBeDefined();
  });
});
