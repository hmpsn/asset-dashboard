// server/briefing-prompt.ts
//
// TODO(phase-2.5d): the full-narrative AI path is replaced by deterministic
// templates in `server/briefing-templates/` as of Phase 2.5a. Only
// `punchHeroHeadline` and `writeWeeklyOpener` (added in Phase 2.5c) remain
// in active use. Remove `briefingAIResponseSchema` + `buildBriefingInstructions`
// + the Zod schema scaffolding in Phase 2.5d cleanup once the deterministic
// path has soaked. See docs/superpowers/plans/2026-04-29-client-insights-
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
