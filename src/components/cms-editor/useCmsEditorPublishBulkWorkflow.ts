import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { post } from '../../api/client';
import {
  getExtraSeoFields,
  getTitleAndDescriptionFields,
  type CmsCollection,
} from './cmsEditorModel';

type BulkTargetField = 'name' | 'title' | 'description' | 'all';

interface UseCmsEditorPublishBulkWorkflowArgs {
  siteId: string;
  workspaceId?: string;
  collections: CmsCollection[];
  saved: Set<string>;
  approvalSelected: Set<string>;
  setExpandedCollections: Dispatch<SetStateAction<Set<string>>>;
  setExpandedItems: Dispatch<SetStateAction<Set<string>>>;
  aiRewrite: (collectionId: string, itemId: string, fieldSlug: string) => Promise<boolean>;
  aiRewriteBoth: (collectionId: string, itemId: string, titleSlug: string, descSlug: string) => Promise<boolean>;
}

export function useCmsEditorPublishBulkWorkflow({
  siteId,
  workspaceId,
  collections,
  saved,
  approvalSelected,
  setExpandedCollections,
  setExpandedItems,
  aiRewrite,
  aiRewriteBoth,
}: UseCmsEditorPublishBulkWorkflowArgs) {
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<'idle' | 'rewriting'>('idle');
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkResults, setBulkResults] = useState<string | null>(null);
  const publishedTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const bulkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    for (const timeoutId of publishedTimeoutsRef.current) {
      clearTimeout(timeoutId);
    }
    publishedTimeoutsRef.current.clear();
    if (bulkTimeoutRef.current) clearTimeout(bulkTimeoutRef.current);
  }, []);

  const publishCollection = async (collectionId: string) => {
    const collItems = collections.find(collection => collection.collectionId === collectionId)?.items || [];
    const savedItemIds = collItems.filter(item => saved.has(item.id)).map(item => item.id);
    if (savedItemIds.length === 0) return;

    setPublishing(previous => new Set(previous).add(collectionId));
    try {
      const result = await post<{ success?: boolean }>(`/api/webflow/collections/${collectionId}/publish`, { itemIds: savedItemIds, siteId, workspaceId });
      if (result.success) {
        setPublished(previous => new Set(previous).add(collectionId));
        const timeoutId = setTimeout(() => {
          setPublished(previous => {
            const next = new Set(previous);
            next.delete(collectionId);
            return next;
          });
          publishedTimeoutsRef.current.delete(timeoutId);
        }, 3000);
        publishedTimeoutsRef.current.add(timeoutId);
      }
    } catch (err) {
      console.error('CmsEditor operation failed:', err);
    } finally {
      setPublishing(previous => {
        const next = new Set(previous);
        next.delete(collectionId);
        return next;
      });
    }
  };

  const bulkAiRewrite = async (targetField: BulkTargetField) => {
    const selectedIds = Array.from(approvalSelected).filter(id =>
      collections.some(collection => collection.items.some(item => item.id === id))
    );
    if (selectedIds.length === 0) return;

    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: selectedIds.length });

    setExpandedCollections(previous => {
      const next = new Set(previous);
      for (const id of selectedIds) {
        const collection = collections.find(coll => coll.items.some(item => item.id === id));
        if (collection) next.add(collection.collectionId);
      }
      return next;
    });
    setExpandedItems(previous => {
      const next = new Set(previous);
      for (const id of selectedIds) next.add(id);
      return next;
    });

    let completed = 0;
    let failed = 0;
    const CONCURRENCY = 3;

    for (let index = 0; index < selectedIds.length; index += CONCURRENCY) {
      const batch = selectedIds.slice(index, index + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (itemId) => {
          const collection = collections.find(coll => coll.items.some(item => item.id === itemId));
          if (!collection) return false;

          const extraSeoFields = getExtraSeoFields(collection.seoFields);
          const { titleField, descField } = getTitleAndDescriptionFields(extraSeoFields);
          let itemFailed = false;

          if (targetField === 'all' && titleField && descField) {
            const nameOk = await aiRewrite(collection.collectionId, itemId, 'name');
            const bothOk = await aiRewriteBoth(collection.collectionId, itemId, titleField.slug, descField.slug);
            itemFailed = !nameOk || !bothOk;
          } else {
            const slugs: string[] = [];
            if (targetField === 'name' || targetField === 'all') slugs.push('name');
            if ((targetField === 'title' || targetField === 'all') && titleField) slugs.push(titleField.slug);
            if ((targetField === 'description' || targetField === 'all') && descField) slugs.push(descField.slug);

            for (const slug of slugs) {
              const ok = await aiRewrite(collection.collectionId, itemId, slug);
              if (!ok) itemFailed = true;
            }
          }

          return !itemFailed;
        })
      );

      for (const result of results) {
        if (result.status === 'rejected' || result.value === false) failed++;
        completed++;
      }
      setBulkProgress({ done: completed, total: selectedIds.length });
    }

    const succeeded = completed - failed;
    setBulkResults(
      failed > 0
        ? `Generated variations for ${succeeded}/${selectedIds.length} items (${failed} failed) — review below.`
        : `Generated variations for ${succeeded}/${selectedIds.length} items — review in each card below.`
    );
    setBulkMode('idle');
    if (bulkTimeoutRef.current) clearTimeout(bulkTimeoutRef.current);
    bulkTimeoutRef.current = setTimeout(() => {
      setBulkResults(null);
      bulkTimeoutRef.current = null;
    }, 8000);
  };

  return {
    publishing,
    published,
    bulkMode,
    bulkProgress,
    bulkResults,
    publishCollection,
    bulkAiRewrite,
  };
}
