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
import { contentScope } from './content-scope.js';

const HOWTO_RE = /\b(how\s+to|step-by-step|tutorial|walkthrough)\b/i;
const MIN_HOWTO_STEPS = 3;
const MAX_STEP_NAME_LENGTH = 80;

export function cleanHowToStepText(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

export function makeHowToStepName(text: string): string {
  const cleaned = cleanHowToStepText(text);
  const labelMatch = cleaned.match(/^(.{3,80}?)(?:\s+-\s+|:\s+)/);
  const candidate = labelMatch?.[1] || cleaned.match(/^([^.!?]{8,80})[.!?]\s/)?.[1] || cleaned;
  if (candidate.length <= MAX_STEP_NAME_LENGTH) return candidate;
  return `${candidate.slice(0, MAX_STEP_NAME_LENGTH - 3).trim()}...`;
}

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

  const $scope = contentScope($).find('ol, ul');
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
          const text = cleanHowToStepText($(li).text());
          return {
            name: makeHowToStepName(text),
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
