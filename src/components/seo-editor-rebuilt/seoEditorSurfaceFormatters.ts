// @ds-rebuilt
import { formatDate, formatDateTime } from '../../utils/formatDates';
import { SEO_EDITOR_TARGET_TYPES, type SeoEditorTargetType } from '../../../shared/types/seo-editor-write-target';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? NUMBER_FORMAT.format(value) : '—';
}

export function formatOptionalText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '—';
}

export function formatSourceLabel(targetType: SeoEditorTargetType): string {
  if (targetType === SEO_EDITOR_TARGET_TYPES.staticPage) return 'Static';
  if (targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) return 'CMS';
  return 'Manual';
}

export function formatTargetTypeForSentence(targetType: SeoEditorTargetType): string {
  if (targetType === SEO_EDITOR_TARGET_TYPES.staticPage) return 'static page';
  if (targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) return 'CMS item';
  return 'manual row';
}

export function formatRank(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `#${value}` : '—';
}

export function formatTraffic(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? NUMBER_FORMAT.format(value) : '—';
}

export function formatFreshness(value: string | null | undefined): string {
  return formatDateTime(value) || formatDate(value) || 'Not recorded';
}

export function fieldLengthLabel(value: string | null | undefined, max: number): string {
  return `${value?.length ?? 0}/${max}`;
}
