import fs from 'fs';
import path from 'path';
import { buildSeoContext, buildKeywordMapContext } from './seo-context.js';
import { getUploadRoot, getDataDir } from './data-dir.js';
import type { KeywordMetrics, RelatedKeyword } from './semrush.js';

const UPLOAD_ROOT = getUploadRoot();
const BRIEFS_DIR = getDataDir('content-briefs');

fs.mkdirSync(BRIEFS_DIR, { recursive: true });

// Old storage path: ~/toUpload/<wsId>/.content-briefs/briefs.json
function getOldBriefFile(workspaceId: string): string {
  return path.join(UPLOAD_ROOT, workspaceId, '.content-briefs', 'briefs.json');
}

export interface ContentBrief {
  id: string;
  workspaceId: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  suggestedTitle: string;
  suggestedMetaDesc: string;
  outline: { heading: string; notes: string; wordCount?: number; keywords?: string[] }[];
  wordCountTarget: number;
  intent: string;
  audience: string;
  competitorInsights: string;
  internalLinkSuggestions: string[];
  createdAt: string;
  // Enhanced fields (v2)
  executiveSummary?: string;
  contentFormat?: string;
  toneAndStyle?: string;
  peopleAlsoAsk?: string[];
  topicalEntities?: string[];
  serpAnalysis?: { contentType: string; avgWordCount: number; commonElements: string[]; gaps: string[] };
  difficultyScore?: number;
  trafficPotential?: string;
  ctaRecommendations?: string[];
  // Enhanced fields (v3)
  eeatGuidance?: { experience: string; expertise: string; authority: string; trust: string };
  contentChecklist?: string[];
  schemaRecommendations?: { type: string; notes: string }[];
}

function getBriefFile(workspaceId: string): string {
  return path.join(BRIEFS_DIR, `${workspaceId}.json`);
}

function readBriefs(workspaceId: string): ContentBrief[] {
  // Try new path first
  try {
    const f = getBriefFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
  // Fall back to old path
  try {
    const old = getOldBriefFile(workspaceId);
    if (fs.existsSync(old)) {
      const data = JSON.parse(fs.readFileSync(old, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        writeBriefs(workspaceId, data);
        console.log(`[Migration] Moved ${data.length} content briefs for ${workspaceId} to new path`);
        return data;
      }
    }
  } catch { /* skip */ }
  return [];
}

function writeBriefs(workspaceId: string, briefs: ContentBrief[]) {
  fs.writeFileSync(getBriefFile(workspaceId), JSON.stringify(briefs, null, 2));
}

export function listBriefs(workspaceId: string): ContentBrief[] {
  return readBriefs(workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBrief(workspaceId: string, briefId: string): ContentBrief | undefined {
  return readBriefs(workspaceId).find(b => b.id === briefId);
}

export function updateBrief(workspaceId: string, briefId: string, updates: Partial<Omit<ContentBrief, 'id' | 'workspaceId' | 'createdAt'>>): ContentBrief | null {
  const briefs = readBriefs(workspaceId);
  const idx = briefs.findIndex(b => b.id === briefId);
  if (idx === -1) return null;
  Object.assign(briefs[idx], updates);
  writeBriefs(workspaceId, briefs);
  return briefs[idx];
}

export function deleteBrief(workspaceId: string, briefId: string): boolean {
  const briefs = readBriefs(workspaceId);
  const idx = briefs.findIndex(b => b.id === briefId);
  if (idx === -1) return false;
  briefs.splice(idx, 1);
  writeBriefs(workspaceId, briefs);
  return true;
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
  }
): Promise<ContentBrief> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const relatedStr = context.relatedQueries?.slice(0, 20)
    .map(q => `"${q.query}" (pos #${q.position}, ${q.clicks} clicks, ${q.impressions} imp)`)
    .join('\n') || 'No related query data available';

  const pagesStr = context.existingPages?.slice(0, 15).join('\n') || 'No existing pages provided';

  // Pull in keyword strategy context for alignment
  const { keywordBlock, brandVoiceBlock, businessContext: stratBizCtx } = buildSeoContext(workspaceId);
  const kwMapContext = buildKeywordMapContext(workspaceId);
  const bizCtx = context.businessContext || stratBizCtx;

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

  const prompt = `You are an expert content strategist and SEO specialist. Generate a comprehensive, production-ready content brief for a new piece of content targeting the keyword "${targetKeyword}".

${bizCtx ? `Business context: ${bizCtx}` : ''}

Related search queries from Google Search Console:
${relatedStr}

Existing pages on the site:
${pagesStr}${keywordBlock}${brandVoiceBlock}${kwMapContext}${semrushBlock}

Generate a content brief in the following JSON format:
{
  "executiveSummary": "2-3 sentence plain-English summary of why this content matters, its strategic value, and expected impact",
  "suggestedTitle": "SEO-optimized title tag (50-60 chars)",
  "suggestedMetaDesc": "Compelling meta description (150-160 chars)",
  "secondaryKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8"],
  "contentFormat": "The recommended format: guide, listicle, how-to, comparison, FAQ, case-study, pillar-page, or landing-page",
  "toneAndStyle": "Specific tone and style guidance for the writer (e.g., authoritative but approachable, data-driven, conversational)",
  "outline": [
    { "heading": "H2 heading text", "notes": "Detailed guidance for this section: what to cover, key points, data to include (3-5 sentences)", "wordCount": 250, "keywords": ["keywords to naturally include in this section"] }
  ],
  "wordCountTarget": 1800,
  "intent": "Search intent (informational/transactional/navigational/commercial)",
  "audience": "Detailed target audience description including their pain points and what they need from this content",
  "peopleAlsoAsk": ["Question 1 searchers commonly ask?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"],
  "topicalEntities": ["entity1", "entity2", "entity3", "entity4", "entity5", "entity6", "entity7", "entity8"],
  "serpAnalysis": {
    "contentType": "What type of content dominates the SERP for this keyword",
    "avgWordCount": 1800,
    "commonElements": ["Elements found in top-ranking content (e.g., comparison tables, images, expert quotes)"],
    "gaps": ["Content angles missing from top results that represent an opportunity"]
  },
  "difficultyScore": 45,
  "trafficPotential": "Estimated monthly search volume range and traffic potential (e.g., '500-1,000 monthly searches, moderate competition')",
  "competitorInsights": "Detailed analysis of what top-ranking content covers, their strengths, weaknesses, and how to differentiate",
  "ctaRecommendations": ["Primary CTA the content should drive", "Secondary CTA or micro-conversion"],
  "internalLinkSuggestions": ["page-slug-1", "page-slug-2", "page-slug-3"],
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
- The outline should have 6-10 sections with H2 headings, each with specific wordCount targets that sum to the total wordCountTarget
- Each outline section must include keywords to weave naturally into that section
- Secondary keywords: 6-8 naturally related terms including long-tail variations
- People Also Ask: 5 real questions searchers ask about this topic
- Topical entities: 8+ specific concepts, terms, or entities to cover for topical authority
- SERP analysis should reflect realistic analysis of what ranks for this keyword
- difficultyScore: 1-100 based on estimated keyword competition
- Make every section actionable and specific — a copywriter or AI tool should be able to write directly from this brief
- Internal link suggestions should reference existing pages where relevant
- E-E-A-T guidance must be specific and actionable for this particular topic, not generic advice
- Content checklist: 8-10 concrete, verifiable items tailored to this brief (not generic SEO advice)
- Schema recommendations: 1-3 relevant schema types with specific implementation guidance

Return ONLY valid JSON, no markdown fences, no explanation.`;

  const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 5000,
      temperature: 0.7,
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const aiData = await aiRes.json() as { choices: { message: { content: string } }[] };
  const raw = aiData.choices[0]?.message?.content?.trim() || '{}';

  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Failed to parse AI response as JSON');
  }

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
  };

  const briefs = readBriefs(workspaceId);
  briefs.push(brief);
  writeBriefs(workspaceId, briefs);

  return brief;
}
