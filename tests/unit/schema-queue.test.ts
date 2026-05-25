import { describe, expect, it } from 'vitest';

describe('schema-queue module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema-queue.js');
    expect(mod).toBeDefined();
  });
});
