/**
 * Compatibility facade for legacy helper imports.
 * New production code should import from the owning leaf modules below.
 */
export { sleep } from './utils/async.js';
export {
  matchPagePath,
  findPageMapEntry,
  findPageMapEntryForPage,
  resolvePageAddress,
  resolvePagePath,
  tryResolvePagePath,
  matchGscUrlToPath,
  normalizePageUrl,
  matchPageIdentity,
  findPageMapEntryByIdentity,
  toInsightPageId,
  toAuditFindingPageId,
} from './utils/page-address.js';
export {
  decodeEntities,
  sanitizeString,
  sanitizeErrorMessage,
  sanitizeForPromptInjection,
  sanitizeInlinePromptText,
  sanitizeQueryForPrompt,
  stripHtmlToText,
  stripCodeFences,
  slugify,
} from './utils/text.js';
export {
  validateEnum,
  parseDateRange,
  parseDateRangeStrict,
} from './utils/request-validation.js';
export { applyBulkKeywordGuards } from './utils/keyword-analysis-guards.js';
export {
  CRITICAL_CHECKS_SET,
  MODERATE_CHECKS_SET,
  applySuppressionsToAudit,
  type AuditSuppression,
} from './seo-audit-suppressions.js';
export { buildSchemaContext } from './schema/context-builder.js';
export { getAuditTrafficForWorkspace } from './audit-traffic.js';
export { readEnvFile, writeEnvFile } from './env-file.js';
export { fetchPublishedHtml } from './published-html.js';
