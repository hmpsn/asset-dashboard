/**
 * Rich-result eligibility checks per Google's documented requirements.
 * Standalone module — extracted from schema-suggester.ts to break a circular
 * import (generator.ts → schema-suggester.ts → schema/index.ts → generator.ts).
 *
 * The data here is purely Google's eligibility matrix (feature name + required
 * fields per @type), so it has no dependency on the lean generator pipeline.
 */

export interface RichResultEligibility {
  type: string;
  eligible: boolean;
  feature: string;
  missingFields?: string[];
}

const RICH_RESULTS_ELIGIBLE: Record<string, { feature: string; required: string[] }> = {
  FAQPage:       { feature: 'FAQ accordion in search',        required: ['mainEntity'] },
  HowTo:         { feature: 'How-to steps in search',         required: ['name', 'step'] },
  VideoObject:   { feature: 'Video carousel',                 required: ['name', 'uploadDate', 'thumbnailUrl'] },
  Article:       { feature: 'Article rich result',            required: ['headline', 'datePublished', 'author', 'image'] },
  NewsArticle:   { feature: 'Article rich result',            required: ['headline', 'datePublished', 'author', 'image'] },
  BlogPosting:   { feature: 'Article rich result',            required: ['headline', 'datePublished', 'author', 'image'] },
  Product:       { feature: 'Product rich result',            required: ['name', 'offers'] },
  LocalBusiness: { feature: 'Local business panel',           required: ['name', 'address'] },
  Event:         { feature: 'Event listing',                  required: ['name', 'startDate', 'location'] },
  Recipe:        { feature: 'Recipe rich result',             required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'] },
  JobPosting:    { feature: 'Job listing in search',          required: ['title', 'hiringOrganization', 'jobLocation', 'datePosted', 'description'] },
  BreadcrumbList: { feature: 'Breadcrumb trail in search',    required: ['itemListElement'] },
  Course:        { feature: 'Course info in search',          required: ['name', 'description', 'provider'] },
  Review:        { feature: 'Review rich result',             required: ['itemReviewed', 'reviewRating', 'author'] },
  ProfilePage:   { feature: 'Profile page in search',         required: ['mainEntity'] },
  MedicalOrganization: { feature: 'Medical business panel',   required: ['name', 'address'] },
  FinancialService:    { feature: 'Financial service panel',  required: ['name', 'address'] },
  Speakable:     { feature: 'Speakable for voice assistants', required: ['cssSelector'] },
};

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
      if (!type || !RICH_RESULTS_ELIGIBLE[type]) continue;

      const { feature, required } = RICH_RESULTS_ELIGIBLE[type];
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
