/**
 * List + HowTo detection. Pattern-first (no AI in PR1):
 *   - Ordered list (<ol>)
 *   - At least 3 items (Google's HowTo guidelines effectively require ≥3 steps;
 *     a 2-item ordered list is too thin to be a procedural guide)
 *   - Scoped to <article> — nav/footer/sidebar lists are excluded to keep
 *     diagnostic counts honest and avoid false positives on landing pages
 *   - Either: page <h1> matches HOWTO_RE
 *     OR a previous-sibling/section heading matches
 *
 * The regex deliberately excludes the standalone word "guide" — too many
 * landing-page sections ("Pricing guide", "Buyer's guide") would trigger
 * HowTo emission and risk Google manual actions for invalid schema.
 *
 * AI-fallback for ambiguous cases (action-verb check on item content,
 * pricing-table disambiguation) is deferred to PR2.
 */
import type * as cheerio from 'cheerio';
import type { PageList, HowToStep } from '../../../../shared/types/page-elements.js';

const HOWTO_RE = /\b(how\s+to|step-by-step|tutorial|walkthrough)\b/i;
const MIN_HOWTO_STEPS = 3;

function findNearbyHowToHeading($: cheerio.CheerioAPI, $list: ReturnType<cheerio.CheerioAPI>): boolean {
  // 1) Page <h1>
  const h1 = $('h1').first().text();
  if (HOWTO_RE.test(h1)) return true;
  // 2) Closest previous heading (h2-h4) before the list
  const $prev = $list.prevAll('h2, h3, h4').first();
  if ($prev.length > 0 && HOWTO_RE.test($prev.text())) return true;
  // 3) Nearest ancestor section's heading
  const $parentSection = $list.closest('section');
  if ($parentSection.length > 0) {
    const sectionHeading = $parentSection.find('h1, h2, h3, h4').first().text();
    if (HOWTO_RE.test(sectionHeading)) return true;
  }
  return false;
}

export function extractLists($: cheerio.CheerioAPI): PageList[] {
  const lists: PageList[] = [];

  // Scope to <article> for consistency with citation extractor — keeps
  // navigational/footer lists out of diagnostics and HowTo candidates.
  // Falls back to whole document if no <article> is present (so we still
  // capture lists on landing pages that don't use the <article> tag).
  const $scope = $('article').length > 0 ? $('article ol, article ul') : $('ol, ul');
  $scope.each((_, el) => {
    const $list = $(el);
    const kind = el.tagName === 'ol' ? 'ordered' : 'unordered';
    const items = $list.children('li').toArray();
    const itemCount = items.length;

    let isHowToLike = false;
    let steps: HowToStep[] | undefined;

    // HowTo only applies to ordered lists with MIN_HOWTO_STEPS+ items
    if (kind === 'ordered' && itemCount >= MIN_HOWTO_STEPS) {
      if (findNearbyHowToHeading($, $list)) {
        isHowToLike = true;
        steps = items.map((li, i) => {
          const text = $(li).text().trim();
          return {
            name: text,
            text,
            position: i + 1,
          };
        });
      }
    }

    lists.push({ kind, itemCount, isHowToLike, steps });
  });

  return lists;
}
