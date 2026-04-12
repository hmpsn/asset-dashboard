// server/blueprint-generator.ts
/**
 * Blueprint Generator — AI-powered site blueprint generation.
 *
 * Uses Claude Sonnet 4 for strategic page recommendations and
 * GPT-4.1-mini for keyword clustering/assignment.
 */
import { randomUUID } from 'node:crypto';
import { callAnthropic } from './anthropic-helpers.js';
import { parseJsonFallback } from './db/json-validation.js';
import { getKeywordOverview, getDomainOrganicKeywords } from './semrush.js';
import { getBrandscript } from './brandscript.js';
import {
  createBlueprint,
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

// ── Default Section Plans ────────────────────────────────────────────────────
// Maps page type to an ordered list of section plan items (no `id` — UUIDs
// are assigned at runtime by getDefaultSectionPlan()).

const DEFAULT_SECTION_PLANS: Record<string, Omit<SectionPlanItem, 'id'>[]> = {
  homepage: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Lead with the transformation the customer wants', seoNote: 'Primary keyword in H1', wordCountTarget: 150, order: 0 },
    { sectionType: 'problem', narrativeRole: 'problem', brandNote: 'Name the external and internal problems your customer faces', seoNote: 'Secondary keywords naturally woven in', wordCountTarget: 200, order: 1 },
    { sectionType: 'solution', narrativeRole: 'guide', brandNote: 'Position as the guide — empathy + authority', seoNote: 'Service-related keywords', wordCountTarget: 200, order: 2 },
    { sectionType: 'process', narrativeRole: 'plan', brandNote: 'Show simple steps to engage — make it easy', seoNote: 'How-it-works related terms', wordCountTarget: 150, order: 3 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Show the transformation through customer stories', seoNote: 'Location + service keywords in testimonial context', wordCountTarget: 200, order: 4 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Clear primary CTA + softer secondary option', seoNote: 'Branded terms', wordCountTarget: 100, order: 5 },
  ],
  service: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Service-specific hook — what transformation does this service deliver', seoNote: 'Primary service keyword in H1', wordCountTarget: 150, order: 0 },
    { sectionType: 'problem', narrativeRole: 'problem', brandNote: 'Pain points specific to this service need', seoNote: 'Problem-aware keywords', wordCountTarget: 200, order: 1 },
    { sectionType: 'features-benefits', narrativeRole: 'guide', brandNote: 'What you offer and why it matters — benefits over features', seoNote: 'Feature and benefit keywords', wordCountTarget: 300, order: 2 },
    { sectionType: 'process', narrativeRole: 'plan', brandNote: 'Step-by-step process for this service', seoNote: 'Process-related long-tail keywords', wordCountTarget: 200, order: 3 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Address top objections and questions', seoNote: 'Question keywords — people also ask', wordCountTarget: 300, order: 4 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Service-specific testimonials or case studies', seoNote: 'Service + location keywords in social proof', wordCountTarget: 200, order: 5 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Service-specific call to action', seoNote: 'Branded + service terms', wordCountTarget: 100, order: 6 },
  ],
  about: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Who are you and why should they trust you', seoNote: 'Brand name + location keywords', wordCountTarget: 150, order: 0 },
    { sectionType: 'content-body', narrativeRole: 'guide', brandNote: 'Origin story — why this business exists', seoNote: 'Brand story keywords', wordCountTarget: 300, order: 1 },
    { sectionType: 'about-team', narrativeRole: 'authority', brandNote: 'Team credentials and personalities', seoNote: 'Team member names + titles for E-E-A-T', wordCountTarget: 200, order: 2 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Trust signals — awards, certifications, testimonials', seoNote: 'Authority keywords', wordCountTarget: 150, order: 3 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Invite them to take the next step', seoNote: 'Branded terms', wordCountTarget: 100, order: 4 },
  ],
  location: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Location-specific hook — serving this community', seoNote: 'Service + city keyword in H1', wordCountTarget: 150, order: 0 },
    { sectionType: 'features-benefits', narrativeRole: 'guide', brandNote: 'Services available at this location', seoNote: 'Location-specific service keywords', wordCountTarget: 250, order: 1 },
    { sectionType: 'location-info', narrativeRole: 'plan', brandNote: 'Address, hours, directions, parking — make it easy', seoNote: 'NAP consistency, local keywords', wordCountTarget: 150, order: 2 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Location-specific reviews', seoNote: 'Location + review keywords', wordCountTarget: 200, order: 3 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Location-specific FAQs', seoNote: 'Local question keywords', wordCountTarget: 250, order: 4 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Location-specific CTA — book at this location', seoNote: 'Location + action keywords', wordCountTarget: 100, order: 5 },
  ],
  contact: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Welcoming, low-friction — make reaching out feel easy', seoNote: 'Contact + brand keywords', wordCountTarget: 100, order: 0 },
    { sectionType: 'contact-form', narrativeRole: 'call-to-action', brandNote: 'Simple form — name, email, message at minimum', seoNote: 'Contact page structured data', wordCountTarget: 50, order: 1 },
    { sectionType: 'location-info', narrativeRole: 'plan', brandNote: 'Address, phone, email, hours', seoNote: 'NAP consistency', wordCountTarget: 100, order: 2 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Quick answers to common questions before they ask', seoNote: 'FAQ schema keywords', wordCountTarget: 200, order: 3 },
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

  // ── 2. Optional domain keyword context from SEMrush ───────────────────────
  let keywordContext = '';
  if (input.domain) {
    try {
      const organicKeywords = await getDomainOrganicKeywords(input.domain, workspaceId, 50);
      if (organicKeywords.length > 0) {
        keywordContext = `\n\nExisting organic keywords for ${input.domain}:\n` +
          organicKeywords.map((k) => `- "${k.keyword}" (vol: ${k.volume}, diff: ${k.difficulty})`).join('\n');
      }
    } catch (err) {
      log.warn({ err, domain: input.domain }, 'Failed to fetch domain keywords — continuing without');
    }
  }

  // ── 3. Build AI prompt and call Claude Sonnet 4 ───────────────────────────
  const prompt = `You are a web strategist for a design studio. Based on the following business context, recommend a complete list of pages for a new website.

INDUSTRY: ${input.industryType}
${input.targetPageCount ? `TARGET PAGE COUNT: approximately ${input.targetPageCount} pages (client scope)` : ''}
${input.includeLocationPages ? `LOCATIONS: This is a multi-location business with ${input.locationCount ?? 'multiple'} locations. Include location pages.` : ''}
${input.includeContentPages ? 'Include content/blog pages for SEO opportunity.' : ''}

${brandContext ? `BRAND CONTEXT (from discovery):\n${brandContext}` : ''}
${keywordContext}

For each recommended page, provide:
1. name — human-readable page name
2. pageType — one of: homepage, about, contact, faq, testimonials, blog, service, location, product, pillar, resource, pricing-page, custom
3. scope — "included" for essential pages, "recommended" for nice-to-have / upsell opportunities
4. isCollection — true if this is a CMS collection (e.g., individual service pages, blog posts, locations), false for static pages
5. primaryKeyword — suggested primary SEO keyword for this page
6. secondaryKeywords — 2-4 secondary keywords
7. rationale — brief explanation of why this page is recommended

Return ONLY a JSON array of objects with these fields. No markdown, no explanation outside the JSON.`;

  const aiResponse = await callAnthropic({
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4000,
    messages: [{ role: 'user', content: prompt }],
    feature: 'blueprint-generation',
    workspaceId,
  });

  // ── 4. Parse AI response ───────────────────────────────────────────────────
  const text = aiResponse.text;
  // Strip markdown code fences if present — then use parseJsonFallback (bare JSON.parse fails pr-check)
  const jsonStr = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  const generatedEntries = parseJsonFallback<GeneratedBlueprintEntry[]>(jsonStr, []);
  if (generatedEntries.length === 0) {
    log.error({ workspaceId, raw: text.slice(0, 500) }, 'Blueprint AI response parsed to empty array');
    throw new Error('Failed to generate blueprint — AI response was not valid JSON or returned empty array');
  }

  // ── 5. Create the blueprint record ────────────────────────────────────────
  const blueprint = createBlueprint({
    workspaceId,
    name: `${input.industryType} Site Blueprint`,
    brandscriptId: input.brandscriptId,
    industryType: input.industryType,
  });

  // Store generation inputs reference (updateBlueprint currently stores name/status/brandscriptId/industryType/notes)
  updateBlueprint(workspaceId, blueprint.id, {});

  // ── 6. Map entries with section plans and bulk-insert ─────────────────────
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

  // bulkAddEntries(blueprintId, entries) — first param is blueprintId, NOT workspaceId
  const insertedEntries = bulkAddEntries(workspaceId, blueprint.id, entriesToInsert);

  // Mark blueprint as active now that entries are inserted
  updateBlueprint(workspaceId, blueprint.id, { status: 'active' });

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
 * Non-blocking keyword enrichment: fetches SEMrush metrics for all primary
 * keywords in the blueprint and logs the results. Volume/difficulty data is
 * stored in the SEMrush cache layer — a future phase will write it back to
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
    const metrics = await getKeywordOverview(keywords, workspaceId);
    log.info(
      { blueprintId, keywordCount: keywords.length, metricsReturned: metrics.length },
      'Blueprint keyword enrichment complete',
    );
  } catch (err) {
    log.warn({ err, blueprintId }, 'SEMrush keyword overview failed during enrichment');
  }
}

// ── Re-exports ───────────────────────────────────────────────────────────────
// getBlueprint is imported above and re-exported for convenience
export { getBlueprint };
