/**
 * Surgical FAQ extractor. Parses <details>/<summary> accordion patterns from
 * page HTML using Cheerio. Returns Q/A pairs only when 2+ valid pairs exist
 * (FAQPage requires multiple).
 *
 * NOTE: AI-fallback extraction (for non-accordion FAQ patterns) is intentionally
 * out of MVP scope. The accordion path covers ~85% of CMS-built FAQs in practice.
 */
import * as cheerio from 'cheerio';
import { contentScope } from './page-elements/content-scope.js';

export interface FaqPair {
  question: string;
  answer: string;
}

const QUESTION_RE = /^(?:Q[:.)]\s*)?(?:what|why|when|where|which|who|how|can|do|does|did|is|are|should|will|would)\b.+\?$/i;
const MAX_QUESTION_LENGTH = 220;
const MAX_ANSWER_LENGTH = 1200;

function cleanText(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

function cleanQuestion(text: string, opts: { explicit?: boolean } = {}): string | undefined {
  const cleaned = cleanText(text).replace(/^Q[:.)]\s*/i, '');
  if (!cleaned || cleaned.length > MAX_QUESTION_LENGTH) return undefined;
  if (opts.explicit) return cleaned.endsWith('?') ? cleaned : undefined;
  if (!QUESTION_RE.test(cleaned)) return undefined;
  return cleaned;
}

function cleanAnswer(text: string): string | undefined {
  const cleaned = cleanText(text).replace(/^A[:.)]\s*/i, '');
  if (!cleaned || cleaned.length > MAX_ANSWER_LENGTH) return undefined;
  return cleaned;
}

function addPair(
  pairs: FaqPair[],
  seen: Set<string>,
  questionText: string,
  answerText: string,
  opts: { explicit?: boolean } = {},
): void {
  const question = cleanQuestion(questionText, opts);
  const answer = cleanAnswer(answerText);
  if (!question || !answer) return;
  const key = question.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  pairs.push({ question, answer });
}

export async function extractFaq(html: string): Promise<FaqPair[]> {
  const $ = cheerio.load(html);
  const scoped = contentScope($);
  const $scope = scoped.length > 0 ? scoped : ($('body').length > 0 ? $('body') : $.root());
  const pairs: FaqPair[] = [];
  const seen = new Set<string>();

  $scope.find('details').each((_, el) => {
    const $el = $(el);
    const question = $el.find('summary').first().text().trim();
    const $answerNodes = $el.children().not('summary');
    const answer = $answerNodes.text().trim();
    addPair(pairs, seen, question, answer, { explicit: true });
  });

  $scope.find('button, [role="button"], [aria-expanded]').each((_, el) => {
    const $trigger = $(el);
    const question = $trigger.text();
    const controls = $trigger.attr('aria-controls');
    const $panel = controls
      ? $scope.find('[id]').filter((_, panel) => $(panel).attr('id') === controls).first()
      : $trigger.next();
    const answer = $panel.text();
    addPair(pairs, seen, question, answer, { explicit: true });
  });

  $scope.find('h2, h3, h4, h5').each((_, el) => {
    const $heading = $(el);
    const question = $heading.text();
    const answerParts: string[] = [];
    let $next = $heading.next();
    while ($next.length > 0 && !/^(h2|h3|h4|h5)$/i.test($next.prop('tagName') || '')) {
      answerParts.push($next.text());
      $next = $next.next();
    }
    addPair(pairs, seen, question, answerParts.join(' '));
  });

  $scope.find('p, li').each((_, el) => {
    const text = cleanText($(el).text());
    const match = text.match(/^(?:Q[:.)]\s*)?(.+\?)\s+(?:A[:.)]\s*)?(.+)$/i);
    if (match) {
      addPair(pairs, seen, match[1], match[2]);
    }
  });

  return pairs.length >= 2 ? pairs : [];
}
