import { keywordComparisonKey } from '../../shared/keyword-normalization';

export function keywordTrackingKey(keyword: string | null | undefined): string {
  return keywordComparisonKey(keyword);
}
