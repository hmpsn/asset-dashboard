// @ds-rebuilt
// Re-export the canonical error extractor so local API wrappers preserve ApiError
// bodies and non-Error response shapes.
export { extractErrorMessage as mutationErrorMessage } from '../../lib/extractErrorMessage';
