import { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, MapPin, Save } from 'lucide-react';
import { useLocalSeoLocations } from '../../hooks/admin/useLocalSeoLocations';
import {
  useUpdateWorkspaceGbpMappings,
  useWorkspaceGbpMappings,
} from '../../hooks/admin/useGoogleBusinessProfile';
import { Badge, Button, FormSelect, Icon, SectionCard } from '../ui';
import type { WorkspaceGbpMappingInput } from '../../../shared/types/google-business-profile';

export function GbpLocationMappingPanel({ workspaceId }: { workspaceId: string }) {
  const clientLocations = useLocalSeoLocations(workspaceId);
  const gbp = useWorkspaceGbpMappings(workspaceId);
  const update = useUpdateWorkspaceGbpMappings(workspaceId);
  const [selected, setSelected] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!gbp.data) return;
    const next: Record<string, string> = {};
    for (const mapping of gbp.data.mappings) {
      next[mapping.clientLocationId] = mapping.googleLocationId;
    }
    setSelected(next);
  }, [gbp.data]);

  const options = useMemo(() => [
    { value: '', label: 'No GBP location mapped' },
    ...(gbp.data?.locations ?? []).map(location => ({
      value: location.id,
      label: location.title ?? location.resourceName,
    })),
  ], [gbp.data?.locations]);

  const handleSave = () => {
    const mappings: WorkspaceGbpMappingInput[] = Object.entries(selected)
      .filter(([, googleLocationId]) => googleLocationId)
      .map(([clientLocationId, googleLocationId], index) => ({
        clientLocationId,
        googleLocationId,
        isPrimary: index === 0,
      }));
    update.mutate({ mappings });
  };

  const loading = clientLocations.isLoading || gbp.isLoading;
  const locations = clientLocations.data ?? [];
  const connected = gbp.data?.connection.connected;

  return (
    <SectionCard
      title="Google Business Profile Mapping"
      titleIcon={<Icon as={Link2} size="md" className="text-teal-400" />}
      action={<Badge label={`${gbp.data?.mappings.length ?? 0} mapped`} tone={connected ? 'teal' : 'zinc'} variant="soft" shape="pill" />}
    >
      <div className="space-y-4">
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Map discovered GBP locations to the client location records used by local SEO and schema context.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-[var(--brand-text-muted)]">
            <Icon as={Loader2} size="md" className="animate-spin" />
            <span className="t-caption-sm">Loading location mappings...</span>
          </div>
        )}

        {!loading && !connected && (
          <div className="rounded-[var(--radius-lg)] border border-amber-500/20 bg-amber-500/8 p-3">
            <p className="t-caption-sm text-amber-400">
              Connect Google Business Profile in Workspace Settings before mapping locations.
            </p>
          </div>
        )}

        {!loading && connected && locations.length === 0 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              Add a client location before mapping Google Business Profile locations.
            </p>
          </div>
        )}

        {!loading && connected && locations.length > 0 && (
          <div className="space-y-3">
            {locations.map(location => (
              <div key={location.id} className="grid gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,360px)] md:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon as={MapPin} size="sm" className="text-teal-400" />
                    <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">{location.name}</p>
                  </div>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                    {[location.city, location.stateOrRegion, location.country].filter(Boolean).join(', ') || 'No address details'}
                  </p>
                </div>
                <FormSelect
                  value={selected[location.id] ?? ''}
                  onChange={(value) => setSelected(prev => ({ ...prev, [location.id]: value }))}
                  options={options}
                  disabled={update.isPending}
                />
              </div>
            ))}
            <Button
              size="sm"
              icon={Save}
              loading={update.isPending}
              onClick={handleSave}
            >
              Save mappings
            </Button>
          </div>
        )}

        {update.isError && (
          <p className="t-caption-sm text-red-400">Unable to save GBP mappings. Check that each Google location is only mapped once.</p>
        )}
      </div>
    </SectionCard>
  );
}
