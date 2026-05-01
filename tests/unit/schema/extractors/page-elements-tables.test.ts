import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractTables } from '../../../../server/schema/extractors/page-elements/tables.js';

describe('extractTables', () => {
  it('extracts a basic 3x3 table with row/col counts', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>A</th><th>B</th><th>C</th></tr>
          <tr><td>1</td><td>2</td><td>3</td></tr>
          <tr><td>4</td><td>5</td><td>6</td></tr>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables).toHaveLength(1);
    expect(tables[0].rowCount).toBe(3);
    expect(tables[0].colCount).toBe(3);
    expect(tables[0].isPricingLike).toBe(false);
    expect(tables[0].isComparisonLike).toBe(true); // 3+ cols, repeated header structure
  });

  it('flags isPricingLike when cells contain currency symbols + per-month patterns', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <thead><tr><th>Plan</th><th>Price</th></tr></thead>
          <tbody>
            <tr><td>Starter</td><td>$29/mo</td></tr>
            <tr><td>Growth</td><td>$99/mo</td></tr>
            <tr><td>Premium</td><td>$249/mo</td></tr>
          </tbody>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables[0].isPricingLike).toBe(true);
  });

  it('flags isPricingLike with European € prices', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>Plan</th><th>Price</th></tr>
          <tr><td>Free</td><td>€0</td></tr>
          <tr><td>Pro</td><td>€19/month</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].isPricingLike).toBe(true);
  });

  it('does NOT flag isPricingLike for tables with arbitrary numbers (no currency)', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>Year</th><th>Revenue</th></tr>
          <tr><td>2020</td><td>1000</td></tr>
          <tr><td>2021</td><td>2000</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].isPricingLike).toBe(false);
  });

  it('flags isComparisonLike when 3+ cols with header row + 2+ data rows', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <thead><tr><th>Feature</th><th>Free</th><th>Pro</th><th>Enterprise</th></tr></thead>
          <tbody>
            <tr><td>Pages</td><td>10</td><td>100</td><td>Unlimited</td></tr>
            <tr><td>Users</td><td>1</td><td>5</td><td>50</td></tr>
          </tbody>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables[0].isComparisonLike).toBe(true);
  });

  it('does NOT flag isComparisonLike when only 2 cols', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>Key</th><th>Value</th></tr>
          <tr><td>A</td><td>1</td></tr>
          <tr><td>B</td><td>2</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].isComparisonLike).toBe(false);
  });

  it('extracts caption when <caption> is present', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <caption>Pricing tiers</caption>
          <tr><th>Plan</th><th>Price</th></tr>
          <tr><td>Free</td><td>$0</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].caption).toBe('Pricing tiers');
  });

  it('falls back to whole-document scope when no <article> tag', () => {
    const $ = cheerio.load(`
      <main>
        <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
      </main>
    `);
    expect(extractTables($)).toHaveLength(1);
  });

  it('skips empty tables (no rows)', () => {
    const $ = cheerio.load('<article><table></table></article>');
    expect(extractTables($)).toEqual([]);
  });

  it('handles tables with thead/tbody/tfoot correctly (counts all data rows)', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <thead><tr><th>A</th><th>B</th></tr></thead>
          <tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody>
          <tfoot><tr><td>Total</td><td>10</td></tr></tfoot>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables[0].rowCount).toBe(4); // 1 header + 2 body + 1 footer
    expect(tables[0].colCount).toBe(2);
  });

  it('returns empty array when no tables', () => {
    const $ = cheerio.load('<article><p>Just text.</p></article>');
    expect(extractTables($)).toEqual([]);
  });
});
