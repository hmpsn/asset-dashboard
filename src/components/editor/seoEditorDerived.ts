import type { SeoEditState, SeoEditorPage } from './seoEditorTypes';
import { resolvePagePath } from '../../lib/pathUtils';

export interface SeoApprovalItem {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  publishedPath?: string | null;
  field: 'seoTitle' | 'seoDescription';
  currentValue: string;
  proposedValue: string;
}

interface SeoFilterAndSortOptions {
  search: string;
  showCmsOnly: boolean;
  metadataRecommendationCountByPageId: Map<string, number>;
}

export function buildSeoApprovalItemsForPage(
  page: SeoEditorPage | undefined,
  edit: SeoEditState | undefined,
): SeoApprovalItem[] {
  if (!page || !edit || page.source === 'cms') return [];

  const proposedTitle = edit.seoTitle ?? '';
  const proposedDesc = edit.seoDescription ?? '';
  const currentTitle = page.seo?.title ?? '';
  const currentDesc = page.seo?.description ?? '';
  const pageSlug = page.slug ?? '';
  const publishedPath = resolvePagePath(page);
  const items: SeoApprovalItem[] = [];

  if (proposedTitle !== currentTitle) {
    items.push({
      pageId: page.id,
      pageTitle: page.title,
      pageSlug,
      publishedPath,
      field: 'seoTitle',
      currentValue: currentTitle,
      proposedValue: proposedTitle,
    });
  }
  if (proposedDesc !== currentDesc) {
    items.push({
      pageId: page.id,
      pageTitle: page.title,
      pageSlug,
      publishedPath,
      field: 'seoDescription',
      currentValue: currentDesc,
      proposedValue: proposedDesc,
    });
  }

  return items;
}

export function buildSeoApprovalItemsForSelection(
  pageIds: string[],
  pages: SeoEditorPage[],
  edits: Record<string, SeoEditState>,
): SeoApprovalItem[] {
  const pageById = new Map(pages.map(page => [page.id, page]));
  const items: SeoApprovalItem[] = [];

  for (const pageId of pageIds) {
    items.push(...buildSeoApprovalItemsForPage(pageById.get(pageId), edits[pageId]));
  }

  return items;
}

function getSeoPriorityScore(page: SeoEditorPage, metadataRecommendationCount: number): number {
  const missingTitleScore = page.seo?.title ? 0 : 2;
  const missingDescriptionScore = page.seo?.description ? 0 : 2;
  return missingTitleScore + missingDescriptionScore + metadataRecommendationCount;
}

export function filterAndSortSeoPages(
  pages: SeoEditorPage[],
  options: SeoFilterAndSortOptions,
): SeoEditorPage[] {
  const query = options.search.toLowerCase();

  return pages
    .filter((page) => {
      if (options.showCmsOnly && page.source !== 'cms') return false;
      if (!query) return true;
      return page.title.toLowerCase().includes(query) || (page.slug || '').toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const scoreA = getSeoPriorityScore(a, options.metadataRecommendationCountByPageId.get(a.id) ?? 0);
      const scoreB = getSeoPriorityScore(b, options.metadataRecommendationCountByPageId.get(b.id) ?? 0);
      return scoreB - scoreA;
    });
}
