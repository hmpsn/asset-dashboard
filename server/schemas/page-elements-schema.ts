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

export const pageElementCatalogSchema: z.ZodType<PageElementCatalog> = z.object({
  extractedAt: z.string(),
  sourcePublishedAt: z.string().nullable(),
  headings: z.array(headingSchema),
  tables: z.array(tableSchema),
  images: z.array(pageImageSchema),
  videos: z.array(videoSchema),
  lists: z.array(pageListSchema),
  testimonials: z.array(testimonialSchema),
  codeBlocks: z.array(codeBlockSchema),
  citations: z.array(citationSchema),
  diagnostics: diagnosticsSchema,
}).passthrough();

/**
 * Sentinel empty catalog used as parseJsonSafe fallback when stored
 * blob is malformed or missing. Schema rendering falls through to
 * existing behavior when the catalog is empty.
 */
export const EMPTY_CATALOG: PageElementCatalog = {
  extractedAt: new Date(0).toISOString(),
  sourcePublishedAt: null,
  headings: [],
  tables: [],
  images: [],
  videos: [],
  lists: [],
  testimonials: [],
  codeBlocks: [],
  citations: [],
  diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
};
