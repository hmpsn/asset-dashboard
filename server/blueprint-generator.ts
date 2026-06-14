// server/blueprint-generator.ts
/**
 * Blueprint Generator — AI-powered site blueprint generation.
 *
 * Uses Claude Sonnet 4 for strategic page recommendations and
 * GPT-4.1-mini for keyword clustering/assignment.
 */
import { randomUUID } from 'node:crypto';
import { stripCodeFences } from './helpers.js';
import { callAI } from './ai.js';
import { parseJsonFallback } from './db/json-validation.js';
import { z } from 'zod';
import { getBrandscript } from './brandscript.js';
import { resolveWorkspaceLocationCode } from './local-seo.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { buildWorkspaceIntelligence, formatForPrompt } from './workspace-intelligence.js';
import {
  createBlueprint,
  deleteBlueprint,
  bulkAddEntries,
  updateBlueprint,
  updateEntry,
  getBlueprint,
} from './page-strategy.js';
import type {
  SiteBlueprint,
  BlueprintGenerationInput,
  GeneratedBlueprintEntry,
  SectionPlanItem,
  BlueprintPageType,
} from '../shared/types/page-strategy.js';
import { generateBrief } from './content-brief.js';
import { createLogger } from './logger.js';

const log = createLogger('blueprint-generator');

const blueprintPageTypeSchema = z.enum([
  'blog',
  'landing',
  'service',
  'location',
  'product',
  'pillar',
  'resource',
  'provider-profile',
  'procedure-guide',
  'pricing-page',
  'homepage',
  'about',
  'contact',
  'faq',
  'testimonials',
  'custom',
]);

const generatedBlueprintEntrySchema = z.object({
  name: z.string().trim().min(1),
  pageType: blueprintPageTypeSchema,
  scope: z.enum(['included', 'recommended']),
  isCollection: z.boolean(),
  primaryKeyword: z.string().trim().min(1).optional(),
  secondaryKeywords: z.array(z.string().trim().min(1)).optional(),
  rationale: z.string().optional(),
});

type ValidatedGeneratedBlueprintEntry = z.infer<typeof generatedBlueprintEntrySchema>;

export function parseBlueprintGenerationOutput(raw: string): ValidatedGeneratedBlueprintEntry[] {
  const parsed = parseJsonFallback<unknown>(stripCodeFences(raw).trim(), null);
  const result = z.array(generatedBlueprintEntrySchema).min(1).safeParse(parsed);
  if (!result.success) {
    throw new Error('Failed to generate blueprint — AI response failed schema validation');
  }
  return result.data;
}

// ── Default Section Plans ────────────────────────────────────────────────────
// Maps page type to an ordered list of section plan items (no `id` — UUIDs
// are assigned at runtime by getDefaultSectionPlan()).

const DEFAULT_SECTION_PLANS: Record<string, Omit<SectionPlanItem, 'id'>[]> = {
  landing: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Lead with the value proposition and the pain point it resolves', seoNote: 'Primary keyword in H1', wordCountTarget: 140, order: 0 },
    { sectionType: 'problem', narrativeRole: 'problem', brandNote: 'Make the cost of inaction clear without article-style setup', seoNote: 'Problem-aware terms only where natural', wordCountTarget: 170, order: 1 },
    { sectionType: 'solution', narrativeRole: 'guide', brandNote: 'Show the offer, outcome, and differentiator in one focused section', seoNote: 'Primary and secondary terms naturally woven in', wordCountTarget: 220, order: 2 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Use the strongest proof or trust signal available', seoNote: 'Proof terms only when supported by context', wordCountTarget: 170, order: 3 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'One clear primary action with a short reassurance line', seoNote: 'Branded terms only if natural', wordCountTarget: 120, order: 4 },
  ],
  homepage: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Lead with the transformation the customer wants', seoNote: 'Primary keyword in H1', wordCountTarget: 150, order: 0 },
    { sectionType: 'problem', narrativeRole: 'problem', brandNote: 'Name the external and internal problems your customer faces', seoNote: 'Secondary keywords naturally woven in', wordCountTarget: 200, order: 1 },
    { sectionType: 'solution', narrativeRole: 'guide', brandNote: 'Position as the guide — empathy + authority', seoNote: 'Service-related keywords', wordCountTarget: 200, order: 2 },
    { sectionType: 'process', narrativeRole: 'plan', brandNote: 'Show simple steps to engage — make it easy', seoNote: 'How-it-works related terms', wordCountTarget: 150, order: 3 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Show the transformation through customer stories', seoNote: 'Location + service keywords in testimonial context', wordCountTarget: 200, order: 4 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Clear primary CTA + softer secondary option', seoNote: 'Branded terms', wordCountTarget: 100, order: 5 },
  ],
  service: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Service-specific hook — what transformation does this service deliver', seoNote: 'Primary service keyword in H1', wordCountTarget: 140, order: 0 },
    { sectionType: 'problem', narrativeRole: 'problem', brandNote: 'Pain points specific to this service need', seoNote: 'Problem-aware terms only where natural', wordCountTarget: 160, order: 1 },
    { sectionType: 'features-benefits', narrativeRole: 'guide', brandNote: 'What is included, who it fits, and why it matters — benefits over features', seoNote: 'Service terms and differentiators only where supported', wordCountTarget: 260, order: 2 },
    { sectionType: 'process', narrativeRole: 'plan', brandNote: 'Simple next steps for engaging this service', seoNote: 'Process terms only if they match real buyer questions', wordCountTarget: 200, order: 3 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Answer buying objections, include proof where available, and close with one CTA', seoNote: 'Question terms only where helpful', wordCountTarget: 220, order: 4 },
  ],
  about: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Who are you and why should they trust you', seoNote: 'Brand name + location keywords', wordCountTarget: 150, order: 0 },
    { sectionType: 'content-body', narrativeRole: 'guide', brandNote: 'Origin story — why this business exists', seoNote: 'Brand story keywords', wordCountTarget: 300, order: 1 },
    { sectionType: 'about-team', narrativeRole: 'authority', brandNote: 'Team credentials and personalities', seoNote: 'Team member names + titles for E-E-A-T', wordCountTarget: 200, order: 2 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Trust signals — awards, certifications, testimonials', seoNote: 'Authority keywords', wordCountTarget: 150, order: 3 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Invite them to take the next step', seoNote: 'Branded terms', wordCountTarget: 100, order: 4 },
  ],
  location: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Location-specific hook — serving this community', seoNote: 'Service and place terms in the H1 when natural', wordCountTarget: 130, order: 0 },
    { sectionType: 'features-benefits', narrativeRole: 'guide', brandNote: 'Services available at this location and who they help', seoNote: 'Local service terms only where supported by context', wordCountTarget: 220, order: 1 },
    { sectionType: 'location-info', narrativeRole: 'plan', brandNote: 'Useful visit/contact facts such as address, hours, directions, or parking when provided', seoNote: 'Place terms only where natural', wordCountTarget: 150, order: 2 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Location-specific reviews, proof, or community relevance', seoNote: 'Review/place terms only when supported', wordCountTarget: 170, order: 3 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'One local contact or booking close', seoNote: 'Action terms only where natural', wordCountTarget: 120, order: 4 },
  ],
  contact: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Welcoming, low-friction — make reaching out feel easy', seoNote: 'Contact + brand keywords', wordCountTarget: 100, order: 0 },
    { sectionType: 'contact-form', narrativeRole: 'call-to-action', brandNote: 'Simple form — name, email, message at minimum', seoNote: 'Contact intent terms only where natural', wordCountTarget: 50, order: 1 },
    { sectionType: 'location-info', narrativeRole: 'plan', brandNote: 'Address, phone, email, or hours when provided', seoNote: 'Brand and contact terms only where natural', wordCountTarget: 100, order: 2 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Quick answers to common questions before they ask', seoNote: 'Concise contact questions only where helpful', wordCountTarget: 200, order: 3 },
  ],
  faq: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Helpful framing — we have answers', seoNote: 'FAQ + brand keywords', wordCountTarget: 100, order: 0 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Grouped by topic — address real objections, not just softballs', seoNote: 'Question keywords — people also ask', wordCountTarget: 500, order: 1 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Still have questions? Reach out.', seoNote: 'Contact keywords', wordCountTarget: 100, order: 2 },
  ],
  testimonials: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Social proof headline — real results', seoNote: 'Reviews + brand keywords', wordCountTarget: 100, order: 0 },
    { sectionType: 'testimonials', narrativeRole: 'success-transformation', brandNote: 'Curated testimonials showing diverse transformations', seoNote: 'Service + result keywords in testimonial context', wordCountTarget: 400, order: 1 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Ready to be our next success story?', seoNote: 'Branded CTA terms', wordCountTarget: 100, order: 2 },
  ],
  blog: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Article headline and intro — hook the reader', seoNote: 'Primary keyword in H1 and first paragraph', wordCountTarget: 150, order: 0 },
    { sectionType: 'content-body', narrativeRole: 'guide', brandNote: 'Main article content — informative, authoritative, on-brand', seoNote: 'Primary + secondary keywords distributed through headings and body', wordCountTarget: 1200, order: 1 },
    { sectionType: 'related-resources', narrativeRole: 'plan', brandNote: 'Guide them to related content or next steps', seoNote: 'Internal link keywords', wordCountTarget: 100, order: 2 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Convert readers to leads', seoNote: 'Branded CTA terms', wordCountTarget: 100, order: 3 },
  ],
};

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Return the default section plan for a given page type, with runtime UUIDs
 * assigned to each item. Falls back to 'service' for unknown page types.
 */
export function getDefaultSectionPlan(pageType: string): SectionPlanItem[] {
  const template = DEFAULT_SECTION_PLANS[pageType] ?? DEFAULT_SECTION_PLANS['service']!;
  return template.map((s, i) => ({ ...s, id: randomUUID(), order: i }));
}

// ── Main generation function ─────────────────────────────────────────────────

/**
 * Generate a complete SiteBlueprint for a workspace using Claude Sonnet 4
 * for page strategy and SEMrush for keyword context.
 *
 * The returned SiteBlueprint includes all inserted entries with their
 * section plans. Auto-briefs are created synchronously (Phase 3 dependency)
 * — note that this loop can be slow for large blueprints (10+ pages) because
 * each brief makes an AI call. Consider moving to a background queue if
 * latency becomes a bottleneck for large blueprints.
 */
export async function generateBlueprint(
  workspaceId: string,
  input: BlueprintGenerationInput,
): Promise<SiteBlueprint> {
  log.info({ workspaceId, input }, 'Generating blueprint');
  const workspace = getWorkspace(workspaceId);
  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext', 'insights', 'learnings', 'clientSignals'],
    learningsDomain: 'strategy',
  });

  // ── 1. Optional brandscript context ──────────────────────────────────────
  let brandContext = '';
  if (input.brandscriptId) {
    const brandscript = getBrandscript(workspaceId, input.brandscriptId);
    if (brandscript) {
      brandContext = brandscript.sections
        .map((s) => `## ${s.title}\n${s.content ?? '(not yet filled in)'}`)
        .join('\n\n');
    } else {
      log.warn({ workspaceId, brandscriptId: input.brandscriptId }, 'Brandscript not found — proceeding without brand context');
    }
  }

  // ── 2. Optional domain keyword context from configured SEO provider ───────
  let keywordContext = '';
  if (input.domain) {
    try {
      const provider = getConfiguredProvider(workspace?.seoDataProvider);
      const organicKeywords = provider
        ? await provider.getDomainKeywords(input.domain, workspaceId, 50)
        : [];
      if (organicKeywords.length > 0) {
        keywordContext = `\n\nExisting organic keywords for ${input.domain}:\n` +
          organicKeywords.map((k) => `- "${k.keyword}" (vol: ${k.volume}, diff: ${k.difficulty})`).join('\n');
      }
    } catch (err) {
      log.warn({ err, domain: input.domain }, 'Failed to fetch domain keywords — continuing without');
    }
  }

  const intelligenceContext = formatForPrompt(intel, {
    verbosity: 'compact',
    sections: ['insights', 'learnings', 'clientSignals'],
    learningsDomain: 'strategy',
    tokenBudget: 2000,
  });

  // ── 3. Build AI prompt and call Claude Sonnet 4 ───────────────────────────
  const prompt = `You are a web strategist for a design studio. Based on the following business context, recommend a complete list of pages for a new website.

INDUSTRY: ${input.industryType}
${input.targetPageCount ? `TARGET PAGE COUNT: approximately ${input.targetPageCount} pages (client scope)` : ''}
${input.includeLocationPages ? `LOCATIONS: This is a multi-location business with ${input.locationCount ?? 'multiple'} locations. Include location pages.` : ''}
${input.includeContentPages ? 'Include content/blog pages for SEO opportunity.' : ''}

${brandContext ? `BRAND CONTEXT (from discovery):\n${brandContext}` : ''}
${keywordContext}
${intelligenceContext ? `\n\nINTELLIGENCE CONTEXT:\n${intelligenceContext}` : ''}

For each recommended page, provide:
1. name — human-readable page name
2. pageType — one of: homepage, about, contact, faq, testimonials, blog, service, location, product, pillar, resource, pricing-page, custom
3. scope — "included" for essential pages, "recommended" for nice-to-have / upsell opportunities
4. isCollection — true if this is a CMS collection (e.g., individual service pages, blog posts, locations), false for static pages
5. primaryKeyword — suggested primary SEO keyword for this page
6. secondaryKeywords — 2-4 secondary keywords
7. rationale — brief explanation of why this page is recommended

Return ONLY a JSON array of objects with these fields. No markdown, no explanation outside the JSON.`;

  const aiResponse = await callAI({
    operation: 'blueprint-generation',
    provider: 'anthropic',
    maxTokens: 4000,
    messages: [{ role: 'user', content: prompt }],
    workspaceId,
  });

  // ── 4. Parse AI response ───────────────────────────────────────────────────
  const text = aiResponse.text;
  let generatedEntries: ValidatedGeneratedBlueprintEntry[];
  try {
    generatedEntries = parseBlueprintGenerationOutput(text);
  } catch (err) {
    log.error({ err, workspaceId, raw: text.slice(0, 500) }, 'Blueprint AI response failed validation');
    throw new Error('Failed to generate blueprint — AI response was not valid JSON or returned empty array');
  }

  // ── 5. Create the blueprint record ────────────────────────────────────────
  const blueprint = createBlueprint({
    workspaceId,
    name: `${input.industryType} Site Blueprint`,
    brandscriptId: input.brandscriptId,
    industryType: input.industryType,
    generationInputs: input,
  });

  // ── 6. Map entries with section plans and bulk-insert ─────────────────────
  // Wrap in try/catch so a bulk-insert failure deletes the already-created
  // blueprint rather than leaving an orphaned draft with zero entries.
  let insertedEntries: ReturnType<typeof bulkAddEntries>;
  try {
    const entriesToInsert: GeneratedBlueprintEntry[] = generatedEntries.map((entry) => ({
      name: entry.name,
      pageType: entry.pageType as BlueprintPageType,
      scope: (entry.scope === 'included' || entry.scope === 'recommended' ? entry.scope : 'included') as 'included' | 'recommended',
      isCollection: Boolean(entry.isCollection),
      primaryKeyword: entry.primaryKeyword,
      secondaryKeywords: entry.secondaryKeywords,
      sectionPlan: getDefaultSectionPlan(entry.pageType),
      rationale: entry.rationale ?? '',
    }));

    insertedEntries = bulkAddEntries(workspaceId, blueprint.id, entriesToInsert);
    // Mark blueprint as active now that entries are inserted
    updateBlueprint(workspaceId, blueprint.id, { status: 'active' });
  } catch (err) {
    // Clean up the orphaned draft blueprint before re-throwing
    try {
      deleteBlueprint(workspaceId, blueprint.id);
    } catch (cleanupErr) {
      log.warn({ cleanupErr, blueprintId: blueprint.id }, 'Failed to clean up orphaned blueprint after generation error');
    }
    throw err;
  }

  // ── 7. AUTO-BRIEF CREATION (Phase 3 dependency) ───────────────────────────
  // NOTE: Each iteration calls generateBrief(), which makes an OpenAI call.
  // For large blueprints (10+ pages) this loop can take 30–90+ seconds.
  // If latency becomes a bottleneck, consider moving this to a background queue.
  for (const entry of insertedEntries) {
    try {
      const brief = await generateBrief(workspaceId, entry.primaryKeyword ?? entry.name, {
        blueprintEntryId: entry.id,
        pageType: entry.pageType,
        keywordLocked: false,
      });
      // Update the entry's briefId FK (links blueprint entry ↔ content brief)
      updateEntry(workspaceId, blueprint.id, entry.id, { briefId: brief.id });
    } catch (err) {
      log.warn({ err, entryId: entry.id }, 'Auto-brief creation failed — entry usable without brief');
    }
  }

  // ── 8. Keyword enrichment (non-blocking) ──────────────────────────────────
  enrichKeywords(workspaceId, blueprint.id, insertedEntries).catch((err: unknown) => {
    log.warn({ err, blueprintId: blueprint.id }, 'Background keyword enrichment failed');
  });

  // ── 9. Return fresh blueprint with entries ────────────────────────────────
  const result = getBlueprint(workspaceId, blueprint.id);
  if (!result) {
    throw new Error(`Blueprint ${blueprint.id} not found after creation`);
  }
  return result;
}

// ── Private keyword enrichment ───────────────────────────────────────────────

/**
 * Non-blocking keyword enrichment: fetches provider metrics for all primary
 * keywords in the blueprint and logs the results. Volume/difficulty data is
 * stored in the provider cache layer — a future phase will write it back to
 * the entry records directly.
 */
async function enrichKeywords(
  workspaceId: string,
  blueprintId: string,
  entries: Array<{ id: string; primaryKeyword?: string }>,
): Promise<void> {
  const keywords = entries
    .map((e) => e.primaryKeyword)
    .filter((k): k is string => !!k);

  if (keywords.length === 0) return;

  try {
    const workspace = getWorkspace(workspaceId);
    const provider = getConfiguredProvider(workspace?.seoDataProvider);
    if (!provider) {
      log.info({ blueprintId, keywordCount: keywords.length }, 'Blueprint keyword enrichment skipped — no SEO data provider configured');
      return;
    }
    const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
    const metrics = await provider.getKeywordMetrics(keywords, workspaceId, undefined, locationCode);
    log.info(
      { blueprintId, keywordCount: keywords.length, metricsReturned: metrics.length },
      'Blueprint keyword enrichment complete',
    );
  } catch (err) {
    log.warn({ err, blueprintId }, 'SEO provider keyword overview failed during enrichment');
  }
}

// ── Re-exports ───────────────────────────────────────────────────────────────
// getBlueprint is imported above and re-exported for convenience
export { getBlueprint };
