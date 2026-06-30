// server/briefing-templates/index.ts
//
// Dispatcher for deterministic briefing-story templates (Phase 2.5a).
//
// Each template module owns ONE InsightType (or, in the case of
// content-gap, the ContentGap shape from `keywordStrategy.contentGaps[]`).
// This file exposes a single function per input type that the cron uses
// to project typed insight data into a `BriefingStory` — no AI, no
// paraphrase, just data → story.
//
// Voice rules (enforced by pr-check rule "Banned hedge words"): each
// template MUST cite a number from typed payload data and avoid the
// banned hedges (potentially / could / may / appears to / suggests /
// might / seems). See docs/superpowers/specs/2026-04-29-client-insights-
// redesign-design.md §5 for the full voice contract.

import type { AnalyticsInsight, InsightType } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { ContentGap } from '../../shared/types/workspace.js';
import {
  buildBriefingContentGapStory,
  buildBriefingInsightStory,
  SUPPORTED_BRIEFING_INSIGHT_TYPES,
} from '../signal-story-registry.js';
import type { TemplateContext } from './context.js';

export type { TemplateContext } from './context.js';

// Phase 2.5c — weCalledIt is still dispatched separately because its input is
// a TrackedAction + ActionOutcome, not an AnalyticsInsight row. Re-exported
// here so the cron can dispatch wci-prefixed candidates from a single entrypoint.
export { buildStoryFromWeCalledIt, type WeCalledItInput } from './we-called-it.js';

/**
 * Project an `AnalyticsInsight` to a `BriefingStory`. Returns `null` when:
 *   - The insight type has no registered template, OR
 *   - The template rejects the insight (e.g., required fields missing,
 *     eligibility bands not met).
 *
 * The cron's selection layer is the upstream gatekeeper for materiality
 * scoring + category mix — this function is purely a 1:1 projection.
 */
export function buildStoryFromInsight(
  insight: AnalyticsInsight,
  context: TemplateContext,
): BriefingStory | null {
  return buildBriefingInsightStory(insight, context);
}

/**
 * Project a `ContentGap` (from `keywordStrategy.contentGaps[]`) to a
 * `BriefingStory`. Separate signature from `buildStoryFromInsight` because
 * gaps live in a different data store (the workspace-level keyword
 * strategy blob), not `analytics_insights`.
 */
export function buildStoryFromContentGap(
  gap: ContentGap,
  context: TemplateContext,
): BriefingStory | null {
  return buildBriefingContentGapStory(gap, context);
}

/**
 * List of every InsightType that has a registered template. Used by tests
 * to assert no insight type silently misses coverage when added.
 */
export const SUPPORTED_INSIGHT_TYPES: readonly InsightType[] = SUPPORTED_BRIEFING_INSIGHT_TYPES;
