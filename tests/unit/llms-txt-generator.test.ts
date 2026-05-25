import { afterEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_BOT_UA } from '../../server/constants.js';
import {
  buildLlmsFullTxt,
  buildLlmsTxtIndex,
  validateUrls,
} from '../../server/llms-txt-generator.js';

describe('llms-txt-generator format and URL behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validateUrls issues HEAD requests with redirect-follow and studio user-agent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    await validateUrls(['https://example.com/a']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': STUDIO_BOT_UA },
      }),
    );
  });

  it('validateUrls enforces batch concurrency and keeps only valid URLs in input order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      const url = String(input);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      if (url.endsWith('/bad')) return new Response('', { status: 404 });
      return new Response('', { status: 200 });
    });

    const urls = [
      'https://example.com/a',
      'https://example.com/bad',
      'https://example.com/c',
      'https://example.com/d',
      'https://example.com/e',
    ];

    const result = await validateUrls(urls, 2);

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(result).toEqual([
      'https://example.com/a',
      'https://example.com/c',
      'https://example.com/d',
      'https://example.com/e',
    ]);
  });

  it('validateUrls tolerates thrown fetch errors and returns surviving URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/throw')) throw new Error('network down');
      if (url.endsWith('/forbidden')) return new Response('', { status: 403 });
      return new Response('', { status: 200 });
    });

    const result = await validateUrls([
      'https://example.com/ok-1',
      'https://example.com/throw',
      'https://example.com/forbidden',
      'https://example.com/ok-2',
    ]);

    expect(result).toEqual(['https://example.com/ok-1', 'https://example.com/ok-2']);
  });

  it('buildLlmsTxtIndex normalizes planned links to root-relative when baseUrl is empty', () => {
    const output = buildLlmsTxtIndex({
      siteName: 'Site',
      baseUrl: '',
      pages: [
        { path: '/about', title: 'About' },
      ],
      plannedPages: [
        { url: 'roadmap', keyword: 'Roadmap', status: 'unknown_status' },
      ],
    });

    expect(output).toContain('[About](/about)');
    expect(output).toContain('[Roadmap](/roadmap) — Planned');
  });

  it('buildLlmsFullTxt prefers summary, falls back to description, then fallback marker', () => {
    const output = buildLlmsFullTxt({
      siteName: 'Site',
      baseUrl: 'https://example.com',
      pages: [
        { path: '/one', title: 'One', summary: 'Summary wins', description: 'Ignored description' },
        { path: '/two', title: 'Two', summary: '', description: 'Description fallback' },
        { path: '/three', title: 'Three' },
      ],
    });

    expect(output).toContain('### [One](https://example.com/one)');
    expect(output).toContain('Summary wins');
    expect(output).not.toContain('Ignored description');

    expect(output).toContain('### [Two](https://example.com/two)');
    expect(output).toContain('Description fallback');

    expect(output).toContain('### [Three](https://example.com/three)');
    expect(output).toContain('*No summary available.*');
  });
});
