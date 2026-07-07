// @ds-rebuilt
import { formatDate, formatDateTime } from '../../utils/formatDates';
import { formatBytes } from '../../utils/formatNumbers';
import type { PageSpeedStrategy, PageWeightPage } from '../../hooks/admin/useAdminPerformance';

export { formatBytes };

export const PAGE_WEIGHT_THRESHOLDS = {
  watch: 1024 * 1024,
  heavy: 2 * 1024 * 1024,
  severe: 5 * 1024 * 1024,
  largeAsset: 500 * 1024,
} as const;

export function formatScanDate(value: string | null | undefined): string {
  return formatDateTime(value) || formatDate(value) || '';
}

export function formatPageSpeedDate(value: string | null | undefined): string {
  return formatDate(value) || '';
}

export function pageSource(page: string): 'page' | 'cms' | 'css' {
  if (page.startsWith('cms:')) return 'cms';
  if (page.startsWith('css:')) return 'css';
  return 'page';
}

export function pageSourceLabel(source: 'page' | 'cms' | 'css'): string {
  if (source === 'cms') return 'CMS';
  if (source === 'css') return 'CSS';
  return 'Page';
}

export function pageWeightTone(bytes: number): 'emerald' | 'amber' | 'orange' | 'red' {
  if (bytes > PAGE_WEIGHT_THRESHOLDS.severe) return 'red';
  if (bytes > PAGE_WEIGHT_THRESHOLDS.heavy) return 'orange';
  if (bytes > PAGE_WEIGHT_THRESHOLDS.watch) return 'amber';
  return 'emerald';
}

export function pageWeightAccent(bytes: number): string {
  const tone = pageWeightTone(bytes);
  if (tone === 'red') return 'var(--red)';
  if (tone === 'orange') return 'var(--orange)';
  if (tone === 'amber') return 'var(--amber)';
  return 'var(--emerald)';
}

export function pageWeightStatus(bytes: number): string {
  const tone = pageWeightTone(bytes);
  if (tone === 'red') return '>5MB';
  if (tone === 'orange') return '>2MB';
  if (tone === 'amber') return '>1MB';
  return 'OK';
}

export function pageWeightPercent(page: PageWeightPage, maxSize: number): number {
  if (maxSize <= 0) return 0;
  return Math.max(2, Math.round((page.totalSize / maxSize) * 100));
}

export function averagePageWeight(pages: PageWeightPage[]): number {
  if (pages.length === 0) return 0;
  return Math.round(pages.reduce((sum, page) => sum + page.totalSize, 0) / pages.length);
}

export function formatMilliseconds(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function formatCls(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
}

export type VitalRating = 'good' | 'needs-improvement' | 'poor';

export function vitalRating(key: string, value: number | null | undefined): VitalRating {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'needs-improvement';
  switch (key) {
    case 'LCP':
      return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor';
    case 'FID':
      return value <= 100 ? 'good' : value <= 300 ? 'needs-improvement' : 'poor';
    case 'INP':
      return value <= 200 ? 'good' : value <= 500 ? 'needs-improvement' : 'poor';
    case 'CLS':
      return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor';
    case 'FCP':
      return value <= 1800 ? 'good' : value <= 3000 ? 'needs-improvement' : 'poor';
    case 'SI':
      return value <= 3400 ? 'good' : value <= 5800 ? 'needs-improvement' : 'poor';
    case 'TBT':
      return value <= 200 ? 'good' : value <= 600 ? 'needs-improvement' : 'poor';
    case 'TTI':
      return value <= 3800 ? 'good' : value <= 7300 ? 'needs-improvement' : 'poor';
    default:
      return 'needs-improvement';
  }
}

export function ratingTone(rating: VitalRating): 'emerald' | 'amber' | 'red' {
  if (rating === 'good') return 'emerald';
  if (rating === 'poor') return 'red';
  return 'amber';
}

export function ratingAccent(rating: VitalRating): string {
  if (rating === 'good') return 'var(--emerald)';
  if (rating === 'poor') return 'var(--red)';
  return 'var(--amber)';
}

export function strategyLabel(strategy: PageSpeedStrategy): string {
  return strategy === 'mobile' ? 'Mobile' : 'Desktop';
}

export function pageSpeedErrorMessage(message: string): string {
  return `${message}. If Google PageSpeed Insights is rate-limited, add a GOOGLE_PSI_KEY environment variable for higher quota.`;
}
