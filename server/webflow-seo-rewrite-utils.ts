/**
 * Shared helpers for Webflow SEO rewrite routes/workers.
 */

import { z } from './middleware/validate.js';

/**
 * Enforce a character limit on SEO text with smart truncation.
 * Prefers cutting at a word boundary, then sentence boundary, within the last
 * 40% of the allowed length. Falls back to a hard cut.
 */
export function enforceSeoTextLimit(text: string, maxLen: number): string {
  const t = text.replace(/^["']|["']$/g, '').trim();
  if (t.length > maxLen) {
    const truncated = t.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    const lastPeriod = truncated.lastIndexOf('.');
    const lastExclamation = truncated.lastIndexOf('!');

    let cutPoint = maxLen;
    if (lastSpace > maxLen * 0.6) cutPoint = lastSpace;
    else if (lastPeriod > maxLen * 0.6) cutPoint = lastPeriod + 1;
    else if (lastExclamation > maxLen * 0.6) cutPoint = lastExclamation + 1;

    return t.slice(0, cutPoint);
  }
  return t;
}

const seoVariationSchema = z.string().trim().min(1);
const seoPairSchema = z.object({
  title: seoVariationSchema,
  description: seoVariationSchema,
}).strip();

function uniqueSeoTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

/**
 * Normalize AI-generated title/description arrays before persistence/display.
 * Rejects prose/object fallbacks and duplicate/empty values instead of padding
 * weak output into three identical suggestions.
 */
export function normalizeSeoRewriteVariations(raw: unknown, maxLen: number, expectedCount = 3): string[] {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && 'variations' in raw && Array.isArray(raw.variations)
      ? raw.variations
      : [];
  if (!values.length) return [];
  const parsed = values
    .map((value) => {
      const result = seoVariationSchema.safeParse(value);
      return result.success ? result.data : null;
    })
    .filter((value): value is string => value !== null);
  const normalized = uniqueSeoTexts(parsed.map(value => enforceSeoTextLimit(value, maxLen)).filter(Boolean));
  return normalized.slice(0, expectedCount);
}

/**
 * Normalize paired title/description AI output. Both halves must be present and
 * non-empty for every pair, so "both" mode cannot save dangling title/description rows.
 */
export function normalizeSeoRewritePairs(raw: unknown, expectedCount = 3): Array<{ title: string; description: string }> {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && 'pairs' in raw && Array.isArray(raw.pairs)
      ? raw.pairs
      : [];
  if (!values.length) return [];
  const parsed = z.array(seoPairSchema).safeParse(values);
  const sourcePairs = parsed.success
    ? parsed.data
    : values
        .map((value): { title: string; description: string } | null => {
          const result = seoPairSchema.safeParse(value);
          return result.success ? result.data : null;
        })
        .filter((value): value is { title: string; description: string } => value !== null);
  const seen = new Set<string>();
  const pairs: Array<{ title: string; description: string }> = [];
  for (const pair of sourcePairs) {
    const title = enforceSeoTextLimit(pair.title, 60);
    const description = enforceSeoTextLimit(pair.description, 160);
    const key = `${title.toLowerCase()}|${description.toLowerCase()}`;
    if (!title || !description || seen.has(key)) continue;
    seen.add(key);
    pairs.push({ title, description });
  }
  return pairs.slice(0, expectedCount);
}
