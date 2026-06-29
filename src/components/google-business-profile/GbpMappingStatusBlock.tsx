import { AlertTriangle, Check, MapPin, Settings2, Unplug } from 'lucide-react';
import { adminPath } from '../../routes';
import { useWorkspaceGbpMappings } from '../../hooks/admin/useGoogleBusinessProfile';
import { Badge, Button, Icon } from '../ui';

export function GbpMappingStatusBlock({ workspaceId }: { workspaceId: string }) {
  const query = useWorkspaceGbpMappings(workspaceId);
  const data = query.data;
  const connected = data?.connection.connected;
  const mappedCount = data?.mappings.length ?? 0;
  const locationCount = data?.locations.length ?? 0;
  const tone = connected ? (mappedCount > 0 ? 'emerald' : 'amber') : 'zinc';
  const label = connected ? (mappedCount > 0 ? 'Mapped' : 'Connected') : 'Not connected';

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-4">
      <div className="flex items-start gap-3">
        <Icon
          as={connected ? mappedCount > 0 ? Check : AlertTriangle : Unplug}
          size="md"
          className={connected ? mappedCount > 0 ? 'text-emerald-400' : 'text-amber-400' : 'text-[var(--brand-text-muted)]'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Authenticated GBP</p>
            <Badge label={query.isLoading ? 'Checking' : label} tone={tone} variant="soft" shape="pill" />
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
            {connected
              ? `${mappedCount} of ${locationCount} discovered Google Business Profile locations are mapped to this workspace.`
              : 'Connect Google Business Profile in Workspace Settings, then map discovered locations to client location records.'}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button
              variant="secondary"
              size="sm"
              icon={Settings2}
              onClick={() => { window.location.href = `${adminPath(workspaceId, 'workspace-settings')}?tab=connections`; }}
            >
              Open connection
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={MapPin}
              onClick={() => { window.location.href = `${adminPath(workspaceId, 'brand')}?tab=business-footprint&focus=locations-section`; }}
            >
              Open mappings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
