import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLlmsFullTxt, buildLlmsTxtIndex, validateUrls } from '../../server/llms-txt-generator.js';

describe('llms-txt-generator helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:34:56.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds llms.txt index with root-first section ordering and planned content labels', () => {
    const text = buildLlmsTxtIndex({
      siteName: 'Acme Dental',
      baseUrl: 'https://example.com',
      description: 'Trusted family dental care.',
      pages: [
        { path: '/blog/root-canal', title: 'Root Canal Guide', description: 'What to expect.' },
        { path: '/', title: 'Home', description: 'Main landing page.' },
        { path: '/about', title: 'About Us', description: 'Meet the team.' },
      ],
      plannedPages: [
        { url: '/services/emergency-dentistry', keyword: 'Emergency Dentistry', status: 'review' },
        { url: 'services/teeth-contouring', keyword: 'Teeth Contouring', status: 'unknown_status' },
      ],
    });

    expect(text).toContain('# Acme Dental');
    expect(text).toContain('> Trusted family dental care.');
    expect(text).toContain('- Generated: 2026-05-25T12:34:56.000Z');

    const mainPagesIdx = text.indexOf('## Main Pages');
    const blogIdx = text.indexOf('## Blog');
    expect(mainPagesIdx).toBeGreaterThan(-1);
    expect(blogIdx).toBeGreaterThan(-1);
    expect(mainPagesIdx).toBeLessThan(blogIdx);

    expect(text).toContain('- [Home](https://example.com/)');
    expect(text).toContain('- [About Us](https://example.com/about): Meet the team.');
    expect(text).toContain('- [Root Canal Guide](https://example.com/blog/root-canal): What to expect.');

    expect(text).toContain('## Upcoming Content');
    expect(text).toContain('- [Emergency Dentistry](https://example.com/services/emergency-dentistry) — In Review');
    expect(text).toContain('- [Teeth Contouring](https://example.com/services/teeth-contouring) — Planned');
  });

  it('builds llms-full.txt using summary -> description -> placeholder fallback order', () => {
    const full = buildLlmsFullTxt({
      siteName: 'Acme Dental',
      baseUrl: 'https://example.com',
      pages: [
        {
          path: '/services/veneers',
          title: 'Veneers',
          summary: 'Custom veneer treatment and smile design.',
          description: 'Description should be ignored when summary exists.',
        },
        {
          path: '/services/implants',
          title: 'Implants',
          description: 'Dental implant treatment overview.',
        },
        {
          path: '/services/whitening',
          title: 'Whitening',
        },
      ],
    });

    expect(full).toContain('### [Veneers](https://example.com/services/veneers)');
    expect(full).toContain('Custom veneer treatment and smile design.');
    expect(full).not.toContain('Description should be ignored when summary exists.');

    expect(full).toContain('### [Implants](https://example.com/services/implants)');
    expect(full).toContain('Dental implant treatment overview.');

    expect(full).toContain('### [Whitening](https://example.com/services/whitening)');
    expect(full).toContain('*No summary available.*');
  });

  it('validateUrls returns only successful HTTP HEAD URLs and ignores failures', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('ok-1')) return { ok: true };
      if (url.includes('ok-2')) return { ok: true };
      if (url.includes('bad-status')) return { ok: false };
      throw new Error('network down');
    });

    vi.stubGlobal('fetch', fetchMock);

    const urls = [
      'https://example.com/ok-1',
      'https://example.com/bad-status',
      'https://example.com/network-failure',
      'https://example.com/ok-2',
    ];

    const valid = await validateUrls(urls, 2);

    expect(valid).toEqual([
      'https://example.com/ok-1',
      'https://example.com/ok-2',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/ok-1',
      expect.objectContaining({ method: 'HEAD', redirect: 'follow' }),
    );
  });
});
