import { randomUUID } from 'crypto';
import { callAI } from './ai.js';
import { broadcastToWorkspace } from './broadcast.js';
import { isProgrammingError } from './errors.js';
import {
  createJob,
  hasActiveJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import { parseAIJson } from './openai-helpers.js';
import { getActionBySource, recordAction } from './outcome-tracking.js';
import { decrementUsage, incrementIfAllowed } from './usage-tracking.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { scrapeWorkspaceSite } from './workspace-site-scrape.js';
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobType,
} from '../shared/types/background-jobs.js';
import type { AudiencePersona } from '../shared/types/workspace.js';

const log = createLogger('workspace-context-generation-job');

type WorkspaceContextJobType =
  | typeof BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION
  | typeof BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION
  | typeof BACKGROUND_JOB_TYPES.PERSONA_GENERATION;

type WorkspaceContextJobResult =
  | { kind: 'knowledgeBase'; knowledgeBase: string; pagesScraped: number }
  | { kind: 'brandVoice'; brandVoice: string; pagesScraped: number }
  | { kind: 'personas'; personas: AudiencePersona[]; pagesScraped: number };

class WorkspaceContextJobStartError extends Error {
  readonly status: number;
  readonly jobId?: string;

  constructor(
    message: string,
    status: number,
    jobId?: string,
  ) {
    super(message);
    this.name = 'WorkspaceContextJobStartError';
    this.status = status;
    this.jobId = jobId;
  }
}

const JOB_LABELS: Record<WorkspaceContextJobType, string> = {
  [BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION]: 'knowledge base',
  [BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION]: 'brand voice',
  [BACKGROUND_JOB_TYPES.PERSONA_GENERATION]: 'audience personas',
};

function normalizePersonaResults(raw: string): AudiencePersona[] {
  const personas = parseAIJson<Array<{
    name: string;
    description: string;
    painPoints: string[];
    goals: string[];
    objections: string[];
    preferredContentFormat?: string;
    buyingStage?: string;
  }>>(raw);

  if (!Array.isArray(personas) || personas.length === 0) {
    throw new Error('AI did not return valid personas');
  }

  return personas.slice(0, 5).map((p, i) => ({
    id: `persona_${randomUUID()}`,
    name: p.name || `Persona ${i + 1}`,
    description: p.description || '',
    painPoints: Array.isArray(p.painPoints) ? p.painPoints : [],
    goals: Array.isArray(p.goals) ? p.goals : [],
    objections: Array.isArray(p.objections) ? p.objections : [],
    preferredContentFormat: p.preferredContentFormat || undefined,
    buyingStage: (['awareness', 'consideration', 'decision'].includes(p.buyingStage || '') ? p.buyingStage : 'consideration') as AudiencePersona['buyingStage'],
  }));
}

async function generateWorkspaceContextResult(type: WorkspaceContextJobType, workspaceId: string): Promise<WorkspaceContextJobResult> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const { scraped, pagesSummary } = await scrapeWorkspaceSite(ws);

  if (type === BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION) {
    const aiResult = await callAI({
      provider: 'openai',
      model: 'gpt-5.4',
      system: 'You are a business analyst. Given scraped website content, extract a structured knowledge base that an AI content writer and chatbot can use to understand this business. Be specific and factual — only include information that is clearly stated or strongly implied on the website.',
      messages: [{
        role: 'user',
        content: `Analyze the following website content and produce a structured business knowledge base.

${pagesSummary}

Generate a knowledge base in this exact format (fill in what you find, leave sections empty with "Not found on website" if the information isn't available):

BUSINESS OVERVIEW:
- Company name: [name]
- Industry: [industry/vertical]
- Location: [city, state/country if mentioned]
- Business type: [agency, SaaS, local service, e-commerce, etc.]
- Years in business: [if mentioned]
- Team size: [if mentioned]

SERVICES & OFFERINGS:
[List each service/product with a 1-sentence description]

TARGET AUDIENCE:
- Primary audience: [who they serve]
- Industries served: [list industries/verticals mentioned]
- Company sizes: [SMB, enterprise, etc. if mentioned]

DIFFERENTIATORS & VALUE PROPS:
[List what makes them unique — awards, methodology, technology, guarantees, etc.]

CASE STUDIES & RESULTS:
[List any specific client work, results, metrics, or testimonials mentioned. Include client names, industries, and outcomes with real numbers if available.]

BRAND VOICE & TONE:
[Describe the writing style observed across the site — formal/casual, technical/approachable, etc.]

KEY TOPICS & EXPERTISE:
[List the main topics, technologies, or domains they demonstrate expertise in]

IMPORTANT DETAILS:
[Any other relevant business information — certifications, partnerships, tools used, process descriptions, pricing model, etc.]

Be concise but specific. Use bullet points. Only include information actually found on the website — never fabricate.`,
      }],
      maxTokens: 2000,
      temperature: 0.3,
      feature: 'knowledge-base-gen',
      workspaceId,
      timeoutMs: 90_000,
    });
    return { kind: 'knowledgeBase', knowledgeBase: aiResult.text, pagesScraped: scraped.length };
  }

  if (type === BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION) {
    const aiResult = await callAI({
      provider: 'openai',
      model: 'gpt-5.4',
      system: 'You are a brand strategist and copywriting expert. Given scraped website content, analyze the writing style, tone, and voice patterns used across the site. Be specific and evidence-based — only describe patterns you actually observe in the content.',
      messages: [{
        role: 'user',
        content: `Analyze the following website content and produce a comprehensive brand voice guide that an AI content writer can follow to match this brand's writing style.

${pagesSummary}

Generate a brand voice guide covering these areas:

TONE & PERSONALITY:
- Overall tone: [e.g. professional, casual, authoritative, friendly, etc.]
- Personality traits: [3-5 adjectives that describe the brand's character]
- Formality level: [formal / semi-formal / casual / conversational]

WRITING STYLE:
- Sentence structure: [short & punchy / long & detailed / mixed]
- Vocabulary level: [technical jargon / industry terms / plain language / mix]
- Person/perspective: [first person "we" / second person "you" / third person]
- Active vs passive voice: [preference observed]

MESSAGING PATTERNS:
- How they describe their services: [direct claims / benefit-led / story-driven]
- How they address the reader: [as a peer / as an expert to client / as a helper]
- CTAs and persuasion style: [soft / direct / urgency-driven / value-led]
- Common phrases or language patterns: [list any recurring phrases, slogans, or distinctive word choices]

DO's:
[5-8 specific writing guidelines based on what the brand does well]

DON'Ts:
[5-8 things to avoid based on what's absent or contrary to the brand's style]

EXAMPLE PHRASES:
[5-10 short phrases or sentences lifted directly from the site that exemplify the brand voice]

Be specific and actionable. An AI writer should be able to follow this guide to produce copy that sounds like it belongs on this website.`,
      }],
      maxTokens: 2000,
      temperature: 0.4,
      feature: 'brand-voice-gen',
      workspaceId,
      timeoutMs: 90_000,
    });
    return { kind: 'brandVoice', brandVoice: aiResult.text, pagesScraped: scraped.length };
  }

  const aiResult = await callAI({
    provider: 'openai',
    model: 'gpt-5.4',
    system: 'You are a marketing strategist. Given scraped website content, identify the distinct audience segments this business targets. Be specific and evidence-based — only identify personas that are clearly implied by the website\'s messaging, services, case studies, or content.',
    messages: [{
      role: 'user',
      content: `Analyze the following website content and identify 2-5 distinct audience personas this business targets.

${pagesSummary}

Return ONLY a valid JSON array of persona objects. No markdown, no explanation — just the JSON array.

Each persona object must have exactly these fields:
{
  "name": "Short persona name (e.g. 'Marketing Director', 'Small Business Owner')",
  "description": "1-2 sentence description of who this person is",
  "painPoints": ["pain point 1", "pain point 2", "pain point 3"],
  "goals": ["goal 1", "goal 2", "goal 3"],
  "objections": ["likely objection 1", "likely objection 2"],
  "preferredContentFormat": "e.g. case studies, how-to guides, comparison articles",
  "buyingStage": "awareness" or "consideration" or "decision"
}

Rules:
- Identify 2-5 personas based on evidence from the website (who the services target, case study clients, language used)
- Each persona should be distinct — different roles, industries, or needs
- Pain points, goals, and objections should be specific to THIS business's offerings
- If buying stage isn't clear, default to "consideration"
- ONLY return the JSON array, nothing else`,
    }],
    maxTokens: 2500,
    temperature: 0.4,
    feature: 'personas-gen',
    workspaceId,
    timeoutMs: 90_000,
  });

  return { kind: 'personas', personas: normalizePersonaResults(aiResult.text), pagesScraped: scraped.length };
}

function recordBrandVoiceOutcome(workspaceId: string): void {
  try {
    if (!getActionBySource('brand_voice', workspaceId)) {
      const action = recordAction({ // recordAction-ok: workspaceId was validated before job creation.
        workspaceId,
        actionType: 'voice_calibrated',
        sourceType: 'brand_voice',
        sourceId: workspaceId,
        pageUrl: null,
        targetKeyword: null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        attribution: 'platform_executed',
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.OUTCOME_ACTION_RECORDED, { actionId: action.id });
    }
  } catch (err) {
    log.warn({ err }, 'Failed to record outcome action for brand voice update');
  }
}

export function startWorkspaceContextGenerationJob(type: BackgroundJobType, workspaceId: string): { jobId: string } {
  if (!Object.prototype.hasOwnProperty.call(JOB_LABELS, type)) {
    throw new WorkspaceContextJobStartError('Unknown workspace context generation job type', 400);
  }
  const contextType = type as WorkspaceContextJobType;
  if (!workspaceId) throw new WorkspaceContextJobStartError('workspaceId required', 400);

  const ws = getWorkspace(workspaceId);
  if (!ws) throw new WorkspaceContextJobStartError('Workspace not found', 404);
  if (!ws.webflowSiteId) throw new WorkspaceContextJobStartError('No Webflow site linked', 400);

  const active = hasActiveJob(contextType, workspaceId);
  if (active) {
    throw new WorkspaceContextJobStartError(
      `${JOB_LABELS[contextType]} generation is already running for this workspace`,
      409,
      active.id,
    );
  }

  if (!incrementIfAllowed(ws.id, ws.tier || 'free', 'workspace_context_generations')) {
    throw new WorkspaceContextJobStartError('Monthly AI generation limit reached', 429);
  }

  const job = createJob(contextType, {
    message: `Preparing ${JOB_LABELS[contextType]} generation...`,
    workspaceId,
    total: 100,
  });

  void runWorkspaceContextGenerationJob({ jobId: job.id, workspaceId, type: contextType });
  return { jobId: job.id };
}

export function workspaceContextJobErrorResponse(err: unknown): { status: number; body: { error: string; jobId?: string } } {
  if (err instanceof WorkspaceContextJobStartError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        ...(err.jobId ? { jobId: err.jobId } : {}),
      },
    };
  }
  return {
    status: 500,
    body: { error: err instanceof Error ? err.message : String(err) },
  };
}

async function runWorkspaceContextGenerationJob(opts: {
  jobId: string;
  workspaceId: string;
  type: WorkspaceContextJobType;
}): Promise<void> {
  const label = JOB_LABELS[opts.type];
  try {
    updateJob(opts.jobId, {
      status: 'running',
      message: `Crawling site for ${label}...`,
      progress: 10,
      total: 100,
    });
    const result = await generateWorkspaceContextResult(opts.type, opts.workspaceId);

    if (result.kind === 'brandVoice') recordBrandVoiceOutcome(opts.workspaceId);

    updateJob(opts.jobId, {
      status: 'done',
      result,
      progress: 100,
      total: 100,
      message: `${label[0].toUpperCase()}${label.slice(1)} draft ready for review`,
    });
  } catch (err) {
    decrementUsage(opts.workspaceId, 'workspace_context_generations');
    if (isProgrammingError(err)) log.warn({ err }, 'workspace context generation failed with programming error');
    else log.debug({ err }, 'workspace context generation failed — degrading gracefully');
    updateJob(opts.jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: `${label[0].toUpperCase()}${label.slice(1)} generation failed`,
    });
  }
}
