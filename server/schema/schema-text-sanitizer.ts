/**
 * Canonical schema text sanitization helpers.
 *
 * These utilities are shared across generator/templates/extractors so we keep
 * one authority for whitespace cleanup + opaque ID rejection behavior.
 */

export function normalizeSchemaText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

export function isOpaqueSchemaIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}

export function cleanSchemaPublicText(value: unknown): string | undefined {
  const cleaned = normalizeSchemaText(value);
  if (!cleaned || isOpaqueSchemaIdentifier(cleaned)) return undefined;
  return cleaned;
}

/**
 * Removes a trailing " | Brand", " - Brand", " — Brand", or " · Brand"
 * suffix from a title. Schema.org `name` and breadcrumb labels should not
 * duplicate the site name.
 */
export function scrubBrandSuffix(name: string, brand: string): string {
  if (!brand) return name;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\s+[|\\-—·]\\s+${escaped}\\s*$`, 'i');
  return name.replace(re, '').trim() || name;
}
