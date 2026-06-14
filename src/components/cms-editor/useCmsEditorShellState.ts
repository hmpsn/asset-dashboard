import { useEffect, useRef, useState } from 'react';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { buildInitialEdits, type CmsCollection } from './cmsEditorModel';

interface UseCmsEditorShellStateArgs {
  siteId: string;
  collections: CmsCollection[];
}

export function useCmsEditorShellState({ siteId, collections }: UseCmsEditorShellStateArgs) {
  const restoredFromCache = useRef(false);
  const [expandedCollections, toggleCollection, setExpandedCollections] = useToggleSet<string>(() => {
    try {
      const raw = sessionStorage.getItem(`cms-editor-expanded-colls-${siteId}`);
      if (raw) return new Set<string>(JSON.parse(raw) as string[]);
    } catch {
      // ignore session cache failures and fall back to empty state
    }
    return new Set<string>();
  }, UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [expandedItems, toggleItem, setExpandedItems] = useToggleSet<string>(() => {
    try {
      const raw = sessionStorage.getItem(`cms-editor-expanded-items-${siteId}`);
      if (raw) return new Set<string>(JSON.parse(raw) as string[]);
    } catch {
      // ignore session cache failures and fall back to empty state
    }
    return new Set<string>();
  }, UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>(() => {
    try {
      const raw = sessionStorage.getItem(`cms-editor-edits-${siteId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Object.keys(parsed).length > 0) {
          restoredFromCache.current = true;
          return parsed;
        }
      }
    } catch {
      // ignore session cache failures and fall back to empty state
    }
    return {};
  });
  const [dirty, setDirty] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(`cms-editor-dirty-${siteId}`);
      if (raw) return new Set(JSON.parse(raw));
    } catch {
      // ignore session cache failures and fall back to empty state
    }
    return new Set();
  });
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [historyExpanded, toggleHistory] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [search, setSearch] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewExpanded, togglePreview] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);

  // Sync state to sessionStorage for persistence across tab switches + refresh.
  // Always syncing edits avoids stale-cache resurrection after a later reset.
  useEffect(() => {
    try {
      sessionStorage.setItem(`cms-editor-edits-${siteId}`, JSON.stringify(edits));
    } catch {
      // ignore session cache failures
    }
  }, [edits, siteId]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`cms-editor-expanded-colls-${siteId}`, JSON.stringify(Array.from(expandedCollections)));
    } catch {
      // ignore session cache failures
    }
  }, [expandedCollections, siteId]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`cms-editor-expanded-items-${siteId}`, JSON.stringify(Array.from(expandedItems)));
    } catch {
      // ignore session cache failures
    }
  }, [expandedItems, siteId]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`cms-editor-dirty-${siteId}`, JSON.stringify(Array.from(dirty)));
    } catch {
      // ignore session cache failures
    }
  }, [dirty, siteId]);

  // Initialize edit state when collections data loads.
  useEffect(() => {
    if (!collections.length) return;
    if (restoredFromCache.current) {
      restoredFromCache.current = false;
      return;
    }
    setEdits(buildInitialEdits(collections));
    setDirty(new Set());
    setSaved(new Set());
  }, [collections]);

  const updateField = (itemId: string, fieldSlug: string, value: string) => {
    setEdits(previous => ({
      ...previous,
      [itemId]: { ...previous[itemId], [fieldSlug]: value },
    }));
    setDirty(previous => new Set(previous).add(itemId));
    setSaved(previous => {
      const next = new Set(previous);
      next.delete(itemId);
      return next;
    });
  };

  return {
    expandedCollections,
    setExpandedCollections,
    expandedItems,
    setExpandedItems,
    edits,
    setEdits,
    dirty,
    setDirty,
    saving,
    setSaving,
    saved,
    setSaved,
    historyExpanded,
    search,
    setSearch,
    errors,
    setErrors,
    previewExpanded,
    toggleCollection,
    toggleItem,
    toggleHistory,
    togglePreview,
    updateField,
  };
}
