import { describe, expect, it } from 'vitest';

describe('platform-observability module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/platform-observability.js');
    expect(mod).toBeDefined();
  });
});
