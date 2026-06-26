/**
 * Zero out AI-hallucinated keyword metrics when no SEMRush data was available.
 * Call after JSON.parse of any AI keyword analysis response.
 */
export function applyBulkKeywordGuards(
  analysis: Record<string, unknown>,
  semrushBlock: string,
): void {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return;
  if (!semrushBlock) {
    analysis.keywordDifficulty = 0;
    analysis.monthlyVolume = 0;
  }
}
