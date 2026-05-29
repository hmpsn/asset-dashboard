import { useMemo, useState } from 'react';
import { Plus, Save, Sparkles, Trash2, ShieldCheck } from 'lucide-react';

import {
  EEAT_ASSET_TYPE,
  type EeatAsset,
  type EeatAssetMetadata,
  type EeatAssetType,
} from '../../../shared/types/eeat-assets';
import {
  useCreateEeatAsset,
  useDeleteEeatAsset,
  useEeatAssets,
  useUpdateEeatAsset,
  useAutofillEeatAssets,
} from '../../hooks/admin/useEeatAssets';
import {
  SectionCard,
  Button,
  FormInput,
  FormSelect,
  FormTextarea,
  Icon,
  LoadingState,
  ErrorState,
} from '../ui';
import { formatDate } from '../../utils/formatDates';

interface EeatAssetsTabProps {
  workspaceId: string;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface AssetDraft {
  type: EeatAssetType;
  title: string;
  url: string;
  content: string;
  attributionName: string;
  attributionRole: string;
  credentialIssuer: string;
  expertiseAreas: string;
  serviceTypes: string;
  locations: string;
  metricLabel: string;
  metricValue: string;
}

const ASSET_TYPE_OPTIONS: Array<{ value: EeatAssetType; label: string }> = [
  { value: EEAT_ASSET_TYPE.TESTIMONIAL, label: 'Testimonial' },
  { value: EEAT_ASSET_TYPE.CASE_STUDY, label: 'Case study' },
  { value: EEAT_ASSET_TYPE.CREDENTIAL, label: 'Credential / certification' },
  { value: EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY, label: 'Before/after gallery' },
  { value: EEAT_ASSET_TYPE.TEAM_BIO, label: 'Team bio / expertise' },
  { value: EEAT_ASSET_TYPE.AWARD, label: 'Award / recognition' },
  { value: EEAT_ASSET_TYPE.RESEARCH, label: 'Research / data source' },
  { value: EEAT_ASSET_TYPE.CLIENT_LOGO, label: 'Client logo' },
];

function defaultDraft(): AssetDraft {
  return {
    type: EEAT_ASSET_TYPE.TESTIMONIAL,
    title: '',
    url: '',
    content: '',
    attributionName: '',
    attributionRole: '',
    credentialIssuer: '',
    expertiseAreas: '',
    serviceTypes: '',
    locations: '',
    metricLabel: '',
    metricValue: '',
  };
}

function csvToList(value: string): string[] | undefined {
  const parsed = value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function metadataFromDraft(draft: AssetDraft): EeatAssetMetadata | undefined {
  const metadata: EeatAssetMetadata = {
    attributionName: draft.attributionName.trim() || undefined,
    attributionRole: draft.attributionRole.trim() || undefined,
    credentialIssuer: draft.credentialIssuer.trim() || undefined,
    expertiseAreas: csvToList(draft.expertiseAreas),
    serviceTypes: csvToList(draft.serviceTypes),
    locations: csvToList(draft.locations),
    metricLabel: draft.metricLabel.trim() || undefined,
    metricValue: draft.metricValue.trim() || undefined,
  };

  return Object.values(metadata).some(Boolean) ? metadata : undefined;
}

function draftFromAsset(asset: EeatAsset): AssetDraft {
  return {
    type: asset.type,
    title: asset.title,
    url: asset.url || '',
    content: asset.content || '',
    attributionName: asset.metadata?.attributionName || '',
    attributionRole: asset.metadata?.attributionRole || '',
    credentialIssuer: asset.metadata?.credentialIssuer || '',
    expertiseAreas: (asset.metadata?.expertiseAreas || []).join(', '),
    serviceTypes: (asset.metadata?.serviceTypes || []).join(', '),
    locations: (asset.metadata?.locations || []).join(', '),
    metricLabel: asset.metadata?.metricLabel || '',
    metricValue: asset.metadata?.metricValue || '',
  };
}

export function EeatAssetsTab({ workspaceId, toast }: EeatAssetsTabProps) {
  const { data, isLoading, error, refetch } = useEeatAssets(workspaceId);
  const createAsset = useCreateEeatAsset(workspaceId);
  const updateAsset = useUpdateEeatAsset(workspaceId);
  const deleteAsset = useDeleteEeatAsset(workspaceId);
  const autofillAssets = useAutofillEeatAssets(workspaceId);

  const [newDraft, setNewDraft] = useState<AssetDraft>(defaultDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<AssetDraft | null>(null);

  const grouped = useMemo(() => {
    const assets = data || [];
    return ASSET_TYPE_OPTIONS
      .map((typeOption) => ({
        ...typeOption,
        assets: assets.filter(asset => asset.type === typeOption.value),
      }))
      .filter(group => group.assets.length > 0);
  }, [data]);

  const onCreate = async () => {
    if (!newDraft.title.trim()) {
      toast('Title is required', 'error');
      return;
    }
    try {
      await createAsset.mutateAsync({
        type: newDraft.type,
        title: newDraft.title,
        url: newDraft.url,
        content: newDraft.content,
        metadata: metadataFromDraft(newDraft),
      });
      setNewDraft(defaultDraft());
      toast('E-E-A-T asset added');
    } catch {
      toast('Failed to add E-E-A-T asset', 'error');
    }
  };

  const startEdit = (asset: EeatAsset) => {
    setEditingId(asset.id);
    setEditDraft(draftFromAsset(asset));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async (assetId: string) => {
    if (!editDraft) return;
    if (!editDraft.title.trim()) {
      toast('Title is required', 'error');
      return;
    }
    try {
      await updateAsset.mutateAsync({
        assetId,
        body: {
          type: editDraft.type,
          title: editDraft.title,
          url: editDraft.url,
          content: editDraft.content,
          metadata: metadataFromDraft(editDraft),
        },
      });
      cancelEdit();
      toast('E-E-A-T asset updated');
    } catch {
      toast('Failed to update E-E-A-T asset', 'error');
    }
  };

  const removeAsset = async (assetId: string) => {
    try {
      await deleteAsset.mutateAsync(assetId);
      if (editingId === assetId) cancelEdit();
      toast('E-E-A-T asset removed');
    } catch {
      toast('Failed to remove E-E-A-T asset', 'error');
    }
  };

  const runAutofill = async () => {
    try {
      const result = await autofillAssets.mutateAsync();
      if (result.count > 0) toast(result.message);
      else toast(result.message, 'info');
    } catch {
      toast('Failed to auto-fill E-E-A-T assets', 'error');
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading E-E-A-T asset inventory..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load E-E-A-T assets"
        message="Try reloading this workspace settings tab."
        action={{ label: 'Retry', onClick: () => void refetch() }}
      />
    );
  }

  const fieldClass = 'w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500 transition-colors';
  const isSaving = createAsset.isPending || updateAsset.isPending || deleteAsset.isPending || autofillAssets.isPending;

  return (
    <div className="space-y-6">
      <SectionCard noPadding>
        <div className="px-5 py-4 border-b border-[var(--brand-border)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
            <Icon as={ShieldCheck} size="md" className="text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">E-E-A-T Asset Library</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Tag real trust assets so briefs, schema, and page intelligence use concrete evidence.</p>
          </div>
        </div>

        <div className="px-5 py-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormSelect
              className={fieldClass}
              value={newDraft.type}
              onChange={value => setNewDraft(prev => ({ ...prev, type: value as EeatAssetType }))}
              options={ASSET_TYPE_OPTIONS}
            />
            <FormInput
              className={fieldClass}
              value={newDraft.title}
              onChange={value => setNewDraft(prev => ({ ...prev, title: value }))}
              placeholder="Asset title"
            />
          </div>
          <FormInput
            className={fieldClass}
            value={newDraft.url}
            onChange={value => setNewDraft(prev => ({ ...prev, url: value }))}
            placeholder="Optional URL"
          />
          <FormTextarea
            className={fieldClass}
            rows={3}
            value={newDraft.content}
            onChange={value => setNewDraft(prev => ({ ...prev, content: value }))}
            placeholder="Optional quote, summary, or proof snippet"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput className={fieldClass} value={newDraft.attributionName} onChange={value => setNewDraft(prev => ({ ...prev, attributionName: value }))} placeholder="Attribution name" />
            <FormInput className={fieldClass} value={newDraft.attributionRole} onChange={value => setNewDraft(prev => ({ ...prev, attributionRole: value }))} placeholder="Attribution role/title" />
            <FormInput className={fieldClass} value={newDraft.credentialIssuer} onChange={value => setNewDraft(prev => ({ ...prev, credentialIssuer: value }))} placeholder="Credential issuer" />
            <FormInput className={fieldClass} value={newDraft.expertiseAreas} onChange={value => setNewDraft(prev => ({ ...prev, expertiseAreas: value }))} placeholder="Expertise areas (comma-separated)" />
            <FormInput className={fieldClass} value={newDraft.serviceTypes} onChange={value => setNewDraft(prev => ({ ...prev, serviceTypes: value }))} placeholder="Service types (comma-separated)" />
            <FormInput className={fieldClass} value={newDraft.locations} onChange={value => setNewDraft(prev => ({ ...prev, locations: value }))} placeholder="Locations (comma-separated)" />
            <FormInput className={fieldClass} value={newDraft.metricLabel} onChange={value => setNewDraft(prev => ({ ...prev, metricLabel: value }))} placeholder="Metric label" />
            <FormInput className={fieldClass} value={newDraft.metricValue} onChange={value => setNewDraft(prev => ({ ...prev, metricValue: value }))} placeholder="Metric value" />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              icon={autofillAssets.isPending ? undefined : Sparkles}
              variant="secondary"
              onClick={() => { void runAutofill(); }}
              disabled={isSaving}
              loading={autofillAssets.isPending}
            >
              {autofillAssets.isPending ? 'Auto-filling…' : 'Auto-fill from existing data'}
            </Button>
            <Button icon={Plus} variant="primary" onClick={onCreate} disabled={isSaving} loading={createAsset.isPending}>
              Add asset
            </Button>
          </div>
        </div>
      </SectionCard>

      {grouped.length === 0 ? (
        <SectionCard variant="subtle">
          <p className="t-caption text-[var(--brand-text-muted)]">No E-E-A-T assets yet. Add testimonials, case studies, credentials, and other proof assets to ground recommendations.</p>
        </SectionCard>
      ) : (
        grouped.map(group => (
          <SectionCard key={group.value} title={`${group.label} (${group.assets.length})`}>
            <div className="space-y-4">
              {group.assets.map(asset => {
                const editing = editingId === asset.id && editDraft != null;
                const draft = editing ? editDraft : draftFromAsset(asset);
                return (
                  <div key={asset.id} className="border border-[var(--brand-border)] rounded-[var(--radius-lg)] p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <FormInput
                        className={fieldClass}
                        value={draft.title}
                        onChange={value => editing && setEditDraft(prev => prev ? { ...prev, title: value } : prev)}
                        disabled={!editing}
                      />
                      <FormInput
                        className={fieldClass}
                        value={draft.url}
                        onChange={value => editing && setEditDraft(prev => prev ? { ...prev, url: value } : prev)}
                        disabled={!editing}
                        placeholder="URL"
                      />
                    </div>
                    <FormTextarea
                      className={fieldClass}
                      rows={2}
                      value={draft.content}
                      onChange={value => editing && setEditDraft(prev => prev ? { ...prev, content: value } : prev)}
                      disabled={!editing}
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <FormInput className={fieldClass} value={draft.attributionName} onChange={value => editing && setEditDraft(prev => prev ? { ...prev, attributionName: value } : prev)} disabled={!editing} placeholder="Attribution name" />
                      <FormInput className={fieldClass} value={draft.attributionRole} onChange={value => editing && setEditDraft(prev => prev ? { ...prev, attributionRole: value } : prev)} disabled={!editing} placeholder="Attribution role" />
                      <FormInput className={fieldClass} value={draft.credentialIssuer} onChange={value => editing && setEditDraft(prev => prev ? { ...prev, credentialIssuer: value } : prev)} disabled={!editing} placeholder="Credential issuer" />
                      <FormInput className={fieldClass} value={draft.expertiseAreas} onChange={value => editing && setEditDraft(prev => prev ? { ...prev, expertiseAreas: value } : prev)} disabled={!editing} placeholder="Expertise areas" />
                    </div>

                    <div className="flex justify-between items-center pt-1">
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">Updated {formatDate(asset.updatedAt)}</span>
                      <div className="flex items-center gap-2">
                        {!editing ? (
                          <Button variant="secondary" size="sm" onClick={() => startEdit(asset)} disabled={isSaving}>Edit</Button>
                        ) : (
                          <>
                            <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isSaving}>Cancel</Button>
                            <Button icon={Save} variant="primary" size="sm" onClick={() => void saveEdit(asset.id)} disabled={isSaving} loading={updateAsset.isPending}>Save</Button>
                          </>
                        )}
                        <Button
                          icon={Trash2}
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:text-red-300"
                          onClick={() => void removeAsset(asset.id)}
                          disabled={isSaving}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ))
      )}
    </div>
  );
}
