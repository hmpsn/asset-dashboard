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
  /** Semantic business data extracted by Haiku — populated by extractSemanticData(). */
  semantics?: SemanticPageData;
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

// ── Semantic extraction ────────────────────────────────────────────────────

export interface SemanticPageData {
  // Contact / NAP
  businessName?: string;
  businessType?: 'LocalBusiness' | 'Dentist' | 'MedicalBusiness' | 'MedicalOrganization' | 'FinancialService';
  phone?: string;
  email?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode?: string;
    country?: string;
  };
  geo?: { latitude: number; longitude: number };
  hours?: Array<{
    dayOfWeek: string | string[];
    opens: string;   // "09:00"
    closes: string;  // "18:00"
  }>;
  parking?: string;

  // Reputation
  aggregateRating?: {
    ratingValue: number;
    reviewCount?: number;
    platform?: string;
  };
  reviews?: Array<{
    author: string;
    reviewBody: string;
    ratingValue?: number;
  }>;

  // Business identity
  foundingDate?: string;
  numberOfLocations?: number;
  sameAs?: string[];
  certifications?: string[];
  mediaMentions?: string[];
  awards?: string[];
  highlights?: string[];
  insurance?: string[];
  paymentOptions?: string[];
  areaServed?: string[];
  languagesSpoken?: string[];
  accessibility?: string[];

  // Content entities
  services?: string[];
  staff?: Array<{
    name: string;
    credentials?: string;
    jobTitle?: string;
    image?: string;
  }>;
  offers?: Array<{
    name: string;
    price?: string;
    priceCurrency?: string;
    description?: string;
  }>;
  priceRange?: string;

  // SaaS / product evidence from trusted existing JSON-LD
  softwareApplication?: {
    name: string;
    description?: string;
    url?: string;
    applicationCategory?: string;
    operatingSystem?: string;
    featureList?: string[];
    audience?: {
      audienceType: string;
    };
    offer?: {
      url?: string;
      availability?: string;
    };
  };
  pageAudience?: {
    audienceType: string;
  };
  existingFaq?: Array<{ question: string; answer: string }>;
  events?: Array<{
    name: string;
    startDate?: string;
    endDate?: string;
    description?: string;
    price?: string;
    location?: string;
  }>;
  courses?: Array<{
    name: string;
    description?: string;
    duration?: string;
  }>;

  // Rich content
  faq?: Array<{ question: string; answer: string }>;
  howToSteps?: Array<{ name: string; text: string }>;

  // Media
  primaryImage?: string;
  images?: Array<{ url: string; caption?: string }>;
  videos?: Array<{
    contentUrl: string;
    name?: string;
    description?: string;
    thumbnailUrl?: string;
  }>;

  // Page intent
  primaryAction?: 'book' | 'contact' | 'buy' | 'learn' | 'apply' | 'quote';
  pageCategory?: string;
}
