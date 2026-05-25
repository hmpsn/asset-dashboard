import { describe, expect, it } from 'vitest';

describe('article module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/templates/article.js');
    expect(mod).toBeDefined();
  });
});
