/**
 * Public exports for the lean schema package.
 */
export { generateLeanSchema } from './generator.js';
export type { LeanGeneratorInput, LeanGeneratorOutput } from './generator.js';
export { classifyPage } from './classifier.js';
export type { ClassifiedPage, PageKind } from './classifier.js';
export { extractPageData } from './data-sources.js';
export type { PageData, PageMetaInput, WorkspaceSchemaInput, BusinessProfile } from './data-sources.js';
export { validateLeanSchema } from './validator.js';
