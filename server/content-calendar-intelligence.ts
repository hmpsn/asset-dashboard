/**
 * Content calendar intelligence — suggests publish/refresh dates
 * based on analytics intelligence insights (decay, quick wins).
 */

interface DecayInsight {
  pageId: string;
  deltaPercent: number;
  currentClicks: number;
}

interface QuickWinInsight {
  pageUrl: string;
  query: string;
  estimatedTrafficGain: number;
}

interface PublishSuggestion {
  pageUrl: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  suggestedAction: 'refresh' | 'promote' | 'create';
}

export function suggestPublishDates(opts: {
  decayInsights?: DecayInsight[];
  quickWins?: QuickWinInsight[];
  bestDays?: number[];
}): PublishSuggestion[] {
  const results: PublishSuggestion[] = [];
  const seen = new Set<string>();

  // Decay insights → refresh suggestions (sorted by severity)
  if (opts.decayInsights && opts.decayInsights.length > 0) {
    const sorted = [...opts.decayInsights].sort((a, b) => a.deltaPercent - b.deltaPercent);
    for (const d of sorted) {
      if (seen.has(d.pageId)) continue;
      seen.add(d.pageId);

      const absDelta = Math.abs(d.deltaPercent);
      const priority: PublishSuggestion['priority'] = absDelta > 40 ? 'high' : absDelta > 20 ? 'medium' : 'low';

      results.push({
        pageUrl: d.pageId,
        reason: `Traffic declined ${d.deltaPercent}% — content refresh could recover ${Math.round(d.currentClicks * (absDelta / 100))} clicks/month`,
        priority,
        suggestedAction: 'refresh',
      });
    }
  }

  // Quick wins → promote suggestions
  if (opts.quickWins && opts.quickWins.length > 0) {
    const sorted = [...opts.quickWins].sort((a, b) => b.estimatedTrafficGain - a.estimatedTrafficGain);
    for (const qw of sorted) {
      if (seen.has(qw.pageUrl)) continue;
      seen.add(qw.pageUrl);

      results.push({
        pageUrl: qw.pageUrl,
        reason: `Close to page 1 for "${qw.query}" — estimated +${qw.estimatedTrafficGain} sessions with optimization`,
        priority: qw.estimatedTrafficGain > 100 ? 'high' : 'medium',
        suggestedAction: 'promote',
      });
    }
  }

  return results.slice(0, 15);
}
