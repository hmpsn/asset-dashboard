import { createHash } from 'crypto';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { withActiveLocalSeoSlice } from './intelligence/generation-context-builders.js';
import { callAI } from './ai.js';
import { parseStructuredAIOutput, StructuredAIOutputError } from './ai-structured-output.js';
import { buildSystemPrompt, getCustomPromptNotes } from './prompt-assembly.js';
import {
  getStrategyPov,
  getStrategyPovHash,
  getStrategyPovVersion,
  saveStrategyPov,
} from './strategy-pov-store.js';
import { loadRecommendations, isCuratedForClient } from './recommendations.js';
import { strategyPovAIOutputSchema } from './schemas/strategy-pov-schemas.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { createLogger } from './logger.js';
import { assembleMeetingBriefMetrics } from './meeting-brief-generator.js';
import type { WorkspaceIntelligence, IntelligenceSlice } from '../shared/types/intelligence.js';
import type { Recommendation } from '../shared/types/recommendations.js';
import type { StrategyPov, StrategyPovAIOutput, StrategyPovVariant } from '../shared/types/strategy-pov.js';

const log = createLogger('strategy-pov-generator');

/** Reuse the same slice budget as the meeting brief (audit §2 "clone, re-point"). */
const POV_SLICES: IntelligenceSlice[] = [
  'seoContext', 'insights', 'learnings', 'siteHealth', 'contentPipeline', 'clientSignals',
];

/** Control-flow signal: caller (route) catches this and returns the cached POV as a 200. */
export const POV_UNCHANGED = 'POV_UNCHANGED';

/**
 * The curated set the POV is drafted over (audit §2): loadRecommendations filtered by
 * isCuratedForClient — NOT topRecommendationId (that is the meeting-brief's INVERSE signal).
 * Read-only; never triggers generation. Returns [] when no rec set is cached.
 */
export function loadCuratedRecs(workspaceId: string): Recommendation[] {
  const set = loadRecommendations(workspaceId);
  if (!set) return [];
  return set.recommendations.filter(isCuratedForClient);
}

/**
 * Pure content hash. MUST bust when ANY of these change (audit §8 cache-completeness):
 *   - the curated rec id-set, the per-rec clientStatus, the per-rec lifecycle,
 *   - the per-rec CONTENT (title / insight / estimatedGain / opportunity value) AND its ORDER,
 *   - the variant (admin vs client — the prose differs, so the caches must not collide),
 *   - the regenerate nonce.
 *
 * The prose-edit `version` is DELIBERATELY NOT folded into the hash. Folding version in would let a
 * plain `generate` after an operator edit bust the cache (version bumped) and silently overwrite the
 * operator's edit with a fresh draft. By keying only on curated content + variant + nonce, a plain
 * generate over unchanged curated content reports POV_UNCHANGED (operator edits survive); a
 * regenerate (nonce present) always redrafts.
 *
 * Order-DEPENDENT over the curated set: the rec order is part of the prompt (the POV leads with the
 * #1 curated move), so a reorder must redraft. Each rec carries its index in the signal.
 */
export function buildStrategyPovHash(
  curatedRecs: Recommendation[],
  variant: StrategyPovVariant,
  regenerateNonce: string | null,
): string {
  // Order is significant — the POV leads with the first curated move, so a reorder must bust.
  const recSignal = curatedRecs.map((r, index) => ({
    index,
    id: r.id,
    clientStatus: r.clientStatus ?? 'system',
    lifecycle: r.lifecycle ?? 'active',
    title: r.title,
    insight: r.insight,
    estimatedGain: r.estimatedGain,
    value: r.opportunity?.value ?? null,
  }));
  const relevant = {
    recs: recSignal,
    variant,
    regenerateNonce: regenerateNonce ?? null,
  };
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

/**
 * Build the prompt context string for the POV. Re-points buildBriefPrompt's shape at the CURATED
 * set (the operator's sent/engaged recs), not the insights top-by-impact list. The admin variant
 * carries a dateline (operator-facing weekly cadence); the client variant is EVERGREEN — no
 * time-relative language (the pr-check evergreen guard bans "this week"/"last week"/etc).
 */
export function buildStrategyPovPrompt(
  intel: WorkspaceIntelligence,
  curatedRecs: Recommendation[],
  variant: StrategyPovVariant,
): string {
  const siteScore = intel.siteHealth?.auditScore ?? 'unknown';
  const winRate = intel.learnings?.overallWinRate != null
    ? `${Math.round(intel.learnings.overallWinRate * 100)}%`
    : 'unknown';
  const priorities = intel.clientSignals?.effectiveBusinessPriorities ?? [];
  const strategy = intel.seoContext?.strategy;
  const wins = intel.learnings?.topWins?.slice(0, 5) ?? [];

  const curatedLines = curatedRecs.map(r => {
    const value = r.opportunity?.value ?? r.impactScore;
    const kw = r.targetKeyword ? ` [${r.targetKeyword}]` : '';
    return `- id=${r.id} (${r.type}, ${r.priority}, value=${value})${kw}: ${r.title} — ${r.insight}`;
  }).join('\n');

  const winsLines = wins.map(w => {
    const kw = w.targetKeyword ? ` (${w.targetKeyword})` : '';
    return `- ${w.actionType} on ${w.pageUrl ?? 'the site'}${kw}`;
  }).join('\n');

  // Admin variant may carry a dateline; client variant must not (evergreen).
  const datelineNote = variant === 'admin'
    ? 'You MAY reference the current period (e.g. "this week") in the situation — this is the operator-facing weekly issue.'
    : 'EVERGREEN: never use time-relative language ("this week", "last week", "recently", "N days ago", "vs last period"). The client reads this at any time; it must read true whenever opened.';

  return `
SITE CONTEXT:
- Site health score: ${siteScore}
- Overall win rate: ${winRate}
- Strategy focus: ${strategy?.siteKeywords?.slice(0, 5).join(', ') ?? 'not set'}
- Client priorities: ${priorities.length > 0 ? priorities.join('; ') : 'not specified'}

THE CURATED MOVES (the operator has put these in front of the client — draft the POV over THESE, ranked top-first):
${curatedLines || '(no curated moves yet)'}

RECENT WINS:
${winsLines || '(no tracked wins yet)'}

INSTRUCTIONS:
Return a JSON object with exactly these keys:
{
  "situation": "2-3 sentence narrative of where the site stands and where the momentum is",
  "leadSentence": "the single 'the one move I'd bring' sentence — value-first, names the #1 curated move (the first in the list)",
  "wins": ["2-4 short wins worth saying out loud — client-safe"],
  "flags": ["1-3 short things to flag — client-safe, constructive"]
}

Rules:
- ${datelineNote}
- Never use admin jargon (no 'insight', 'severity', 'impact score', 'rec', 'lifecycle')
- The leadSentence MUST be about the first curated move in the list (the #1).
- Be specific: name pages, queries, outcomes — not internal scores.
- Lead with momentum; keep it constructive.
`.trim();
}

async function callPovAI(
  workspaceId: string,
  systemPrompt: string,
  prompt: string,
): Promise<StrategyPovAIOutput> {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: prompt },
  ];
  const result = await callAI({
    operation: 'strategy-pov',
    system: systemPrompt,
    messages,
    maxTokens: 1500,
    temperature: 0.3,
    workspaceId,
  });

  try {
    return parseStructuredAIOutput(result.text, strategyPovAIOutputSchema, 'strategy-pov');
  } catch (err) {
    log.debug(
      { err, issues: err instanceof StructuredAIOutputError ? err.issues : undefined },
      'strategy-pov-generator: AI returned invalid structured output — retrying',
    );
    const retryResult = await callAI({
      operation: 'strategy-pov',
      system: systemPrompt,
      messages: [
        ...messages,
        { role: 'assistant', content: result.text },
        { role: 'user', content: 'Your response was not valid JSON. Return only the JSON object, no explanation.' },
      ],
      maxTokens: 1500,
      temperature: 0.1,
      workspaceId,
    });
    try {
      return parseStructuredAIOutput(retryResult.text, strategyPovAIOutputSchema, 'strategy-pov');
    } catch (retryErr) {
      log.error(
        {
          err: retryErr,
          issues: retryErr instanceof StructuredAIOutputError ? retryErr.issues : undefined,
          workspaceId,
          rawRetry: retryResult.text.slice(0, 500),
        },
        'Strategy POV AI returned invalid structured output after retry',
      );
      throw new Error('Strategy POV AI returned invalid structured output after retry');
    }
  }
}

export interface GenerateStrategyPovOptions {
  variant?: StrategyPovVariant;
  /** Force regeneration even when the hash matches (POST /regenerate). */
  regenerateNonce?: string | null;
}

/**
 * Generate (or return cached) the strategy POV. Throws POV_UNCHANGED when the content hash matches
 * the stored hash so the route can return the cached POV as a 200 (clone of BRIEF_UNCHANGED).
 * The hash keys on curated content + variant + nonce — NOT the prose-edit version — so a plain
 * generate after an operator edit returns the cached (edited) POV rather than overwriting it; a
 * regenerate (nonce present) always redrafts.
 */
export async function generateStrategyPov(
  workspaceId: string,
  opts: GenerateStrategyPovOptions = {},
): Promise<StrategyPov> {
  const variant: StrategyPovVariant = opts.variant ?? 'admin';
  const regenerateNonce = opts.regenerateNonce ?? null;

  const curatedRecs = loadCuratedRecs(workspaceId);
  const version = getStrategyPovVersion(workspaceId);
  const hash = buildStrategyPovHash(curatedRecs, variant, regenerateNonce);
  const cachedHash = getStrategyPovHash(workspaceId);

  if (regenerateNonce == null && hash === cachedHash) {
    log.debug({ workspaceId }, 'Strategy POV unchanged — returning cached POV');
    // Intentional control flow: the route catches POV_UNCHANGED and returns the stored POV (200).
    throw new Error(POV_UNCHANGED);
  }

  const slices = await withActiveLocalSeoSlice(workspaceId, POV_SLICES);
  const intel = await buildWorkspaceIntelligence(workspaceId, { slices });
  const customPromptNotes = getCustomPromptNotes(workspaceId);
  // assembleMeetingBriefMetrics reused verbatim (audit §2) — kept warm so the at-a-glance metrics
  // are available to the cockpit even though the POV body itself is AI-drafted.
  void assembleMeetingBriefMetrics(intel);

  const systemPrompt = buildSystemPrompt(workspaceId, `
You are a strategic SEO advisor drafting a curated point of view for ${variant === 'client' ? 'the client' : 'the operator review'}. Your output must be valid JSON matching the StrategyPovAIOutput interface exactly.

Write a confident, value-first narrative over the operator's CURATED moves. No admin jargon, no internal scoring language. Lead with momentum, name the single best move, and keep wins and flags short and client-safe.
`.trim(), customPromptNotes);

  const prompt = buildStrategyPovPrompt(intel, curatedRecs, variant);
  const parsed = await callPovAI(workspaceId, systemPrompt, prompt);

  const leadMoveRecId = curatedRecs.length > 0 ? curatedRecs[0].id : null;

  const pov: StrategyPov = {
    situation: parsed.situation,
    leadMoveRecId,
    leadSentence: parsed.leadSentence,
    wins: parsed.wins,
    flags: parsed.flags,
    version,
    generatedAt: new Date().toISOString(),
    editedAt: null,
  };

  saveStrategyPov(workspaceId, pov, hash);
  broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_POV_GENERATED, {});

  log.info({ workspaceId, variant }, 'Strategy POV generated and stored');
  return pov;
}

/** Re-export for route convenience. */
export { getStrategyPov };
