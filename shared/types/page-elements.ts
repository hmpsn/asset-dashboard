/**
 * Typed catalog of structured content elements detected in a page's HTML.
 * Produced by `extractPageElements()` and stored in the `page_elements`
 * table (migration 079). Consumed by schema templates to conditionally
 * enrich JSON-LD with VideoObject, HowTo, Article.citation[], etc.
 *
 * Failure mode: extractor returns an empty catalog (every array empty);
 * schema templates fall back to current behavior. Never throws.
 */
export interface PageElementCatalog {
  /** ISO timestamp of catalog extraction. */
  extractedAt: string;
  /** Webflow lastPublished at extract time — drives stale detection. */
  sourcePublishedAt: string | null;
  /** Heading-tree summary for ToC + speakable cssSelector candidates (PR3). */
  headings: Heading[];
  /** Tables in main content area (PR2). */
  tables: Table[];
  /** Images with role classification (rule-based in PR1; AI in PR2). */
  images: PageImage[];
  /** Embedded videos — YouTube, Vimeo, native <video>. */
  videos: Video[];
  /** Lists; flagged with isHowToLike when matching HowTo heuristics. */
  lists: PageList[];
  /** Customer testimonials (PR2). */
  testimonials: Testimonial[];
  /** Code blocks (used for SoftwareSourceCode in future). */
  codeBlocks: CodeBlock[];
  /** Outbound links to authoritative sources (Article.citation[]). */
  citations: Citation[];
  /** Diagnostic counters — extractor confidence, AI calls used, fallbacks hit. */
  diagnostics: ExtractionDiagnostics;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** DOM element id if present; otherwise undefined. */
  id?: string;
}

export interface Table {
  rowCount: number;
  colCount: number;
  caption?: string;
  /** Heuristic flag: contains price-like cells (currency symbols, "$N", "from $N"). */
  isPricingLike: boolean;
  /** Heuristic flag: structured comparison (≥3 cols + repeated row labels). */
  isComparisonLike: boolean;
}

export interface PageImage {
  src: string;
  alt?: string;
  caption?: string;
  /** hero = lead image; informative = body diagram/screenshot; decorative = pattern/spacer. */
  role: 'hero' | 'informative' | 'decorative';
  /** How the role was determined; PR1 ships rule + fallback only. */
  roleSource: 'rule' | 'ai' | 'fallback';
  width?: number;
  height?: number;
}

export interface Video {
  provider: 'youtube' | 'vimeo' | 'native' | 'other';
  /** Iframe src for embed providers; <video src> for native. */
  embedUrl: string;
  /** Provider-derived thumbnail URL (e.g. img.youtube.com/vi/<id>/maxresdefault.jpg). */
  thumbnailUrl?: string;
  /** Duration in seconds when extractable from URL or inline metadata. */
  durationSec?: number;
  /** Title from iframe title attr, native poster, or alt heuristic. */
  title?: string;
}

export interface PageList {
  kind: 'ordered' | 'unordered';
  itemCount: number;
  /** True when ordered + items contain action verbs + nearby heading is "how to" / "steps". */
  isHowToLike: boolean;
  /** When isHowToLike, the parsed step text. */
  steps?: HowToStep[];
}

export interface HowToStep {
  name: string;
  text: string;
  position: number;
}

export interface Testimonial {
  author?: string;
  quote: string;
  rating?: number;
  /** CSS selector for the matched DOM element — useful for debugging. */
  selector: string;
}

export interface CodeBlock {
  language?: string;
  lineCount: number;
}

export interface Citation {
  url: string;
  /** Anchor text (or empty string if image-only link). */
  text: string;
  /** True when href hostname differs from page hostname. */
  isExternal: boolean;
}

export interface ExtractionDiagnostics {
  /** Number of AI image-role classifier calls made (always 0 in PR1). */
  aiClassificationCalls: number;
  /** True when AI calls hit the per-regenerate budget cap. */
  hitAiBudgetCap: boolean;
  /** Per-element-type detection counts before filtering. Keys: 'tables' | 'images' | 'videos' | 'lists' | 'testimonials' | 'codeBlocks' | 'citations' | 'headings'. */
  rawCounts: Record<string, number>;
}
