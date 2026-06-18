import type { Recommendation, RecPriority } from '../../../shared/types/recommendations';

export const FIX_NOW_CAP = 5;

/** Lifecycle segmented-control buckets (single-select mode switch). */
export type LifecycleBucket = 'active' | 'sent' | 'approved' | 'throttled';

export type TagSlot = 'severity' | 'value' | 'lifecycle';
export type RailTone = 'teal' | 'emerald' | 'blue' | 'muted';

export interface CockpitTag {
  slot: TagSlot;
  label: string;
  /** Brand-law tone: teal=action, blue=data, emerald=success, amber=warn, red=error, muted=struck. */
  tone: 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'muted';
}

export interface CockpitRowModel {
  rec: Recommendation;
  tags: [CockpitTag, CockpitTag, CockpitTag]; // always [severity, value, lifecycle]
  whyLine: string;
  railTone: RailTone;
  isFixNow: boolean;
}

const PRIORITY_TONE: Record<RecPriority, CockpitTag['tone']> = {
  fix_now: 'red',
  fix_soon: 'amber',
  fix_later: 'blue',
  ongoing: 'blue',
};

const PRIORITY_LABEL: Record<RecPriority, string> = {
  fix_now: 'fix now',
  fix_soon: 'fix soon',
  fix_later: 'fix later',
  ongoing: 'ongoing',
};

function severityTag(rec: Recommendation): CockpitTag {
  return {
    slot: 'severity',
    label: PRIORITY_LABEL[rec.priority],
    tone: PRIORITY_TONE[rec.priority],
  };
}

function valueTag(rec: Recommendation): CockpitTag {
  const v = rec.opportunity?.value ?? rec.impactScore;
  return { slot: 'value', label: `value ${Math.round(v)}`, tone: 'blue' };
}

function lifecycleTag(rec: Recommendation): CockpitTag {
  if (rec.lifecycle === 'struck') return { slot: 'lifecycle', label: 'struck', tone: 'muted' };
  if (rec.lifecycle === 'throttled') return { slot: 'lifecycle', label: 'throttled', tone: 'amber' };
  if (rec.clientStatus === 'approved') return { slot: 'lifecycle', label: 'approved', tone: 'emerald' };
  if (rec.clientStatus === 'sent') return { slot: 'lifecycle', label: 'sent', tone: 'emerald' };
  return { slot: 'lifecycle', label: 'active', tone: 'teal' };
}

function railToneFor(rec: Recommendation): RailTone {
  if (rec.lifecycle === 'struck') return 'muted';
  if (rec.clientStatus === 'sent' || rec.clientStatus === 'approved') return 'emerald';
  return 'teal';
}

/** Single-line clamp: collapse all whitespace runs (incl. newlines) to one space. */
function clampLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function toCockpitRow(rec: Recommendation): CockpitRowModel {
  const isFixNow =
    rec.priority === 'fix_now' &&
    rec.lifecycle !== 'struck' &&
    rec.lifecycle !== 'throttled' &&
    rec.clientStatus !== 'sent' &&
    rec.clientStatus !== 'approved';

  return {
    rec,
    tags: [severityTag(rec), valueTag(rec), lifecycleTag(rec)],
    whyLine: clampLine(rec.description ?? ''),
    railTone: railToneFor(rec),
    isFixNow,
  };
}

/** Counts for the lifecycle segmented control. A rec lands in exactly one bucket. */
export function partitionByLifecycle(recs: Recommendation[]): Record<LifecycleBucket, number> {
  const out: Record<LifecycleBucket, number> = { active: 0, sent: 0, approved: 0, throttled: 0 };
  for (const r of recs) {
    if (r.lifecycle === 'throttled') out.throttled += 1;
    else if (r.clientStatus === 'approved') out.approved += 1;
    else if (r.clientStatus === 'sent') out.sent += 1;
    else out.active += 1;
  }
  return out;
}

export function bucketOf(rec: Recommendation): LifecycleBucket {
  if (rec.lifecycle === 'throttled') return 'throttled';
  if (rec.clientStatus === 'approved') return 'approved';
  if (rec.clientStatus === 'sent') return 'sent';
  return 'active';
}

export type CockpitSort = 'value' | 'impact' | 'age';

export function sortRecs(recs: Recommendation[], sort: CockpitSort): Recommendation[] {
  const copy = [...recs];
  if (sort === 'age') return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (sort === 'impact') return copy.sort((a, b) => b.impactScore - a.impactScore);
  return copy.sort((a, b) => (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore));
}
