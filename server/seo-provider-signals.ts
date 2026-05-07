// Provider-neutral keyword signal helpers used by SEMRush and DataForSEO flows.

export type TrendDirection = 'rising' | 'declining' | 'stable';

/** Compute trend direction from a 12-month volume array. */
export function trendDirection(trend?: number[]): TrendDirection {
  if (!trend || trend.length < 4) return 'stable';
  const recent = trend.slice(-3).reduce((sum, value) => sum + value, 0) / 3;
  const early = trend.slice(0, 3).reduce((sum, value) => sum + value, 0) / 3;
  if (early === 0) return recent > 0 ? 'rising' : 'stable';
  const change = (recent - early) / early;
  if (change > 0.15) return 'rising';
  if (change < -0.15) return 'declining';
  return 'stable';
}

const SERP_FEATURE_MAP: Record<string, string> = {
  '0': 'featured_snippet',
  '1': 'reviews',
  '2': 'sitelinks',
  '3': 'people_also_ask',
  '4': 'image_pack',
  '5': 'video',
  '6': 'knowledge_panel',
  '7': 'twitter',
  '8': 'news',
  '9': 'shopping',
  '10': 'top_stories',
  '11': 'local_pack',
  '12': 'carousel',
  '13': 'instant_answer',
  '14': 'video_carousel',
  '15': 'thumbnail',
  '16': 'ads_top',
  '17': 'ads_bottom',
};

/** Parse provider SERP feature codes into canonical labels. */
export function parseSerpFeatures(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(',').map(code => SERP_FEATURE_MAP[code.trim()] || code.trim()).filter(Boolean);
}

/** Check whether a keyword has high-value SERP feature opportunities. */
export function hasSerpOpportunity(raw?: string): {
  featuredSnippet: boolean;
  paa: boolean;
  video: boolean;
  localPack: boolean;
} {
  const features = parseSerpFeatures(raw);
  return {
    featuredSnippet: features.includes('featured_snippet'),
    paa: features.includes('people_also_ask'),
    video: features.includes('video') || features.includes('video_carousel'),
    localPack: features.includes('local_pack'),
  };
}
