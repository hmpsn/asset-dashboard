import { AlertTriangle, Check, Loader2, LogIn, RefreshCw, Unplug } from 'lucide-react';
import { Badge, Button, Icon, SectionCard } from '../ui';
import {
  useGbpAuthUrl,
  useGbpConnectionStatus,
  useGbpDisconnect,
  useGbpSync,
} from '../../hooks/admin/useGoogleBusinessProfile';

export function GbpConnectionCard({ workspaceId }: { workspaceId: string }) {
  const status = useGbpConnectionStatus();
  const authUrl = useGbpAuthUrl();
  const sync = useGbpSync();
  const disconnect = useGbpDisconnect();
  const data = status.data;
  const connected = data?.connected;
  const reconnectNeeded = data?.needsReconnect;

  const handleConnect = async () => {
    const result = await authUrl.mutateAsync({
      workspaceId,
      returnTo: `/ws/${workspaceId}/workspace-settings?tab=connections`,
    });
    window.location.href = result.url;
  };

  return (
    <SectionCard noPadding>
      <div className="px-5 py-4 flex flex-wrap items-center gap-3 border-b border-[var(--brand-border)]">
        <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
          <Icon as={connected ? Check : reconnectNeeded ? AlertTriangle : Unplug} size="md" className={connected ? 'text-emerald-400' : reconnectNeeded ? 'text-amber-400' : 'text-teal-400'} />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Google Business Profile</h3>
          <p className="t-caption text-[var(--brand-text-muted)]">
            Authenticated account discovery and workspace-location mapping.
          </p>
        </div>
        {status.isLoading ? (
          <Badge label="Checking" tone="blue" variant="soft" shape="pill" size="md" icon={Loader2} />
        ) : connected ? (
          <Badge label="Connected" tone="emerald" variant="soft" shape="pill" size="md" icon={Check} />
        ) : reconnectNeeded && data?.configured ? (
          <Badge label="Reconnect needed" tone="amber" variant="soft" shape="pill" size="md" icon={AlertTriangle} />
        ) : (
          <Badge label="Not connected" tone="zinc" variant="soft" shape="pill" size="md" icon={Unplug} />
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="t-label text-[var(--brand-text-muted)]">Accounts</p>
            <p className="t-stat-sm text-blue-400">{data?.accountCount ?? '-'}</p> {/* stat-primitive-ok: compact integration connection count inside one Settings card */}
          </div>
          <div>
            <p className="t-label text-[var(--brand-text-muted)]">Locations</p>
            <p className="t-stat-sm text-blue-400">{data?.locationCount ?? '-'}</p> {/* stat-primitive-ok: compact integration connection count inside one Settings card */}
          </div>
          <div>
            <p className="t-label text-[var(--brand-text-muted)]">Mapped</p>
            <p className="t-stat-sm text-teal-400">{data?.mappedLocationCount ?? '-'}</p> {/* stat-primitive-ok: compact integration connection count inside one Settings card */}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={LogIn}
            loading={authUrl.isPending}
            onClick={handleConnect}
          >
            {connected || reconnectNeeded ? 'Reconnect' : 'Connect'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={sync.isPending}
            disabled={!connected}
            onClick={() => sync.mutate(workspaceId)}
          >
            Sync locations
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Unplug}
            loading={disconnect.isPending}
            disabled={!data?.configured}
            onClick={() => disconnect.mutate(workspaceId)}
          >
            Disconnect
          </Button>
        </div>

        {(status.isError || authUrl.isError || sync.isError || disconnect.isError) && (
          <p className="t-caption-sm text-red-400">
            Google Business Profile connection could not be updated. Check OAuth credentials and API access.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
