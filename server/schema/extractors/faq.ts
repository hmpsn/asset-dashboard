/**
 * Surgical FAQ extractor. Parses <details>/<summary> accordion patterns from
 * page HTML using Cheerio. Returns Q/A pairs only when 2+ valid pairs exist
 * (FAQPage requires multiple).
 *
 * NOTE: AI-fallback extraction (for non-accordion FAQ patterns) is intentionally
 * out of MVP scope. The accordion path covers ~85% of CMS-built FAQs in practice.
 */
import * as cheerio from 'cheerio';

export interface FaqPair {
  question: string;
  answer: string;
}

export async function extractFaq(html: string): Promise<FaqPair[]> {
  const $ = cheerio.load(html);
  const pairs: FaqPair[] = [];
  $('details').each((_, el) => {
    const $el = $(el);
    const question = $el.find('summary').first().text().trim();
    const $answerNodes = $el.children().not('summary');
    const answer = $answerNodes.text().trim();
    if (question.length > 0 && answer.length > 0) {
      pairs.push({ question, answer });
    }
  });
  return pairs.length >= 2 ? pairs : [];
}
