import { useState } from 'react';
import { Check, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCreateLocation, useDeleteLocation, useLocalSeoLocations, useUpdateLocation } from '../../hooks/admin/useLocalSeoLocations';
import type { CreateLocationBody } from '../../api/localSeo';
import type { ClientLocation } from '../../../shared/types/local-seo';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, FormField, FormInput, Icon, IconButton, SectionCard, Skeleton } from '../ui';

interface WorkspaceSeedData {
  name: string;
  liveDomain?: string;
  businessProfile?: {
    phone?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      country?: string;
    };
  } | null;
}

interface LocationFormState {
  name: string;
  domain: string;
  phone: string;
  streetAddress: string;
  city: string;
  stateOrRegion: string;
  country: string;
  isPrimary: boolean;
}

interface LocationsTabProps {
  workspaceId: string;
  workspaceName: string;
  liveDomain?: string;
  businessProfile?: WorkspaceSeedData['businessProfile'];
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

function blankForm(): LocationFormState {
  return {
    name: '',
    domain: '',
    phone: '',
    streetAddress: '',
    city: '',
    stateOrRegion: '',
    country: '',
    isPrimary: false,
  };
}

function buildSeedBody(ws: WorkspaceSeedData): CreateLocationBody {
  return {
    name: ws.name,
    domain: ws.liveDomain,
    phone: ws.businessProfile?.phone,
    streetAddress: ws.businessProfile?.address?.street,
    city: ws.businessProfile?.address?.city,
    stateOrRegion: ws.businessProfile?.address?.state,
    country: ws.businessProfile?.address?.country,
    isPrimary: true,
    status: 'confirmed',
  };
}

function formFromLocation(location: ClientLocation): LocationFormState {
  return {
    name: location.name,
    domain: location.domain ?? '',
    phone: location.phone ?? '',
    streetAddress: location.streetAddress ?? '',
    city: location.city ?? '',
    stateOrRegion: location.stateOrRegion ?? '',
    country: location.country ?? '',
    isPrimary: location.isPrimary,
  };
}

function formToBody(form: LocationFormState): CreateLocationBody {
  return {
    name: form.name.trim(),
    domain: form.domain.trim() || undefined,
    phone: form.phone.trim() || undefined,
    streetAddress: form.streetAddress.trim() || undefined,
    city: form.city.trim() || undefined,
    stateOrRegion: form.stateOrRegion.trim() || undefined,
    country: form.country.trim() || undefined,
    isPrimary: form.isPrimary,
  };
}

function addressLine(location: ClientLocation): string {
  return [location.streetAddress, location.city, location.stateOrRegion, location.country].filter(Boolean).join(', ') || 'No address';
}

interface LocationFormProps {
  form: LocationFormState;
  onChange: (patch: Partial<LocationFormState>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew?: boolean;
}

function LocationForm({ form, onChange, onSave, onCancel, saving, isNew = false }: LocationFormProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Location name" required>
          <FormInput value={form.name} onChange={name => onChange({ name })} placeholder="Downtown Austin" disabled={saving} />
        </FormField>
        <FormField label="Domain">
          <FormInput value={form.domain} onChange={domain => onChange({ domain })} placeholder="swishdental.com" disabled={saving} />
        </FormField>
        <FormField label="Phone">
          <FormInput value={form.phone} onChange={phone => onChange({ phone })} placeholder="+1 512 555 0100" disabled={saving} />
        </FormField>
        <FormField label="Street address">
          <FormInput value={form.streetAddress} onChange={streetAddress => onChange({ streetAddress })} placeholder="123 Main St" disabled={saving} />
        </FormField>
        <FormField label="City">
          <FormInput value={form.city} onChange={city => onChange({ city })} placeholder="Austin" disabled={saving} />
        </FormField>
        <FormField label="State / region">
          <FormInput value={form.stateOrRegion} onChange={stateOrRegion => onChange({ stateOrRegion })} placeholder="TX" disabled={saving} />
        </FormField>
        <FormField label="Country">
          <FormInput value={form.country} onChange={country => onChange({ country })} placeholder="US" disabled={saving} />
        </FormField>
      </div>

      <Checkbox
        checked={form.isPrimary}
        onChange={isPrimary => onChange({ isPrimary })}
        label="Primary location"
        disabled={saving}
      />

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving || !form.name.trim()} loading={saving}>
          {isNew ? 'Add location' : 'Save changes'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface LocationRowProps {
  location: ClientLocation;
  workspaceId: string;
  onDelete: (id: string) => void;
}

function LocationRow({ location, workspaceId, onDelete }: LocationRowProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LocationFormState>(() => formFromLocation(location));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateMutation = useUpdateLocation(workspaceId);
  const needsReview = location.status === 'needs_review';

  const handleConfirm = async () => {
    await updateMutation.mutateAsync({ locationId: location.id, body: { status: 'confirmed' } });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await updateMutation.mutateAsync({ locationId: location.id, body: formToBody(form) });
    setEditing(false);
  };

  const cancelEdit = () => {
    setForm(formFromLocation(location));
    setEditing(false);
  };

  return (
    <>
      <SectionCard
        variant="subtle"
        className={needsReview ? 'border-amber-500/30 bg-amber-500/8' : undefined}
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="t-body font-semibold text-[var(--brand-text-bright)] truncate">{location.name}</p>
                {location.isPrimary && <Badge label="Primary" tone="teal" variant="outline" shape="pill" />}
                {needsReview && <Badge label="Needs review" tone="amber" variant="outline" shape="pill" />}
              </div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
                {addressLine(location)}
                {location.domain ? ` | ${location.domain}` : ''}
              </p>
            </div>

            {!editing && (
              <div className="flex items-center gap-1 shrink-0">
                {needsReview && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Check}
                    onClick={() => { void handleConfirm(); }}
                    disabled={updateMutation.isPending}
                    aria-label={`Confirm location ${location.name}`}
                  >
                    Confirm
                  </Button>
                )}
                <IconButton
                  icon={Pencil}
                  label={`Edit location ${location.name}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setForm(formFromLocation(location));
                    setEditing(true);
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={`Remove location ${location.name}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  className="hover:text-red-400/80"
                />
              </div>
            )}

            {editing && (
              <IconButton
                icon={X}
                label="Cancel location edit"
                variant="ghost"
                size="sm"
                onClick={cancelEdit}
              />
            )}
          </div>

          {editing && (
            <LocationForm
              form={form}
              onChange={patch => setForm(current => ({ ...current, ...patch }))}
              onSave={() => { void handleSave(); }}
              onCancel={cancelEdit}
              saving={updateMutation.isPending}
            />
          )}
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirmDelete}
        title="Remove location?"
        message={`${location.name} will be permanently removed. This cannot be undone.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(location.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

export function LocationsTab({ workspaceId, workspaceName, liveDomain, businessProfile, toast }: LocationsTabProps) {
  const { data: locations, isLoading, isError } = useLocalSeoLocations(workspaceId);
  const createMutation = useCreateLocation(workspaceId);
  const deleteMutation = useDeleteLocation(workspaceId);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<LocationFormState>(blankForm);
  const [seedConfirming, setSeedConfirming] = useState(false);

  const isEmpty = !isLoading && !isError && Array.isArray(locations) && locations.length === 0;
  const seedBody = buildSeedBody({ name: workspaceName, liveDomain, businessProfile });
  const hasSeedData = Boolean(seedBody.name || seedBody.domain || seedBody.phone || seedBody.streetAddress);
  const showSeedBanner = isEmpty && hasSeedData && !showAddForm;

  const handleSeedConfirm = async () => {
    setSeedConfirming(true);
    try {
      await createMutation.mutateAsync(seedBody);
      toast('Primary location added');
    } catch {
      toast('Failed to add location', 'error');
    } finally {
      setSeedConfirming(false);
    }
  };

  const handleAddSave = async () => {
    if (!addForm.name.trim()) return;
    try {
      await createMutation.mutateAsync(formToBody(addForm));
      setAddForm(blankForm());
      setShowAddForm(false);
      toast('Location added');
    } catch {
      toast('Failed to add location', 'error');
    }
  };

  const handleDelete = async (locationId: string) => {
    try {
      await deleteMutation.mutateAsync(locationId);
      toast('Location removed');
    } catch {
      toast('Failed to remove location', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading locations">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <SectionCard title="Business locations">
        <p className="t-body text-[var(--brand-text-muted)]">Failed to load locations. Refresh and try again.</p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Business locations</h3>
        <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
          Manage physical locations used for local SEO match detection. The primary location is the default identity signal.
        </p>
      </div>

      {showSeedBanner && (
        <SectionCard variant="subtle" className="border-amber-500/30 bg-amber-500/8">
          <div className="space-y-3" role="alert" aria-label="Confirm your primary location">
            <div className="flex items-start gap-3">
              <Icon as={MapPin} size="md" className="text-amber-400 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="t-body font-semibold text-[var(--brand-text-bright)]">Confirm your primary location</p>
                <p className="t-caption text-[var(--brand-text-muted)] mt-1">
                  Workspace profile details can seed the first location used for local match detection.
                </p>
                <div className="mt-3 space-y-1">
                  {seedBody.name && <p className="t-caption-sm text-[var(--brand-text-muted)]">Name: {seedBody.name}</p>}
                  {seedBody.domain && <p className="t-caption-sm text-[var(--brand-text-muted)]">Domain: {seedBody.domain}</p>}
                  {seedBody.phone && <p className="t-caption-sm text-[var(--brand-text-muted)]">Phone: {seedBody.phone}</p>}
                  {seedBody.streetAddress && (
                    <p className="t-caption-sm text-[var(--brand-text-muted)]">
                      Address: {[seedBody.streetAddress, seedBody.city, seedBody.stateOrRegion, seedBody.country].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" icon={Check} onClick={() => { void handleSeedConfirm(); }} loading={seedConfirming || createMutation.isPending}>
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAddForm(true)}>
                Edit before confirming
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      {Array.isArray(locations) && locations.length > 0 && (
        <div className="space-y-3" role="list" aria-label="Business locations">
          {locations.map(location => (
            <div key={location.id} role="listitem">
              <LocationRow location={location} workspaceId={workspaceId} onDelete={locationId => { void handleDelete(locationId); }} />
            </div>
          ))}
        </div>
      )}

      {showAddForm && (
        <SectionCard title="New location" variant="subtle" className="border-dashed">
          <LocationForm
            form={addForm}
            onChange={patch => setAddForm(current => ({ ...current, ...patch }))}
            onSave={() => { void handleAddSave(); }}
            onCancel={() => {
              setAddForm(blankForm());
              setShowAddForm(false);
            }}
            saving={createMutation.isPending}
            isNew
          />
        </SectionCard>
      )}

      {!showAddForm && Array.isArray(locations) && locations.length > 0 && (
        <Button
          variant="secondary"
          size="md"
          icon={Plus}
          className="w-full border-dashed"
          onClick={() => {
            setAddForm(blankForm());
            setShowAddForm(true);
          }}
          aria-label="Add another location"
        >
          Add another location
        </Button>
      )}

      {isEmpty && !hasSeedData && !showAddForm && (
        <EmptyState
          icon={MapPin}
          title="No locations configured"
          description="Add a location to improve local business match accuracy."
          action={(
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setShowAddForm(true)}>
              Add location
            </Button>
          )}
        />
      )}
    </div>
  );
}
