/**
 * Lean schema generator orchestrator.
 *
 * Pipeline:
 *   1. Classify page → primary @type (deterministic, no AI)
 *   2. Extract canonical page data from HTML + meta + workspace (no AI)
 *   3. Surgical AI for description (only if missing) + FAQ (only if accordion present)
 *   4. Build typed template
 *   5. Validate against Google rich-result rules
 *   6. Return LeanGeneratorOutput (matches the shape SchemaPageSuggestion expects)
 */

import * as cheerio from 'cheerio';
import { classifyPage } from './classifier.js';
import { extractPageData } from './data-sources.js';
import type { PageMetaInput, WorkspaceSchemaInput } from './data-sources.js';
import { extractDescription } from './extractors/description.js';
import { extractFaq } from './extractors/faq.js';
import { buildArticleSchema } from './templates/article.js';
import { buildServiceSchema, buildProductSchema } from './templates/service.js';
import { buildLocalBusinessSchema } from './templates/local-business.js';
import { buildAboutPageSchema, buildContactPageSchema, buildCollectionPageSchema, buildWebPageSchema } from './templates/static.js';
import { buildHomepageSchema } from './templates/homepage.js';
import { validateLeanSchema } from './validator.js';
import { checkRichResultsEligibility } from '../schema-suggester.js';
import type { RichResultEligibility } from '../schema-suggester.js';
import { createLogger } from '../logger.js';

const log = createLogger('schema/generator');

/** Subset of SchemaPageSuggestion that the generator returns. */
export interface LeanGeneratorOutput {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  suggestedSchemas: Array<{
    type: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
    template: Record<string, unknown>;
  }>;
  validationErrors?: string[];
  richResultsEligibility?: RichResultEligibility[];
}

export interface LeanGeneratorInput {
  pageId: string;
  pageMeta: PageMetaInput;
  html: string;
  baseUrl: string;
  workspace: WorkspaceSchemaInput;
  /** Optional override for existing schema detection (saves Cheerio re-parsing in batch). */
  existingSchemas?: string[];
}

function detectExistingSchemas(html: string): string[] {
  const $ = cheerio.load(html);
  const types: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}') as Record<string, unknown>;
      const t = json['@type'];
      if (typeof t === 'string') types.push(t);
      else if (Array.isArray(t)) types.push(...(t as string[]));
      const graph = json['@graph'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(graph)) {
        for (const n of graph) {
          if (typeof n['@type'] === 'string') types.push(n['@type']);
        }
      }
    } catch { /* ignore unparseable */ } // catch-ok: malformed JSON-LD on third-party pages
  });
  return Array.from(new Set(types));
}

function plainText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

export async function generateLeanSchema(input: LeanGeneratorInput): Promise<LeanGeneratorOutput> {
  // Fix 1: strip trailing slashes from baseUrl to prevent //path canonical URLs
  const baseUrl = input.baseUrl.replace(/\/+$/, '');

  const businessKind = input.workspace.businessProfile?.address ? 'local' : 'unknown';
  const classified = classifyPage(`${baseUrl}${input.pageMeta.publishedPath}`, baseUrl, { businessKind });

  // Fix 2: warn when HTML is empty — existing-schema detection returns [] silently
  if (!input.html || input.html.trim().length === 0) {
    log.debug({ pageId: input.pageId }, 'lean schema generated without HTML — existing-schema detection returned empty; downstream consumers should treat as best-effort');
  }

  // Page data — deterministic
  let pageData = extractPageData({
    pageMeta: input.pageMeta,
    html: input.html,
    baseUrl,
    workspace: input.workspace,
  });

  // Surgical AI: only if no description was found
  if (!pageData.description) {
    const aiDescription = await extractDescription({
      existingDescription: undefined,
      title: pageData.title,
      pageBody: plainText(input.html),
      workspace: input.workspace,
    });
    if (aiDescription) {
      pageData = { ...pageData, description: aiDescription };
    }
  }

  // Build template by kind
  let schema: Record<string, unknown>;
  let reason: string;
  switch (classified.kind) {
    case 'Homepage':
      if (classified.primaryType === 'LocalBusiness') {
        schema = buildLocalBusinessSchema({
          baseUrl,
          pageData,
          businessProfile: input.workspace.businessProfile,
        });
        reason = 'Local business homepage — LocalBusiness with verified contact info.';
      } else {
        schema = buildHomepageSchema({ baseUrl, pageData });
        reason = 'Homepage — Organization + WebSite (sitewide entities).';
      }
      break;
    case 'BlogPosting':
      schema = buildArticleSchema({ baseUrl, pageData }, 'BlogPosting');
      reason = 'Blog post — BlogPosting with author/publisher/dates.';
      break;
    case 'CaseStudy':
      schema = buildArticleSchema({ baseUrl, pageData }, 'Article');
      reason = 'Case study — Article (not Service) with about="Case study".';
      break;
    case 'Service':
      schema = buildServiceSchema({ baseUrl, pageData });
      reason = 'Service detail page — Service with provider reference.';
      break;
    case 'AboutPage':
      schema = buildAboutPageSchema({ baseUrl, pageData });
      reason = 'About page — AboutPage referencing Organization.';
      break;
    case 'ContactPage':
      schema = buildContactPageSchema({ baseUrl, pageData });
      reason = 'Contact page — ContactPage.';
      break;
    case 'BlogIndex':
    case 'CaseStudyIndex':
    case 'ServiceIndex':
      schema = buildCollectionPageSchema({ baseUrl, pageData });
      reason = `${classified.kind.replace('Index', '')} index — CollectionPage.`;
      break;
    case 'Legal':
    case 'WebPage':
    default:
      schema = buildWebPageSchema({ baseUrl, pageData });
      reason = 'Generic page — WebPage with breadcrumb.';
      break;
  }

  // Suppress unused — buildProductSchema is exported but not yet wired into a kind.
  // Reserved for future Product page kind in the intelligence-layer follow-up.
  void buildProductSchema;

  // Validate
  const validationErrors = validateLeanSchema(schema, classified.primaryType);

  // Surgical FAQ enrichment: if the page has accordion FAQ structure, append a FAQPage node.
  const faqPairs = await extractFaq(input.html || '');
  if (faqPairs.length >= 2) {
    const faqNode = {
      '@type': 'FAQPage',
      '@id': `${pageData.canonicalUrl}#faq`,
      'mainEntity': faqPairs.map(pair => ({
        '@type': 'Question',
        'name': pair.question,
        'acceptedAnswer': { '@type': 'Answer', 'text': pair.answer },
      })),
    };
    ((schema['@graph'] as Array<Record<string, unknown>>)).push(faqNode);
    // Re-run validator to surface any FAQPage validation issues
    const newErrors = validateLeanSchema(schema, classified.primaryType);
    if (newErrors.length > 0) {
      // FAQPage append broke something — log and don't include
      log.debug({ pageId: input.pageId, errors: newErrors }, 'FAQPage extraction produced invalid schema; skipping');
      (schema['@graph'] as Array<Record<string, unknown>>).pop();
    }
  }

  // Fix 3: compute rich results eligibility and pass through to caller
  const richResultsEligibility = checkRichResultsEligibility(schema);

  // Determine declared types for the suggestion `type` field
  const graph = (schema['@graph'] as Array<Record<string, unknown>>) ?? [];
  const declaredTypes = graph.map(n => n['@type']).filter((t): t is string => typeof t === 'string');

  return {
    pageId: input.pageId,
    pageTitle: pageData.title,
    slug: input.pageMeta.slug,
    url: pageData.canonicalUrl,
    existingSchemas: input.existingSchemas ?? detectExistingSchemas(input.html),
    suggestedSchemas: [
      {
        type: declaredTypes.join(' + '),
        reason,
        priority: 'high',
        template: schema,
      },
    ],
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    richResultsEligibility: richResultsEligibility.length > 0 ? richResultsEligibility : undefined,
  };
}
