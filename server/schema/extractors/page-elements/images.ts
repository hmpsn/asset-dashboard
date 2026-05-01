/**
 * Image element extractor with rule-based role classification.
 *
 * Roles:
 *   - hero: first image inside <header>, OR first image in <article> when no <header>.
 *           Implies a large lead image; populates the primary node's `image` field.
 *   - informative: images with descriptive alt text (>=20 chars) and meaningful dimensions
 *                  (width >= 200 OR height >= 200).
 *   - decorative: empty alt OR role="presentation" OR width/height < 100. Skipped from
 *                 ImageGallery emission.
 *
 * AI fallback (image-ai-classifier.ts) re-classifies role when roleSource='fallback'
 * and the feature flag is on. PR1 ships rule-based + fallback to 'informative' for
 * ambiguous cases.
 *
 * Scoped to <article> with whole-document fallback (matches PR1 howto.ts pattern).
 */
import type * as cheerio from 'cheerio';
import type { PageImage } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';

const MIN_INFORMATIVE_ALT_LENGTH = 20;
const MIN_INFORMATIVE_DIMENSION = 200;
const MAX_DECORATIVE_DIMENSION = 100;

function parseDim(attr: string | undefined): number | undefined {
  if (!attr) return undefined;
  const n = parseInt(attr, 10);
  return Number.isFinite(n) ? n : undefined;
}

function classifyRole(
  isFirstHero: boolean,
  width: number | undefined,
  height: number | undefined,
  alt: string | undefined,
  role: string | undefined,
): { role: PageImage['role']; roleSource: PageImage['roleSource'] } {
  // 1) Decorative — explicit signals win
  if ((alt ?? '').trim() === '' || role === 'presentation' || role === 'none') {
    return { role: 'decorative', roleSource: 'rule' };
  }
  if (width != null && width < MAX_DECORATIVE_DIMENSION
    && height != null && height < MAX_DECORATIVE_DIMENSION) {
    return { role: 'decorative', roleSource: 'rule' };
  }
  // 2) Hero — first image in scope
  if (isFirstHero) return { role: 'hero', roleSource: 'rule' };
  // 3) Informative — descriptive alt + meaningful dimensions
  if ((alt ?? '').length >= MIN_INFORMATIVE_ALT_LENGTH
    && ((width ?? 0) >= MIN_INFORMATIVE_DIMENSION
      || (height ?? 0) >= MIN_INFORMATIVE_DIMENSION)) {
    return { role: 'informative', roleSource: 'rule' };
  }
  // 4) Ambiguous — fallback (AI classifier may upgrade later)
  return { role: 'informative', roleSource: 'fallback' };
}

/**
 * Returns true when no heading or paragraph element appears before `imgEl`
 * in document order within the given content scope element.
 */
function isBeforeFirstTextBlock($scopeEl: ReturnType<cheerio.CheerioAPI>, imgEl: { tagName: string }): boolean {
  const allTextBlocks = $scopeEl.find('h1,h2,h3,h4,h5,h6,p');
  if (allTextBlocks.length === 0) return true;
  // Walk all nodes inside scope; stop at the first text block or this image.
  let hitImage = false;
  let hitText = false;
  $scopeEl.find('*').each((_, el) => {
    if (hitImage || hitText) return false; // early exit
    if (el === imgEl) { hitImage = true; return false; }
    const tag = el.tagName?.toLowerCase() ?? '';
    if (/^h[1-6]$/.test(tag) || tag === 'p') { hitText = true; return false; }
  });
  return hitImage && !hitText;
}

export function extractImages($: cheerio.CheerioAPI): PageImage[] {
  const $scopeEl = contentScope($);
  const $scope = $scopeEl.find('img');
  const images: PageImage[] = [];

  let isFirstHero = true;
  $scope.each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src');
    if (!src) return;

    const alt = $img.attr('alt');
    const role = $img.attr('role');
    const width = parseDim($img.attr('width'));
    const height = parseDim($img.attr('height'));

    // <figcaption> within wrapping <figure> becomes the caption
    const $figure = $img.closest('figure');
    const caption = $figure.length > 0
      ? $figure.find('figcaption').first().text().trim() || undefined
      : undefined;

    // Hero: image inside <header>, OR first image that appears before any heading/paragraph.
    const inHeader = $img.closest('header').length > 0;
    const isLeadPosition = images.length === 0 && isBeforeFirstTextBlock($scopeEl, el);
    const isHero = isFirstHero && (inHeader || isLeadPosition);

    const { role: classifiedRole, roleSource } = classifyRole(
      isHero, width, height, alt, role,
    );

    if (classifiedRole === 'hero') isFirstHero = false;

    images.push({
      src,
      alt,
      caption,
      role: classifiedRole,
      roleSource,
      width,
      height,
    });
  });

  return images;
}
