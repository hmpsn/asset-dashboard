import type { SeoEditState, SeoEditorPage, SeoVariationSet } from './seoEditorTypes';

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter extends StorageReader {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSessionStorage(): StorageWriter | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getLocalStorage(): StorageReader | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getSeoEditorEditsKey(siteId: string): string {
  return `seo-editor-edits-${siteId}`;
}

export function getSeoEditorExpandedKey(siteId: string): string {
  return `seo-editor-expanded-${siteId}`;
}

export function getSeoEditorVariationsKey(siteId: string): string {
  return `seo-editor-vars-${siteId}`;
}

export function getSeoBulkAnalyzeJobKey(workspaceId: string): string {
  return `seo-bulk-analyze-job-${workspaceId}`;
}

export function getSeoBulkRewriteJobKey(workspaceId: string): string {
  return `seo-bulk-rewrite-job-${workspaceId}`;
}

export function getSeoDraftKey(workspaceId: string | undefined, pageId: string): string {
  return `seo-draft-${workspaceId}-${pageId}`;
}

export function readCachedSeoEdits(
  siteId: string,
  storage: StorageReader | null = getSessionStorage(),
): { edits: Record<string, SeoEditState>; restoredFromCache: boolean } {
  if (!storage) return { edits: {}, restoredFromCache: false };
  try {
    const raw = storage.getItem(getSeoEditorEditsKey(siteId));
    if (!raw) return { edits: {}, restoredFromCache: false };
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
      return { edits: {}, restoredFromCache: false };
    }
    return {
      edits: parsed as Record<string, SeoEditState>,
      restoredFromCache: true,
    };
  } catch {
    return { edits: {}, restoredFromCache: false };
  }
}

export function readCachedExpandedPages(
  siteId: string,
  storage: StorageReader | null = getSessionStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(getSeoEditorExpandedKey(siteId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter(value => typeof value === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function readCachedSeoVariations(
  siteId: string,
  storage: StorageReader | null = getSessionStorage(),
): Record<string, SeoVariationSet> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(getSeoEditorVariationsKey(siteId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as Record<string, SeoVariationSet>) : {};
  } catch {
    return {};
  }
}

export function readCachedSeoBulkAnalyzeJobId(
  workspaceId: string | undefined,
  storage: StorageReader | null = getSessionStorage(),
): string | null {
  if (!workspaceId || !storage) return null;
  try {
    return storage.getItem(getSeoBulkAnalyzeJobKey(workspaceId)) ?? null;
  } catch {
    return null;
  }
}

export function readCachedSeoBulkRewriteJobId(
  workspaceId: string | undefined,
  storage: StorageReader | null = getSessionStorage(),
): string | null {
  if (!workspaceId || !storage) return null;
  try {
    return storage.getItem(getSeoBulkRewriteJobKey(workspaceId)) ?? null;
  } catch {
    return null;
  }
}

export function persistCachedSeoEdits(siteId: string, edits: Record<string, SeoEditState>): void {
  const storage = getSessionStorage();
  if (!storage || Object.keys(edits).length === 0) return;
  try {
    storage.setItem(getSeoEditorEditsKey(siteId), JSON.stringify(edits));
  } catch {
    // ignore
  }
}

export function persistCachedExpandedPages(siteId: string, expanded: Set<string>): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(getSeoEditorExpandedKey(siteId), JSON.stringify(Array.from(expanded)));
  } catch {
    // ignore
  }
}

export function persistCachedSeoVariations(siteId: string, variations: Record<string, SeoVariationSet>): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(getSeoEditorVariationsKey(siteId), JSON.stringify(variations));
  } catch {
    // ignore
  }
}

export function persistCachedSeoBulkAnalyzeJobId(workspaceId: string | undefined, jobId: string | null): void {
  const storage = getSessionStorage();
  if (!workspaceId || !storage) return;
  try {
    if (jobId) storage.setItem(getSeoBulkAnalyzeJobKey(workspaceId), jobId);
    else storage.removeItem(getSeoBulkAnalyzeJobKey(workspaceId));
  } catch {
    // ignore
  }
}

export function persistCachedSeoBulkRewriteJobId(workspaceId: string | undefined, jobId: string | null): void {
  const storage = getSessionStorage();
  if (!workspaceId || !storage) return;
  try {
    if (jobId) storage.setItem(getSeoBulkRewriteJobKey(workspaceId), jobId);
    else storage.removeItem(getSeoBulkRewriteJobKey(workspaceId));
  } catch {
    // ignore
  }
}

export function buildSeoEditsFromPages(
  pages: SeoEditorPage[],
  workspaceId: string | undefined,
  storage: StorageReader | null = getLocalStorage(),
): Record<string, SeoEditState> {
  const editMap: Record<string, SeoEditState> = {};

  for (const page of pages) {
    let seoTitle = page.seo?.title || '';
    let seoDescription = page.seo?.description || '';
    let dirty = false;

    if (storage) {
      try {
        const draftData = storage.getItem(getSeoDraftKey(workspaceId, page.id));
        if (draftData) {
          const draft = JSON.parse(draftData);
          if (isRecord(draft)) {
            seoTitle = (draft.seoTitle as string | null | undefined) ?? seoTitle;
            seoDescription = (draft.seoDescription as string | null | undefined) ?? seoDescription;
            dirty = true;
          }
        }
      } catch {
        // ignore
      }
    }

    editMap[page.id] = {
      seoTitle,
      seoDescription,
      dirty,
    };
  }

  return editMap;
}
