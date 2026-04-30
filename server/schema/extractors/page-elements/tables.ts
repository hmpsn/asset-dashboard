/**
 * Table element extractor with pricing + comparison heuristics.
 *
 * Heuristics:
 *   - isPricingLike: ≥2 cells contain a currency-prefixed number ($, €, £, ¥, ₹).
 *   - isComparisonLike: ≥3 columns + header row (<thead> or first row of <th>) + ≥2 data rows.
 *
 * Both flags can be true simultaneously (a 4-column pricing tier table is
 * both pricing-like AND comparison-like).
 *
 * Scoped to <article> with whole-document fallback. Skips zero-row tables.
 */
import type * as cheerio from 'cheerio';
import type { Table } from '../../../../shared/types/page-elements.js';

const CURRENCY_RE = /(?:\$|€|£|¥|₹)\s?\d/;
const MIN_PRICING_HITS = 2;
const MIN_COMPARISON_COLS = 3;
const MIN_COMPARISON_DATA_ROWS = 2;

export function extractTables($: cheerio.CheerioAPI): Table[] {
  // Scope: <article> first; fall back to whole document.
  const $scope = $('article').length > 0 ? $('article table') : $('table');
  const tables: Table[] = [];

  $scope.each((_, el) => {
    const $table = $(el);
    const $rows = $table.find('tr');
    const rowCount = $rows.length;
    if (rowCount === 0) return;

    // colCount: max cells across all rows (handles colspan-less tables; colspan is rare).
    let colCount = 0;
    $rows.each((__, row) => {
      const cells = $(row).children('td, th').length;
      if (cells > colCount) colCount = cells;
    });

    // caption — <caption> child if present
    const captionText = $table.children('caption').first().text().trim() || undefined;

    // Pricing heuristic: count cells with currency-prefixed numbers
    let pricingHits = 0;
    $table.find('td, th').each((__, cell) => {
      const text = $(cell).text();
      if (CURRENCY_RE.test(text)) pricingHits++;
    });
    const isPricingLike = pricingHits >= MIN_PRICING_HITS;

    // Comparison heuristic: ≥3 cols + has header row + ≥2 data rows
    const hasHeader = $table.find('thead').length > 0
      || $rows.first().children('th').length >= MIN_COMPARISON_COLS;
    const dataRowCount = rowCount - (hasHeader ? 1 : 0);
    const isComparisonLike = colCount >= MIN_COMPARISON_COLS
      && hasHeader
      && dataRowCount >= MIN_COMPARISON_DATA_ROWS;

    tables.push({
      rowCount,
      colCount,
      caption: captionText,
      isPricingLike,
      isComparisonLike,
    });
  });

  return tables;
}
