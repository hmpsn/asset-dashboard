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

// ── Draft scheduling (W6.6) ──
// Adapts the page-level suggestions above into concrete per-draft publish-date
// proposals for the forward-planning Content Calendar. The admin confirms; each
// confirmed date is applied via PATCH /api/content-posts/:ws/:postId/planned-date.

interface DraftToSchedule {
  id: string;
  targetKeyword?: string;
  /** Page slug/url this draft targets — matched against priorityPages. */
  pageHint?: string;
}

interface PriorityPage {
  pageUrl: string;
  priority: 'high' | 'medium' | 'low';
}

export interface DraftScheduleSuggestion {
  draftId: string;
  /** ISO datetime (midnight UTC of the chosen weekday). */
  suggestedDate: string;
  reason: string;
}

const PRIORITY_RANK: Record<PriorityPage['priority'], number> = { high: 0, medium: 1, low: 2 };

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Advance to the next weekday (Mon–Fri) on/after the given date.
 * The returned Date is anchored at 12:00:00 UTC to avoid off-by-one calendar
 * bucketing in local timezones: midnight UTC (00:00Z) is the previous day in any
 * timezone west of UTC, so west-of-UTC admins would see suggestions a day early.
 * Noon UTC (12:00Z) is safely within the same civil day in all UTC-12..UTC+12 zones.
 */
function nextWeekday(d: Date): Date {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
  while (isWeekend(next)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * Propose a publish date for each unscheduled draft. Drafts whose pageHint
 * matches a high/medium/low priority page (from suggestPublishDates) are scheduled
 * first and earliest; the rest follow in input order. Dates are spread across
 * upcoming weekdays (`spacingDays` business days apart, default 2), starting from
 * `startDate`. Weekends are skipped.
 */
export function suggestDraftSchedule(opts: {
  drafts: DraftToSchedule[];
  startDate: Date;
  priorityPages?: PriorityPage[];
  spacingDays?: number;
}): DraftScheduleSuggestion[] {
  const { drafts, startDate } = opts;
  if (drafts.length === 0) return [];

  const spacing = Math.max(1, opts.spacingDays ?? 2);
  const priorityByPage = new Map<string, PriorityPage['priority']>();
  for (const p of opts.priorityPages ?? []) {
    priorityByPage.set(p.pageUrl, p.priority);
  }

  // Stable sort: prioritized drafts first (by rank), preserving original order within ties.
  const ordered = drafts
    .map((draft, idx) => {
      const priority = draft.pageHint ? priorityByPage.get(draft.pageHint) : undefined;
      return { draft, idx, priority };
    })
    .sort((a, b) => {
      const ra = a.priority ? PRIORITY_RANK[a.priority] : 3;
      const rb = b.priority ? PRIORITY_RANK[b.priority] : 3;
      if (ra !== rb) return ra - rb;
      return a.idx - b.idx;
    });

  const suggestions: DraftScheduleSuggestion[] = [];
  // Start at the first weekday on/after startDate.
  let cursor = nextWeekday(startDate);
  for (const { draft, priority } of ordered) {
    const slot = nextWeekday(cursor);
    suggestions.push({
      draftId: draft.id,
      suggestedDate: slot.toISOString(),
      reason: priority
        ? `${priority[0].toUpperCase()}${priority.slice(1)}-priority page — scheduled early`
        : 'Spaced into the next available publishing slot',
    });
    // Advance the cursor by `spacing` business days for the next draft.
    cursor = new Date(slot);
    let advanced = 0;
    while (advanced < spacing) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (!isWeekend(cursor)) advanced++;
    }
  }

  return suggestions;
}
