import { createHash } from 'crypto';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { getMeetingBriefHash, upsertMeetingBrief } from './meeting-brief-store.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { createLogger } from './logger.js';
import type { WorkspaceIntelligence, IntelligenceSlice } from '../shared/types/intelligence.js';
import type { MeetingBrief, MeetingBriefAIOutput, MeetingBriefMetrics } from '../shared/types/meeting-brief.js';

const log = createLogger('meeting-brief-generator');

const BRIEF_SLICES: IntelligenceSlice[] = [
  'seoContext', 'insights', 'learnings', 'siteHealth', 'contentPipeline', 'clientSignals',
];

/** Assembles At-a-Glance metrics directly from intelligence slices — no AI involved. */
export function assembleMeetingBriefMetrics(intel: WorkspaceIntelligence): MeetingBriefMetrics {
  return {
    siteHealthScore: intel.siteHealth?.auditScore ?? null,
    openRankingOpportunities: intel.insights?.byType.ranking_opportunity?.length ?? 0,
    contentInPipeline:
      (intel.contentPipeline?.briefs.total ?? 0) +
      (intel.contentPipeline?.posts.total ?? 0),
    overallWinRate: intel.learnings?.overallWinRate != null
      ? Math.round(intel.learnings.overallWinRate * 100)
      : null,
    criticalIssues: intel.insights?.bySeverity.critical ?? 0,
  };
}

/** Builds the prompt context string sent to the AI. */
export function buildBriefPrompt(intel: WorkspaceIntelligence): string {
  const top = intel.insights?.topByImpact?.slice(0, 10) ?? [];
  const wins = intel.learnings?.topWins?.slice(0, 5) ?? [];
  const winRate = intel.learnings?.overallWinRate != null
    ? `${Math.round(intel.learnings.overallWinRate * 100)}%`
    : 'unknown';
  const siteScore = intel.siteHealth?.auditScore ?? 'unknown';
  const scoreDelta = intel.siteHealth?.auditScoreDelta;
  const priorities = intel.clientSignals?.businessPriorities ?? [];
  const pipeline = intel.contentPipeline;
  const strategy = intel.seoContext?.strategy;

  const insightLines = top.map(i =>
    `- [${i.severity.toUpperCase()}] ${i.insightType}: ${i.pageTitle ?? i.pageId ?? 'workspace'} — ${JSON.stringify(i.data).slice(0, 200)}`
  ).join('\n');

  const winsLines = wins.map(w =>
    `- ${w.actionType} on ${w.pageUrl ?? 'workspace'}`
  ).join('\n');

  return `
You are a strategic SEO analyst preparing a client meeting brief. Write in a confident, direct tone — like a trusted advisor, not a report.

SITE CONTEXT:
- Site health score: ${siteScore}${scoreDelta != null ? ` (${scoreDelta > 0 ? '+' : ''}${scoreDelta} from last audit)` : ''}
- Overall win rate: ${winRate}
- Strategy focus: ${strategy?.siteKeywords?.slice(0, 5).join(', ') ?? 'not set'}
- Client priorities: ${priorities.length > 0 ? priorities.join('; ') : 'not specified'}

PIPELINE:
- Briefs in progress: ${pipeline?.briefs.total ?? 0}
- Posts: ${pipeline?.posts.total ?? 0}

TOP INSIGHTS (ordered by impact):
${insightLines || '(no open insights)'}

RECENT WINS:
${winsLines || '(no tracked wins yet)'}

INSTRUCTIONS:
Return a JSON object with exactly these keys:
{
  "situationSummary": "2-3 sentence narrative of the site's current state and momentum",
  "wins": ["3-5 bullets describing concrete recent wins — name pages and metrics"],
  "attention": ["3-5 bullets describing what needs attention — plain language, no jargon"],
  "recommendations": [
    { "action": "concrete next step", "rationale": "one-line reason" }
  ],
  "blueprintProgress": null
}

Rules:
- Never use admin jargon (no 'insight', 'severity', 'impact score', 'bridge')
- Be specific: name pages, queries, percentages
- Wins first — the meeting should feel constructive
- 3-5 items per list maximum
- blueprintProgress is always null in this version (Phase 1)
`.trim();
}

function buildPromptHash(intel: WorkspaceIntelligence): string {
  const relevant = {
    topIds: intel.insights?.topByImpact?.slice(0, 10).map(i => i.id) ?? [],
    siteScore: intel.siteHealth?.auditScore,
    pipeline: intel.contentPipeline?.briefs.total,
    winRate: intel.learnings?.overallWinRate,
  };
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

/**
 * Generates (or returns cached) meeting brief for a workspace.
 * Skips AI call if intelligence data hash matches the stored brief.
 */
export async function generateMeetingBrief(workspaceId: string): Promise<MeetingBrief> {
  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: BRIEF_SLICES });
  const hash = buildPromptHash(intel);
  const cachedHash = getMeetingBriefHash(workspaceId);

  if (hash === cachedHash) {
    log.debug({ workspaceId }, 'Meeting brief data unchanged — returning cached brief');
    // Intentional control flow: the route handler catches BRIEF_UNCHANGED and returns
    // the stored brief as a 200 { brief, unchanged: true }. This never reaches Sentry.
    throw new Error('BRIEF_UNCHANGED');
  }

  const systemPrompt = buildSystemPrompt(workspaceId, `
You are a strategic analyst preparing a client-facing meeting brief. Your output must be valid JSON matching the MeetingBriefAIOutput interface exactly.

Write for the client — no admin jargon, no internal scoring language. Be specific: name pages, queries, and numbers when the data supports it. Narrative tone, not bullet-point data dumps. Lead with wins before challenges.

Example of a strong situation summary:
"Your site has gained traction in local search this quarter, with 3 service pages now ranking top-5 for location-specific queries. The main opportunity is a content gap around [topic] — competitors capture 40% of that traffic while your pages sit outside the top 20."

Avoid: "Your site health score is 78. You have 12 open insights."
`.trim());

  const prompt = buildBriefPrompt(intel);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  const result = await callOpenAI({
    model: 'gpt-4.1',
    messages,
    maxTokens: 2000,
    temperature: 0.3,
    feature: 'meeting-brief',
    workspaceId,
  });

  let parsed: MeetingBriefAIOutput;
  try {
    parsed = JSON.parse(result.text) as MeetingBriefAIOutput;
  } catch {
    // Retry once — ask the model to fix its own JSON
    const retryMessages: typeof messages = [
      ...messages,
      { role: 'assistant', content: result.text },
      { role: 'user', content: 'Your response was not valid JSON. Return only the JSON object, no explanation.' },
    ];
    const retryResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: retryMessages,
      maxTokens: 2000,
      temperature: 0.1,
      feature: 'meeting-brief',
      workspaceId,
    });
    try {
      parsed = JSON.parse(retryResult.text) as MeetingBriefAIOutput;
    } catch {
      log.error({ workspaceId, rawRetry: retryResult.text.slice(0, 500) }, 'Meeting brief AI returned invalid JSON after retry');
      throw new Error('Meeting brief AI returned invalid JSON after retry');
    }
  }

  const metrics = assembleMeetingBriefMetrics(intel);

  const brief: MeetingBrief = {
    workspaceId,
    generatedAt: new Date().toISOString(),
    situationSummary: parsed.situationSummary ?? '',
    wins: Array.isArray(parsed.wins) ? parsed.wins : [],
    attention: Array.isArray(parsed.attention) ? parsed.attention : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    blueprintProgress: null,
    metrics,
  };

  upsertMeetingBrief(brief, hash);
  broadcastToWorkspace(workspaceId, WS_EVENTS.MEETING_BRIEF_GENERATED, {});

  log.info({ workspaceId }, 'Meeting brief generated and stored');
  return brief;
}
