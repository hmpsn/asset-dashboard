import { createHash } from 'crypto';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { buildSystemPrompt, getCustomPromptNotes } from './prompt-assembly.js';
import {
  getStrategyPov,
  getStrategyPovHash,
  saveStrategyPovIfVersion,
} from './strategy-pov-store.js';
import { loadRecommendations, isCuratedForClient, isActiveRec } from './recommendations.js';
import { strategyPovAIOutputSchema } from './schemas/strategy-pov-schemas.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { createLogger } from './logger.js';
import { callNarrativeAI } from './narrative-ai.js';
import type { WorkspaceIntelligence, IntelligenceSlice } from '../shared/types/intelligence.js';
import type { TopWin } from '../shared/types/outcome-tracking.js';
import type { Recommendation } from '../shared/types/recommendations.js';
import type { StrategyPov, StrategyPovAIOutput, StrategyPovVariant } from '../shared/types/strategy-pov.js';

const log = createLogger('strategy-pov-generator');

/** Exact slices rendered by buildStrategyPovPrompt. Do not assemble unused context. */
const POV_SLICES = [
  'seoContext', 'learnings', 'siteHealth', 'clientSignals',
] as const satisfies readonly IntelligenceSlice[];

/** Control-flow signal: caller (route) catches this and returns the cached POV as a 200. */
export const POV_UNCHANGED = 'POV_UNCHANGED';

/**
 * Control-flow signal: current effective evidence/voice differs, but a normal
 * generation must preserve an operator edit. The route returns the last-good POV
 * with refreshAvailable=true; explicit Regenerate is the replacement authority.
 */
export const POV_REFRESH_AVAILABLE = 'POV_REFRESH_AVAILABLE';

/**
 * Control-flow signal: another generation established the row while this call
 * was assembling or saving. This is cache-equivalent, not evidence of an
 * operator edit, so callers must never label it `editPreserved`.
 */
export const POV_GENERATION_SUPERSEDED = 'POV_GENERATION_SUPERSEDED';

function verifiedTrackedOutcomes(intel: WorkspaceIntelligence): TopWin[] {
  if (intel.learnings?.availability !== 'ready') return [];
  return (intel.learnings.topWins ?? [])
    .filter(win => win.attribution !== 'not_acted_on')
    .slice(0, 5);
}

function formatTrackedOutcome(win: TopWin): string {
  const keyword = win.targetKeyword ? ` (${win.targetKeyword})` : '';
  const outcome = `${win.actionType} on ${win.pageUrl ?? 'the site'}${keyword}`;
  if (win.attribution === 'platform_executed') {
    return `- Platform executed: ${outcome}`;
  }
  if (win.attribution === 'externally_executed') {
    return `- Externally executed by the client or another team (we identified and tracked the outcome; do not claim we shipped it): ${outcome}`;
  }
  // Runtime defense for legacy/malformed slice data. `not_acted_on` is filtered
  // above, but an unknown attribution must not silently become a platform claim.
  return `- Execution attribution unavailable (do not claim who implemented it): ${outcome}`;
}

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
 * NOT topRecommendationId (that was the retired meeting-brief's INVERSE signal). Read-only; never triggers
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
 * Canonical fingerprint of the exact effective inputs sent to the model.
 *
 * Hashing the final system/user prompts guarantees that every rendered evidence
 * field, custom prompt note, effective voice instruction, recommendation order,
 * and variant-specific rule participates without separately maintaining a
 * drift-prone evidence list. The force-regeneration nonce is intentionally not
 * accepted here: it bypasses the cache but never contaminates the stored hash.
 */
export function buildStrategyPovHash(
  systemPrompt: string,
  userPrompt: string,
  variant: StrategyPovVariant,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ variant, systemPrompt, userPrompt }))
    .digest('hex');
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
  const learningsReady = intel.learnings?.availability === 'ready';
  const winRate = learningsReady && intel.learnings?.overallWinRate != null
    ? `${Math.round(intel.learnings.overallWinRate * 100)}%`
    : 'unavailable';
  const priorities = intel.clientSignals?.effectiveBusinessPriorities ?? [];
  const strategy = intel.seoContext?.strategy;
  const wins = verifiedTrackedOutcomes(intel);
  const effectiveVoice = intel.seoContext?.effectiveBrandVoiceBlock?.trim() ?? '';

  const recLines = povRecs.map(r => {
    const value = r.opportunity?.value ?? r.impactScore;
    const kw = r.targetKeyword ? ` [${r.targetKeyword}]` : '';
    return `- id=${r.id} (${r.type}, ${r.priority}, value=${value})${kw}: ${r.title} — ${r.insight}`;
  }).join('\n');

  const winsLines = wins.map(formatTrackedOutcome).join('\n');
  const voiceSection = effectiveVoice
    ? `\n\nEFFECTIVE BRAND VOICE:\n${effectiveVoice}`
    : '';

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

TRACKED OUTCOMES:
${winsLines || '(no verified workspace outcomes available)'}${voiceSection}

INSTRUCTIONS:
Return a JSON object with exactly these keys:
{
  "situation": "2-3 sentence narrative of where the site stands and where the momentum is",
  "leadSentence": "the single 'the one move I'd bring' sentence — value-first, names the #1 move (the first in the list)",
  "wins": ["0-4 short verified outcomes worth saying out loud — client-safe; use [] when none are provided"],
  "flags": ["1-3 short things to flag — client-safe, constructive"],
  "verdictHeadline": "short, value-first admin verdict headline over the same evidence"
}

Rules:
- ${datelineNote}
- Never use admin jargon (no 'insight', 'severity', 'impact score', 'rec', 'lifecycle')
- The leadSentence MUST be about the first move in the list (the #1).
- The verdictHeadline is operator-facing, value-first, and drafted from the evidence — do not hard-code or template generic client copy.
- The wins array MAY be empty. Only restate TRACKED OUTCOMES; use [] when none are provided. Never invent a win or infer one from a recommendation.
- Preserve execution attribution: externally executed outcomes mean we identified or called the opportunity and implementation happened on the client's side; never say or imply we shipped them.
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

interface StrategyPovInputs {
  povRecs: Recommendation[];
  systemPrompt: string;
  userPrompt: string;
  canonicalHash: string;
  allowWins: boolean;
}

function povBaseInstructions(variant: StrategyPovVariant): string {
  return `
You are a strategic SEO advisor drafting a curated point of view for ${variant === 'client' ? 'the client' : 'the operator review'}. Your output must be valid JSON matching the StrategyPovAIOutput interface exactly.

Write a confident, value-first narrative over the operator's variant-appropriate moves. No admin jargon, no internal scoring language. Lead with momentum, name the single best move, draft a short admin verdict headline from the evidence, and keep wins and flags short and client-safe.
`.trim();
}

/** Assemble one canonical set of exact effective inputs for generation and freshness checks. */
async function assembleStrategyPovInputs(
  workspaceId: string,
  variant: StrategyPovVariant,
): Promise<StrategyPovInputs> {
  const povRecs = loadPovRecs(workspaceId, variant);
  const intel = await buildWorkspaceIntelligence(workspaceId, { slices: POV_SLICES });
  const customPromptNotes = getCustomPromptNotes(workspaceId);
  const systemPrompt = buildSystemPrompt(
    workspaceId,
    povBaseInstructions(variant),
    customPromptNotes,
  );
  const userPrompt = buildStrategyPovPrompt(intel, povRecs, variant);
  return {
    povRecs,
    systemPrompt,
    userPrompt,
    canonicalHash: buildStrategyPovHash(systemPrompt, userPrompt, variant),
    allowWins: verifiedTrackedOutcomes(intel).length > 0,
  };
}

/**
 * Compare the stored canonical fingerprint with the prompts that would be used
 * now. This never calls AI or mutates the POV store. A missing POV is not stale.
 */
export async function getStrategyPovRefreshAvailable(
  workspaceId: string,
  variant: StrategyPovVariant = 'admin',
): Promise<boolean> {
  if (!getStrategyPov(workspaceId)) return false;
  const inputs = await assembleStrategyPovInputs(workspaceId, variant);
  return getStrategyPovHash(workspaceId) !== inputs.canonicalHash;
}

/**
 * Generate (or return cached) the strategy POV. Throws POV_UNCHANGED when the exact effective
 * prompt fingerprint matches the stored hash so the route can return the cached POV as a 200.
 * The rec set is VARIANT-AWARE (scaled-review fix #1): admin drafts over the ACTIVE/proposable set
 * (consistent with the cut→sentence contract + the Phase-3 cron's isActiveRec eligibility), client
 * over the curated/sent set. A normal generate never replaces an operator edit when effective
 * inputs change: it throws POV_REFRESH_AVAILABLE instead. A regenerate nonce bypasses cache only;
 * the stored fingerprint remains the canonical nonce-free hash. The conditional write rejects a
 * result when an operator edit bumped the row version during the async AI call.
 */
async function generateStrategyPovOnce(
  workspaceId: string,
  variant: StrategyPovVariant,
  forceRegenerate: boolean,
): Promise<StrategyPov> {
  const observed = getStrategyPov(workspaceId);
  const expectedVersion = observed?.version ?? null;
  const inputs = await assembleStrategyPovInputs(workspaceId, variant);

  // Re-read after intelligence/prompt assembly. An edit may have landed during
  // that await; do not spend an AI call against a snapshot we can no longer save.
  const current = getStrategyPov(workspaceId);
  if ((current?.version ?? null) !== expectedVersion) {
    const signal = expectedVersion !== null && current !== null
      ? POV_REFRESH_AVAILABLE
      : POV_GENERATION_SUPERSEDED;
    throw new Error(signal);
  }

  const cachedHash = getStrategyPovHash(workspaceId);
  if (!forceRegenerate && cachedHash === inputs.canonicalHash) {
    log.debug({ workspaceId }, 'Strategy POV unchanged — returning cached POV');
    throw new Error(POV_UNCHANGED);
  }
  if (!forceRegenerate && current?.editedAt) {
    log.debug({ workspaceId }, 'Strategy POV inputs changed — preserving operator edit');
    throw new Error(POV_REFRESH_AVAILABLE);
  }

  const parsed = await callPovAI(workspaceId, inputs.systemPrompt, inputs.userPrompt);
  const leadMoveRecId = inputs.povRecs.length > 0 ? inputs.povRecs[0].id : null;
  const pov: StrategyPov = {
    situation: parsed.situation,
    leadMoveRecId,
    leadSentence: parsed.leadSentence,
    // Prompt instructions are necessary but not sufficient for an honesty
    // boundary. If the workspace has no verified tracked outcome evidence, an
    // invented model win cannot cross into the durable POV.
    wins: inputs.allowWins ? parsed.wins : [],
    flags: parsed.flags,
    ...(parsed.verdictHeadline ? { verdictHeadline: parsed.verdictHeadline } : {}),
    version: expectedVersion ?? 0,
    generatedAt: new Date().toISOString(),
    editedAt: null,
  };

  if (!saveStrategyPovIfVersion(workspaceId, pov, inputs.canonicalHash, expectedVersion)) {
    const latest = getStrategyPov(workspaceId);
    const signal = expectedVersion !== null && latest !== null && latest.version !== expectedVersion
      ? POV_REFRESH_AVAILABLE
      : POV_GENERATION_SUPERSEDED;
    log.debug({ workspaceId, signal }, 'Strategy POV AI result discarded — row authority changed');
    throw new Error(signal);
  }

  broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_POV_GENERATED, {});
  log.info({ workspaceId, variant }, 'Strategy POV generated and stored');
  return pov;
}

interface StrategyPovFlightState {
  normal?: Promise<StrategyPov>;
  force?: Promise<StrategyPov>;
}

/** Per-process, per-workspace+variant generation coordination. */
const strategyPovFlights = new Map<string, StrategyPovFlightState>();

function registerStrategyPovFlight(
  key: string,
  state: StrategyPovFlightState,
  mode: 'normal' | 'force',
  flight: Promise<StrategyPov>,
): Promise<StrategyPov> {
  state[mode] = flight;
  const cleanup = () => {
    if (state[mode] === flight) state[mode] = undefined;
    if (!state.normal && !state.force && strategyPovFlights.get(key) === state) {
      strategyPovFlights.delete(key);
    }
  };
  // Attach cleanup to both outcomes without creating an unhandled rejected
  // promise (the returned caller-facing flight keeps the original outcome).
  void flight.then(cleanup, cleanup);
  return flight;
}

/**
 * Generate (or return cached) with single-flight authority:
 * - concurrent normal callers share one normal flight;
 * - concurrent force callers share one force flight;
 * - a force request behind normal queues and runs after it, even if normal fails;
 * - a normal request while force is active shares the stronger force result.
 */
export function generateStrategyPov(
  workspaceId: string,
  opts: GenerateStrategyPovOptions = {},
): Promise<StrategyPov> {
  const variant: StrategyPovVariant = opts.variant ?? 'admin';
  const forceRegenerate = opts.regenerateNonce != null;
  const key = `${workspaceId}:${variant}`;
  let state = strategyPovFlights.get(key);
  if (!state) {
    state = {};
    strategyPovFlights.set(key, state);
  }

  if (forceRegenerate) {
    if (state.force) return state.force;
    if (state.normal) {
      const normal = state.normal;
      const queuedForce = normal.then(
        () => generateStrategyPovOnce(workspaceId, variant, true),
        () => generateStrategyPovOnce(workspaceId, variant, true),
      );
      return registerStrategyPovFlight(key, state, 'force', queuedForce);
    }
    return registerStrategyPovFlight(
      key,
      state,
      'force',
      generateStrategyPovOnce(workspaceId, variant, true),
    );
  }

  if (state.force) return state.force;
  if (state.normal) return state.normal;
  return registerStrategyPovFlight(
    key,
    state,
    'normal',
    generateStrategyPovOnce(workspaceId, variant, false),
  );
}

/** Re-export for route convenience. */
export { getStrategyPov };
