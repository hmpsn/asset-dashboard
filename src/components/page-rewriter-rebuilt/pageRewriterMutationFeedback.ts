// @ds-rebuilt
// Re-export the canonical error extractor. ApiError bodies and non-Error API
// shapes must resolve to the server's message instead of a generic fallback.
export { extractErrorMessage as mutationErrorMessage } from '../../lib/extractErrorMessage';
