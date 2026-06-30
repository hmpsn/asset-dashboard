import {
  PAGE_TYPE_SCHEMA_MAP,
  type SchemaPageType,
} from './role-type-registry.js';

/**
 * Resolve the combined primary + secondary Schema.org types for a template page type.
 * Used by content templates, matrices, and schema pre-generation without importing
 * their higher-level orchestrators.
 */
export function getSchemaTypesForTemplate(templatePageType: string): string[] {
  const mapped = PAGE_TYPE_SCHEMA_MAP[templatePageType as SchemaPageType];
  if (!mapped) return [];
  return [...mapped.primary, ...mapped.secondary];
}
