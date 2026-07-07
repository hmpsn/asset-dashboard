// @ds-rebuilt
// Re-export the canonical extractor. It handles Error instances and API response
// shapes such as { error }, { message }, { detail }, and nested body payloads.
export { extractErrorMessage as mutationErrorMessage } from '../../lib/extractErrorMessage';
