// server/briefing-prompt.ts
//
// TODO(phase-2.5d): the full-narrative AI path is replaced by deterministic
// templates in `server/briefing-templates/` as of Phase 2.5a. The two AI
// passes added in Phase 2.5e (`punchHeroHeadline`, `writeWeeklyOpener`)
// are the ONLY active use of this module. Remove
// `briefingAIResponseSchema` + `buildBriefingInstructions` + the Zod
// schema scaffolding in Phase 2.5d cleanup once the deterministic path
// has soaked. See docs/superpowers/plans/2026-04-29-client-insights-
// redesign.md Phase 2.5d for the full deletion checklist.
//
// Single source of truth for the briefing-specific instructions (Layer 3).
// Voice DNA + guardrails (Layer 2) are injected upstream by buildSystemPrompt()
// in server/prompt-assembly.ts — do NOT duplicate that content here.
//
// The cron (T1.14) composes the final system prompt as:
//   buildSystemPrompt(workspaceId, buildBriefingInstructions({ ... }))
import { z } from 'zod';
import { briefingStorySchema } from './briefing-store.js';
import { callAI } from './ai.js';
import { createLogger } from './logger.js';
import type { BriefingStory } from '../shared/types/briefing.js';

const log = createLogger('briefing-prompt');

export interface BriefingInstructionsInput {
  workspaceName: string;
  weekLabel: string;          // e.g. "Week of April 27"
  candidateBlock?: string;    // already-formatted candidate list (from briefing-candidates.ts)
  learningsContext?: string;  // optional outcome-ai-injection block
}

/**
 * Returns the briefing-specific instructions text. Plain string — the cron
 * passes it as the second argument to buildSystemPrompt(workspaceId, baseInstructions).
 */
export function buildBriefingInstructions(input: BriefingInstructionsInput): string {
  const wsName = input.workspaceName || 'this client';
  const week = input.weekLabel || 'this week';
  return [
    `You are writing the weekly client briefing for ${wsName} (${week}).`,
    `The audience is a busy non-technical business owner who spends 5 minutes or less reading.`,
    `Goal: pick 3-5 stories from the candidate pool below and write a tight editorial briefing.`,
    ``,
    `RULES`,
    `- Pick 3-5 stories total.`,
    `- Tag exactly one story as the headline (isHeadline: true). All others isHeadline: false.`,
    `- Headlines are 5-12 words, plain English, no jargon, no SEO acronyms.`,
    `- Narratives are 1-3 sentences of editorial prose, plain English, outcome-oriented.`,
    `- Each story may include 0-2 supporting metrics as inline badges (e.g. "+12%" / "traffic"). Use only metrics that reinforce the narrative.`,
    `- Categories must be one of: win, risk, opportunity, competitive, period_change.`,
    `- Each story carries a drillIn.page that points to where the data lives in the dashboard.`,
    `- Each story carries sourceRefs[] citing the candidate IDs you used.`,
    `- If nothing material happened this week, write a short "check-in" story about what's currently working — do not return zero stories.`,
    ``,
    `OUTPUT FORMAT`,
    `Return JSON only — no Markdown, no commentary, no code fences. Shape:`,
    `{`,
    `  "stories": [`,
    `    {`,
    `      "id": "s1",`,
    `      "category": "win|risk|opportunity|competitive|period_change",`,
    `      "isHeadline": true,`,
    `      "headline": "string",`,
    `      "narrative": "string",`,
    `      "metrics": [{ "value": "+12%", "label": "traffic" }],`,
    `      "drillIn": { "page": "performance|health|strategy|content-plan|schema-review|roi|brand", "tab": "...", "queryParams": { ... } },`,
    `      "sourceRefs": [{ "type": "analytics_insight|recommendation|audit_delta", "id": "..." }]`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    input.candidateBlock ? `CANDIDATE POOL\n${input.candidateBlock}` : '',
    input.learningsContext ? `\nWORKSPACE LEARNINGS CONTEXT\n${input.learningsContext}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Validates a parsed AI response. Two refinement rules:
 *  - 3-5 stories total (zod's .min/.max)
 *  - exactly one story has isHeadline=true (zod's .refine)
 *
 * The cron parses the AI text via JSON.parse then runs this schema's .parse()
 * on the result. Throws ZodError on invalid shape.
 */
export const briefingAIResponseSchema = z.object({
  stories: z.array(briefingStorySchema).min(3).max(5),
}).refine(
  (val) => val.stories.filter((s) => s.isHeadline).length === 1,
  { message: 'exactly one story must have isHeadline=true' },
);

export type BriefingAIResponse = z.infer<typeof briefingAIResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.5e — Premium AI polish (hero-headline punch + weekly opener).
//
// Both passes are FAIL-SOFT by design: any error (timeout, rate-limit,
// hedge-word violation, word-count violation) returns the original /
// null without throwing. The cron's outer try/catch is a backup, but
// these helpers should never throw on their own.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Banned hedge-word regex — mirrors the pr-check rule scoped to
 * `server/briefing-templates/`. We enforce it on AI-generated output
 * here as a runtime guard so the deterministic-fallback path catches
 * any hedge that slips through despite the prompt instructions.
 */
const HEDGE_WORDS_RE = /\b(potentially|could|may|appears to|suggests|might|seems)\b/i;

/** Word count helper for the headline punch validator. */
function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Strip leading/trailing quotes the model often wraps around terse
 * outputs. Used by both AI passes to normalise responses before we
 * apply length/hedge guards.
 */
function unquote(s: string): string {
  return s.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

/**
 * Phase 2.5e — punch up a deterministic headline. Returns the rewritten
 * headline when the response passes all guards, OR the original headline
 * on any failure path. NEVER throws.
 *
 * Guards applied to the response:
 *   - non-empty after unquoting
 *   - 5–12 words inclusive (matches the spec's hero-headline length rule)
 *   - no banned hedge words
 *   - no embedded newlines (model occasionally returns multi-line output;
 *     we want a single sentence)
 *
 * Cost: ~50 tokens per call (a Sonnet 4 invocation against a tight prompt).
 *
 * @param deterministicHeadline  the template's deterministic headline
 * @param insightHint            short typed-data hint to anchor the rewrite
 *                               (e.g. "ranking_mover: /services/fleet
 *                                #11 → #4, +119 clicks"). Optional.
 * @param workspaceId            for cost attribution.
 */
export async function punchHeroHeadline(
  deterministicHeadline: string,
  insightHint: string | null,
  workspaceId: string,
): Promise<string> {
  if (!deterministicHeadline || deterministicHeadline.trim().length === 0) {
    return deterministicHeadline;
  }
  try {
    const userMsg = [
      `Original headline: ${deterministicHeadline}`,
      insightHint ? `Underlying data: ${insightHint}` : '',
      ``,
      `Rewrite this headline to be 5-12 words, more memorable, definite tense.`,
      `BANNED words: potentially, could, may, appears, suggests, might, seems.`,
      `Return ONLY the rewritten headline as a single line. No quotes, no preamble.`,
    ].filter(Boolean).join('\n');

    const result = await callAI({
      provider: 'anthropic',
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 60,
      temperature: 0.7,
      feature: 'briefing-hero-punch',
      workspaceId,
    });

    const raw = unquote(result.text);
    // Strict multiline guard: a model that returns "line 1\nAlternate: ..."
    // didn't follow instructions. Fail-soft to the deterministic original
    // rather than guessing which line to pick.
    if (raw.includes('\n')) {
      log.debug({ workspaceId, raw: raw.slice(0, 80) }, 'hero-punch: multiline response, falling back');
      return deterministicHeadline;
    }
    const candidate = raw.trim();
    if (!candidate) return deterministicHeadline;
    if (HEDGE_WORDS_RE.test(candidate)) {
      log.debug({ workspaceId, candidate }, 'hero-punch: hedge-word violation, falling back');
      return deterministicHeadline;
    }
    const words = countWords(candidate);
    if (words < 5 || words > 12) {
      log.debug({ workspaceId, words, candidate }, 'hero-punch: word-count violation, falling back');
      return deterministicHeadline;
    }
    return candidate;
  } catch (err) {
    log.debug({ workspaceId, err: String(err) }, 'hero-punch: AI call failed, falling back to deterministic');
    return deterministicHeadline;
  }
}

/**
 * Phase 2.5e — write a one-line "letter from the editor" to render above
 * the dateline on Premium briefings. Returns the line on success, OR null
 * on any failure. NEVER throws.
 *
 * Guards applied to the response:
 *   - ≤25 words (single concise sentence)
 *   - period-terminated (regex /[.!?]$/)
 *   - no banned hedge words
 *   - cites a number from at least one of the input stories (regex /\d/)
 *   - no quotation marks (model sometimes wraps the line in quotes)
 *
 * Cost: ~80 tokens per call.
 *
 * @param stories         the briefing's stories (any subset works; the
 *                        prompt extracts headlines and metric values)
 * @param ctx.workspaceName  for prompt context
 * @param ctx.weekOf      YYYY-MM-DD; used in the system prompt
 * @param ctx.workspaceId for cost attribution
 */
export async function writeWeeklyOpener(
  stories: BriefingStory[],
  ctx: { workspaceName: string; weekOf: string; workspaceId: string },
): Promise<string | null> {
  if (!Array.isArray(stories) || stories.length === 0) return null;
  try {
    const headlines = stories.slice(0, 5).map((s, i) => {
      const metric = s.metrics?.[0]?.value ? ` [${s.metrics[0].value}]` : '';
      return `${i + 1}. ${s.headline}${metric}`;
    }).join('\n');

    const userMsg = [
      `Workspace: ${ctx.workspaceName}`,
      `Week of: ${ctx.weekOf}`,
      ``,
      `Stories in this briefing:`,
      headlines,
      ``,
      `Write a single-line "letter from the editor" intro that frames this week's briefing.`,
      `Rules:`,
      `- 25 words MAX. Period-terminated.`,
      `- Cite a specific number or page from one of the stories above.`,
      `- BANNED words: potentially, could, may, appears, suggests, might, seems.`,
      `- No quotation marks. No bold/italics. Plain prose.`,
      `- Definite tense. Confident editorial voice.`,
      `Return ONLY the line.`,
    ].join('\n');

    const result = await callAI({
      provider: 'anthropic',
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 80,
      temperature: 0.7,
      feature: 'briefing-weekly-opener',
      workspaceId: ctx.workspaceId,
    });

    const candidate = unquote(result.text).split('\n')[0]?.trim() ?? '';
    if (!candidate) return null;
    if (candidate.includes('"') || candidate.includes("'")) {
      log.debug({ workspaceId: ctx.workspaceId, candidate }, 'weekly-opener: contains quotes, falling back');
      return null;
    }
    if (HEDGE_WORDS_RE.test(candidate)) {
      log.debug({ workspaceId: ctx.workspaceId, candidate }, 'weekly-opener: hedge-word violation, falling back');
      return null;
    }
    if (countWords(candidate) > 25) {
      log.debug({ workspaceId: ctx.workspaceId, words: countWords(candidate), candidate }, 'weekly-opener: word-count violation, falling back');
      return null;
    }
    if (!/[.!?]$/.test(candidate)) {
      log.debug({ workspaceId: ctx.workspaceId, candidate }, 'weekly-opener: not period-terminated, falling back');
      return null;
    }
    if (!/\d/.test(candidate)) {
      log.debug({ workspaceId: ctx.workspaceId, candidate }, 'weekly-opener: no number cited, falling back');
      return null;
    }
    return candidate;
  } catch (err) {
    log.debug({ workspaceId: ctx.workspaceId, err: String(err) }, 'weekly-opener: AI call failed, falling back to null');
    return null;
  }
}
