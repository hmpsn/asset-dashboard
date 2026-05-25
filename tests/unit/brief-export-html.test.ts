import { describe, expect, it } from 'vitest';

describe('brief-export-html module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/brief-export-html.js');
    expect(mod).toBeDefined();
  });
});
