import type { SeoEditState, SeoEditorPage } from './seoEditorTypes';

export interface SeoPatternPreviewItem {
  pageId: string;
  oldValue: string;
  newValue: string;
}

export interface SeoPatternApplyPagePayload {
  pageId: string;
  title: string;
  slug: string | undefined;
  publishedPath: string | null | undefined;
  currentValue: string;
}

export interface SeoBulkRewriteRequestPagePayload {
  pageId: string;
  title: string;
  slug: string | undefined;
  publishedPath: string | null | undefined;
  currentSeoTitle: string;
  currentDescription: string;
}

export function buildPatternPreviewItems(
  pageIds: string[],
  pages: SeoEditorPage[],
  edits: Record<string, SeoEditState>,
  options: {
    field: 'title' | 'description';
    action: 'append' | 'prepend';
    text: string;
  },
): SeoPatternPreviewItem[] {
  const maxLen = options.field === 'description' ? 160 : 60;
  const pageById = new Map(pages.map(page => [page.id, page]));
  const preview: SeoPatternPreviewItem[] = [];

  for (const pageId of pageIds) {
    const page = pageById.get(pageId);
    const edit = edits[pageId];
    if (!page || !edit) continue;

    const oldValue = options.field === 'title'
      ? (edit.seoTitle || page.seo?.title || '')
      : (edit.seoDescription || page.seo?.description || '');
    let newValue = options.action === 'append'
      ? `${oldValue} ${options.text}`.trim()
      : `${options.text} ${oldValue}`.trim();
    if (newValue.length > maxLen) {
      newValue = newValue.slice(0, maxLen).replace(/\s+\S*$/, '');
    }

    preview.push({ pageId, oldValue, newValue });
  }

  return preview;
}

export function buildPatternApplyPayload(
  previewItems: SeoPatternPreviewItem[],
  pages: SeoEditorPage[],
): SeoPatternApplyPagePayload[] {
  const pageById = new Map(pages.map(page => [page.id, page]));
  return previewItems.map(item => {
    const page = pageById.get(item.pageId);
    return {
      pageId: item.pageId,
      title: page?.title || '',
      slug: page?.slug,
      publishedPath: page?.publishedPath,
      currentValue: item.oldValue,
    };
  });
}

export function buildBulkRewriteRequestPages(
  pageIds: string[],
  pages: SeoEditorPage[],
  edits: Record<string, SeoEditState>,
): SeoBulkRewriteRequestPagePayload[] {
  const pageById = new Map(pages.map(page => [page.id, page]));
  return pageIds.map(pageId => {
    const page = pageById.get(pageId);
    const edit = edits[pageId];
    return {
      pageId,
      title: page?.title || '',
      slug: page?.slug,
      publishedPath: page?.publishedPath,
      currentSeoTitle: edit?.seoTitle || page?.seo?.title || '',
      currentDescription: edit?.seoDescription || page?.seo?.description || '',
    };
  });
}

export function buildBulkSeoUpdate(
  field: 'title' | 'description',
  newValue: string,
  page: SeoEditorPage,
  edit: SeoEditState | undefined,
): { seo: { title: string; description: string }; openGraph: { title: string; description: string } } {
  const seo = field === 'title'
    ? {
        title: newValue,
        description: edit?.seoDescription || page.seo?.description || '',
      }
    : {
        title: edit?.seoTitle || page.seo?.title || '',
        description: newValue,
      };
  return {
    seo,
    openGraph: seo,
  };
}
