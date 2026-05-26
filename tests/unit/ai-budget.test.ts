import { describe, expect, it } from 'vitest';

describe('ai-budget module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/ai-budget.js');
    expect(mod).toBeDefined();
  });
});
