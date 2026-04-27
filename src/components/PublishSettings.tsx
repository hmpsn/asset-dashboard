/**
 * PublishSettings — Configure Webflow CMS publish target for a workspace.
 * Allows selecting a CMS collection, auto-suggesting field mappings via AI,
 * and saving the configuration to the workspace.
 */
import { useState, useEffect } from 'react';
import {
  Loader2, Save, Sparkles, Globe, ChevronDown, Check, AlertTriangle,
} from 'lucide-react';
import { SectionCard, Button, Icon } from './ui';
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
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
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

export function PublishSettings({ workspaceId: _workspaceId, webflowSiteId, publishTarget, onSave, toast }: Props) {
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
          if (val && (key in suggested || FIELD_MAP_KEYS.some(f => f.key === key))) {
            (suggested as unknown as Record<string, string>)[key] = val;
          }
        }
        setFieldMap(suggested);
        toast('AI suggested field mappings');
      }
      if (result.fields) setFields(result.fields);
    } catch (err) {
      console.error('PublishSettings operation failed:', err);
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
    } catch (err) {
      console.error('PublishSettings operation failed:', err);
      toast('Failed to save settings', 'error');
    }
    setSaving(false);
  };

  const updateField = (key: keyof FieldMap, value: string) => {
    setFieldMap(prev => ({ ...prev, [key]: value || undefined }));
  };

  if (!webflowSiteId) {
    return (
      <SectionCard>
        <div className="text-center">
          <Icon as={AlertTriangle} size="lg" className="text-amber-400/80 mx-auto mb-2" />
          <p className="text-sm text-[var(--brand-text)]">Link a Webflow site in Connections to enable publishing.</p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Webflow CMS Publish Target"
      titleIcon={<Icon as={Globe} size="md" className="text-teal-400" />}
      action={publishTarget ? (
        <span className="flex items-center gap-1 t-caption-sm text-emerald-400/80 bg-emerald-500/8 border border-emerald-500/20 px-2 py-1 rounded-[var(--radius-md)]">
          <Icon as={Check} size="sm" /> Configured
        </span>
      ) : undefined}
    >
      <div className="space-y-4">
        <p className="t-caption-sm text-[var(--brand-text-muted)]">Choose which CMS collection to publish content posts to</p>
        <div>
          <label className="block t-caption-sm font-medium text-[var(--brand-text)] mb-1.5">CMS Collection</label>
          {loading ? (
            <div className="flex items-center gap-2 text-[var(--brand-text-muted)] text-xs">
              <Icon as={Loader2} size="sm" className="animate-spin" /> Loading collections...
            </div>
          ) : (
            <div className="relative">
              <select
                value={selectedCollection}
                onChange={e => handleCollectionChange(e.target.value)}
                className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] appearance-none cursor-pointer focus:border-teal-500/50 focus:outline-none"
              >
                <option value="">Select a collection...</option>
                {collections.map(c => (
                  <option key={c.id} value={c.id}>{c.displayName} ({c.slug})</option>
                ))}
              </select>
              <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>

        {/* AI suggest button — this is an admin AI feature, purple is correct here */}
        {selectedCollection && fields.length > 0 && (
          <button
            onClick={suggestMapping}
            disabled={suggesting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50"
          >
            {suggesting ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Sparkles} size="sm" />}
            {suggesting ? 'Suggesting...' : 'AI Suggest Mappings'}
          </button>
        )}

        {/* Field mapping */}
        {selectedCollection && (loadingFields ? (
          <div className="flex items-center gap-2 text-[var(--brand-text-muted)] text-xs py-2">
            <Icon as={Loader2} size="sm" className="animate-spin" /> Loading collection schema...
          </div>
        ) : fields.length > 0 && (
          <div className="space-y-3">
            <p className="t-caption-sm font-medium text-[var(--brand-text)]">Field Mappings</p>
            {FIELD_MAP_KEYS.map(({ key, label, required, hint }) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-36 flex-shrink-0">
                  <span className="t-caption-sm text-[var(--brand-text-bright)]">
                    {label} {required && <span className="text-red-400/80">*</span>}
                  </span>
                  <span className="block t-micro text-[var(--brand-text-dim)]">{hint}</span>
                </div>
                <div className="relative flex-1">
                  <select
                    value={(fieldMap as unknown as Record<string, string | undefined>)[key] || ''}
                    onChange={e => updateField(key, e.target.value)}
                    className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-2.5 py-1.5 t-caption-sm text-[var(--brand-text-bright)] appearance-none cursor-pointer focus:border-teal-500/50 focus:outline-none"
                  >
                    <option value="">{required ? 'Select field...' : '(none)'}</option>
                    {fields.map(f => (
                      <option key={f.slug} value={f.slug}>{f.displayName} ({f.type})</option>
                    ))}
                  </select>
                  <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Save */}
        {selectedCollection && fields.length > 0 && (
          <div className="flex justify-end pt-2">
            <Button
              variant="primary"
              size="sm"
              icon={Save}
              loading={saving}
              disabled={saving || !fieldMap.title || !fieldMap.slug || !fieldMap.body}
              onClick={handleSave}
            >
              Save Publish Settings
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
