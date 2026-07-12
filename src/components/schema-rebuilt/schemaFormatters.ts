// @ds-rebuilt
import type { BadgeTone } from '../ui';
import { daysSince, formatDate } from '../../utils/formatDates';
import type { SchemaPageSuggestion } from '../schema/schemaSuggesterTypes';
import type { SchemaValidationRecord } from '../../api/schema';

const INTEGER_FORMAT = new Intl.NumberFormat('en-US');

export interface SchemaResultStats {
  pages: number;
  pagesWithExisting: number;
  pagesWithErrors: number;
  pagesWithWarnings: number;
  totalGraphTypes: number;
  richEligible: number;
  cmsPages: number;
  stalePublished: number;
}

export function formatInteger(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return INTEGER_FORMAT.format(value);
}

export function graphTypesForPage(page: SchemaPageSuggestion): string[] {
  const graph = page.suggestedSchemas[0]?.template?.['@graph'];
  if (!Array.isArray(graph)) return [];
  return graph
    .map((node) => (node && typeof node === 'object' ? (node as Record<string, unknown>)['@type'] : null))
    .flatMap((type) => Array.isArray(type) ? type : [type])
    .filter((type): type is string => typeof type === 'string' && type.length > 0);
}

export function isHomepage(page: SchemaPageSuggestion): boolean {
  return !page.slug || page.slug === '/' || page.slug === 'index' || page.slug === 'home';
}

export function isCmsPage(page: SchemaPageSuggestion): boolean {
  return page.pageId.startsWith('cms-');
}

export function staleDaysForPage(page: SchemaPageSuggestion): number | null {
  if (!page.lastPublishedAt) return null;
  const days = daysSince(page.lastPublishedAt);
  return days > 90 ? days : null;
}

export function summarizeSchemaPages(pages: SchemaPageSuggestion[]): SchemaResultStats {
  return pages.reduce<SchemaResultStats>((stats, page) => {
    const validationErrors = page.validationErrors?.length ?? 0;
    const validationFindings = page.validationFindings ?? [];
    const graphTypes = graphTypesForPage(page);

    stats.pages += 1;
    if (page.existingSchemas.length > 0) stats.pagesWithExisting += 1;
    if (validationErrors > 0 || validationFindings.some((finding) => finding.severity === 'error')) stats.pagesWithErrors += 1;
    if (validationFindings.some((finding) => finding.severity === 'warning')) stats.pagesWithWarnings += 1;
    stats.totalGraphTypes += graphTypes.length;
    stats.richEligible += page.richResultsEligibility?.filter((result) => result.eligible).length ?? 0;
    if (isCmsPage(page)) stats.cmsPages += 1;
    if (staleDaysForPage(page) !== null) stats.stalePublished += 1;
    return stats;
  }, {
    pages: 0,
    pagesWithExisting: 0,
    pagesWithErrors: 0,
    pagesWithWarnings: 0,
    totalGraphTypes: 0,
    richEligible: 0,
    cmsPages: 0,
    stalePublished: 0,
  });
}

export function validationStatusForPage(
  page: SchemaPageSuggestion,
  validationStatusByPageId: Map<string, SchemaValidationRecord['status']>,
): SchemaValidationRecord['status'] | undefined {
  return validationStatusByPageId.get(page.pageId) ?? page.generationDiagnostics?.validationStatus;
}

export function validationTone(status: SchemaValidationRecord['status'] | undefined): BadgeTone {
  if (status === 'valid') return 'emerald';
  if (status === 'warnings') return 'amber';
  if (status === 'errors') return 'red';
  return 'blue';
}

export function validationLabel(status: SchemaValidationRecord['status'] | undefined): string {
  if (status === 'valid') return 'Valid';
  if (status === 'warnings') return 'Warnings';
  if (status === 'errors') return 'Fix errors';
  return 'Not validated';
}

export function publishedLabel(page: SchemaPageSuggestion, published: boolean, retracted: boolean): string {
  if (retracted) return 'Retracted';
  if (published || page.lastPublishedAt) return isCmsPage(page) ? 'CMS live' : 'Published';
  return 'Draft';
}

export function publishedTone(page: SchemaPageSuggestion, published: boolean, retracted: boolean): BadgeTone {
  if (retracted) return 'zinc';
  if (published || page.lastPublishedAt) return 'emerald';
  if (isCmsPage(page) && page.cmsDeliveryStatus?.status !== 'ready') return 'amber';
  return 'blue';
}

export function formatSnapshotDate(value: string | null | undefined): string {
  const formatted = formatDate(value);
  return formatted ? `Last scanned ${formatted}` : 'No saved scan yet';
}

export function schemaPreview(schema: Record<string, unknown> | undefined): string {
  return JSON.stringify(schema ?? {}, null, 2);
}

export function titleForPage(page: SchemaPageSuggestion): string {
  return page.pageTitle || page.slug || page.url || 'Untitled page';
}

export function pathForPage(page: SchemaPageSuggestion): string {
  if (page.publishedPath) return page.publishedPath;
  if (!page.slug) return '/';
  // page-slug-url-ok — display-only path label (table cell / drawer subtitle), not a fetch/nav URL.
  return page.slug.startsWith('/') ? page.slug : `/${page.slug}`;
}
