import fs from 'fs';
import path from 'path';
import { buildSeoContext, buildKeywordMapContext } from './seo-context.js';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const UPLOAD_ROOT = DATA_BASE
  ? path.join(DATA_BASE, 'uploads')
  : path.join(process.env.HOME || '', 'toUpload');

function getBriefsDir(workspaceId: string): string {
  const dir = path.join(UPLOAD_ROOT, workspaceId, '.content-briefs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ContentBrief {
  id: string;
  workspaceId: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  suggestedTitle: string;
  suggestedMetaDesc: string;
  outline: { heading: string; notes: string }[];
  wordCountTarget: number;
  intent: string;
  audience: string;
  competitorInsights: string;
  internalLinkSuggestions: string[];
  createdAt: string;
}

function getBriefFile(workspaceId: string): string {
  return path.join(getBriefsDir(workspaceId), 'briefs.json');
}

function readBriefs(workspaceId: string): ContentBrief[] {
  try {
    const f = getBriefFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
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
  }
): Promise<ContentBrief> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const relatedStr = context.relatedQueries?.slice(0, 20)
    .map(q => `"${q.query}" (pos #${q.position}, ${q.clicks} clicks, ${q.impressions} imp)`)
    .join('\n') || 'No related query data available';

  const pagesStr = context.existingPages?.slice(0, 15).join('\n') || 'No existing pages provided';

  // Pull in keyword strategy context for alignment
  const { keywordBlock, businessContext: stratBizCtx } = buildSeoContext(workspaceId);
  const kwMapContext = buildKeywordMapContext(workspaceId);
  const bizCtx = context.businessContext || stratBizCtx;

  const prompt = `You are an expert content strategist and SEO specialist. Generate a comprehensive content brief for a new piece of content targeting the keyword "${targetKeyword}".

${bizCtx ? `Business context: ${bizCtx}` : ''}

Related search queries from Google Search Console:
${relatedStr}

Existing pages on the site:
${pagesStr}${keywordBlock}${kwMapContext}

Generate a content brief in the following JSON format:
{
  "suggestedTitle": "SEO-optimized title tag (50-60 chars)",
  "suggestedMetaDesc": "Compelling meta description (150-160 chars)",
  "secondaryKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "outline": [
    { "heading": "H2 heading text", "notes": "What to cover in this section (2-3 sentences)" }
  ],
  "wordCountTarget": 1500,
  "intent": "Search intent (informational/transactional/navigational/commercial)",
  "audience": "Target audience description",
  "competitorInsights": "Brief analysis of what top-ranking content covers and how to differentiate",
  "internalLinkSuggestions": ["page-slug-1", "page-slug-2"]
}

Requirements:
- The outline should have 5-8 sections with H2 headings
- Secondary keywords should be naturally related to the target keyword
- Word count target should be appropriate for the intent (800-2500)
- Internal link suggestions should reference existing pages where relevant
- Make the brief actionable and specific, not generic

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
      max_tokens: 1500,
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
    outline: (parsed.outline as { heading: string; notes: string }[]) || [],
    wordCountTarget: (parsed.wordCountTarget as number) || 1500,
    intent: (parsed.intent as string) || 'informational',
    audience: (parsed.audience as string) || '',
    competitorInsights: (parsed.competitorInsights as string) || '',
    internalLinkSuggestions: (parsed.internalLinkSuggestions as string[]) || [],
    createdAt: new Date().toISOString(),
  };

  const briefs = readBriefs(workspaceId);
  briefs.push(brief);
  writeBriefs(workspaceId, briefs);

  return brief;
}
