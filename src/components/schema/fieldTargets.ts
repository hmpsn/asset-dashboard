/**
 * Single source of truth: maps ValidationFinding.field strings to
 * canonical Settings deep-link targets. Read by SchemaCompletenessWidget
 * and SchemaSuggester's "fixes available" summary stat.
 */
export interface FieldTarget {
  tab: string;
  focus: string;
  label: string;
}

export const FIELD_TARGETS: Record<string, FieldTarget> = {
  'publisher.logo': { tab: 'features', focus: 'brandLogoUrl', label: 'Publisher logo' },
  'publisher.logo.url': { tab: 'features', focus: 'brandLogoUrl', label: 'Publisher logo URL' },
  'address': { tab: 'business-profile', focus: 'address', label: 'Business address' },
  'telephone': { tab: 'business-profile', focus: 'phone', label: 'Phone number' },
  'sameAs': { tab: 'business-profile', focus: 'socialProfiles', label: 'Social profiles' },
  'foundedDate': { tab: 'business-profile', focus: 'foundedDate', label: 'Founded date' },
};

export const KNOWN_TARGET_FIELDS = new Set(Object.keys(FIELD_TARGETS));

export function fieldToTarget(field: string): FieldTarget | null {
  return FIELD_TARGETS[field] ?? null;
}
