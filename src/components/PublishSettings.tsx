/**
 * PublishSettings — Configure Webflow CMS publish target for a workspace.
 * Allows selecting a CMS collection, auto-suggesting field mappings via AI,
 * and saving the configuration to the workspace.
 */
import { useState, useEffect } from 'react';
import {
  Loader2, Save, Sparkles, Globe, ChevronDown, Check, AlertTriangle,
} from 'lucide-react';
import { get, post } from '../api/client';

interface CollectionInfo {
  id: string;
  displayName: string;
  slug: string;
}

interface CollectionField {
  id: string;
  displayName: string;
  type: string;
  slug: string;
}

interface FieldMap {
  title: string;
  slug: string;
  body: string;
  metaTitle?: string;
  metaDescription?: string;
  summary?: string;
  featuredImage?: string;
  author?: string;
  publishDate?: string;
  category?: string;
}

interface PublishTarget {
  collectionId: string;
  collectionName: string;
  fieldMap: FieldMap;
}

interface Props {
  workspaceId: string;
  webflowSiteId?: string;
  publishTarget?: PublishTarget | null;
  onSave: (target: PublishTarget) => Promise<void>;
  toast: (msg: string, type?: 'success' | 'error') => void;
}

const FIELD_MAP_KEYS: { key: keyof FieldMap; label: string; required: boolean; hint: string }[] = [
  { key: 'title', label: 'Title', required: true, hint: 'Post title (usually "name")' },
  { key: 'slug', label: 'Slug', required: true, hint: 'URL slug' },
  { key: 'body', label: 'Body (Rich Text)', required: true, hint: 'Main content body' },
  { key: 'metaTitle', label: 'Meta Title', required: false, hint: 'SEO title' },
  { key: 'metaDescription', label: 'Meta Description', required: false, hint: 'SEO meta description' },
  { key: 'summary', label: 'Summary / Excerpt', required: false, hint: 'Short excerpt' },
  { key: 'featuredImage', label: 'Featured Image', required: false, hint: 'Hero image field' },
  { key: 'author', label: 'Author', required: false, hint: 'Author name' },
  { key: 'publishDate', label: 'Publish Date', required: false, hint: 'Date published' },
  { key: 'category', label: 'Category', required: false, hint: 'Category or tag' },
];

export function PublishSettings({ workspaceId, webflowSiteId, publishTarget, onSave, toast }: Props) {
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [fields, setFields] = useState<CollectionField[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>(publishTarget?.collectionId || '');
  const [selectedCollectionName, setSelectedCollectionName] = useState<string>(publishTarget?.collectionName || '');
  const [fieldMap, setFieldMap] = useState<FieldMap>(publishTarget?.fieldMap || { title: '', slug: '', body: '' });
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);

  // Load collections
  useEffect(() => {
    if (!webflowSiteId) return;
    setLoading(true);
    get<CollectionInfo[]>(`/api/webflow/publish-collections/${webflowSiteId}`)
      .then(data => setCollections(Array.isArray(data) ? data : []))
      .catch(() => toast('Failed to load collections', 'error'))
      .finally(() => setLoading(false));
  }, [webflowSiteId, toast]);

  // Load schema when collection changes
  useEffect(() => {
    if (!selectedCollection || !webflowSiteId) { setFields([]); return; }
    setLoadingFields(true);
    get<{ fields: CollectionField[] }>(`/api/webflow/publish-schema/${selectedCollection}?siteId=${webflowSiteId}`)
      .then(data => setFields(data.fields || []))
      .catch(() => toast('Failed to load collection schema', 'error'))
      .finally(() => setLoadingFields(false));
  }, [selectedCollection, webflowSiteId, toast]);

  const handleCollectionChange = (collectionId: string) => {
    const col = collections.find(c => c.id === collectionId);
    setSelectedCollection(collectionId);
    setSelectedCollectionName(col?.displayName || '');
    setFieldMap({ title: '', slug: '', body: '' });
  };

  const suggestMapping = async () => {
    if (!selectedCollection || !webflowSiteId) return;
    setSuggesting(true);
    try {
      const result = await post<{ mapping: Record<string, string | null>; fields: CollectionField[] }>(
        `/api/webflow/suggest-field-mapping/${webflowSiteId}`,
        { collectionId: selectedCollection },
      );
      if (result.mapping) {
        const suggested: FieldMap = { title: '', slug: '', body: '' };
        for (const [key, val] of Object.entries(result.mapping)) {
          if (val && key in suggested || FIELD_MAP_KEYS.some(f => f.key === key)) {
            (suggested as Record<string, string>)[key] = val;
          }
        }
        setFieldMap(suggested);
        toast('AI suggested field mappings');
      }
      if (result.fields) setFields(result.fields);
    } catch {
      toast('AI suggestion failed', 'error');
    }
    setSuggesting(false);
  };

  const handleSave = async () => {
    if (!selectedCollection) { toast('Select a collection first', 'error'); return; }
    if (!fieldMap.title || !fieldMap.slug || !fieldMap.body) {
      toast('Title, Slug, and Body mappings are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        collectionId: selectedCollection,
        collectionName: selectedCollectionName,
        fieldMap,
      });
      toast('Publish settings saved');
    } catch {
      toast('Failed to save settings', 'error');
    }
    setSaving(false);
  };

  const updateField = (key: keyof FieldMap, value: string) => {
    setFieldMap(prev => ({ ...prev, [key]: value || undefined }));
  };

  if (!webflowSiteId) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 text-center">
        <AlertTriangle className="w-5 h-5 text-amber-400 mx-auto mb-2" />
        <p className="text-sm text-zinc-400">Link a Webflow site in Connections to enable publishing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Globe className="w-4 h-4 text-teal-400" />
            Webflow CMS Publish Target
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Choose which CMS collection to publish content posts to
          </p>
        </div>
        {publishTarget && (
          <span className="flex items-center gap-1 text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded-md">
            <Check className="w-3 h-3" /> Configured
          </span>
        )}
      </div>

      {/* Collection selector */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">CMS Collection</label>
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-500 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading collections...
            </div>
          ) : (
            <div className="relative">
              <select
                value={selectedCollection}
                onChange={e => handleCollectionChange(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 appearance-none cursor-pointer focus:border-teal-500/50 focus:outline-none"
              >
                <option value="">Select a collection...</option>
                {collections.map(c => (
                  <option key={c.id} value={c.id}>{c.displayName} ({c.slug})</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>

        {/* AI suggest button */}
        {selectedCollection && fields.length > 0 && (
          <button
            onClick={suggestMapping}
            disabled={suggesting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50"
          >
            {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {suggesting ? 'Suggesting...' : 'AI Suggest Mappings'}
          </button>
        )}

        {/* Field mapping */}
        {selectedCollection && (loadingFields ? (
          <div className="flex items-center gap-2 text-zinc-500 text-xs py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading collection schema...
          </div>
        ) : fields.length > 0 && (
          <div className="space-y-3">
            <p className="text-[11px] font-medium text-zinc-400">Field Mappings</p>
            {FIELD_MAP_KEYS.map(({ key, label, required, hint }) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-36 flex-shrink-0">
                  <span className="text-[11px] text-zinc-300">
                    {label} {required && <span className="text-red-400">*</span>}
                  </span>
                  <span className="block text-[10px] text-zinc-600">{hint}</span>
                </div>
                <div className="relative flex-1">
                  <select
                    value={(fieldMap as Record<string, string | undefined>)[key] || ''}
                    onChange={e => updateField(key, e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 appearance-none cursor-pointer focus:border-teal-500/50 focus:outline-none"
                  >
                    <option value="">{required ? 'Select field...' : '(none)'}</option>
                    {fields.map(f => (
                      <option key={f.slug} value={f.slug}>{f.displayName} ({f.type})</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Save */}
        {selectedCollection && fields.length > 0 && (
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !fieldMap.title || !fieldMap.slug || !fieldMap.body}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-teal-600 text-white hover:bg-teal-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Publish Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
