import { createHash } from 'crypto';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { withActiveLocalSeoSlice } from './intelligence/generation-context-builders.js';
import { buildSystemPrompt, getCustomPromptNotes } from './prompt-assembly.js';
import {
  getStrategyPov,
  getStrategyPovHash,
  getStrategyPovVersion,
  saveStrategyPov,
} from './strategy-pov-store.js';
import { loadRecommendations, isCuratedForClient, isActiveRec } from './recommendations.js';
import { strategyPovAIOutputSchema } from './schemas/strategy-pov-schemas.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { createLogger } from './logger.js';
import { assembleMeetingBriefMetrics } from './meeting-brief-generator.js';
import { callNarrativeAI, withContentHashCache } from './narrative-ai.js';
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
 * The rec set the POV is drafted over — VARIANT-AWARE (scaled-review fix #1):
 *
 *   - admin  → the ACTIVE (proposable) set: `isActiveRec`. The admin Drafted-POV editor's
 *     sentences map 1:1 to the BackingMovesQueue cards (Phase-1 cut→sentence contract), and that
 *     queue operates on ACTIVE recs. The POV headline is "the one move I'd bring THIS cycle" =
 *     a proposable move, NOT one already sent. This keeps the admin POV consistent with both the
 *     cut→sentence contract AND the Phase-3 cron's `isActiveRec` eligibility.
 *   - client → the CURATED/sent set: `isCuratedForClient` (clientStatus ∈ {sent, approved,
 *     discussing}). The client reads the POV over what the operator has actually put in front of
 *     them.
 *
 * NOT topRecommendationId (that is the meeting-brief's INVERSE signal). Read-only; never triggers
 * generation. Returns [] when no rec set is cached. The hash already folds in `variant`, so the
 * admin/client caches are distinct even though they draw from different sets.
 */
export function loadPovRecs(workspaceId: string, variant: StrategyPovVariant): Recommendation[] {
  const set = loadRecommendations(workspaceId);
  if (!set) return [];
  const predicate = variant === 'admin' ? isActiveRec : isCuratedForClient;
  return set.recommendations.filter(predicate);
}

/**
 * Pure content hash over the POV rec set (active for admin, curated for client — the variant is
 * folded in, so the two never share a cache). MUST bust when ANY of these change (audit §8
 * cache-completeness):
 *   - the POV rec id-set, the per-rec clientStatus, the per-rec lifecycle,
 *   - the per-rec CONTENT (title / insight / estimatedGain / opportunity value) AND its ORDER,
 *   - the variant (admin vs client — the prose AND the source set differ, so the caches must not collide),
 *   - the regenerate nonce.
 *
 * The prose-edit `version` is DELIBERATELY NOT folded into the hash. Folding version in would let a
 * plain `generate` after an operator edit bust the cache (version bumped) and silently overwrite the
 * operator's edit with a fresh draft. By keying only on rec content + variant + nonce, a plain
 * generate over unchanged content reports POV_UNCHANGED (operator edits survive); a
 * regenerate (nonce present) always redrafts.
 *
 * Order-DEPENDENT: the rec order is part of the prompt (the POV leads with the #1 move), so a
 * reorder must redraft. Each rec carries its index in the signal.
 */
export function buildStrategyPovHash(
  povRecs: Recommendation[],
  variant: StrategyPovVariant,
  regenerateNonce: string | null,
): string {
  // Order is significant — the POV leads with the first move, so a reorder must bust.
  const recSignal = povRecs.map((r, index) => ({
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
 * Build the prompt context string for the POV. Re-points buildBriefPrompt's shape at the
 * variant-appropriate rec set (scaled-review fix #1): the ACTIVE/proposable set for admin (the
 * move the operator would BRING this cycle), the CURATED/sent set for client (what the operator
 * has put in front of them). NOT the insights top-by-impact list. The admin variant carries a
 * dateline (operator-facing weekly cadence); the client variant is EVERGREEN — no time-relative
 * language (the pr-check evergreen guard bans "this week"/"last week"/etc).
 */
export function buildStrategyPovPrompt(
  intel: WorkspaceIntelligence,
  povRecs: Recommendation[],
  variant: StrategyPovVariant,
): string {
  const siteScore = intel.siteHealth?.auditScore ?? 'unknown';
  const winRate = intel.learnings?.overallWinRate != null
    ? `${Math.round(intel.learnings.overallWinRate * 100)}%`
    : 'unknown';
  const priorities = intel.clientSignals?.effectiveBusinessPriorities ?? [];
  const strategy = intel.seoContext?.strategy;
  const wins = intel.learnings?.topWins?.slice(0, 5) ?? [];

  const recLines = povRecs.map(r => {
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

  // The admin POV is drafted over the ACTIVE/proposable moves (the one the operator would bring
  // this cycle); the client POV over the curated/sent moves the operator has already surfaced.
  const movesHeading = variant === 'admin'
    ? 'THE MOVES IN PLAY (the proposable moves you would bring this cycle — draft the POV over THESE, ranked top-first):'
    : 'THE CURATED MOVES (the operator has put these in front of the client — draft the POV over THESE, ranked top-first):';
  const emptyMovesNote = variant === 'admin' ? '(no active moves yet)' : '(no curated moves yet)';

  return `
SITE CONTEXT:
- Site health score: ${siteScore}
- Overall win rate: ${winRate}
- Strategy focus: ${strategy?.siteKeywords?.slice(0, 5).join(', ') ?? 'not set'}
- Client priorities: ${priorities.length > 0 ? priorities.join('; ') : 'not specified'}

${movesHeading}
${recLines || emptyMovesNote}

RECENT WINS:
${winsLines || '(no tracked wins yet)'}

INSTRUCTIONS:
Return a JSON object with exactly these keys:
{
  "situation": "2-3 sentence narrative of where the site stands and where the momentum is",
  "leadSentence": "the single 'the one move I'd bring' sentence — value-first, names the #1 move (the first in the list)",
  "wins": ["2-4 short wins worth saying out loud — client-safe"],
  "flags": ["1-3 short things to flag — client-safe, constructive"]
}

Rules:
- ${datelineNote}
- Never use admin jargon (no 'insight', 'severity', 'impact score', 'rec', 'lifecycle')
- The leadSentence MUST be about the first move in the list (the #1).
- Be specific: name pages, queries, outcomes — not internal scores.
- Lead with momentum; keep it constructive.
`.trim();
}

async function callPovAI(
  workspaceId: string,
  systemPrompt: string,
  prompt: string,
): Promise<StrategyPovAIOutput> {
  return callNarrativeAI({
    workspaceId,
    operation: 'strategy-pov',
    systemPrompt,
    prompt,
    schema: strategyPovAIOutputSchema,
    parserContext: 'strategy-pov',
    maxTokens: 1500,
    logger: log,
    retryDebugMessage: 'strategy-pov-generator: AI returned invalid structured output — retrying',
    retryFailureLogMessage: 'Strategy POV AI returned invalid structured output after retry',
    retryFailureMessage: 'Strategy POV AI returned invalid structured output after retry',
  });
}

export interface GenerateStrategyPovOptions {
  variant?: StrategyPovVariant;
  /** Force regeneration even when the hash matches (POST /regenerate). */
  regenerateNonce?: string | null;
}

/**
 * Generate (or return cached) the strategy POV. Throws POV_UNCHANGED when the content hash matches
 * the stored hash so the route can return the cached POV as a 200 (clone of BRIEF_UNCHANGED).
 * The rec set is VARIANT-AWARE (scaled-review fix #1): admin drafts over the ACTIVE/proposable set
 * (consistent with the cut→sentence contract + the Phase-3 cron's isActiveRec eligibility), client
 * over the curated/sent set. The hash keys on rec content + variant + nonce — NOT the prose-edit
 * version — so a plain generate after an operator edit returns the cached (edited) POV rather than
 * overwriting it; a regenerate (nonce present) always redrafts.
 */
export async function generateStrategyPov(
  workspaceId: string,
  opts: GenerateStrategyPovOptions = {},
): Promise<StrategyPov> {
  const variant: StrategyPovVariant = opts.variant ?? 'admin';
  const regenerateNonce = opts.regenerateNonce ?? null;

  const povRecs = loadPovRecs(workspaceId, variant);
  const version = getStrategyPovVersion(workspaceId);
  const hash = buildStrategyPovHash(povRecs, variant, regenerateNonce);
  const cachedHash = getStrategyPovHash(workspaceId);

  return withContentHashCache({
    workspaceId,
    hash,
    cachedHash,
    unchangedSignal: POV_UNCHANGED,
    unchangedLogMessage: 'Strategy POV unchanged — returning cached POV',
    logger: log,
    canUseCache: regenerateNonce == null,
    run: async () => {
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

      const prompt = buildStrategyPovPrompt(intel, povRecs, variant);
      const parsed = await callPovAI(workspaceId, systemPrompt, prompt);

      const leadMoveRecId = povRecs.length > 0 ? povRecs[0].id : null;

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
    },
  });
}

/** Re-export for route convenience. */
export { getStrategyPov };
