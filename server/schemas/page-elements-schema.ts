import { z } from 'zod';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';


/**
 * Zod schema mirroring PageElementCatalog. Used by parseJsonSafe to
 * validate `catalog_json` blobs read from the page_elements table.
 *
 * Permissive: extra fields are allowed (forward-compat for PR2/PR3).
 * Strict: required fields throw on parse failure (parseJsonSafe falls
 * back to EMPTY_CATALOG; never crashes).
 */
const headingSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  text: z.string(),
  id: z.string().optional(),
});

const tableSchema = z.object({
  rowCount: z.number(),
  colCount: z.number(),
  caption: z.string().optional(),
  isPricingLike: z.boolean(),
  isComparisonLike: z.boolean(),
});

const pageImageSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  role: z.enum(['hero', 'informative', 'decorative']),
  roleSource: z.enum(['rule', 'ai', 'fallback']),
  width: z.number().optional(),
  height: z.number().optional(),
});

const videoSchema = z.object({
  provider: z.enum(['youtube', 'vimeo', 'native', 'other']),
  embedUrl: z.string(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().optional(),
  title: z.string().optional(),
});

const howToStepSchema = z.object({
  name: z.string(),
  text: z.string(),
  position: z.number(),
});

const pageListSchema = z.object({
  kind: z.enum(['ordered', 'unordered']),
  itemCount: z.number(),
  isHowToLike: z.boolean(),
  steps: z.array(howToStepSchema).optional(),
});

const testimonialSchema = z.object({
  author: z.string().optional(),
  quote: z.string(),
  rating: z.number().optional(),
  selector: z.string(),
});

const codeBlockSchema = z.object({
  language: z.string().optional(),
  lineCount: z.number(),
});

const citationSchema = z.object({
  url: z.string(),
  text: z.string(),
  isExternal: z.boolean(),
});

const diagnosticsSchema = z.object({
  aiClassificationCalls: z.number(),
  hitAiBudgetCap: z.boolean(),
  rawCounts: z.record(z.number()),
});

/**
 * Array fields use `.default([])` so a partial blob (e.g. PR2 writing only
 * the fields it touches) does not destroy ALL data via parseJsonSafe →
 * fallback. The `diagnostics` field is also defaulted for the same reason.
 *
 * Schema-vs-stored-shape discipline (CLAUDE.md "Code Conventions"): every
 * field a PR1 writer omits MUST have a default here, otherwise
 * parseJsonSafe silently returns EMPTY_CATALOG and erases real data.
 *
 * The output type matches PageElementCatalog after defaults are applied;
 * the input accepts a partial blob. We use `as unknown as` to bridge the
 * Zod inferred type to the shared interface — the runtime parse guarantees
 * field-shape conformance.
 */
export const pageElementCatalogSchema = z.object({
  extractedAt: z.string(),
  sourcePublishedAt: z.string().nullable(),
  headings: z.array(headingSchema).default([]),
  tables: z.array(tableSchema).default([]),
  images: z.array(pageImageSchema).default([]),
  videos: z.array(videoSchema).default([]),
  lists: z.array(pageListSchema).default([]),
  testimonials: z.array(testimonialSchema).default([]),
  codeBlocks: z.array(codeBlockSchema).default([]),
  citations: z.array(citationSchema).default([]),
  diagnostics: diagnosticsSchema.default({ aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} }),
  semantics: z.record(z.unknown()).optional(),
}).passthrough() as unknown as z.ZodType<PageElementCatalog>;

/**
 * Sentinel empty catalog used as parseJsonSafe fallback when stored
 * blob is malformed or missing. Schema rendering falls through to
 * existing behavior when the catalog is empty.
 *
 * Frozen (shallow + inner arrays via unknown-cast) so any consumer that
 * mistakenly mutates a fallback-returned catalog (e.g.
 * `catalog.videos.push(...)`) throws in strict mode rather than
 * corrupting the singleton for all subsequent fallback returns. The
 * casts are necessary because the TypeScript interface declares the
 * arrays as mutable; we trade a one-line cast for runtime safety.
 */
const _EMPTY_CATALOG_RAW = {
  extractedAt: new Date(0).toISOString(),
  sourcePublishedAt: null as string | null,
  headings: Object.freeze([]),
  tables: Object.freeze([]),
  images: Object.freeze([]),
  videos: Object.freeze([]),
  lists: Object.freeze([]),
  testimonials: Object.freeze([]),
  codeBlocks: Object.freeze([]),
  citations: Object.freeze([]),
  diagnostics: Object.freeze({
    aiClassificationCalls: 0,
    hitAiBudgetCap: false,
    rawCounts: Object.freeze({}) as Record<string, number>,
  }),
};
export const EMPTY_CATALOG: PageElementCatalog = Object.freeze(_EMPTY_CATALOG_RAW) as unknown as PageElementCatalog;
