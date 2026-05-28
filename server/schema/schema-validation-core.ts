import { GOOGLE_RICH_RESULT_RULES, GOOGLE_RICH_RESULT_TYPES } from './google-rich-result-rules.js';

export interface GoogleValidationIssue {
  type: string;
  field: string;
  message: string;
}

export interface GoogleValidationTypeEvaluation {
  type: string;
  feature: string;
  eligible: boolean;
  missingFields?: string[];
  errors: GoogleValidationIssue[];
  warnings: GoogleValidationIssue[];
}

export interface GoogleValidationEvaluation {
  publish: {
    status: 'valid' | 'warnings' | 'errors';
    richResults: string[];
    errors: GoogleValidationIssue[];
    warnings: GoogleValidationIssue[];
  };
  byType: GoogleValidationTypeEvaluation[];
}

export interface GooglePublishValidationResult {
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: GoogleValidationIssue[];
  warnings: GoogleValidationIssue[];
}

export interface GoogleRichResultEligibilityResult {
  type: string;
  feature: string;
  eligible: boolean;
  missingFields?: string[];
}

export const REVIEW_RATING_OR_DATE_MISSING_MESSAGE =
  'Missing required property "reviewRating" or "datePublished" for Review';

export function requiredPropertyMissingMessage(type: string, field: string): string {
  return `Missing required property "${field}" for ${type}`;
}

export function recommendedPropertyMissingMessage(type: string, field: string): string {
  return `Missing recommended property "${field}" for ${type}`;
}

function extractGraphNodes(schema: Record<string, unknown>): Array<Record<string, unknown>> {
  const graph = schema['@graph'];
  if (Array.isArray(graph)) return graph as Array<Record<string, unknown>>;
  if (schema['@type']) return [schema as Record<string, unknown>];
  return [];
}

function getNodeTypes(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((v): v is string => typeof v === 'string');
  return [];
}

export function hasCompletePostalAddress(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const address = value as Record<string, unknown>;
  if (address['@type'] !== 'PostalAddress') return false;
  return ['streetAddress', 'addressLocality', 'addressRegion'].every(field =>
    typeof address[field] === 'string' && address[field].trim().length > 0);
}

export function hasSchemaField(node: Record<string, unknown>, field: string): boolean {
  const value = field === 'openingHours'
    ? node.openingHours ?? node.openingHoursSpecification
    : node[field];
  if (field === 'address') return hasCompletePostalAddress(value);
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function hasReviewRatingOrDate(node: Record<string, unknown>): boolean {
  return hasSchemaField(node, 'reviewRating') || hasSchemaField(node, 'datePublished');
}

export function isImageObjectWithUrl(v: unknown): boolean {
  return typeof v === 'object' && v !== null
    && (v as Record<string, unknown>)['@type'] === 'ImageObject'
    && typeof (v as Record<string, unknown>).url === 'string'
    && ((v as Record<string, unknown>).url as string).trim().length > 0;
}

export function isValidArticleImageValue(image: unknown): boolean {
  if (typeof image === 'string') return image.trim().length > 0;
  if (Array.isArray(image)) return image.length > 0 && image.every(item =>
    typeof item === 'string' || isImageObjectWithUrl(item),
  );
  if (typeof image === 'object' && image !== null && (image as Record<string, unknown>)['@type'] === 'ImageObject') {
    return isImageObjectWithUrl(image);
  }
  return false;
}

function evaluateType(node: Record<string, unknown>, type: string): GoogleValidationTypeEvaluation | null {
  const rules = GOOGLE_RICH_RESULT_RULES[type];
  if (!rules) return null;

  const errors: GoogleValidationIssue[] = [];
  const warnings: GoogleValidationIssue[] = [];

  const requiredMissing = rules.required.filter(field => !hasSchemaField(node, field));
  for (const field of requiredMissing) {
    errors.push({ type, field, message: requiredPropertyMissingMessage(type, field) });
  }

  for (const field of rules.recommended) {
    if (!hasSchemaField(node, field)) {
      warnings.push({ type, field, message: recommendedPropertyMissingMessage(type, field) });
    }
  }

  let reviewFieldMissing = false;
  if (type === 'Review' && !hasReviewRatingOrDate(node)) {
    reviewFieldMissing = true;
    errors.push({
      type,
      field: 'reviewRating',
      message: REVIEW_RATING_OR_DATE_MISSING_MESSAGE,
    });
  }

  // Strictness alignment: if an Article/BlogPosting image value exists, it must be structurally valid.
  // This closes the contradiction where publish passed while lean rejected malformed ImageObject values.
  let articleImageInvalid = false;
  if ((type === 'Article' || type === 'BlogPosting') && node.image !== undefined && !isValidArticleImageValue(node.image)) {
    articleImageInvalid = true;
    errors.push({
      type,
      field: 'image',
      message: `Invalid "image" value for ${type}; expected URL string, array of URLs/ImageObjects, or ImageObject with non-empty url`,
    });
  }

  const missingFields = [
    ...requiredMissing,
    ...(reviewFieldMissing ? ['reviewRating'] : []),
    ...(articleImageInvalid && !requiredMissing.includes('image') ? ['image'] : []),
  ];
  const eligible = missingFields.length === 0;

  return {
    type,
    feature: rules.feature,
    eligible,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    errors,
    warnings,
  };
}

export function evaluateGoogleSchema(schema: Record<string, unknown>): GoogleValidationEvaluation {
  const nodes = extractGraphNodes(schema);
  const publishErrors: GoogleValidationIssue[] = [];
  const publishWarnings: GoogleValidationIssue[] = [];
  const richResults: string[] = [];
  const byType: GoogleValidationTypeEvaluation[] = [];

  for (const node of nodes) {
    const types = getNodeTypes(node);
    if (types.length === 0) continue;

    const seenErrorFields = new Set<string>();
    const seenWarningFields = new Set<string>();

    for (const type of types) {
      const evalResult = evaluateType(node, type);
      if (!evalResult) continue;

      byType.push(evalResult);

      for (const err of evalResult.errors) {
        if (seenErrorFields.has(err.field)) continue;
        seenErrorFields.add(err.field);
        publishErrors.push(err);
      }

      for (const warn of evalResult.warnings) {
        if (seenWarningFields.has(warn.field)) continue;
        seenWarningFields.add(warn.field);
        publishWarnings.push(warn);
      }

      if (GOOGLE_RICH_RESULT_TYPES.has(type) && evalResult.eligible) {
        richResults.push(type);
      }
    }
  }

  const status: 'valid' | 'warnings' | 'errors' =
    publishErrors.length > 0 ? 'errors' :
    publishWarnings.length > 0 ? 'warnings' :
    'valid';

  return {
    publish: {
      status,
      richResults,
      errors: publishErrors,
      warnings: publishWarnings,
    },
    byType,
  };
}

export function publishValidationFromEvaluation(
  evaluation: GoogleValidationEvaluation,
): GooglePublishValidationResult {
  return evaluation.publish;
}

export function richResultEligibilityFromEvaluation(
  evaluation: GoogleValidationEvaluation,
): GoogleRichResultEligibilityResult[] {
  return evaluation.byType
    .filter(result => GOOGLE_RICH_RESULT_TYPES.has(result.type))
    .map(result => ({
      type: result.type,
      feature: result.feature,
      eligible: result.eligible,
      missingFields: result.missingFields,
    }));
}
