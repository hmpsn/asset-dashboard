import {
  DEFAULT_CONTENT_GENERATION_STYLE,
  type ContentGenerationStyle,
} from '../shared/types/content.js';

const CONVERSION_DENSE_PAGE_TYPES = new Set(['landing', 'service', 'location', 'homepage', 'product']);

export interface PageTypeOutlineContract {
  targetWords: number;
  minWords: number;
  maxWords: number;
  minSections: number;
  maxSections: number;
  maxSubheadings: number;
  guidance: string;
}

const PAGE_TYPE_OUTLINE_CONTRACTS: Record<string, PageTypeOutlineContract> = {
  landing: {
    targetWords: 900,
    minWords: 800,
    maxWords: 1200,
    minSections: 4,
    maxSections: 5,
    maxSubheadings: 2,
    guidance: `OUTLINE COMPRESSION CONTRACT (landing):
- Build a short conversion page, not an article.
- Use 4-5 useful H2 sections, one primary conversion path, and one closing CTA.
- Subheadings are optional. Use 0-2 only when they improve scanning.`,
  },
  service: {
    targetWords: 1000,
    minWords: 800,
    maxWords: 1100,
    minSections: 4,
    maxSections: 5,
    maxSubheadings: 2,
    guidance: `OUTLINE COMPRESSION CONTRACT (service):
- Build a conversion-dense service page, not a long educational article.
- Use 4-5 useful H2 sections and 800-1,100 total words.
- Include one CTA close only; do not create duplicate "book a call", "next steps", contact, or conclusion sections.
- Subheadings are optional. Use 0-2 only for substantive sections, and none for short CTA/proof/contact sections.`,
  },
  location: {
    targetWords: 900,
    minWords: 700,
    maxWords: 1000,
    minSections: 4,
    maxSections: 5,
    maxSubheadings: 2,
    guidance: `OUTLINE COMPRESSION CONTRACT (location):
- Build a compact location page, not a local SEO article.
- Use 4-5 useful H2 sections and 700-1,000 total words.
- Include local proof and relevance only when provided by context.
- Never teach local SEO mechanics to the reader. Do not include citation/directory housekeeping, address/phone consistency advice, search profile upkeep, structured-data operations, or similar backend SEO tasks.
- Include one local contact/CTA close only; do not repeat contact sections.`,
  },
  product: {
    targetWords: 750,
    minWords: 600,
    maxWords: 1000,
    minSections: 4,
    maxSections: 5,
    maxSubheadings: 2,
    guidance: `OUTLINE COMPRESSION CONTRACT (product):
- Build a concise buyer-decision page, not a product education article.
- Use 4-5 useful H2 sections and one purchase path.
- Subheadings are optional. Use 0-2 only when they help compare benefits, proof, or objections.`,
  },
  homepage: {
    targetWords: 900,
    minWords: 700,
    maxWords: 1100,
    minSections: 4,
    maxSections: 5,
    maxSubheadings: 2,
    guidance: `OUTLINE COMPRESSION CONTRACT (homepage):
- Build a short brand-led conversion page, not an article.
- Use 4-5 useful H2 sections and one primary conversion path.
- Subheadings are optional. Keep proof and CTA sections especially tight.`,
  },
};

const DEFAULT_OUTLINE_CONTRACT = `OUTLINE COMPRESSION CONTRACT:
- Right-size the outline for the page type.
- Do not add sections merely because brand, SEO, or business context is available.
- Brand voice should shape wording and positioning inside the chosen architecture.`;

const PAGE_TYPE_COPY_CONTRACTS: Record<string, string> = {
  blog: `PAGE-TYPE COPY CONTRACT (blog):
- Educational depth is appropriate, but keep examples concrete and avoid padding.
- Brand voice may shape rhythm and point of view; it must not turn the article into a sales page.
- CTAs should be relevant and restrained, usually one clear next step near the close.`,

  landing: `PAGE-TYPE COPY CONTRACT (landing):
- Single conversion path: every section should support one primary action.
- Keep sections short, scannable, and benefit-led; avoid article-style explanations.
- Use brand identity as positioning fuel, not as extra narrative inventory.
- Include one closing CTA block only. Do not create multiple endings.`,

  service: `PAGE-TYPE COPY CONTRACT (service):
- Conversion-dense service page, not a long educational article.
- Prefer 800-1,100 words unless the brief explicitly requires more.
- Cover what the service solves, what is included, process, proof, fit, FAQ, and one CTA.
- Do not add duplicate booking/discovery sections or multiple closing arguments.
- Use brand identity selectively for proof, positioning, and differentiators; do not expand because more brand context is available.`,

  location: `PAGE-TYPE COPY CONTRACT (location):
- Local relevance and proof only; do not teach local SEO mechanics to the reader.
- Prefer 700-1,000 words unless the brief explicitly requires more.
- Reference neighborhoods, service areas, local clients, address/contact facts, or availability only when provided by context.
- Never mention NAP consistency, schema, Google Business Profile hygiene, directory listings, or other SEO operations in public-facing prose.
- Include one local CTA/contact close only. Avoid repeating address, phone, or email in multiple sections.`,

  product: `PAGE-TYPE COPY CONTRACT (product):
- Keep buyer decision density high: benefit, proof, objection, purchase path.
- Use comparisons or tables only when the output format can render valid HTML cleanly.
- Avoid generic feature lists unless each feature maps to a buyer outcome.
- Include one purchase CTA path only.`,

  pillar: `PAGE-TYPE COPY CONTRACT (pillar):
- Long-form depth is expected, but structure must remain navigable.
- Brand voice should add authority and clarity, not promotional repetition.
- Internal links and cluster coverage matter more than repeated CTAs.`,

  resource: `PAGE-TYPE COPY CONTRACT (resource):
- Long-form utility is expected, but the reader should be able to scan and implement.
- Use frameworks, steps, or checklists only when they add practical value.
- Brand voice should make the guidance distinct without making it self-promotional.`,

  homepage: `PAGE-TYPE COPY CONTRACT (homepage):
- Brand-led conversion page, not an article.
- Keep sections tight and oriented around one primary conversion path.
- Use brand identity to clarify positioning and transformation; avoid extended origin-story drift unless the section asks for it.
- Include one final CTA block only.`,

  about: `PAGE-TYPE COPY CONTRACT (about):
- Human brand story is appropriate, but keep the reader's trust decision in view.
- Use mission, values, and team details only when they are concrete and provided by context.
- End with one soft next step.`,

  contact: `PAGE-TYPE COPY CONTRACT (contact):
- Minimize copy. Make contact feel easy and low-friction.
- Include address, hours, phone, or email only when provided by context.
- Do not add SEO explanations or extra brand narrative.`,

  faq: `PAGE-TYPE COPY CONTRACT (faq):
- Answer real questions directly, with concise answers.
- Group by topic only when it improves scanning.
- Avoid turning each answer into a sales pitch.`,

  testimonials: `PAGE-TYPE COPY CONTRACT (testimonials):
- Let outcomes and customer proof carry the page.
- Add context around testimonials only when it helps the reader understand relevance.
- Keep CTAs secondary to proof.`,
};

const DEFAULT_COPY_CONTRACT = `PAGE-TYPE COPY CONTRACT:
- Follow the brief's page type over generic SEO article habits.
- Keep sections as short as the conversion goal allows.
- Use brand context selectively; do not expand the page just because more context is available.
- Include one clear closing CTA path unless the brief explicitly asks for more.`;

const CONTENT_GENERATION_STYLE_CONTRACTS: Record<ContentGenerationStyle, string> = {
  standard: `CONTENT GENERATION STYLE (standard):
- Balanced SEO depth, reader usefulness, and brand voice.
- Preserve the page-type word budget and structure; do not add sections to sound more complete.
- Use enough explanation to be credible, but cut filler, repeated proof, and generic setup.`,
  concise: `CONTENT GENERATION STYLE (concise):
- Write the shortest complete version that still feels useful and trustworthy.
- Prefer fewer subpoints, tighter paragraphs, concrete examples, and direct buyer/reader language.
- Treat section word counts as ceilings. Remove article-style teaching sprawl, repeated CTAs, and extra brand narrative.
- For blogs/resources, keep necessary educational depth but compress examples and transitions.`,
  hybrid: `CONTENT GENERATION STYLE (hybrid):
- Blend concise structure with stronger POV, proof, and brand-specific positioning.
- Keep the skeleton compact like concise mode, but allow one richer example, sharper differentiator, or more memorable framing where it earns its place.
- Do not expand the page because brand context is available; express the brand in denser, more specific language.`,
};

export const GENERATION_STYLE_PRIORITY = `GENERATION STYLE PRIORITY:
- The selected generation style shapes density, rhythm, and level of detail.
- It never outranks factual safety, output format, page type, conversion goal, or word budget.
- Brand voice remains active, but style selection controls how much room brand context gets.`;

export const BRAND_CONTEXT_HIERARCHY = `BRAND CONTEXT PRIORITY:
1. Factual safety and output format are mandatory.
2. Page type, conversion goal, and word budget outrank style preferences.
3. Brand voice and tone shape phrasing, rhythm, and point of view within that structure.
4. Brand identity, business knowledge, personas, and approved deliverables are selective support. Use them to choose proof, positioning, and vocabulary; do not expand the page because more brand context is available.
5. If brand guidance conflicts with page-type density, preserve the page-type contract and express the brand more compactly.`;

export function getPageTypeCopyContract(pageType?: string): string {
  return PAGE_TYPE_COPY_CONTRACTS[pageType ?? ''] ?? DEFAULT_COPY_CONTRACT;
}

export function resolveContentGenerationStyle(style?: string | null): ContentGenerationStyle {
  if (style === 'concise' || style === 'hybrid' || style === 'standard') return style;
  return DEFAULT_CONTENT_GENERATION_STYLE;
}

export function getContentGenerationStyleContract(style?: string | null): string {
  const resolved = resolveContentGenerationStyle(style);
  return `${GENERATION_STYLE_PRIORITY}\n${CONTENT_GENERATION_STYLE_CONTRACTS[resolved]}`;
}

export function requiresPageTypeDensityReview(pageType?: string): boolean {
  return CONVERSION_DENSE_PAGE_TYPES.has(pageType ?? '');
}

export function getPageTypeOutlineContract(pageType?: string): PageTypeOutlineContract | null {
  return PAGE_TYPE_OUTLINE_CONTRACTS[pageType ?? ''] ?? null;
}

export function getPageTypeOutlineGuidance(pageType?: string): string {
  return PAGE_TYPE_OUTLINE_CONTRACTS[pageType ?? '']?.guidance ?? DEFAULT_OUTLINE_CONTRACT;
}
