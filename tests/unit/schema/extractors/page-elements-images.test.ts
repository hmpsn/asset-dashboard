import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractImages } from '../../../../server/schema/extractors/page-elements/images.js';

describe('extractImages — rule-based role classification', () => {
  it('classifies a hero image (large, in <header> or first <img> in <article>)', () => {
    const $ = cheerio.load(`
      <article>
        <header>
          <img src="https://cdn.example.com/hero.jpg" alt="Hero shot" width="1200" height="600">
        </header>
        <p>Body content with no other images.</p>
      </article>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(1);
    expect(images[0].role).toBe('hero');
    expect(images[0].roleSource).toBe('rule');
    expect(images[0].src).toBe('https://cdn.example.com/hero.jpg');
    expect(images[0].alt).toBe('Hero shot');
    expect(images[0].width).toBe(1200);
    expect(images[0].height).toBe(600);
  });

  it('classifies images with descriptive alt text as informative', () => {
    const $ = cheerio.load(`
      <article>
        <h1>Article</h1>
        <img src="/diagram.png" alt="System architecture diagram showing data flow between layers" width="800" height="400">
      </article>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(1);
    expect(images[0].role).toBe('informative');
  });

  it('classifies images with empty alt + role="presentation" as decorative', () => {
    const $ = cheerio.load(`
      <article>
        <h1>X</h1>
        <p>Body.</p>
        <img src="/spacer.png" alt="" role="presentation" width="20" height="20">
      </article>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(1);
    expect(images[0].role).toBe('decorative');
  });

  it('classifies tiny images (< 100px) as decorative regardless of alt', () => {
    const $ = cheerio.load(`
      <article>
        <h1>X</h1>
        <img src="/icon.svg" alt="Logo icon" width="24" height="24">
      </article>
    `);
    const images = extractImages($);
    expect(images[0].role).toBe('decorative');
  });

  it('falls back to whole-document scope when no <article> tag', () => {
    const $ = cheerio.load(`
      <main>
        <header><img src="/hero.jpg" alt="Hero" width="1200" height="600"></header>
        <p>Body.</p>
        <img src="/diagram.jpg" alt="Diagram" width="800" height="400">
      </main>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(2);
    expect(images[0].role).toBe('hero');
    expect(images[1].role).toBe('informative');
  });

  it('skips images with no src', () => {
    const $ = cheerio.load('<article><img alt="missing"></article>');
    expect(extractImages($)).toEqual([]);
  });

  it('extracts width/height from attribute values, not styles', () => {
    const $ = cheerio.load(`
      <article>
        <img src="/x.jpg" alt="X" width="500" height="300" style="width:50%;">
      </article>
    `);
    expect(extractImages($)[0].width).toBe(500);
    expect(extractImages($)[0].height).toBe(300);
  });

  it('first <img> in article without explicit <header> is also classified hero', () => {
    const $ = cheerio.load(`
      <article>
        <img src="/lead.jpg" alt="Lead photo" width="1200" height="800">
        <p>Body.</p>
        <img src="/diagram.png" alt="A descriptive caption explaining the diagram contents" width="600" height="400">
      </article>
    `);
    const images = extractImages($);
    expect(images[0].role).toBe('hero');
    expect(images[1].role).toBe('informative');
  });

  it('extracts caption from <figcaption> when wrapped in <figure>', () => {
    const $ = cheerio.load(`
      <article>
        <h1>X</h1>
        <figure>
          <img src="/diagram.png" alt="Diagram" width="800" height="400">
          <figcaption>Figure 1: System overview</figcaption>
        </figure>
      </article>
    `);
    expect(extractImages($)[0].caption).toBe('Figure 1: System overview');
  });

  it('returns empty array when no images', () => {
    const $ = cheerio.load('<article><p>Just text.</p></article>');
    expect(extractImages($)).toEqual([]);
  });
});
