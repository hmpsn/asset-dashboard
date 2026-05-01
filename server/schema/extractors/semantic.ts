/**
 * Semantic page data extractor.
 * Uses Haiku 4.5 with tool_use (structured output) to extract business entities
 * from page content. Always returns; never throws — callers use {} fallback.
 */
import * as cheerio from 'cheerio';
import { callAnthropicWithTools, isAnthropicConfigured } from '../../anthropic-helpers.js';
import type { AnthropicToolDefinition } from '../../anthropic-helpers.js';
import type { SemanticPageData } from '../../../shared/types/page-elements.js';
import type { BusinessProfile } from '../data-sources.js';
import { createLogger } from '../../logger.js';

const log = createLogger('schema/extractors/semantic');

const SOCIAL_DOMAINS = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'yelp.com', 'tiktok.com', 'youtube.com',
  'google.com', 'bbb.org',
];

const MAX_TEXT_CHARS = 24_000;
const ALLOWED_SAME_AS_DOMAINS = new Set(SOCIAL_DOMAINS);

function stripToMainContent(html: string): string {
  const $ = cheerio.load(html);
  $('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], script, style, noscript').remove();
  const main = $('main, [role="main"], article, #content, .content').first();
  const text = (main.length ? main : $('body')).text();
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function extractSocialHrefs(html: string): string[] {
  const $ = cheerio.load(html);
  const hrefs: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (SOCIAL_DOMAINS.some(domain => href.includes(domain))) {
      hrefs.push(href);
    }
  });
  return [...new Set(hrefs)];
}

function extractMediaSrcs(html: string): string[] {
  const $ = cheerio.load(html);
  const srcs: string[] = [];
  $('iframe[src], video[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (src) srcs.push(src);
  });
  return srcs;
}

const EXTRACT_TOOL: AnthropicToolDefinition = {
  name: 'extract_semantic_data',
  description: 'Extract structured business data from page content for schema.org enrichment.',
  input_schema: {
    type: 'object',
    properties: {
      phone: { type: 'string' },
      email: { type: 'string' },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postalCode: { type: 'string' },
          country: { type: 'string' },
        },
        required: ['street', 'city', 'state'],
      },
      geo: {
        type: 'object',
        properties: { latitude: { type: 'number' }, longitude: { type: 'number' } },
        required: ['latitude', 'longitude'],
      },
      hours: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dayOfWeek: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            opens: { type: 'string', description: 'HH:MM format' },
            closes: { type: 'string', description: 'HH:MM format' },
          },
          required: ['dayOfWeek', 'opens', 'closes'],
        },
      },
      aggregateRating: {
        type: 'object',
        properties: {
          ratingValue: { type: 'number' },
          reviewCount: { type: 'number' },
          platform: { type: 'string' },
        },
        required: ['ratingValue'],
      },
      services: { type: 'array', items: { type: 'string' } },
      staff: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            credentials: { type: 'string' },
            jobTitle: { type: 'string' },
            image: { type: 'string' },
          },
          required: ['name'],
        },
      },
      offers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'string' },
            priceCurrency: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name'],
        },
      },
      priceRange: { type: 'string', description: '$, $$, $$$ only' },
      faq: {
        type: 'array',
        items: {
          type: 'object',
          properties: { question: { type: 'string' }, answer: { type: 'string' } },
          required: ['question', 'answer'],
        },
      },
      primaryImage: { type: 'string' },
      videos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            contentUrl: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            thumbnailUrl: { type: 'string' },
          },
          required: ['contentUrl'],
        },
      },
      sameAs: { type: 'array', items: { type: 'string' } },
      areaServed: { type: 'array', items: { type: 'string' } },
      foundingDate: { type: 'string' },
      numberOfLocations: { type: 'number' },
      awards: { type: 'array', items: { type: 'string' } },
      highlights: { type: 'array', items: { type: 'string' } },
      certifications: { type: 'array', items: { type: 'string' } },
      languagesSpoken: { type: 'array', items: { type: 'string' } },
      accessibility: { type: 'array', items: { type: 'string' } },
      primaryAction: { type: 'string', enum: ['book', 'contact', 'buy', 'learn', 'apply', 'quote'] },
      pageCategory: { type: 'string' },
    },
    required: [],
  },
};

function validateExtracted(raw: Record<string, unknown>, strippedText: string): SemanticPageData {
  const result = { ...raw } as SemanticPageData;

  // Phone: must appear verbatim in stripped text
  if (result.phone) {
    const digits = result.phone.replace(/\D/g, '');
    // Mirror stripToMainContent's whitespace collapsing (\s+ → ' ') so phones with
    // double-space or non-breaking-space separators match correctly.
    if (digits.length < 7 || !strippedText.includes(result.phone.replace(/\s+/g, ' '))) {
      delete result.phone;
    }
  }

  // Postal code format — only delete the postalCode field, not the entire address.
  // Non-US postal codes (UK, Canada, Australia, etc.) fail the US-only regex but
  // the street/city/state fields are still valid and useful.
  if (result.address?.postalCode) {
    if (!/^\d{5}(-\d{4})?$/.test(result.address.postalCode)) {
      delete result.address.postalCode;
    }
  }

  // Rating value: 0–5
  if (result.aggregateRating) {
    const rv = result.aggregateRating.ratingValue;
    const rc = result.aggregateRating.reviewCount;
    if (typeof rv !== 'number' || rv < 0 || rv > 5) {
      delete result.aggregateRating;
    } else if (rc !== undefined && (typeof rc !== 'number' || rc <= 0 || !Number.isInteger(rc))) {
      delete result.aggregateRating.reviewCount;
    }
  }

  // Hours: opens/closes must be valid HH:MM (0-23 hours, 0-59 minutes)
  if (result.hours) {
    const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
    result.hours = result.hours.filter(h => TIME_RE.test(h.opens) && TIME_RE.test(h.closes));
    if (result.hours.length === 0) delete result.hours;
  }

  // sameAs: only allowed social domains, plus google.com/maps path specifically
  if (result.sameAs) {
    result.sameAs = result.sameAs.filter(url => {
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace(/^www\./, '');
        const registrable = hostname.split('.').slice(-2).join('.');
        if (ALLOWED_SAME_AS_DOMAINS.has(hostname) || ALLOWED_SAME_AS_DOMAINS.has(registrable)) return true;
        // google.com/maps — only accept URLs whose path starts with /maps
        if ((hostname === 'google.com' || hostname.endsWith('.google.com')) && parsed.pathname.startsWith('/maps')) return true;
        return false;
      } catch { return false; }
    });
    if (result.sameAs.length === 0) delete result.sameAs;
  }

  return result;
}

export async function extractSemanticData(
  html: string,
  options: {
    pageBaseUrl: string;
    workspaceBusinessProfile?: BusinessProfile | null;
    workspaceId?: string;
  },
): Promise<SemanticPageData> {
  if (!isAnthropicConfigured()) return {};
  try {
    const strippedText = stripToMainContent(html);
    const socialHrefs = extractSocialHrefs(html);
    const mediaSrcs = extractMediaSrcs(html);

    const userMessage = [
      `Page URL: ${options.pageBaseUrl}`,
      '',
      '## Page Content (main section only)',
      strippedText,
      socialHrefs.length > 0 ? `\n## Social/Directory Links Found\n${socialHrefs.join('\n')}` : '',
      mediaSrcs.length > 0 ? `\n## Embedded Media Sources\n${mediaSrcs.join('\n')}` : '',
    ].filter(Boolean).join('\n');

    const { toolInput } = await callAnthropicWithTools({
      model: 'claude-haiku-4-5-20251001',
      system: `You extract structured business data from webpage content for schema.org enrichment.
CRITICAL: Return null/omit for any field not clearly and explicitly present on the page.
Do NOT infer, assume, or guess. A missing phone number is better than a wrong one.
For sameAs: only include URLs from the "Social/Directory Links Found" section — do not fabricate URLs.`,
      userMessage,
      tools: [EXTRACT_TOOL],
      forceTool: 'extract_semantic_data',
      maxTokens: 2048,
      feature: 'semantic-extraction',
      workspaceId: options.workspaceId,
    });

    return validateExtracted(toolInput, strippedText);
  } catch (err) {
    log.warn({ err, pageBaseUrl: options.pageBaseUrl }, 'extractSemanticData failed — returning empty');
    return {};
  }
}
