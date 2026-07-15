// @ds-rebuilt
// Re-export the canonical error extractor so Links mutations preserve server messages
// from ApiError and structured error bodies.
export { extractErrorMessage as mutationErrorMessage } from '../../lib/extractErrorMessage';
