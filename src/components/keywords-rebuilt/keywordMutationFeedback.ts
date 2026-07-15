// @ds-rebuilt
// Re-export the canonical error extractor — do NOT fork it. extractErrorMessage handles
// ApiError (which extends Error) plus the non-Error `{error|message|detail|body}` API-response
// shapes a local copy silently misses, degrading a real server message to the generic fallback.
export { extractErrorMessage as mutationErrorMessage } from '../../lib/extractErrorMessage';
