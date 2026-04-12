import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  buildWorkspaceIntelligence,
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatPageMapForPrompt,
  formatKnowledgeBaseForPrompt,
} from './workspace-intelligence.js';
import type { KeywordMetrics, RelatedKeyword } from './seo-data-provider.js';
import { callOpenAI } from './openai-helpers.js';
import { buildReferenceContext, buildSerpContext, buildStyleExampleContext } from './web-scraper.js';
import type { ScrapedPage } from './web-scraper.js';
import { getInsights } from './analytics-insights-store.js';
import type { CannibalizationData, ContentDecayData, QuickWinData, PageHealthData } from '../shared/types/analytics.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from './workspace-learnings.js';
import { isFeatureEnabled } from './feature-flags.js';

export type { ContentBrief } from '../shared/types/content.ts';
import type { ContentBrief, StrategyCardContext } from '../shared/types/content.ts';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import {
  outlineItemSchema, serpAnalysisSchema, eeatGuidanceSchema,
  schemaRecommendationSchema, keywordValidationSchema, realTopResultSchema,
} from './schemas/content-schemas.js';
import { z } from 'zod';

/** Strip markdown code fences and parse JSON from AI responses. Throws on invalid JSON. */
function parseAiJson<T = Record<string, unknown>>(raw: string, context: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse AI response as JSON (${context})`);
  }
}

// ── Analytics Intelligence for brief enrichment ──

interface BriefIntelligenceInput {
  targetKeyword: string;
  workspaceId: string;
  cannibalizationInsights?: Array<{ query: string; pages: string[]; positions: number[] }>;
  decayInsights?: Array<{ pageId: string; deltaPercent: number; baselineClicks: number; currentClicks: number }>;
  quickWins?: Array<{ pageUrl: string; query: string; currentPosition: number; estimatedTrafficGain: number }>;
  pageHealthScores?: Array<{ pageId: string; score: number; trend: string }>;
}

/**
 * Build an analytics intelligence block for the content brief generation prompt.
 * Injects cannibalization warnings, decay context, quick wins, and page health data.
 */
export function buildBriefIntelligenceBlock(opts: BriefIntelligenceInput): string {
  const sections: string[] = [];

  // Cannibalization: pages already competing for target keyword
  const matching = opts.cannibalizationInsights?.filter(
    c => c.query.toLowerCase() === opts.targetKeyword.toLowerCase(),
  );
  if (matching?.length) {
    const lines = matching.map(c => {
      const pageList = c.pages.map((p, i) => {
        try { return `${new URL(p).pathname} (pos ${Math.round(c.positions[i])})`; } catch { return p; }
      }).join(', ');
      return `- "${c.query}": ${pageList}`;
    });
    sections.push(`CANNIBALIZATION WARNING — You already rank for this keyword on existing pages; consider updating vs creating new:\n${lines.join('\n')}`);
  }

  // Content decay: related pages losing traffic
  if (opts.decayInsights?.length) {
    const lines = opts.decayInsights.map(d => {
      let path: string;
      try { path = new URL(d.pageId).pathname; } catch { path = d.pageId; }
      return `- ${path}: ${d.deltaPercent}% change (${d.baselineClicks} → ${d.currentClicks} clicks)`;
    });
    sections.push(`CONTENT DECAY — Existing content on this topic is losing traffic; brief should address freshness:\n${lines.join('\n')}`);
  }

  // Quick wins: related queries close to page 1
  if (opts.quickWins?.length) {
    const lines = opts.quickWins.map(q =>
      `- "${q.query}" at pos ${Math.round(q.currentPosition)}, est. +${q.estimatedTrafficGain} clicks/mo if improved`,
    );
    sections.push(`QUICK WIN OPPORTUNITIES — Related queries that are close to page 1:\n${lines.join('\n')}`);
  }

  // Page health: related pages' overall scores
  if (opts.pageHealthScores?.length) {
    const lines = opts.pageHealthScores.map(p => {
      let path: string;
      try { path = new URL(p.pageId).pathname; } catch { path = p.pageId; }
      return `- ${path}: ${p.score}/100 (${p.trend})`;
    });
    sections.push(`PAGE HEALTH — Related pages' health scores:\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '';

  return `\n\nANALYTICS INTELLIGENCE (from intelligence layer — use to inform content strategy):\n\n${sections.join('\n\n')}`;
}

// ── SQLite row shape ──

interface BriefRow {
  id: string;
  workspace_id: string;
  target_keyword: string;
  secondary_keywords: string;
  suggested_title: string;
  suggested_meta_desc: string;
  outline: string;
  word_count_target: number;
  intent: string;
  audience: string;
  competitor_insights: string;
  internal_link_suggestions: string;
  created_at: string;
  executive_summary: string | null;
  content_format: string | null;
  tone_and_style: string | null;
  people_also_ask: string | null;
  topical_entities: string | null;
  serp_analysis: string | null;
  difficulty_score: number | null;
  traffic_potential: string | null;
  cta_recommendations: string | null;
  eeat_guidance: string | null;
  content_checklist: string | null;
  schema_recommendations: string | null;
  page_type: string | null;
  reference_urls: string | null;
  real_people_also_ask: string | null;
  real_top_results: string | null;
  keyword_locked: number | null;
  keyword_source: string | null;
  keyword_validation: string | null;
  template_id: string | null;
  title_variants: string | null;
  meta_desc_variants: string | null;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_briefs
           (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
            suggested_meta_desc, outline, word_count_target, intent, audience,
            competitor_insights, internal_link_suggestions, created_at,
            executive_summary, content_format, tone_and_style, people_also_ask,
            topical_entities, serp_analysis, difficulty_score, traffic_potential,
            cta_recommendations, eeat_guidance, content_checklist, schema_recommendations,
            page_type, reference_urls, real_people_also_ask, real_top_results,
            keyword_locked, keyword_source, keyword_validation, template_id,
            title_variants, meta_desc_variants)
         VALUES
           (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
            @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
            @competitor_insights, @internal_link_suggestions, @created_at,
            @executive_summary, @content_format, @tone_and_style, @people_also_ask,
            @topical_entities, @serp_analysis, @difficulty_score, @traffic_potential,
            @cta_recommendations, @eeat_guidance, @content_checklist, @schema_recommendations,
            @page_type, @reference_urls, @real_people_also_ask, @real_top_results,
            @keyword_locked, @keyword_source, @keyword_validation, @template_id,
            @title_variants, @meta_desc_variants)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_briefs WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_briefs WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    `UPDATE content_briefs SET
           target_keyword = @target_keyword, secondary_keywords = @secondary_keywords,
           suggested_title = @suggested_title, suggested_meta_desc = @suggested_meta_desc,
           outline = @outline, word_count_target = @word_count_target, intent = @intent,
           audience = @audience, competitor_insights = @competitor_insights,
           internal_link_suggestions = @internal_link_suggestions,
           executive_summary = @executive_summary, content_format = @content_format,
           tone_and_style = @tone_and_style, people_also_ask = @people_also_ask,
           topical_entities = @topical_entities, serp_analysis = @serp_analysis,
           difficulty_score = @difficulty_score, traffic_potential = @traffic_potential,
           cta_recommendations = @cta_recommendations, eeat_guidance = @eeat_guidance,
           content_checklist = @content_checklist, schema_recommendations = @schema_recommendations,
           page_type = @page_type, reference_urls = @reference_urls,
           real_people_also_ask = @real_people_also_ask, real_top_results = @real_top_results,
           keyword_locked = @keyword_locked, keyword_source = @keyword_source,
           keyword_validation = @keyword_validation, template_id = @template_id,
           title_variants = @title_variants, meta_desc_variants = @meta_desc_variants
         WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  deleteById: db.prepare(
    `DELETE FROM content_briefs WHERE id = ? AND workspace_id = ?`,
  ),
}));

function rowToBrief(row: BriefRow): ContentBrief {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    targetKeyword: row.target_keyword,
    secondaryKeywords: parseJsonSafeArray(row.secondary_keywords, z.string(), { field: 'secondary_keywords', table: 'content_briefs' }),
    suggestedTitle: row.suggested_title,
    suggestedMetaDesc: row.suggested_meta_desc,
    outline: parseJsonSafeArray(row.outline, outlineItemSchema, { field: 'outline', table: 'content_briefs' }),
    wordCountTarget: row.word_count_target,
    intent: row.intent,
    audience: row.audience,
    competitorInsights: row.competitor_insights,
    internalLinkSuggestions: parseJsonSafeArray(row.internal_link_suggestions, z.string(), { field: 'internal_link_suggestions', table: 'content_briefs' }),
    createdAt: row.created_at,
    executiveSummary: row.executive_summary ?? undefined,
    contentFormat: row.content_format ?? undefined,
    toneAndStyle: row.tone_and_style ?? undefined,
    peopleAlsoAsk: row.people_also_ask ? parseJsonSafeArray(row.people_also_ask, z.string(), { field: 'people_also_ask', table: 'content_briefs' }) : undefined,
    topicalEntities: row.topical_entities ? parseJsonSafeArray(row.topical_entities, z.string(), { field: 'topical_entities', table: 'content_briefs' }) : undefined,
    serpAnalysis: row.serp_analysis
      ? parseJsonSafe(row.serp_analysis, serpAnalysisSchema, null, { field: 'serp_analysis', table: 'content_briefs' }) ?? undefined
      : undefined,
    difficultyScore: row.difficulty_score ?? undefined,
    trafficPotential: row.traffic_potential ?? undefined,
    ctaRecommendations: row.cta_recommendations ? parseJsonSafeArray(row.cta_recommendations, z.string(), { field: 'cta_recommendations', table: 'content_briefs' }) : undefined,
    eeatGuidance: row.eeat_guidance
      ? parseJsonSafe(row.eeat_guidance, eeatGuidanceSchema, null, { field: 'eeat_guidance', table: 'content_briefs' }) ?? undefined
      : undefined,
    contentChecklist: row.content_checklist ? parseJsonSafeArray(row.content_checklist, z.string(), { field: 'content_checklist', table: 'content_briefs' }) : undefined,
    schemaRecommendations: row.schema_recommendations
      ? parseJsonSafeArray(row.schema_recommendations, schemaRecommendationSchema, { field: 'schema_recommendations', table: 'content_briefs' })
      : undefined,
    pageType: row.page_type as ContentBrief['pageType'] ?? undefined,
    referenceUrls: row.reference_urls ? parseJsonSafeArray(row.reference_urls, z.string(), { field: 'reference_urls', table: 'content_briefs' }) : undefined,
    realPeopleAlsoAsk: row.real_people_also_ask ? parseJsonSafeArray(row.real_people_also_ask, z.string(), { field: 'real_people_also_ask', table: 'content_briefs' }) : undefined,
    realTopResults: row.real_top_results
      ? parseJsonSafeArray(row.real_top_results, realTopResultSchema, { field: 'real_top_results', table: 'content_briefs' })
      : undefined,
    keywordLocked: row.keyword_locked ? true : undefined,
    keywordSource: (row.keyword_source as ContentBrief['keywordSource']) ?? undefined,
    keywordValidation: row.keyword_validation
      ? parseJsonSafe(row.keyword_validation, keywordValidationSchema, null, { field: 'keyword_validation', table: 'content_briefs' }) ?? undefined
      : undefined,
    templateId: row.template_id ?? undefined,
    titleVariants: row.title_variants ? parseJsonSafeArray(row.title_variants, z.string(), { field: 'title_variants', table: 'content_briefs' }) : undefined,
    metaDescVariants: row.meta_desc_variants ? parseJsonSafeArray(row.meta_desc_variants, z.string(), { field: 'meta_desc_variants', table: 'content_briefs' }) : undefined,
  };
}

function briefToParams(brief: ContentBrief): Record<string, unknown> {
  return {
    id: brief.id,
    workspace_id: brief.workspaceId,
    target_keyword: brief.targetKeyword,
    secondary_keywords: JSON.stringify(brief.secondaryKeywords),
    suggested_title: brief.suggestedTitle,
    suggested_meta_desc: brief.suggestedMetaDesc,
    outline: JSON.stringify(brief.outline),
    word_count_target: brief.wordCountTarget,
    intent: brief.intent,
    audience: brief.audience,
    competitor_insights: brief.competitorInsights,
    internal_link_suggestions: JSON.stringify(brief.internalLinkSuggestions),
    executive_summary: brief.executiveSummary ?? null,
    content_format: brief.contentFormat ?? null,
    tone_and_style: brief.toneAndStyle ?? null,
    people_also_ask: brief.peopleAlsoAsk ? JSON.stringify(brief.peopleAlsoAsk) : null,
    topical_entities: brief.topicalEntities ? JSON.stringify(brief.topicalEntities) : null,
    serp_analysis: brief.serpAnalysis ? JSON.stringify(brief.serpAnalysis) : null,
    difficulty_score: brief.difficultyScore ?? null,
    traffic_potential: brief.trafficPotential ?? null,
    cta_recommendations: brief.ctaRecommendations ? JSON.stringify(brief.ctaRecommendations) : null,
    eeat_guidance: brief.eeatGuidance ? JSON.stringify(brief.eeatGuidance) : null,
    content_checklist: brief.contentChecklist ? JSON.stringify(brief.contentChecklist) : null,
    schema_recommendations: brief.schemaRecommendations ? JSON.stringify(brief.schemaRecommendations) : null,
    page_type: brief.pageType ?? null,
    reference_urls: brief.referenceUrls ? JSON.stringify(brief.referenceUrls) : null,
    real_people_also_ask: brief.realPeopleAlsoAsk ? JSON.stringify(brief.realPeopleAlsoAsk) : null,
    real_top_results: brief.realTopResults ? JSON.stringify(brief.realTopResults) : null,
    keyword_locked: brief.keywordLocked ? 1 : 0,
    keyword_source: brief.keywordSource ?? null,
    keyword_validation: brief.keywordValidation ? JSON.stringify(brief.keywordValidation) : null,
    template_id: brief.templateId ?? null,
    title_variants: brief.titleVariants ? JSON.stringify(brief.titleVariants) : null,
    meta_desc_variants: brief.metaDescVariants ? JSON.stringify(brief.metaDescVariants) : null,
  };
}

export function listBriefs(workspaceId: string): ContentBrief[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as BriefRow[];
  return rows.map(rowToBrief);
}

export function getBrief(workspaceId: string, briefId: string): ContentBrief | undefined {
  const row = stmts().selectById.get(briefId, workspaceId) as BriefRow | undefined;
  return row ? rowToBrief(row) : undefined;
}

export function updateBrief(workspaceId: string, briefId: string, updates: Partial<Omit<ContentBrief, 'id' | 'workspaceId' | 'createdAt'>>): ContentBrief | null {
  const existing = getBrief(workspaceId, briefId);
  if (!existing) return null;
  Object.assign(existing, updates);
  stmts().update.run(briefToParams(existing));
  return existing;
}

export function deleteBrief(workspaceId: string, briefId: string): boolean {
  const info = stmts().deleteById.run(briefId, workspaceId);
  return info.changes > 0;
}

// Page-type-specific configuration: word counts, section counts, content style, and prompt instructions
export interface PageTypeConfig {
  wordCountTarget: number;       // target word count for the JSON example
  wordCountRange: string;        // e.g. "800-1,200"
  sectionRange: string;          // e.g. "4-6 sections"
  avgSectionWords: number;       // average words per section in the example
  contentStyle: string;          // writing style guidance
  prompt: string;                // page-type-specific instructions for the AI
}

export const PAGE_TYPE_CONFIGS: Record<string, PageTypeConfig> = {
  blog: {
    wordCountTarget: 1800,
    wordCountRange: '1,500-2,500',
    sectionRange: '6-10',
    avgSectionWords: 250,
    contentStyle: 'Educational and engaging. Balance depth with readability. Use storytelling, data, and practical examples. Conversational but authoritative.',
    prompt: `PAGE TYPE: Blog Post
- Format as an educational, long-form article (1,500-2,500 words)
- Include an engaging introduction that hooks the reader
- Use a mix of informational and slightly commercial intent
- Suggest internal links to service/product pages where relevant
- Schema: Article or BlogPosting`,
  },

  landing: {
    wordCountTarget: 900,
    wordCountRange: '800-1,200',
    sectionRange: '4-6',
    avgSectionWords: 150,
    contentStyle: 'Punchy, conversion-focused, and scannable. Short paragraphs (2-3 sentences max). Lead every section with a benefit. Use power words. Every sentence should earn its place — cut anything that doesn\'t drive toward conversion.',
    prompt: `PAGE TYPE: Landing Page
- Format as a conversion-focused landing page (800-1,200 words)
- Lead with the primary value proposition in the H1
- Structure: Hero → Problem → Solution → Benefits → Social Proof → CTA
- Every section should drive toward a single conversion action
- Include trust signals (testimonials, stats, logos) in the outline
- Keep copy punchy — short paragraphs, bold claims, clear benefits
- Schema: WebPage with potential Organization or Product`,
  },

  service: {
    wordCountTarget: 1200,
    wordCountRange: '1,000-1,500',
    sectionRange: '5-8',
    avgSectionWords: 180,
    contentStyle: 'Professional and benefit-driven. Lead with outcomes, not features. Use confident language that builds trust. Balance detail with scannability.',
    prompt: `PAGE TYPE: Service Page
- Format as a service description page (1,000-1,500 words)
- Lead with what the service solves, not what it is
- Structure: Overview → What's Included → Process → Benefits → Pricing Signals → FAQ → CTA
- Include specific deliverables and outcomes
- E-E-A-T emphasis: expertise and authority signals are critical
- Schema: Service, FAQPage`,
  },

  location: {
    wordCountTarget: 1000,
    wordCountRange: '800-1,200',
    sectionRange: '4-7',
    avgSectionWords: 170,
    contentStyle: 'Locally relevant and trustworthy. Weave in location-specific details naturally. Warm, community-oriented tone. Include proof of local expertise.',
    prompt: `PAGE TYPE: Location Page
- Format as a local SEO page (800-1,200 words)
- Include the city/region name naturally in headings and body
- Structure: Local intro → Services in [Location] → Local expertise → Testimonials → Map/Directions → Contact CTA
- Reference local landmarks, neighborhoods, or regional specifics
- Include NAP (Name, Address, Phone) consistency guidance
- Schema: LocalBusiness, FAQPage`,
  },

  product: {
    wordCountTarget: 750,
    wordCountRange: '600-1,000',
    sectionRange: '4-6',
    avgSectionWords: 130,
    contentStyle: 'Concise and benefit-first. Use bullet points and comparison tables. Answer buyer objections directly. Include social proof. Every word should help the purchase decision.',
    prompt: `PAGE TYPE: Product Page
- Format as a product description page (600-1,000 words)
- Lead with the key benefit, not features
- Structure: Product Overview → Key Features → Specifications → Use Cases → Comparison → Reviews → Purchase CTA
- Include comparison elements vs alternatives
- Pricing and availability signals
- Schema: Product with Review, FAQPage`,
  },

  pillar: {
    wordCountTarget: 3000,
    wordCountRange: '2,500-4,000',
    sectionRange: '8-12',
    avgSectionWords: 300,
    contentStyle: 'Comprehensive and authoritative. This is the definitive resource on the topic. Balance breadth with depth. Each section should stand alone but link to deeper content.',
    prompt: `PAGE TYPE: Pillar / Hub Page
- Format as a comprehensive topic hub (2,500-4,000 words)
- This is the authoritative centerpiece for a topic cluster
- Structure: Comprehensive overview → Major subtopics (each linking to cluster content) → FAQ → Resources
- Each section should link to or reference more detailed supporting content
- Cover the topic broadly; linked cluster pages go deep
- Internal linking strategy is critical — map every subtopic to an existing or planned page
- Schema: Article, FAQPage, BreadcrumbList`,
  },

  resource: {
    wordCountTarget: 2500,
    wordCountRange: '2,000-3,000',
    sectionRange: '6-10',
    avgSectionWords: 300,
    contentStyle: 'Practical and actionable. Include frameworks, checklists, and step-by-step processes. Reference-quality depth. Use visual aids (tables, diagrams). Write for someone who will implement immediately.',
    prompt: `PAGE TYPE: Resource / Guide
- Format as a downloadable or in-depth reference guide (2,000-3,000 words)
- Include actionable frameworks, templates, or step-by-step processes
- Structure: Executive Summary → Background → Step-by-Step Guide → Tools/Resources → Checklist → Next Steps
- Include visual aids guidance (tables, diagrams, checklists)
- Lead magnet potential — note where a gated PDF version could be offered
- Schema: Article, HowTo`,
  },

  'provider-profile': {
    wordCountTarget: 1200,
    wordCountRange: '800-1,500',
    sectionRange: '5-8',
    avgSectionWords: 180,
    contentStyle: 'Professional, trustworthy, and encyclopedic. Write like a medical directory — factual, credential-forward, neutral tone. No marketing fluff. Every claim should be verifiable. Citation-worthy.',
    prompt: `PAGE TYPE: Provider Profile (AEO-optimized)
- Format as a healthcare provider profile page (800-1,500 words)
- ANSWER-FIRST: Open with a 2-3 sentence summary of who this provider is, their specialty, and where they practice
- Structure: Provider Summary → Credentials & Education → Specialties → Procedures Offered → Practice Locations → Patient Reviews Distribution → Professional Affiliations → Disclosures
- Include structured data hooks: credentials, medicalSpecialty, hospitalAffiliation
- Use neutral, encyclopedic tone — write as a reference, not an ad
- Include citations to licensing boards, medical associations, or published research where applicable
- Schema: Physician, MedicalBusiness, FAQPage`,
  },

  'procedure-guide': {
    wordCountTarget: 2000,
    wordCountRange: '1,500-2,500',
    sectionRange: '7-10',
    avgSectionWords: 250,
    contentStyle: 'Evidence-based, comprehensive, and patient-friendly. Balance medical accuracy with accessibility. Every medical claim must reference a source. Use definition blocks for medical terms. Neutral and informative — not salesy.',
    prompt: `PAGE TYPE: Procedure Guide (AEO-optimized)
- Format as a comprehensive medical/dental procedure guide (1,500-2,500 words)
- ANSWER-FIRST: Open with a 2-3 sentence direct answer to "What is [procedure]?" — this becomes the AI-cited snippet
- Structure: What It Is (definition block) → Who It's For (indications) → Who Should Avoid It (contraindications) → How It Works (step-by-step) → Cost Ranges (city-specific if possible, with comparison table) → Risks & Side Effects → Alternatives (comparison table) → Recovery & Aftercare → FAQ
- CITATION DENSITY: Target 1 citation per ~200 words. Cite medical journals, professional associations (ADA, AMA), or .gov sources
- Include DEFINITION BLOCKS for key medical terms: Term → 1-2 sentence definition → Common misconceptions → Related terms
- Include COMPARISON TABLE: procedure vs. alternatives with measurable fields (cost range, recovery time, success rate, longevity). Include units, footnotes, and "data as of" date
- FAQ section must use real patient questions with 30-80 word answers
- Schema: MedicalProcedure, FAQPage, HowTo, Article`,
  },

  'pricing-page': {
    wordCountTarget: 1500,
    wordCountRange: '1,000-2,000',
    sectionRange: '5-8',
    avgSectionWords: 220,
    contentStyle: 'Data-driven, transparent, and citeable. Write like a consumer research report. Include specific numbers with sources. Comparison tables are essential. Methodology section required. Neutral tone — "costs depend on X, Y, Z" not "we offer the best prices."',
    prompt: `PAGE TYPE: Pricing / Cost Guide (AEO-optimized)
- Format as a comprehensive pricing/cost guide (1,000-2,000 words)
- ANSWER-FIRST: Open with a direct cost range answer: "[Procedure] in [City] typically costs $X-$Y, depending on [factors]." This is the snippet LLMs will cite
- Structure: Cost Summary (direct answer) → Cost Breakdown Table → Factors That Affect Price → Insurance & Financing → How to Compare Providers → Methodology → FAQ
- COMPARISON TABLE (required): rows = options/providers, columns = cost range, what's included, pros, cons. Include units ($), footnotes per row, "Data as of [date]" note
- Include a METHODOLOGY section: where the price data comes from, how it was collected, sample size, date range, known limitations. This is non-negotiable for AI citation trust
- CITATION DENSITY: Target 1 citation per ~300 words. Cite industry surveys, insurance databases, professional fee guides
- Avoid vague adjectives — use measurable fields: "$2,500-$5,000" not "affordable", "3-6 months" not "quick recovery"
- Schema: Article, Dataset, FAQPage`,
  },

  homepage: {
    wordCountTarget: 1500,
    wordCountRange: '1,200-2,000',
    sectionRange: '5-7',
    avgSectionWords: 225,
    contentStyle: 'Brand-led, conversion-oriented, and approachable. Lead with the customer transformation. Use StoryBrand narrative arc. Every section earns its place.',
    prompt: `PAGE TYPE: Homepage
- Format as a brand-first homepage (1,200-2,000 words of copyable content)
- Structure: Hero (transformation promise) → Problem → Solution/Guide → Simple Plan → Social Proof → CTA
- H1 must communicate the customer transformation, not the product feature
- Include trust signals and a primary + secondary CTA
- Avoid generic filler — every sentence should address a customer pain or desire
- Schema: WebPage, Organization`,
  },

  about: {
    wordCountTarget: 1200,
    wordCountRange: '900-1,600',
    sectionRange: '4-6',
    avgSectionWords: 220,
    contentStyle: 'Authentic, human, and trust-building. Tell the origin story. Focus on why the business exists, not just what it does. Introduce real people.',
    prompt: `PAGE TYPE: About Page
- Format as an authentic brand story page (900-1,600 words)
- Structure: Origin Story → Mission/Values → Team → Why Us → CTA
- Focus on "why we exist" not just "what we do" — the customer is not the hero, the business is the guide
- Include real team member names and credentials for E-E-A-T
- End with a soft CTA that invites further engagement
- Schema: AboutPage, Person, Organization`,
  },

  contact: {
    wordCountTarget: 400,
    wordCountRange: '300-600',
    sectionRange: '2-4',
    avgSectionWords: 120,
    contentStyle: 'Welcoming and low-friction. Make reaching out feel easy. Brief copy, clear contact methods.',
    prompt: `PAGE TYPE: Contact Page
- Format as a low-friction contact page (300-600 words)
- Structure: Welcome/invitation → Contact form → Address/hours/phone → FAQ (optional)
- Minimize friction — do not gatekeep contact with excessive fields
- Include NAP (Name, Address, Phone) for local SEO consistency
- Schema: ContactPage, LocalBusiness`,
  },

  faq: {
    wordCountTarget: 1200,
    wordCountRange: '800-1,800',
    sectionRange: '3-5',
    avgSectionWords: 280,
    contentStyle: 'Helpful and direct. Answer real questions, not softballs. Group by topic. Anticipate objections. Conversational but authoritative.',
    prompt: `PAGE TYPE: FAQ Page
- Format as a comprehensive FAQ page (800-1,800 words)
- Structure: Introduction → Grouped Q&A sections → CTA
- Group questions by topic/theme (e.g., "About the Service", "Pricing", "Process")
- Answer questions directly and completely — no vague non-answers
- Include People Also Ask keyword variants where relevant
- Schema: FAQPage`,
  },

  testimonials: {
    wordCountTarget: 800,
    wordCountRange: '600-1,200',
    sectionRange: '3-5',
    avgSectionWords: 180,
    contentStyle: 'Social-proof focused. Let customer outcomes speak. Organize by transformation type or service. Add context around each testimonial.',
    prompt: `PAGE TYPE: Testimonials / Reviews Page
- Format as a social proof showcase page (600-1,200 words)
- Structure: Social proof headline → Curated testimonials (grouped by outcome or service) → Stats/awards → CTA
- Each testimonial should describe a specific transformation or result, not generic praise
- Include customer names and context (service received, location if relevant) for credibility
- Schema: Review, AggregateRating`,
  },
};

/**
 * Builds the strategy card context block injected into the generateBrief prompt.
 * Exported for unit testing.
 */
export function buildStrategyCardBlock(ctx: StrategyCardContext | undefined): string {
  if (!ctx) return '';
  const lines: string[] = ['\n\nSTRATEGY CARD CONTEXT (from the content gap that triggered this brief):'];
  if (ctx.rationale) lines.push(`- Strategic rationale: ${ctx.rationale}`);
  if (ctx.intent) lines.push(`- Search intent: ${ctx.intent}`);
  if (ctx.priority) lines.push(`- Priority: ${ctx.priority}`);
  if (ctx.journeyStage) lines.push(`- Journey stage: ${ctx.journeyStage} — tailor depth, CTA, and tone to this stage`);
  if (lines.length === 1) return ''; // no fields added
  lines.push('Use this context to align the brief with the client\'s stated strategy. The rationale explains WHY this page is needed — reference it in the executive summary.');
  return lines.join('\n');
}

// Helper to get config for a page type, with blog as default
export function getPageTypeConfig(pageType?: string): PageTypeConfig {
  if (pageType && PAGE_TYPE_CONFIGS[pageType]) return PAGE_TYPE_CONFIGS[pageType];
  // 'custom' and unrecognized page types intentionally fall back to blog config.
  // All external access to PAGE_TYPE_CONFIGS should go through this function.
  return PAGE_TYPE_CONFIGS.blog;
}

/**
 * Regenerate an existing brief with user feedback.
 * Passes the previous brief as context so AI can refine rather than start from scratch.
 */
export async function regenerateBrief(
  workspaceId: string,
  existingBrief: ContentBrief,
  feedback: string,
): Promise<ContentBrief> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
  const seo = intel.seoContext;
  const keywordBlock = formatKeywordsForPrompt(seo);
  // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
  const brandVoiceBlock = seo?.effectiveBrandVoiceBlock ?? '';
  const knowledgeBlock = formatKnowledgeBaseForPrompt(seo?.knowledgeBase);
  const ptConfig = getPageTypeConfig(existingBrief.pageType);

  const previousBriefJson = JSON.stringify({
    suggestedTitle: existingBrief.suggestedTitle,
    suggestedMetaDesc: existingBrief.suggestedMetaDesc,
    executiveSummary: existingBrief.executiveSummary,
    contentFormat: existingBrief.contentFormat,
    toneAndStyle: existingBrief.toneAndStyle,
    wordCountTarget: existingBrief.wordCountTarget,
    intent: existingBrief.intent,
    audience: existingBrief.audience,
    secondaryKeywords: existingBrief.secondaryKeywords,
    outline: existingBrief.outline,
    peopleAlsoAsk: existingBrief.peopleAlsoAsk,
    topicalEntities: existingBrief.topicalEntities,
    competitorInsights: existingBrief.competitorInsights,
    ctaRecommendations: existingBrief.ctaRecommendations,
    internalLinkSuggestions: existingBrief.internalLinkSuggestions,
    eeatGuidance: existingBrief.eeatGuidance,
    contentChecklist: existingBrief.contentChecklist,
    schemaRecommendations: existingBrief.schemaRecommendations,
  }, null, 2);

  const prompt = `You are an expert content strategist. You previously generated the following content brief for the keyword "${existingBrief.targetKeyword}".

PREVIOUS BRIEF:
${previousBriefJson}

The user has reviewed this brief and wants you to regenerate it with the following feedback:

USER FEEDBACK:
${feedback}
${keywordBlock}${brandVoiceBlock}${knowledgeBlock}

Please regenerate the ENTIRE brief incorporating the user's feedback. Keep everything that was good, improve what the user requested, and maintain all required fields.

Return the complete brief as valid JSON with these fields:
{
  "executiveSummary": "...",
  "suggestedTitle": "...",
  "titleVariants": ["Alternative title 2", "Alternative title 3"],
  "suggestedMetaDesc": "...",
  "metaDescVariants": ["Alternative meta description 2", "Alternative meta description 3"],
  "secondaryKeywords": [...],
  "contentFormat": "...",
  "toneAndStyle": "...",
  "outline": [{ "heading": "...", "subheadings": [...], "notes": "...", "wordCount": N, "keywords": [...] }],
  "wordCountTarget": ${ptConfig.wordCountTarget},
  "intent": "...",
  "audience": "...",
  "peopleAlsoAsk": [...],
  "topicalEntities": [...],
  "serpAnalysis": { "contentType": "...", "avgWordCount": N, "commonElements": [...], "gaps": [...] },
  "difficultyScore": N,
  "trafficPotential": "...",
  "competitorInsights": "...",
  "ctaRecommendations": [...],
  "internalLinkSuggestions": [...],
  "eeatGuidance": { "experience": "...", "expertise": "...", "authority": "...", "trust": "..." },
  "contentChecklist": [...],
  "schemaRecommendations": [{ "type": "...", "notes": "..." }]
}

Return ONLY valid JSON, no markdown fences, no explanation.`;

  const aiResult = await callOpenAI({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 7000,
    temperature: 0.5,
    feature: 'content-brief-regenerate',
    workspaceId,
  });

  const raw = aiResult.text || '{}';
  const parsed = parseAiJson(raw, 'brief-regenerate');

  // Create a new brief ID — preserves the old one for history
  const newBrief: ContentBrief = {
    id: `brief_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    targetKeyword: existingBrief.targetKeyword,
    secondaryKeywords: (parsed.secondaryKeywords as string[]) || existingBrief.secondaryKeywords,
    suggestedTitle: (parsed.suggestedTitle as string) || existingBrief.suggestedTitle,
    suggestedMetaDesc: (parsed.suggestedMetaDesc as string) || existingBrief.suggestedMetaDesc,
    outline: (parsed.outline as ContentBrief['outline']) || existingBrief.outline,
    wordCountTarget: (parsed.wordCountTarget as number) || existingBrief.wordCountTarget,
    intent: (parsed.intent as string) || existingBrief.intent,
    audience: (parsed.audience as string) || existingBrief.audience,
    competitorInsights: (parsed.competitorInsights as string) || existingBrief.competitorInsights,
    internalLinkSuggestions: (parsed.internalLinkSuggestions as string[]) || existingBrief.internalLinkSuggestions,
    createdAt: new Date().toISOString(),
    executiveSummary: (parsed.executiveSummary as string) || existingBrief.executiveSummary,
    contentFormat: (parsed.contentFormat as string) || existingBrief.contentFormat,
    toneAndStyle: (parsed.toneAndStyle as string) || existingBrief.toneAndStyle,
    peopleAlsoAsk: (parsed.peopleAlsoAsk as string[]) || existingBrief.peopleAlsoAsk,
    topicalEntities: (parsed.topicalEntities as string[]) || existingBrief.topicalEntities,
    serpAnalysis: (parsed.serpAnalysis as ContentBrief['serpAnalysis']) || existingBrief.serpAnalysis,
    difficultyScore: (parsed.difficultyScore as number) || existingBrief.difficultyScore,
    trafficPotential: (parsed.trafficPotential as string) || existingBrief.trafficPotential,
    ctaRecommendations: (parsed.ctaRecommendations as string[]) || existingBrief.ctaRecommendations,
    eeatGuidance: (parsed.eeatGuidance as ContentBrief['eeatGuidance']) || existingBrief.eeatGuidance,
    contentChecklist: (parsed.contentChecklist as string[]) || existingBrief.contentChecklist,
    schemaRecommendations: (parsed.schemaRecommendations as ContentBrief['schemaRecommendations']) || existingBrief.schemaRecommendations,
    titleVariants: (parsed.titleVariants as string[]) || existingBrief.titleVariants,
    metaDescVariants: (parsed.metaDescVariants as string[]) || existingBrief.metaDescVariants,
    pageType: existingBrief.pageType,
    referenceUrls: existingBrief.referenceUrls,
    realPeopleAlsoAsk: existingBrief.realPeopleAlsoAsk,
    realTopResults: existingBrief.realTopResults,
    keywordLocked: existingBrief.keywordLocked,
    keywordSource: existingBrief.keywordSource,
    keywordValidation: existingBrief.keywordValidation,
    templateId: existingBrief.templateId,
  };

  stmts().insert.run({
    id: newBrief.id,
    workspace_id: workspaceId,
    target_keyword: newBrief.targetKeyword,
    secondary_keywords: JSON.stringify(newBrief.secondaryKeywords),
    suggested_title: newBrief.suggestedTitle,
    suggested_meta_desc: newBrief.suggestedMetaDesc,
    outline: JSON.stringify(newBrief.outline),
    word_count_target: newBrief.wordCountTarget,
    intent: newBrief.intent,
    audience: newBrief.audience,
    competitor_insights: newBrief.competitorInsights,
    internal_link_suggestions: JSON.stringify(newBrief.internalLinkSuggestions),
    created_at: newBrief.createdAt,
    executive_summary: newBrief.executiveSummary ?? null,
    content_format: newBrief.contentFormat ?? null,
    tone_and_style: newBrief.toneAndStyle ?? null,
    people_also_ask: newBrief.peopleAlsoAsk ? JSON.stringify(newBrief.peopleAlsoAsk) : null,
    topical_entities: newBrief.topicalEntities ? JSON.stringify(newBrief.topicalEntities) : null,
    serp_analysis: newBrief.serpAnalysis ? JSON.stringify(newBrief.serpAnalysis) : null,
    difficulty_score: newBrief.difficultyScore ?? null,
    traffic_potential: newBrief.trafficPotential ?? null,
    cta_recommendations: newBrief.ctaRecommendations ? JSON.stringify(newBrief.ctaRecommendations) : null,
    eeat_guidance: newBrief.eeatGuidance ? JSON.stringify(newBrief.eeatGuidance) : null,
    content_checklist: newBrief.contentChecklist ? JSON.stringify(newBrief.contentChecklist) : null,
    schema_recommendations: newBrief.schemaRecommendations ? JSON.stringify(newBrief.schemaRecommendations) : null,
    page_type: newBrief.pageType ?? null,
    reference_urls: newBrief.referenceUrls ? JSON.stringify(newBrief.referenceUrls) : null,
    real_people_also_ask: newBrief.realPeopleAlsoAsk ? JSON.stringify(newBrief.realPeopleAlsoAsk) : null,
    real_top_results: newBrief.realTopResults ? JSON.stringify(newBrief.realTopResults) : null,
    keyword_locked: newBrief.keywordLocked ? 1 : 0,
    keyword_source: newBrief.keywordSource ?? null,
    keyword_validation: newBrief.keywordValidation ? JSON.stringify(newBrief.keywordValidation) : null,
    template_id: newBrief.templateId ?? null,
    title_variants: newBrief.titleVariants ? JSON.stringify(newBrief.titleVariants) : null,
    meta_desc_variants: newBrief.metaDescVariants ? JSON.stringify(newBrief.metaDescVariants) : null,
  });

  return newBrief;
}

/**
 * Regenerate ONLY the outline of an existing brief, preserving all other fields.
 * Optionally accepts user feedback to guide the new outline.
 */
export async function regenerateOutline(
  workspaceId: string,
  briefId: string,
  feedback?: string,
): Promise<ContentBrief | null> {
  const existingBrief = getBrief(workspaceId, briefId);
  if (!existingBrief) return null;

  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
  const seo = intel.seoContext;
  const keywordBlock = formatKeywordsForPrompt(seo);
  // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
  const brandVoiceBlock = seo?.effectiveBrandVoiceBlock ?? '';
  const ptConfig = getPageTypeConfig(existingBrief.pageType);

  const currentOutline = JSON.stringify(existingBrief.outline, null, 2);

  const prompt = `You are an expert SEO content strategist. Your task is to regenerate ONLY the content outline for a brief.

Target keyword: ${existingBrief.targetKeyword}
Content format: ${existingBrief.contentFormat || 'guide'}
Page type: ${existingBrief.pageType || 'blog'}
Title: ${existingBrief.suggestedTitle}
Word count target: ${existingBrief.wordCountTarget}
Intent: ${existingBrief.intent}
Audience: ${existingBrief.audience}
${keywordBlock}${brandVoiceBlock}

Current outline:
${currentOutline}

${feedback ? `User feedback on the outline:\n${feedback}\n` : ''}
Generate a new outline that ${feedback ? 'addresses the feedback above' : 'takes a fresh approach to the topic structure'}.

Return ONLY valid JSON — an array of section objects:
[
  { "heading": "H2 heading text", "subheadings": ["H3 subtopic 1", "H3 subtopic 2"], "notes": "Detailed guidance (3-5 sentences)", "wordCount": ${ptConfig.avgSectionWords}, "keywords": ["keywords for this section"] }
]

Rules:
- The FIRST section must directly answer the query (ANSWER-FIRST for AEO)
- ${ptConfig.sectionRange} sections total
- Each section should have 2-4 subheadings
- Include secondary keywords: ${existingBrief.secondaryKeywords.join(', ')}
- Do NOT use generic headings like "Introduction" or "Conclusion" — those are handled separately
- Vary section types (how-to steps, comparisons, data tables, case studies, FAQs)`;

  const aiResult = await callOpenAI({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0.6,
    feature: 'content-brief-outline-regen',
    workspaceId,
  });

  // Parse the outline from the response
  const outlineRaw = aiResult.text || '[]';
  const outlineParsed = parseAiJson<Record<string, unknown> | unknown[]>(outlineRaw, 'outline-regen');
  // Handle both { outline: [...] } and direct array
  const newOutline: ContentBrief['outline'] = Array.isArray(outlineParsed)
    ? outlineParsed as ContentBrief['outline']
    : ((outlineParsed as Record<string, unknown>).outline || (outlineParsed as Record<string, unknown>).sections || []) as ContentBrief['outline'];
  if (!Array.isArray(newOutline) || newOutline.length === 0) {
    throw new Error('Failed to parse regenerated outline');
  }

  // Update only the outline field
  const updated = updateBrief(workspaceId, briefId, { outline: newOutline });
  return updated;
}

export async function generateBrief(
  workspaceId: string,
  targetKeyword: string,
  context: {
    relatedQueries?: { query: string; position: number; clicks: number; impressions: number }[];
    businessContext?: string;
    existingPages?: string[];
    semrushMetrics?: KeywordMetrics;
    semrushRelated?: RelatedKeyword[];
    pageType?: string;
    ga4PagePerformance?: { landingPage: string; sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }[];
    referenceUrls?: string[];
    scrapedReferences?: ScrapedPage[];
    serpData?: { peopleAlsoAsk: string[]; organicResults: { position: number; title: string; url: string }[] };
    styleExamples?: ScrapedPage[];
    // Template constraints (Phase 1b — keyword pre-assignment)
    templateId?: string;
    templateSections?: { name: string; headingTemplate: string; guidance: string; wordCountTarget: number }[];
    templateToneOverride?: string;
    templateTitlePattern?: string;
    templateMetaDescPattern?: string;
    // Keyword tracking
    keywordLocked?: boolean;
    keywordSource?: ContentBrief['keywordSource'];
    keywordValidation?: ContentBrief['keywordValidation'];
    // Pre-computed page analysis from Page Intelligence (avoids re-lookup)
    pageAnalysisContext?: {
      optimizationScore?: number;
      optimizationIssues?: string[];
      recommendations?: string[];
      contentGaps?: string[];
      searchIntent?: string;
    };
    /** Blueprint entry ID that triggered this brief (Phase 3 — used to backlink the brief to its entry via updateEntry(blueprintId, entryId, { briefId })). Not read in this function. */
    blueprintEntryId?: string;
    /** Strategy card context threaded from the content request. */
    strategyCardContext?: StrategyCardContext;
  }
): Promise<ContentBrief> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const relatedStr = context.relatedQueries?.slice(0, 20)
    .map(q => `"${q.query}" (pos #${q.position}, ${q.clicks} clicks, ${q.impressions} imp)`)
    .join('\n') || 'No related query data available';

  const pagesStr = context.existingPages?.slice(0, 50).join('\n') || 'No existing pages provided';

  // Pull in keyword strategy context for alignment
  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
  const seo = intel.seoContext;
  const keywordBlock = formatKeywordsForPrompt(seo);
  // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
  const brandVoiceBlock = seo?.effectiveBrandVoiceBlock ?? '';
  const stratBizCtx = seo?.businessContext ?? '';
  const knowledgeBlock = formatKnowledgeBaseForPrompt(seo?.knowledgeBase);
  const personasBlock = formatPersonasForPrompt(seo?.personas);
  const kwMapContext = formatPageMapForPrompt(seo);
  const bizCtx = context.businessContext || stratBizCtx;

  // Find if any page in the strategy targets this keyword — inject its analysis data.
  // Use intel.seoContext.strategy.pageMap (populated from the live page_keywords table
  // by assembleSeoContext) rather than getWorkspace().keywordStrategy (which has pageMap
  // stripped before storage).
  const matchedPage = seo?.strategy?.pageMap?.find(p =>
    p.primaryKeyword?.toLowerCase() === targetKeyword.toLowerCase()
    || p.secondaryKeywords?.some(sk => sk.toLowerCase() === targetKeyword.toLowerCase())
  );
  let pageAnalysisBlock = '';
  if (matchedPage) {
    const pageIntel = await buildWorkspaceIntelligence(workspaceId, { slices: ['pageProfile'],
      pagePath: matchedPage.pagePath });
    const profile = pageIntel.pageProfile;
    if (profile) {
      const parts: string[] = [];
      // Use optimizationIssues (AI per-page keyword analysis) — not auditIssues (structural Webflow audit)
      if (profile.optimizationIssues?.length) {
        parts.push(`ISSUES IDENTIFIED:\n${profile.optimizationIssues.map(i => `- ${i}`).join('\n')}`);
      }
      if (profile.recommendations?.length) {
        parts.push(`RECOMMENDATIONS:\n${profile.recommendations.map(r => `- ${r}`).join('\n')}`);
      }
      if (profile.contentGaps?.length) {
        parts.push(`CONTENT GAPS:\n${profile.contentGaps.map(g => `- ${g}`).join('\n')}`);
      }
      if (profile.optimizationScore != null) {
        parts.push(`OPTIMIZATION SCORE: ${profile.optimizationScore}/100`);
      }
      if (profile.primaryKeywordPresence) {
        const p = profile.primaryKeywordPresence;
        const missing = (['inTitle', 'inMeta', 'inContent', 'inSlug'] as const)
          .filter(k => !p[k])
          .map(k => ({ inTitle: 'title tag', inMeta: 'meta description', inContent: 'page content', inSlug: 'URL slug' }[k]));
        if (missing.length > 0) {
          parts.push(`PRIMARY KEYWORD MISSING FROM: ${missing.join(', ')}`);
        }
      }
      if (profile.competitorKeywords?.length) {
        parts.push(`COMPETITOR KEYWORDS TO CONSIDER: ${profile.competitorKeywords.join(', ')}`);
      }
      if (profile.topicCluster) {
        parts.push(`TOPIC CLUSTER: ${profile.topicCluster}`);
      }
      if (profile.estimatedDifficulty) {
        parts.push(`ESTIMATED DIFFICULTY: ${profile.estimatedDifficulty}`);
      }
      if (parts.length > 0) {
        pageAnalysisBlock = `\n\nPAGE ANALYSIS (address these issues in your rewrite — this is what our platform flagged for this page):\n${parts.join('\n')}`;
      }
    }
  }

  // If no match found via keyword lookup, use pre-computed analysis from Page Intelligence
  if (!pageAnalysisBlock && context.pageAnalysisContext) {
    const pac = context.pageAnalysisContext;
    const parts: string[] = [];
    if (pac.optimizationScore !== undefined) parts.push(`Optimization score: ${pac.optimizationScore}/100`);
    if (pac.searchIntent) parts.push(`Search intent: ${pac.searchIntent}`);
    if (pac.optimizationIssues?.length) parts.push(`Issues to address:\n${pac.optimizationIssues.map(i => `- ${i}`).join('\n')}`);
    if (pac.contentGaps?.length) parts.push(`Content gaps to fill:\n${pac.contentGaps.map(g => `- ${g}`).join('\n')}`);
    if (pac.recommendations?.length) parts.push(`Recommendations from page analysis:\n${pac.recommendations.map(r => `- ${r}`).join('\n')}`);
    if (parts.length > 0) {
      pageAnalysisBlock = `\n\nPAGE ANALYSIS CONTEXT (from prior Page Intelligence analysis — address these specific issues in the brief):\n${parts.join('\n')}`;
    }
  }

  // SERP feature directives — derived from per-page serpFeatures stored in page_keywords.
  // SEMRush flags which SERP features are present for the primary keyword; we translate
  // those signals into concrete structural directives for the brief writer.
  let serpFeaturesDirectiveBlock = '';
  if (matchedPage?.serpFeatures?.length) {
    const feats = matchedPage.serpFeatures;
    const directives: string[] = [];
    if (feats.includes('featured_snippet')) {
      directives.push('FEATURED SNIPPET OPPORTUNITY: Structure a clear, concise definition or numbered step list in the first 100 words. The opening paragraph should directly answer the target query in 40-60 words.');
    }
    if (feats.includes('people_also_ask')) {
      directives.push('PEOPLE ALSO ASK OPPORTUNITY: Include a dedicated FAQ section with 4-6 concise Q&A pairs. Questions should directly address what users ask about this topic.');
    }
    if (feats.includes('video')) {
      directives.push('VIDEO CAROUSEL OPPORTUNITY: Recommend embedding a relevant video or note that a video component will improve SERP visibility for this keyword.');
    }
    if (feats.includes('local_pack')) {
      directives.push('LOCAL PACK OPPORTUNITY: Include location-specific content, NAP details, and recommend LocalBusiness schema markup.');
    }
    if (directives.length > 0) {
      serpFeaturesDirectiveBlock = `\n\nSERP FEATURE OPPORTUNITIES (SEMRush data shows these are present for "${targetKeyword}" — structure the content to target them):\n${directives.join('\n')}`;
    }
  }

  // Reference URL context (competitor/inspiration pages)
  const referenceBlock = context.scrapedReferences?.length
    ? buildReferenceContext(context.scrapedReferences)
    : '';

  // Real SERP data (PAA + top results)
  const serpBlock = context.serpData
    ? buildSerpContext({
        query: targetKeyword,
        peopleAlsoAsk: context.serpData.peopleAlsoAsk,
        organicResults: context.serpData.organicResults.map(r => ({ ...r, snippet: '' })),
        fetchedAt: new Date().toISOString(),
      })
    : '';

  // Style examples from top-performing pages on the site
  const styleBlock = context.styleExamples?.length
    ? buildStyleExampleContext(context.styleExamples)
    : '';

  // Build SEMRush data block (real metrics replace hallucinated data)
  let semrushBlock = '';
  if (context.semrushMetrics) {
    const m = context.semrushMetrics;
    semrushBlock += `\n\nREAL KEYWORD DATA (from SEMRush — use these exact numbers, do NOT hallucinate different values):
- Monthly search volume: ${m.volume.toLocaleString()}
- Keyword difficulty: ${m.difficulty}/100
- CPC: $${m.cpc.toFixed(2)}
- Competition: ${m.competition.toFixed(2)}
- Total results: ${m.results.toLocaleString()}`;
    if (m.trend?.length) {
      semrushBlock += `\n- 12-month volume trend: ${m.trend.join(', ')}`;
    }
  }
  if (context.semrushRelated?.length) {
    semrushBlock += `\n\nRELATED KEYWORDS (from SEMRush — real data, use for secondary keywords and topical entities):\n`;
    semrushBlock += context.semrushRelated.slice(0, 15)
      .map(r => `"${r.keyword}" (vol: ${r.volume.toLocaleString()}, KD: ${r.difficulty}, CPC: $${r.cpc.toFixed(2)})`)
      .join('\n');
  }

  // GA4 page performance data (for existing-page content refreshes)
  let ga4Block = '';
  if (context.ga4PagePerformance?.length) {
    ga4Block = `\n\nEXISTING PAGE PERFORMANCE DATA (from GA4 — last 28 days, use to inform content strategy):\n`;
    ga4Block += context.ga4PagePerformance.slice(0, 10).map(p => {
      const engMin = (p.avgEngagementTime / 60).toFixed(1);
      return `- ${p.landingPage}: ${p.sessions} sessions, ${p.users} users, ${p.bounceRate}% bounce rate, ${engMin}m avg engagement, ${p.conversions} conversions`;
    }).join('\n');
    ga4Block += `\n\nUse this data to:\n- Identify which existing pages perform well (low bounce, high engagement) and why\n- Spot underperforming pages that a content refresh could improve\n- Recommend internal links to high-traffic pages\n- Set realistic traffic expectations based on current performance`;
  }

  // Template constraint block (when generating from a content template)
  let templateBlock = '';
  if (context.templateSections?.length) {
    templateBlock = `\n\nTEMPLATE STRUCTURE (REQUIRED — you MUST follow this exact section structure):
The outline sections MUST match the following template sections in order. You may add 1-2 supplementary sections (FAQ, conclusion) but the core structure is fixed:`;
    for (const s of context.templateSections) {
      templateBlock += `\n- Section "${s.name}": heading pattern "${s.headingTemplate}" — ${s.guidance} (target ~${s.wordCountTarget} words)`;
    }
    if (context.templateToneOverride) {
      templateBlock += `\n\nTONE OVERRIDE: Use this specific tone and style instead of your default: ${context.templateToneOverride}`;
    }
    if (context.templateTitlePattern) {
      templateBlock += `\nTITLE PATTERN: The suggestedTitle MUST follow this pattern: ${context.templateTitlePattern} — substitute variable values with SEO-optimized text.`;
    }
    if (context.templateMetaDescPattern) {
      templateBlock += `\nMETA DESC PATTERN: The suggestedMetaDesc MUST follow this pattern: ${context.templateMetaDescPattern}`;
    }
  }

  // Page-type-specific instructions and configuration
  const ptConfig = getPageTypeConfig(context.pageType);
  const pageTypeBlock = context.pageType && PAGE_TYPE_CONFIGS[context.pageType]
    ? `\n\n${ptConfig.prompt}\n\nCONTENT STYLE: ${ptConfig.contentStyle}\n\nTailor ALL aspects of the brief (outline structure, word count, CTA, schema, content format) to this page type. The wordCountTarget MUST be approximately ${ptConfig.wordCountTarget} (range: ${ptConfig.wordCountRange} words). Do NOT default to 1800 words unless this is a blog post.`
    : '';

  // Analytics intelligence from the intelligence layer
  let intelligenceBlock = '';
  try {
    const allInsights = getInsights(workspaceId);
    if (allInsights.length > 0) {
      intelligenceBlock = buildBriefIntelligenceBlock({
        targetKeyword,
        workspaceId,
        cannibalizationInsights: allInsights
          .filter(i => i.insightType === 'cannibalization')
          .map(i => i.data as unknown as CannibalizationData),
        decayInsights: allInsights
          .filter(i => i.insightType === 'content_decay')
          .map(i => ({ pageId: i.pageId || '', ...(i.data as unknown as ContentDecayData) })),
        quickWins: allInsights
          .filter(i => i.insightType === 'ranking_opportunity')
          .map(i => i.data as unknown as QuickWinData)
          .map(d => ({ pageUrl: d.pageUrl, query: d.query, currentPosition: d.currentPosition, estimatedTrafficGain: d.estimatedTrafficGain })),
        pageHealthScores: allInsights
          .filter(i => i.insightType === 'page_health' && i.pageId)
          .map(i => ({ pageId: i.pageId!, ...(i.data as unknown as PageHealthData) })),
      });
    }
  } catch { /* intelligence layer not ready — skip */ }

  // Workspace learnings: what content types and strategies historically win
  let learningsBlock = '';
  if (isFeatureEnabled('outcome-ai-injection')) {
    try {
      const learnings = getWorkspaceLearnings(workspaceId);
      if (learnings) {
        const block = formatLearningsForPrompt(learnings, 'content');
        if (block) {
          learningsBlock = `\n\n${block}`;
        }
      }
    } catch { /* learnings not available — skip */ }
  }

  // Strategy card context from content request
  const strategyCardBlock = buildStrategyCardBlock(context.strategyCardContext);

  const prompt = `Generate a comprehensive, production-ready content brief for a new piece of content targeting the keyword "${targetKeyword}".${pageTypeBlock}

${bizCtx ? `Business context: ${bizCtx}` : ''}

Related search queries from Google Search Console:
${relatedStr}

Existing pages on the site:
${pagesStr}${keywordBlock}${brandVoiceBlock}${kwMapContext}${knowledgeBlock}${personasBlock}${semrushBlock}${ga4Block}${pageAnalysisBlock}${serpFeaturesDirectiveBlock}${referenceBlock}${serpBlock}${styleBlock}${templateBlock}${strategyCardBlock}${intelligenceBlock}${learningsBlock}

Generate a content brief in the following JSON format:
{
  "executiveSummary": "2-3 sentence plain-English summary of why this content matters and its strategic value. Write from the reader's perspective (what THEY gain), not the brand's perspective (do NOT say 'position [brand] as an expert' or 'reinforce authority')",
  "suggestedTitle": "SEO-optimized title tag (50-60 chars) — your top recommendation",
  "titleVariants": ["Alternative title option 2 (50-60 chars)", "Alternative title option 3 (50-60 chars)"],
  "suggestedMetaDesc": "Compelling meta description (150-160 chars) — your top recommendation",
  "metaDescVariants": ["Alternative meta description 2 (150-160 chars)", "Alternative meta description 3 (150-160 chars)"],
  "secondaryKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8"],
  "contentFormat": "The recommended format: guide, listicle, how-to, comparison, FAQ, case-study, pillar-page, or landing-page",
  "toneAndStyle": "Specific tone and style guidance for the writer (e.g., authoritative but approachable, data-driven, conversational)",
  "outline": [
    { "heading": "H2 heading text", "subheadings": ["H3 subtopic 1", "H3 subtopic 2"], "notes": "Detailed guidance for this section: what to cover, key points, data to include (3-5 sentences)", "wordCount": ${ptConfig.avgSectionWords}, "keywords": ["keywords to naturally include in this section"] }
  ],
  "wordCountTarget": ${ptConfig.wordCountTarget},
  "intent": "Search intent (informational/transactional/navigational/commercial)",
  "audience": "Detailed target audience description including their pain points and what they need from this content",
  "peopleAlsoAsk": ["Question 1 searchers commonly ask?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"],
  "topicalEntities": ["entity1", "entity2", "entity3", "entity4", "entity5", "entity6", "entity7", "entity8"],
  "serpAnalysis": {
    "contentType": "What type of content dominates the SERP for this keyword",
    "avgWordCount": ${ptConfig.wordCountTarget},
    "commonElements": ["Elements found in top-ranking content (e.g., comparison tables, images, expert quotes)"],
    "gaps": ["Content angles missing from top results that represent an opportunity"]
  },
  "difficultyScore": 45,
  "trafficPotential": "Estimated monthly search volume range and traffic potential (e.g., '500-1,000 monthly searches, moderate competition')",
  "competitorInsights": "Detailed analysis of what top-ranking content covers, their strengths, weaknesses, and how to differentiate",
  "ctaRecommendations": ["Primary CTA the content should drive", "Secondary CTA or micro-conversion"],
  "internalLinkSuggestions": ["/services/strategy", "/our-work/case-study", "/insights/blog-post"],
  "eeatGuidance": {
    "experience": "Specific first-hand experience signals to include (e.g., original photos, case studies, personal anecdotes, hands-on testing notes)",
    "expertise": "How to demonstrate subject-matter expertise (e.g., cite specific data, reference industry standards, include technical depth)",
    "authority": "Authority signals to build (e.g., link to authoritative sources, reference credentials, mention industry recognition)",
    "trust": "Trust signals to include (e.g., transparent methodology, updated dates, author bio recommendations, sources to cite)"
  },
  "contentChecklist": [
    "Actionable item the writer should verify before publishing (8-10 items)",
    "e.g., Include at least 2 original data points or statistics",
    "e.g., Add a comparison table in the [specific] section",
    "e.g., Include an FAQ section using the People Also Ask questions",
    "e.g., Add alt text to all images using secondary keywords"
  ],
  "schemaRecommendations": [
    { "type": "Schema type (e.g., FAQPage, HowTo, Article, LocalBusiness)", "notes": "How to implement — which content maps to this schema and why it helps rankings" }
  ]
}

Requirements:
- The outline should have ${ptConfig.sectionRange} sections with H2 headings, each with specific wordCount targets that sum to the total wordCountTarget (${ptConfig.wordCountRange} words)
- Each outline section MUST include 2-3 subheadings (H3 topics) that break the section into scannable subtopics. These guide the writer to create well-structured, scannable content. Every section with 200+ words should have at least 2 subheadings
- Each outline section must include keywords to weave naturally into that section
- Secondary keywords: 6-8 naturally related terms including long-tail variations
- People Also Ask: 5 real questions searchers ask about this topic
- Topical entities: 8+ specific concepts, terms, or entities to cover for topical authority
- SERP analysis should reflect realistic analysis of what ranks for this keyword
- difficultyScore: 1-100 based on estimated keyword competition
- Make every section actionable and specific — a copywriter or AI tool should be able to write directly from this brief
- CASE STUDY RULE: If including a case study section, write the outline notes as generic guidance (e.g., "Share a client case study showing content strategy results"). Do NOT name specific clients or projects in the outline notes — the writer will pull the right case study from the knowledge base. Do NOT put industry-specific keywords (e.g., "dental practice branding") in the case study section's keyword list unless the target keyword is specifically about that industry
- FAQ RULE: If including an FAQ section, allocate at least 150 words (not 100). The writer needs room to format individual Q&A pairs with proper headings. Each question should get its own answer paragraph
- EXAMPLE DIVERSITY: Outline notes should suggest examples from varied industries, not repeat the same industry across every section. If the business context mentions one industry (e.g., dental), reference it in at most 2 sections and suggest different industry examples for the rest
- SECTION COUNT: For blog posts targeting 1,500-2,500 words, prefer 5-7 substantive sections over 8+ thin ones. Each section should have enough word budget (200-400 words) to go deep on one topic
- LOCATION RULE: If the target keyword references a specific city/region, ALL content in this brief (title, meta description, outline, headings) must target THAT location. Do NOT substitute the business headquarters or a different city from the general business context. The target keyword is the authoritative location signal.
- Internal link suggestions: pick 3-5 pages from the "Existing pages on the site" list that are topically related to this content. Use the EXACT paths from that list. Prefer service pages, case studies, and related blog posts over generic pages like /about or /contact
- E-E-A-T guidance must be specific and actionable for this particular topic, not generic advice
- Content checklist: 8-10 concrete, verifiable items tailored to this brief (not generic SEO advice)
- Schema recommendations: 1-3 relevant schema types with specific implementation guidance

AEO (ANSWER ENGINE OPTIMIZATION) RULES — make content citeable by AI systems:
- ANSWER-FIRST LAYOUT: The first outline section MUST be a direct-answer summary (2-3 sentences answering the core question, then key bullets). This is what LLMs extract as the cited snippet. Do NOT open with generic intros like "Welcome to…" or "In this guide…"
- CITATION TARGETS: Include a note in the content checklist about citation density. For medical/health content: 1 citation per ~200 words. For business content: 1 citation per ~400 words. Prefer primary sources: journals, .gov, .edu, professional associations
- DEFINITION BLOCKS: For any content with technical or specialized terms, recommend definition blocks in the outline notes: Term → 1-2 sentence definition → Common misconceptions → Related terms. These become cited snippets
- COMPARISON TABLES: Where applicable, recommend comparison tables with measurable fields (costs, percentages, timeframes), stated units, footnotes/citations per row, and a "Data as of [date]" note. Vague adjective tables ("good", "better") are useless — use numbers
- FAQ QUALITY: FAQ answers should be 30-80 words each. Each answer should link to a deeper section. Write real questions patients/customers ask, not keyword-stuffed variations
- AUTHOR & DATE: Include in content checklist: "Add author byline with credentials" and "Add visible 'Last updated: [date]' below the title"

LANGUAGE RULES for the brief itself:
- Do NOT use corporate buzzwords in any field: "empower", "leverage", "streamline", "optimize", "harness", "revolutionize", "game-changing", "cutting-edge", "powerful", "world-class"
- The executiveSummary should be plain, specific, and jargon-free — describe what the reader will learn and why it matters to them
- Do NOT use "Ready to [verb]?" rhetorical questions anywhere in the brief
- Internal link paths must start with a single forward slash (e.g., "/services/strategy"), not double slashes

Return ONLY valid JSON, no markdown fences, no explanation.`;

  const systemInstructions = 'You are an expert SEO content strategist. Generate a comprehensive content brief as a JSON object. Return ONLY valid JSON matching the expected schema — no markdown fences, no explanation.';
  const systemPrompt = buildSystemPrompt(workspaceId, systemInstructions);

  const aiResult = await callOpenAI({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    maxTokens: 7000,
    temperature: 0.5,
    responseFormat: { type: 'json_object' },
    feature: 'content-brief',
    workspaceId,
  });

  const raw = aiResult.text || '{}';
  const parsed = parseAiJson(raw, 'content-brief');

  const brief: ContentBrief = {
    id: `brief_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    targetKeyword,
    secondaryKeywords: (parsed.secondaryKeywords as string[]) || [],
    suggestedTitle: (parsed.suggestedTitle as string) || '',
    suggestedMetaDesc: (parsed.suggestedMetaDesc as string) || '',
    outline: (parsed.outline as ContentBrief['outline']) || [],
    wordCountTarget: (parsed.wordCountTarget as number) || 1500,
    intent: (parsed.intent as string) || 'informational',
    audience: (parsed.audience as string) || '',
    competitorInsights: (parsed.competitorInsights as string) || '',
    internalLinkSuggestions: (parsed.internalLinkSuggestions as string[]) || [],
    createdAt: new Date().toISOString(),
    executiveSummary: (parsed.executiveSummary as string) || undefined,
    contentFormat: (parsed.contentFormat as string) || undefined,
    toneAndStyle: (parsed.toneAndStyle as string) || undefined,
    peopleAlsoAsk: (parsed.peopleAlsoAsk as string[]) || undefined,
    topicalEntities: (parsed.topicalEntities as string[]) || undefined,
    serpAnalysis: (parsed.serpAnalysis as ContentBrief['serpAnalysis']) || undefined,
    difficultyScore: (parsed.difficultyScore as number) || undefined,
    trafficPotential: (parsed.trafficPotential as string) || undefined,
    ctaRecommendations: (parsed.ctaRecommendations as string[]) || undefined,
    eeatGuidance: (parsed.eeatGuidance as ContentBrief['eeatGuidance']) || undefined,
    contentChecklist: (parsed.contentChecklist as string[]) || undefined,
    schemaRecommendations: (parsed.schemaRecommendations as ContentBrief['schemaRecommendations']) || undefined,
    titleVariants: (parsed.titleVariants as string[]) || undefined,
    metaDescVariants: (parsed.metaDescVariants as string[]) || undefined,
    pageType: (context.pageType as ContentBrief['pageType']) || undefined,
    // Persist real SERP data so post generation can use it
    realPeopleAlsoAsk: context.serpData?.peopleAlsoAsk?.length ? context.serpData.peopleAlsoAsk : undefined,
    realTopResults: context.serpData?.organicResults?.length
      ? context.serpData.organicResults.map(r => ({ position: r.position, title: r.title, url: r.url }))
      : undefined,
    referenceUrls: context.referenceUrls,
    // Keyword pre-assignment tracking
    keywordLocked: context.keywordLocked || undefined,
    keywordSource: context.keywordSource || undefined,
    keywordValidation: context.keywordValidation || undefined,
    templateId: context.templateId || undefined,
  };

  stmts().insert.run({
    id: brief.id,
    workspace_id: workspaceId,
    target_keyword: brief.targetKeyword,
    secondary_keywords: JSON.stringify(brief.secondaryKeywords),
    suggested_title: brief.suggestedTitle,
    suggested_meta_desc: brief.suggestedMetaDesc,
    outline: JSON.stringify(brief.outline),
    word_count_target: brief.wordCountTarget,
    intent: brief.intent,
    audience: brief.audience,
    competitor_insights: brief.competitorInsights,
    internal_link_suggestions: JSON.stringify(brief.internalLinkSuggestions),
    created_at: brief.createdAt,
    executive_summary: brief.executiveSummary ?? null,
    content_format: brief.contentFormat ?? null,
    tone_and_style: brief.toneAndStyle ?? null,
    people_also_ask: brief.peopleAlsoAsk ? JSON.stringify(brief.peopleAlsoAsk) : null,
    topical_entities: brief.topicalEntities ? JSON.stringify(brief.topicalEntities) : null,
    serp_analysis: brief.serpAnalysis ? JSON.stringify(brief.serpAnalysis) : null,
    difficulty_score: brief.difficultyScore ?? null,
    traffic_potential: brief.trafficPotential ?? null,
    cta_recommendations: brief.ctaRecommendations ? JSON.stringify(brief.ctaRecommendations) : null,
    eeat_guidance: brief.eeatGuidance ? JSON.stringify(brief.eeatGuidance) : null,
    content_checklist: brief.contentChecklist ? JSON.stringify(brief.contentChecklist) : null,
    schema_recommendations: brief.schemaRecommendations ? JSON.stringify(brief.schemaRecommendations) : null,
    page_type: brief.pageType ?? null,
    reference_urls: brief.referenceUrls ? JSON.stringify(brief.referenceUrls) : null,
    real_people_also_ask: brief.realPeopleAlsoAsk ? JSON.stringify(brief.realPeopleAlsoAsk) : null,
    real_top_results: brief.realTopResults ? JSON.stringify(brief.realTopResults) : null,
    keyword_locked: brief.keywordLocked ? 1 : 0,
    keyword_source: brief.keywordSource ?? null,
    keyword_validation: brief.keywordValidation ? JSON.stringify(brief.keywordValidation) : null,
    template_id: brief.templateId ?? null,
    title_variants: brief.titleVariants ? JSON.stringify(brief.titleVariants) : null,
    meta_desc_variants: brief.metaDescVariants ? JSON.stringify(brief.metaDescVariants) : null,
  });

  return brief;
}
