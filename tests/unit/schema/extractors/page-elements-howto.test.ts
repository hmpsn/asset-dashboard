import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractLists } from '../../../../server/schema/extractors/page-elements/howto.js';

function fixture(name: string): cheerio.CheerioAPI {
  const html = readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
  return cheerio.load(html);
}

describe('extractLists (HowTo detection)', () => {
  it('flags an ordered list as HowTo when nearby heading is "Steps" and items start with action verbs', () => {
    const $ = fixture('webflow-blog-howto.html');
    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].kind).toBe('ordered');
    expect(lists[0].itemCount).toBe(5);
    expect(lists[0].isHowToLike).toBe(true);
    expect(lists[0].steps).toHaveLength(5);
    expect(lists[0].steps![0]).toEqual({ name: 'Mix flour, water, and starter into a shaggy dough.', text: 'Mix flour, water, and starter into a shaggy dough.', position: 1 });
  });

  it('does NOT flag an ordered list when no nearby HowTo signal', () => {
    const $ = cheerio.load(`
      <article>
        <h2>Top 5 reasons we love coffee</h2>
        <ol>
          <li>It's delicious.</li>
          <li>It wakes you up.</li>
          <li>It's a ritual.</li>
        </ol>
      </article>
    `);
    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].isHowToLike).toBe(false);
    expect(lists[0].steps).toBeUndefined();
  });

  it('does NOT flag an unordered list as HowTo even if heading says "How to"', () => {
    const $ = cheerio.load(`
      <article>
        <h2>How to plan a trip</h2>
        <ul>
          <li>Pick destination</li>
          <li>Book flight</li>
          <li>Pack bags</li>
        </ul>
      </article>
    `);
    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].kind).toBe('unordered');
    expect(lists[0].isHowToLike).toBe(false);
  });

  it('returns empty array when no <ol> or <ul>', () => {
    const $ = cheerio.load('<article><p>Just paragraphs.</p></article>');
    expect(extractLists($)).toEqual([]);
  });

  it('detects HowTo when the page <h1> contains "How to" even without nearby step heading', () => {
    const $ = cheerio.load(`
      <article>
        <h1>How to deploy a Webflow site</h1>
        <p>Follow these:</p>
        <ol>
          <li>Connect your domain.</li>
          <li>Configure DNS records.</li>
          <li>Publish the site.</li>
        </ol>
      </article>
    `);
    const lists = extractLists($);
    expect(lists[0].isHowToLike).toBe(true);
    expect(lists[0].itemCount).toBe(3);
  });

  it('requires at least 2 items to flag as HowTo (single-item ol is not a how-to)', () => {
    const $ = cheerio.load(`
      <article>
        <h1>How to fix it</h1>
        <ol><li>Restart.</li></ol>
      </article>
    `);
    expect(extractLists($)[0].isHowToLike).toBe(false);
  });
});
