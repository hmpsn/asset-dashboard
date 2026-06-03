/**
 * Zod schemas for the SEO Generation Quality P3 closed-set named AI operations.
 *
 *   - `keyword-page-assignment` (OP1): page→keyword assignment from a closed
 *     candidate set. Because OpenAI `json_object` mode requires a top-level OBJECT,
 *     the AI returns `{ assignments: [...] }` (a bare array is not valid json_object).
 *   - `keyword-site-synthesis` (OP2): site-level strategy synthesis matching the
 *     existing master-prompt contract (`siteKeywords`, `opportunities`, `contentGaps`,
 *     `quickWins`) — we validate only the AI-returned subset (no pageMap).
 *
 * Field names are cross-referenced against the SOURCE interfaces so a wrong name
 * cannot silently `safeParse`-fail to empty (the exact failure mode P3 kills):
 *   - OP1 item ↔ the `PageMapping` local type in `keyword-strategy-ai-synthesis.ts`
 *     (`pagePath`, `pageTitle`, `primaryKeyword`, `secondaryKeywords`, `searchIntent`)
 *     plus `PageKeywordMap` in `shared/types/workspace.ts`. `primaryKeywordSourceId`
 *     is the P3 closed-set id (the normalized keyword) the AI selected from.
 *   - OP2 `contentGaps` item ↔ `ContentGap`/`StrategyContentGap` (`topic`,
 *     `targetKeyword`, `intent`, `priority`, `rationale`, `suggestedPageType`,
 *     `competitorProof`).
 *   - OP2 `quickWins` item ↔ `QuickWin`/`StrategyQuickWin` (`pagePath`, `action`,
 *     `estimatedImpact`, `rationale`).
 *
 * Callers MUST use `.safeParse` (NOT a throwing parser) and capture `.error.issues`
 * for the retry-once repair turn. See docs/rules/ai-operation-contracts.md.
 */
import { z } from 'zod';

// ── OP1: keyword-page-assignment ────────────────────────────────────────────

/** One page→keyword assignment item. Mirrors the `PageMapping` local type + the
 * P3 closed-set source id. `secondaryKeywords` defaults to [] so a missing key
 * degrades to empty rather than failing the whole item. */
export const pageAssignmentItemSchema = z.object({
  pagePath: z.string(),
  pageTitle: z.string(),
  primaryKeyword: z.string(),
  /** The closed-set id the AI selected — the normalized keyword (source-row id). */
  primaryKeywordSourceId: z.string(),
  secondaryKeywords: z.array(z.string()).default([]),
  searchIntent: z.string().optional(),
  justification: z.string().optional(),
});

export type PageAssignmentItem = z.infer<typeof pageAssignmentItemSchema>;

/** Top-level object the AI returns for OP1 (json_object mode requires an object). */
export const pageAssignmentResponseSchema = z.object({
  assignments: z.array(pageAssignmentItemSchema),
});

export type PageAssignmentResponse = z.infer<typeof pageAssignmentResponseSchema>;

// ── OP2: keyword-site-synthesis ─────────────────────────────────────────────

/** Content-gap item — validates the AI-returned subset of `ContentGap`. The wider
 * enrichment fields (volume/difficulty/serpFeatures/etc.) are added deterministically
 * downstream, never by the AI, so they are not part of the validated subset. */
export const siteSynthesisContentGapSchema = z.object({
  topic: z.string(),
  targetKeyword: z.string(),
  intent: z.string().optional(),
  priority: z.string().optional(),
  rationale: z.string().optional(),
  suggestedPageType: z.string().optional(),
  competitorProof: z.string().optional(),
  /** P3 closed-set id (the normalized candidate keyword) the AI selected from. */
  targetKeywordSourceId: z.string().optional(),
});

/** Quick-win item — validates the AI-returned subset of `QuickWin`. */
export const siteSynthesisQuickWinSchema = z.object({
  pagePath: z.string(),
  action: z.string(),
  estimatedImpact: z.string().optional(),
  rationale: z.string().optional(),
});

/** Keyword-fix item — validates the AI-returned subset of `StrategyKeywordFix`. */
export const siteSynthesisKeywordFixSchema = z.object({
  pagePath: z.string(),
  newPrimaryKeyword: z.string(),
});

/** Top-level OP2 object. Matches the existing master-prompt contract; every field
 * defaults so a partially-populated-but-valid response never fails the whole parse. */
export const siteSynthesisResponseSchema = z.object({
  siteKeywords: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  contentGaps: z.array(siteSynthesisContentGapSchema).default([]),
  quickWins: z.array(siteSynthesisQuickWinSchema).default([]),
  keywordFixes: z.array(siteSynthesisKeywordFixSchema).default([]),
});

export type SiteSynthesisResponse = z.infer<typeof siteSynthesisResponseSchema>;
