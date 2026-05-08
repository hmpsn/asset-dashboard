import { useEffect, useRef, useState } from 'react';
import { post } from '../../api/client';
import {
  getExtraSeoFields,
  getTitleAndDescriptionFields,
  type CmsCollection,
} from './cmsEditorModel';

interface UseCmsEditorAiWorkflowArgs {
  siteId: string;
  workspaceId?: string;
  collections: CmsCollection[];
  edits: Record<string, Record<string, string>>;
  updateField: (itemId: string, fieldSlug: string, value: string) => void;
}

interface ItemVariations {
  fieldSlug: string;
  options: string[];
  descOptions?: string[];
}

export function useCmsEditorAiWorkflow({
  siteId,
  workspaceId,
  collections,
  edits,
  updateField,
}: UseCmsEditorAiWorkflowArgs) {
  const [variations, setVariations] = useState<Record<string, ItemVariations>>(() => {
    try {
      const raw = sessionStorage.getItem(`cms-editor-vars-${siteId}`);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore session cache failures and fall back to empty state
    }
    return {};
  });
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const aiErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(`cms-editor-vars-${siteId}`, JSON.stringify(variations));
    } catch {
      // ignore session cache failures
    }
  }, [siteId, variations]);

  useEffect(() => () => {
    if (aiErrorTimeoutRef.current) {
      clearTimeout(aiErrorTimeoutRef.current);
      aiErrorTimeoutRef.current = null;
    }
  }, []);

  const surfaceAiError = (message: string) => {
    if (aiErrorTimeoutRef.current) {
      clearTimeout(aiErrorTimeoutRef.current);
    }
    setAiError(message);
    aiErrorTimeoutRef.current = setTimeout(() => {
      setAiError(null);
      aiErrorTimeoutRef.current = null;
    }, 5000);
  };

  const clearItemVariations = (itemId: string) => {
    setVariations(previous => {
      const next = { ...previous };
      delete next[itemId];
      return next;
    });
  };

  const applySingleVariation = (itemId: string, fieldSlug: string, value: string) => {
    updateField(itemId, fieldSlug, value);
    clearItemVariations(itemId);
  };

  const applyPairedVariation = (itemId: string, titleSlug: string, descSlug: string, titleValue: string, descValue: string) => {
    updateField(itemId, titleSlug, titleValue);
    updateField(itemId, descSlug, descValue);
    clearItemVariations(itemId);
  };

  const aiRewrite = async (collectionId: string, itemId: string, fieldSlug: string) => {
    const key = `${itemId}-${fieldSlug}`;
    setAiLoading(previous => ({ ...previous, [key]: true }));
    setAiError(null);
    try {
      const currentValue = edits[itemId]?.[fieldSlug] || '';
      const itemName = edits[itemId]?.['name'] || '';
      const isTitle = fieldSlug.includes('title') || fieldSlug === 'name';

      const collection = collections.find(coll => coll.collectionId === collectionId);
      const itemFields = edits[itemId] || {};
      const { titleField, descField } = getTitleAndDescriptionFields(getExtraSeoFields(collection?.seoFields || []));
      const fieldContext = Object.entries(itemFields)
        .filter(([slug, value]) => value && slug !== fieldSlug && slug !== 'name')
        .map(([slug, value]) => `${slug}: ${String(value).slice(0, 300)}`)
        .join('\n');
      const itemSlug = collection?.items.find(item => item.id === itemId)?.fieldData?.slug;
      const pagePath = itemSlug ? `/${collection?.collectionSlug}/${itemSlug}` : undefined;

      const data = await post<{ text?: string; variations?: string[] }>('/api/webflow/seo-rewrite', {
        pageTitle: itemName,
        currentSeoTitle: isTitle ? currentValue : (titleField ? (edits[itemId]?.[titleField.slug] || '') : undefined),
        currentDescription: !isTitle ? currentValue : (descField ? (edits[itemId]?.[descField.slug] || '') : undefined),
        pageContent: fieldContext || undefined,
        siteContext: collection ? `CMS collection: ${collection.collectionName}` : undefined,
        pagePath,
        field: isTitle ? 'title' : 'description',
        workspaceId,
      });

      if (data.variations && data.variations.length > 1) {
        const options = data.variations;
        setVariations(previous => ({ ...previous, [itemId]: { fieldSlug, options } }));
      } else if (data.text) {
        updateField(itemId, fieldSlug, data.text);
      } else {
        surfaceAiError('No AI suggestion returned. Please try again.');
      }
    } catch (err) {
      console.error('CmsEditor operation failed:', err);
      surfaceAiError('AI rewrite failed. Please try again.');
    } finally {
      setAiLoading(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  };

  const aiRewriteBoth = async (collectionId: string, itemId: string, titleSlug: string, descSlug: string) => {
    const key = `${itemId}-both`;
    setAiLoading(previous => ({ ...previous, [key]: true }));
    setAiError(null);
    try {
      const itemName = edits[itemId]?.['name'] || '';
      const currentTitle = edits[itemId]?.[titleSlug] || '';
      const currentDesc = edits[itemId]?.[descSlug] || '';

      const collection = collections.find(coll => coll.collectionId === collectionId);
      const itemFields = edits[itemId] || {};
      const fieldContext = Object.entries(itemFields)
        .filter(([slug, value]) => value && slug !== titleSlug && slug !== descSlug && slug !== 'name')
        .map(([slug, value]) => `${slug}: ${String(value).slice(0, 300)}`)
        .join('\n');
      const itemSlug = collection?.items.find(item => item.id === itemId)?.fieldData?.slug;
      const pagePath = itemSlug ? `/${collection?.collectionSlug}/${itemSlug}` : undefined;

      const data = await post<{ text?: string; variations?: string[]; pairs?: Array<{ title: string; description: string }> }>('/api/webflow/seo-rewrite', {
        pageTitle: itemName,
        currentSeoTitle: currentTitle,
        currentDescription: currentDesc,
        pageContent: fieldContext || undefined,
        siteContext: collection ? `CMS collection: ${collection.collectionName}` : undefined,
        pagePath,
        field: 'both',
        workspaceId,
      });

      if (data.pairs && data.pairs.length > 0) {
        const pairs = data.pairs;
        setVariations(previous => ({
          ...previous,
          [itemId]: {
            fieldSlug: 'both',
            options: pairs.map(pair => pair.title),
            descOptions: pairs.map(pair => pair.description),
          },
        }));
      } else if (data.variations && data.variations.length > 1) {
        const options = data.variations;
        setVariations(previous => ({ ...previous, [itemId]: { fieldSlug: titleSlug, options } }));
      } else if (data.text) {
        updateField(itemId, titleSlug, data.text);
      } else {
        surfaceAiError('No AI suggestions returned. Please try again.');
      }
    } catch (err) {
      console.error('CmsEditor operation failed:', err);
      surfaceAiError('AI rewrite failed. Please try again.');
    } finally {
      setAiLoading(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  };

  return {
    variations,
    aiLoading,
    aiError,
    aiRewrite,
    aiRewriteBoth,
    applySingleVariation,
    applyPairedVariation,
  };
}
