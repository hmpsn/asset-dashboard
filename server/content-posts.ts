/**
 * AI Content Generator — generates full SEO-optimized content from content briefs.
 * Adapts prompts per page type (blog, landing, service, location, product, pillar, resource).
 * Each section is generated independently using the brief's outline as the writing spec.
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';
import { buildSeoContext } from './seo-context.js';
import { callOpenAI } from './openai-helpers.js';
import type { ContentBrief } from './content-brief.js';

const POSTS_DIR = getDataDir('content-posts');
fs.mkdirSync(POSTS_DIR, { recursive: true });

// --- Types ---

export interface PostSection {
  index: number;
  heading: string;
  content: string;         // markdown
  wordCount: number;
  targetWordCount: number;
  keywords: string[];
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

export interface GeneratedPost {
  id: string;
  workspaceId: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  introduction: string;    // markdown
  sections: PostSection[];
  conclusion: string;      // markdown
  totalWordCount: number;
  status: 'generating' | 'draft' | 'review' | 'approved';
  createdAt: string;
  updatedAt: string;
}

// --- Storage ---

function getPostFile(workspaceId: string): string {
  return path.join(POSTS_DIR, `${workspaceId}.json`);
}

function readPosts(workspaceId: string): GeneratedPost[] {
  try {
    const f = getPostFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
  return [];
}

function writePosts(workspaceId: string, posts: GeneratedPost[]) {
  fs.writeFileSync(getPostFile(workspaceId), JSON.stringify(posts, null, 2));
}

export function listPosts(workspaceId: string): GeneratedPost[] {
  return readPosts(workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getPost(workspaceId: string, postId: string): GeneratedPost | undefined {
  return readPosts(workspaceId).find(p => p.id === postId);
}

export function savePost(workspaceId: string, post: GeneratedPost): void {
  const posts = readPosts(workspaceId);
  const idx = posts.findIndex(p => p.id === post.id);
  if (idx >= 0) posts[idx] = post;
  else posts.push(post);
  writePosts(workspaceId, posts);
}

export function updatePostField(workspaceId: string, postId: string, updates: Partial<Omit<GeneratedPost, 'id' | 'workspaceId' | 'createdAt'>>): GeneratedPost | null {
  const posts = readPosts(workspaceId);
  const idx = posts.findIndex(p => p.id === postId);
  if (idx === -1) return null;
  Object.assign(posts[idx], updates, { updatedAt: new Date().toISOString() });
  writePosts(workspaceId, posts);
  return posts[idx];
}

export function deletePost(workspaceId: string, postId: string): boolean {
  const posts = readPosts(workspaceId);
  const idx = posts.findIndex(p => p.id === postId);
  if (idx === -1) return false;
  posts.splice(idx, 1);
  writePosts(workspaceId, posts);
  return true;
}

// --- Generation ---

// AI model for content writing — gpt-4.1 is the best balance of quality, speed, and cost
// for paid content ($250-2,500 products). Temperature 0.7 produces more engaging prose
// while maintaining coherence and factual accuracy.
const CONTENT_MODEL = 'gpt-4.1';
const CONTENT_TEMP = 0.7;

function buildVoiceContext(workspaceId: string): string {
  const { brandVoiceBlock, keywordBlock } = buildSeoContext(workspaceId);
  return `${brandVoiceBlock}${keywordBlock}`;
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
  blog: `- Hook the reader in the first sentence with a compelling stat, question, or pain point
- Preview what the reader will learn (without giving everything away)
- End with a smooth transition into the first section`,
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

/** Build a rich context block from all available brief fields */
function buildBriefContextBlock(brief: ContentBrief): string {
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
    parts.push(`INTERNAL LINKS TO INCLUDE (reference these pages naturally where relevant):\n${brief.internalLinkSuggestions.map(l => `- /${l}`).join('\n')}`);
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
): Promise<string> {
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;
  const typeInstructions = PAGE_TYPE_INTRO_INSTRUCTIONS[pageType] || PAGE_TYPE_INTRO_INSTRUCTIONS.blog;
  const pageLabel = pageType === 'blog' ? 'blog post' : pageType === 'landing' ? 'landing page' : pageType === 'pillar' ? 'pillar page' : `${pageType} page`;
  const briefContext = buildBriefContextBlock(brief);

  const prompt = `${role}

Write a compelling opening (150-250 words) for a ${pageLabel}.

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
- Use markdown formatting (bold for emphasis where appropriate)
- Do NOT include the title or any heading — just the opening paragraph(s)
- Write for humans first, search engines second

Return ONLY the opening text in markdown. No headings, no labels, no meta-commentary.`;

  const result = await callOpenAI({
    model: CONTENT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
    temperature: CONTENT_TEMP,
    feature: 'content-post-intro',
    workspaceId,
  });
  return result.text.trim();
}

/** Generate a single body section */
async function generateSection(
  brief: ContentBrief,
  section: ContentBrief['outline'][0],
  sectionIndex: number,
  previousSections: string[],
  voiceCtx: string,
  workspaceId: string,
): Promise<string> {
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;
  const typeInstructions = PAGE_TYPE_SECTION_INSTRUCTIONS[pageType] || PAGE_TYPE_SECTION_INSTRUCTIONS.blog;
  const pageLabel = pageType === 'blog' ? 'blog post' : pageType === 'landing' ? 'landing page' : pageType === 'pillar' ? 'pillar page' : `${pageType} page`;
  const briefContext = buildBriefContextBlock(brief);

  const prevContext = previousSections.length > 0
    ? `\n\nPREVIOUS SECTIONS WRITTEN (for continuity — do NOT repeat these points):\n${previousSections.map((s, i) => `--- Section ${i + 1} ---\n${s.slice(0, 600)}...`).join('\n')}`
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

ARTICLE TITLE: ${brief.suggestedTitle}
TARGET KEYWORD: "${brief.targetKeyword}"
SECONDARY KEYWORDS: ${brief.secondaryKeywords.join(', ')}
AUDIENCE: ${brief.audience}
${brief.toneAndStyle ? `TONE & STYLE: ${brief.toneAndStyle}` : ''}
${voiceCtx}
${briefContext}

THIS SECTION:
- Heading: ${section.heading}
- Guidance: ${section.notes}
- Target word count: ${section.wordCount || 300} words
- Keywords to include naturally: ${section.keywords?.join(', ') || brief.secondaryKeywords.slice(0, 3).join(', ')}
${relevantPAA.length > 0 ? `- Questions to answer in this section:\n${relevantPAA.map(q => `  • ${q}`).join('\n')}` : ''}
${prevContext}

PAGE-TYPE-SPECIFIC REQUIREMENTS:
${typeInstructions}

UNIVERSAL REQUIREMENTS:
- Start with the H2 heading as a markdown ## heading
- Write approximately ${section.wordCount || 300} words of content under the heading
- Follow the section guidance closely — cover every point mentioned
- Weave in keywords naturally — never force or stuff them
- Use subheadings (### H3) if the section is 300+ words
- Use bullet points, numbered lists, or bold text where it aids readability
- Maintain continuity with previous sections (don't repeat points already covered)
- Match the specified tone and brand voice exactly
- Include specific, actionable, expert-level advice — never generic filler
- Write for humans first, search engines second

Return ONLY the section content in markdown (starting with ## heading). No labels, no meta-commentary.`;

  const result = await callOpenAI({
    model: CONTENT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: Math.max(1800, (section.wordCount || 300) * 3),
    temperature: CONTENT_TEMP,
    feature: 'content-post-section',
    workspaceId,
  });
  return result.text.trim();
}

/** Generate conclusion / closing section */
async function generateConclusion(
  brief: ContentBrief,
  voiceCtx: string,
  workspaceId: string,
): Promise<string> {
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;
  const typeInstructions = PAGE_TYPE_CONCLUSION_INSTRUCTIONS[pageType] || PAGE_TYPE_CONCLUSION_INSTRUCTIONS.blog;
  const pageLabel = pageType === 'blog' ? 'blog post' : pageType === 'landing' ? 'landing page' : pageType === 'pillar' ? 'pillar page' : `${pageType} page`;

  const prompt = `${role}

Write a strong closing section (100-200 words) for a ${pageLabel}.

TITLE: ${brief.suggestedTitle}
TARGET KEYWORD: "${brief.targetKeyword}"
AUDIENCE: ${brief.audience}
${brief.toneAndStyle ? `TONE & STYLE: ${brief.toneAndStyle}` : ''}
${brief.ctaRecommendations?.length ? `CTA RECOMMENDATIONS:\n${brief.ctaRecommendations.map((c, i) => `${i === 0 ? '- PRIMARY' : '- Secondary'}: ${c}`).join('\n')}` : ''}
${voiceCtx}

SECTIONS COVERED:
${brief.outline.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

PAGE-TYPE-SPECIFIC REQUIREMENTS:
${typeInstructions}

UNIVERSAL REQUIREMENTS:
- Start with an appropriate ## heading (e.g., "## Next Steps", "## Ready to Get Started?", "## Key Takeaways")
- Naturally include the target keyword one final time
- Match the specified tone and brand voice exactly
- Write for humans first, search engines second

Return ONLY the closing section in markdown. No labels, no meta-commentary.`;

  const result = await callOpenAI({
    model: CONTENT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 800,
    temperature: CONTENT_TEMP,
    feature: 'content-post-conclusion',
    workspaceId,
  });
  return result.text.trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Unification pass — reviews the fully assembled post and returns
 * refined versions of each part with smoother transitions, consistent
 * voice, and no subtle repetition across sections.
 */
async function unifyPost(
  post: GeneratedPost,
  brief: ContentBrief,
  voiceCtx: string,
  workspaceId: string,
): Promise<{ introduction?: string; sections?: string[]; conclusion?: string } | null> {
  const pageType = brief.pageType || 'blog';
  const role = PAGE_TYPE_WRITER_ROLE[pageType] || PAGE_TYPE_WRITER_ROLE.blog;

  // Assemble the full draft for review
  const fullDraft = [
    `# ${post.title}\n\n${post.introduction}`,
    ...post.sections.map(s => `## ${s.heading}\n\n${s.content}`),
    post.conclusion,
  ].join('\n\n---\n\n');

  // If the post is very short, skip unification (not worth the cost)
  if (post.totalWordCount < 400) return null;

  const prompt = `${role}

You are performing a UNIFICATION PASS on a fully written piece of content. Each section was generated independently and may have:
- Awkward or missing transitions between sections
- Subtle repetition of the same points, phrases, or examples across sections
- Inconsistent tone or voice shifts between sections
- Disconnected narrative — the intro promises one thing but sections deliver another

YOUR TASK: Refine each section to create a cohesive, unified piece that reads as if written in a single sitting by one expert author.

TITLE: ${post.title}
TARGET KEYWORD: "${brief.targetKeyword}"
AUDIENCE: ${brief.audience}
${brief.toneAndStyle ? `TONE & STYLE: ${brief.toneAndStyle}` : ''}
${voiceCtx}

FULL DRAFT:
${fullDraft}

RULES:
- Preserve the meaning, depth, and word count of each section — this is a POLISH, not a rewrite
- Smooth transitions: each section should flow naturally from the previous one
- Remove repeated phrases, examples, or talking points that appear in multiple sections
- Ensure the introduction's promises are fulfilled by the body sections
- Ensure the conclusion ties back to the introduction's hook
- Keep all markdown formatting (headings, bold, lists, etc.)
- Do NOT add new content or significantly change word counts
- Do NOT include the title heading — just return the body parts

Return valid JSON with this exact structure:
{
  "introduction": "refined intro text (markdown, no heading)",
  "sections": ["refined section 1 text (markdown, no heading)", "refined section 2 text", ...],
  "conclusion": "refined conclusion text (markdown, with its own ## heading)"
}

Return ONLY valid JSON, no markdown fences.`;

  const result = await callOpenAI({
    model: CONTENT_MODEL,
    messages: [
      { role: 'system', content: 'You are a senior editor performing a cohesion review. Return valid JSON only.' },
      { role: 'user', content: prompt },
    ],
    maxTokens: 8000,
    temperature: 0.4,
    feature: 'content-post-unify',
    workspaceId,
  });

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { introduction?: string; sections?: string[]; conclusion?: string };
    // Validate sections count matches
    if (parsed.sections && parsed.sections.length !== post.sections.length) {
      console.warn(`[content-posts] Unification returned ${parsed.sections.length} sections but expected ${post.sections.length} — skipping section updates`);
      parsed.sections = undefined;
    }
    return parsed;
  } catch (err) {
    console.warn('[content-posts] Failed to parse unification JSON:', err);
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
): Promise<GeneratedPost> {
  const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const voiceCtx = buildVoiceContext(workspaceId);

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
    status: 'generating',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Save initial skeleton
  savePost(workspaceId, post);

  // 1. Generate introduction
  try {
    post.introduction = await generateIntroduction(brief, voiceCtx, workspaceId);
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

    try {
      const content = await generateSection(
        brief, brief.outline[i], i, completedSections, voiceCtx, workspaceId,
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
    post.conclusion = await generateConclusion(brief, voiceCtx, workspaceId);
  } catch (err) {
    post.conclusion = `*[Conclusion generation failed: ${err instanceof Error ? err.message : 'Unknown error'}]*`;
  }

  post.updatedAt = new Date().toISOString();
  savePost(workspaceId, post);

  // 4. Unification pass — review the full post for cohesion, smooth transitions, and consistent voice
  try {
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
      post.updatedAt = new Date().toISOString();
      savePost(workspaceId, post);
    }
  } catch (err) {
    console.error(`[content-posts] Unification pass failed (non-critical):`, err);
    // Non-critical — the post is still usable without unification
  }

  // Finalize
  post.totalWordCount = countWords(post.introduction)
    + post.sections.reduce((s, sec) => s + sec.wordCount, 0)
    + countWords(post.conclusion);
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
 * Export a post as HTML.
 */
export function exportPostHTML(post: GeneratedPost): string {
  // Simple markdown-to-HTML conversion for common patterns
  function md2html(md: string): string {
    return md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/^(?!<[hulo])/gm, '')
      .trim();
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="description" content="${post.metaDescription}">
  <title>${post.title}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #1a1a1a; }
    h1 { font-size: 2.2rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; margin-top: 2rem; color: #2d3748; }
    h3 { font-size: 1.2rem; margin-top: 1.5rem; color: #4a5568; }
    ul, ol { padding-left: 1.5rem; }
    li { margin-bottom: 0.3rem; }
    strong { color: #1a202c; }
    .meta { color: #718096; font-size: 0.9rem; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>${post.title}</h1>
  <div class="meta">${post.totalWordCount} words · ${post.targetKeyword}</div>
  ${md2html(post.introduction)}
  ${post.sections.map(s => md2html(s.content)).join('\n')}
  ${md2html(post.conclusion)}
</body>
</html>`;
}
