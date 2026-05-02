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

  it('keeps full HowTo step text but shortens verbose names', () => {
    const $ = cheerio.load(`
      <article>
        <h1>How to complete treatment</h1>
        <ol>
          <li>Initial Consultation: The journey begins with an initial consultation where your dentist evaluates your teeth and goals.</li>
          <li>3D Scanning: A digital scan creates a precise model for your treatment plan.</li>
          <li>Retainers for Life: Retainers help maintain alignment after treatment is complete.</li>
        </ol>
      </article>
    `);
    const steps = extractLists($)[0].steps!;
    expect(steps[0].name).toBe('Initial Consultation');
    expect(steps[0].text).toContain('The journey begins with an initial consultation');
  });

  it('requires at least 3 items to flag as HowTo (2-item ol is too thin per Google guidelines)', () => {
    const $ = cheerio.load(`
      <article>
        <h1>How to fix it</h1>
        <ol><li>Restart.</li><li>Done.</li></ol>
      </article>
    `);
    expect(extractLists($)[0].isHowToLike).toBe(false);
  });

  it('does NOT flag a list under "Pricing guide" — \\bguide\\b removed from heuristic to prevent landing-page false positives', () => {
    const $ = cheerio.load(`
      <article>
        <h2>Pricing guide</h2>
        <ol>
          <li>Free tier — $0/mo</li>
          <li>Growth tier — $49/mo</li>
          <li>Premium tier — $149/mo</li>
        </ol>
      </article>
    `);
    const lists = extractLists($);
    expect(lists[0].isHowToLike).toBe(false);
  });

  it('does NOT flag lists in <nav> or <footer> when an <article> is present (scope guard)', () => {
    const $ = cheerio.load(`
      <body>
        <nav>
          <ol>
            <li>Home</li>
            <li>About</li>
            <li>Contact</li>
          </ol>
        </nav>
        <article>
          <h1>How to deploy</h1>
          <ol>
            <li>Step 1: Connect domain.</li>
            <li>Step 2: Configure DNS.</li>
            <li>Step 3: Publish.</li>
          </ol>
        </article>
        <footer>
          <ol>
            <li>Privacy</li>
            <li>Terms</li>
            <li>Contact</li>
          </ol>
        </footer>
      </body>
    `);
    const lists = extractLists($);
    // Only the article-scoped <ol> should be returned (nav + footer excluded).
    expect(lists).toHaveLength(1);
    expect(lists[0].itemCount).toBe(3);
    expect(lists[0].isHowToLike).toBe(true);
  });

  it('falls back to whole-document scope when no <article> tag is present', () => {
    const $ = cheerio.load(`
      <body>
        <main>
          <h1>How to migrate</h1>
          <ol>
            <li>Backup existing data.</li>
            <li>Import to new system.</li>
            <li>Verify integrity.</li>
          </ol>
        </main>
      </body>
    `);
    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].isHowToLike).toBe(true);
  });
});
