/**
 * Testimonial element extractor.
 *
 * Sources:
 *   - <blockquote> with optional <cite> child for author attribution
 *   - Numeric ratings from data-rating attribute (1-5 only — out-of-range
 *     values are dropped to avoid hallucinated AggregateRating)
 *   - Numeric ratings from sibling .rating[aria-label="N out of M"] (Webflow
 *     pattern; common ARIA accessibility label)
 *
 * Scoped to <article> with whole-document fallback. Skips quotes shorter
 * than 10 characters (boilerplate like ".." or "Quote:").
 */
import type * as cheerio from 'cheerio';
import type { Testimonial } from '../../../../shared/types/page-elements.js';

const MIN_QUOTE_LENGTH = 10;
const ARIA_RATING_RE = /(\d+(?:\.\d+)?)\s*(?:out of|\/)\s*\d+\s*stars?/i;

function parseRating(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < 1 || n > 5) return undefined;
  return n;
}

function cleanAuthor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Strip leading "—" / "-" / "by " and surrounding whitespace
  return raw
    .replace(/^[\s—–\-—–]+/, '')
    .replace(/^by\s+/i, '')
    .trim() || undefined;
}

export function extractTestimonials($: cheerio.CheerioAPI): Testimonial[] {
  const $scope = $('article').length > 0 ? $('article blockquote') : $('blockquote');
  const testimonials: Testimonial[] = [];

  $scope.each((_, el) => {
    const $bq = $(el);

    // Quote text — strip <cite> children to get the actual quote
    const $clone = $bq.clone();
    $clone.find('cite').remove();
    const quote = $clone.text().trim().replace(/\s+/g, ' ');
    if (quote.length < MIN_QUOTE_LENGTH) return;

    // Author — <cite> child
    const author = cleanAuthor($bq.find('cite').first().text());

    // Rating — data-rating attribute (preferred), else sibling .rating[aria-label]
    let rating = parseRating($bq.attr('data-rating'));
    if (rating === undefined) {
      const $parent = $bq.parent();
      const $ratingEl = $parent.find('[aria-label]').first();
      const ariaMatch = $ratingEl.attr('aria-label')?.match(ARIA_RATING_RE);
      if (ariaMatch) {
        rating = parseRating(ariaMatch[1]);
      }
    }

    // Selector — useful for diagnostic debugging
    const tagName = (el as { tagName?: string }).tagName ?? 'blockquote';
    const id = $bq.attr('id');
    const cls = $bq.attr('class')?.split(/\s+/)[0];
    const selector = id ? `${tagName}#${id}` : cls ? `${tagName}.${cls}` : tagName;

    testimonials.push({ quote, author, rating, selector });
  });

  return testimonials;
}
