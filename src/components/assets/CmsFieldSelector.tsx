/**
 * CmsFieldSelector — Collapsible panel for selecting which CMS collection fields
 * are included in bulk compression / optimization operations.
 *
 * Shown when the "CMS Images" or "CMS Missing Alt" filter is active.
 * Groups checkboxes by collection, with smart defaults that uncheck
 * meta/OG/thumbnail fields and check content fields.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import type { CmsCollectionImageInfo } from '../../../shared/types/cms-images';

/** Patterns that indicate a meta/OG/preview image field (not a content field) */
const META_PATTERNS = [
  /\bog[-_]?image/i,    // og-image, og_image, ogImage
  /\bopen[-_]?graph/i,  // open-graph, opengraph
  /\bmeta[-_]?image/i,  // meta-image, meta_image
  /\bthumbnail/i,       // thumbnail
  /\bthumb/i,           // thumb
  /\bseo[-_]?image/i,   // seo-image, seo_image
  /\bsocial[-_]?image/i,// social-image, social_image
  /\bpreview[-_]?image/i,// preview-image
  /\bshare[-_]?image/i, // share-image
  /\bfeatured[-_]?image/i, // featured-image (typically hero/card, not body content)
  /\bcover[-_]?image/i, // cover-image
];

/** Returns true for field slugs/names that look like meta/OG/preview images */
function isMetaField(slug: string, displayName: string): boolean {
  const text = `${slug} ${displayName}`;
  return META_PATTERNS.some(p => p.test(text));
}

/** Build the default selected field set — content fields in, meta/OG fields out */
export function buildDefaultSelectedFields(collections: CmsCollectionImageInfo[]): Set<string> {
  const selected = new Set<string>();
  for (const coll of collections) {
    for (const field of coll.imageFields) {
      if (!isMetaField(field.slug, field.displayName)) {
        selected.add(`${coll.collectionId}:${field.slug}`);
      }
    }
  }
  return selected;
}

interface Props {
  collections: CmsCollectionImageInfo[];
  selectedFields: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function CmsFieldSelector({ collections, selectedFields, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
    () => new Set(collections.map(c => c.collectionId)),
  );

  const toggleField = (key: string) => {
    const next = new Set(selectedFields);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };

  const toggleCollection = (coll: CmsCollectionImageInfo, checked: boolean) => {
    const next = new Set(selectedFields);
    for (const field of coll.imageFields) {
      const key = `${coll.collectionId}:${field.slug}`;
      if (checked) next.add(key); else next.delete(key);
    }
    onChange(next);
  };

  const toggleExpanded = (collectionId: string) => {
    setExpandedCollections(prev => {
      const next = new Set(prev);
      if (next.has(collectionId)) next.delete(collectionId); else next.add(collectionId);
      return next;
    });
  };

  if (collections.length === 0) return null;

  const totalFields = collections.reduce((sum, c) => sum + c.imageFields.length, 0);
  const selectedCount = [...selectedFields].filter(k =>
    collections.some(c => c.imageFields.some(f => `${c.collectionId}:${f.slug}` === k)),
  ).length;

  return (
    <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-300 hover:text-blue-200 hover:bg-blue-950/30 transition-colors"
      >
        <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="flex-1 text-left font-medium">CMS Field Selection</span>
        <span className="text-xs text-blue-500">{selectedCount}/{totalFields} fields</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-blue-500" /> : <ChevronRight className="w-3.5 h-3.5 text-blue-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-blue-500/80">
            Only assets in checked fields appear in the filter and are eligible for bulk operations. Meta/OG fields are unchecked by default.
          </p>

          {collections.map(coll => {
            const collKeys = coll.imageFields.map(f => `${coll.collectionId}:${f.slug}`);
            const allChecked = collKeys.every(k => selectedFields.has(k));
            const someChecked = collKeys.some(k => selectedFields.has(k));
            const isExpanded = expandedCollections.has(coll.collectionId);

            return (
              <div key={coll.collectionId} className="space-y-1">
                {/* Collection header row */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
                    onChange={e => toggleCollection(coll, e.target.checked)}
                    className="rounded accent-teal-500 shrink-0"
                  />
                  <button
                    onClick={() => toggleExpanded(coll.collectionId)}
                    className="flex items-center gap-1 text-xs font-semibold text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-3 h-3 text-zinc-500" />
                      : <ChevronRight className="w-3 h-3 text-zinc-500" />}
                    {coll.collectionName}
                    <span className="text-zinc-600 font-normal">({coll.imageFields.length})</span>
                  </button>
                </div>

                {/* Individual field checkboxes */}
                {isExpanded && (
                  <div className="ml-6 space-y-1">
                    {coll.imageFields.map(field => {
                      const key = `${coll.collectionId}:${field.slug}`;
                      const isMeta = isMetaField(field.slug, field.displayName);
                      return (
                        <label key={key} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={selectedFields.has(key)}
                            onChange={() => toggleField(key)}
                            className="rounded accent-teal-500 shrink-0"
                          />
                          <span className={`text-xs transition-colors ${selectedFields.has(key) ? 'text-zinc-300' : 'text-zinc-600'} group-hover:text-zinc-200`}>
                            {field.displayName}
                          </span>
                          <span className={`text-[10px] px-1 py-0.5 rounded leading-none font-medium ${
                            field.type === 'RichText'
                              ? 'bg-emerald-900/40 text-emerald-500'
                              : field.type === 'MultiImage'
                              ? 'bg-blue-900/40 text-blue-400'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}>
                            {field.type}
                          </span>
                          {isMeta && (
                            <span className="text-[10px] px-1 py-0.5 rounded leading-none bg-amber-900/30 text-amber-600">meta</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
