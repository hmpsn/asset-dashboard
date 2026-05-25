import { describe, expect, it } from 'vitest';

describe('audit-finding module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/audit-finding.js');
    expect(mod).toBeDefined();
  });
});
