/**
 * List + HowTo detection. Pattern-first (no AI in PR1):
 *   - Ordered list (<ol>)
 *   - At least 2 items
 *   - Either: page <h1> contains "how to" / "guide" / "steps"
 *     OR a previous-sibling heading (h2-h4) contains the same
 *
 * AI-fallback for ambiguous cases is deferred to PR2 (callAI for
 * disambiguation per audit §2.3 conventions).
 */
import type * as cheerio from 'cheerio';
import type { PageList, HowToStep } from '../../../../shared/types/page-elements.js';

const HOWTO_RE = /\b(how\s+to|steps?|guide|tutorial|walkthrough)\b/i;

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

  $('ol, ul').each((_, el) => {
    const $list = $(el);
    const kind = el.tagName === 'ol' ? 'ordered' : 'unordered';
    const items = $list.children('li').toArray();
    const itemCount = items.length;

    let isHowToLike = false;
    let steps: HowToStep[] | undefined;

    // HowTo only applies to ordered lists with 2+ items
    if (kind === 'ordered' && itemCount >= 2) {
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
