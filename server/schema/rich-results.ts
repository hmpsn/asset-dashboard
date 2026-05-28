/**
 * Rich-result eligibility checks per Google's documented requirements.
 * Standalone module — extracted from schema-suggester.ts to break a circular
 * import (generator.ts → schema-suggester.ts → schema/index.ts → generator.ts).
 *
 * The data here is purely Google's eligibility matrix (feature name + required
 * fields per @type), so it has no dependency on the lean generator pipeline.
 */

import { evaluateGoogleSchema, richResultEligibilityFromEvaluation } from './schema-validation-core.js';

export interface RichResultEligibility {
  type: string;
  eligible: boolean;
  feature: string;
  missingFields?: string[];
}

/**
 * Check which schema types in a @graph qualify for Google Rich Results,
 * and what fields are missing for those that don't yet qualify.
 */
export function checkRichResultsEligibility(schema: Record<string, unknown>): RichResultEligibility[] {
  return richResultEligibilityFromEvaluation(evaluateGoogleSchema(schema));
}
