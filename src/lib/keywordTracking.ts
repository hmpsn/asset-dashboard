export function keywordTrackingKey(keyword: string | null | undefined): string {
  return (keyword ?? '').toLowerCase().trim();
}
