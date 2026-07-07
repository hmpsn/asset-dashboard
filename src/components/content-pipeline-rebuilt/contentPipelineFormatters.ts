// @ds-rebuilt
import { formatDate, formatDateTime } from '../../utils/formatDates';
import type {
  ContentPerformanceItem,
  ContentPerformanceSource,
  ContentTermCoverageStatus,
} from '../../../shared/types/content';
import type { BadgeTone } from '../ui';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const POSITION_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const PERCENT_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

export function formatInteger(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? NUMBER_FORMAT.format(value) : '—';
}

export function formatPosition(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `#${POSITION_FORMAT.format(value)}` : '—';
}

export function formatPercentValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${PERCENT_FORMAT.format(value)}%` : '—';
}

export function formatEngagement(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function formatContentDate(value: string | null | undefined): string {
  return formatDate(value) || '—';
}

export function formatContentDateTime(value: string | null | undefined): string {
  return formatDateTime(value) || formatContentDate(value);
}

export function coverageTone(status: ContentTermCoverageStatus): BadgeTone {
  if (status === 'strong') return 'emerald';
  if (status === 'partial') return 'amber';
  if (status === 'weak') return 'red';
  return 'zinc';
}

export function coverageLabel(item: ContentPerformanceItem): string {
  if (item.coverage.status === 'unavailable' || item.coverage.coveragePct === null) return 'Coverage n/a';
  return `${item.coverage.coveragePct}% covered`;
}

export function contentStatusTone(status: string): BadgeTone {
  if (status === 'published') return 'emerald';
  if (status === 'delivered') return 'blue';
  if (status === 'client_review' || status === 'post_review') return 'teal';
  if (status === 'changes_requested') return 'orange';
  return 'zinc';
}

export function contentSourceLabel(source: ContentPerformanceSource | undefined): string {
  if (source === 'matrix') return 'Content Plan';
  return 'Request';
}

export function contentSourceTone(source: ContentPerformanceSource | undefined): BadgeTone {
  return source === 'matrix' ? 'teal' : 'blue';
}

export function normalizeSlug(slug: string | null | undefined): string {
  if (!slug) return '';
  // page-slug-url-ok — external live-site URL (site domain + slug), not an internal app route
  return slug.startsWith('/') ? slug : `/${slug}`;
}

export function buildLiveContentUrl(siteLabel: string | null | undefined, targetPageSlug: string | null | undefined): string | null {
  const slug = normalizeSlug(targetPageSlug);
  if (!siteLabel || !slug) return null;
  let base = siteLabel.trim();
  if (!base) return null;
  if (base.startsWith('sc-domain:')) base = base.replace('sc-domain:', '');
  if (!base.startsWith('http://') && !base.startsWith('https://')) base = `https://${base}`;
  return `${base.replace(/\/$/, '')}${slug}`;
}
