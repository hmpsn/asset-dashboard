import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { extractLists } from '../../server/schema/extractors/page-elements/howto.js';

describe('extractLists (HowTo behavior)', () => {
  it('flags ordered lists as HowTo-like when heading heuristics match and step count is >= 3', () => {
    const $ = cheerio.load(`
      <article>
        <h2>How to Prepare for Your First Visit</h2>
        <ol>
          <li>Complete your intake forms online.</li>
          <li>Bring your insurance card and photo ID.</li>
          <li>Arrive 15 minutes early for check-in.</li>
        </ol>
      </article>
    `);

    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].kind).toBe('ordered');
    expect(lists[0].itemCount).toBe(3);
    expect(lists[0].isHowToLike).toBe(true);
    expect(lists[0].steps).toHaveLength(3);
    expect(lists[0].steps?.map(step => step.position)).toEqual([1, 2, 3]);
  });

  it('does not flag ordered lists with fewer than 3 items even when heading says "How to"', () => {
    const $ = cheerio.load(`
      <article>
        <h2>How to Reset Your Password</h2>
        <ol>
          <li>Open account settings.</li>
          <li>Choose a new password.</li>
        </ol>
      </article>
    `);

    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].kind).toBe('ordered');
    expect(lists[0].itemCount).toBe(2);
    expect(lists[0].isHowToLike).toBe(false);
    expect(lists[0].steps).toBeUndefined();
  });

  it('keeps non-howto lists false when heading heuristics are absent', () => {
    const $ = cheerio.load(`
      <article>
        <h2>Top Reasons Patients Choose Our Clinic</h2>
        <ol>
          <li>Convenient scheduling.</li>
          <li>Experienced clinicians.</li>
          <li>Transparent pricing.</li>
        </ol>
      </article>
    `);

    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].kind).toBe('ordered');
    expect(lists[0].itemCount).toBe(3);
    expect(lists[0].isHowToLike).toBe(false);
    expect(lists[0].steps).toBeUndefined();
  });
});
