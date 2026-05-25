import { describe, expect, it } from 'vitest';

describe('sales-report-html module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/sales-report-html.js');
    expect(mod).toBeDefined();
  });
});
