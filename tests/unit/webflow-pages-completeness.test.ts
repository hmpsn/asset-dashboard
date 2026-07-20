import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPagesWithCompleteness } from '../../server/webflow-pages.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Webflow page census completeness metadata', () => {
  it('returns only safe provider classification and HTTP status on an API failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'private provider response body with secret details',
      { status: 503 },
    )));

    const result = await listPagesWithCompleteness('site_safe_failure', 'token_safe_failure');

    expect(result).toEqual({
      pages: [],
      complete: false,
      failure: { code: 'provider_error', httpStatus: 503 },
    });
    expect(JSON.stringify(result)).not.toContain('private provider');
    expect(JSON.stringify(result)).not.toContain('secret details');
  });

  it('classifies the advertised total before retaining pages beyond maxPages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pages: [{ id: 'page-home', title: 'Home', slug: 'home' }],
      pagination: { total: 11 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const result = await listPagesWithCompleteness(
      'site_page_limit',
      'token_page_limit',
      { maxPages: 10 },
    );

    expect(result).toEqual({
      pages: [],
      complete: false,
      failure: { code: 'limit_exceeded', actual: 11, limit: 10 },
    });
  });
});
