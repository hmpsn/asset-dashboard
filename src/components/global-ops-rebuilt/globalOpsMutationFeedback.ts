// @ds-rebuilt
// Re-export the canonical extractor so Global Ops mutation feedback handles API
// response shapes consistently with the other rebuilt surfaces.
export { extractErrorMessage as mutationErrorMessage } from '../../lib/extractErrorMessage';
