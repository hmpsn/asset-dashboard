/**
 * AI Content Generator — generates full SEO-optimized content from content briefs.
 * Adapts prompts per page type (blog, landing, service, location, product, pillar, resource).
 * Each section is generated independently using the brief's outline as the writing spec.
 */
import db from './db/index.js';
import { buildSeoContext, buildKnowledgeBase, buildKeywordMapContext, buildPersonasContext } from './seo-context.js';
import { callOpenAI } from './openai-helpers.js';
import { callAnthropic, isAnthropicConfigured } from './anthropic-helpers.js';
import { getWorkspace } from './workspaces.js';
import type { ContentBrief } from './content-brief.js';

// --- Types ---

export type { PostSection, GeneratedPost } from '../shared/types/content.ts';
import type { PostSection, GeneratedPost } from '../shared/types/content.ts';
import { createLogger } from './logger.js';

const log = createLogger('content-posts');

// ── SQLite row shape ──

interface PostRow {
  id: string;
  workspace_id: string;
  brief_id: string;
  target_keyword: string;
  title: string;
  meta_description: string;
  introduction: string;
  sections: string;
  conclusion: string;
  seo_title: string | null;
  seo_meta_description: string | null;
  total_word_count: number;
  target_word_count: number;
  status: string;
  unification_status: string | null;
  unification_note: string | null;
  webflow_item_id: string | null;
  webflow_collection_id: string | null;
  published_at: string | null;
  published_slug: string | null;
  created_at: string;
  updated_at: string;
}

interface PostStmts {
  insert: ReturnType<typeof db.prepare>;
  selectByWorkspace: ReturnType<typeof db.prepare>;
  selectById: ReturnType<typeof db.prepare>;
  update: ReturnType<typeof db.prepare>;
  deleteById: ReturnType<typeof db.prepare>;
}

// ── Version history types ──

export interface PostVersion {
  id: string;
  postId: string;
  workspaceId: string;
  versionNumber: number;
  trigger: 'regenerate_section' | 'manual_edit' | 'unification' | 'bulk_regenerate';
  triggerDetail?: string;
  title: string;
  metaDescription: string;
  introduction: string;
  sections: PostSection[];
  conclusion: string;
  seoTitle?: string;
  seoMetaDescription?: string;
  totalWordCount: number;
  createdAt: string;
}

interface VersionRow {
  id: string;
  post_id: string;
  workspace_id: string;
  version_number: number;
  trigger: string;
  trigger_detail: string | null;
  title: string;
  meta_description: string;
  introduction: string;
  sections: string;
  conclusion: string;
  seo_title: string | null;
  seo_meta_description: string | null;
  total_word_count: number;
  created_at: string;
}

interface VersionStmts {
  insert: ReturnType<typeof db.prepare>;
  listByPost: ReturnType<typeof db.prepare>;
  getById: ReturnType<typeof db.prepare>;
  countByPost: ReturnType<typeof db.prepare>;
  deleteByPost: ReturnType<typeof db.prepare>;
}

let _vStmts: VersionStmts | null = null;
function vStmts(): VersionStmts {
  if (!_vStmts) {
    _vStmts = {
      insert: db.prepare(
        `INSERT INTO content_post_versions
           (id, post_id, workspace_id, version_number, trigger, trigger_detail,
            title, meta_description, introduction, sections, conclusion,
            seo_title, seo_meta_description, total_word_count, created_at)
         VALUES
           (@id, @post_id, @workspace_id, @version_number, @trigger, @trigger_detail,
            @title, @meta_description, @introduction, @sections, @conclusion,
            @seo_title, @seo_meta_description, @total_word_count, @created_at)`,
      ),
      listByPost: db.prepare(
        `SELECT * FROM content_post_versions WHERE post_id = ? AND workspace_id = ? ORDER BY version_number DESC`,
      ),
      getById: db.prepare(
        `SELECT * FROM content_post_versions WHERE id = ? AND workspace_id = ?`,
      ),
      countByPost: db.prepare(
        `SELECT COUNT(*) as cnt FROM content_post_versions WHERE post_id = ?`,
      ),
      deleteByPost: db.prepare(
        `DELETE FROM content_post_versions WHERE post_id = ? AND workspace_id = ?`,
      ),
    };
  }
  return _vStmts;
}

function rowToVersion(row: VersionRow): PostVersion {
  return {
    id: row.id,
    postId: row.post_id,
    workspaceId: row.workspace_id,
    versionNumber: row.version_number,
    trigger: row.trigger as PostVersion['trigger'],
    triggerDetail: row.trigger_detail ?? undefined,
    title: row.title,
    metaDescription: row.meta_description,
    introduction: row.introduction,
    sections: JSON.parse(row.sections),
    conclusion: row.conclusion,
    seoTitle: row.seo_title ?? undefined,
    seoMetaDescription: row.seo_meta_description ?? undefined,
    totalWordCount: row.total_word_count,
    createdAt: row.created_at,
  };
}

let _stmts: PostStmts | null = null;
function stmts(): PostStmts {
  if (!_stmts) {
    _stmts = {
      // Note: INSERT omits webflow_* / published_* columns intentionally.
      // savePost() routes existing rows to UPDATE (which includes them).
      // New posts never have publish data so omitting here is safe.
      insert: db.prepare(
        `INSERT OR REPLACE INTO content_posts
           (id, workspace_id, brief_id, target_keyword, title, meta_description,
            introduction, sections, conclusion, seo_title, seo_meta_description,
            total_word_count, target_word_count, status, unification_status,
            unification_note, created_at, updated_at)
         VALUES
           (@id, @workspace_id, @brief_id, @target_keyword, @title, @meta_description,
            @introduction, @sections, @conclusion, @seo_title, @seo_meta_description,
            @total_word_count, @target_word_count, @status, @unification_status,
            @unification_note, @created_at, @updated_at)`,
      ),
      selectByWorkspace: db.prepare(
        `SELECT * FROM content_posts WHERE workspace_id = ? ORDER BY created_at DESC`,
      ),
      selectById: db.prepare(
        `SELECT * FROM content_posts WHERE id = ? AND workspace_id = ?`,
      ),
      update: db.prepare(
        `UPDATE content_posts SET
           title = @title, meta_description = @meta_description,
           introduction = @introduction, sections = @sections, conclusion = @conclusion,
           seo_title = @seo_title, seo_meta_description = @seo_meta_description,
           total_word_count = @total_word_count, target_word_count = @target_word_count,
           status = @status, unification_status = @unification_status,
           unification_note = @unification_note,
           webflow_item_id = @webflow_item_id, webflow_collection_id = @webflow_collection_id,
           published_at = @published_at, published_slug = @published_slug,
           updated_at = @updated_at
         WHERE id = @id`,
      ),
      deleteById: db.prepare(
        `DELETE FROM content_posts WHERE id = ? AND workspace_id = ?`,
      ),
    };
  }
  return _stmts;
}

function rowToPost(row: PostRow): GeneratedPost {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    briefId: row.brief_id,
    targetKeyword: row.target_keyword,
    title: row.title,
    metaDescription: row.meta_description,
    introduction: row.introduction,
    sections: JSON.parse(row.sections),
    conclusion: row.conclusion,
    seoTitle: row.seo_title ?? undefined,
    seoMetaDescription: row.seo_meta_description ?? undefined,
    totalWordCount: row.total_word_count,
    targetWordCount: row.target_word_count,
    status: row.status as GeneratedPost['status'],
    unificationStatus: row.unification_status as GeneratedPost['unificationStatus'] ?? undefined,
    unificationNote: row.unification_note ?? undefined,
    webflowItemId: row.webflow_item_id ?? undefined,
    webflowCollectionId: row.webflow_collection_id ?? undefined,
    publishedAt: row.published_at ?? undefined,
    publishedSlug: row.published_slug ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function postToParams(post: GeneratedPost): Record<string, unknown> {
  return {
    id: post.id,
    workspace_id: post.workspaceId,
    brief_id: post.briefId,
    target_keyword: post.targetKeyword,
    title: post.title,
    meta_description: post.metaDescription,
    introduction: post.introduction,
    sections: JSON.stringify(post.sections),
    conclusion: post.conclusion,
    seo_title: post.seoTitle ?? null,
    seo_meta_description: post.seoMetaDescription ?? null,
    total_word_count: post.totalWordCount,
    target_word_count: post.targetWordCount,
    status: post.status,
    unification_status: post.unificationStatus ?? null,
    unification_note: post.unificationNote ?? null,
    webflow_item_id: post.webflowItemId ?? null,
    webflow_collection_id: post.webflowCollectionId ?? null,
    published_at: post.publishedAt ?? null,
    published_slug: post.publishedSlug ?? null,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
  };
}

export function listPosts(workspaceId: string): GeneratedPost[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as PostRow[];
  return rows.map(rowToPost);
}

export function getPost(workspaceId: string, postId: string): GeneratedPost | undefined {
  const row = stmts().selectById.get(postId, workspaceId) as PostRow | undefined;
  return row ? rowToPost(row) : undefined;
}

export function savePost(workspaceId: string, post: GeneratedPost): void {
  const existing = stmts().selectById.get(post.id, workspaceId) as PostRow | undefined;
  if (existing) {
    stmts().update.run(postToParams(post));
  } else {
    stmts().insert.run(postToParams(post));
  }
}

export function updatePostField(workspaceId: string, postId: string, updates: Partial<Omit<GeneratedPost, 'id' | 'workspaceId' | 'createdAt'>>): GeneratedPost | null {
  const post = getPost(workspaceId, postId);
  if (!post) return null;
  Object.assign(post, updates, { updatedAt: new Date().toISOString() });
  stmts().update.run(postToParams(post));
  return post;
}

export function deletePost(workspaceId: string, postId: string): boolean {
  // Also delete version history
  vStmts().deleteByPost.run(postId, workspaceId);
  const info = stmts().deleteById.run(postId, workspaceId);
  return info.changes > 0;
}

// ── Version history API ──

/** Snapshot the current state of a post before a destructive change. */
export function snapshotPostVersion(
  post: GeneratedPost,
  trigger: PostVersion['trigger'],
  triggerDetail?: string,
): PostVersion {
  const count = (vStmts().countByPost.get(post.id) as { cnt: number }).cnt;
  const version: PostVersion = {
    id: `pv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    postId: post.id,
    workspaceId: post.workspaceId,
    versionNumber: count + 1,
    trigger,
    triggerDetail,
    title: post.title,
    metaDescription: post.metaDescription,
    introduction: post.introduction,
    sections: post.sections,
    conclusion: post.conclusion,
    seoTitle: post.seoTitle,
    seoMetaDescription: post.seoMetaDescription,
    totalWordCount: post.totalWordCount,
    createdAt: new Date().toISOString(),
  };
  vStmts().insert.run({
    id: version.id,
    post_id: version.postId,
    workspace_id: version.workspaceId,
    version_number: version.versionNumber,
    trigger: version.trigger,
    trigger_detail: version.triggerDetail ?? null,
    title: version.title,
    meta_description: version.metaDescription,
    introduction: version.introduction,
    sections: JSON.stringify(version.sections),
    conclusion: version.conclusion,
    seo_title: version.seoTitle ?? null,
    seo_meta_description: version.seoMetaDescription ?? null,
    total_word_count: version.totalWordCount,
    created_at: version.createdAt,
  });
  log.info(`Snapshot v${version.versionNumber} for post ${post.id} (trigger: ${trigger}${triggerDetail ? `, ${triggerDetail}` : ''})`);
  return version;
}

/** List all versions for a post (newest first). */
export function listPostVersions(workspaceId: string, postId: string): PostVersion[] {
  const rows = vStmts().listByPost.all(postId, workspaceId) as VersionRow[];
  return rows.map(rowToVersion);
}

/** Get a specific version by ID. */
export function getPostVersion(workspaceId: string, versionId: string): PostVersion | undefined {
  const row = vStmts().getById.get(versionId, workspaceId) as VersionRow | undefined;
  return row ? rowToVersion(row) : undefined;
}

/** Revert a post to a previous version (snapshots current state first). */
export function revertToVersion(workspaceId: string, postId: string, versionId: string): GeneratedPost | null {
  const post = getPost(workspaceId, postId);
  if (!post) return null;
  const version = getPostVersion(workspaceId, versionId);
  if (!version || version.postId !== postId) return null;

  // Snapshot current state before reverting
  snapshotPostVersion(post, 'manual_edit', `revert_to_v${version.versionNumber}`);

  // Apply version data
  post.title = version.title;
  post.metaDescription = version.metaDescription;
  post.introduction = version.introduction;
  post.sections = version.sections;
  post.conclusion = version.conclusion;
  post.seoTitle = version.seoTitle;
  post.seoMetaDescription = version.seoMetaDescription;
  post.totalWordCount = version.totalWordCount;
  post.updatedAt = new Date().toISOString();
  stmts().update.run(postToParams(post));
  log.info(`Reverted post ${postId} to version ${version.versionNumber}`);
  return post;
}

// --- Generation ---

// AI model config — Claude for creative prose, GPT for structured tasks.
// Claude produces more natural, less formulaic writing. GPT excels at
// JSON output, unification editing, and SEO meta generation.
const CONTENT_MODEL = 'gpt-4.1';         // fallback + structured tasks
const CONTENT_TEMP = 0.7;
const CLAUDE_MODEL = 'claude-sonnet-4-20250514' as const;
const CLAUDE_TEMP = 0.7;

/**
 * Route creative writing to Claude when available, fall back to GPT.
 * Claude's system prompt is separate from messages (not a role).
 */
async function callCreativeAI(opts: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  feature: string;
  workspaceId: string;
}): Promise<string> {
  const { systemPrompt, userPrompt, maxTokens, feature, workspaceId } = opts;

  if (isAnthropicConfigured()) {
    try {
      const result = await callAnthropic({
        model: CLAUDE_MODEL,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens,
        temperature: CLAUDE_TEMP,
        feature,
        workspaceId,
        maxRetries: 3,      // patient retries — quality over speed
        timeoutMs: 90_000,
      });
      log.info(`[${feature}] Generated with Claude`);
      return result.text.trim();
    } catch (err) {
      log.info(`[${feature}] Claude failed (${err instanceof Error ? err.message : err}), falling back to GPT`);
    }
  }

  // Fallback to GPT (or primary if no Anthropic key)
  const result = await callOpenAI({
    model: CONTENT_MODEL,
    messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }],
    maxTokens,
    temperature: CONTENT_TEMP,
    feature,
    workspaceId,
  });
  log.info(`[${feature}] Generated with GPT`);
  return result.text.trim();
}

function buildVoiceContext(workspaceId: string): string {
  const { brandVoiceBlock, keywordBlock } = buildSeoContext(workspaceId);
  const knowledgeBlock = buildKnowledgeBase(workspaceId);
  const kwMapBlock = buildKeywordMapContext(workspaceId);
  const personasBlock = buildPersonasContext(workspaceId);
  return `${brandVoiceBlock}${keywordBlock}${knowledgeBlock}${kwMapBlock}${personasBlock}`;
}

// --- Page-type-specific writing instructions ---

const PAGE_TYPE_WRITER_ROLE: Record<string, string> = {
  blog: 'You are an expert SEO content writer specializing in long-form educational blog content that ranks and converts.',
  landing: 'You are an expert conversion copywriter specializing in high-converting landing pages. Every word should drive the reader toward a single action.',
  service: 'You are an expert service-industry copywriter who communicates expertise, builds trust, and drives consultations.',
  location: 'You are a local SEO copywriter who creates location-specific content that ranks in local search and builds community trust.',
  product: 'You are a product copywriter who turns features into benefits and drives purchase decisions through clear, persuasive writing.',
  pillar: 'You are an authority content strategist creating comprehensive hub pages that establish topical authority and drive organic traffic.',
  resource: 'You are an educational content writer creating actionable guides and resources that establish thought leadership.',
};

const PAGE_TYPE_INTRO_INSTRUCTIONS: Record<string, string> = {
  blog: `- Open with a specific, concrete scenario, bold claim, or unexpected angle — NOT a generic stat question
- Preview what the reader will learn (without giving everything away)
- End with a smooth transition into the first section
- CRITICAL: Do NOT end the intro with "Let's" followed by any verb (e.g., "Let's start by exploring...", "Let's begin with..."). Use a direct transition instead`,
  landing: `- Lead with the primary value proposition — what transformation does the reader get?
- Identify the reader's core pain point or desire in 1-2 sentences
- Create urgency or curiosity that compels scrolling
- Do NOT include a heading — this is the hero body copy`,
  service: `- Open with the problem this service solves, not what the service is
- Establish credibility in 1-2 sentences (years of experience, clients served, results)
- Preview the key outcomes the reader can expect
- End with a clear transition to the service details`,
  location: `- Open with a local reference (neighborhood, city landmark, or regional context)
- Connect the service/product to the specific community
- Mention the location name naturally within the first 50 words
- Preview what local readers will find in this page`,
  product: `- Lead with the #1 benefit the product delivers (not a feature)
- Address the key buying question or hesitation immediately
- Create desire through specific outcomes or transformations
- End with curiosity about product details below`,
  pillar: `- Establish this as the definitive resource on the topic
- Communicate the breadth of what this guide covers
- Signal authority (original data, expert insights, comprehensive coverage)
- Preview the major subtopics to set expectations`,
  resource: `- State who this resource is for and what they'll be able to do after reading
- Highlight what makes this guide different from others
- Include a "what you'll learn" or "what's inside" preview
- Create urgency around applying the knowledge`,
};

const PAGE_TYPE_SECTION_INSTRUCTIONS: Record<string, string> = {
  blog: `- Use subheadings (### H3) for sections 300+ words
- Mix paragraphs with bullet points and lists for scannability
- Include specific, actionable advice — not generic filler
- Weave in relevant examples, data points, or expert perspectives`,
  landing: `- Keep paragraphs short (2-3 sentences max) for scannability
- Use benefit-driven subheadings if needed
- Include social proof elements (stats, testimonials, trust signals) where relevant
- Every paragraph should support the conversion goal`,
  service: `- Include specific deliverables, processes, or outcomes
- Use "you/your" language to keep focus on the client's benefits
- Add trust signals: expertise markers, process transparency, results
- Break down complex services into digestible steps`,
  location: `- Reference local specifics: neighborhoods, landmarks, regulations, community details
- Include location name naturally (2-3 times per section, not forced)
- Mention service areas, nearby communities, or local partnerships
- Use local social proof when relevant`,
  product: `- Lead each section with a benefit, then support with features
- Use comparison language where appropriate (vs. alternatives)
- Include specific specs, measurements, or performance data
- Address common objections or questions proactively`,
  pillar: `- Cover each subtopic comprehensively but not exhaustively
- Signal where deeper content exists (e.g., "for a deep dive on X, see our guide on...")
- Use tables, frameworks, or structured data where appropriate
- Cross-reference other sections to show topical interconnection`,
  resource: `- Include actionable frameworks, templates, or step-by-step processes
- Use numbered steps, checklists, or decision trees
- Add "pro tips" or "common mistakes" callouts
- Make content reference-worthy — something readers will bookmark`,
};

const PAGE_TYPE_CONCLUSION_INSTRUCTIONS: Record<string, string> = {
  blog: `- Summarize 2-3 key takeaways
- Reinforce the main value proposition
- Include a clear, relevant call-to-action
- End on a forward-looking or action-oriented note`,
  landing: `- Restate the core value proposition in fresh language
- Address the final objection or hesitation
- Include a strong, specific CTA (not "learn more" — be specific)
- Create urgency or scarcity if genuine`,
  service: `- Summarize the key outcomes and differentiators
- Restate expertise and trust signals
- Include a clear next-step CTA (consultation, quote, call)
- Make the CTA feel low-risk and high-reward`,
  location: `- Reinforce commitment to the local community
- Include location name one final time naturally
- CTA should reference local action (visit, call, schedule at location)
- Mention local contact information or next steps`,
  product: `- Summarize the top 3 benefits (not features)
- Address the "should I buy?" question directly
- Include purchase CTA with any relevant offer
- Add a reassurance (guarantee, support, returns)`,
  pillar: `- Summarize the topic landscape covered
- Reinforce this page's authority on the subject
- Link to key cluster content for next steps
- Invite bookmarking or sharing this resource`,
  resource: `- Recap what the reader learned and can now do
- Include a "quick-start" or "next steps" action list
- CTA for downloading, saving, or applying the resource
- Invite feedback or questions to build engagement`,
};

// --- Shared anti-cliché and writing quality rules (injected into every prompt) ---

const WRITING_QUALITY_RULES = `
WRITING QUALITY RULES (apply to ALL content — violations will be rejected):

FORBIDDEN PHRASES — never use these AI clichés:
- Opening clichés: "Did you know...", "In today's [digital/fast-paced/competitive] world...", "Have you ever wondered...", "When it comes to...", "Picture this..."
- "If you're like most" pattern: NEVER start any sentence with "If you're like most" followed by ANY word. This includes "If you're like most people", "If you're like most Texans", "If you're like most business owners", "If you're like most homeowners", etc. Rewrite as a direct statement instead (e.g., "Most Texans have dental insurance but aren't sure how it works" instead of "If you're like most Texans, you have dental insurance but aren't sure how it works")
- Filler transitions: "Let's dive in", "Let's dive into", "Without further ado", "Let's explore", "Let's take a closer look", "Now let's talk about...", "With that said...", "That being said...", "Moving on...", "Let's get started", "Let's start with...". NEVER use "Let's" followed by a verb anywhere in the content.
- "Ready to" rhetorical questions: NEVER write "Ready to [verb]...?" or "Ready for [noun]?" anywhere in the content. Examples of BANNED phrases: "Ready to build...", "Ready to move beyond...", "Ready for the full toolkit?", "Ready to get started?", "Ready to take your...". Use direct statements instead (e.g., "Download the guide" not "Ready to download the guide?").
- Hollow intensifiers: "incredibly", "absolutely", "truly", "extremely", "revolutionize", "game-changing", "cutting-edge", "world-class", "best-in-class", "next-level", "top-notch"
- Corporate buzzwords: "leverage", "utilize", "optimize", "streamline", "empower", "harness", "navigate the landscape", "unlock the power of", "take your X to the next level", "in the realm of"
- Emotional hedging: "It's important to note that...", "It's worth mentioning that...", "It goes without saying...", "Needless to say...", "At the end of the day...", "The reality is that...", "X is key to Y", "The key is...", "X is crucial for Y", "X is essential for Y", "X is the foundation for Y"
- Vague attribution: "Studies show...", "Research suggests...", "Experts agree...", "According to industry data...", "Many businesses have found..." — if you cite something, name the specific source or don't cite at all
- Conclusion starters: "In conclusion...", "To sum up...", "In summary...", "All in all...", "At the end of the day..."
- Metaphor clichés: "growth engine", "game changer", "secret sauce", "silver bullet", "deep dive", "move the needle", "from X to Y" (e.g., "from brochure to growth engine"), "powerful [noun]", "trusted [noun] hub", "one-stop shop"

STRUCTURAL ANTI-PATTERNS — avoid these:
- Do NOT end every section with a one-sentence summary of what the section just said
- Do NOT start every bullet point with the same verb form (e.g., "Improve X", "Improve Y", "Improve Z")
- Do NOT use exactly 3 or 5 items in every list — vary list lengths naturally (2, 4, 6, 7 are all fine)
- Do NOT repeat the same point from the intro in the conclusion using synonyms — add NEW value in the conclusion
- Do NOT use "Conclusion" as the final heading — use a specific, action-oriented heading instead
- Do NOT give every section the same structure (intro paragraph → bullet list → summary). Vary it: some sections should be all prose, some should lead with a list, some should use a numbered process, some should use a comparison or example-first approach
- Do NOT reference the same case study, example, or data point more than twice in the entire article. Spread different examples across sections. If you only have one example, use it once or twice max and fill other sections with actionable advice instead
- Do NOT use examples from the same industry in every section. If a dental case study is mentioned in section 2, use a different industry (tech, finance, retail, etc.) for examples in sections 3, 4, and 5 — even if the knowledge base only has one case study. Invent plausible hypothetical examples from other industries rather than repeating the same one
- Do NOT repeat any phrase, metaphor, or sentence structure across sections. If you used "transforms your X into a Y" in one section, never use that pattern again
- Do NOT mention the business/brand name in every section — limit to 2-3 mentions in the entire article (intro and conclusion). The middle sections should focus on teaching, not selling
- Do NOT put the brand name in the first paragraph of the introduction. The intro should hook the reader with their problem/opportunity, not lead with "At [Brand], we..."
- CONCLUSION/CLOSING SECTION: Include at most ONE linked call-to-action (<a> tag) in the closing section. Do not stack 3-4 links in the final paragraph — pick the single most important action for the reader. Other internal links belong in body sections, not the conclusion
- Do NOT repeat the same specific statistic, dollar amount, or data point more than twice in the entire article. If you've already mentioned "$1,000-$2,000 annual maximum" twice, reference it indirectly ("your annual cap", "this yearly limit") in subsequent mentions
- BRAND MENTIONS IN CONCLUSION: The closing section should lead with editorial value (takeaways, fresh insight, forward-looking perspective) BEFORE any brand mention or CTA. The brand mention should appear only in the final 1-2 sentences, not throughout the conclusion

FABRICATION RULES:
- NEVER invent statistics, case study results, percentages, or data points. Only reference specific numbers if they were provided in the brief context or knowledge base
- NEVER fabricate quotes, client testimonials, or attributed statements
- If no specific data is available, give actionable advice instead of making up numbers
- It's better to say "this approach typically improves conversion rates" than to invent "this approach improved conversion rates by 47%"
- CASE STUDIES: When writing case study sections, describe directional outcomes ("saw a notable increase in organic traffic") unless specific numbers were provided in the knowledge base. NEVER invent percentages like "65% increase" or "30% rise" — these sound authoritative but are fabricated and damage credibility

WHAT TO DO INSTEAD:
- Use concrete specifics: real numbers (only if provided), named tools, actual processes, specific examples
- Vary sentence length: mix short punchy sentences with longer explanatory ones
- Use active voice and direct language: "do X" not "it is recommended that one should consider doing X"
- Let evidence speak: instead of "incredibly effective", reference specific outcomes from the brief's knowledge base
- Write like a knowledgeable colleague explaining over coffee, not a brochure or a textbook
- Vary paragraph structure: some short (1-2 sentences), some medium (3-4), occasional longer ones for complex points
- Go deeper than surface-level advice. Instead of "optimize your site speed", explain HOW: specific tools, settings, thresholds, and tradeoffs. The reader should learn something they didn't know before
- Each section should teach ONE thing well rather than listing 5 things superficially
- DEPTH OVER BREADTH: Even in short sections (150-250 words), go deep on ONE specific example rather than listing generic tips. Include a concrete scenario with dollar amounts, timelines, or step-by-step actions. The reader should learn something they couldn't get from a Google snippet
- If a section is titled "FAQ" or "Frequently Asked Questions", format it as individual Q&A pairs: each question as an <h3> followed by a short answer paragraph. NEVER combine multiple questions into a single paragraph
- Vary examples across industries. If the knowledge base only has one case study, reference it once (max twice), then use hypothetical examples from other industries for remaining sections
- ANCHOR TEXT ACCURACY: When linking to internal pages, the anchor text must accurately describe the linked page. Do NOT use an external brand name (e.g., "Webflow University", "Google") as anchor text for an internal link. If linking to /services/strategy, use text like "our strategy services" or "brand and web strategy" — not an unrelated third-party name

AEO (ANSWER ENGINE OPTIMIZATION) — CITATION-WORTHY WRITING:
- Write content that AI systems want to cite: encyclopedic, neutral, precise, defensible
- CLAIM DISCIPLINE: Replace superlatives with evidence. "This is the safest option" → "Safety depends on factors X, Y, and Z; evidence from [source] suggests…". Replace "We're the best" → "Common factors to evaluate include…"
- EVIDENCE FRAMING: Use "According to [specific source]…", "In general…", "Common factors include…", "Limitations include…". Ground claims in evidence, not marketing assertions
- For medical/health content: adopt an encyclopedic neutral tone. Write like a medical reference, not a brochure. Every factual medical claim should cite or reference a specific source (journal, professional association, .gov)
- DEFINITION BLOCKS: When introducing a technical term, use the pattern: define it in 1-2 sentences → note common misconceptions → list related terms. These blocks are disproportionately cited by LLMs
- COMPARISON CONTENT: When comparing options, use measurable fields (costs, percentages, timeframes) with stated units. Include "Data as of [date]" notes. Tables with vague adjectives ("good", "excellent") are not citeable — use numbers
`;

/** Build a rich context block from all available brief fields */
function buildBriefContextBlock(brief: ContentBrief, siteDomain?: string): string {
  const parts: string[] = [];

  if (brief.executiveSummary) {
    parts.push(`CONTENT STRATEGY CONTEXT: ${brief.executiveSummary}`);
  }

  if (brief.peopleAlsoAsk?.length) {
    parts.push(`QUESTIONS TO ANSWER (from "People Also Ask" — weave answers naturally into the content):\n${brief.peopleAlsoAsk.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  }

  if (brief.topicalEntities?.length) {
    parts.push(`TOPICAL ENTITIES TO MENTION (for topical authority — mention naturally, not forced):\n${brief.topicalEntities.join(', ')}`);
  }

  if (brief.serpAnalysis) {
    const sa = brief.serpAnalysis;
    let serpStr = `SERP COMPETITIVE LANDSCAPE:\n- Dominant content type: ${sa.contentType}\n- Average competing word count: ${sa.avgWordCount}`;
    if (sa.commonElements.length) serpStr += `\n- Common elements: ${sa.commonElements.join(', ')}`;
    if (sa.gaps.length) serpStr += `\n- GAPS TO EXPLOIT (topics competitors miss — cover these for advantage):\n${sa.gaps.map(g => `  → ${g}`).join('\n')}`;
    parts.push(serpStr);
  }

  if (brief.competitorInsights) {
    parts.push(`COMPETITOR INSIGHTS: ${brief.competitorInsights}`);
  }

  if (brief.internalLinkSuggestions?.length) {
    const domain = siteDomain ? `https://${siteDomain}` : '';
    const linkLines = brief.internalLinkSuggestions.map(l => {
      const slug = l.startsWith('/') ? l : `/${l}`;
      return domain ? `- ${domain}${slug}` : `- ${slug}`;
    }).join('\n');
    parts.push(`INTERNAL LINKS TO INCLUDE (link to these pages naturally where relevant — use the EXACT URLs below):\n${linkLines}${domain ? `\n\nIMPORTANT: All internal links MUST use the domain ${domain}. Do NOT link to any other domain. Use <a href="${domain}/slug"> format.` : ''}`);
  }

  if (brief.eeatGuidance) {
    const e = brief.eeatGuidance;
    let eeatStr = 'E-E-A-T SIGNALS TO WEAVE IN:';
    if (e.experience) eeatStr += `\n- Experience: ${e.experience}`;
    if (e.expertise) eeatStr += `\n- Expertise: ${e.expertise}`;
    if (e.authority) eeatStr += `\n- Authority: ${e.authority}`;
    if (e.trust) eeatStr += `\n- Trust: ${e.trust}`;
    parts.push(eeatStr);
  }

  return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
}

/** Generate introduction / opening section */
async function generateIntroduction(
  brief: ContentBrief,
  voiceCtx: string,
  workspaceId: string,
  siteDomain?: string,
): Promise<string> {
  const totalBudget = brief.wordCountTarget || 1800;
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;
  const typeInstructions = PAGE_TYPE_INTRO_INSTRUCTIONS[pageType] || PAGE_TYPE_INTRO_INSTRUCTIONS.blog;
  const pageLabel = pageType === 'blog' ? 'blog post' : pageType === 'landing' ? 'landing page' : pageType === 'pillar' ? 'pillar page' : `${pageType} page`;
  const briefContext = buildBriefContextBlock(brief, siteDomain);

  const prompt = `${role}

Write a compelling opening (150-200 words) for a ${pageLabel}.

TOTAL ARTICLE WORD BUDGET: ${totalBudget} words. Your intro is a small portion — be concise and impactful.

TITLE: ${brief.suggestedTitle}
TARGET KEYWORD: "${brief.targetKeyword}"
SECONDARY KEYWORDS: ${brief.secondaryKeywords.join(', ')}
AUDIENCE: ${brief.audience}
INTENT: ${brief.intent}
${brief.contentFormat ? `FORMAT: ${brief.contentFormat}` : ''}
${brief.toneAndStyle ? `TONE & STYLE: ${brief.toneAndStyle}` : ''}
${voiceCtx}
${briefContext}

CONTENT OUTLINE (sections that follow):
${brief.outline.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

PAGE-TYPE-SPECIFIC REQUIREMENTS:
${typeInstructions}

UNIVERSAL REQUIREMENTS:
- Naturally include the target keyword within the first 100 words
- Match the specified tone and brand voice exactly
- Output clean HTML: use <p> for paragraphs, <strong> for emphasis, <a href="..."> for links
- Do NOT include the title or any heading — just the opening paragraph(s)
- Do NOT use markdown syntax (no ##, no **, no - lists). Output HTML tags only.
- Write for humans first, search engines second
- Stay within 150-200 words — do not exceed 250 under any circumstances

${WRITING_QUALITY_RULES}

Return ONLY the opening HTML. No headings, no labels, no meta-commentary, no markdown.`;

  // Split role (system) from the writing instructions (user)
  const systemPrompt = role;
  return callCreativeAI({
    systemPrompt,
    userPrompt: prompt.replace(role + '\n\n', ''),
    maxTokens: 600,
    feature: 'content-post-intro',
    workspaceId,
  });
}

/** Generate a single body section */
async function generateSection(
  brief: ContentBrief,
  section: ContentBrief['outline'][0],
  sectionIndex: number,
  previousSections: string[],
  voiceCtx: string,
  workspaceId: string,
  siteDomain?: string,
): Promise<string> {
  const sectionTarget = section.wordCount || 300;
  const totalBudget = brief.wordCountTarget || 1800;
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;
  const typeInstructions = PAGE_TYPE_SECTION_INSTRUCTIONS[pageType] || PAGE_TYPE_SECTION_INSTRUCTIONS.blog;
  const pageLabel = pageType === 'blog' ? 'blog post' : pageType === 'landing' ? 'landing page' : pageType === 'pillar' ? 'pillar page' : `${pageType} page`;
  const briefContext = buildBriefContextBlock(brief, siteDomain);

  const prevContext = previousSections.length > 0
    ? `\n\nPREVIOUS SECTIONS WRITTEN (for continuity — do NOT repeat these points, examples, case studies, or phrases):\n${previousSections.map((s, i) => `--- Section ${i + 1} ---\n${s.slice(0, 800)}`).join('\n')}\n\nCRITICAL: Do NOT re-use any example, case study, statistic, or metaphor that already appeared above. Use a DIFFERENT example or angle. If you have no new example, teach with actionable specifics instead.`
    : '';

  // Determine which PAA questions are most relevant to this section
  const relevantPAA = brief.peopleAlsoAsk?.filter(q => {
    const qLower = q.toLowerCase();
    const headingLower = section.heading.toLowerCase();
    const notesLower = (section.notes || '').toLowerCase();
    return headingLower.split(' ').some(w => w.length > 3 && qLower.includes(w)) ||
           notesLower.split(' ').some(w => w.length > 3 && qLower.includes(w));
  }) || [];

  const prompt = `${role}

Write section ${sectionIndex + 1} of a ${pageLabel}.

TOTAL ARTICLE WORD BUDGET: ${totalBudget} words. This section's allocation is ${sectionTarget} words. Stay within ±10% of your allocation.

ARTICLE TITLE: ${brief.suggestedTitle}
TARGET KEYWORD: "${brief.targetKeyword}"
SECONDARY KEYWORDS: ${brief.secondaryKeywords.join(', ')}
AUDIENCE: ${brief.audience}
${brief.toneAndStyle ? `TONE & STYLE: ${brief.toneAndStyle}` : ''}
${voiceCtx}
${briefContext}

THIS SECTION:
- Heading: ${section.heading}
${section.subheadings?.length ? `- Suggested H3 subheadings: ${section.subheadings.join(', ')}` : '- Create 2-3 H3 subheadings to break this section into scannable subtopics'}
- Guidance: ${section.notes}
- STRICT target word count: ${sectionTarget} words (do NOT exceed ${Math.round(sectionTarget * 1.1)} words)
- Keywords to include naturally: ${section.keywords?.join(', ') || brief.secondaryKeywords.slice(0, 3).join(', ')}
${relevantPAA.length > 0 ? `- Questions to answer in this section:\n${relevantPAA.map(q => `  • ${q}`).join('\n')}` : ''}
${prevContext}

PAGE-TYPE-SPECIFIC REQUIREMENTS:
${typeInstructions}

UNIVERSAL REQUIREMENTS:
- Start with the section heading as an <h2> tag
- Write approximately ${sectionTarget} words of content under the heading — this is a STRICT budget, not a minimum
- Follow the section guidance closely — cover every point mentioned
- Weave in keywords naturally — never force or stuff them
- ALWAYS use <h3> subheadings to break sections into scannable subtopics. For sections 200+ words, include at least 2 <h3> subheadings. Use the suggested subheadings from the brief if provided, or create logical ones
- Use <ul>/<li> for bullet lists, <ol>/<li> for numbered lists, <strong> for bold emphasis
- Use <p> tags for paragraphs — do NOT use markdown syntax (no ##, no **, no - lists)
- Maintain continuity with previous sections (don't repeat points already covered)
- Match the specified tone and brand voice exactly
- Include specific, actionable, expert-level advice — never generic filler
- Write for humans first, search engines second
- BRAND MENTIONS: Do NOT mention the business/brand by name in this section unless the section heading specifically references the business (e.g., "How [Brand] Helps..."). Body sections should teach — use "your dentist", "your provider", "your agency" instead of the brand name. For FAQ sections, answers should feel like neutral expert advice, not sales copy — use "your dental office" or "your provider" instead of the brand name
- IMPORTANT: Competitor word counts in the SERP data are for reference only — YOUR word count target is ${sectionTarget} words for this section. Do not write more because competitors wrote more.

${WRITING_QUALITY_RULES}

Return ONLY the section content in clean HTML (starting with <h2>). No labels, no meta-commentary, no markdown.`;

  // Split role (system) from the writing instructions (user)
  const systemPrompt = role;
  return callCreativeAI({
    systemPrompt,
    userPrompt: prompt.replace(role + '\n\n', ''),
    maxTokens: Math.max(800, sectionTarget * 2),
    feature: 'content-post-section',
    workspaceId,
  });
}

/** Generate conclusion / closing section */
async function generateConclusion(
  brief: ContentBrief,
  voiceCtx: string,
  workspaceId: string,
  siteDomain?: string,
): Promise<string> {
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;
  const typeInstructions = PAGE_TYPE_CONCLUSION_INSTRUCTIONS[pageType] || PAGE_TYPE_CONCLUSION_INSTRUCTIONS.blog;
  const pageLabel = pageType === 'blog' ? 'blog post' : pageType === 'landing' ? 'landing page' : pageType === 'pillar' ? 'pillar page' : `${pageType} page`;
  const briefContext = buildBriefContextBlock(brief, siteDomain);

  const prompt = `${role}

Write a strong closing section (100-200 words) for a ${pageLabel}.

TITLE: ${brief.suggestedTitle}
TARGET KEYWORD: "${brief.targetKeyword}"
AUDIENCE: ${brief.audience}
${brief.toneAndStyle ? `TONE & STYLE: ${brief.toneAndStyle}` : ''}
${brief.ctaRecommendations?.length ? `CTA RECOMMENDATIONS:\n${brief.ctaRecommendations.map((c, i) => `${i === 0 ? '- PRIMARY' : '- Secondary'}: ${c}`).join('\n')}` : ''}
${voiceCtx}
${briefContext}

SECTIONS COVERED:
${brief.outline.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

PAGE-TYPE-SPECIFIC REQUIREMENTS:
${typeInstructions}

UNIVERSAL REQUIREMENTS:
- Start with an appropriate <h2> heading (e.g., "Next Steps", "Take Control of Your [Topic]", "Key Takeaways", "Your Action Plan") — do NOT use "Conclusion" as the heading. Do NOT use "Ready to..." as the heading
- Use <p> for paragraphs, <strong> for emphasis, <ul>/<li> or <ol>/<li> for lists
- Do NOT use markdown syntax (no ##, no **, no - lists). Output HTML tags only.
- Naturally include the target keyword one final time
- Match the specified tone and brand voice exactly
- Write for humans first, search engines second
- Do NOT simply restate the introduction in different words — add NEW value: a fresh insight, a specific next step, or a forward-looking perspective

${WRITING_QUALITY_RULES}

Return ONLY the closing section in clean HTML (starting with <h2>). No labels, no meta-commentary, no markdown.`;

  // Split role (system) from the writing instructions (user)
  const systemPrompt = role;
  return callCreativeAI({
    systemPrompt,
    userPrompt: prompt.replace(role + '\n\n', ''),
    maxTokens: 800,
    feature: 'content-post-conclusion',
    workspaceId,
  });
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/** Strip HTML tags for plain-text extraction */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Generate SEO-optimized title tag and meta description based on the final post content.
 * Runs after unification so it can reference the actual written content.
 */
async function generateSeoMeta(
  post: GeneratedPost,
  brief: ContentBrief,
  workspaceId: string,
): Promise<{ seoTitle: string; seoMetaDescription: string } | null> {
  const introPlain = stripHtml(post.introduction).slice(0, 500);
  const sectionHeadings = post.sections.map(s => s.heading).join(', ');

  const prompt = `You are an expert SEO copywriter. Generate an optimized title tag and meta description for a blog post.

BLOG POST TITLE: ${post.title}
TARGET KEYWORD: "${brief.targetKeyword}"
SECONDARY KEYWORDS: ${brief.secondaryKeywords.slice(0, 4).join(', ')}
AUDIENCE: ${brief.audience}
INTENT: ${brief.intent}
SECTIONS COVERED: ${sectionHeadings}
OPENING: ${introPlain}

REQUIREMENTS:
1. SEO Title (title tag):
   - 50-60 characters (STRICT — Google truncates at ~60)
   - Include the target keyword naturally, ideally near the front
   - Compelling and click-worthy — not just keyword-stuffed
   - Different from the blog H1 title if it improves CTR
   - Do NOT use pipes (|) or site name suffixes

2. Meta Description:
   - 150-160 characters (STRICT — Google truncates at ~160)
   - Include the target keyword naturally within the first 120 characters
   - Summarize the post's unique value proposition
   - Include a subtle call-to-action or benefit statement
   - Written as a complete, compelling sentence

Return valid JSON only:
{
  "seoTitle": "Your SEO title tag here",
  "seoMetaDescription": "Your meta description here"
}`;

  try {
    const result = await callOpenAI({
      model: CONTENT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      temperature: 0.5,
      feature: 'content-post-seo-meta',
      workspaceId,
    });
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { seoTitle: string; seoMetaDescription: string };
    if (parsed.seoTitle && parsed.seoMetaDescription) return parsed;
    return null;
  } catch (err) {
    log.warn({ err: err }, 'SEO meta generation failed');
    return null;
  }
}

/**
 * Unification pass — reviews the fully assembled post and returns
 * refined versions of each part with smoother transitions, consistent
 * voice, no subtle repetition, and word counts trimmed to match the brief's target.
 */
async function unifyPost(
  post: GeneratedPost,
  brief: ContentBrief,
  voiceCtx: string,
  workspaceId: string,
): Promise<{ introduction?: string; sections?: string[]; conclusion?: string } | null> {
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;
  const targetTotal = brief.wordCountTarget || 1800;

  // Assemble the full draft for review
  const fullDraft = [
    `[INTRODUCTION]\n${post.introduction}`,
    ...post.sections.map((s, i) => `[SECTION ${i + 1}: ${s.heading}]\n${s.content}`),
    `[CONCLUSION]\n${post.conclusion}`,
  ].join('\n\n---\n\n');

  // If the post is very short, skip unification (not worth the cost)
  const currentWords = countWords(post.introduction) + post.sections.reduce((sum, s) => sum + s.wordCount, 0) + countWords(post.conclusion);
  if (currentWords < 400) return null;

  const overBudget = currentWords > targetTotal * 1.1;
  const wordBudgetInstruction = overBudget
    ? `\n\nWORD COUNT CORRECTION REQUIRED:\n- Current total: ~${currentWords} words\n- Target total: ${targetTotal} words (from the content brief)\n- You MUST trim each section proportionally to bring the total within ±5% of ${targetTotal} words.\n- Cut filler, redundant examples, verbose phrasing, and tangential points. Preserve core arguments and actionable advice.\n- Section word budget targets:\n  - Introduction: ~${Math.round(targetTotal * 0.08)} words\n${post.sections.map((s, i) => `  - Section ${i + 1} (${s.heading}): ~${s.targetWordCount} words`).join('\n')}\n  - Conclusion: ~${Math.round(targetTotal * 0.07)} words`
    : `\n\nWORD COUNT: Current total (~${currentWords} words) is within the ${targetTotal}-word target. Preserve depth — do not inflate or significantly reduce.`;

  const prompt = `${role}

You are performing a UNIFICATION PASS on a fully written piece of content. Each section was generated independently and may have:
- Awkward or missing transitions between sections
- Subtle repetition of the same points, phrases, or examples across sections
- Inconsistent tone or voice shifts between sections
- Disconnected narrative — the intro promises one thing but sections deliver another
${overBudget ? '- WORD COUNT BLOAT — the article significantly exceeds its target word count' : ''}

YOUR TASK: Refine each section to create a cohesive, unified piece that reads as if written in a single sitting by one expert author.${overBudget ? ' You must also trim to the target word count.' : ''}

TITLE: ${post.title}
TARGET KEYWORD: "${brief.targetKeyword}"
AUDIENCE: ${brief.audience}
${brief.toneAndStyle ? `TONE & STYLE: ${brief.toneAndStyle}` : ''}
${voiceCtx}
${wordBudgetInstruction}

FULL DRAFT:
${fullDraft}

RULES:
- Smooth transitions: each section should flow naturally from the previous one
- Remove repeated phrases, examples, or talking points that appear in multiple sections
- Ensure the introduction's promises are fulfilled by the body sections
- Ensure the conclusion ties back to the introduction's hook
- Keep all HTML formatting (<h2>, <h3>, <p>, <strong>, <ul>/<li>, <ol>/<li>, <a>)
- Do NOT use markdown syntax (no ##, no **, no - lists) — output clean HTML only
- Do NOT include section labels or the title heading — return clean HTML for each part
- Sections array: return the FULL section HTML including its <h2> heading
- Introduction: return HTML paragraphs only (no heading)
- Conclusion: return full HTML including its <h2> heading
- KEYWORD COVERAGE CHECK: The following keywords from the brief MUST each appear at least once in the final article. If any are missing, weave them into the most relevant section naturally (do not force or stuff): ${[brief.targetKeyword, ...brief.secondaryKeywords].map(k => `"${k}"`).join(', ')}

Return valid JSON with this exact structure (${post.sections.length} items in the sections array):
{
  "introduction": "refined intro HTML (<p> tags, no heading)",
  "sections": ["full section 1 HTML with <h2>", "full section 2 HTML with <h2>", ...],
  "conclusion": "refined conclusion HTML (with <h2> heading)"
}

Return ONLY valid JSON, no markdown fences, no comments.`;

  // Scale maxTokens based on post length — need enough room for the full refined output
  const estimatedOutputTokens = Math.ceil(targetTotal * 1.5);
  const maxTokens = Math.max(8000, Math.min(estimatedOutputTokens, 16000));

  log.info(`Unification pass: ${currentWords} words → target ${targetTotal}, overBudget=${overBudget}, maxTokens=${maxTokens}`);

  const result = await callOpenAI({
    model: CONTENT_MODEL,
    messages: [
      { role: 'system', content: 'You are a senior editor performing a cohesion and word-count review. Return valid JSON only.' },
      { role: 'user', content: prompt },
    ],
    maxTokens,
    temperature: 0.4,
    feature: 'content-post-unify',
    workspaceId,
  });

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('Unification: no JSON object found in response');
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]) as { introduction?: string; sections?: string[]; conclusion?: string };
    // Validate sections count matches
    if (parsed.sections && parsed.sections.length !== post.sections.length) {
      log.warn(`Unification returned ${parsed.sections.length} sections but expected ${post.sections.length} — skipping section updates`);
      parsed.sections = undefined;
    }
    return parsed;
  } catch (err) {
    log.warn({ err: err }, 'Failed to parse unification JSON');
    return null;
  }
}

/**
 * Generate a full blog post from a content brief.
 * Generates intro, each section, and conclusion sequentially.
 * Saves progress after each section so partial results are available.
 */
export async function generatePost(
  workspaceId: string,
  brief: ContentBrief,
  existingPostId?: string,
): Promise<GeneratedPost> {
  const postId = existingPostId || `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const voiceCtx = buildVoiceContext(workspaceId);

  // Resolve the site's live domain for internal link URLs
  const ws = getWorkspace(workspaceId);
  const siteDomain = ws?.liveDomain || undefined;

  // Initialize post with pending sections
  const post: GeneratedPost = {
    id: postId,
    workspaceId,
    briefId: brief.id,
    targetKeyword: brief.targetKeyword,
    title: brief.suggestedTitle,
    metaDescription: brief.suggestedMetaDesc,
    introduction: '',
    sections: brief.outline.map((s, i) => ({
      index: i,
      heading: s.heading,
      content: '',
      wordCount: 0,
      targetWordCount: s.wordCount || 250,
      keywords: s.keywords || [],
      status: 'pending' as const,
    })),
    conclusion: '',
    totalWordCount: 0,
    targetWordCount: brief.wordCountTarget || 1800,
    status: 'generating',
    unificationStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Save initial skeleton
  savePost(workspaceId, post);

  // 1. Generate introduction
  try {
    post.introduction = await generateIntroduction(brief, voiceCtx, workspaceId, siteDomain);
    post.updatedAt = new Date().toISOString();
    savePost(workspaceId, post);
  } catch (err) {
    post.introduction = `*[Introduction generation failed: ${err instanceof Error ? err.message : 'Unknown error'}]*`;
  }

  // 2. Generate each body section sequentially
  const completedSections: string[] = [];
  for (let i = 0; i < brief.outline.length; i++) {
    post.sections[i].status = 'generating';
    savePost(workspaceId, post);

    // Pace API calls to avoid rate limits (Claude RPM caps)
    if (i > 0) await new Promise(r => setTimeout(r, 2000));

    try {
      const content = await generateSection(
        brief, brief.outline[i], i, completedSections, voiceCtx, workspaceId, siteDomain,
      );
      post.sections[i].content = content;
      post.sections[i].wordCount = countWords(content);
      post.sections[i].status = 'done';
      completedSections.push(content);
    } catch (err) {
      post.sections[i].status = 'error';
      post.sections[i].error = err instanceof Error ? err.message : 'Generation failed';
      post.sections[i].content = `*[Section generation failed: ${post.sections[i].error}]*`;
      completedSections.push('');
    }

    post.updatedAt = new Date().toISOString();
    savePost(workspaceId, post);
  }

  // 3. Generate conclusion
  try {
    post.conclusion = await generateConclusion(brief, voiceCtx, workspaceId, siteDomain);
  } catch (err) {
    post.conclusion = `*[Conclusion generation failed: ${err instanceof Error ? err.message : 'Unknown error'}]*`;
  }

  post.updatedAt = new Date().toISOString();
  savePost(workspaceId, post);

  // 4. Unification pass — review the full post for cohesion, smooth transitions, consistent voice, and word count correction
  post.unificationStatus = 'pending';
  savePost(workspaceId, post);

  try {
    const preUnifyWords = countWords(post.introduction) + post.sections.reduce((s, sec) => s + sec.wordCount, 0) + countWords(post.conclusion);
    const unified = await unifyPost(post, brief, voiceCtx, workspaceId);
    if (unified) {
      if (unified.introduction) post.introduction = unified.introduction;
      for (let i = 0; i < post.sections.length; i++) {
        if (unified.sections?.[i]) {
          post.sections[i].content = unified.sections[i];
          post.sections[i].wordCount = countWords(unified.sections[i]);
        }
      }
      if (unified.conclusion) post.conclusion = unified.conclusion;
      const postUnifyWords = countWords(post.introduction) + post.sections.reduce((s, sec) => s + sec.wordCount, 0) + countWords(post.conclusion);
      post.unificationStatus = 'success';
      post.unificationNote = `Unified: ${preUnifyWords} → ${postUnifyWords} words (target: ${post.targetWordCount})`;
      log.info(`${post.unificationNote}`);
      post.updatedAt = new Date().toISOString();
      savePost(workspaceId, post);
    } else {
      post.unificationStatus = 'skipped';
      post.unificationNote = 'Unification returned null — post too short or JSON parse failed';
      log.warn(`Unification skipped for ${postId}`);
    }
  } catch (err) {
    post.unificationStatus = 'failed';
    post.unificationNote = `Unification error: ${err instanceof Error ? err.message : 'Unknown'}`;
    log.error({ err: err }, `Unification pass failed (non-critical):`);
    // Non-critical — the post is still usable without unification
  }

  // 5. Generate SEO title tag and meta description
  try {
    const seoMeta = await generateSeoMeta(post, brief, workspaceId);
    if (seoMeta) {
      post.seoTitle = seoMeta.seoTitle;
      post.seoMetaDescription = seoMeta.seoMetaDescription;
      log.info(`SEO meta generated: "${seoMeta.seoTitle}" (${seoMeta.seoTitle.length} chars)`);
    }
  } catch (err) {
    log.warn({ err: err }, 'SEO meta generation failed (non-critical)');
  }

  // Finalize
  post.totalWordCount = countWords(stripHtml(post.introduction))
    + post.sections.reduce((s, sec) => s + countWords(stripHtml(sec.content)), 0)
    + countWords(stripHtml(post.conclusion));
  // Update per-section word counts to use stripped HTML
  for (const sec of post.sections) {
    sec.wordCount = countWords(stripHtml(sec.content));
  }
  post.status = 'draft';
  post.updatedAt = new Date().toISOString();
  savePost(workspaceId, post);

  return post;
}

/**
 * Regenerate a single section of an existing post.
 */
export async function regenerateSection(
  workspaceId: string,
  postId: string,
  sectionIndex: number,
  brief: ContentBrief,
): Promise<GeneratedPost | null> {
  const post = getPost(workspaceId, postId);
  if (!post || sectionIndex < 0 || sectionIndex >= post.sections.length) return null;

  const voiceCtx = buildVoiceContext(workspaceId);
  const previousSections = post.sections
    .filter((s, i) => i < sectionIndex && s.status === 'done')
    .map(s => s.content);

  // Snapshot current state before regenerating
  snapshotPostVersion(post, 'regenerate_section', `section:${sectionIndex}`);

  post.sections[sectionIndex].status = 'generating';
  savePost(workspaceId, post);

  try {
    const content = await generateSection(
      brief, brief.outline[sectionIndex], sectionIndex, previousSections, voiceCtx, workspaceId,
    );
    post.sections[sectionIndex].content = content;
    post.sections[sectionIndex].wordCount = countWords(content);
    post.sections[sectionIndex].status = 'done';
    post.sections[sectionIndex].error = undefined;
  } catch (err) {
    post.sections[sectionIndex].status = 'error';
    post.sections[sectionIndex].error = err instanceof Error ? err.message : 'Regeneration failed';
  }

  post.totalWordCount = countWords(post.introduction)
    + post.sections.reduce((s, sec) => s + sec.wordCount, 0)
    + countWords(post.conclusion);
  post.updatedAt = new Date().toISOString();
  savePost(workspaceId, post);

  return post;
}

/**
 * Export a post as a single markdown string.
 */
export function exportPostMarkdown(post: GeneratedPost): string {
  const parts: string[] = [];
  parts.push(`# ${post.title}\n`);
  if (post.introduction) parts.push(post.introduction + '\n');
  for (const section of post.sections) {
    if (section.content) parts.push(section.content + '\n');
  }
  if (post.conclusion) parts.push(post.conclusion + '\n');
  return parts.join('\n');
}

/**
 * Export a post as HTML — content is already HTML so no conversion needed.
 */
export function exportPostHTML(post: GeneratedPost): string {
  const metaDesc = post.seoMetaDescription || post.metaDescription;
  const titleTag = post.seoTitle || post.title;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${metaDesc.replace(/"/g, '&quot;')}">
  <title>${titleTag.replace(/</g, '&lt;')}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #1a1a1a; }
    h1 { font-size: 2.2rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; margin-top: 2rem; color: #2d3748; }
    h3 { font-size: 1.2rem; margin-top: 1.5rem; color: #4a5568; }
    p { margin-bottom: 1rem; }
    ul, ol { padding-left: 1.5rem; margin-bottom: 1rem; }
    li { margin-bottom: 0.3rem; }
    strong { color: #1a202c; }
    a { color: #2b6cb0; text-decoration: underline; }
    .meta { color: #718096; font-size: 0.9rem; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>${post.title}</h1>
  <div class="meta">${post.totalWordCount} words · ${post.targetKeyword}</div>
  ${post.introduction}
  ${post.sections.map(s => s.content).join('\n')}
  ${post.conclusion}
</body>
</html>`;
}
