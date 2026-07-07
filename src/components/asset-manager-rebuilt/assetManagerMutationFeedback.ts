// @ds-rebuilt
// Re-export the canonical error extractor so asset actions preserve ApiError
// messages and non-Error `{ error | message | detail }` response bodies.
export { extractErrorMessage as mutationErrorMessage } from '../../lib/extractErrorMessage';
