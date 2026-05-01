/**
 * Rich-result eligibility checks per Google's documented requirements.
 * Standalone module — extracted from schema-suggester.ts to break a circular
 * import (generator.ts → schema-suggester.ts → schema/index.ts → generator.ts).
 *
 * The data here is purely Google's eligibility matrix (feature name + required
 * fields per @type), so it has no dependency on the lean generator pipeline.
 */

import { GOOGLE_RICH_RESULT_RULES, GOOGLE_RICH_RESULT_TYPES } from './google-rich-result-rules.js';

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
  const graph = schema['@graph'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(graph)) return [];

  const results: RichResultEligibility[] = [];

  for (const node of graph) {
    const rawType = node['@type'];
    const types = Array.isArray(rawType) ? rawType as string[] : (rawType ? [rawType as string] : []);
    for (const type of types) {
      if (!type || !GOOGLE_RICH_RESULT_TYPES.has(type) || !GOOGLE_RICH_RESULT_RULES[type]) continue;

      const { feature, required } = GOOGLE_RICH_RESULT_RULES[type];
      const missingFields = required.filter(field => {
        const val = node[field];
        if (val === undefined || val === null) return true;
        if (Array.isArray(val) && val.length === 0) return true;
        if (typeof val === 'string' && val.trim() === '') return true;
        return false;
      });

      results.push({
        type,
        feature,
        eligible: missingFields.length === 0,
        missingFields: missingFields.length > 0 ? missingFields : undefined,
      });
    }
  }

  return results;
}
