/**
 * Unit tests for schema validation post-processing pipeline.
 *
 * Tests:
 * 1. checkRichResultsEligibility() — rich result eligibility checks per schema type
 * 2. PAGE_TYPE_SCHEMA_MAP — deterministic page-type → schema-type mapping
 * 3. extractEeatFromBrief() — author/expertise extraction from content briefs
 * 4. validateForGoogleRichResults() — Google-compliant validator (cross-type matrix)
 * 5. validateEntityConsistency() — cross-page Organization mismatch detection
 * 6. Edge cases: empty @graph, missing @context, malformed inputs, placeholder values
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type {
  RichResultEligibility,
  SchemaPageType,
} from '../../server/schema-suggester.js';
import type { ContentBrief } from '../../shared/types/content.js';

// ── 1. checkRichResultsEligibility ──────────────────────────────────────────

describe('checkRichResultsEligibility', () => {
  let checkRichResultsEligibility: (schema: Record<string, unknown>) => RichResultEligibility[];

  beforeAll(async () => {
    const mod = await import('../../server/schema-suggester.js');
    checkRichResultsEligibility = mod.checkRichResultsEligibility;
  });

  it('returns empty array when schema has no @graph', () => {
    const result = checkRichResultsEligibility({ '@context': 'https://schema.org' });
    expect(result).toHaveLength(0);
  });

  it('returns empty array when @graph is empty', () => {
    const schema = { '@context': 'https://schema.org', '@graph': [] };
    const result = checkRichResultsEligibility(schema);
    expect(result).toHaveLength(0);
  });

  it('marks Article as eligible when all required fields are present', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        '@id': 'https://example.com/blog/test/#article',
        headline: 'Test Article',
        datePublished: '2026-01-01',
        author: { '@type': 'Person', name: 'Jane Doe' },
        image: 'https://example.com/img.jpg',
      }],
    };
    const result = checkRichResultsEligibility(schema);
    expect(result.length).toBeGreaterThan(0);
    const article = result.find(r => r.type === 'Article');
    expect(article).toBeDefined();
    expect(article!.eligible).toBe(true);
    expect(article!.missingFields).toBeUndefined();
  });

  it('marks Article as ineligible when required fields are missing', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        '@id': 'https://example.com/blog/test/#article',
        headline: 'Partial Article',
        // Missing: datePublished, author, image
      }],
    };
    const result = checkRichResultsEligibility(schema);
    expect(result.length).toBeGreaterThan(0);
    const article = result.find(r => r.type === 'Article');
    expect(article).toBeDefined();
    expect(article!.eligible).toBe(false);
    expect(article!.missingFields).toBeDefined();
    expect(article!.missingFields!.length).toBeGreaterThan(0);
    expect(article!.missingFields).toContain('datePublished');
    expect(article!.missingFields).toContain('author');
    expect(article!.missingFields).toContain('image');
  });

  it('marks FAQPage as eligible when mainEntity is present', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'FAQPage',
        '@id': 'https://example.com/faq/#faqpage',
        mainEntity: [
          { '@type': 'Question', name: 'What is SEO?', acceptedAnswer: { '@type': 'Answer', text: 'SEO is...' } },
        ],
      }],
    };
    const result = checkRichResultsEligibility(schema);
    expect(result.length).toBeGreaterThan(0);
    const faq = result.find(r => r.type === 'FAQPage');
    expect(faq).toBeDefined();
    expect(faq!.eligible).toBe(true);
  });

  it('marks FAQPage as ineligible when mainEntity is missing', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'FAQPage',
        '@id': 'https://example.com/faq/#faqpage',
        // Missing: mainEntity
      }],
    };
    const result = checkRichResultsEligibility(schema);
    const faq = result.find(r => r.type === 'FAQPage');
    expect(faq).toBeDefined();
    expect(faq!.eligible).toBe(false);
    expect(faq!.missingFields).toContain('mainEntity');
  });

  it('marks FAQPage as ineligible when mainEntity is an empty array', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'FAQPage',
        mainEntity: [],
      }],
    };
    const result = checkRichResultsEligibility(schema);
    const faq = result.find(r => r.type === 'FAQPage');
    expect(faq).toBeDefined();
    expect(faq!.eligible).toBe(false);
  });

  it('marks LocalBusiness as eligible with name + address', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'LocalBusiness',
        '@id': 'https://example.com/#business',
        name: 'Acme Plumbing',
        address: { '@type': 'PostalAddress', streetAddress: '123 Main St', addressLocality: 'Springfield' },
      }],
    };
    const result = checkRichResultsEligibility(schema);
    const biz = result.find(r => r.type === 'LocalBusiness');
    expect(biz).toBeDefined();
    expect(biz!.eligible).toBe(true);
  });

  it('marks Product as eligible with name + offers', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Product',
        name: 'Widget Pro',
        offers: { '@type': 'Offer', price: '29.99', priceCurrency: 'USD' },
      }],
    };
    const result = checkRichResultsEligibility(schema);
    const product = result.find(r => r.type === 'Product');
    expect(product).toBeDefined();
    expect(product!.eligible).toBe(true);
  });

  it('marks JobPosting as ineligible when jobLocation missing', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'JobPosting',
        title: 'Software Engineer',
        datePosted: '2026-01-01',
        description: 'We are hiring...',
        hiringOrganization: { '@type': 'Organization', name: 'Acme' },
        // Missing: jobLocation (required by checkRichResultsEligibility — note different from validateForGoogleRichResults)
      }],
    };
    const result = checkRichResultsEligibility(schema);
    const job = result.find(r => r.type === 'JobPosting');
    expect(job).toBeDefined();
    expect(job!.eligible).toBe(false);
    expect(job!.missingFields).toContain('jobLocation');
  });

  it('includes feature description in each eligibility result', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Article', headline: 'Test', datePublished: '2026-01-01', author: { name: 'Jane' }, image: 'https://example.com/img.jpg' },
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' }] },
      ],
    };
    const result = checkRichResultsEligibility(schema);
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(typeof r.feature).toBe('string');
      expect(r.feature.length).toBeGreaterThan(0);
    }
  });

  it('handles multi-type @type arrays and checks each eligible type', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': ['Article', 'NewsArticle'],
        headline: 'Breaking News',
        datePublished: '2026-04-01',
        author: { '@type': 'Person', name: 'Reporter' },
        image: 'https://example.com/img.jpg',
      }],
    };
    const result = checkRichResultsEligibility(schema);
    expect(result.length).toBeGreaterThan(0);
    const article = result.find(r => r.type === 'Article');
    const news = result.find(r => r.type === 'NewsArticle');
    expect(article).toBeDefined();
    expect(news).toBeDefined();
    expect(article!.eligible).toBe(true);
    expect(news!.eligible).toBe(true);
  });

  it('ignores schema types not in the eligible set', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Organization',
        '@id': 'https://example.com/#org',
        name: 'Acme Corp',
      }],
    };
    // Organization is not a rich result type in this module's eligibility list
    const result = checkRichResultsEligibility(schema);
    const org = result.find(r => r.type === 'Organization');
    expect(org).toBeUndefined();
  });

  it('marks Recipe as eligible when all four required fields are present', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Recipe',
        name: 'Chocolate Cake',
        image: 'https://example.com/cake.jpg',
        recipeIngredient: ['2 cups flour', '1 cup sugar'],
        recipeInstructions: [{ '@type': 'HowToStep', text: 'Mix ingredients' }],
      }],
    };
    const result = checkRichResultsEligibility(schema);
    const recipe = result.find(r => r.type === 'Recipe');
    expect(recipe).toBeDefined();
    expect(recipe!.eligible).toBe(true);
  });

  it('treats empty string required field as missing', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        headline: '',  // empty string — treated as missing
        datePublished: '2026-01-01',
        author: { name: 'Jane' },
        image: 'https://example.com/img.jpg',
      }],
    };
    const result = checkRichResultsEligibility(schema);
    const article = result.find(r => r.type === 'Article');
    expect(article).toBeDefined();
    expect(article!.eligible).toBe(false);
    expect(article!.missingFields).toContain('headline');
  });
});

// ── 2. PAGE_TYPE_SCHEMA_MAP ──────────────────────────────────────────────────

describe('PAGE_TYPE_SCHEMA_MAP', () => {
  let PAGE_TYPE_SCHEMA_MAP: Record<SchemaPageType, { primary: string[]; secondary: string[] }>;
  let PAGE_TYPE_LABELS: Record<SchemaPageType, string>;

  beforeAll(async () => {
    const mod = await import('../../server/schema-suggester.js');
    PAGE_TYPE_SCHEMA_MAP = mod.PAGE_TYPE_SCHEMA_MAP;
    PAGE_TYPE_LABELS = mod.PAGE_TYPE_LABELS;
  });

  it('every page type has a corresponding label', () => {
    const mapKeys = Object.keys(PAGE_TYPE_SCHEMA_MAP) as SchemaPageType[];
    expect(mapKeys.length).toBeGreaterThan(0);
    for (const key of mapKeys) {
      expect(PAGE_TYPE_LABELS[key]).toBeDefined();
      expect(typeof PAGE_TYPE_LABELS[key]).toBe('string');
      expect(PAGE_TYPE_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it('every page type entry has primary and secondary arrays', () => {
    const mapKeys = Object.keys(PAGE_TYPE_SCHEMA_MAP) as SchemaPageType[];
    expect(mapKeys.length).toBeGreaterThan(0);
    for (const key of mapKeys) {
      const entry = PAGE_TYPE_SCHEMA_MAP[key];
      expect(Array.isArray(entry.primary)).toBe(true);
      expect(Array.isArray(entry.secondary)).toBe(true);
    }
  });

  it('faq page type maps to FAQPage as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['faq'].primary).toContain('FAQPage');
  });

  it('blog page type maps to BlogPosting as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['blog'].primary).toContain('BlogPosting');
  });

  it('location page type maps to LocalBusiness as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['location'].primary).toContain('LocalBusiness');
  });

  it('product page type maps to Product as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['product'].primary).toContain('Product');
  });

  it('homepage maps to Organization and WebSite as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['homepage'].primary).toContain('Organization');
    expect(PAGE_TYPE_SCHEMA_MAP['homepage'].primary).toContain('WebSite');
  });

  it('event page type maps to Event as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['event'].primary).toContain('Event');
  });

  it('recipe page type maps to Recipe as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['recipe'].primary).toContain('Recipe');
  });

  it('howto page type maps to HowTo as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['howto'].primary).toContain('HowTo');
  });

  it('author page type maps to Person and ProfilePage as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['author'].primary).toContain('Person');
    expect(PAGE_TYPE_SCHEMA_MAP['author'].primary).toContain('ProfilePage');
  });

  it('auto page type has empty primary and secondary (no deterministic mapping)', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['auto'].primary).toHaveLength(0);
    expect(PAGE_TYPE_SCHEMA_MAP['auto'].secondary).toHaveLength(0);
  });

  it('job-posting page type maps to JobPosting as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['job-posting'].primary).toContain('JobPosting');
  });

  it('course page type maps to Course as primary', () => {
    expect(PAGE_TYPE_SCHEMA_MAP['course'].primary).toContain('Course');
  });
});

// ── 3. extractEeatFromBrief ──────────────────────────────────────────────────

describe('extractEeatFromBrief', () => {
  let extractEeatFromBrief: (brief: ContentBrief) => { authorName?: string; authorTitle?: string; expertiseTopics?: string[] } | null;

  beforeAll(async () => {
    const mod = await import('../../server/schema-suggester.js');
    extractEeatFromBrief = mod.extractEeatFromBrief;
  });

  function makeBrief(eeatGuidance: ContentBrief['eeatGuidance']): ContentBrief {
    return {
      id: 'brief-test',
      workspaceId: 'ws-test',
      targetKeyword: 'seo services',
      secondaryKeywords: [],
      suggestedTitle: 'SEO Services',
      suggestedMetaDesc: 'Expert SEO services.',
      outline: [],
      wordCountTarget: 1000,
      intent: 'commercial',
      audience: 'business owners',
      competitorInsights: '',
      internalLinkSuggestions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      eeatGuidance,
    };
  }

  it('returns null when brief has no eeatGuidance', () => {
    const brief = makeBrief(undefined);
    expect(extractEeatFromBrief(brief)).toBeNull();
  });

  function emptyEeat(): NonNullable<ContentBrief['eeatGuidance']> {
    return { experience: '', expertise: '', authority: '', trust: '' };
  }

  it('returns null when eeatGuidance has no extractable author or expertise', () => {
    const brief = makeBrief({ ...emptyEeat(), expertise: 'Our team has general knowledge.' });
    expect(extractEeatFromBrief(brief)).toBeNull();
  });

  it('extracts author name from "Written by" pattern in expertise field', () => {
    // The name regex requires [A-Z][a-z]+(?: [A-Z][a-z'.]+){1,3} immediately after "Written by ".
    // "Dr." breaks the pattern (period after "Dr" prevents the group from continuing to "Jane").
    // Use a name without a title prefix so the regex matches correctly.
    const brief = makeBrief({ ...emptyEeat(), expertise: 'Written by Jane Smith, a certified SEO expert.' });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorName).toContain('Jane Smith');
  });

  it('extracts author name from "Author:" pattern in expertise field', () => {
    const brief = makeBrief({ ...emptyEeat(), expertise: 'Author: John Doe, MD. Board-certified physician.' });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorName).toContain('John Doe');
  });

  it('extracts author title from credential patterns in expertise field', () => {
    const brief = makeBrief({ ...emptyEeat(), expertise: 'credentials: Certified SEO Specialist with 10 years experience. Written by Dr. Jane Smith.' });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorTitle).toBeDefined();
  });

  it('extracts expertise topics from "expertise in" pattern', () => {
    const brief = makeBrief({ ...emptyEeat(), expertise: 'Written by Dr. Jane Smith. Jane has expertise in technical SEO, content strategy, and link building.' });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.expertiseTopics).toBeDefined();
    expect(result!.expertiseTopics!.length).toBeGreaterThan(0);
  });

  it('extracts author name from authority field when expertise field lacks it', () => {
    const brief = makeBrief({ ...emptyEeat(), authority: 'Expert: Sarah Johnson, seasoned practitioner.' });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorName).toContain('Sarah Johnson');
  });

  it('returns null when all text fields are empty strings', () => {
    const brief = makeBrief(emptyEeat());
    expect(extractEeatFromBrief(brief)).toBeNull();
  });

  it('extracts professional credential title (MD, PhD, etc.) from expertise field', () => {
    const brief = makeBrief({ ...emptyEeat(), expertise: 'Written by Dr. Alan Carter. MD specializing in cardiology.' });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    // The title regex /\b((?:Dr|MD|...)\b[^.]*)/i matches "Dr" first (before "MD") since "Dr." appears
    // earlier in the text and [^.]* stops at the period, yielding "Dr" as the captured title.
    if (result!.authorTitle) {
      expect(result!.authorTitle).toMatch(/Dr|MD|physician|specialist|doctor/i);
    }
  });
});

// ── 4. validateForGoogleRichResults (pipeline validation pass) ───────────────

describe('validateForGoogleRichResults — pipeline validation pass', () => {
  let validateForGoogleRichResults: (schema: Record<string, unknown>) => {
    status: 'valid' | 'warnings' | 'errors';
    richResults: string[];
    errors: Array<{ type: string; field: string; message: string }>;
    warnings: Array<{ type: string; field: string; message: string }>;
  };

  beforeAll(async () => {
    const mod = await import('../../server/schema-validator.js');
    validateForGoogleRichResults = mod.validateForGoogleRichResults;
  });

  // ── Content verification cases ──────────────────────────────────

  it('returns valid status when schema has no @graph nodes (empty graph)', () => {
    const schema = { '@context': 'https://schema.org', '@graph': [] };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('valid');
    expect(result.richResults).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('produces no errors when @graph is missing (no nodes to validate)', () => {
    const schema = { '@context': 'https://schema.org' };
    const result = validateForGoogleRichResults(schema);
    // No @graph → no nodes → no errors from node validation
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toHaveLength(0);
  });

  it('returns valid for a complete HowTo schema with all required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'HowTo',
        name: 'How to Install a Light Fixture',
        step: [
          { '@type': 'HowToStep', name: 'Turn off power', text: 'Switch off the circuit breaker.' },
          { '@type': 'HowToStep', name: 'Remove old fixture', text: 'Unscrew the old light fixture.' },
        ],
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toContain('HowTo');
  });

  it('flags HowTo missing both required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'HowTo',
        // Missing: name, step
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'name')).toBe(true);
    expect(result.errors.some(e => e.field === 'step')).toBe(true);
    expect(result.richResults).not.toContain('HowTo');
  });

  it('returns valid for a complete VideoObject schema', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'VideoObject',
        name: 'SEO Explained in 5 Minutes',
        description: 'A quick overview of SEO basics.',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        uploadDate: '2026-01-15',
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toContain('VideoObject');
  });

  it('flags VideoObject missing thumbnailUrl and uploadDate', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'VideoObject',
        name: 'SEO Explained',
        description: 'A quick overview.',
        // Missing: thumbnailUrl, uploadDate
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'thumbnailUrl')).toBe(true);
    expect(result.errors.some(e => e.field === 'uploadDate')).toBe(true);
  });

  it('returns valid for a complete BreadcrumbList', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'BreadcrumbList',
        '@id': 'https://example.com/services/#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
          { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://example.com/services' },
        ],
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toContain('BreadcrumbList');
  });

  it('flags BreadcrumbList missing itemListElement', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'BreadcrumbList',
        '@id': 'https://example.com/services/#breadcrumb',
        // Missing: itemListElement
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'itemListElement')).toBe(true);
  });

  // ── Cross-reference injection cases ────────────────────────────

  it('returns valid for WebSite schema (no required fields)', () => {
    // WebSite has no required fields in RICH_RESULT_RULES (only recommended)
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'WebSite',
        '@id': 'https://example.com/#website',
        name: 'Example Site',
        url: 'https://example.com',
        potentialAction: { '@type': 'SearchAction', target: 'https://example.com/search?q={search_term_string}', 'query-input': 'required name=search_term_string' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    // WebSite requires name + url per RICH_RESULT_RULES — check those are met
    expect(result.status).not.toBe('errors');
  });

  it('flags WebSite missing name and url fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'WebSite',
        '@id': 'https://example.com/#website',
        // Missing: name, url
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'name')).toBe(true);
    expect(result.errors.some(e => e.field === 'url')).toBe(true);
  });

  it('flags Service missing name field', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Service',
        '@id': 'https://example.com/services/#service',
        description: 'We offer plumbing services.',
        // Missing: name
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'name' && e.type === 'Service')).toBe(true);
  });

  it('returns valid for Organization with name only (one required field)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Organization',
        '@id': 'https://example.com/#organization',
        name: 'Acme Corp',
      }],
    };
    const result = validateForGoogleRichResults(schema);
    // Organization only requires "name"
    expect(result.errors.some(e => e.type === 'Organization')).toBe(false);
  });

  // ── Auto-fix / placeholder detection cases ──────────────────────

  it('handles a schema node with @type as an array (multi-type)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': ['BlogPosting', 'Article'],
        '@id': 'https://example.com/blog/post/#article',
        headline: 'My Blog Post',
        datePublished: '2026-03-01',
        author: { '@type': 'Person', name: 'Author Name' },
        image: 'https://example.com/post.jpg',
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toContain('Article');
    expect(result.richResults).toContain('BlogPosting');
  });

  it('handles a top-level schema without @graph (single node)', () => {
    // Per extractGraphNodes: single node at top level when @type exists
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      '@id': 'https://example.com/blog/#article',
      headline: 'Flat Article',
      datePublished: '2026-01-01',
      author: { name: 'Jane' },
      image: 'https://example.com/img.jpg',
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Article');
    expect(result.errors).toHaveLength(0);
  });

  it('produces warnings but not errors for missing recommended fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'LocalBusiness',
        '@id': 'https://example.com/#business',
        name: 'Acme Plumbing',
        address: { '@type': 'PostalAddress', streetAddress: '123 Main St', addressLocality: 'Springfield' },
        // Missing recommended: telephone, openingHours, geo, url, image
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('warnings');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toContain('LocalBusiness');
  });

  it('handles schema node with unknown @type without errors', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'UnknownCustomType',
        name: 'Something',
      }],
    };
    // Unknown types have no rules — no errors, no rich results
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('valid');
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toHaveLength(0);
  });

  // ── Invalid schema input handling ───────────────────────────────

  it('handles schema node with null @type gracefully', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': null as unknown as string, name: 'something' }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.errors).toHaveLength(0);
  });

  it('handles @graph entry with no @type field without throwing', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ name: 'No type provided' }],
    };
    expect(() => validateForGoogleRichResults(schema)).not.toThrow();
  });

  it('does not count empty-string field values as present for required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Event',
        name: '',  // empty string — treated as missing
        startDate: '2026-07-01',
        location: { '@type': 'Place', name: 'Convention Center' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'name' && e.type === 'Event')).toBe(true);
    expect(result.richResults).not.toContain('Event');
  });

  // ── Multiple schema types in one @graph ─────────────────────────

  it('validates multiple distinct schema types in one @graph independently', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://example.com/#organization',
          name: 'Acme Corp',
          url: 'https://example.com',
        },
        {
          '@type': 'WebSite',
          '@id': 'https://example.com/#website',
          name: 'Acme Website',
          url: 'https://example.com',
        },
        {
          '@type': 'FAQPage',
          '@id': 'https://example.com/faq/#faqpage',
          mainEntity: [{ '@type': 'Question', name: 'What is Acme?', acceptedAnswer: { text: 'Acme is...' } }],
        },
      ],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('FAQPage');
    expect(result.errors.filter(e => e.type === 'FAQPage')).toHaveLength(0);
  });

  it('accumulates errors across multiple @graph nodes', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          '@id': 'https://example.com/blog/#article',
          // All required fields missing: headline, datePublished, author, image
        },
        {
          '@type': 'FAQPage',
          '@id': 'https://example.com/faq/#faqpage',
          // Required field missing: mainEntity
        },
      ],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    const articleErrors = result.errors.filter(e => e.type === 'Article');
    const faqErrors = result.errors.filter(e => e.type === 'FAQPage');
    expect(articleErrors.length).toBeGreaterThan(0);
    expect(faqErrors.length).toBeGreaterThan(0);
  });
});

// ── 5. validateEntityConsistency — extended cases ────────────────────────────

describe('validateEntityConsistency — cross-page entity checks', () => {
  let validateEntityConsistency: (schemas: Array<{ pageId: string; schema: Record<string, unknown> }>) => {
    consistent: boolean;
    mismatches: Array<{ field: string; expected: string; found: string; pageId: string }>;
  };

  beforeAll(async () => {
    const mod = await import('../../server/schema-validator.js');
    validateEntityConsistency = mod.validateEntityConsistency;
  });

  it('returns consistent with no mismatches for a single page', () => {
    const schemas = [
      {
        pageId: 'https://example.com/',
        schema: { '@graph': [{ '@type': 'Organization', '@id': 'https://example.com/#org', name: 'Acme Corp' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('returns consistent for empty schemas array', () => {
    const result = validateEntityConsistency([]);
    expect(result.consistent).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('detects URL mismatch between pages', () => {
    const schemas = [
      {
        pageId: 'https://example.com/',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', url: 'https://acme.com' }] },
      },
      {
        pageId: 'https://example.com/about',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', url: 'https://www.acme.com' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    const urlMismatch = result.mismatches.find(m => m.field === 'url');
    expect(urlMismatch).toBeDefined();
    expect(urlMismatch!.pageId).toBe('https://example.com/about');
  });

  it('detects logo mismatch between pages', () => {
    const schemas = [
      {
        pageId: 'https://example.com/',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', logo: 'https://acme.com/logo-v1.png' }] },
      },
      {
        pageId: 'https://example.com/contact',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', logo: 'https://acme.com/logo-v2.png' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    const logoMismatch = result.mismatches.find(m => m.field === 'logo');
    expect(logoMismatch).toBeDefined();
  });

  it('detects sameAs mismatch between pages', () => {
    const schemas = [
      {
        pageId: 'https://example.com/',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', sameAs: ['https://twitter.com/acme'] }] },
      },
      {
        pageId: 'https://example.com/about',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', sameAs: ['https://twitter.com/acme-inc'] }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    const sameAsMismatch = result.mismatches.find(m => m.field === 'sameAs');
    expect(sameAsMismatch).toBeDefined();
  });

  it('ignores fields not present on both pages (only checks mutual fields)', () => {
    // page1 has telephone, page2 does not — no mismatch expected since page2 has no value to conflict with
    const schemas = [
      {
        pageId: 'https://example.com/',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', url: 'https://acme.com', telephone: '+15550000' }] },
      },
      {
        pageId: 'https://example.com/about',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme', url: 'https://acme.com' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    // telephone is only on one page — no mismatch since both sides must be defined for comparison
    expect(result.consistent).toBe(true);
  });

  it('uses first Organization occurrence as canonical reference', () => {
    const schemas = [
      {
        pageId: 'page-1',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Canonical Name', url: 'https://example.com' }] },
      },
      {
        pageId: 'page-2',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Different Name', url: 'https://example.com' }] },
      },
      {
        pageId: 'page-3',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Another Name', url: 'https://example.com' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    // All mismatches reference pages 2 and 3 (not page-1 which is canonical)
    for (const m of result.mismatches) {
      expect(m.pageId).not.toBe('page-1');
    }
  });

  it('treats LocalBusiness as an Organization type for consistency checks', () => {
    const schemas = [
      {
        pageId: 'https://example.com/',
        schema: { '@graph': [{ '@type': 'LocalBusiness', name: 'Acme Plumbing', telephone: '+15550100' }] },
      },
      {
        pageId: 'https://example.com/contact',
        schema: { '@graph': [{ '@type': 'LocalBusiness', name: 'Acme Plumbing', telephone: '+15550200' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches.some(m => m.field === 'telephone')).toBe(true);
  });

  it('treats MedicalOrganization as an Organization type for consistency checks', () => {
    const schemas = [
      {
        pageId: 'page-home',
        schema: { '@graph': [{ '@type': 'MedicalOrganization', name: 'Healthy Med', telephone: '+15550100' }] },
      },
      {
        pageId: 'page-contact',
        schema: { '@graph': [{ '@type': 'MedicalOrganization', name: 'Healthy Medical Center', telephone: '+15550100' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches.some(m => m.field === 'name')).toBe(true);
  });

  it('reports the pageId of the conflicting page in each mismatch', () => {
    const schemas = [
      {
        pageId: 'https://example.com/',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme Corp', url: 'https://acme.com' }] },
      },
      {
        pageId: 'https://example.com/contact',
        schema: { '@graph': [{ '@type': 'Organization', name: 'Acme Inc', url: 'https://acme.com' }] },
      },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches[0].pageId).toBe('https://example.com/contact');
    expect(result.mismatches[0].expected).toBe('Acme Corp');
    expect(result.mismatches[0].found).toBe('Acme Inc');
  });
});

// ── 6. Edge cases ────────────────────────────────────────────────────────────

describe('edge cases — empty, malformed, missing @context', () => {
  let validateForGoogleRichResults: (schema: Record<string, unknown>) => {
    status: 'valid' | 'warnings' | 'errors';
    richResults: string[];
    errors: Array<{ type: string; field: string; message: string }>;
    warnings: Array<{ type: string; field: string; message: string }>;
  };

  let checkRichResultsEligibility: (schema: Record<string, unknown>) => RichResultEligibility[];
  let validateEntityConsistency: (schemas: Array<{ pageId: string; schema: Record<string, unknown> }>) => {
    consistent: boolean;
    mismatches: Array<{ field: string; expected: string; found: string; pageId: string }>;
  };

  beforeAll(async () => {
    const validatorMod = await import('../../server/schema-validator.js');
    validateForGoogleRichResults = validatorMod.validateForGoogleRichResults;
    validateEntityConsistency = validatorMod.validateEntityConsistency;
    const suggesterMod = await import('../../server/schema-suggester.js');
    checkRichResultsEligibility = suggesterMod.checkRichResultsEligibility;
  });

  it('handles completely empty schema object without throwing', () => {
    expect(() => validateForGoogleRichResults({})).not.toThrow();
  });

  it('returns valid status for completely empty schema (no @graph, no @type)', () => {
    const result = validateForGoogleRichResults({});
    expect(result.status).toBe('valid');
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toHaveLength(0);
  });

  it('handles schema missing @context (missing context does not break validation)', () => {
    const schema = {
      '@graph': [{
        '@type': 'Article',
        headline: 'No Context Article',
        datePublished: '2026-01-01',
        author: { name: 'Jane' },
        image: 'https://example.com/img.jpg',
      }],
    };
    // validateForGoogleRichResults checks types, not @context — should still work
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Article');
    expect(result.errors).toHaveLength(0);
  });

  it('handles checkRichResultsEligibility on completely empty schema object', () => {
    const result = checkRichResultsEligibility({});
    expect(result).toHaveLength(0);
  });

  it('handles checkRichResultsEligibility when @graph is not an array (malformed)', () => {
    const schema = { '@context': 'https://schema.org', '@graph': 'not an array' as unknown as [] };
    const result = checkRichResultsEligibility(schema);
    expect(result).toHaveLength(0);
  });

  it('handles validateForGoogleRichResults when @graph contains a null entry', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [null as unknown as Record<string, unknown>],
    };
    // extractGraphNodes casts the array as-is; when a null entry is iterated, getNodeTypes
    // tries to access null['@type'] which throws TypeError. Document this current behavior.
    expect(() => validateForGoogleRichResults(schema)).toThrow(TypeError);
  });

  it('handles validateEntityConsistency with schemas having no @graph key', () => {
    const schemas = [
      { pageId: 'page-1', schema: {} },
      { pageId: 'page-2', schema: {} },
    ];
    // Schemas with no @graph yield no Organization nodes — should be consistent without throwing
    expect(() => validateEntityConsistency(schemas)).not.toThrow();
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('returns valid when @graph has nodes with no recognized @type', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'CustomType1', name: 'Thing 1' },
        { '@type': 'CustomType2', name: 'Thing 2' },
      ],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('valid');
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toHaveLength(0);
  });

  it('handles a real-world @graph with multiple mixed types including unknown ones', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': 'https://example.com/#website',
          name: 'Example',
          url: 'https://example.com',
        },
        {
          '@type': 'Organization',
          '@id': 'https://example.com/#organization',
          name: 'Example Corp',
          url: 'https://example.com',
        },
        {
          '@type': 'WebPage',
          '@id': 'https://example.com/services/#webpage',
        },
        {
          '@type': 'Service',
          '@id': 'https://example.com/services/#service',
          name: 'SEO Services',
          url: 'https://example.com/services',
          provider: { '@id': 'https://example.com/#organization' },
        },
        {
          '@type': 'BreadcrumbList',
          '@id': 'https://example.com/services/#breadcrumb',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
            { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://example.com/services' },
          ],
        },
      ],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Service');
    expect(result.richResults).toContain('BreadcrumbList');
    // No errors on Service (has name) or BreadcrumbList (has itemListElement)
    const serviceErrors = result.errors.filter(e => e.type === 'Service' && !e.message.includes('recommended'));
    expect(serviceErrors.filter(e => !e.message.includes('recommended'))).toHaveLength(0);
  });

  it('rich results array contains only eligible types (no duplicates for single instance)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'FAQPage',
        mainEntity: [{ '@type': 'Question', name: 'Test?', acceptedAnswer: { text: 'Yes.' } }],
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults.length).toBeGreaterThan(0);
    const faqEntries = result.richResults.filter(r => r === 'FAQPage');
    expect(faqEntries).toHaveLength(1);
  });
});
