// @ds-rebuilt
import { extractErrorMessage } from '../../lib/extractErrorMessage';

export function mutationErrorMessage(error: unknown, fallback: string): string {
  return extractErrorMessage(error, fallback);
}
