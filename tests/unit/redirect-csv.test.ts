import { describe, expect, it } from 'vitest';
import { serializeRedirectRulesCsv } from '../../src/lib/redirectCsv';

describe('serializeRedirectRulesCsv', () => {
  it('serializes Webflow redirect import rows with escaped cells', () => {
    const csv = serializeRedirectRulesCsv([
      { from: '/old-page', to: '/new-page' },
      { from: '/old, comma', to: '/new "quoted" page' },
    ]);

    expect(csv).toBe([
      'Old Path,New Path',
      '/old-page,/new-page',
      '"/old, comma","/new ""quoted"" page"',
    ].join('\n'));
  });
});
