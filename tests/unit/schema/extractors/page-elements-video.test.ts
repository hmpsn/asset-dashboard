import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractVideos } from '../../../../server/schema/extractors/page-elements/video.js';

function fixture(name: string): cheerio.CheerioAPI {
  const html = readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
  return cheerio.load(html);
}

describe('extractVideos', () => {
  it('extracts a YouTube embed with provider, embedUrl, thumbnailUrl, and title', () => {
    const $ = fixture('webflow-blog-with-youtube.html');
    const videos = extractVideos($);
    expect(videos).toHaveLength(1);
    expect(videos[0].provider).toBe('youtube');
    expect(videos[0].embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0');
    expect(videos[0].thumbnailUrl).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    expect(videos[0].title).toBe('Web Vitals 101');
  });

  it('extracts a Vimeo embed with provider and embedUrl', () => {
    const $ = fixture('webflow-blog-with-vimeo.html');
    const videos = extractVideos($);
    expect(videos).toHaveLength(1);
    expect(videos[0].provider).toBe('vimeo');
    expect(videos[0].embedUrl).toBe('https://player.vimeo.com/video/123456789?h=abc123def');
    expect(videos[0].title).toBe('Studio Tour');
  });

  it('extracts a native <video> tag', () => {
    const $ = cheerio.load(`
      <article>
        <video src="https://example.com/intro.mp4" poster="https://example.com/intro.jpg" controls></video>
      </article>
    `);
    const videos = extractVideos($);
    expect(videos).toHaveLength(1);
    expect(videos[0].provider).toBe('native');
    expect(videos[0].embedUrl).toBe('https://example.com/intro.mp4');
    expect(videos[0].thumbnailUrl).toBe('https://example.com/intro.jpg');
  });

  it('returns empty array when no videos present', () => {
    const $ = cheerio.load('<article><p>Just text, no media.</p></article>');
    expect(extractVideos($)).toEqual([]);
  });

  it('skips iframes from unknown providers (provider=other not pushed)', () => {
    const $ = cheerio.load(`
      <article>
        <iframe src="https://www.example.com/embed/abc" title="Generic"></iframe>
      </article>
    `);
    const videos = extractVideos($);
    expect(videos).toHaveLength(0);
  });
});
