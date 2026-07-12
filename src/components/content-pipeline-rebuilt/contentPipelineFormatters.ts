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
  const trimmed = slug.trim();
  if (!trimmed || trimmed.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(trimmed)) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.pathname || '/' : '';
    } catch {
      return '';
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return '';
  // page-slug-url-ok — external live-site URL (site domain + slug), not an internal app route
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function normalizeLiveSiteBase(siteLabel: string | null | undefined): string | null {
  if (!siteLabel) return null;
  let base = siteLabel.trim();
  if (!base) return null;
  if (base.toLowerCase().startsWith('sc-domain:')) base = base.slice('sc-domain:'.length).trim();
  if (!base || base.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(base)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(base) && !/^https?:\/\//i.test(base)) return null;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;

  try {
    const parsed = new URL(base);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveLiveSiteBase(
  liveDomain: string | null | undefined,
  gscPropertyUrl: string | null | undefined,
): string | null {
  return normalizeLiveSiteBase(liveDomain) ?? normalizeLiveSiteBase(gscPropertyUrl);
}

export function buildLiveContentUrl(siteLabel: string | null | undefined, targetPageSlug: string | null | undefined): string | null {
  const base = normalizeLiveSiteBase(siteLabel);
  const slug = normalizeSlug(targetPageSlug);
  return base && slug ? `${base}${slug}` : null;
}
